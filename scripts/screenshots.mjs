// Captures the README screenshots from a running local instance with
// Playwright Chromium (install once: `pnpm exec playwright install chromium`).
//
//   pnpm start                                # instance must be running
//   MYSTIC_TOKEN=<auth token> node scripts/screenshots.mjs
//
// MYSTIC_TOKEN (optional) enables the signed-in shots (editor, admin panel).
import { mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(ROOT, "docs", "screenshots");
mkdirSync(OUT, { recursive: true });

const BASE = process.env.MYSTIC_URL ?? "http://localhost:3000";
const TOKEN = process.env.MYSTIC_TOKEN;

const browser = await chromium.launch();
const context = await browser.newContext({
  viewport: { width: 1440, height: 900 },
  deviceScaleFactor: 1.25,
  colorScheme: "dark",
});
if (TOKEN) {
  await context.addInitScript((t) => localStorage.setItem("mystic-token", t), TOKEN);
}
const page = await context.newPage();

async function shot(name, path, { settle = 2500, prepare } = {}) {
  await page.goto(`${BASE}${path}`, { waitUntil: "networkidle", timeout: 60_000 });
  await page.waitForTimeout(settle);
  if (prepare) await prepare();
  await page.screenshot({ path: join(OUT, `${name}.png`) });
  console.log(`✓ ${name}.png`);
}

await shot("hero", "/");
await shot("search", "/search?q=cleaning%20messy%20tabular%20data", { settle: 3500 });
await shot("tree", "/tree", {
  settle: 3000,
  prepare: async () => {
    await page.locator(".tree-row").nth(4).click();
    await page.waitForTimeout(1200);
  },
});

// Collection content page: first content node of the first public collection.
const coll = await page.evaluate(async () => {
  const list = await fetch("http://localhost:4000/api/collections/public").then((x) => x.json());
  if (!list.length) return null;
  const full = await fetch(`http://localhost:4000/api/collections/slug/${list[0].slug}`).then((x) => x.json());
  const node = full.nodes.find((n) => n.kind !== "part");
  return { slug: full.slug, id: full.id, nodeId: node?.id };
});
if (coll?.nodeId) {
  await shot("collection", `/c/${coll.slug}/${coll.nodeId}`, { settle: 4000 });
}

if (TOKEN && coll) {
  await shot("editor", `/collections/${coll.id}`, { settle: 3000 });
} else {
  console.log("· skipped editor shot (no MYSTIC_TOKEN)");
}

await browser.close();
console.log(`Saved to ${OUT}`);
