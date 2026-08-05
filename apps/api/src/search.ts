import { MeiliSearch } from "meilisearch";
import type { SearchDoc } from "@mystic/core";
import { env } from "./env.js";

export const SECTIONS_INDEX = "sections";

export const meili = new MeiliSearch({ host: env.meiliUrl, apiKey: env.meiliKey });

/** A search doc plus its embedding in Meilisearch's userProvided-vector shape. */
export type VectorizedDoc = SearchDoc & { _vectors: { default: number[] } };

export async function ensureIndexes(): Promise<void> {
  try {
    await meili.createIndex(SECTIONS_INDEX, { primaryKey: "id" });
  } catch {
    // index already exists
  }
  const index = meili.index(SECTIONS_INDEX);
  await index.updateSettings({
    searchableAttributes: ["sectionTitle", "pageTitle", "headingPath", "text", "description", "tags", "authors", "siteTitle"],
    filterableAttributes: ["siteId", "siteTitle", "pageSlug", "tags", "authors", "license"],
    sortableAttributes: [],
    typoTolerance: { minWordSizeForTypos: { oneTypo: 5, twoTypos: 9 } },
    embedders: { default: { source: "userProvided", dimensions: 384 } },
  });
}

export async function indexDocs(docs: VectorizedDoc[]): Promise<void> {
  if (!docs.length) return;
  const task = await meili.index(SECTIONS_INDEX).addDocuments(docs);
  await meili.waitForTask(task.taskUid, { timeOutMs: 120_000 });
}

/** Remove all docs for a page (before re-adding its current sections). */
export async function deletePageDocs(siteId: string, pageSlug: string): Promise<void> {
  const task = await meili
    .index(SECTIONS_INDEX)
    .deleteDocuments({ filter: `siteId = "${siteId}" AND pageSlug = "${pageSlug}"` });
  await meili.waitForTask(task.taskUid, { timeOutMs: 60_000 });
}

export async function deleteSiteDocs(siteId: string): Promise<void> {
  const task = await meili.index(SECTIONS_INDEX).deleteDocuments({ filter: `siteId = "${siteId}"` });
  await meili.waitForTask(task.taskUid, { timeOutMs: 60_000 });
}

export interface SearchParams {
  q: string;
  siteId?: string;
  tag?: string;
  author?: string;
  limit: number;
  offset: number;
  /** Query embedding for hybrid (keyword + semantic) search; omit for keyword-only. */
  queryVector?: number[];
}

/**
 * Vector similarity matches EVERY doc a little, so without a floor a hybrid
 * query "matches" the whole index. With bge-small's compressed score band,
 * unrelated content tops out ≈0.76 and real/topical matches sit ≥0.78 —
 * cut between the two.
 */
const HYBRID_SCORE_THRESHOLD = 0.78;

const FACETS = ["siteTitle", "siteId", "tags", "authors", "license"];

export async function searchSections(params: SearchParams) {
  const filters: string[] = [];
  if (params.siteId) filters.push(`siteId = "${params.siteId}"`);
  if (params.tag) filters.push(`tags = "${params.tag}"`);
  if (params.author) filters.push(`authors = "${params.author}"`);
  const filter = filters.length ? filters.join(" AND ") : undefined;
  const index = meili.index(SECTIONS_INDEX);
  const hybridParams = params.queryVector
    ? {
        vector: params.queryVector,
        hybrid: { embedder: "default", semanticRatio: 0.5 },
        retrieveVectors: false,
        rankingScoreThreshold: HYBRID_SCORE_THRESHOLD,
      }
    : undefined;
  const pageQuery = index.search(params.q, {
    hitsPerPage: params.limit,
    page: Math.floor(params.offset / params.limit) + 1,
    filter,
    facets: FACETS,
    attributesToCrop: ["text"],
    cropLength: 40,
    attributesToHighlight: ["sectionTitle", "pageTitle", "text"],
    highlightPreTag: "<mark>",
    highlightPostTag: "</mark>",
    ...(hybridParams ?? {}),
  });
  if (!hybridParams) return pageQuery;
  // For hybrid queries Meilisearch computes totalHits and facet counts over the
  // vector candidate pool (ignoring rankingScoreThreshold) unless the requested
  // window covers every qualifying hit — so run an ids-only full-window probe
  // alongside the page query and take the counts from it.
  const [page, probe] = await Promise.all([
    pageQuery,
    index.search(params.q, {
      hitsPerPage: 1000, // Meilisearch's default maxTotalHits cap
      page: 1,
      filter,
      facets: FACETS,
      attributesToRetrieve: [],
      ...hybridParams,
    }),
  ]);
  return { ...page, totalHits: probe.totalHits, facetDistribution: probe.facetDistribution };
}
