import { randomBytes, randomUUID, scryptSync, timingSafeEqual } from "node:crypto";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { and, eq, isNull, lt, sql } from "drizzle-orm";
import { z } from "zod";
import { schema, type Db } from "./db/index.js";
import { getSettings } from "./settings.js";

const { users, authSessions, collections } = schema;

const SESSION_DAYS = 30;

const credentialsSchema = z.object({
  email: z.string().email().max(200),
  password: z.string().min(8).max(200),
  name: z.string().min(1).max(100).optional(),
});

function hashPassword(password: string): string {
  const salt = randomBytes(16).toString("hex");
  return `${salt}:${scryptSync(password, salt, 64).toString("hex")}`;
}

function verifyPassword(password: string, stored: string): boolean {
  const [salt, hash] = stored.split(":");
  if (!salt || !hash) return false;
  const candidate = scryptSync(password, salt, 64);
  return timingSafeEqual(candidate, Buffer.from(hash, "hex"));
}

export interface AuthUser {
  id: string;
  email: string;
  name: string;
  isAdmin: boolean;
}

/** Resolve the Bearer token to a user, or null. */
export async function getUser(db: Db, req: FastifyRequest): Promise<AuthUser | null> {
  const header = req.headers.authorization;
  if (!header?.startsWith("Bearer ")) return null;
  const token = header.slice(7);
  const [session] = await db.select().from(authSessions).where(eq(authSessions.token, token));
  if (!session || new Date(session.expiresAt).getTime() < Date.now()) return null;
  const [user] = await db.select().from(users).where(eq(users.id, session.userId));
  if (!user) return null;
  return { id: user.id, email: user.email, name: user.name, isAdmin: user.isAdmin === "true" };
}

export async function requireUser(db: Db, req: FastifyRequest, reply: FastifyReply): Promise<AuthUser | null> {
  const user = await getUser(db, req);
  if (!user) {
    await reply.code(401).send({ error: "Sign in required" });
    return null;
  }
  return user;
}

export async function requireAdmin(db: Db, req: FastifyRequest, reply: FastifyReply): Promise<AuthUser | null> {
  const user = await getUser(db, req);
  if (!user) {
    await reply.code(401).send({ error: "Sign in required" });
    return null;
  }
  if (!user.isAdmin) {
    await reply.code(403).send({ error: "Admin access required" });
    return null;
  }
  return user;
}

async function createSession(db: Db, userId: string) {
  const token = randomBytes(32).toString("hex");
  const expiresAt = new Date(Date.now() + SESSION_DAYS * 86_400_000).toISOString();
  await db.delete(authSessions).where(lt(authSessions.expiresAt, new Date().toISOString()));
  await db.insert(authSessions).values({ token, userId, expiresAt });
  return { token, expiresAt };
}

export function registerAuthRoutes(app: FastifyInstance, db: Db): void {
  app.post("/api/auth/register", async (req, reply) => {
    const parsed = credentialsSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.issues[0]?.message ?? "Invalid input" });
    const { email, password, name } = parsed.data;

    const [existing] = await db.select().from(users).where(eq(users.email, email.toLowerCase()));
    if (existing) return reply.code(409).send({ error: "An account with this email already exists" });

    const [{ count }] = (await db.execute(sql`SELECT count(*)::int AS count FROM users`)).rows as { count: number }[];
    const isFirst = count === 0;
    if (!isFirst && !(await getSettings(db)).allowRegistration) {
      return reply.code(403).send({ error: "Registration is disabled on this instance" });
    }

    const id = randomUUID();
    await db.insert(users).values({
      id,
      email: email.toLowerCase(),
      name: name ?? email.split("@")[0]!,
      passwordHash: hashPassword(password),
      isAdmin: isFirst ? "true" : "false",
    });
    // Self-hosted bootstrap: the first account becomes admin and adopts any
    // collections created before accounts existed.
    if (isFirst) await db.update(collections).set({ ownerId: id }).where(isNull(collections.ownerId));

    const session = await createSession(db, id);
    return reply.code(201).send({
      token: session.token,
      user: { id, email: email.toLowerCase(), name: name ?? email.split("@")[0], isAdmin: isFirst },
    });
  });

  app.post("/api/auth/login", async (req, reply) => {
    const parsed = credentialsSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: "Invalid email or password" });
    const [user] = await db.select().from(users).where(eq(users.email, parsed.data.email.toLowerCase()));
    if (!user || !verifyPassword(parsed.data.password, user.passwordHash)) {
      return reply.code(401).send({ error: "Invalid email or password" });
    }
    const session = await createSession(db, user.id);
    return {
      token: session.token,
      user: { id: user.id, email: user.email, name: user.name, isAdmin: user.isAdmin === "true" },
    };
  });

  app.post("/api/auth/logout", async (req) => {
    const header = req.headers.authorization;
    if (header?.startsWith("Bearer ")) {
      await db.delete(authSessions).where(eq(authSessions.token, header.slice(7)));
    }
    return { ok: true };
  });

  app.get("/api/auth/me", async (req, reply) => {
    const user = await getUser(db, req);
    if (!user) return reply.code(401).send({ error: "Not signed in" });
    const [row] = await db.select().from(users).where(eq(users.id, user.id));
    return { ...user, handle: row?.handle ?? null, profilePublic: row?.profilePublic === "true" };
  });

  const profileSchema = z.object({
    handle: z
      .string()
      .regex(/^[a-z0-9][a-z0-9-]{2,29}$/, "3-30 chars: lowercase letters, digits, hyphens")
      .nullable()
      .optional(),
    profilePublic: z.boolean().optional(),
  });

  app.patch("/api/auth/profile", async (req, reply) => {
    const user = await getUser(db, req);
    if (!user) return reply.code(401).send({ error: "Sign in required" });
    const parsed = profileSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.issues[0]?.message });
    const updates: Record<string, string | null> = {};
    if (parsed.data.handle !== undefined) {
      if (parsed.data.handle) {
        const [taken] = await db
          .select()
          .from(users)
          .where(and(eq(users.handle, parsed.data.handle), sql`${users.id} != ${user.id}`));
        if (taken) return reply.code(409).send({ error: "That handle is taken" });
      }
      updates.handle = parsed.data.handle;
    }
    if (parsed.data.profilePublic !== undefined) updates.profilePublic = parsed.data.profilePublic ? "true" : "false";
    if (Object.keys(updates).length) await db.update(users).set(updates).where(eq(users.id, user.id));
    const [row] = await db.select().from(users).where(eq(users.id, user.id));
    return { ...user, handle: row?.handle ?? null, profilePublic: row?.profilePublic === "true" };
  });

  /** Public profile: the user's public collections, if they opted in. */
  app.get<{ Params: { handle: string } }>("/api/users/:handle", async (req, reply) => {
    const [row] = await db.select().from(users).where(eq(users.handle, req.params.handle));
    if (!row || row.profilePublic !== "true") return reply.code(404).send({ error: "Profile not found" });
    const cols = await db
      .select()
      .from(collections)
      .where(and(eq(collections.ownerId, row.id), eq(collections.visibility, "public")));
    return {
      name: row.name,
      handle: row.handle,
      collections: cols.map((c) => ({ slug: c.slug, name: c.name, description: c.description, updatedAt: c.updatedAt })),
    };
  });
}
