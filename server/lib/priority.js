// priority search. searches hit outside apis (tmdb, youtube music, soundcloud,
// mangadex...), so only so many run at once. when they're all busy, new ones
// wait in line, and premium searches go to the front of it.
import { HttpError } from "./http.js";
import { memoryCritical } from "./memory.js";

/**
 * run(premium, fn) runs fn as soon as a slot is free. free searches give up
 * after `wait` ms in line, or right away when the line is already huge.
 */
export function createLane({ concurrent = 24, wait = 15_000, maxQueue = 300 } = {}) {
  let active = 0;
  const fast = [];
  const slow = [];

  const release = () => {
    const next = fast.shift() || slow.shift();
    if (next) next.start();
    else active--;
  };

  const acquire = (premium) => {
    // when the server is short on memory, free searches queue up behind premium ones
    const limit = memoryCritical() && !premium ? Math.ceil(concurrent / 2) : concurrent;
    if (active < limit && !fast.length && (premium || !slow.length)) {
      active++;
      return Promise.resolve();
    }
    if (!premium && slow.length >= maxQueue) {
      return Promise.reject(new HttpError(503, "search is really busy right now, try again in a few seconds"));
    }
    return new Promise((resolve, reject) => {
      const entry = {
        // a slot handed over by release(), so active stays the same
        start: () => {
          clearTimeout(entry.timer);
          resolve();
        },
      };
      if (premium) fast.push(entry);
      else {
        entry.timer = setTimeout(() => {
          const index = slow.indexOf(entry);
          if (index !== -1) slow.splice(index, 1);
          reject(new HttpError(503, "search is really busy right now, try again in a few seconds"));
        }, wait);
        slow.push(entry);
      }
    });
  };

  return async function run(premium, fn) {
    await acquire(premium);
    try {
      return await fn();
    } finally {
      release();
    }
  };
}
