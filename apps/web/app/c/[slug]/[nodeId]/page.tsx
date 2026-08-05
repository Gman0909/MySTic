"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { sliceSection, type MystFrontmatter, type MystNode } from "@mystic/core";
import { api } from "@/lib/api";
import { useCollection } from "@/components/collection-context";
import { Myst } from "@/components/Myst";

interface LiveContent {
  siteTitle: string;
  siteUrl: string;
  pageUrl: string;
  mdast: MystNode;
  frontmatter: MystFrontmatter;
  source: "live" | "stale-cache" | "crawler-cache";
  fetchedAt: string;
}

function licenseOf(fm: MystFrontmatter): string | null {
  const lic = fm.license as Record<string, { id?: string; name?: string }> | undefined;
  if (!lic) return null;
  return lic.content?.id ?? lic.content?.name ?? (lic as { id?: string }).id ?? null;
}

export default function CollectionContentPage() {
  const { nodeId, slug } = useParams<{ nodeId: string; slug: string }>();
  const { collection, tree } = useCollection();
  const [content, setContent] = useState<LiveContent | null>(null);
  const [error, setError] = useState<string | null>(null);

  const flat = useMemo(() => tree.flatMap((r) => [r, ...r.children]), [tree]);
  const node = flat.find((n) => n.id === nodeId);
  const contentNodes = useMemo(() => flat.filter((n) => n.kind !== "part"), [flat]);
  const nodeIndex = contentNodes.findIndex((n) => n.id === nodeId);

  useEffect(() => {
    if (!node?.siteId || !node.pageSlug) return;
    setContent(null);
    api<LiveContent>(`/api/content/${node.siteId}/${node.pageSlug}`)
      .then(setContent)
      .catch((e) => setError((e as Error).message));
  }, [node?.siteId, node?.pageSlug]);

  if (!node) return <p className="error-text">This item is no longer in the collection.</p>;
  if (error) return <p className="error-text">Could not load content: {error}</p>;

  const ast =
    content &&
    (node.kind === "section" && node.anchor
      ? sliceSection(content.mdast, node.anchor) ?? content.mdast
      : content.mdast);

  const authors = (content?.frontmatter.authors ?? [])
    .map((a) => a?.name)
    .filter(Boolean)
    .join(", ");
  const license = content ? licenseOf(content.frontmatter) : null;
  const anchorUrl = content && node.anchor ? `${content.pageUrl}#${node.anchor}` : content?.pageUrl;

  const prev = nodeIndex > 0 ? contentNodes[nodeIndex - 1] : null;
  const next = nodeIndex >= 0 && nodeIndex < contentNodes.length - 1 ? contentNodes[nodeIndex + 1] : null;

  return (
    <article>
      {content && (
        <div className={`source-banner ${content.source !== "live" ? "stale" : ""}`}>
          <span>
            From <a href={content.siteUrl} target="_blank" rel="noreferrer">{content.siteTitle}</a>
            {authors && <span className="muted"> · {authors}</span>}
            {license && <span className="muted"> · {license}</span>}
          </span>
          <a href={anchorUrl} target="_blank" rel="noreferrer">
            View original ↗
          </a>
          {content.source !== "live" && (
            <span className="muted">
              cached copy from {new Date(content.fetchedAt).toLocaleString()} (source unreachable)
            </span>
          )}
        </div>
      )}
      {!content && !error && <p className="muted">Loading from source…</p>}
      {ast && content && <Myst ast={ast} baseUrl={content.siteUrl} />}
      <nav className="coll-pager">
        {prev ? <Link href={`/c/${slug}/${prev.id}`}>← {prev.title ?? prev.pageSlug}</Link> : <span />}
        {next ? <Link href={`/c/${slug}/${next.id}`}>{next.title ?? next.pageSlug} →</Link> : <span />}
      </nav>
    </article>
  );
}
