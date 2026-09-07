"use client";

import React from "react";
import katex from "katex";
import type { MystNode } from "@mystic/core";

/**
 * Lightweight renderer for MyST mdast trees. Covers the node types common in
 * documentation sites; unknown container nodes degrade to rendering their
 * children, so new upstream syntax never breaks a collection page.
 */

interface Ctx {
  /** Origin site base URL — relative links and images resolve against it. */
  baseUrl: string;
}

function resolveUrl(url: string | undefined, ctx: Ctx): string {
  if (!url) return "#";
  if (/^(https?:)?\/\//.test(url) || url.startsWith("#") || url.startsWith("mailto:")) return url;
  return `${ctx.baseUrl}${url.startsWith("/") ? "" : "/"}${url}`;
}

/** A link URL that is plainly an email address but carries no scheme. */
const EMAIL_LIKE = /^[^\s/@]+@[^\s/@]+\.[^\s/@]+$/;

/**
 * Images in an aggregated page point at assets on someone else's site, and
 * those rot: a rebuild changes the hash, or the source build failed to fetch
 * the original in the first place. mystmd keeps the original remote URL in
 * `urlSource`, so fall back to it before giving up.
 */
function Image_({ node, ctx }: { node: MystNode; ctx: Ctx }) {
  const primary = resolveUrl(node.url as string, ctx);
  const fallback = typeof node.urlSource === "string" ? node.urlSource : null;
  const [src, setSrc] = React.useState(primary);
  const [failed, setFailed] = React.useState(false);

  // A new node (navigation) must reset the retry state.
  React.useEffect(() => {
    setSrc(primary);
    setFailed(false);
  }, [primary]);

  if (failed) return null;
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={src}
      alt={(node.alt as string) ?? ""}
      className="myst-img"
      // Aggregated pages can carry a lot of full-size photography from the
      // source site; don't pull it all down before the reader scrolls there.
      loading="lazy"
      style={node.width ? { width: node.width as string } : undefined}
      onError={() => {
        if (fallback && src !== fallback) setSrc(fallback);
        else setFailed(true);
      }}
    />
  );
}

function Math_({ value, inline }: { value: string; inline: boolean }) {
  let html: string;
  try {
    html = katex.renderToString(value, { displayMode: !inline, throwOnError: false });
  } catch {
    return <code>{value}</code>;
  }
  return inline ? (
    <span dangerouslySetInnerHTML={{ __html: html }} />
  ) : (
    <div className="myst-math" dangerouslySetInnerHTML={{ __html: html }} />
  );
}

/** One entry of a Jupyter mime bundle as mystmd serialises it. */
interface MimeData {
  content_type: string;
  /** Inline payload (text/*, image/svg+xml). */
  content?: string;
  /** Site-relative path to an extracted binary asset (image/png, …). */
  path?: string;
}

interface JupyterData {
  output_type: string;
  name?: string;
  text?: string | string[];
  ename?: string;
  evalue?: string;
  traceback?: string | string[];
  data?: Record<string, MimeData>;
}

const IMAGE_MIMES = ["image/png", "image/jpeg", "image/gif", "image/webp"];

