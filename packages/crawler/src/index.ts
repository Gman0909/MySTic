import { createHash } from "node:crypto";
import {
  authorNames,
  extractSections,
  licenseName,
  pageTags,
  type MystPageJson,
  type SearchDoc,
  type XrefIndex,
  type XrefReference,
} from "@mystic/core";

const USER_AGENT = "MySTic-crawler/0.1 (+https://github.com/mystic)";

export class NotAMystSiteError extends Error {}

/** Strip trailing slashes so URL joining is predictable. */
export function normalizeSiteUrl(url: string): string {
  return url.replace(/\/+$/, "");
}

async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url, { headers: { "user-agent": USER_AGENT, accept: "application/json" }, redirect: "follow" });
  if (!res.ok) throw new Error(`GET ${url} -> ${res.status}`);
  return (await res.json()) as T;
}

/**
 * Confirm the URL is a mystmd-built site by fetching its xref index.
 * Throws NotAMystSiteError when the index is missing or malformed.
 */
export async function discoverSite(url: string): Promise<{ baseUrl: string; xref: XrefIndex }> {
  const baseUrl = normalizeSiteUrl(url);
  let xref: XrefIndex;
  try {
    xref = await fetchJson<XrefIndex>(`${baseUrl}/myst.xref.json`);
  } catch (err) {
    throw new NotAMystSiteError(
      `${baseUrl} does not serve myst.xref.json — it does not look like a mystmd-built site (${(err as Error).message})`,
    );
  }
  if (!Array.isArray(xref.references)) {
    throw new NotAMystSiteError(`${baseUrl}/myst.xref.json is malformed (no references array)`);
  }
  return { baseUrl, xref };
}

/** Page entries in the xref index (headings etc. share the same data files). */
export function pageRefs(xref: XrefIndex): XrefReference[] {
  return xref.references.filter((r) => r.kind === "page");
}

/** `data` paths in the xref index are site-root-relative, e.g. "/quickstart.json". */
export function resolveSitePath(baseUrl: string, path: string): string {
  return `${baseUrl}${path.startsWith("/") ? "" : "/"}${path}`;
}

export async function fetchPage(baseUrl: string, ref: XrefReference): Promise<MystPageJson> {
  return fetchJson<MystPageJson>(resolveSitePath(baseUrl, ref.data));
}

export interface SiteMeta {
  siteId: string;
  siteTitle: string;
  baseUrl: string;
}

/** Meilisearch ids must be alphanumeric/hyphen/underscore — hash everything else. */
function docId(siteId: string, slug: string, anchor: string | null, index: number): string {
  return createHash("sha1").update(`${siteId}\n${slug}\n${anchor ?? ""}\n${index}`).digest("hex");
}

/** Turn one crawled page into section-granularity search documents. */
export function buildSearchDocs(site: SiteMeta, page: MystPageJson, pageUrlPath: string): SearchDoc[] {
  const fm = page.frontmatter ?? {};
  const pageTitle = fm.title ?? page.slug ?? "Untitled";
  const pageUrl = resolveSitePath(site.baseUrl, pageUrlPath || `/${page.slug}`);
  const sections = extractSections(page.mdast, pageTitle);
  return sections.map((s, i) => ({
    id: docId(site.siteId, page.slug, s.anchor, i),
    siteId: site.siteId,
    siteTitle: site.siteTitle,
    siteUrl: site.baseUrl,
    pageSlug: page.slug,
    pageTitle,
    url: s.anchor ? `${pageUrl}#${s.anchor}` : pageUrl,
    anchor: s.anchor,
    headingPath: s.headingPath,
    sectionTitle: s.title,
    text: s.text,
    description: fm.description ?? null,
    authors: authorNames(fm),
    tags: pageTags(fm),
    license: licenseName(fm),
    thumbnail: typeof fm.thumbnail === "string" ? fm.thumbnail : null,
  }));
}

export interface CrawledPage {
  ref: XrefReference;
  page: MystPageJson;
  docs: SearchDoc[];
}

export interface CrawlResult {
  pages: CrawledPage[];
  errors: { url: string; message: string }[];
  siteTitle: string;
  /** Slugs of every page currently live on the site (changed or not). */
  allSlugs: string[];
}

/** Minimal concurrency limiter (avoids a dependency for one function). */
function pLimit(max: number) {
  let active = 0;
  const queue: (() => void)[] = [];
  const next = () => {
    active--;
    queue.shift()?.();
  };
  return async <T>(fn: () => Promise<T>): Promise<T> => {
    if (active >= max) await new Promise<void>((r) => queue.push(r));
    active++;
    try {
      return await fn();
    } finally {
      next();
    }
  };
}

/**
 * Crawl a site: fetch every page's JSON AST (politely, few at a time) and
 * build search docs. `skipSha256` lets callers skip pages whose content hash
 * is unchanged since the last crawl.
 */
export async function crawlSite(opts: {
  siteId: string;
  url: string;
  concurrency?: number;
  skipSha256?: (slugOrUrl: string) => string | undefined;
  onProgress?: (done: number, total: number) => void;
}): Promise<CrawlResult> {
  const { baseUrl, xref } = await discoverSite(opts.url);
  const refs = pageRefs(xref);
  const limit = pLimit(opts.concurrency ?? 4);
  const errors: CrawlResult["errors"] = [];
  let done = 0;

  // Site title comes from the root page's frontmatter (fall back to hostname).
  let siteTitle = new URL(baseUrl).hostname;

  const fetched = await Promise.all(
    refs.map((ref) =>
      limit(async () => {
        try {
          const page = await fetchPage(baseUrl, ref);
          if (ref.url === "/" && page.frontmatter?.title) siteTitle = page.frontmatter.title;
          return { ref, page };
        } catch (err) {
          errors.push({ url: resolveSitePath(baseUrl, ref.data), message: (err as Error).message });
          return null;
        } finally {
          opts.onProgress?.(++done, refs.length);
        }
      }),
    ),
  );

  const site: SiteMeta = { siteId: opts.siteId, siteTitle, baseUrl };
  const pages: CrawledPage[] = [];
  const allSlugs: string[] = [];
  for (const item of fetched) {
    if (!item) continue;
    const { ref, page } = item;
    allSlugs.push(page.slug);
    const previous = opts.skipSha256?.(page.slug ?? ref.url);
    if (previous && previous === page.sha256) continue;
    pages.push({ ref, page, docs: buildSearchDocs(site, page, ref.url) });
  }
  return { pages, errors, siteTitle, allSlugs };
}
