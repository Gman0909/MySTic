"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useParams } from "next/navigation";
import { api } from "@/lib/api";
import { buildTree, flattenTree, type CollectionWithNodes, type TreeItem } from "@/lib/collections";

type DropTarget = { type: "before"; id: string } | { type: "into"; id: string } | { type: "root-end" };

/** Remove a node (parts keep their children) and return it. */
function extract(tree: TreeItem[], id: string): { tree: TreeItem[]; item: TreeItem | null } {
  const root = tree.find((r) => r.id === id);
  if (root) return { tree: tree.filter((r) => r.id !== id), item: root };
  let item: TreeItem | null = null;
  const next = tree.map((r) => {
    const child = r.children.find((c) => c.id === id);
    if (!child) return r;
    item = child;
    return { ...r, children: r.children.filter((c) => c.id !== id) };
  });
  return { tree: next, item };
}

/** Apply a drop: returns the new tree, or null when the drop is a no-op/illegal. */
function applyDrop(tree: TreeItem[], dragId: string, target: DropTarget): TreeItem[] | null {
  if (target.type !== "root-end" && target.id === dragId) return null;
  const { tree: without, item } = extract(tree, dragId);
  if (!item) return null;

  if (item.kind === "part") {
    // Parts live at root; "into" a part or "before" one of its children means "before that part".
    let index = without.length;
    if (target.type !== "root-end") {
      const rootIdx = without.findIndex((r) => r.id === target.id || r.children.some((c) => c.id === target.id));
      if (rootIdx !== -1) index = rootIdx;
    }
    const next = [...without];
    next.splice(index, 0, item);
    return next;
  }

  const flatItem: TreeItem = { ...item, children: [] };
  if (target.type === "root-end") return [...without, flatItem];

  if (target.type === "into") {
    return without.map((r) => (r.id === target.id ? { ...r, children: [...r.children, flatItem] } : r));
  }

  // before a root-level row
  const rootIdx = without.findIndex((r) => r.id === target.id);
  if (rootIdx !== -1) {
    const next = [...without];
    next.splice(rootIdx, 0, flatItem);
    return next;
  }
  // before a child row inside a part
  return without.map((r) => {
    const childIdx = r.children.findIndex((c) => c.id === target.id);
    if (childIdx === -1) return r;
    const kids = [...r.children];
    kids.splice(childIdx, 0, flatItem);
    return { ...r, children: kids };
  });
}

