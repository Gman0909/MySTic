import type { ExtractedSection, MystFrontmatter, MystNode } from "./types.js";

/** Node types whose text content is meaningless for search. */
const SKIP_TYPES = new Set(["comment", "mystComment", "image", "iframe", "cite", "footnoteDefinition"]);

/** Concatenate the visible text of a MyST mdast node. */
export function toText(node: MystNode): string {
  if (SKIP_TYPES.has(node.type)) return "";
  if (typeof node.value === "string" && node.type !== "html") return node.value;
  if (!node.children) return "";
  return node.children
    .map(toText)
    .filter(Boolean)
    .join(node.type === "root" || node.type === "block" ? "\n" : " ");
}

/**
 * mdast roots wrap content in `block` nodes; flatten one level so headings and
 * body content appear in a single ordered stream.
 */
function flattenBlocks(root: MystNode): MystNode[] {
  const out: MystNode[] = [];
  for (const child of root.children ?? []) {
    if (child.type === "block" && child.children) out.push(...child.children);
    else out.push(child);
  }
  return out;
}

/**
 * Split a page's mdast into sections by heading. The unit of search/curation.
 * - Content before the first heading becomes a "preamble" section titled after the page.
 * - Each heading (any depth) starts a new section; headingPath tracks ancestors.
 */
export function extractSections(mdast: MystNode, pageTitle: string): ExtractedSection[] {
  const nodes = flattenBlocks(mdast);
  const sections: ExtractedSection[] = [];
  // Stack of (depth, title) for ancestor headings.
  const stack: { depth: number; title: string }[] = [];
  let current: ExtractedSection = { anchor: null, headingPath: [pageTitle], title: pageTitle, depth: 0, text: "" };
  const parts: string[] = [];

  const flush = () => {
    current.text = parts.join("\n").replace(/\n{3,}/g, "\n\n").trim();
    if (current.text || current.anchor === null) sections.push(current);
    parts.length = 0;
  };

  for (const node of nodes) {
    if (node.type === "heading") {
      flush();
      const depth = node.depth ?? 1;
      const title = toText(node).trim() || "Untitled section";
      while (stack.length && stack[stack.length - 1]!.depth >= depth) stack.pop();
      stack.push({ depth, title });
      current = {
        anchor: (node.html_id ?? node.identifier ?? null) as string | null,
        headingPath: [pageTitle, ...stack.map((h) => h.title)],
        title,
        depth,
        text: "",
      };
    } else {
      const text = toText(node).trim();
      if (text) parts.push(text);
    }
  }
  flush();
  return sections;
}

/**
 * Extract the subtree for one section: the heading whose identifier/html_id
 * matches `anchor` plus everything until the next heading of equal-or-lower
 * depth. Returns null when the anchor isn't found.
 */
export function sliceSection(mdast: MystNode, anchor: string): MystNode | null {
  const nodes: MystNode[] = [];
  for (const child of mdast.children ?? []) {
    if (child.type === "block" && child.children) nodes.push(...child.children);
    else nodes.push(child);
  }
  const start = nodes.findIndex(
    (n) => n.type === "heading" && (n.html_id === anchor || n.identifier === anchor),
  );
  if (start === -1) return null;
  const depth = nodes[start]!.depth ?? 1;
  const slice: MystNode[] = [nodes[start]!];
  for (let i = start + 1; i < nodes.length; i++) {
    const n = nodes[i]!;
    if (n.type === "heading" && (n.depth ?? 1) <= depth) break;
    slice.push(n);
  }
  return { type: "root", children: slice };
}

/** Normalize the license field, which mystmd emits in a few shapes. */
export function licenseName(fm: MystFrontmatter): string | null {
  const lic = fm.license as Record<string, unknown> | undefined;
  if (!lic) return null;
  const pick = (o: unknown): string | null => {
    if (!o || typeof o !== "object") return null;
    const r = o as { id?: string; name?: string };
    return r.id ?? r.name ?? null;
  };
  return pick(lic.content) ?? pick(lic.code) ?? pick(lic);
}

/** Author display names from frontmatter. */
export function authorNames(fm: MystFrontmatter): string[] {
  return (fm.authors ?? []).map((a) => a?.name).filter((n): n is string => typeof n === "string" && n.length > 0);
}

/** Tags/keywords merged from frontmatter. */
export function pageTags(fm: MystFrontmatter): string[] {
  const tags = [...(fm.tags ?? []), ...(fm.keywords ?? [])];
  if (typeof fm.subject === "string" && fm.subject) tags.push(fm.subject);
  return [...new Set(tags.map((t) => String(t).trim()).filter(Boolean))];
}
