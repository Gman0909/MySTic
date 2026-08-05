import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { crawlSite } from "@mystic/crawler";
import { embedPassages } from "@mystic/ontology";
import { schema, type Db } from "./db/index.js";
import { rebuildOntology } from "./ontology.js";
import { deletePageDocs, deleteSiteDocs, indexDocs, type VectorizedDoc } from "./search.js";

const { sites, pages, crawlJobs, sections } = schema;

/**
 * Minimal in-process job queue: crawls run one at a time in the API process.
 * The docker-compose deployment runs the same code; a dedicated worker with a
 * durable queue is a planned extraction once load requires it.
 */
export class JobRunner {
  private queue: { jobId: string; siteId: string; force: boolean }[] = [];
  private running = false;

  constructor(private db: Db) {}

  /** `force` re-fetches and re-indexes every page, ignoring stored sha256s. */
  async enqueueCrawl(siteId: string, force = false): Promise<string> {
    const jobId = randomUUID();
    await this.db.insert(crawlJobs).values({ id: jobId, siteId, status: "queued" });
    this.queue.push({ jobId, siteId, force });
    void this.pump();
    return jobId;
  }

  private dirty = false;

  private async pump(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      let item;
      while ((item = this.queue.shift())) {
        await this.runCrawl(item.jobId, item.siteId, item.force).catch((err) =>
          console.error(`crawl job ${item!.jobId} crashed:`, err),
        );
      }
      if (this.dirty) {
        this.dirty = false;
        const result = await rebuildOntology(this.db).catch((err) => {
          console.error("ontology rebuild failed:", err);
          return null;
        });
        if (result) console.log("[ontology]", JSON.stringify(result));
      }
    } finally {
      this.running = false;
    }
  }

  private async log(jobId: string, line: string): Promise<void> {
    console.log(`[crawl ${jobId.slice(0, 8)}] ${line}`);
    const [job] = await this.db.select().from(crawlJobs).where(eq(crawlJobs.id, jobId));
    await this.db
      .update(crawlJobs)
      .set({ log: `${job?.log ?? ""}${line}\n` })
      .where(eq(crawlJobs.id, jobId));
  }

  private async runCrawl(jobId: string, siteId: string, force = false): Promise<void> {
    const db = this.db;
    const [site] = await db.select().from(sites).where(eq(sites.id, siteId));
    if (!site) return;

    const now = () => new Date().toISOString();
    await db.update(crawlJobs).set({ status: "running", startedAt: now() }).where(eq(crawlJobs.id, jobId));
    await db.update(sites).set({ status: "crawling", error: null }).where(eq(sites.id, siteId));

    try {
      // Unchanged pages (same upstream sha256) are skipped entirely.
      const existing = await db.select().from(pages).where(eq(pages.siteId, siteId));
      const shaBySlug = new Map(existing.map((p) => [p.slug, p.sha256]));
      await this.log(jobId, `Crawling ${site.url} (${existing.length} pages known)`);

      const { getSettings } = await import("./settings.js");
      const result = await crawlSite({
        siteId,
        url: site.url,
        concurrency: (await getSettings(db)).crawlConcurrency,
        skipSha256: force ? undefined : (slug) => shaBySlug.get(slug),
      });

      for (const err of result.errors) await this.log(jobId, `WARN ${err.url}: ${err.message}`);
      await this.log(jobId, `${result.pages.length} new/changed pages`);

      const seenSlugs: string[] = [];
      let embedded = 0;
      for (const { page, ref, docs } of result.pages) {
        seenSlugs.push(page.slug);

        // Embed each section (title + heading path gives short sections context).
        const vectors = await embedPassages(docs.map((d) => `${d.headingPath.join(" / ")}\n${d.text}`));
        embedded += vectors.length;
        const vectorized: VectorizedDoc[] = docs.map((d, i) => ({ ...d, _vectors: { default: vectors[i]! } }));

        await deletePageDocs(siteId, page.slug);
        await indexDocs(vectorized);

        const row = {
          siteId,
          slug: page.slug,
          url: ref.url,
          title: page.frontmatter?.title ?? page.slug,
          sha256: page.sha256,
          frontmatter: page.frontmatter,
          ast: page.mdast,
          sectionCount: docs.length,
          lastSeenAt: now(),
        };
        const [prev] = await db
          .select()
          .from(pages)
          .where(and(eq(pages.siteId, siteId), eq(pages.slug, page.slug)));
        let pageId = prev?.id;
        if (prev) await db.update(pages).set(row).where(eq(pages.id, prev.id));
        else await db.insert(pages).values({ id: (pageId = randomUUID()), ...row });

        // Refresh this page's section rows (embeddings feed clustering + tree).
        await db.delete(sections).where(and(eq(sections.siteId, siteId), eq(sections.slug, page.slug)));
        for (let i = 0; i < docs.length; i++) {
          const d = docs[i]!;
          await db.insert(sections).values({
            id: d.id,
            siteId,
            pageId: pageId!,
            slug: page.slug,
            url: d.url,
            title: d.sectionTitle,
            headingPath: d.headingPath,
            text: d.text.slice(0, 4000),
            embedding: vectors[i]!,
          });
        }
      }
      if (embedded) await this.log(jobId, `Embedded ${embedded} sections`);

      // Pages that vanished upstream: drop rows + search docs.
      const liveSlugs = new Set(result.allSlugs);
      const removed = existing.filter((p) => !liveSlugs.has(p.slug) && !seenSlugs.includes(p.slug));
      for (const p of removed) {
        await this.log(jobId, `Removing vanished page ${p.slug}`);
        await deletePageDocs(siteId, p.slug);
        await db.delete(sections).where(and(eq(sections.siteId, siteId), eq(sections.slug, p.slug)));
        await db.delete(pages).where(eq(pages.id, p.id));
      }

      const allPages = await db.select().from(pages).where(eq(pages.siteId, siteId));
      await db
        .update(sites)
        .set({
          status: "ready",
          title: result.siteTitle,
          pageCount: allPages.length,
          lastCrawledAt: now(),
          error: null,
        })
        .where(eq(sites.id, siteId));
      await db.update(crawlJobs).set({ status: "done", finishedAt: now() }).where(eq(crawlJobs.id, jobId));
      await this.log(jobId, `Done: ${allPages.length} pages indexed`);
      if (result.pages.length || removed.length) this.dirty = true;
    } catch (err) {
      const message = (err as Error).message;
      await this.log(jobId, `ERROR ${message}`);
      await db.update(sites).set({ status: "error", error: message }).where(eq(sites.id, siteId));
      await db.update(crawlJobs).set({ status: "error", finishedAt: now() }).where(eq(crawlJobs.id, jobId));
    }
  }

  async deleteSite(siteId: string): Promise<void> {
    await deleteSiteDocs(siteId);
    await this.db.delete(sections).where(eq(sections.siteId, siteId));
    await this.db.delete(pages).where(eq(pages.siteId, siteId));
    await this.db.delete(crawlJobs).where(eq(crawlJobs.siteId, siteId));
    await this.db.delete(sites).where(eq(sites.id, siteId));
    this.dirty = true;
    void this.pump();
  }
}
