export interface Collection {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  visibility: "unlisted" | "public" | "private";
  layout: "list" | "gallery";
  updatedAt: string;
}

/** Gallery-card metadata for one content item (GET /api/collections/:id/cards). */
export interface CollectionCard {
  nodeId: string;
  parentId: string | null;
  kind: "page" | "section";
  title: string;
  description: string | null;
  thumbnail: string | null;
  authors: string[];
  tags: string[];
  siteTitle: string | null;
  sourceUrl: string | null;
}

export interface CollectionNode {
  id: string;
  parentId: string | null;
  position: number;
  kind: "part" | "page" | "section";
  siteId: string | null;
  pageSlug: string | null;
  anchor: string | null;
  title: string | null;
  /** Parts only: overrides the collection layout for this part (null = inherit). */
  layout: "list" | "gallery" | null;
}

export interface CollectionWithNodes extends Collection {
  nodes: CollectionNode[];
}

export interface TreeItem extends CollectionNode {
  children: TreeItem[];
}

/** Nodes (flat, position-sorted by the API) → two-level tree. */
export function buildTree(nodes: CollectionNode[]): TreeItem[] {
  const byParent = new Map<string | null, CollectionNode[]>();
  for (const n of nodes) {
    const key = n.parentId ?? null;
    byParent.set(key, [...(byParent.get(key) ?? []), n]);
  }
  const sort = (list: CollectionNode[]) => [...list].sort((a, b) => a.position - b.position);
  return sort(byParent.get(null) ?? []).map((root) => ({
    ...root,
    children: sort(byParent.get(root.id) ?? []).map((c) => ({ ...c, children: [] })),
  }));
}

/** Tree → flat layout payload for PUT /tree. */
export function flattenTree(tree: TreeItem[]): { id: string; parentId: string | null; position: number }[] {
  const out: { id: string; parentId: string | null; position: number }[] = [];
  tree.forEach((root, i) => {
    out.push({ id: root.id, parentId: null, position: i });
    root.children.forEach((child, j) => out.push({ id: child.id, parentId: root.id, position: j }));
  });
  return out;
}
