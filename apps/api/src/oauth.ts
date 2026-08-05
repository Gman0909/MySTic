import { randomBytes, randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { eq, sql } from "drizzle-orm";
import { createSession, OAUTH_ONLY, webBaseUrl } from "./auth.js";
import { schema, type Db } from "./db/index.js";
import { env } from "./env.js";
import { getSettings } from "./settings.js";

const { users, collections } = schema;

/** Short-lived anti-CSRF state for the OAuth round-trip. */
const pendingStates = new Map<string, number>();

function apiBaseUrl(db: Db): Promise<string> {
  // The API's own public URL for the callback; derived from the web publicUrl
  // convention (api.<domain>) is too magical — use an env override or localhost.
  return Promise.resolve(process.env.API_PUBLIC_URL ?? `http://localhost:${env.port}`);
}

export function registerOauthRoutes(app: FastifyInstance, db: Db): void {
  app.get("/api/auth/oauth/github", async (req, reply) => {
    const s = await getSettings(db);
    if (!s.githubClientId || !s.githubClientSecret) {
      return reply.code(404).send({ error: "GitHub sign-in is not configured on this instance" });
    }
    const state = randomBytes(16).toString("hex");
    pendingStates.set(state, Date.now() + 10 * 60_000);
    for (const [k, exp] of pendingStates) if (exp < Date.now()) pendingStates.delete(k);
    const params = new URLSearchParams({
      client_id: s.githubClientId,
      redirect_uri: `${await apiBaseUrl(db)}/api/auth/oauth/github/callback`,
      scope: "user:email",
      state,
    });
    return reply.redirect(`https://github.com/login/oauth/authorize?${params}`);
  });

  app.get<{ Querystring: { code?: string; state?: string; error?: string } }>(
    "/api/auth/oauth/github/callback",
    async (req, reply) => {
      const web = await webBaseUrl(db);
      const fail = (message: string) => reply.redirect(`${web}/login#oauth_error=${encodeURIComponent(message)}`);
      try {
        const { code, state, error } = req.query;
        if (error) return fail(`GitHub: ${error}`);
        if (!code || !state || !pendingStates.has(state)) return fail("Sign-in expired — try again");
        pendingStates.delete(state);

        const s = await getSettings(db);
        if (!s.githubClientId || !s.githubClientSecret) return fail("GitHub sign-in is not configured");

        const tokenRes = await fetch("https://github.com/login/oauth/access_token", {
          method: "POST",
          headers: { accept: "application/json", "content-type": "application/json" },
          body: JSON.stringify({ client_id: s.githubClientId, client_secret: s.githubClientSecret, code }),
        });
        const tokenJson = (await tokenRes.json()) as { access_token?: string; error_description?: string };
        if (!tokenJson.access_token) return fail(tokenJson.error_description ?? "Token exchange failed");

        const gh = { authorization: `Bearer ${tokenJson.access_token}`, accept: "application/vnd.github+json" };
        const ghUser = (await (await fetch("https://api.github.com/user", { headers: gh })).json()) as {
          login?: string;
          name?: string | null;
          email?: string | null;
        };
        let email = ghUser.email ?? null;
        if (!email) {
          const emails = (await (await fetch("https://api.github.com/user/emails", { headers: gh })).json()) as {
            email: string;
            primary: boolean;
            verified: boolean;
          }[];
          email = emails.find((e) => e.primary && e.verified)?.email ?? emails.find((e) => e.verified)?.email ?? null;
        }
        if (!email) return fail("Your GitHub account has no verified email address");
        email = email.toLowerCase();

        let [user] = await db.select().from(users).where(eq(users.email, email));
        if (!user) {
          const [{ count }] = await db.select({ count: sql<number>`count(*)::int` }).from(users);
          const isFirst = Number(count) === 0;
          if (!isFirst && !s.allowRegistration) return fail("Registration is disabled on this instance");
          const id = randomUUID();
          await db.insert(users).values({
            id,
            email,
            name: ghUser.name ?? ghUser.login ?? email.split("@")[0]!,
            passwordHash: OAUTH_ONLY,
            isAdmin: isFirst ? "true" : "false",
          });
          if (isFirst) {
            const { isNull } = await import("drizzle-orm");
            await db.update(collections).set({ ownerId: id }).where(isNull(collections.ownerId));
          }
          [user] = await db.select().from(users).where(eq(users.id, id));
        }

        const session = await createSession(db, user!.id);
        return reply.redirect(`${web}/login#token=${session.token}`);
      } catch (err) {
        console.error("[oauth]", err);
        return fail("Sign-in failed — try again");
      }
    },
  );
}
