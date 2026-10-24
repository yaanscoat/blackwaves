// movies & shows. metadata comes from tmdb and stream scraping is ported from
// x8rr/movies (https://github.com/x8rr/movies). the embed players (videasy,
// vidsrc, 2embed, vidlink) are picked on the client.
import { Readable } from "node:stream";
import { config } from "../config.js";
import { BROWSER_UA, publicFetch } from "../lib/net.js";
import { createCache } from "../lib/cache.js";
import { json, securityHeaders, text } from "../lib/http.js";

const TMDB = "https://api.themoviedb.org/3";
const TMDB_IMG = "https://image.tmdb.org/t/p/";
const tmdbCache = createCache({ max: 2000, ttl: 10 * 60 * 1000 });
const streamCache = createCache({ max: 300, ttl: 4 * 60 * 1000 });
const wasmCache = new Map();

class TmdbMissing extends Error {}

async function tmdb(path, params = {}) {
  if (!config.tmdbKey) throw new TmdbMissing("no key");
  const url = new URL(TMDB + path);
  // v4 read tokens are long jwt-looking things, v3 keys are 32 hex chars. support both.
  const bearer = config.tmdbKey.length > 40;
  if (!bearer) url.searchParams.set("api_key", config.tmdbKey);
  for (const [key, value] of Object.entries(params)) if (value != null && value !== "") url.searchParams.set(key, value);
  return tmdbCache.wrap(url.href, async () => {
    const response = await publicFetch(url, {
      headers: bearer ? { authorization: `Bearer ${config.tmdbKey}`, accept: "application/json" } : { accept: "application/json" },
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) {
      const error = new Error(`tmdb ${response.status}`);
      error.status = response.status;
      throw error;
    }
    return response.json();
  });
}

// ---- vidsrc scraper (from x8rr/movies providers.js) ------------------------------

async function getWasmModule(vs) {
  // the wasm only gets an empty import object, so all it can do is math on bytes
  if (vs.wasm_url) {
    const key = `u:${vs.w ?? vs.wasm_url}`;
    if (!wasmCache.has(key)) {
      wasmCache.set(
        key,
        publicFetch(vs.wasm_url, { signal: AbortSignal.timeout(10_000) })
          .then((response) => response.arrayBuffer())
          .then((bytes) => WebAssembly.compile(bytes)),
      );
    }
    return wasmCache.get(key);
  }
  if (vs.wasm) {
    const key = `b:${vs.w ?? vs.wasm.length}`;
    if (!wasmCache.has(key)) wasmCache.set(key, WebAssembly.compile(Buffer.from(vs.wasm, "base64")));
    return wasmCache.get(key);
  }
  return null;
}

async function decryptStreamUrls(encoded, vs) {
  const module = await getWasmModule(vs);
  if (!module) return null;
  const instance = await WebAssembly.instantiate(module, {});
  const { alloc, decrypt, memory } = instance.exports;
  const bytes = Buffer.from(encoded, "base64");
  const pointer = alloc(bytes.length);
  new Uint8Array(memory.buffer, pointer, bytes.length).set(bytes);
  const length = decrypt(pointer, bytes.length);
  return new TextDecoder().decode(new Uint8Array(memory.buffer, pointer + 12, length)).split("\n").filter(Boolean);
}

const vidsrcFetch = (url, referer) =>
  publicFetch(url, { headers: { "user-agent": BROWSER_UA, referer }, signal: AbortSignal.timeout(10_000) });

async function vidsrcExtract(type, id, season, episode) {
  try {
    const isTv = type !== "movie";
    const path = isTv ? `${id}/${season}/${episode}` : String(id);
    const api = await vidsrcFetch(`https://vidsrc.sh/vs_src.php?type=${isTv ? "tv" : "movie"}&id=${path}`, "https://vidsrc.sh/");
    const { src } = await api.json();
    if (!src) return [];
    const landing = await (await vidsrcFetch(src, "https://vidsrc.sh/")).text();
    const cfgMatch = landing.match(/window\.CFG\s*=\s*(\{[^}]+\})/);
    if (!cfgMatch) return [];
    const cfg = JSON.parse(cfgMatch[1]);
    const origin = new URL(src).origin;
    const player = await (await vidsrcFetch(origin + cfg.playerUrl, origin + "/")).text();
    const configMatch = player.match(/window\.CONFIG\s*=\s*(\{.*?\});/s);
    if (!configMatch) return [];
    const playerConfig = JSON.parse(configMatch[1]);
    if (!playerConfig.apiToken) return [];
    const token = encodeURIComponent(playerConfig.apiToken);
    const streamApi = isTv
      ? `https://data.vidsrc.sh/api.php?type=tv&tmdb=${id}&season=${season}&episode=${episode}&stream_urls&api_token=${token}`
      : `https://data.vidsrc.sh/api.php?type=movie&tmdb=${id}&stream_urls&api_token=${token}`;
    const data = await (await vidsrcFetch(streamApi, origin + "/")).json();
    if (String(data.status_code) !== "200" || !data.data) return [];

    let urls;
    if (typeof data.data.stream_urls === "string" && data.vs) urls = await decryptStreamUrls(data.data.stream_urls, data.vs);
    else if (Array.isArray(data.data.stream_urls)) urls = data.data.stream_urls;
    if (!urls?.length) return [];

    const hostTokens = new Map();
    const results = [];
    for (const raw of urls) {
      const host = new URL(raw).origin;
      if (!hostTokens.has(host)) {
        hostTokens.set(
          host,
          publicFetch(host + "/generate.php", { headers: { "user-agent": BROWSER_UA, accept: "application/json" }, signal: AbortSignal.timeout(8000) })
            .then((response) => response.text())
            .then((body) => {
              try {
                const parsed = JSON.parse(body);
                return typeof parsed === "string" ? parsed : parsed.token || parsed.data || parsed.string || parsed.result || "";
              } catch {
                return body.trim();
              }
            })
            .catch(() => ""),
        );
      }
      const hostToken = await hostTokens.get(host);
      const url = hostToken ? raw + (raw.includes("?") ? "&" : "?") + "token=" + hostToken : raw;
      results.push({ url, type: raw.includes(".m3u8") ? "hls" : "file", provider: "vidsrc" });
    }
    return results;
  } catch {
    return [];
  }
}

