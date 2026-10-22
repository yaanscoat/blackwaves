import { createCache } from "./cache.js";
import { BROWSER_UA, publicFetch } from "./net.js";

const cache = createCache({ max: 4000, ttl: 5 * 60 * 1000 });

async function fromDuckDuckGo(query) {
  const response = await publicFetch(`https://duckduckgo.com/ac/?q=${encodeURIComponent(query)}&type=list`, {
    headers: { "user-agent": BROWSER_UA },
    signal: AbortSignal.timeout(3500),
  });
  if (!response.ok) throw new Error("ddg");
  const data = await response.json();
  return Array.isArray(data?.[1]) ? data[1] : [];
}

async function fromGoogle(query) {
  const response = await publicFetch(
    `https://suggestqueries.google.com/complete/search?client=firefox&q=${encodeURIComponent(query)}`,
    { headers: { "user-agent": BROWSER_UA }, signal: AbortSignal.timeout(3500) },
  );
  if (!response.ok) throw new Error("google");
  const data = await response.json();
  return Array.isArray(data?.[1]) ? data[1] : [];
}

export async function suggestions(raw) {
  const query = String(raw || "").trim().replace(/\s+/g, " ").slice(0, 120);
  if (!query) return [];
  return cache.wrap(query.toLowerCase(), async () => {
    let list = [];
    try {
      list = await fromDuckDuckGo(query);
    } catch {
      try {
        list = await fromGoogle(query);
      } catch {
        list = [];
      }
    }
    return [...new Set(list.filter((entry) => typeof entry === "string").map((entry) => entry.trim()).filter(Boolean))].slice(0, 8);
  });
}
