// Starts Meilisearch, the API, and the web app in the background.
// Logs go to .data/logs/, PIDs to .data/pids.json (used by `pnpm stop`).
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { ROOT, PID_FILE, launch, waitFor } from "./lib.mjs";

if (!existsSync(join(ROOT, "node_modules"))) {
  console.error("Dependencies missing — run `pnpm setup` first.");
  process.exit(1);
}

if (existsSync(PID_FILE)) {
  try {
    const res = await fetch("http://127.0.0.1:3000", { signal: AbortSignal.timeout(1500) });
    if (res.ok) {
      console.log("MySTic already appears to be running at http://localhost:3000 — run `pnpm stop` first.");
      process.exit(0);
    }
  } catch {
    // stale pid file, carry on
  }
}

console.log("Starting MySTic…");
const pids = {};

pids.meilisearch = launch("meilisearch", "node", [join(ROOT, "scripts", "run-meili.mjs")], ROOT);
await waitFor("http://127.0.0.1:7700/health", "Meilisearch");

pids.api = launch("api", "pnpm", ["exec", "tsx", "src/server.ts"], join(ROOT, "apps", "api"));
await waitFor("http://127.0.0.1:4000/api/health", "API");

pids.web = launch("web", "pnpm", ["exec", "next", "dev", "-p", "3000"], join(ROOT, "apps", "web"));
await waitFor("http://127.0.0.1:3000", "web app");

mkdirSync(join(ROOT, ".data"), { recursive: true });
writeFileSync(PID_FILE, JSON.stringify(pids, null, 2));

console.log(`
MySTic is running:

  App    http://localhost:3000
  API    http://localhost:4000
  Logs   .data/logs/

Stop with: pnpm stop`);
process.exit(0);
