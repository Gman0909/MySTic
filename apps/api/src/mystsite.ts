import { createHash } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { asc, eq } from "drizzle-orm";
import {
  materializeOutputs,
  type MystFrontmatter,
  type MystNode,
  type XrefIndex,
  type XrefReference,
} from "@mystic/core";
import { attributionOf, embedAst, loadLivePage } from "./content.js";
import { schema, type Db } from "./db/index.js";

const { collections, collectionNodes } = schema;

/**
 * Serve a collection as a mystmd-built site would serve itself: a
 * `myst.xref.json` index plus one JSON document per item. That makes a
 * collection consumable by any MyST tool — including MySTic's own crawler, so
 * a collection can be indexed and curated from like any other site.
 *
 * Site root: <api>/api/c/<slug>
 */

type Node = typeof collectionNodes.$inferSelect;

/** Attribution as an mdast paragraph, prepended so the AST is self-describing. */
function attributionNode(attribution: ReturnType<typeof attributionOf>): MystNode {
  const children: MystNode[] = [
    { type: "text", value: "Embedded from " },
    { type: "link", url: attribution.sourceUrl, children: [{ type: "text", value: attribution.siteTitle }] },
  ];
  if (attribution.authors.length) children.push({ type: "text", value: ` · ${attribution.authors.join(", ")}` });
  if (attribution.license) children.push({ type: "text", value: ` · ${attribution.license}` });
  children.push({ type: "text", value: " · via MySTic" });
  return { type: "paragraph", class: "mystic-attribution", children: [{ type: "emphasis", children }] };
}

/** mdast node types that carry a referenceable label, mapped to their xref kind. */
function refKind(node: MystNode): string | null {
  switch (node.type) {
    case "heading":
      return "heading";
    case "container":
      return typeof node.kind === "string" ? node.kind : "figure";
    case "table":
      return "table";
    case "math":
      return "equation";
    default:
      return null;
  }
}

/**
 * Every label inside one item, as xref references.
 *
 * A real MyST site indexes its headings, figures, tables and equations, not
 * just its pages, and tools rely on it: it is what lets a client resolve
 * `<site>#some-label` without knowing which page holds it, or list every figure
 * on a site. Emitting only page references left those lookups failing.
 */
function labelRefs(ast: MystNode, nodeId: string): XrefReference[] {
  const refs: XrefReference[] = [];
  const seen = new Set<string>();
  const walk = (node: MystNode) => {
    const identifier = (node.html_id ?? node.identifier) as string | undefined;
    const kind = refKind(node);
    if (identifier && kind && !seen.has(identifier)) {
      seen.add(identifier);
      refs.push({
        kind,
        data: `/${nodeId}.json`,
        url: `/${nodeId}`,
        identifier,
        // Heading anchors are derived from the text rather than author-written.
        ...(kind === "heading" ? { implicit: true } : {}),
      });
    }
    node.children?.forEach(walk);
  };
  walk(ast);
  return refs;
}

/** Changes whenever the upstream content, the anchor, or the title override does. */
function nodeSha(node: Node, upstreamSha: string): string {
  return createHash("sha256")
    .update(`${upstreamSha}\n${node.anchor ?? ""}\n${node.title ?? ""}`)
    .digest("hex");
}

