"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams, usePathname, useRouter } from "next/navigation";
import { useAuth } from "@/components/auth";
import { api } from "@/lib/api";
import { buildTree, type Collection, type CollectionWithNodes } from "@/lib/collections";
import { CollectionContext } from "@/components/collection-context";

export default function CollectionSiteLayout({ children }: { children: React.ReactNode }) {
  const { slug } = useParams<{ slug: string }>();
  const pathname = usePathname();
  const router = useRouter();
  const { user, ready } = useAuth();
  const [coll, setColl] = useState<(CollectionWithNodes & { canEdit?: boolean }) | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!ready) return;
    api<CollectionWithNodes & { canEdit?: boolean }>(`/api/collections/slug/${slug}`)
      .then(setColl)
      .catch((e) => setError((e as Error).message));
  }, [slug, ready, user?.id]);

  const fork = async () => {
    const forked = await api<Collection>(`/api/collections/${coll!.id}/fork`, { method: "POST" });
    router.push(`/collections/${forked.id}`);
  };

  if (error) return <main className="container"><p className="error-text">{error}</p></main>;
  if (!coll) return <main className="container"><p className="muted">Loading…</p></main>;

  const tree = buildTree(coll.nodes);

  return (
    <CollectionContext.Provider value={{ collection: coll, tree }}>
      <div className="coll-shell">
        <aside className="coll-sidebar">
          <Link href={`/c/${coll.slug}`} className="coll-title">
            {coll.name}
          </Link>
          <nav>
            {tree.map((root) =>
              root.kind === "part" ? (
                <div key={root.id} className="coll-part">
                  <div className="coll-part-title">{root.title}</div>
                  {root.children.map((child) => (
                    <Link
                      key={child.id}
                      href={`/c/${coll.slug}/${child.id}`}
                      className={pathname.endsWith(`/${child.id}`) ? "active" : ""}
                    >
                      {child.title ?? child.pageSlug}
                    </Link>
                  ))}
                </div>
              ) : (
                <Link
                  key={root.id}
                  href={`/c/${coll.slug}/${root.id}`}
                  className={pathname.endsWith(`/${root.id}`) ? "active" : ""}
                >
                  {root.title ?? root.pageSlug}
                </Link>
              ),
            )}
          </nav>
          <div className="coll-actions">
            {coll.canEdit && (
              <Link href={`/collections/${coll.id}`}>
                <button>Edit</button>
              </Link>
            )}
            {user && <button onClick={fork}>Fork</button>}
          </div>
          <div className="coll-footer">
            Curated with <a href="/">MySTic</a>
          </div>
        </aside>
        <main className="coll-main">{children}</main>
      </div>
    </CollectionContext.Provider>
  );
}
