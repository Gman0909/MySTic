"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import type { Collection } from "@/lib/collections";

// Shared store so every mounted dropdown sees new collections immediately.
let cache: Collection[] = [];
let loaded = false;
const subscribers = new Set<(c: Collection[]) => void>();

async function refreshCollections(force = false): Promise<Collection[]> {
  if (loaded && !force) return cache;
  cache = await api<Collection[]>("/api/collections");
  loaded = true;
  subscribers.forEach((fn) => fn(cache));
  return cache;
}

export function AddToCollection(props: {
  siteId: string;
  pageSlug: string;
  anchor: string | null;
  title: string;
  pageTitle?: string;
}) {
  const [collections, setCollections] = useState<Collection[]>(cache);
  const [state, setState] = useState<"idle" | "adding" | "added">("idle");

  useEffect(() => {
    subscribers.add(setCollections);
    refreshCollections().catch(() => {});
    return () => {
      subscribers.delete(setCollections);
    };
  }, []);

  /** value format: "<section|page>:<collectionId|__new__>" */
  const add = async (value: string) => {
    const sep = value.indexOf(":");
    const mode = value.slice(0, sep) as "section" | "page";
    let target = value.slice(sep + 1);
    setState("adding");
    if (target === "__new__") {
      const name = prompt("New collection name");
      if (!name) return setState("idle");
      const created = await api<Collection>("/api/collections", { method: "POST", body: JSON.stringify({ name }) });
      await refreshCollections(true);
      target = created.id;
    }
    try {
      await api(`/api/collections/${target}/nodes`, {
        method: "POST",
        body: JSON.stringify({
          kind: mode,
          siteId: props.siteId,
          pageSlug: props.pageSlug,
          anchor: mode === "section" ? props.anchor : null,
          title: mode === "section" ? props.title : props.pageTitle ?? props.title,
        }),
      });
      setState("added");
      setTimeout(() => setState("idle"), 2000);
    } catch (err) {
      setState("idle");
      alert(`${(err as Error).message} — sign in from the account menu to curate collections.`);
    }
  };

  if (state === "added") return <span className="badge">✓ added</span>;

  const options = (mode: "section" | "page") => (
    <>
      {collections.map((c) => (
        <option key={`${mode}:${c.id}`} value={`${mode}:${c.id}`}>
          {c.name}
        </option>
      ))}
      <option value={`${mode}:__new__`}>＋ New collection…</option>
    </>
  );

  return (
    <select
      className="add-to-coll"
      value=""
      disabled={state === "adding"}
      onFocus={() => refreshCollections(true).catch(() => {})}
      onChange={(e) => e.target.value && add(e.target.value)}
      title="Add to a collection — a section embeds just this heading's content; a page embeds the entire source page"
    >
      <option value="">＋ Collection…</option>
      {props.anchor ? (
        <>
          <optgroup label={`This section only (“${props.title.slice(0, 40)}”)`}>{options("section")}</optgroup>
          <optgroup label="The whole page">{options("page")}</optgroup>
        </>
      ) : (
        options("page")
      )}
    </select>
  );
}
