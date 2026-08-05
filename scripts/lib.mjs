// Shared helpers for the install/start/stop/update scripts.
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, openSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
export const PID_FILE = join(ROOT, ".data", "pids.json");
export const LOG_DIR = join(ROOT, ".data", "logs");
export const isWin = process.platform === "win32";

export function sh(command, args, opts = {}) {
  const result = spawnSync(command, args, { stdio: "inherit", shell: isWin, cwd: ROOT, ...opts });
  if (result.status !== 0) {
    console.error(`\n✗ ${command} ${args.join(" ")} failed (exit ${result.status})`);
    process.exit(result.status ?? 1);
  }
}

export function havePnpm() {
  return spawnSync("pnpm", ["--version"], { shell: isWin, stdio: "ignore" }).status === 0;
}

/** Spawn a long-running service detached, logging to .data/logs/<name>.log. */
export function launch(name, command, args, cwd) {
  mkdirSync(LOG_DIR, { recursive: true });
  const log = openSync(join(LOG_DIR, `${name}.log`), "a");
  const child = spawn(command, args, {
    cwd,
    shell: isWin,
    detached: !isWin,
    stdio: ["ignore", log, log],
    env: process.env,
  });
  child.unref();
  return child.pid;
}

export async function waitFor(url, label, timeoutMs = 180_000) {
  const start = Date.now();
  process.stdout.write(`  waiting for ${label} `);
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(2000) });
      if (res.ok) {
        console.log("✓");
        return;
      }
    } catch {
      // not up yet
    }
    process.stdout.write(".");
    await new Promise((r) => setTimeout(r, 1500));
  }
  console.error(`\n✗ ${label} did not become healthy within ${timeoutMs / 1000}s — check .data/logs/`);
  process.exit(1);
}

export function killPid(pid) {
  try {
    if (isWin) {
      // /T kills the whole tree (shell wrapper + node children).
      spawnSync("taskkill", ["/PID", String(pid), "/T", "/F"], { stdio: "ignore" });
    } else {
      try {
        process.kill(-pid, "SIGTERM"); // process group (detached)
      } catch {
        process.kill(pid, "SIGTERM");
      }
    }
    return true;
  } catch {
    return false;
  }
}

/**
 * Kill whatever is listening on a port. Windows shell-wrapper spawns break
 * taskkill's parent-pid tree, so port-based cleanup is the reliable fallback.
 */
export function killPort(port) {
  if (isWin) {
    spawnSync(
      "powershell",
      [
        "-NoProfile",
        "-Command",
        `Get-NetTCPConnection -LocalPort ${port} -State Listen -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess -Unique | ForEach-Object { Stop-Process -Id $_ -Force -ErrorAction SilentlyContinue }`,
      ],
      { stdio: "ignore" },
    );
  } else {
    spawnSync("sh", ["-c", `lsof -ti tcp:${port} 2>/dev/null | xargs -r kill 2>/dev/null`], { stdio: "ignore" });
  }
}