// ---- hls proxy: rewrites playlists so every segment comes back through us --------

function hlsProxyUrl(url, referer) {
  return `/api/movies/hls?u=${encodeURIComponent(url)}${referer ? `&r=${encodeURIComponent(referer)}` : ""}`;
}

function rewritePlaylist(body, base, referer) {
  const token = new URL(base).searchParams.get("token");
  const absolute = (value) => {
    let url = new URL(value, base).href;
    if (token && !url.includes("token=")) url += (url.includes("?") ? "&" : "?") + "token=" + token;
    return hlsProxyUrl(url, referer);
  };
  return body
    .split("\n")
    .map((line) => {
      const trimmed = line.trim();
      if (!trimmed) return line;
      if (trimmed.startsWith("#")) return line.replace(/URI="([^"]+)"/g, (_, uri) => `URI="${absolute(uri)}"`);
      return absolute(trimmed);
    })
    .join("\n");
}

async function hls(req, res, searchParams) {
  const target = searchParams.get("u") || "";
  const explicitReferer = searchParams.get("r") || "";
  try {
    const url = new URL(target);
    const referer = explicitReferer || url.origin + "/";
    const headers = { "user-agent": BROWSER_UA, referer, origin: new URL(referer).origin };
    if (req.headers.range) headers.range = req.headers.range;
    const upstream = await publicFetch(url, { headers, signal: AbortSignal.timeout(30_000) });
    const type = upstream.headers.get("content-type") || "";
    if (!upstream.ok && upstream.status !== 206) return text(res, upstream.status, "stream upstream error");
    if (type.includes("mpegurl") || /\.m3u8(\?|$)/.test(url.pathname)) {
      const playlist = rewritePlaylist(await upstream.text(), url.href, explicitReferer);
      return text(res, 200, playlist, { "Content-Type": "application/vnd.apple.mpegurl", "Cache-Control": "no-store" });
    }
    const out = { "Content-Type": type || "application/octet-stream", "Cache-Control": "public, max-age=600" };
    for (const name of ["content-length", "content-range", "accept-ranges"]) {
      const value = upstream.headers.get(name);
      if (value) out[name] = value;
    }
    res.writeHead(upstream.status, securityHeaders(out));
    if (!upstream.body) return res.end();
    Readable.fromWeb(upstream.body).on("error", () => res.destroy()).pipe(res);
  } catch {
    text(res, 502, "stream upstream error");
  }
}

