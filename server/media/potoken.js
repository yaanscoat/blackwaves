// talks to potoken-worker.js. mint(binding) gives you a token for a video id
// (or the session, with no argument), plus the visitor data it belongs to.
import { Worker } from "node:worker_threads";

let worker = null;
let counter = 0;
const pending = new Map();

function spawn() {
  worker = new Worker(new URL("./potoken-worker.js", import.meta.url));
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
