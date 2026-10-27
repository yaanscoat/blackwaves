// keeps the whole process (worker threads included) inside MEMORY_BUDGET_MB,
// 3gb unless you say otherwise. every few seconds it checks real memory use:
//   ok        under 65% of the budget, nothing to do
//   tight     caches get emptied so the garbage collector can hand memory back
//   critical  over 85%: caches emptied and new proxy streams are refused until
//             things calm down. people already connected keep working.
import { config } from "../config.js";

const budget = config.memoryBudgetMb * 1024 * 1024;
const shedders = new Set();
let level = "ok";
let peak = 0;

/** fn(level) runs whenever memory is tight or critical: drop whatever you can rebuild */
export function onPressure(fn) {
  shedders.add(fn);
  return () => shedders.delete(fn);
}

// reading rss is a cheap syscall, so hot paths (a new proxy stream) can ask for
// a fresh answer instead of trusting one that's up to five seconds old
let lastCheck = 0;
function fresh() {
  if (Date.now() - lastCheck > 1000) check();
  return level;
}

export const memoryLevel = () => fresh();
export const memoryCritical = () => fresh() === "critical";

export function memoryStats() {
  const rss = process.memoryUsage.rss();
  return { rssMb: Math.round(rss / 1048576), peakMb: Math.round(peak / 1048576), budgetMb: config.memoryBudgetMb, level };
}

function check() {
  lastCheck = Date.now();
  const rss = process.memoryUsage.rss();
  peak = Math.max(peak, rss);
  const next = rss > budget * 0.85 ? "critical" : rss > budget * 0.65 ? "tight" : "ok";
  if (next !== "ok") {
    for (const shed of shedders) {
      try {
        shed(next);
      } catch {}
    }
  }
  if (next !== level) {
    const mb = Math.round(rss / 1048576);
    if (next === "ok") console.log(`memory back to normal (${mb}mb of ${config.memoryBudgetMb}mb)`);
    else console.warn(`memory ${next}: ${mb}mb of ${config.memoryBudgetMb}mb, shedding caches${next === "critical" ? " and pausing new proxy streams" : ""}`);
  }
  level = next;
}

setInterval(check, 5000).unref();