async function image(req, res, size, path) {
  if (!/^(w92|w154|w185|w300|w342|w500|w780|w1280|original)$/.test(size) || !/^\/[A-Za-z0-9_.-]+\.(jpg|png|webp|svg)$/.test(path)) {
    return text(res, 400, "bad image");
  }
  try {
    const upstream = await publicFetch(TMDB_IMG + size + path, { signal: AbortSignal.timeout(15_000) });
    if (!upstream.ok) return text(res, upstream.status, "image error");
    res.writeHead(200, securityHeaders({
      "Content-Type": upstream.headers.get("content-type") || "image/jpeg",
      "Cache-Control": "public, max-age=604800, immutable",
    }));
    Readable.fromWeb(upstream.body).on("error", () => res.destroy()).pipe(res);
  } catch {
    text(res, 502, "image error");
  }
}

const ROUTES = [
  [/^\/search\/(movie|tv|multi)$/, (m, q) => tmdb(`/search/${m[1]}`, { query: q.get("query"), page: q.get("page"), include_adult: "false" })],
  [/^\/trending\/(all|movie|tv)\/(day|week)$/, (m, q) => tmdb(`/trending/${m[1]}/${m[2]}`, { page: q.get("page") })],
  [/^\/popular\/(movie|tv)$/, (m, q) => tmdb(`/${m[1]}/popular`, { page: q.get("page") })],
  [/^\/top\/(movie|tv)$/, (m, q) => tmdb(`/${m[1]}/top_rated`, { page: q.get("page") })],
  [/^\/genres\/(movie|tv)$/, (m) => tmdb(`/genre/${m[1]}/list`)],
  [
    /^\/discover\/(movie|tv)$/,
    (m, q) => tmdb(`/discover/${m[1]}`, { with_genres: q.get("genre"), page: q.get("page"), sort_by: "popularity.desc", include_adult: "false" }),
  ],
  [/^\/movie\/(\d+)$/, (m) => tmdb(`/movie/${m[1]}`, { append_to_response: "external_ids,credits,recommendations,videos" })],
  [/^\/tv\/(\d+)$/, (m) => tmdb(`/tv/${m[1]}`, { append_to_response: "external_ids,credits,recommendations,videos" })],
  [/^\/tv\/(\d+)\/season\/(\d+)$/, (m) => tmdb(`/tv/${m[1]}/season/${m[2]}`)],
  [/^\/stream\/movie\/(\d+)$/, (m) => streamCache.wrap(`m:${m[1]}`, () => vidsrcExtract("movie", m[1])).then(wrapStreams)],
  [
    /^\/stream\/tv\/(\d+)\/(\d+)\/(\d+)$/,
    (m) => streamCache.wrap(`t:${m[1]}:${m[2]}:${m[3]}`, () => vidsrcExtract("tv", m[1], m[2], m[3])).then(wrapStreams),
  ],
];

function wrapStreams(streams) {
  return {
    streams: streams.map((stream) => ({
      ...stream,
      url: hlsProxyUrl(stream.url),
    })),
  };
}

// ---- downloads: stitch an hls stream back into one file -------------------------------

async function fetchText(url, referer) {
  const response = await publicFetch(url, { headers: { "user-agent": BROWSER_UA, referer, origin: new URL(referer).origin }, signal: AbortSignal.timeout(20_000) });
  if (!response.ok) throw new Error(`playlist ${response.status}`);
  return response.text();
}

/**
 * picks the best variant of a master playlist, then streams every segment of
 * it back to back. mpeg-ts segments concatenate into a valid .ts file and fmp4
 * segments (with their init map first) into a valid .mp4, so no remuxing needed.
 */
