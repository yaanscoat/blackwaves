import { signal } from "@preact/signals";
import { GAME_SOURCE_ADAPTERS, parseGameCatalog, gameCatalogErrorMessage, GameCatalogError } from "./sources.js";
import { getBlob, putBlob, storage } from "../storage.js";

// catalogs are big, so they live in indexeddb (encrypted) instead of localstorage
async function readCached(source) {
  try {
    const blob = await getBlob(`games:${source}`);
    return blob ? JSON.parse(await blob.text()) : null;
  } catch {
    return null;
  }
}

export const SOURCES = [
  { id: "all", name: "All sources" },
  { id: "gn-math", name: "gn-math" },
  { id: "seraph", name: "Seraph" },
  { id: "ugs", name: "UGS" },
  { id: "ckv", name: "CKV" },
  { id: "selenite", name: "Selenite" },
  { id: "truffled", name: "Truffled" },
  { id: "edurocks", name: "Edurocks" },
  { id: "wasm.rip", name: "wasm.rip" },
  { id: "velara", name: "Velara" },
];

const TTL = 6 * 60 * 60 * 1000;
const memory = new Map();
const pending = new Map();

export const favorites = signal([]);
export const recents = signal([]);

export function loadGameLists() {
  favorites.value = storage.get("gameFavorites", []);
  recents.value = storage.get("gameRecents", []);
}

export function normalize(value) {
  return String(value || "")
    .normalize("NFKD")
    .replace(/\p{M}+/gu, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

function rank(name, author, query, tokens) {
  if (name === query) return 0;
  if (name.startsWith(query)) return 1;
  if (tokens.every((token) => name.includes(token))) return 2;
  if (author.startsWith(query)) return 3;
  const both = `${name} ${author}`;
  return tokens.every((token) => both.includes(token)) ? 4 : -1;
}

export function searchGames(games, query) {
  const q = normalize(query);
  if (!q) return games;
  const tokens = q.split(" ");
  const buckets = [[], [], [], [], []];
  for (const game of games) {
    const r = rank(game._n, game._a, q, tokens);
    if (r >= 0) buckets[r].push(game);
  }
  return buckets.flat();
}

function prepare(games) {
  const seen = new Set();
  return games.filter((game) => {
    if (seen.has(game.gameUrl)) return false;
    seen.add(game.gameUrl);
    game._n = normalize(game.name);
    game._a = normalize(game.author);
    // some sources reuse ids, urls are the only thing that is actually unique
    game.key = `${game.sourceKey}:${game.gameUrl}`;
    return true;
  });
}

async function fetchSource(source) {
  const adapter = GAME_SOURCE_ADAPTERS[source];
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20_000);
  try {
    const response = await fetch(adapter.catalogUrl, { signal: controller.signal });
    if (!response.ok) {
      throw new GameCatalogError(`catalog request failed (${response.status})`, {
        kind: response.status >= 500 || response.status === 429 ? "temporary-source" : "unavailable",
        source,
        status: response.status,
      });
    }
    const body = await response.text();
    let payload = body;
    if (adapter.parseResponse) payload = await adapter.parseResponse(body, controller.signal);
    else {
      try {
        payload = JSON.parse(body);
      } catch {
        throw new GameCatalogError("catalog response could not be parsed", { kind: "upstream-data", source });
      }
    }
    return prepare(parseGameCatalog(source, payload));
  } catch (error) {
    if (error instanceof GameCatalogError) throw error;
    throw new GameCatalogError("network error", { kind: "network", source, cause: error });
  } finally {
    clearTimeout(timer);
  }
}

export async function loadSource(source, { force = false } = {}) {
  if (source === "all") {
    const results = await Promise.allSettled(SOURCES.filter((entry) => entry.id !== "all").map((entry) => loadSource(entry.id, { force })));
    const games = results.flatMap((result) => (result.status === "fulfilled" ? result.value : []));
    if (!games.length) throw new Error("none of the game sources answered, try again in a minute");
    return prepare(games).sort((a, b) => a.name.localeCompare(b.name));
  }

  if (!force) {
    const hot = memory.get(source);
    if (hot && hot.expires > Date.now()) return hot.games;
    const cached = await readCached(source);
    if (cached && cached.expires > Date.now() && Array.isArray(cached.games)) {
      const games = prepare(cached.games);
      memory.set(source, { games, expires: cached.expires });
      return games;
    }
  }
  if (pending.has(source)) return pending.get(source);
  const promise = fetchSource(source)
    .then((games) => {
      const expires = Date.now() + TTL;
      memory.set(source, { games, expires });
      const slim = games.map(({ id, name, author, coverUrl, gameUrl, isExternal, featured, sourceKey }) => ({
        id,
        name,
        author,
        coverUrl,
        gameUrl,
        isExternal,
        featured,
        sourceKey,
      }));
      void putBlob(`games:${source}`, new Blob([JSON.stringify({ expires, games: slim })], { type: "application/json" }));
      return games;
    })
    .catch(async (error) => {
      // stale beats nothing: if the source is down, show yesterday's list
      const stale = await readCached(source);
      if (stale?.games?.length) return prepare(stale.games);
      throw new Error(gameCatalogErrorMessage(error));
    })
    .finally(() => pending.delete(source));
  pending.set(source, promise);
  return promise;
}

function slimGame(game) {
  return { key: game.key, id: game.id, name: game.name, coverUrl: game.coverUrl, gameUrl: game.gameUrl, sourceKey: game.sourceKey, isExternal: game.isExternal };
}

export function toggleFavorite(game) {
  const exists = favorites.value.some((entry) => entry.key === game.key);
  favorites.value = exists ? favorites.value.filter((entry) => entry.key !== game.key) : [slimGame(game), ...favorites.value].slice(0, 200);
  storage.set("gameFavorites", favorites.value);
  return !exists;
}

export function isFavorite(game) {
  return favorites.value.some((entry) => entry.key === game.key);
}

export function addRecent(game) {
  recents.value = [slimGame(game), ...recents.value.filter((entry) => entry.key !== game.key)].slice(0, 24);
  storage.set("gameRecents", recents.value);
}
