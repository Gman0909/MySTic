import type { FastifyInstance } from "fastify";
import { eq, sql } from "drizzle-orm";
import { z } from "zod";
import { requireAdmin } from "./auth.js";
import { schema, type Db } from "./db/index.js";
import { getSettings, instanceSettingsSchema, updateSettings } from "./settings.js";

const { users, authSessions, collections } = schema;

const userPatchSchema = z.object({ isAdmin: z.boolean() });

/** Settings shown to admins — secrets are masked, never echoed back. */
function publicSettings(s: Awaited<ReturnType<typeof getSettings>>) {
  const { anthropicApiKey, githubClientSecret, ...rest } = s;
  const hasAnthropicKey = !!anthropicApiKey || !!process.env.ANTHROPIC_API_KEY;
  return {
    ...rest,
    hasAnthropicKey,
    anthropicKeySource: anthropicApiKey ? "settings" : process.env.ANTHROPIC_API_KEY ? "environment" : null,
    /** What actually runs: local AI is the default; Claude only with a key + the toggle on. */
    effectiveLabeling: s.aiLabeling && hasAnthropicKey ? "claude" : "local",
    hasGithubSecret: !!githubClientSecret,
    githubOauthReady: !!(s.githubClientId && githubClientSecret),
  };
}

export function registerAdminRoutes(app: FastifyInstance, db: Db): void {
  app.get("/api/admin/settings", async (req, reply) => {
    if (!(await requireAdmin(db, req, reply))) return;
    return publicSettings(await getSettings(db));
  });

  app.put("/api/admin/settings", async (req, reply) => {
    if (!(await requireAdmin(db, req, reply))) return;
    const parsed = instanceSettingsSchema.partial().safeParse(req.body);
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      return reply.code(400).send({ error: `${issue?.path.join(".")}: ${issue?.message}` });
    }
    const patch = { ...parsed.data };
    // Saving a key is an explicit opt-in to Claude labeling (unless stated otherwise).
    if (typeof patch.anthropicApiKey === "string" && patch.aiLabeling === undefined) patch.aiLabeling = true;
    const next = await updateSettings(db, patch);
    return publicSettings(next);
  });

  app.get("/api/admin/users", async (req, reply) => {
    if (!(await requireAdmin(db, req, reply))) return;
    const rows = await db.select().from(users).orderBy(users.createdAt);
    const counts = await db
      .select({ ownerId: collections.ownerId, count: sql<number>`count(*)::int` })
      .from(collections)
      .groupBy(collections.ownerId);
    const countByOwner = new Map(counts.map((c) => [c.ownerId, Number(c.count)]));
    return rows.map((u) => ({
      id: u.id,
      email: u.email,
      name: u.name,
      handle: u.handle,
      createdAt: u.createdAt,
      isAdmin: u.isAdmin === "true",
      profilePublic: u.profilePublic === "true",
      collectionCount: countByOwner.get(u.id) ?? 0,
    }));
  });

  app.patch<{ Params: { id: string } }>("/api/admin/users/:id", async (req, reply) => {
    const admin = await requireAdmin(db, req, reply);
    if (!admin) return;
    const parsed = userPatchSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: "isAdmin (boolean) required" });
    if (req.params.id === admin.id && !parsed.data.isAdmin) {
      return reply.code(400).send({ error: "You cannot revoke your own admin access" });
    }
    const [target] = await db.select().from(users).where(eq(users.id, req.params.id));
    if (!target) return reply.code(404).send({ error: "User not found" });
    await db.update(users).set({ isAdmin: parsed.data.isAdmin ? "true" : "false" }).where(eq(users.id, target.id));
    return { ok: true };
  });

  /** Issue a fresh recovery code for a user (hand it to them out-of-band). */
  app.post<{ Params: { id: string } }>("/api/admin/users/:id/recovery-code", async (req, reply) => {
    if (!(await requireAdmin(db, req, reply))) return;
    const [target] = await db.select().from(users).where(eq(users.id, req.params.id));
    if (!target) return reply.code(404).send({ error: "User not found" });
    const { rotateRecoveryCode } = await import("./auth.js");
    const recoveryCode = await rotateRecoveryCode(db, target.id);
    return { recoveryCode };
  });

  /** Delete a user; their collections transfer to the acting admin. */
  app.delete<{ Params: { id: string } }>("/api/admin/users/:id", async (req, reply) => {
    const admin = await requireAdmin(db, req, reply);
    if (!admin) return;
    if (req.params.id === admin.id) return reply.code(400).send({ error: "You cannot delete your own account" });
    const [target] = await db.select().from(users).where(eq(users.id, req.params.id));
    if (!target) return reply.code(404).send({ error: "User not found" });
    await db.update(collections).set({ ownerId: admin.id }).where(eq(collections.ownerId, target.id));
    await db.delete(authSessions).where(eq(authSessions.userId, target.id));
    await db.delete(users).where(eq(users.id, target.id));
    return { ok: true, collectionsTransferredTo: admin.email };
  });
}