/** Tracebacks arrive with terminal colour codes. */
function stripAnsi(text: string): string {
  // eslint-disable-next-line no-control-regex
  return text.replace(/\u001b\[[0-9;]*m/g, "");
}

function joinText(text: string | string[] | undefined): string {
  return Array.isArray(text) ? text.join("") : text ?? "";
}

/**
 * Jupyter's schema says `traceback` is a list of frames, but mystmd serialises
 * it as one pre-joined string. Accept either.
 */
function joinLines(value: string | string[] | undefined): string {
  return Array.isArray(value) ? value.join("\n") : value ?? "";
}

/**
 * Rich HTML outputs (pandas/xarray reprs) come from third-party sites, so they
 * are sanitised before injection. DOMPurify is loaded lazily and only in the
 * browser: the output renders nothing until then rather than risking unsanitised
 * markup during SSR.
 */
function HtmlOutput({ html }: { html: string }) {
  const [clean, setClean] = React.useState<string | null>(null);
  React.useEffect(() => {
    let alive = true;
    void import("dompurify").then((mod) => {
      if (alive) setClean(mod.default.sanitize(html));
    });
    return () => {
      alive = false;
    };
  }, [html]);
  if (clean === null) return null;
  return <div className="myst-output-html" dangerouslySetInnerHTML={{ __html: clean }} />;
}

/** Render the richest representation available in a mime bundle. */
function MimeBundle({ data, ctx }: { data: Record<string, MimeData>; ctx: Ctx }) {
  const image = IMAGE_MIMES.find((mime) => data[mime]?.path || data[mime]?.content);
  if (image) {
    const entry = data[image]!;
    const src = entry.path
      ? resolveUrl(entry.path, ctx)
      : `data:${image};base64,${(entry.content ?? "").replace(/\s+/g, "")}`;
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={src} alt={data["text/plain"]?.content ?? "Output"} className="myst-output-img" />;
  }
  // Large HTML/SVG reprs are extracted to a file upstream (`path`, no
  // `content`); those can't be fetched from here (no CORS), so they fall
  // through to the plain-text representation below.
  const html = data["text/html"]?.content ?? data["image/svg+xml"]?.content;
  if (html) return <HtmlOutput html={html} />;
  const plain = data["text/plain"]?.content;
  if (plain) return <pre className="myst-output-text">{plain}</pre>;
  const kinds = Object.keys(data).join(", ");
  return <p className="muted myst-output-unsupported">Output not shown here ({kinds || "no data"}) — view on the source site.</p>;
}

function Output({ node, ctx }: { node: MystNode; ctx: Ctx }) {
  // Newer mystmd may pre-convert an output into child nodes; prefer those.
  if (node.children?.length) return <>{children(node, ctx)}</>;
  const data = node.jupyter_data as JupyterData | undefined;
  if (!data) return null;
  switch (data.output_type) {
    case "stream":
      return (
        <pre className={`myst-output-stream${data.name === "stderr" ? " stderr" : ""}`}>{joinText(data.text)}</pre>
      );
    case "error": {
      const traceback = stripAnsi(joinLines(data.traceback));
      return <pre className="myst-output-error">{traceback || `${data.ename ?? "Error"}: ${data.evalue ?? ""}`}</pre>;
    }
    default:
      return data.data ? <MimeBundle data={data.data} ctx={ctx} /> : null;
  }
}

function children(node: MystNode, ctx: Ctx): React.ReactNode {
  return node.children?.map((c, i) => <Node key={i} node={c} ctx={ctx} />);
}

function Node({ node, ctx }: { node: MystNode; ctx: Ctx }): React.ReactNode {
  switch (node.type) {
    case "text":
      return node.value;
    case "strong":
      return <strong>{children(node, ctx)}</strong>;
    case "emphasis":
      return <em>{children(node, ctx)}</em>;
    case "underline":
      return <u>{children(node, ctx)}</u>;
    case "delete":
      return <del>{children(node, ctx)}</del>;
    case "subscript":
      return <sub>{children(node, ctx)}</sub>;
    case "superscript":
      return <sup>{children(node, ctx)}</sup>;
    case "abbreviation":
      return <abbr title={(node.title as string) ?? undefined}>{children(node, ctx)}</abbr>;
    case "inlineCode":
      return <code>{node.value}</code>;
    case "link": {
      const raw = (node.url as string) ?? "";
      // Docs often write a bare address; without a scheme it would resolve
      // against the source site and 404.
      const href = EMAIL_LIKE.test(raw) ? `mailto:${raw}` : resolveUrl(raw, ctx);
      return (
        <a href={href} target="_blank" rel="noreferrer">
          {children(node, ctx)}
        </a>
      );
    }
    case "crossReference": {
      const href = node.url ? resolveUrl(node.url as string, ctx) : `${ctx.baseUrl}#${node.identifier ?? ""}`;
      return (
        <a href={href} target="_blank" rel="noreferrer" className="myst-xref">
          {node.children?.length ? children(node, ctx) : node.identifier}
        </a>
      );
    }
    case "heading": {
      const Tag = `h${Math.min((node.depth ?? 1) + 1, 6)}` as "h2";
      return <Tag id={(node.html_id ?? node.identifier) as string | undefined}>{children(node, ctx)}</Tag>;
    }
    case "paragraph":
      return <p>{children(node, ctx)}</p>;
    case "list":
      return node.ordered ? <ol>{children(node, ctx)}</ol> : <ul>{children(node, ctx)}</ul>;
    case "listItem":
      return <li>{children(node, ctx)}</li>;
    case "thematicBreak":
      return <hr />;
    case "blockquote":
      return <blockquote>{children(node, ctx)}</blockquote>;
    case "code":
      return (
        <pre className="myst-code" data-lang={(node.lang as string) ?? undefined}>
          <code>{node.value}</code>
        </pre>
      );
    case "image":
      return <Image_ node={node} ctx={ctx} />;
    case "container":
      return <figure className={`myst-figure myst-${node.kind ?? "figure"}`}>{children(node, ctx)}</figure>;
    case "caption":
      return <figcaption>{children(node, ctx)}</figcaption>;
    case "legend":
      return <figcaption className="myst-legend">{children(node, ctx)}</figcaption>;
    case "table":
      return (
        <div className="myst-table-wrap">
          <table>
            <tbody>{children(node, ctx)}</tbody>
          </table>
        </div>
      );
    case "tableRow":
      return <tr>{children(node, ctx)}</tr>;
    case "tableCell":
      return node.header ? <th>{children(node, ctx)}</th> : <td>{children(node, ctx)}</td>;
    case "admonition":
      return <aside className={`myst-admonition myst-${(node.kind as string) ?? "note"}`}>{children(node, ctx)}</aside>;
    case "admonitionTitle":
      return <div className="myst-admonition-title">{children(node, ctx)}</div>;
    case "math":
      return <Math_ value={(node.value as string) ?? ""} inline={false} />;
    case "inlineMath":
      return <Math_ value={(node.value as string) ?? ""} inline />;
    case "definitionList":
      return <dl>{children(node, ctx)}</dl>;
    case "definitionTerm":
      return <dt>{children(node, ctx)}</dt>;
    case "definitionDescription":
      return <dd>{children(node, ctx)}</dd>;
    case "tabSet":
      return <div className="myst-tabset">{children(node, ctx)}</div>;
    case "tabItem":
      return (
        <details className="myst-tabitem" open>
          <summary>{(node.title as string) ?? "Tab"}</summary>
          {children(node, ctx)}
        </details>
      );
    case "details":
      return <details>{children(node, ctx)}</details>;
    case "summary":
      return <summary>{children(node, ctx)}</summary>;
    case "card":
      return <div className="myst-card">{children(node, ctx)}</div>;
    case "cardTitle":
      return <div className="myst-card-title">{children(node, ctx)}</div>;
    case "grid":
      return <div className="myst-grid">{children(node, ctx)}</div>;
    case "footnoteReference":
      return <sup className="muted">[{(node.number as number) ?? "*"}]</sup>;
    case "footnoteDefinition":
      return (
        <div className="myst-footnote muted">
          <sup>[{(node.number as number) ?? "*"}]</sup> {children(node, ctx)}
        </div>
      );
    case "cite":
    case "citeGroup":
      return <span className="myst-cite">{node.children?.length ? children(node, ctx) : (node.label as string)}</span>;
    case "outputs":
      return node.children?.length ? <div className="myst-outputs">{children(node, ctx)}</div> : null;
    case "output":
      return <Output node={node} ctx={ctx} />;
    case "iframe":
      return (
        <p>
          <a href={resolveUrl(node.src as string, ctx)} target="_blank" rel="noreferrer">
            ▶ Embedded content (view on source site)
          </a>
        </p>
      );
    case "comment":
    case "mystComment":
    case "mystTarget":
    case "html":
      return null;
    case "block":
    case "root":
    default:
      // Unknown containers: render children so content never disappears.
      return node.children ? <>{children(node, ctx)}</> : null;
  }
}

export function Myst({ ast, baseUrl }: { ast: MystNode; baseUrl: string }) {
  return (
    <div className="myst-content">
      <Node node={ast} ctx={{ baseUrl }} />
    </div>
  );
}
