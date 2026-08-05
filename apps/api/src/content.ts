import type { FastifyInstance } from "fastify";
import { and, eq } from "drizzle-orm";
import type { MystFrontmatter, MystNode } from "@mystic/core";
import { schema, type Db } from "./db/index.js";
import { getSettings } from "./settings.js";

const { sites, pages } = schema;

interface CachedPage {
  mdast: MystNode;
  frontmatter: MystFrontmatter;
  sha256: string;
  fetchedAt: number;
}

/** In-memory stale-while-revalidate cache of upstream page ASTs. */
const cache = new Map<string, CachedPage>();

async function fetchUpstream(siteUrl: string, slug: string): Promise<CachedPage> {
  const url = `${siteUrl}/${slug}.json`;
  const res = await fetch(url, {
    headers: { "user-agent": "MySTic-live/0.1", accept: "application/json" },
    redirect: "follow",
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) throw new Error(`GET ${url} -> ${res.status}`);
  const page = (await res.json()) as { mdast: MystNode; frontmatter: MystFrontmatter; sha256: string };
  return { mdast: page.mdast, frontmatter: page.frontmatter ?? {}, sha256: page.sha256, fetchedAt: Date.now() };
}

export function registerContentRoutes(app: FastifyInstance, db: Db): void {
  /**
   * Live page content for collection rendering. Upstream is fetched with a
   * short TTL so upstream edits appear within minutes without a recrawl; if
   * upstream is unreachable, the crawler's cached AST is served with a flag.
   */
  app.get<{ Params: { siteId: string; "*": string } }>("/api/content/:siteId/*", async (req, reply) => {
    const slug = req.params["*"].replace(/^\/+|\/+$/g, "");
    if (!slug) return reply.code(400).send({ error: "Missing page slug" });
    const [site] = await db.select().from(sites).where(eq(sites.id, req.params.siteId));
    if (!site) return reply.code(404).send({ error: "Site not found" });

    const ttlMs = (await getSettings(db)).contentTtlMinutes * 60_000;
    const key = `${site.id}\n${slug}`;
    const cached = cache.get(key);
    if (cached && Date.now() - cached.fetchedAt < ttlMs) {
      return reply.send(shape(site, slug, cached, "live"));
    }

    try {
      const fresh = await fetchUpstream(site.url, slug);
      cache.set(key, fresh);
      return reply.send(shape(site, slug, fresh, "live"));
    } catch {
      if (cached) return reply.send(shape(site, slug, cached, "stale-cache"));
      const [row] = await db
        .select()
        .from(pages)
        .where(and(eq(pages.siteId, site.id), eq(pages.slug, slug)));
      if (!row?.ast) return reply.code(502).send({ error: "Upstream unreachable and no cached copy exists" });
      return reply.send(
        shape(
          site,
          slug,
          {
            mdast: row.ast as MystNode,
            frontmatter: (row.frontmatter ?? {}) as MystFrontmatter,
            sha256: row.sha256,
            fetchedAt: new Date(row.lastSeenAt).getTime(),
          },
          "crawler-cache",
        ),
      );
    }
  });
}

function shape(
  site: { id: string; url: string; title: string | null },
  slug: string,
  page: CachedPage,
  source: "live" | "stale-cache" | "crawler-cache",
) {
  return {
    siteId: site.id,
    siteTitle: site.title ?? site.url,
    siteUrl: site.url,
    pageSlug: slug,
    pageUrl: `${site.url}/${slug}`,
    mdast: page.mdast,
    frontmatter: page.frontmatter,
    source,
    fetchedAt: new Date(page.fetchedAt).toISOString(),
  };
}
