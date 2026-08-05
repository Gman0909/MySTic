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
    case "link":
      return (
        <a href={resolveUrl(node.url as string, ctx)} target="_blank" rel="noreferrer">
          {children(node, ctx)}
        </a>
      );
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
      return (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={resolveUrl(node.url as string, ctx)}
          alt={(node.alt as string) ?? ""}
          className="myst-img"
          style={node.width ? { width: node.width as string } : undefined}
        />
      );
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
