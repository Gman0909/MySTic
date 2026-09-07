import type { FastifyInstance } from "fastify";
import { and, eq } from "drizzle-orm";
import {
  authorNames,
  licenseName,
  materializeOutputs,
  sliceSection,
  type MystFrontmatter,
  type MystNode,
} from "@mystic/core";
import { schema, type Db } from "./db/index.js";
import { getSettings } from "./settings.js";

const { collections, collectionNodes, sites, pages } = schema;

interface CachedPage {
  mdast: MystNode;
  frontmatter: MystFrontmatter;
  sha256: string;
  fetchedAt: number;
}

export type ContentSource = "live" | "stale-cache" | "crawler-cache";

export interface LoadedPage {
  site: { id: string; url: string; title: string | null };
  slug: string;
  /** Absolute public URL of the page on the source site. */
  pageUrl: string;
  page: CachedPage;
  source: ContentSource;
}

/**
 * The page's public URL on its source site.
 *
 * A page's slug is the name of its *data file* ("core.numpy.intermediate-numpy"),
 * which is not the path it is served at ("/core/numpy/intermediate-numpy").
 * The crawler records the real path from the xref index, so use that; only fall
 * back to the slug for a page this instance has never crawled.
 */
async function publicUrl(db: Db, site: { id: string; url: string }, slug: string): Promise<string> {
  const [row] = await db
    .select({ url: pages.url })
    .from(pages)
    .where(and(eq(pages.siteId, site.id), eq(pages.slug, slug)));
  const path = row?.url ?? `/${slug}`;
  return `${site.url}${path.startsWith("/") ? "" : "/"}${path}`;
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

/**
 * Fetch a page of a registered site, live where possible. Upstream is fetched
 * with a short TTL so upstream edits appear within minutes without a recrawl;
 * if upstream is unreachable, the crawler's cached AST is served instead.
 * Returns null when the site is unknown or no copy of the page exists at all.
 */
export async function loadLivePage(db: Db, siteId: string, slug: string): Promise<LoadedPage | null> {
  const [site] = await db.select().from(sites).where(eq(sites.id, siteId));
  if (!site) return null;

  const ttlMs = (await getSettings(db)).contentTtlMinutes * 60_000;
  const pageUrl = await publicUrl(db, site, slug);
  const key = `${site.id}\n${slug}`;
  const cached = cache.get(key);
  if (cached && Date.now() - cached.fetchedAt < ttlMs) return { site, slug, pageUrl, page: cached, source: "live" };

  try {
    const fresh = await fetchUpstream(site.url, slug);
    cache.set(key, fresh);
    return { site, slug, pageUrl, page: fresh, source: "live" };
  } catch {
    if (cached) return { site, slug, pageUrl, page: cached, source: "stale-cache" };
    const [row] = await db
      .select()
      .from(pages)
      .where(and(eq(pages.siteId, site.id), eq(pages.slug, slug)));
    if (!row?.ast) return null;
    return {
      site,
      slug,
      pageUrl,
      page: {
        mdast: row.ast as MystNode,
        frontmatter: (row.frontmatter ?? {}) as MystFrontmatter,
        sha256: row.sha256,
        fetchedAt: new Date(row.lastSeenAt).getTime(),
      },
      source: "crawler-cache",
    };
  }
}

/**
 * The AST an embed should carry: one section when an anchor is given, the
 * whole page otherwise. An anchor that matches no heading falls back to the
 * whole page — `found` says so, since silently embedding an entire page in
 * place of the requested section is worth warning about.
 */
export function embedAst(loaded: LoadedPage, anchor: string | null): { mdast: MystNode; found: boolean } {
  if (!anchor) return { mdast: loaded.page.mdast, found: true };
  const slice = sliceSection(loaded.page.mdast, anchor);
  return { mdast: slice ?? loaded.page.mdast, found: slice !== null };
}

/** Everything a consumer needs to credit the source of an embedded fragment. */
export function attributionOf(loaded: LoadedPage, anchor: string | null) {
  const { pageUrl } = loaded;
  return {
    siteTitle: loaded.site.title ?? loaded.site.url,
    siteUrl: loaded.site.url,
    pageTitle: (loaded.page.frontmatter.title as string | undefined) ?? loaded.slug,
    pageUrl,
    sourceUrl: anchor ? `${pageUrl}#${anchor}` : pageUrl,
    authors: authorNames(loaded.page.frontmatter),
    license: licenseName(loaded.page.frontmatter),
  };
}

export function registerContentRoutes(app: FastifyInstance, db: Db): void {
  /** Live page content for collection rendering. */
  app.get<{ Params: { siteId: string; "*": string } }>("/api/content/:siteId/*", async (req, reply) => {
    const slug = req.params["*"].replace(/^\/+|\/+$/g, "");
    if (!slug) return reply.code(400).send({ error: "Missing page slug" });
    const loaded = await loadLivePage(db, req.params.siteId, slug);
    if (!loaded) {
      const [site] = await db.select().from(sites).where(eq(sites.id, req.params.siteId));
      if (!site) return reply.code(404).send({ error: "Site not found" });
      return reply.code(502).send({ error: "Upstream unreachable and no cached copy exists" });
    }
    return reply.send(shape(loaded));
  });

  /**
   * A single fragment, ready to splice into someone else's MyST build. Same
   * live/cached semantics as /api/content, but pre-sliced to the anchor and
   * accompanied by the attribution the embedder is expected to display.
   */
  app.get<{ Params: { siteId: string; "*": string }; Querystring: { anchor?: string } }>(
    "/api/embed/:siteId/*",
    async (req, reply) => {
      const slug = req.params["*"].replace(/^\/+|\/+$/g, "");
      if (!slug) return reply.code(400).send({ error: "Missing page slug" });
      const loaded = await loadLivePage(db, req.params.siteId, slug);
      if (!loaded) return reply.code(404).send({ error: "No content for that site and page" });
      const anchor = req.query.anchor || null;
      return reply.send(shapeEmbed(loaded, anchor));
    },
  );

  /**
   * The same, addressed by the source page's own public URL (optionally with a
   * `#anchor`) — the form a curator has in hand after browsing the source site.
   * Only sites registered on this instance resolve.
   */
  app.get<{ Querystring: { url?: string } }>("/api/embed/resolve", async (req, reply) => {
    const raw = req.query.url;
    if (!raw) return reply.code(400).send({ error: "Missing url" });
    let target: URL;
    try {
      target = new URL(raw);
    } catch {
      return reply.code(400).send({ error: "Not a URL" });
    }
    const anchor = target.hash ? target.hash.slice(1) : null;
    const clean = `${target.origin}${target.pathname}`.replace(/\/+$/, "");
    const all = await db.select().from(sites);
    // Longest prefix wins: sites can be nested (example.org and example.org/guide).
    const site = all
      .filter((s) => clean === s.url || clean.startsWith(`${s.url}/`))
      .sort((a, b) => b.url.length - a.url.length)[0];
    if (!site) {
      return reply.code(404).send({ error: `No site registered on this instance covers ${clean}` });
    }
    const slug = clean.slice(site.url.length).replace(/^\/+/, "") || "index";
    const loaded = await loadLivePage(db, site.id, slug);
    if (!loaded) return reply.code(404).send({ error: `No content for ${clean}` });
    return reply.send(shapeEmbed(loaded, anchor));
  });

  /**
   * The same, addressed by collection node — the form a curator can copy
   * straight off a collection page without knowing site ids.
   */
  app.get<{ Params: { slug: string; nodeId: string } }>("/api/embed/c/:slug/:nodeId", async (req, reply) => {
    const [coll] = await db.select().from(collections).where(eq(collections.slug, req.params.slug));
    if (!coll || coll.visibility === "private") return reply.code(404).send({ error: "Collection not found" });
    const [node] = await db
      .select()
      .from(collectionNodes)
      .where(and(eq(collectionNodes.id, req.params.nodeId), eq(collectionNodes.collectionId, coll.id)));
    if (!node || !node.siteId || !node.pageSlug) return reply.code(404).send({ error: "No such item in this collection" });
    const loaded = await loadLivePage(db, node.siteId, node.pageSlug);
    if (!loaded) return reply.code(404).send({ error: "No content for that item" });
    const anchor = node.kind === "section" ? node.anchor : null;
    return reply.send({ ...shapeEmbed(loaded, anchor), title: node.title ?? undefined });
  });
}

function shape(loaded: LoadedPage) {
  const { site, slug, pageUrl, page, source } = loaded;
  return {
    siteId: site.id,
    siteTitle: site.title ?? site.url,
    siteUrl: site.url,
    pageSlug: slug,
    pageUrl,
    mdast: page.mdast,
    frontmatter: page.frontmatter,
    source,
    fetchedAt: new Date(page.fetchedAt).toISOString(),
  };
}

function shapeEmbed(loaded: LoadedPage, anchor: string | null) {
  const { mdast, found } = embedAst(loaded, anchor);
  return {
    anchor,
    anchorFound: found,
    // Outputs are flattened for consumers that will re-build this AST.
    mdast: materializeOutputs(mdast, loaded.site.url),
    attribution: attributionOf(loaded, anchor),
    source: loaded.source,
    fetchedAt: new Date(loaded.page.fetchedAt).toISOString(),
  };
}
