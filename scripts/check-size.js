// every top-level folder except assets/ has to stay under 1 MB.
// (node_modules, dist and data are generated, so they don't count.)
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const LIMIT = 1024 * 1024;
const SKIP = new Set(["assets", "node_modules", "dist", "data", ".git"]);

function size(dir) {
  let total = 0;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    total += entry.isDirectory() ? size(full) : fs.statSync(full).size;
  }
  return total;
}

let failed = false;
for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
  if (!entry.isDirectory() || SKIP.has(entry.name)) continue;
  const bytes = size(path.join(root, entry.name));
  const ok = bytes < LIMIT;
  failed ||= !ok;
  console.log(`${ok ? "ok  " : "FAIL"} ${entry.name.padEnd(10)} ${(bytes / 1024).toFixed(1)} KB`);
}
process.exit(failed ? 1 : 0);
