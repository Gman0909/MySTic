// One-shot setup: checks prerequisites, installs dependencies, fetches the
// Meilisearch binary, and prepares a default .env.
import { copyFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { ROOT, sh, havePnpm, isWin } from "./lib.mjs";

console.log("MySTic setup\n============");

const major = Number(process.versions.node.split(".")[0]);
if (major < 20) {
  console.error(`✗ Node.js 20+ required (you have ${process.versions.node}). Install from https://nodejs.org`);
  process.exit(1);
}
console.log(`✓ Node.js ${process.versions.node}`);

if (!havePnpm()) {
  console.log("… pnpm not found, installing via npm");
  const r = spawnSync("npm", ["install", "-g", "pnpm@9"], { stdio: "inherit", shell: isWin });
  if (r.status !== 0 || !havePnpm()) {
    console.error("✗ Could not install pnpm. Install it manually (https://pnpm.io) and re-run.");
    process.exit(1);
  }
}
console.log("✓ pnpm");

console.log("… installing dependencies");
sh("pnpm", ["install"]);

console.log("… fetching Meilisearch binary");
sh("node", [join(ROOT, "scripts", "run-meili.mjs"), "--download-only"]);

const envFile = join(ROOT, ".env");
if (!existsSync(envFile)) {
  copyFileSync(join(ROOT, ".env.example"), envFile);
  console.log("✓ created .env from .env.example (edit it to change ports/keys)");
}

console.log(`
Setup complete. Next:

  pnpm start        start MySTic (http://localhost:3000)

On first start the bundled seed sites (seed/sites.json) are crawled and
embedded automatically — allow 10-20 minutes for the index to fill.
The first account you register becomes the instance administrator.`);
