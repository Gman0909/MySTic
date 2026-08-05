"use client";

import { useCollection } from "@/components/collection-context";
import { PreviewLink } from "@/components/PreviewLink";
import type { TreeItem } from "@/lib/collections";

export default function CollectionLanding() {
  const { collection, tree } = useCollection();

  const entry = (node: TreeItem) =>
    node.siteId && node.pageSlug ? (
      <PreviewLink
        href={`/c/${collection.slug}/${node.id}`}
        siteId={node.siteId}
        pageSlug={node.pageSlug}
        anchor={node.anchor}
        internal
      >
        {node.title ?? node.pageSlug}
      </PreviewLink>
    ) : (
      <a href={`/c/${collection.slug}/${node.id}`}>{node.title ?? node.pageSlug}</a>
    );

  return (
    <article>
      <h1>{collection.name}</h1>
      {collection.description && <p className="coll-desc">{collection.description}</p>}
      <h2>Contents</h2>
      <ol className="coll-toc">
        {tree.map((root) =>
          root.kind === "part" ? (
            <li key={root.id} className="coll-toc-part">
              {root.title}
              <ol>
                {root.children.map((child) => (
                  <li key={child.id}>{entry(child)}</li>
                ))}
              </ol>
            </li>
          ) : (
            <li key={root.id}>{entry(root)}</li>
          ),
        )}
      </ol>
      {tree.length === 0 && <p className="muted">This collection is empty.</p>}
    </article>
  );
}
