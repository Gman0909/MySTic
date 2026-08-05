"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import type { SiteSummary } from "@mystic/core";
import { useAuth } from "@/components/auth";
import { api } from "@/lib/api";

export default function AdminPage() {
  const { user, ready } = useAuth();
  const isAdmin = !!user?.isAdmin;
  const [sites, setSites] = useState<SiteSummary[]>([]);
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval>>(undefined);

  const refresh = useCallback(async () => {
    try {
      setSites(await api<SiteSummary[]>("/api/sites"));
    } catch (err) {
      setError((err as Error).message);
    }
  }, []);

  useEffect(() => {
    refresh();
    pollRef.current = setInterval(refresh, 2500);
    return () => clearInterval(pollRef.current);
  }, [refresh]);

  const addSite = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!url.trim()) return;
    setBusy(true);
    setError(null);
    try {
      await api("/api/sites", { method: "POST", body: JSON.stringify({ url: url.trim() }) });
      setUrl("");
      await refresh();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const recrawl = async (id: string) => {
    await api(`/api/sites/${id}/crawl`, { method: "POST" });
    await refresh();
  };

  const remove = async (id: string, title: string) => {
    if (!confirm(`Remove "${title}" and all its indexed content?`)) return;
    await api(`/api/sites/${id}`, { method: "DELETE" });
    await refresh();
  };

  return (
    <div>
      <h1>Indexed sites</h1>
      <p className="muted">Submit the base URL of any mystmd-built site. MySTic crawls its structured JSON — no HTML scraping.</p>
      {isAdmin ? (
        <form className="add-site" onSubmit={addSite}>
          <input
            placeholder="https://mystmd.org/guide"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            disabled={busy}
          />
          <button className="primary" disabled={busy || !url.trim()}>
            {busy ? "Validating…" : "Add site"}
          </button>
        </form>
      ) : (
        ready && (
          <p className="muted">
            Managing sites requires an administrator account.{" "}
            {!user && <Link href="/login">Sign in</Link>}
          </p>
        )
      )}
      {error && <p className="error-text">{error}</p>}
      <table>
        <thead>
          <tr>
            <th>Site</th>
            <th>Status</th>
            <th>Pages</th>
            <th>Last crawl</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {sites.map((s) => (
            <tr key={s.id}>
              <td>
                <strong>{s.title ?? s.url}</strong>
                <div className="muted" style={{ fontSize: "0.8rem" }}>
                  <a href={s.url} target="_blank" rel="noreferrer">
                    {s.url}
                  </a>
                </div>
                {s.error && <div className="error-text">{s.error}</div>}
              </td>
              <td>
                <span className={`status ${s.status}`}>{s.status}</span>
              </td>
              <td>{s.pageCount}</td>
              <td className="muted">{s.lastCrawledAt ? new Date(s.lastCrawledAt).toLocaleString() : "—"}</td>
              <td>
                {isAdmin && (
                  <div className="row-actions">
                    <button onClick={() => recrawl(s.id)} disabled={s.status === "crawling"}>
                      Recrawl
                    </button>
                    <button onClick={() => remove(s.id, s.title ?? s.url)}>Delete</button>
                  </div>
                )}
              </td>
            </tr>
          ))}
          {sites.length === 0 && (
            <tr>
              <td colSpan={5} className="muted">
                No sites yet — add one above.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
