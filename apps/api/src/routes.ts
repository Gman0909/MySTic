import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { asc, desc, eq } from "drizzle-orm";
import { createSiteSchema, searchQuerySchema } from "@mystic/core";
import { discoverSite, normalizeSiteUrl, NotAMystSiteError } from "@mystic/crawler";
import { embedQuery } from "@mystic/ontology";
import { requireAdmin } from "./auth.js";
import { schema, type Db } from "./db/index.js";
import type { JobRunner } from "./jobs.js";
import { rebuildOntology } from "./ontology.js";
import { searchSections } from "./search.js";

const { sites, crawlJobs, concepts, sections } = schema;

export function registerRoutes(app: FastifyInstance, db: Db, jobs: JobRunner): void {
  app.get("/api/health", async () => ({ ok: true }));

  app.get("/api/sites", async () => {
    return db.select().from(sites).orderBy(desc(sites.createdAt));
  });

  app.post("/api/sites", async (req, reply) => {
    if (!(await requireAdmin(db, req, reply))) return;
    const parsed = createSiteSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.issues[0]?.message ?? "Invalid body" });
    const url = normalizeSiteUrl(parsed.data.url);

    const [existing] = await db.select().from(sites).where(eq(sites.url, url));
    if (existing) return reply.code(409).send({ error: "Site already registered", site: existing });

    try {
      await discoverSite(url);
    } catch (err) {
      if (err instanceof NotAMystSiteError) return reply.code(422).send({ error: err.message });
      return reply.code(502).send({ error: `Could not reach site: ${(err as Error).message}` });
    }

    const id = randomUUID();
    await db.insert(sites).values({ id, url, status: "pending" });
    await jobs.enqueueCrawl(id);
    const [site] = await db.select().from(sites).where(eq(sites.id, id));
    return reply.code(201).send(site);
  });

  app.post<{ Params: { id: string }; Querystring: { force?: string } }>("/api/sites/:id/crawl", async (req, reply) => {
    if (!(await requireAdmin(db, req, reply))) return;
    const [site] = await db.select().from(sites).where(eq(sites.id, req.params.id));
    if (!site) return reply.code(404).send({ error: "Site not found" });
    const jobId = await jobs.enqueueCrawl(site.id, req.query.force === "true");
    return { jobId };
  });

  app.delete<{ Params: { id: string } }>("/api/sites/:id", async (req, reply) => {
    if (!(await requireAdmin(db, req, reply))) return;
    const [site] = await db.select().from(sites).where(eq(sites.id, req.params.id));
    if (!site) return reply.code(404).send({ error: "Site not found" });
    await jobs.deleteSite(site.id);
    return { deleted: true };
  });

  app.get<{ Querystring: { siteId?: string } }>("/api/jobs", async (req) => {
    const q = db.select().from(crawlJobs);
    const rows = req.query.siteId
      ? await q.where(eq(crawlJobs.siteId, req.query.siteId)).orderBy(desc(crawlJobs.createdAt)).limit(20)
      : await q.orderBy(desc(crawlJobs.createdAt)).limit(20);
    return rows;
  });

  app.get("/api/search", async (req, reply) => {
    const parsed = searchQuerySchema.safeParse(req.query);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.issues[0]?.message ?? "Invalid query" });
    const { q, site, tags, author, mode, limit, offset } = parsed.data;
    const queryVector = mode === "hybrid" && q.trim() ? await embedQuery(q) : undefined;
    const result = await searchSections({ q, siteId: site, tag: tags, author, limit, offset, queryVector });
    return {
      hits: result.hits,
      estimatedTotalHits: result.estimatedTotalHits,
      facets: result.facetDistribution ?? {},
      processingTimeMs: result.processingTimeMs,
      mode: queryVector ? "hybrid" : "keyword",
    };
  });

  // Knowledge tree: top-level concepts with nested children.
  app.get("/api/tree", async () => {
    const all = await db.select().from(concepts).orderBy(desc(concepts.sectionCount));
    const roots = all.filter((c) => !c.parentId);
    return roots.map((root) => ({
      ...root,
      children: all.filter((c) => c.parentId === root.id),
    }));
  });

  app.get<{ Params: { id: string } }>("/api/concepts/:id/sections", async (req, reply) => {
    const [concept] = await db.select().from(concepts).where(eq(concepts.id, req.params.id));
    if (!concept) return reply.code(404).send({ error: "Concept not found" });
    // A parent concept's sections live on its children; a leaf holds its own.
    const children = await db.select().from(concepts).where(eq(concepts.parentId, concept.id));
    const conceptIds = children.length ? children.map((c) => c.id) : [concept.id];
    const rows = [];
    for (const cid of conceptIds) {
      rows.push(
        ...(await db
          .select({
            id: sections.id,
            siteId: sections.siteId,
            slug: sections.slug,
            url: sections.url,
            title: sections.title,
            headingPath: sections.headingPath,
          })
          .from(sections)
          .where(eq(sections.conceptId, cid))
          .orderBy(asc(sections.title))
          .limit(200)),
      );
    }
    return { concept, sections: rows.slice(0, 400) };
  });

  app.post("/api/ontology/rebuild", async (req, reply) => {
    if (!(await requireAdmin(db, req, reply))) return;
    return rebuildOntology(db);
  });
}
