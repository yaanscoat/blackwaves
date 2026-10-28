// talks to potoken-worker.js. mint(binding) gives you a token for a video id
// (or the session, with no argument), plus the visitor data it belongs to.
import { Worker } from "node:worker_threads";

let worker = null;
let counter = 0;
let idle = null;
const pending = new Map();
// the worker carries a whole fake browser (jsdom, ~400mb), and the tv/vision pro
// clients don't need tokens at all, so it only lives while something uses it
const IDLE_MS = 3 * 60 * 1000;

function rest() {
  clearTimeout(idle);
  idle = setTimeout(() => {
    if (pending.size) return rest();
    worker?.terminate();
    worker = null;
  }, IDLE_MS);
  idle.unref?.();
}

function spawn() {
  // capped so a misbehaving fake browser can't eat the whole memory budget
  worker = new Worker(new URL("./potoken-worker.js", import.meta.url), { resourceLimits: { maxOldGenerationSizeMb: 320 } });
  worker.unref();
  worker.on("message", ({ id, error, ...result }) => {
    const entry = pending.get(id);
    if (!entry) return;
    pending.delete(id);
    clearTimeout(entry.timer);
    if (error) entry.reject(new Error(error));
    else entry.resolve(result);
  });
  worker.on("error", (error) => {
    for (const entry of pending.values()) entry.reject(error);
    pending.clear();
    worker = null;
  });
  worker.on("exit", () => (worker = null));
}

export function mint(binding = "") {
  if (!worker) spawn();
  rest();
  const id = ++counter;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error("po token timed out"));
    }, 20_000);
    pending.set(id, { resolve, reject, timer });
    worker.postMessage({ id, binding });
  });
}
