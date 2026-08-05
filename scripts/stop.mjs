// Stops the services started by `pnpm start` (PIDs from .data/pids.json).
import { existsSync, readFileSync, rmSync } from "node:fs";
import { PID_FILE, killPid } from "./lib.mjs";

if (!existsSync(PID_FILE)) {
  console.log("No .data/pids.json — nothing started by `pnpm start` (or it was already stopped).");
  process.exit(0);
}

const pids = JSON.parse(readFileSync(PID_FILE, "utf8"));
for (const [name, pid] of Object.entries(pids)) {
  const ok = killPid(pid);
  console.log(`${ok ? "✓ stopped" : "· not running"} ${name} (pid ${pid})`);
}
rmSync(PID_FILE);
console.log("Done.");
