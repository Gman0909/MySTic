// Downloads (once) and runs the official Meilisearch binary for local dev.
// Production uses the getmeili/meilisearch Docker image instead (docker-compose.yml).
import { existsSync, mkdirSync } from "node:fs";
import { spawn } from "node:child_process";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const VERSION = "v1.15.2"; // >= v1.13 required: vector/hybrid search GA
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const dir = join(root, ".meili");
const isWin = process.platform === "win32";
const bin = join(dir, `meilisearch-${VERSION}${isWin ? ".exe" : ""}`);

const assets = {
  win32: "meilisearch-windows-amd64.exe",
  linux: "meilisearch-linux-amd64",
  darwin: process.arch === "arm64" ? "meilisearch-macos-apple-silicon" : "meilisearch-macos-amd64",
};

if (!existsSync(bin)) {
  const asset = assets[process.platform];
  if (!asset) throw new Error(`Unsupported platform: ${process.platform}`);
  const url = `https://github.com/meilisearch/meilisearch/releases/download/${VERSION}/${asset}`;
  console.log(`Downloading Meilisearch ${VERSION} from ${url} ...`);
  mkdirSync(dir, { recursive: true });
  const res = await fetch(url, { redirect: "follow" });
  if (!res.ok) throw new Error(`Download failed: ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  const { writeFileSync, chmodSync } = await import("node:fs");
  writeFileSync(bin, buf);
  if (!isWin) chmodSync(bin, 0o755);
  console.log(`Saved ${(buf.length / 1e6).toFixed(1)} MB to ${bin}`);
}

if (process.argv.includes("--download-only")) {
  console.log("Meilisearch binary ready.");
  process.exit(0);
}

const masterKey = process.env.MEILI_MASTER_KEY ?? "mystic-dev-master-key";
const child = spawn(
  bin,
  ["--db-path", join(dir, "data"), "--http-addr", "127.0.0.1:7700", "--master-key", masterKey, "--env", "development"],
  { stdio: "inherit" },
);
child.on("exit", (code) => process.exit(code ?? 0));
