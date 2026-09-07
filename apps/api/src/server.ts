import Fastify from "fastify";
import cors from "@fastify/cors";
import { registerAdminRoutes } from "./admin.js";
import { registerAuthRoutes } from "./auth.js";
import { registerOauthRoutes } from "./oauth.js";
import { registerCollectionRoutes } from "./collections.js";
import { registerContentRoutes } from "./content.js";
import { registerMystSiteRoutes } from "./mystsite.js";
import { createDb, migrate } from "./db/index.js";
import { env } from "./env.js";
import { JobRunner } from "./jobs.js";
import { registerRoutes } from "./routes.js";
import { ensureIndexes } from "./search.js";

/** First boot on a fresh install: import the bundled site list and crawl it. */
async function seedSites(db: Awaited<ReturnType<typeof createDb>>, jobs: JobRunner) {
  if (process.env.MYSTIC_SKIP_SEED) return; // CI smoke tests skip the crawl
  const { schema } = await import("./db/index.js");
  const existing = await db.select().from(schema.sites);
  if (existing.length > 0) return;
  const { readFileSync, existsSync } = await import("node:fs");
  const { fileURLToPath } = await import("node:url");
  const { join, dirname } = await import("node:path");
  const seedPath = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "seed", "sites.json");
  if (!existsSync(seedPath)) return;
  const seeds = JSON.parse(readFileSync(seedPath, "utf8")) as { url: string; title?: string }[];
  console.log(`[seed] importing ${seeds.length} sites from seed/sites.json`);
  const { randomUUID } = await import("node:crypto");
  for (const s of seeds) {
    const id = randomUUID();
    await db.insert(schema.sites).values({ id, url: s.url.replace(/\/+$/, ""), title: s.title ?? null, status: "pending" });
    await jobs.enqueueCrawl(id);
  }
}

async function main() {
  const db = await createDb();
  await migrate(db);
  await ensureIndexes();

  const app = Fastify({ logger: { level: "info" } });
  await app.register(cors, { origin: env.corsOrigins ?? true });
  const jobs = new JobRunner(db);
  void seedSites(db, jobs).catch((err) => console.error("[seed]", err));
  registerAuthRoutes(app, db);
  registerOauthRoutes(app, db);
  registerAdminRoutes(app, db);
  registerRoutes(app, db, jobs);
  registerCollectionRoutes(app, db);
  registerContentRoutes(app, db);
  registerMystSiteRoutes(app, db);

  // Scheduled recrawls: hourly sweep re-queues sites older than the configured
  // interval (admin-settable, min 6h — see settings.ts).
  //
  // Sites in `error` are swept too. A crawl can fail for a moment — a dropped
  // connection is enough — and a site that is only retried by hand stays frozen
  // at whatever it last indexed, quietly serving stale metadata. Their retry is
  // paced off the last attempt rather than the last success, which for an
  // errored site is old or absent.
  setInterval(async () => {
    try {
      const { schema } = await import("./db/index.js");
      const { getSettings } = await import("./settings.js");
      const { desc, eq } = await import("drizzle-orm");
      const recrawlAfterMs = (await getSettings(db)).recrawlHours * 3600_000;
      const all = await db.select().from(schema.sites);
      for (const site of all) {
        if (site.status !== "ready" && site.status !== "error") continue;
        let last = site.lastCrawledAt ? new Date(site.lastCrawledAt).getTime() : 0;
        if (site.status === "error") {
          const [latest] = await db
            .select()
            .from(schema.crawlJobs)
            .where(eq(schema.crawlJobs.siteId, site.id))
            .orderBy(desc(schema.crawlJobs.createdAt))
            .limit(1);
          const attempted = latest?.finishedAt ?? latest?.createdAt;
          last = attempted ? new Date(attempted).getTime() : 0;
        }
        if (Date.now() - last > recrawlAfterMs) {
          console.log(`[scheduler] recrawling ${site.url}${site.status === "error" ? " (retrying after error)" : ""}`);
          await jobs.enqueueCrawl(site.id);
        }
      }
    } catch (err) {
      console.error("[scheduler]", err);
    }
  }, 3600_000).unref();

  await app.listen({ port: env.port, host: "0.0.0.0" });
  console.log(`MySTic API listening on :${env.port} (db: ${env.databaseUrl ? "postgres" : "pglite"}, meili: ${env.meiliUrl})`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
