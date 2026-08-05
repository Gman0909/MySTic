"use client";

import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import type { SearchDoc, SiteSummary } from "@mystic/core";
import { api } from "@/lib/api";
import { AddToCollection } from "@/components/AddToCollection";
import { PreviewLink } from "@/components/PreviewLink";

type Hit = SearchDoc & { _formatted?: Partial<SearchDoc> };

interface SearchResponse {
  hits: Hit[];
  estimatedTotalHits: number;
  facets: Record<string, Record<string, number>>;
  processingTimeMs: number;
  mode: string;
}

const PAGE_SIZE = 15;

/** Escape crawled text, then restore the highlight tags Meilisearch inserted. */
function highlight(text: string): { __html: string } {
  const escaped = text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
  return { __html: escaped.replaceAll("&lt;mark&gt;", "<mark>").replaceAll("&lt;/mark&gt;", "</mark>") };
}

export default function SearchPage() {
  return (
    <Suspense fallback={<p className="muted">Loading…</p>}>
      <SearchPageInner />
    </Suspense>
  );
}

function SearchPageInner() {
  const params = useSearchParams();
  const [q, setQ] = useState(params.get("q") ?? "");
  const [mode, setMode] = useState<"hybrid" | "keyword">("hybrid");
  const [siteId, setSiteId] = useState<string | null>(null);
  const [tag, setTag] = useState<string | null>(null);
  const [author, setAuthor] = useState<string | null>(null);
  const [hits, setHits] = useState<Hit[]>([]);
  const [meta, setMeta] = useState<Omit<SearchResponse, "hits"> | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [sites, setSites] = useState<SiteSummary[]>([]);
  const [error, setError] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const requestId = useRef(0);
  const sentinelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    api<SiteSummary[]>("/api/sites").then(setSites).catch(() => {});
  }, []);

  const siteTitles = useMemo(() => new Map(sites.map((s) => [s.id, s.title ?? s.url])), [sites]);

  const fetchPage = useCallback(
    async (offset: number, append: boolean) => {
      const id = ++requestId.current;
      const p = new URLSearchParams({ q, limit: String(PAGE_SIZE), offset: String(offset), mode });
      if (siteId) p.set("site", siteId);
      if (tag) p.set("tags", tag);
      if (author) p.set("author", author);
      if (append) setLoadingMore(true);
      try {
        const res = await api<SearchResponse>(`/api/search?${p}`);
        if (id !== requestId.current) return; // superseded by a newer search
        setError(null);
        setMeta({
          estimatedTotalHits: res.estimatedTotalHits,
          facets: res.facets,
          processingTimeMs: res.processingTimeMs,
          mode: res.mode,
        });
        setHits((prev) => (append ? [...prev, ...res.hits] : res.hits));
        setHasMore(res.hits.length === PAGE_SIZE);
      } catch (err) {
        if (id === requestId.current) setError((err as Error).message);
      } finally {
        if (id === requestId.current) setLoadingMore(false);
      }
    },
    [q, siteId, tag, author, mode],
  );

  useEffect(() => {
    clearTimeout(timer.current);
    timer.current = setTimeout(() => fetchPage(0, false), mode === "hybrid" ? 300 : 200);
    return () => clearTimeout(timer.current);
  }, [fetchPage, mode]);

  // Infinite scroll: load the next page when the sentinel scrolls into view.
  useEffect(() => {
    const sentinel = sentinelRef.current;
    if (!sentinel || !hasMore) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting && !loadingMore) void fetchPage(hits.length, true);
      },
      { rootMargin: "600px" },
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [hasMore, loadingMore, hits.length, fetchPage]);

  const facetList = (
    name: string,
    dist: Record<string, number> | undefined,
    active: string | null,
    setActive: (v: string | null) => void,
    labelOf: (v: string) => string = (v) => v,
  ) => {
    const entries = Object.entries(dist ?? {}).sort((a, b) => b[1] - a[1]).slice(0, 10);
    if (!entries.length) return null;
    return (
      <div>
        <h3>{name}</h3>
        <ul>
          {entries.map(([value, count]) => (
            <li key={value}>
              <button
                className={active === value ? "active" : ""}
                onClick={() => setActive(active === value ? null : value)}
              >
                <span>{labelOf(value)}</span>
                <span className="count">{count}</span>
              </button>
            </li>
          ))}
        </ul>
      </div>
    );
  };

  return (
    <div>
      <div className="search-box">
        <input
          autoFocus
          placeholder="Search across all indexed MyST sites…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <button
          className={mode === "hybrid" ? "primary" : ""}
          title="Hybrid mixes keyword and semantic (embedding) relevance; Keyword is exact-match only"
          onClick={() => setMode(mode === "hybrid" ? "keyword" : "hybrid")}
        >
          {mode === "hybrid" ? "✨ Hybrid" : "Keyword"}
        </button>
      </div>
      {error && <p className="error-text">Search unavailable: {error}</p>}
      <div className="layout">
        <aside className="facets">
          {facetList("Sites", meta?.facets.siteId, siteId, setSiteId, (id) => siteTitles.get(id) ?? id)}
          {facetList("Tags", meta?.facets.tags, tag, setTag)}
          {facetList("Authors", meta?.facets.authors, author, setAuthor)}
        </aside>
        <section>
          {meta && (
            <p className="muted" style={{ marginTop: 0 }}>
              {meta.estimatedTotalHits} sections · {meta.processingTimeMs} ms
            </p>
          )}
          {hits.map((hit) => (
            <article className="result" key={hit.id}>
              <div className="crumbs">{hit.headingPath.join(" › ")}</div>
              <h2>
                <PreviewLink href={hit.url} siteId={hit.siteId} pageSlug={hit.pageSlug} anchor={hit.anchor}>
                  <span dangerouslySetInnerHTML={highlight(hit._formatted?.sectionTitle ?? hit.sectionTitle)} />
                </PreviewLink>
              </h2>
              {hit._formatted?.text && <p className="snippet" dangerouslySetInnerHTML={highlight(hit._formatted.text)} />}
              <div className="meta">
                <span className="badge">{hit.siteTitle}</span>
                {hit.authors.slice(0, 3).map((a) => (
                  <span className="badge plain" key={a}>
                    {a}
                  </span>
                ))}
                {hit.tags.slice(0, 4).map((t) => (
                  <span className="badge plain" key={t}>
                    #{t}
                  </span>
                ))}
                {hit.license && <span className="badge plain">{hit.license}</span>}
                <AddToCollection
                  siteId={hit.siteId}
                  pageSlug={hit.pageSlug}
                  anchor={hit.anchor}
                  title={hit.sectionTitle}
                  pageTitle={hit.pageTitle}
                />
              </div>
            </article>
          ))}
          {meta && hits.length === 0 && <p className="muted">No sections match.</p>}
          <div ref={sentinelRef} />
          {loadingMore && <p className="muted">Loading more…</p>}
          {meta && hits.length > 0 && !hasMore && (
            <p className="muted" style={{ textAlign: "center", margin: "1.5rem 0" }}>
              — end of results —
            </p>
          )}
        </section>
      </div>
    </div>
  );
}