export function registerMystSiteRoutes(app: FastifyInstance, db: Db): void {
  /** Load a viewable collection and its content nodes, or null. */
  async function load(slug: string) {
    const [coll] = await db.select().from(collections).where(eq(collections.slug, slug));
    // Unlisted collections stay link-accessible; private ones are not served.
    if (!coll || coll.visibility === "private") return null;
    const nodes = await db
      .select()
      .from(collectionNodes)
      .where(eq(collectionNodes.collectionId, coll.id))
      .orderBy(asc(collectionNodes.position), asc(collectionNodes.createdAt));
    return { coll, nodes };
  }

  app.get<{ Params: { slug: string } }>("/api/c/:slug/myst.xref.json", async (req, reply) => {
    const loaded = await load(req.params.slug);
    if (!loaded) return reply.code(404).send({ error: "Collection not found" });
    const items = loaded.nodes.filter((n) => n.kind !== "part" && n.siteId && n.pageSlug);

    // Labels come from the same AST the item is served as, so the index can
    // never promise an anchor the page does not have. Items are resolved in
    // parallel and share the live-content cache; an item whose source is
    // unreachable still gets its page reference, just without its labels.
    const labelled = await Promise.all(
      items.map(async (node) => {
        const page = await loadLivePage(db, node.siteId!, node.pageSlug!).catch(() => null);
        if (!page) return [];
        const { mdast } = embedAst(page, node.kind === "section" ? node.anchor : null);
        return labelRefs(mdast, node.id);
      }),
    );

    const index: XrefIndex = {
      version: "1",
      myst: "1.10.1",
      references: [
        { kind: "page", data: "/index.json", url: "/" },
        ...items.map((n) => ({ kind: "page", data: `/${n.id}.json`, url: `/${n.id}` })),
        ...labelled.flat(),
      ],
    };
    return reply.send(index);
  });

  /** The landing page: collection metadata plus a table of contents. */
  app.get<{ Params: { slug: string } }>("/api/c/:slug/index.json", async (req, reply) => {
    const loaded = await load(req.params.slug);
    if (!loaded) return reply.code(404).send({ error: "Collection not found" });
    const { coll, nodes } = loaded;

    const byParent = new Map<string | null, Node[]>();
    for (const n of nodes) byParent.set(n.parentId, [...(byParent.get(n.parentId) ?? []), n]);
    const linkTo = (n: Node): MystNode => ({
      type: "listItem",
      children: [
        {
          type: "paragraph",
          children: [{ type: "link", url: `/${n.id}`, children: [{ type: "text", value: n.title ?? n.pageSlug ?? "Untitled" }] }],
        },
      ],
    });

    const body: MystNode[] = [];
    if (coll.description) body.push({ type: "paragraph", children: [{ type: "text", value: coll.description }] });
    for (const root of byParent.get(null) ?? []) {
      if (root.kind === "part") {
        body.push({ type: "heading", depth: 2, children: [{ type: "text", value: root.title ?? "Part" }] });
        body.push({ type: "list", ordered: false, children: (byParent.get(root.id) ?? []).map(linkTo) });
      } else {
        const last = body[body.length - 1];
        if (last?.type === "list") (last.children as MystNode[]).push(linkTo(root));
        else body.push({ type: "list", ordered: false, children: [linkTo(root)] });
      }
    }

    return reply.send({
      version: "1",
      kind: "Article",
      sha256: createHash("sha256").update(`${coll.updatedAt}\n${nodes.length}`).digest("hex"),
      slug: "index",
      frontmatter: {
        title: coll.name,
        description: coll.description ?? undefined,
      } satisfies MystFrontmatter,
      mdast: { type: "root", children: body },
    });
  });

  /** One item of the collection, live from its source site. */
  app.get<{ Params: { slug: string; file: string } }>("/api/c/:slug/:file", async (req, reply) => {
    const nodeId = req.params.file.replace(/\.json$/, "");
    if (nodeId === req.params.file) return reply.code(404).send({ error: "Not found" });
    const loaded = await load(req.params.slug);
    if (!loaded) return reply.code(404).send({ error: "Collection not found" });
    const node = loaded.nodes.find((n) => n.id === nodeId);
    if (!node || node.kind === "part" || !node.siteId || !node.pageSlug) {
      return reply.code(404).send({ error: "No such page in this collection" });
    }
    const page = await loadLivePage(db, node.siteId, node.pageSlug);
    if (!page) return reply.code(502).send({ error: "Source unreachable and no cached copy exists" });

    const anchor = node.kind === "section" ? node.anchor : null;
    const { mdast: sliced } = embedAst(page, anchor);
    const ast = materializeOutputs(sliced, page.site.url);
    const attribution = attributionOf(page, anchor);
    return reply.send({
      version: "1",
      kind: "Article",
      sha256: nodeSha(node, page.page.sha256),
      slug: node.id,
      frontmatter: {
        ...page.page.frontmatter,
        title: node.title ?? attribution.pageTitle,
      } satisfies MystFrontmatter,
      mdast: { type: "root", children: [attributionNode(attribution), ...(ast.children ?? [])] },
    });
  });
}
