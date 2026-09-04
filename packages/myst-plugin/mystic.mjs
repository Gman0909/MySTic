/**
 * mystmd plugin — embed a section curated in MySTic into your own MyST site.
 *
 *   :::{mystic} https://foundations.projectpythia.org/core.xarray.xarray-intro#introducing-xarray
 *   :api: https://mystic.example
 *   :::
 *
 * The directive drops a placeholder; a document-stage transform resolves every
 * placeholder in parallel against the MySTic instance and splices the returned
 * AST — plus an attribution line — into the page. Content is fetched at build
 * time, so the embedding site is a static build like any other.
 *
 * Written as dependency-free ESM: mystmd loads this file directly.
 */

const DEFAULT_TIMEOUT_MS = 15000;

/**
 * Work out which MySTic endpoint answers for `arg`.
 * Accepts a MySTic collection-item URL (…/c/<slug>/<nodeId>), a MySTic embed
 * API URL, or the source page's own public URL (resolved by the instance).
 */
function endpointFor(arg, api) {
  let url;
  try {
    url = new URL(arg);
  } catch {
    throw new Error(`"${arg}" is not a URL`);
  }
  if (url.pathname.includes("/api/embed/")) return url.toString();

  const collection = url.pathname.match(/^\/c\/([^/]+)\/([^/]+)\/?$/);
  if (collection) {
    const base = (api ?? url.origin).replace(/\/+$/, "");
    return `${base}/api/embed/c/${collection[1]}/${collection[2]}`;
  }

  if (!api) {
    throw new Error(
      `Embedding a source URL needs the MySTic instance: add ":api: https://your-mystic" to the {mystic} directive`,
    );
  }
  return `${api.replace(/\/+$/, "")}/api/embed/resolve?url=${encodeURIComponent(arg)}`;
}

/** "Embedded from Pythia Foundations · A. Author · CC-BY-4.0 · via MySTic" */
function attributionNode(attribution) {
  const children = [
    { type: "text", value: "Embedded from " },
    {
      type: "link",
      url: attribution.sourceUrl,
      children: [{ type: "text", value: attribution.siteTitle }],
    },
  ];
  if (attribution.authors?.length) children.push({ type: "text", value: ` · ${attribution.authors.join(", ")}` });
  if (attribution.license) children.push({ type: "text", value: ` · ${attribution.license}` });
  children.push({ type: "text", value: " · via MySTic" });
  return {
    type: "paragraph",
    class: "mystic-attribution",
    children: [{ type: "emphasis", children }],
  };
}

/** Collect every placeholder together with the parent that holds it. */
function findPlaceholders(tree) {
  const found = [];
  const walk = (node) => {
    if (!node || !Array.isArray(node.children)) return;
    for (const child of node.children) {
      if (child?.type === "mysticEmbed") found.push({ parent: node, node: child });
      else walk(child);
    }
  };
  walk(tree);
  return found;
}

const mysticDirective = {
  name: "mystic",
  doc: "Embed a section from another MyST site, resolved live through a MySTic instance.",
  arg: {
    type: String,
    required: true,
    doc: "A MySTic collection-item URL, a MySTic embed API URL, or the source page URL (with an optional #anchor).",
  },
  options: {
    api: {
      type: String,
      doc: "Base URL of the MySTic instance. Required unless the argument is already a MySTic URL.",
    },
    "no-attribution": {
      type: Boolean,
      doc: "Suppress the attribution line. Only do this if you credit the source some other way — most embedded content is licensed on the condition that it is attributed.",
    },
  },
  run(data) {
    return [
      {
        type: "mysticEmbed",
        url: data.arg,
        api: data.options?.api,
        attribution: !data.options?.["no-attribution"],
        children: [],
      },
    ];
  },
};

const mysticTransform = {
  name: "mystic-embed-fetch",
  doc: "Resolves {mystic} placeholders against a MySTic instance at build time.",
  stage: "document",
  plugin: () => async (tree, file) => {
    const placeholders = findPlaceholders(tree);
    if (placeholders.length === 0) return;

    const results = await Promise.all(
      placeholders.map(async ({ node }) => {
        try {
          const endpoint = endpointFor(node.url, node.api);
          const res = await fetch(endpoint, {
            headers: { accept: "application/json" },
            signal: AbortSignal.timeout(DEFAULT_TIMEOUT_MS),
          });
          if (!res.ok) {
            const body = await res.json().catch(() => ({}));
            throw new Error(body.error ?? `${res.status} ${res.statusText}`);
          }
          return { ok: true, payload: await res.json() };
        } catch (err) {
          return { ok: false, error: err instanceof Error ? err.message : String(err) };
        }
      }),
    );

    placeholders.forEach(({ parent, node }, i) => {
      const index = parent.children.indexOf(node);
      if (index === -1) return;
      const result = results[i];
      if (!result.ok) {
        file.message(`Could not embed ${node.url}: ${result.error}`, undefined, "mystic-embed-fetch");
        parent.children.splice(index, 1, {
          type: "paragraph",
          children: [{ type: "text", value: `[MySTic embed unavailable: ${node.url}]` }],
        });
        return;
      }
      const { mdast, attribution, anchor, anchorFound } = result.payload;
      if (anchor && anchorFound === false) {
        file.message(
          `No section "#${anchor}" on ${attribution.pageUrl} — embedded the whole page instead`,
          undefined,
          "mystic-embed-fetch",
        );
      }
      const embedded = Array.isArray(mdast?.children) ? mdast.children : [];
      const replacement = node.attribution ? [...embedded, attributionNode(attribution)] : embedded;
      parent.children.splice(index, 1, ...replacement);
    });
  },
};

const plugin = {
  name: "MySTic embeds",
  author: "MySTic",
  directives: [mysticDirective],
  transforms: [mysticTransform],
};

export default plugin;
