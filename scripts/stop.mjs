// Stops the services started by `pnpm start`: kills recorded PIDs, then
// sweeps the service ports to catch children that survived tree kills.
import { existsSync, readFileSync, rmSync } from "node:fs";
import { PID_FILE, killPid, killPort } from "./lib.mjs";

const PORTS = {
  web: 3000,
  api: Number(process.env.API_PORT ?? 4000),
  meilisearch: 7700,
};

if (existsSync(PID_FILE)) {
  const pids = JSON.parse(readFileSync(PID_FILE, "utf8"));
  for (const [name, pid] of Object.entries(pids)) {
    killPid(pid);
    console.log(`✓ stopped ${name} (pid ${pid})`);
  }
  rmSync(PID_FILE);
}

for (const port of Object.values(PORTS)) killPort(port);

// Verify nothing still answers.
await new Promise((r) => setTimeout(r, 1000));
let leftovers = 0;
for (const [name, port] of Object.entries(PORTS)) {
  try {
    await fetch(`http://127.0.0.1:${port}`, { signal: AbortSignal.timeout(1200) });
    console.error(`✗ ${name} still responding on :${port}`);
    leftovers++;
  } catch {
    // good — nothing listening
  }
}
console.log(leftovers ? "Some services survived — check Task Manager." : "All services stopped.");
process.exit(leftovers ? 1 : 0);
