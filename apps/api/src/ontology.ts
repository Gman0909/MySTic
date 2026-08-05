import { createHash, randomUUID } from "node:crypto";
import { asc, inArray, isNotNull, sql } from "drizzle-orm";
import {
  claudeLabels,
  clusterSections,
  fallbackLabel,
  nearestToCentroid,
  tfidfTerms,
  type ClusterForLabeling,
  type Cluster,
} from "@mystic/ontology";
import { schema, type Db } from "./db/index.js";
import { labelingApiKey } from "./settings.js";

const { sections, concepts } = schema;

let running = false;

interface SectionRow {
  id: string;
  siteId: string;
  title: string;
  text: string;
  embedding: number[];
}

function memberHash(ids: string[]): string {
  return createHash("sha1").update([...ids].sort().join("\n")).digest("hex");
}

/**
 * Rebuild the concept graph from section embeddings: two-level k-means, then
 * label clusters (Claude if configured, TF-IDF otherwise). Labels for clusters
 * whose membership is unchanged are reused from the previous build.
 */
export async function rebuildOntology(db: Db): Promise<{ concepts: number } | { skipped: string }> {
  if (running) return { skipped: "already running" };
  running = true;
  const started = Date.now();
  try {
    // Load in pages with truncated text — a single giant select over thousands of
    // vector rows can exhaust PGlite's WASM heap.
    const rows: SectionRow[] = [];
    const PAGE = 400;
    for (let offset = 0; ; offset += PAGE) {
      const batch = (await db
        .select({
          id: sections.id,
          siteId: sections.siteId,
          title: sections.title,
          text: sql<string>`left(${sections.text}, 400)`,
          embedding: sections.embedding,
        })
        .from(sections)
        .where(isNotNull(sections.embedding))
        .orderBy(asc(sections.id))
        .limit(PAGE)
        .offset(offset)) as SectionRow[];
      rows.push(...batch);
      if (batch.length < PAGE) break;
    }
    if (rows.length < 10) return { skipped: `only ${rows.length} embedded sections` };

    console.log(`[ontology] clustering ${rows.length} sections`);
    const forest = clusterSections(rows.map((r) => ({ id: r.id, embedding: r.embedding })));
    const vectors = rows.map((r) => r.embedding);

    // Flatten to (cluster, parentKey) list; children partition their parent.
    interface Flat {
      key: string;
      parentKey: string | null;
      cluster: Cluster;
      /** Section ids assigned directly to this concept (leaf level). */
      leafIds: string[];
    }
    const flat: Flat[] = [];
    forest.forEach(({ top, children }, i) => {
      const topKey = `t${i}`;
      flat.push({ key: topKey, parentKey: null, cluster: top, leafIds: children.length ? [] : top.members.map((m) => rows[m]!.id) });
      children.forEach((child, j) => {
        flat.push({ key: `${topKey}c${j}`, parentKey: topKey, cluster: child, leafIds: child.members.map((m) => rows[m]!.id) });
      });
    });

    // Labeling inputs: distinctive terms + titles nearest the centroid.
    const clusterTexts = flat.map((f) => f.cluster.members.map((m) => `${rows[m]!.title}\n${rows[m]!.text.slice(0, 300)}`));
    const terms = tfidfTerms(clusterTexts);
    const forLabeling: ClusterForLabeling[] = flat.map((f, i) => ({
      key: f.key,
      terms: terms[i]!,
      sampleTitles: nearestToCentroid(f.cluster, vectors, 8).map((m) => rows[m]!.title),
    }));

    // Reuse labels for clusters whose membership hash is unchanged.
    const previous = await db.select().from(concepts);
    const previousByHash = new Map(previous.map((c) => [c.memberHash, c]));
    const hashes = flat.map((f) => memberHash(f.cluster.members.map((m) => rows[m]!.id)));
    const needsLabeling = forLabeling.filter((_, i) => !previousByHash.has(hashes[i]!));
    const apiKey = await labelingApiKey(db);
    const aiLabels = needsLabeling.length ? await claudeLabels(needsLabeling, apiKey) : new Map();

    const now = new Date().toISOString();
    const idByKey = new Map<string, string>();
    const rowsToInsert = flat.map((f, i) => {
      const hash = hashes[i]!;
      const prev = previousByHash.get(hash);
      const label = prev
        ? { label: prev.label, description: prev.description ?? "" }
        : aiLabels?.get(f.key) ?? fallbackLabel(forLabeling[i]!);
      const id = randomUUID();
      idByKey.set(f.key, id);
      const siteCounts: Record<string, number> = {};
      for (const m of f.cluster.members) siteCounts[rows[m]!.siteId] = (siteCounts[rows[m]!.siteId] ?? 0) + 1;
      return {
        id,
        label: label.label,
        description: label.description,
        memberHash: hash,
        sectionCount: f.cluster.members.length,
        siteCounts,
        createdAt: now,
        _parentKey: f.parentKey,
        _leafIds: f.leafIds,
      };
    });

    // Swap the concept set atomically enough for our purposes.
    await db.delete(concepts);
    for (const r of rowsToInsert) {
      await db.insert(concepts).values({
        id: r.id,
        label: r.label,
        description: r.description,
        parentId: r._parentKey ? idByKey.get(r._parentKey) ?? null : null,
        memberHash: r.memberHash,
        sectionCount: r.sectionCount,
        siteCounts: r.siteCounts,
        createdAt: r.createdAt,
      });
    }
    await db.execute(sql`UPDATE sections SET concept_id = NULL`);
    for (const r of rowsToInsert) {
      for (let i = 0; i < r._leafIds.length; i += 200) {
        const chunk = r._leafIds.slice(i, i + 200);
        await db.update(sections).set({ conceptId: r.id }).where(inArray(sections.id, chunk));
      }
    }

    console.log(`[ontology] built ${rowsToInsert.length} concepts in ${((Date.now() - started) / 1000).toFixed(1)}s`);
    return { concepts: rowsToInsert.length };
  } finally {
    running = false;
  }
}
