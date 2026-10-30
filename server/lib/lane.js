// the search lane. searches hit outside apis (tmdb, youtube music, soundcloud,
// mangadex...), so only so many run at once. when they're all busy, new ones
// wait in line.
import { HttpError } from "./http.js";
import { memoryCritical } from "./memory.js";

const BUSY = "search is really busy right now, try again in a few seconds";

/**
 * run(fn) runs fn as soon as a slot is free. searches give up after `wait` ms
 * in line, or right away when the line is already huge.
 */
export function createLane({ concurrent = 24, wait = 15_000, maxQueue = 300 } = {}) {
  let active = 0;
  const queue = [];

  const release = () => {
    const next = queue.shift();
    if (next) next.start();
    else active--;
  };

  const acquire = () => {
    // when the server is short on memory, only half as many run at once
    const limit = memoryCritical() ? Math.ceil(concurrent / 2) : concurrent;
    if (active < limit && !queue.length) {
      active++;
      return Promise.resolve();
    }
    if (queue.length >= maxQueue) return Promise.reject(new HttpError(503, BUSY));
    return new Promise((resolve, reject) => {
      const entry = {
        // a slot handed over by release(), so active stays the same
        start: () => {
          clearTimeout(entry.timer);
          resolve();
        },
      };
      entry.timer = setTimeout(() => {
        const index = queue.indexOf(entry);
        if (index !== -1) queue.splice(index, 1);
        reject(new HttpError(503, BUSY));
      }, wait);
      queue.push(entry);
    });
  };

  return async function run(fn) {
    await acquire();
    try {
      return await fn();
    } finally {
      release();
    }
  };
}
