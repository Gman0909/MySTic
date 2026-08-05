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
}

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
  const [result, setResult] = useState<SearchResponse | null>(null);
  const [sites, setSites] = useState<SiteSummary[]>([]);
  const [error, setError] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);

  useEffect(() => {
    api<SiteSummary[]>("/api/sites").then(setSites).catch(() => {});
  }, []);

  const siteTitles = useMemo(() => new Map(sites.map((s) => [s.id, s.title ?? s.url])), [sites]);

  const runSearch = useCallback(
    async (query: string, f: { siteId: string | null; tag: string | null; author: string | null; mode: string }) => {
      const params = new URLSearchParams({ q: query, limit: "15", mode: f.mode });
      if (f.siteId) params.set("site", f.siteId);
      if (f.tag) params.set("tags", f.tag);
      if (f.author) params.set("author", f.author);
      try {
        setResult(await api<SearchResponse>(`/api/search?${params}`));
        setError(null);
      } catch (err) {
        setError((err as Error).message);
      }
    },
    [],
  );

  useEffect(() => {
    clearTimeout(timer.current);
    // Semantic queries take ~30ms extra; slightly longer debounce keeps typing smooth.
    timer.current = setTimeout(() => runSearch(q, { siteId, tag, author, mode }), mode === "hybrid" ? 300 : 200);
    return () => clearTimeout(timer.current);
  }, [q, siteId, tag, author, mode, runSearch]);

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
          {facetList("Sites", result?.facets.siteId, siteId, setSiteId, (id) => siteTitles.get(id) ?? id)}
          {facetList("Tags", result?.facets.tags, tag, setTag)}
          {facetList("Authors", result?.facets.authors, author, setAuthor)}
        </aside>
        <section>
          {result && (
            <p className="muted" style={{ marginTop: 0 }}>
              {result.estimatedTotalHits} sections · {result.processingTimeMs} ms
            </p>
          )}
          {result?.hits.map((hit) => (
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
          {result && result.hits.length === 0 && <p className="muted">No sections match.</p>}
        </section>
      </div>
    </div>
  );
}