async function download(req, res, searchParams) {
  const target = searchParams.get("u") || "";
  const name = String(searchParams.get("name") || "movie").replace(/[\/:*?"<>|]+/g, "").slice(0, 120) || "movie";
  let url;
  try {
    url = new URL(target);
  } catch {
    return text(res, 400, "bad link");
  }
  const referer = searchParams.get("r") || url.origin + "/";
  try {
    let playlistUrl = url.href;
    let playlist = await fetchText(playlistUrl, referer);
    if (!playlist.startsWith("#EXTM3U")) return text(res, 400, "that isn't a stream");
    if (playlist.includes("#EXT-X-STREAM-INF")) {
      const lines = playlist.split("\n");
      let best = null;
      for (let i = 0; i < lines.length; i++) {
        const bandwidth = /BANDWIDTH=(\d+)/.exec(lines[i]);
        if (bandwidth && lines[i + 1] && !lines[i + 1].startsWith("#")) {
          if (!best || Number(bandwidth[1]) > best.bandwidth) best = { bandwidth: Number(bandwidth[1]), uri: lines[i + 1].trim() };
        }
      }
      if (!best) return text(res, 502, "no playable quality found");
      playlistUrl = new URL(best.uri, playlistUrl).href;
      playlist = await fetchText(playlistUrl, referer);
    }
    if (/#EXT-X-KEY:METHOD=(?!NONE)/.test(playlist)) return text(res, 415, "this stream is encrypted and can't be downloaded");
    const parts = [];
    let fmp4 = false;
    for (const line of playlist.split("\n")) {
      const map = /#EXT-X-MAP:URI="([^"]+)"/.exec(line);
      if (map) {
        fmp4 = true;
        parts.push(new URL(map[1], playlistUrl).href);
      } else if (line.trim() && !line.startsWith("#")) parts.push(new URL(line.trim(), playlistUrl).href);
    }
    const ext = fmp4 ? "mp4" : "ts";
    const file = `${name}.${ext}`;
    res.writeHead(200, securityHeaders({
      "Content-Type": fmp4 ? "video/mp4" : "video/mp2t",
      "Content-Disposition": `attachment; filename="${file.replace(/[^\x20-\x7e]/g, "_")}"; filename*=UTF-8''${encodeURIComponent(file)}`,
      "Cache-Control": "no-store",
    }));
    let closed = false;
    res.on("close", () => (closed = true));
    // fetch a few segments ahead in parallel but write them strictly in order
    const AHEAD = 6;
    const grab = (part) => {
      const pending = publicFetch(part, { headers: { "user-agent": BROWSER_UA, referer }, signal: AbortSignal.timeout(60_000) }).then(async (segment) => {
        if (!segment.ok) throw new Error(`segment ${segment.status}`);
        return Buffer.from(await segment.arrayBuffer());
      });
      pending.catch(() => {}); // failures are handled when we get to that segment
      return pending;
    };
    const queue = parts.slice(0, AHEAD).map(grab);
    for (let index = 0; index < parts.length; index++) {
      if (closed) return;
      const next = index + AHEAD;
      if (next < parts.length) queue.push(grab(parts[next]));
      const body = await queue[index];
      queue[index] = null;
      if (!res.write(body)) await new Promise((resolve) => (res.once("drain", resolve), res.once("close", resolve)));
    }
    res.end();
  } catch {
    if (!res.headersSent) text(res, 502, "the download didn't start, try another source");
    else res.destroy();
  }
}

export async function handleMovies(req, res, pathname, searchParams) {
  const rest = pathname.slice("/api/movies".length);
  if (rest === "/hls") return hls(req, res, searchParams);
  if (rest === "/download") return download(req, res, searchParams);
  if (rest === "/status") return json(res, 200, { tmdb: Boolean(config.tmdbKey) });
  const img = /^\/img\/([a-z0-9]+)(\/[^/]+)$/.exec(rest);
  if (img) return image(req, res, img[1], img[2]);

  for (const [pattern, handler] of ROUTES) {
    const match = pattern.exec(rest);
    if (!match) continue;
    try {
      return json(res, 200, await handler(match, searchParams), { "Cache-Control": "public, max-age=120" });
    } catch (error) {
      if (error instanceof TmdbMissing) {
        return json(res, 503, { error: "movies need a TMDB_API_KEY set on the server", code: "NO_TMDB" });
      }
      return json(res, error.status === 404 ? 404 : 502, { error: "tmdb didn't answer, try again in a bit" });
    }
  }
  return json(res, 404, { error: "not found" });
}