export default function CollectionEditor() {
  const { id } = useParams<{ id: string }>();
  const [coll, setColl] = useState<CollectionWithNodes | null>(null);
  const [tree, setTree] = useState<TreeItem[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(true);
  const [dragId, setDragId] = useState<string | null>(null);
  const [over, setOver] = useState<string | null>(null); // "before:<id>" | "into:<id>" | "root-end"

  const load = useCallback(async () => {
    const data = await api<CollectionWithNodes>(`/api/collections/${id}`);
    setColl(data);
    setTree(buildTree(data.nodes));
  }, [id]);

  useEffect(() => {
    load().catch((e) => setError((e as Error).message));
  }, [load]);

  const saveLayout = async (next: TreeItem[]) => {
    setTree(next);
    setSaved(false);
    await api(`/api/collections/${id}/tree`, { method: "PUT", body: JSON.stringify({ nodes: flattenTree(next) }) });
    setSaved(true);
  };

  // --- drag & drop ---------------------------------------------------------
  const clearDrag = () => {
    setDragId(null);
    setOver(null);
  };

  const drop = (target: DropTarget) => {
    if (!dragId) return clearDrag();
    const next = applyDrop(tree, dragId, target);
    clearDrag();
    if (next) void saveLayout(next);
  };

  const dragProps = (node: TreeItem) => ({
    draggable: true,
    onDragStart: (e: React.DragEvent) => {
      e.dataTransfer.effectAllowed = "move";
      setDragId(node.id);
    },
    onDragEnd: clearDrag,
  });

  /** Parts accept "into" drops on their body; all rows accept "before" drops on their top half. */
  const dropProps = (node: TreeItem) => ({
    onDragOver: (e: React.DragEvent) => {
      if (!dragId || dragId === node.id) return;
      e.preventDefault();
      const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
      const topHalf = e.clientY - rect.top < rect.height / 2;
      const dragging = tree.find((r) => r.id === dragId) ?? tree.flatMap((r) => r.children).find((c) => c.id === dragId);
      const canNest = node.kind === "part" && dragging?.kind !== "part";
      setOver(canNest && !topHalf ? `into:${node.id}` : `before:${node.id}`);
    },
    onDrop: (e: React.DragEvent) => {
      e.preventDefault();
      if (over === `into:${node.id}`) drop({ type: "into", id: node.id });
      else drop({ type: "before", id: node.id });
    },
  });

  // --- button fallbacks ----------------------------------------------------
  const moveRoot = (index: number, delta: number) => {
    const next = [...tree];
    const target = index + delta;
    if (target < 0 || target >= next.length) return;
    [next[index], next[target]] = [next[target]!, next[index]!];
    void saveLayout(next);
  };

  const moveChild = (rootIndex: number, childIndex: number, delta: number) => {
    const next = tree.map((r) => ({ ...r, children: [...r.children] }));
    const kids = next[rootIndex]!.children;
    const target = childIndex + delta;
    if (target < 0 || target >= kids.length) return;
    [kids[childIndex], kids[target]] = [kids[target]!, kids[childIndex]!];
    void saveLayout(next);
  };

  const outdent = (rootIndex: number, childIndex: number) => {
    const next = tree.map((r) => ({ ...r, children: [...r.children] }));
    const [item] = next[rootIndex]!.children.splice(childIndex, 1);
    next.splice(rootIndex + 1, 0, { ...item!, children: [] });
    void saveLayout(next);
  };

  const rename = async (node: TreeItem) => {
    const title = prompt("Title", node.title ?? "");
    if (title === null) return;
    await api(`/api/collections/${id}/nodes/${node.id}`, { method: "PATCH", body: JSON.stringify({ title: title || null }) });
    await load();
  };

  /** Parts can override the collection's layout for their own children. */
  const setPartLayout = async (node: TreeItem, layout: "list" | "gallery" | null) => {
    await api(`/api/collections/${id}/nodes/${node.id}`, { method: "PATCH", body: JSON.stringify({ layout }) });
    await load();
  };

  const removeNode = async (node: TreeItem) => {
    if (!confirm(`Remove "${node.title ?? node.pageSlug}" from the collection?`)) return;
    await api(`/api/collections/${id}/nodes/${node.id}`, { method: "DELETE" });
    await load();
  };

  const addPart = async () => {
    const title = prompt("Part title (a grouping heading in the navigation)");
    if (!title) return;
    await api(`/api/collections/${id}/nodes`, { method: "POST", body: JSON.stringify({ kind: "part", title }) });
    await load();
  };

  // Meta fields auto-save: debounced while typing, immediate for selects.
  const metaTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const updateMeta = (
    fields: Partial<Pick<CollectionWithNodes, "name" | "description" | "visibility" | "layout">>,
    immediate = false,
  ) => {
    setColl((prev) => (prev ? { ...prev, ...fields } : prev));
    setSaved(false);
    clearTimeout(metaTimer.current);
    const commit = async () => {
      setColl((current) => {
        if (current) {
          void api(`/api/collections/${id}`, {
            method: "PATCH",
            body: JSON.stringify({
              name: current.name || "Untitled collection",
              description: current.description,
              visibility: current.visibility,
              layout: current.layout,
            }),
          }).then(() => setSaved(true));
        }
        return current;
      });
    };
    if (immediate) void commit();
    else metaTimer.current = setTimeout(commit, 600);
  };

  const deleteCollection = async () => {
    if (!coll || !confirm(`Delete collection "${coll.name}" entirely?`)) return;
    await api(`/api/collections/${id}`, { method: "DELETE" });
    window.location.href = "/collections";
  };

  if (error)
    return (
      <p className="error-text">
        {error} {error.toLowerCase().includes("sign in") && <a href="/login">Sign in</a>}
      </p>
    );
  if (!coll) return <p className="muted">Loading…</p>;

  const rowClass = (node: TreeItem) =>
    [
      "edit-row",
      node.kind === "part" ? "edit-part" : "",
      dragId === node.id ? "dragging" : "",
      over === `before:${node.id}` ? "drop-before" : "",
      over === `into:${node.id}` ? "drop-into" : "",
    ]
      .filter(Boolean)
      .join(" ");

  const kindHelp: Record<string, string> = {
    part: "Part — a grouping heading that exists only in this collection. The only kind that can contain other items.",
    page: "Page — embeds the entire source page, live from the origin site.",
    section: "Section — embeds a single section of a source page (the #anchor shown), live from the origin site.",
  };

  const nodeRow = (node: TreeItem, controls: React.ReactNode) => (
    <div className={rowClass(node)} key={node.id} {...dragProps(node)} {...dropProps(node)}>
      <span className="drag-handle" title="Drag to rearrange">⠿</span>
      <span className="edit-kind badge plain" title={kindHelp[node.kind]}>{node.kind}</span>
      <span className="edit-title">{node.title ?? node.pageSlug ?? "Untitled"}</span>
      {node.anchor && <span className="muted">#{node.anchor}</span>}
      {node.kind === "part" && (
        <select
          className="edit-part-layout"
          value={node.layout ?? ""}
          onChange={(e) => void setPartLayout(node, (e.target.value || null) as "list" | "gallery" | null)}
          title="How this part's items are presented on the landing page"
        >
          <option value="">Default ({coll.layout})</option>
          <option value="list">List</option>
          <option value="gallery">Gallery</option>
        </select>
      )}
      <span className="edit-controls">{controls}</span>
    </div>
  );

  return (
    <div>
      <p>
        <a href="/collections">← Collections</a>
      </p>
      <div className="edit-meta">
        <input
          className="edit-name"
          value={coll.name}
          onChange={(e) => updateMeta({ name: e.target.value })}
          placeholder="Collection name"
        />
        <textarea
          value={coll.description ?? ""}
          onChange={(e) => updateMeta({ description: e.target.value })}
          placeholder="Description shown on the collection's landing page…"
          rows={2}
        />
        <div className="edit-meta-row">
          <select
            value={coll.visibility}
            onChange={(e) => updateMeta({ visibility: e.target.value as CollectionWithNodes["visibility"] }, true)}
          >
            <option value="unlisted">Unlisted (anyone with the link)</option>
            <option value="public">Public (listed for everyone)</option>
            <option value="private">Private (only you)</option>
          </select>
          <select
            value={coll.layout}
            onChange={(e) => updateMeta({ layout: e.target.value as CollectionWithNodes["layout"] }, true)}
            title="How the landing page presents the contents"
          >
            <option value="list">Default layout: list</option>
            <option value="gallery">Default layout: gallery</option>
          </select>
          <span className="muted" style={{ fontSize: "0.82rem" }}>{saved ? "All changes saved" : "Saving…"}</span>
          <a href={`/c/${coll.slug}`} target="_blank" rel="noreferrer">
            <button>View site ↗</button>
          </a>
          <button onClick={deleteCollection}>Delete collection</button>
        </div>
      </div>

      <h2>Table of contents</h2>
      <p className="muted">
        Three kinds of items: <strong>parts</strong> are grouping headings you create here; <strong>pages</strong> embed
        a whole source page; <strong>sections</strong> embed just one section of a source page. Pages and sections are
        always leaves — only parts can contain items, so to build hierarchy around a page, add a part and nest under
        it. Drag rows to rearrange: drop onto the lower half of a part to nest inside it, or onto the top half of any
        row to place before it. Each part can present its items as a <strong>list</strong> or a <strong>gallery</strong>
        of cards, independently of the collection default — so one collection can read as a sequence in places and browse
        as a gallery in others. Add content from the <a href="/search">search page</a>.
      </p>
      <button onClick={addPart}>+ Add part</button>
      <div className="edit-tree">
        {tree.map((root, i) => (
          <div key={root.id}>
            {nodeRow(
              root,
              <>
                <button onClick={() => moveRoot(i, -1)} title="Move up">↑</button>
                <button onClick={() => moveRoot(i, 1)} title="Move down">↓</button>
                <button onClick={() => rename(root)} title="Rename">✎</button>
                <button onClick={() => removeNode(root)} title="Remove">✕</button>
              </>,
            )}
            <div className="edit-children">
              {root.children.map((child, j) =>
                nodeRow(
                  child,
                  <>
                    <button onClick={() => moveChild(i, j, -1)} title="Move up">↑</button>
                    <button onClick={() => moveChild(i, j, 1)} title="Move down">↓</button>
                    <button onClick={() => outdent(i, j)} title="Un-nest">⇤</button>
                    <button onClick={() => rename(child)} title="Rename">✎</button>
                    <button onClick={() => removeNode(child)} title="Remove">✕</button>
                  </>,
                ),
              )}
            </div>
          </div>
        ))}
        {tree.length === 0 && <p className="muted">Empty — add sections from search results.</p>}
        {dragId && (
          <div
            className={`drop-root ${over === "root-end" ? "drop-before" : ""}`}
            onDragOver={(e) => {
              e.preventDefault();
              setOver("root-end");
            }}
            onDrop={(e) => {
              e.preventDefault();
              drop({ type: "root-end" });
            }}
          >
            Drop here to move to the top level (end)
          </div>
        )}
      </div>
    </div>
  );
}
