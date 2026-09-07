"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useCollection } from "@/components/collection-context";
import { PreviewLink } from "@/components/PreviewLink";
import { api } from "@/lib/api";
import type { CollectionCard, TreeItem } from "@/lib/collections";

type Layout = "list" | "gallery";

/**
 * One run of the landing page: either a part (with its heading) or the stretch
 * of ungrouped items between parts. Each carries its own layout, so a single
 * collection can put a narrative sequence in a list and a browsable set in a
 * gallery.
 */
interface Section {
  key: string;
  title: string | null;
  layout: Layout;
  items: TreeItem[];
}

function ItemList({ slug, items }: { slug: string; items: TreeItem[] }) {
  return (
    <ol className="coll-toc">
      {items.map((node) => (
        <li key={node.id}>
          {node.siteId && node.pageSlug ? (
            <PreviewLink
              href={`/c/${slug}/${node.id}`}
              siteId={node.siteId}
              pageSlug={node.pageSlug}
              anchor={node.anchor}
              internal
            >
              {node.title ?? node.pageSlug}
            </PreviewLink>
          ) : (
            <Link href={`/c/${slug}/${node.id}`}>{node.title ?? node.pageSlug}</Link>
          )}
        </li>
      ))}
    </ol>
  );
}

/** Cards with tag filtering — the aggregation-gallery presentation. */
function Gallery({ slug, items, cards }: { slug: string; items: TreeItem[]; cards: Map<string, CollectionCard> }) {
  const [active, setActive] = useState<string[]>([]);
  // Thumbnails point at assets on other people's sites, and those move — a
  // thumbnail whose URL has gone stale since the last crawl degrades to the
  // no-thumbnail card rather than a broken-image box.
  const [broken, setBroken] = useState<string[]>([]);

  const shownCards = useMemo(
    () => items.map((item) => cards.get(item.id)).filter((c): c is CollectionCard => Boolean(c)),
    [items, cards],
  );

  const tags = useMemo(() => {
    const counts = new Map<string, number>();
    for (const card of shownCards) for (const tag of card.tags) counts.set(tag, (counts.get(tag) ?? 0) + 1);
    return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  }, [shownCards]);

  const shown = active.length === 0 ? shownCards : shownCards.filter((c) => c.tags.some((t) => active.includes(t)));

  if (shownCards.length === 0) return <p className="muted">Nothing to show here yet.</p>;

  return (
    <>
      {tags.length > 0 && (
        <div className="gallery-filters">
          <button className={active.length === 0 ? "tag-chip active" : "tag-chip"} onClick={() => setActive([])}>
            All ({shownCards.length})
          </button>
          {tags.map(([tag, count]) => (
            <button
              key={tag}
              className={active.includes(tag) ? "tag-chip active" : "tag-chip"}
              onClick={() => setActive((prev) => (prev.includes(tag) ? prev.filter((t) => t !== tag) : [...prev, tag]))}
            >
              {tag} ({count})
            </button>
          ))}
        </div>
      )}
      <div className="gallery-grid">
        {shown.map((card) => (
          <Link key={card.nodeId} href={`/c/${slug}/${card.nodeId}`} className="gallery-card">
            {card.thumbnail && !broken.includes(card.thumbnail) && (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={card.thumbnail}
                alt=""
                className="gallery-thumb"
                loading="lazy"
                onError={() => setBroken((prev) => (prev.includes(card.thumbnail!) ? prev : [...prev, card.thumbnail!]))}
              />
            )}
            <div className="gallery-card-body">
              <h3>{card.title}</h3>
              {card.description && <p className="gallery-desc">{card.description}</p>}
              <div className="gallery-meta muted">
                {card.siteTitle}
                {card.authors.length > 0 && ` · ${card.authors.slice(0, 3).join(", ")}`}
              </div>
              {card.tags.length > 0 && (
                <div className="gallery-tags">
                  {card.tags.slice(0, 4).map((tag) => (
                    <span key={tag} className="badge plain">
                      {tag}
                    </span>
                  ))}
                </div>
              )}
            </div>
          </Link>
        ))}
      </div>
      {shown.length === 0 && <p className="muted">Nothing matches those tags.</p>}
    </>
  );
}

export default function CollectionLanding() {
  const { collection, tree } = useCollection();
  const [cards, setCards] = useState<Map<string, CollectionCard> | null>(null);
  const [cardsError, setCardsError] = useState<string | null>(null);

  // Root-level order is preserved: consecutive ungrouped items form their own
  // implicit section, and each part becomes a section of its own.
  const sections = useMemo<Section[]>(() => {
    const out: Section[] = [];
    let loose: TreeItem[] = [];
    const flushLoose = () => {
      if (loose.length === 0) return;
      out.push({ key: `loose-${out.length}`, title: null, layout: collection.layout, items: loose });
      loose = [];
    };
    for (const root of tree) {
      if (root.kind === "part") {
        flushLoose();
        out.push({
          key: root.id,
          title: root.title ?? "Part",
          layout: root.layout ?? collection.layout,
          items: root.children,
        });
      } else {
        loose.push(root);
      }
    }
    flushLoose();
    return out;
  }, [tree, collection.layout]);

  const needsCards = sections.some((s) => s.layout === "gallery");

  useEffect(() => {
    if (!needsCards) return;
    api<CollectionCard[]>(`/api/collections/${collection.id}/cards`)
      .then((rows) => setCards(new Map(rows.map((r) => [r.nodeId, r]))))
      .catch((e) => setCardsError((e as Error).message));
  }, [collection.id, needsCards]);

  return (
    <article>
      <h1>{collection.name}</h1>
      {collection.description && <p className="coll-desc">{collection.description}</p>}

      {sections.length === 0 && <p className="muted">This collection is empty.</p>}

      {sections.map((section) => (
        <section key={section.key} className="coll-section">
          {section.title && <h2>{section.title}</h2>}
          {section.layout === "gallery" ? (
            cardsError ? (
              <p className="error-text">Could not load the gallery: {cardsError}</p>
            ) : cards ? (
              <Gallery slug={collection.slug} items={section.items} cards={cards} />
            ) : (
              <p className="muted">Loading…</p>
            )
          ) : (
            <ItemList slug={collection.slug} items={section.items} />
          )}
        </section>
      ))}
    </article>
  );
}
