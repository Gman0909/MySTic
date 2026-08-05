// Pulls the latest code and refreshes dependencies.
// Database migrations run automatically the next time the API starts.
import { existsSync } from "node:fs";
import { join } from "node:path";
import { ROOT, PID_FILE, sh } from "./lib.mjs";

console.log("Updating MySTic…");
sh("git", ["pull", "--ff-only"]);
sh("pnpm", ["install"]);
sh("node", [join(ROOT, "scripts", "run-meili.mjs"), "--download-only"]);

console.log(`
Update complete.${existsSync(PID_FILE) ? " MySTic seems to be running — restart it:\n\n  pnpm stop\n  pnpm start" : " Start it with: pnpm start"}`);
