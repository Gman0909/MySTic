// End-to-end verification against a running instance.
//
//   pnpm start                                   # instance must be running
//   node scripts/verify.mjs                      # render + link checks
//   MYSTIC_TOKEN=<token> node scripts/verify.mjs # adds API contract checks
//   node scripts/verify.mjs --deep               # also check every outbound
//                                                # link inside rendered content
//
// Needs Playwright Chromium once: `pnpm exec playwright install chromium`.
// Exits non-zero if anything fails, so it can gate a release.
//
// The checks here exist because each of them caught a real bug:
//   render  — a notebook whose error output crashed the renderer, on 1 page of 18
//   links   — "View original" pointed at the page's data-file name, not its URL
//   api     — private collections must not leak through the newer endpoints
import { chromium } from "playwright";

const WEB = process.env.MYSTIC_URL ?? "http://localhost:3000";
const API = process.env.MYSTIC_API_URL ?? "http://localhost:4000";
const TOKEN = process.env.MYSTIC_TOKEN;
const DEEP = process.argv.includes("--deep");

const results = [];
function check(name, pass, detail = "") {
  results.push({ name, pass });
  console.log(`${pass ? "  ok  " : "  FAIL"} ${name}${detail ? ` — ${detail}` : ""}`);
}

async function api(path, { method = "GET", body, token } = {}) {
  const res = await fetch(API + path, {
    method,
    headers: {
      ...(body ? { "content-type": "application/json" } : {}),
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  let json = null;
  try {
    json = await res.json();
  } catch {}
  return { status: res.status, json };
}

if ((await api("/api/health")).status !== 200) {
  console.error(`No instance at ${API} — start one with \`pnpm start\`.`);
  process.exit(2);
}

// ---------------------------------------------------------------------------
// 1. API contract: error paths, and (with a token) access control.
// ---------------------------------------------------------------------------
console.log("\nAPI contract");
const sites = (await api("/api/sites")).json;
const site = sites.find((s) => s.status === "ready" && s.pageCount > 0);
const NONE = "00000000-0000-0000-0000-000000000000";

check("unknown site 404s", (await api(`/api/content/${NONE}/x`)).status === 404);
check("unknown embed 404s", (await api(`/api/embed/${NONE}/x`)).status === 404);
check("embed/resolve rejects a missing url", (await api("/api/embed/resolve")).status === 400);
check("embed/resolve rejects a non-URL", (await api("/api/embed/resolve?url=nope")).status === 400);
check(
  "embed/resolve 404s for an unindexed site",
  (await api(`/api/embed/resolve?url=${encodeURIComponent("https://example.com/x")}`)).status === 404,
);
check("unknown collection is not served as a site", (await api("/api/c/no-such-collection/myst.xref.json")).status === 404);
check("creating a collection requires auth", (await api("/api/collections", { method: "POST", body: { name: "x" } })).status === 401);

if (site) {
  // A ready site's own landing page exercises resolution and attribution.
  const probe = await api(`/api/embed/resolve?url=${encodeURIComponent(site.url)}`);
  check("embed/resolve finds an indexed site", probe.status === 200, `${site.url} -> ${probe.status}`);
  if (probe.status === 200) {
    check("embed carries attribution", !!probe.json.attribution?.siteTitle && !!probe.json.attribution?.pageUrl);
    check(
      "embed flattens notebook outputs for other tools",
      !JSON.stringify(probe.json.mdast ?? {}).includes('"type":"outputs"'),
    );
  }
}

if (TOKEN) {
  const created = await api("/api/collections", { method: "POST", token: TOKEN, body: { name: "verify.mjs probe" } });
  if (created.status !== 201) {
    check("MYSTIC_TOKEN is usable", false, `create returned ${created.status}`);
  } else {
    const coll = created.json;
    await api(`/api/collections/${coll.id}`, {
      method: "PATCH",
      token: TOKEN,
      body: { name: "verify.mjs probe", visibility: "private" },
    });
    const node = (
      await api(`/api/collections/${coll.id}/nodes`, {
        method: "POST",
        token: TOKEN,
        body: { kind: "part", title: "probe part", layout: "gallery" },
      })
    ).json;

    check("private collection hidden from anonymous readers", (await api(`/api/collections/slug/${coll.slug}`)).status === 404);
    check("private collection not served as a MyST site", (await api(`/api/c/${coll.slug}/myst.xref.json`)).status === 404);
    check("private collection cards not readable", (await api(`/api/collections/${coll.id}/cards`)).status === 404);
    check("private collection item not embeddable", (await api(`/api/embed/c/${coll.slug}/${node.id}`)).status === 404);
    check("owner can still read it", (await api(`/api/collections/slug/${coll.slug}`, { token: TOKEN })).status === 200);

    check("part layout persists", node.layout === "gallery", `layout=${node.layout}`);
    await api(`/api/collections/${coll.id}/nodes/${node.id}`, { method: "PATCH", token: TOKEN, body: { title: "renamed" } });
    const after = (await api(`/api/collections/${coll.id}`, { token: TOKEN })).json.nodes.find((n) => n.id === node.id);
    check("renaming a part keeps its layout", after.layout === "gallery" && after.title === "renamed");

    await api(`/api/collections/${coll.id}`, { method: "PATCH", token: TOKEN, body: { visibility: "unlisted" } });
    check("unlisted collection is served as a MyST site", (await api(`/api/c/${coll.slug}/myst.xref.json`)).status === 200);

    await api(`/api/collections/${coll.id}`, { method: "DELETE", token: TOKEN });
  }
} else {
  console.log("  (skipping access-control checks — set MYSTIC_TOKEN to include them)");
}

// ---------------------------------------------------------------------------
// 2. Render every item of every public collection, and check its source links.
// ---------------------------------------------------------------------------
const collections = (await api("/api/collections/public")).json;
console.log(`\nRendering ${collections.length} public collection(s)`);

const browser = await chromium.launch();
const browserPage = await browser.newPage({ viewport: { width: 1280, height: 900 } });
let runtimeErrors = [];
browserPage.on("pageerror", (e) => runtimeErrors.push(e.message));

const sourceLinks = new Map();
const contentLinks = new Map();
let renderFailures = 0;
let itemCount = 0;

for (const coll of collections) {
  const full = (await api(`/api/collections/slug/${coll.slug}`)).json;
  const items = full.nodes.filter((n) => n.kind !== "part");

  runtimeErrors = [];
  // Not networkidle: source sites serve large images that keep the network busy.
  await browserPage.goto(`${WEB}/c/${coll.slug}`, { waitUntil: "domcontentloaded", timeout: 60000 });
  await browserPage.waitForSelector(".coll-section", { timeout: 30000 }).catch(() => {});
  await browserPage.waitForTimeout(1500);
  if (runtimeErrors.length) {
    renderFailures++;
    check(`landing page: ${coll.slug}`, false, runtimeErrors[0]);
  }

  for (const item of items) {
    itemCount++;
    runtimeErrors = [];
    const label = `${coll.slug} / ${item.title ?? item.pageSlug}`;
    try {
      await browserPage.goto(`${WEB}/c/${coll.slug}/${item.id}`, { waitUntil: "domcontentloaded", timeout: 60000 });
      await browserPage.waitForSelector(".myst-content", { timeout: 30000 });
    } catch (e) {
      renderFailures++;
      check(label, false, `did not render: ${e.message.split("\n")[0]}`);
      continue;
    }
    await browserPage.waitForTimeout(1200);

    const state = await browserPage.evaluate(() => ({
      bodyLen: document.body.innerText.length,
      viewOriginal:
        [...document.querySelectorAll(".source-banner a")].find((a) => a.textContent?.includes("View original"))?.href ??
        null,
      links: [...document.querySelectorAll(".myst-content a[href]")]
        .map((a) => a.href)
        .filter((h) => /^https?:/.test(h) && !h.startsWith(location.origin)),
    }));

    const problems = [];
    if (runtimeErrors.length) problems.push(`runtime: ${runtimeErrors[0]}`);
    if (state.bodyLen < 400) problems.push(`rendered almost nothing (${state.bodyLen} chars)`);
    if (!state.viewOriginal) problems.push("no 'View original' link");
    if (problems.length) {
      renderFailures++;
      check(label, false, problems.join("; "));
    }
    if (state.viewOriginal) sourceLinks.set(state.viewOriginal, label);
    if (DEEP) for (const href of state.links) if (!contentLinks.has(href)) contentLinks.set(href, label);
  }

  // Gallery cards link back to their source too.
  const cards = (await api(`/api/collections/${coll.id}/cards`)).json;
  if (Array.isArray(cards)) for (const c of cards) if (c.sourceUrl) sourceLinks.set(c.sourceUrl, `${coll.slug} / card ${c.title}`);
}
await browser.close();
check(`every collection item renders (${itemCount} items)`, renderFailures === 0, `${renderFailures} failed`);

// ---------------------------------------------------------------------------
// 3. Links MySTic itself builds must resolve on the source site.
// ---------------------------------------------------------------------------
async function checkLinks(map, what) {
  const entries = [...map.entries()];
  const broken = [];
  let idx = 0;
  const worker = async () => {
    while (idx < entries.length) {
      const [href, label] = entries[idx++];
      try {
        const res = await fetch(href, { redirect: "follow", signal: AbortSignal.timeout(20000) });
        // Third parties block automated requests with these; not a broken link.
        if (res.status >= 400 && ![401, 403, 429].includes(res.status)) broken.push(`${res.status} ${href} (${label})`);
      } catch {
        // Transient network failures are not link rot; retry once, serially.
        try {
          const res = await fetch(href, { redirect: "follow", signal: AbortSignal.timeout(25000) });
          if (res.status >= 400 && ![401, 403, 429].includes(res.status)) broken.push(`${res.status} ${href} (${label})`);
        } catch (e) {
          broken.push(`unreachable ${href} (${label})`);
        }
      }
    }
  };
  await Promise.all(Array.from({ length: 6 }, worker));
  console.log(`\n${what}: ${entries.length} distinct URLs`);
  for (const b of broken.slice(0, 20)) console.log(`     ${b}`);
  return broken;
}

const brokenSource = await checkLinks(sourceLinks, "Source links MySTic builds");
check("every source link resolves", brokenSource.length === 0, `${brokenSource.length} broken`);

if (DEEP) {
  // Links written by the source authors — informational. Their rot is not our
  // bug, so this never fails the run.
  const brokenContent = await checkLinks(contentLinks, "Outbound links inside source content");
  console.log(`  (${brokenContent.length} broken links in third-party content — informational)`);
}

// ---------------------------------------------------------------------------
const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
if (failed.length) {
  console.log("FAILED: " + failed.map((f) => f.name).join(" | "));
  process.exit(1);
}
