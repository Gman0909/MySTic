"use client";

import { useEffect, useRef, useState } from "react";
import { sliceSection, type MystNode } from "@mystic/core";
import { api } from "@/lib/api";
import { Myst } from "@/components/Myst";

interface LiveContent {
  siteTitle: string;
  siteUrl: string;
  pageUrl: string;
  mdast: MystNode;
}

// Client-side cache of fetched page ASTs (the API adds its own 5-min upstream cache).
const pageCache = new Map<string, Promise<LiveContent>>();

function fetchPage(siteId: string, pageSlug: string): Promise<LiveContent> {
  const key = `${siteId}\n${pageSlug}`;
  let p = pageCache.get(key);
  if (!p) {
    p = api<LiveContent>(`/api/content/${siteId}/${pageSlug}`);
    pageCache.set(key, p);
    p.catch(() => pageCache.delete(key));
  }
  return p;
}

/** First ~N top-level nodes — keeps preview DOM small for long pages. */
function previewAst(mdast: MystNode, anchor: string | null, maxNodes = 12): MystNode {
  let root = anchor ? sliceSection(mdast, anchor) ?? mdast : mdast;
  const flat: MystNode[] = [];
  for (const child of root.children ?? []) {
    if (child.type === "block" && child.children) flat.push(...child.children);
    else flat.push(child);
  }
  return { type: "root", children: flat.slice(0, maxNodes) };
}

/**
 * A link that shows a MyST-style hover preview of the target content,
 * rendered live from the source site's AST. External links open the source
 * site in a new tab; `internal` links navigate within MySTic (collection TOCs).
 */
export function PreviewLink(props: {
  href: string;
  siteId: string;
  pageSlug: string;
  anchor: string | null;
  internal?: boolean;
  children: React.ReactNode;
}) {
  const [preview, setPreview] = useState<{ content: LiveContent; ast: MystNode } | null>(null);
  const [visible, setVisible] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number; above: boolean }>({ top: 0, left: 0, above: false });
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const anchorRef = useRef<HTMLSpanElement>(null);

  const show = () => {
    clearTimeout(timer.current);
    timer.current = setTimeout(async () => {
      try {
        const content = await fetchPage(props.siteId, props.pageSlug);
        const el = anchorRef.current;
        if (!el) return;
        const rect = el.getBoundingClientRect();
        const above = rect.bottom + 360 > window.innerHeight && rect.top > 380;
        setPos({
          top: above ? rect.top - 8 : rect.bottom + 8,
          left: Math.min(rect.left, Math.max(8, window.innerWidth - 580)),
          above,
        });
        setPreview({ content, ast: previewAst(content.mdast, props.anchor) });
        setVisible(true);
      } catch {
        // no preview on fetch failure — the link still works
      }
    }, 350);
  };

  const hide = () => {
    clearTimeout(timer.current);
    setVisible(false);
  };

  useEffect(() => () => clearTimeout(timer.current), []);

  return (
    <span ref={anchorRef} onMouseEnter={show} onMouseLeave={hide} className="preview-wrap">
      {props.internal ? (
        <a href={props.href}>{props.children}</a>
      ) : (
        <a href={props.href} target="_blank" rel="noreferrer">
          {props.children}
        </a>
      )}
      {visible && preview && (
        <div
          className={`hover-preview ${pos.above ? "above" : ""}`}
          style={{ top: pos.top, left: pos.left }}
          aria-hidden
        >
          <div className="hover-preview-head">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              className="hover-preview-favicon"
              src={`${preview.content.siteUrl}/favicon.ico`}
              alt=""
              onError={(e) => {
                e.currentTarget.style.display = "none";
              }}
            />
            {preview.content.siteTitle}
          </div>
          <div className="hover-preview-body">
            <Myst ast={preview.ast} baseUrl={preview.content.siteUrl} />
          </div>
        </div>
      )}
    </span>
  );
}
