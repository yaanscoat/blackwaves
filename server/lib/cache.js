/** a boring ttl + lru map. boring is good. boring doesn't page you at 3am. */
export function createCache({ max = 500, ttl = 5 * 60 * 1000 } = {}) {
  const map = new Map();
  return {
    get(key) {
      const entry = map.get(key);
      if (!entry) return undefined;
      if (entry.expires < Date.now()) {
        map.delete(key);
        return undefined;
      }
      map.delete(key);
      map.set(key, entry);
      return entry.value;
    },
    set(key, value, customTtl = ttl) {
      if (map.has(key)) map.delete(key);
      else if (map.size >= max) map.delete(map.keys().next().value);
      map.set(key, { value, expires: Date.now() + customTtl });
      return value;
    },
    /** run fn once per key at a time and cache the result */
    async wrap(key, fn, customTtl = ttl) {
      const hit = this.get(key);
      if (hit !== undefined) return hit;
      const pending = this.get(`pending:${key}`);
      if (pending) return pending;
      const promise = Promise.resolve()
        .then(fn)
        .then(
          (value) => {
            map.delete(`pending:${key}`);
            this.set(key, value, customTtl);
            return value;
          },
          (error) => {
            map.delete(`pending:${key}`);
            throw error;
          },
        );
      map.set(`pending:${key}`, { value: promise, expires: Date.now() + 60_000 });
      return promise;
    },
  };
}
