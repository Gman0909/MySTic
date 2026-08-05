import { kmeans } from "ml-kmeans";

export interface ClusterInput {
  id: string;
  embedding: number[];
}

export interface Cluster {
  /** Indexes into the input array. */
  members: number[];
  centroid: number[];
}

function runKmeans(vectors: number[][], k: number): { clusters: number[]; centroids: number[][] } {
  const result = kmeans(vectors, k, { initialization: "kmeans++", maxIterations: 60, seed: 42 });
  return { clusters: result.clusters, centroids: result.centroids };
}

function group(assignments: number[], centroids: number[][]): Cluster[] {
  const clusters: Cluster[] = centroids.map((centroid) => ({ members: [], centroid }));
  assignments.forEach((c, i) => clusters[c]!.members.push(i));
  return clusters.filter((c) => c.members.length > 0);
}

/**
 * Two-level clustering over normalized embeddings: k-means at the top, then
 * k-means again inside any cluster large enough to be worth splitting.
 * Returns a forest: top-level clusters, each with optional child clusters
 * (children partition the parent's members).
 */
export function clusterSections(items: ClusterInput[]): { top: Cluster; children: Cluster[] }[] {
  const n = items.length;
  if (n === 0) return [];
  const vectors = items.map((s) => s.embedding);

  const k1 = Math.min(Math.max(Math.ceil(Math.sqrt(n / 8)), 4), 24);
  if (n <= k1) {
    return [{ top: { members: items.map((_, i) => i), centroid: vectors[0]! }, children: [] }];
  }

  const topResult = runKmeans(vectors, k1);
  const topLevel = group(topResult.clusters, topResult.centroids);

  return topLevel.map((top) => {
    if (top.members.length < 40) return { top, children: [] };
    const subVectors = top.members.map((i) => vectors[i]!);
    const k2 = Math.min(Math.ceil(top.members.length / 25), 8);
    const sub = runKmeans(subVectors, k2);
    const children = group(sub.clusters, sub.centroids).map((c) => ({
      members: c.members.map((local) => top.members[local]!),
      centroid: c.centroid,
    }));
    return { top, children };
  });
}

/** Indexes of the members nearest to the cluster centroid (for labeling samples). */
export function nearestToCentroid(cluster: Cluster, vectors: number[][], count: number): number[] {
  const scored = cluster.members.map((i) => {
    const v = vectors[i]!;
    let dot = 0;
    for (let d = 0; d < v.length; d++) dot += v[d]! * cluster.centroid[d]!;
    return { i, dot };
  });
  return scored.sort((a, b) => b.dot - a.dot).slice(0, count).map((s) => s.i);
}
