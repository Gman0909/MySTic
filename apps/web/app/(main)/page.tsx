"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { SiteSummary } from "@mystic/core";
import { api } from "@/lib/api";

export default function HeroPage() {
  const router = useRouter();
  const [q, setQ] = useState("");
  const [stats, setStats] = useState<{ sites: number; sections: number } | null>(null);

  useEffect(() => {
    Promise.all([
      api<SiteSummary[]>("/api/sites"),
      api<{ facets: Record<string, Record<string, number>> }>("/api/search?q=&limit=1&mode=keyword"),
    ])
      .then(([sites, search]) => {
        const sections = Object.values(search.facets.siteId ?? {}).reduce((a, b) => a + b, 0);
        setStats({ sites: sites.filter((s) => s.status === "ready").length, sections });
      })
      .catch(() => {});
  }, []);

  const go = (e: React.FormEvent) => {
    e.preventDefault();
    router.push(q.trim() ? `/search?q=${encodeURIComponent(q.trim())}` : "/search");
  };

  return (
    <div className="hero">
      <div className="hero-mark" aria-hidden>
        ✦
      </div>
      <h1 className="hero-logo">
        MyST<span>ic</span>
      </h1>
      <p className="hero-strap">Search. Remix. Share.</p>
      <p className="hero-desc">
        One search box for every MyST site you care about. Find the exact section you need, drop it into a collection,
        and share a polished mini-site with your class or your lab — always up to date, because content streams live
        from its source.
      </p>
      <form className="hero-search" onSubmit={go}>
        <input
          autoFocus
          placeholder="Try “cleaning messy tabular data” or “how do cross-references work”…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <button className="primary" type="submit">
          Search
        </button>
      </form>
      {stats && (
        <p className="hero-stats">
          {stats.sections.toLocaleString()} sections across {stats.sites} MyST sites — searched by keyword and by
          meaning
        </p>
      )}
      <div className="hero-links">
        <Link href="/tree">Explore the knowledge tree →</Link>
        <Link href="/collections">Browse collections →</Link>
      </div>
    </div>
  );
}
