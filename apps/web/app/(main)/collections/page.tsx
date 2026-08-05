"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useAuth } from "@/components/auth";
import { api } from "@/lib/api";
import type { Collection } from "@/lib/collections";

export default function CollectionsPage() {
  const { user, ready } = useAuth();
  const [collections, setCollections] = useState<Collection[]>([]);
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);

  const refresh = () => api<Collection[]>("/api/collections").then(setCollections).catch((e) => setError(e.message));
  useEffect(() => {
    if (ready) refresh();
  }, [ready, user?.id]);

  const create = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    await api("/api/collections", { method: "POST", body: JSON.stringify({ name: name.trim() }) });
    setName("");
    refresh();
  };

  return (
    <div>
      <h1>Collections</h1>
      <p className="muted">
        Curated packages of content from across the indexed sites. Each collection renders as its own mini-site that
        embeds upstream content live.
      </p>
      {user ? (
        <form className="add-site" onSubmit={create}>
          <input placeholder="New collection name…" value={name} onChange={(e) => setName(e.target.value)} />
          <button className="primary" disabled={!name.trim()}>
            Create
          </button>
        </form>
      ) : (
        ready && (
          <p className="muted">
            Showing public collections. <Link href="/login">Sign in</Link> to create and manage your own.
          </p>
        )
      )}
      {error && <p className="error-text">{error}</p>}
      <table>
        <thead>
          <tr>
            <th>Collection</th>
            <th>Visibility</th>
            <th>Updated</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {collections.map((c) => (
            <tr key={c.id}>
              <td>
                <strong>{c.name}</strong>
                {c.description && <div className="muted" style={{ fontSize: "0.85rem" }}>{c.description}</div>}
              </td>
              <td>
                <span className="badge plain">{c.visibility}</span>
              </td>
              <td className="muted">{new Date(c.updatedAt).toLocaleString()}</td>
              <td>
                <div className="row-actions">
                  {user && (
                    <Link href={`/collections/${c.id}`}>
                      <button>Edit</button>
                    </Link>
                  )}
                  <a href={`/c/${c.slug}`} target="_blank" rel="noreferrer">
                    <button>View site</button>
                  </a>
                </div>
              </td>
            </tr>
          ))}
          {collections.length === 0 && (
            <tr>
              <td colSpan={4} className="muted">
                No collections yet — create one above, then add search results to it.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
