"use client";

import { useEffect, useMemo, useState } from "react";
import type { SiteSummary } from "@mystic/core";
import { api } from "@/lib/api";
import { PreviewLink } from "@/components/PreviewLink";

interface Concept {
  id: string;
  label: string;
  description: string | null;
  sectionCount: number;
  siteCounts: Record<string, number>;
  children?: Concept[];
}

interface ConceptSections {
  concept: Concept;
  sections: { id: string; siteId: string; slug: string; url: string; title: string; headingPath: string[] }[];
}

export default function TreePage() {
  const [tree, setTree] = useState<Concept[] | null>(null);
  const [sites, setSites] = useState<SiteSummary[]>([]);
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [sectionsByConcept, setSectionsByConcept] = useState<Record<string, ConceptSections["sections"]>>({});
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api<Concept[]>("/api/tree").then(setTree).catch((e) => setError((e as Error).message));
    api<SiteSummary[]>("/api/sites").then(setSites).catch(() => {});
  }, []);

  const siteTitles = useMemo(() => new Map(sites.map((s) => [s.id, s.title ?? s.url])), [sites]);

  const toggle = async (concept: Concept, isLeaf: boolean) => {
    const next = new Set(open);
    if (next.has(concept.id)) {
      next.delete(concept.id);
    } else {
      next.add(concept.id);
      if (isLeaf && !sectionsByConcept[concept.id]) {
        const data = await api<ConceptSections>(`/api/concepts/${concept.id}/sections`);
        setSectionsByConcept((prev) => ({ ...prev, [concept.id]: data.sections }));
      }
    }
    setOpen(next);
  };

  const renderConcept = (concept: Concept, depth: number) => {
    const isLeaf = !concept.children?.length;
    const isOpen = open.has(concept.id);
    return (
      <div key={concept.id} className="tree-node" style={{ marginLeft: depth * 1.25 + "rem" }}>
        <button className="tree-row" onClick={() => toggle(concept, isLeaf)}>
          <span className="tree-caret">{isOpen ? "▾" : "▸"}</span>
          <span className="tree-label">{concept.label}</span>
          <span className="count">{concept.sectionCount}</span>
          <span className="tree-sites">
            {Object.entries(concept.siteCounts)
              .sort((a, b) => b[1] - a[1])
              .slice(0, 3)
              .map(([siteId, count]) => (
                <span className="badge plain" key={siteId}>
                  {siteTitles.get(siteId) ?? "…"} {count}
                </span>
              ))}
          </span>
        </button>
        {isOpen && concept.description && <p className="tree-desc">{concept.description}</p>}
        {isOpen && concept.children?.map((child) => renderConcept(child, depth + 1))}
        {isOpen && isLeaf && (
          <ul className="tree-sections">
            {(sectionsByConcept[concept.id] ?? []).map((s) => (
              <li key={s.id}>
                <PreviewLink
                  href={s.url}
                  siteId={s.siteId}
                  pageSlug={s.slug}
                  anchor={s.url.includes("#") ? s.url.split("#").pop()! : null}
                >
                  {s.title}
                </PreviewLink>
                <span className="muted"> — {siteTitles.get(s.siteId) ?? ""}</span>
              </li>
            ))}
            {!sectionsByConcept[concept.id] && <li className="muted">Loading…</li>}
          </ul>
        )}
      </div>
    );
  };

  return (
    <div>
      <h1>Knowledge tree</h1>
      <p className="muted">
        Concepts discovered by clustering section embeddings across every indexed site. Expand a concept to see the
        sections it groups — from all sites at once.
      </p>
      {error && <p className="error-text">{error}</p>}
      {tree === null && !error && <p className="muted">Loading…</p>}
      {tree?.length === 0 && <p className="muted">No concepts yet — the ontology builds after crawls complete.</p>}
      {tree?.map((c) => renderConcept(c, 0))}
    </div>
  );
}
