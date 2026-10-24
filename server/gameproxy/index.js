import zlib from "node:zlib";
import { Readable } from "node:stream";
import { WebSocket, WebSocketServer } from "ws";
import { BROWSER_UA, assertPublicUrl, isPublicIp, publicFetch } from "../lib/net.js";
import { parseCookies, securityHeaders } from "../lib/http.js";
import { COVER_PREFIX, PROXY_PREFIX, decodeTarget, encodeTarget, proxyUrl } from "./encoding.js";
import { rewriteCss, rewriteHtml } from "./rewrite.js";
import dns from "node:dns/promises";

const BLOCKLIST = [
  "google-analytics.com",
  "googletagmanager.com",
  "doubleclick.net",
  "googlesyndication.com",
  "adsbygoogle",
  "js.rev.iq",
  "motorsnag.com",
  "monetag",
  "netpub",
  "amazon-adsystem.com",
  "adnxs.com",
  "pubmatic.com",
  "clarity.ms",
  "hotjar.com",
];

const DROP_RESPONSE_HEADERS = new Set([
  "connection",
  "content-length",
  "transfer-encoding",
  "content-encoding",
  "content-security-policy",
  "content-security-policy-report-only",
  "strict-transport-security",
  "access-control-allow-origin",
  "x-frame-options",
  "x-content-type-options",
  "speculation-rules",
  "report-to",
  "nel",
  "referrer-policy",
  "cross-origin-opener-policy",
  "cross-origin-embedder-policy",
  "cross-origin-resource-policy",
  "permissions-policy",
  "alt-svc",
  "keep-alive",
  "set-cookie",
  "location",
  "clear-site-data",
]);

const FORWARD_REQUEST_HEADERS = [
  "accept",
  "accept-language",
  "range",
  "content-type",
  "if-range",
  "x-requested-with",
];

const OUR_COOKIES = /^(bw_|mochi_base$)/;

const EXT_TYPES = {
  wasm: "application/wasm",
  data: "application/octet-stream",
  unityweb: "application/octet-stream",
  pck: "application/octet-stream",
  mem: "application/octet-stream",
  symbols: "application/octet-stream",
  bin: "application/octet-stream",
  glb: "model/gltf-binary",
  gltf: "model/gltf+json",
  html: "text/html",
  htm: "text/html",
  js: "text/javascript",
  mjs: "text/javascript",
  json: "application/json",
  css: "text/css",
  svg: "image/svg+xml",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  mp3: "audio/mpeg",
  ogg: "audio/ogg",
  wav: "audio/wav",
  mp4: "video/mp4",
  webm: "video/webm",
  swf: "application/x-shockwave-flash",
};

const ASSET_RE = /\.(wasm|pck|unityweb|data|mem|symbols|js|mjs|json|xml|glb|gltf|bin|fbx|obj|swf|p8|c3p|atlas|fnt|png|jpe?g|mp3|ogg|wav|css|svg|gif|webp|avif|mp4|webm|woff2?|ttf|otf|eot|ico|aac|flac|m3u8)$|\.part\d+$/i;

// ---- a tiny lru cache for static game assets -------------------------------
// keeps the hot stuff (unity loaders, sprite sheets) in ram so twenty kids
// opening the same game don't make twenty trips to the same cdn.
const CACHE_MAX_BYTES = Number(process.env.GAME_CACHE_MB || 64) * 1024 * 1024;
const CACHE_ENTRY_MAX = 4 * 1024 * 1024;
const GZIP_MAX = 3 * 1024 * 1024;
const CACHE_TTL = 15 * 60 * 1000;
const cache = new Map();
let cacheBytes = 0;

function cacheGet(key) {
  const entry = cache.get(key);
  if (!entry) return null;
  if (entry.expires < Date.now()) {
    cache.delete(key);
    cacheBytes -= entry.body.length;
    return null;
  }
  cache.delete(key);
  cache.set(key, entry);
  return entry;
}

function cacheSet(key, entry) {
  if (entry.body.length > CACHE_ENTRY_MAX) return;
  const old = cache.get(key);
  if (old) {
    cacheBytes -= old.body.length;
    cache.delete(key);
  }
  cache.set(key, entry);
  cacheBytes += entry.body.length;
  while (cacheBytes > CACHE_MAX_BYTES && cache.size) {
    const [oldestKey, oldest] = cache.entries().next().value;
    cache.delete(oldestKey);
    cacheBytes -= oldest.body.length;
  }
}

// ---- resolving what the browser actually asked for --------------------------

function resolveToken(raw) {
  const end = raw.search(/[/?]/);
  const token = end < 0 ? raw : raw.slice(0, end);
  const base = decodeTarget(token);
  if (!base) return null;
  let suffix = end < 0 ? "" : raw.slice(end);
  if (suffix.startsWith("/")) suffix = suffix.slice(1);
  if (suffix.startsWith("!a!")) suffix = suffix.slice(3);
  try {
    return { url: suffix ? new URL(suffix, base).href : base, token };
  } catch {
    return null;
  }
}

/** for /foo.js requested by a game page: work out which game it meant */
function resolveFromReferer(req, pathAndQuery) {
  const referer = req.headers.referer;
  if (!referer) return null;
  try {
    const ref = new URL(referer);
    let raw = null;
    if (ref.pathname.startsWith(PROXY_PREFIX)) raw = ref.pathname.slice(PROXY_PREFIX.length) + ref.search;
    else if (ref.pathname.startsWith(COVER_PREFIX)) raw = ref.pathname.slice(COVER_PREFIX.length) + ref.search;
    if (raw === null) return null;
    const base = resolveToken(raw);
    if (!base) return null;
    return { url: new URL(pathAndQuery, base.url).href, token: null };
  } catch {
    return null;
  }
}

export function refererIsGame(req) {
  const referer = req.headers.referer;
  if (!referer) return false;
  try {
    const path = new URL(referer).pathname;
    return path.startsWith(PROXY_PREFIX) || path.startsWith(COVER_PREFIX);
  } catch {
    return false;
  }
}

export function cookieBase(req) {
  if (req.headers["sec-fetch-dest"] === "document") return null;
  const token = parseCookies(req.headers.cookie).mochi_base;
  const base = token && decodeTarget(token);
  return base || null;
}

// ---- the actual proxy ----------------------------------------------------------

function errorResponse(res, status, message, req) {
  if (res.headersSent) return res.destroy();
  const wantsHtml = req.headers["sec-fetch-dest"] === "document" || req.headers["sec-fetch-dest"] === "iframe";
  const body = wantsHtml
    ? `<!doctype html><meta charset="utf-8"><title>game unavailable</title><body style="margin:0;height:100vh;display:grid;place-items:center;background:#05060a;color:#e8ecff;font-family:Lexend,system-ui,sans-serif;text-align:center"><div><h2 style="font-weight:400;margin:0 0 8px">this game didn't load</h2><p style="opacity:.6;margin:0">${message}</p></div></body>`
    : message;
  res.writeHead(status, securityHeaders({
    "Content-Type": wantsHtml ? "text/html; charset=utf-8" : "text/plain; charset=utf-8",
    "Cache-Control": "no-store",
    "X-BW-Error": "1",
  }));
  res.end(body);
}

function fixContentType(url, headers) {
  const ext = /\.([a-z0-9]+)(?:$|\?)/i.exec(new URL(url).pathname)?.[1]?.toLowerCase();
  if (ext && EXT_TYPES[ext]) headers["content-type"] = EXT_TYPES[ext];
  if (ext && /^part\d+$/.test(ext)) headers["content-type"] = "application/octet-stream";
}

function sanitizeSetCookie(cookie) {
  // cookies from games get scoped to our origin; strip domain, soften samesite
  return cookie
    .split(";")
    .map((part, index) => {
      const [rawName] = part.split("=");
      const name = rawName.trim().toLowerCase();
      if (index === 0) return part.trim();
      if (name === "domain") return null;
      if (name === "samesite" && /strict/i.test(part)) return "SameSite=Lax";
      return part.trim();
    })
    .filter(Boolean)
    .join("; ");
}

function upstreamHeaders(req, target, isDocument) {
  const headers = { "user-agent": BROWSER_UA };
  for (const name of FORWARD_REQUEST_HEADERS) {
    const value = req.headers[name];
    if (value) headers[name] = Array.isArray(value) ? value.join(", ") : value;
  }
  const url = new URL(target);
  headers.referer = `${url.origin}/`;
  if (req.headers.origin) headers.origin = url.origin;
  headers["sec-ch-ua"] = '"Chromium";v="140", "Not=A?Brand";v="24", "Google Chrome";v="140"';
  headers["sec-ch-ua-mobile"] = "?0";
  headers["sec-ch-ua-platform"] = '"Windows"';
  if (isDocument) {
    headers.accept ||= "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8";
    headers["sec-fetch-mode"] = "navigate";
    headers["sec-fetch-dest"] = "document";
    headers["upgrade-insecure-requests"] = "1";
  }
  // forward the game's own cookies, never ours (cloudsync, encryption key, ...)
  const cookies = Object.entries(parseCookies(req.headers.cookie))
    .filter(([name]) => !OUR_COOKIES.test(name))
    .map(([name, value]) => `${name}=${value}`);
  if (cookies.length) headers.cookie = cookies.join("; ");
  return headers;
}

function wantsGzip(req, type) {
  return /\bgzip\b/.test(String(req.headers["accept-encoding"] || "")) && /text\/|javascript|json|xml|svg|wasm/.test(type);
}

const gzip = (body) => new Promise((resolve, reject) => zlib.gzip(body, { level: 3 }, (error, out) => (error ? reject(error) : resolve(out))));

// gzip runs on libuv's thread pool now, not on the event loop where it used
// to freeze every other request while it squished a 3mb unity loader
async function finish(req, res, status, headers, body) {
  const type = String(headers["content-type"] || "");
  if (body.length > 1024 && body.length < GZIP_MAX && wantsGzip(req, type)) {
    try {
      body = await gzip(body);
      headers["content-encoding"] = "gzip";
      headers.vary = "Accept-Encoding";
    } catch {}
  }
  headers["content-length"] = body.length;
  res.writeHead(status, securityHeaders(headers));
  res.end(req.method === "HEAD" ? undefined : body);
}

async function readAll(stream, limit) {
  const chunks = [];
  let size = 0;
  for await (const chunk of stream) {
    size += chunk.length;
    if (size > limit) throw new Error("too big");
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

function decodeText(buffer, contentType) {
  const charset = /charset=([^;]+)/i.exec(contentType)?.[1]?.trim().toLowerCase();
  try {
    return new TextDecoder(charset && charset !== "utf8" ? charset : "utf-8").decode(buffer);
  } catch {
    return buffer.toString("utf8");
  }
}

export async function proxyGame(req, res, { target, token, cover = false }) {
  try {
    assertPublicUrl(target);
  } catch {
    return errorResponse(res, 403, "that address isn't allowed", req);
  }

  if (BLOCKLIST.some((pattern) => target.includes(pattern))) {
    res.writeHead(200, securityHeaders({ "Content-Type": "text/javascript", "Cache-Control": "public, max-age=3600" }));
    return res.end("/* blocked by blackwaves */");
  }

  const method = req.method || "GET";
  const isGet = method === "GET" || method === "HEAD";
  const isDocument = ["document", "iframe", "frame"].includes(req.headers["sec-fetch-dest"]);
  const assetLike = ASSET_RE.test(new URL(target).pathname) || cover;
  const cacheable = isGet && !req.headers.range && assetLike;

  if (cacheable) {
    const hit = cacheGet(target);
    if (hit) {
      const headers = { ...hit.headers, "x-bw-cache": "HIT" };
      return finish(req, res, hit.status, headers, hit.body);
    }
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), cover ? 15_000 : 60_000);
  res.on("close", () => controller.abort());

  let upstream;
  try {
    upstream = await publicFetch(target, {
      method,
      headers: upstreamHeaders(req, target, isDocument),
      body: isGet ? undefined : Readable.toWeb(req),
      duplex: isGet ? undefined : "half",
      redirect: "manual",
      signal: controller.signal,
    });
  } catch (error) {
    clearTimeout(timeout);
    if (controller.signal.aborted && res.destroyed) return;
    const blocked = error?.cause?.code === "EBLOCKED" || error?.code === "EBLOCKED";
    return errorResponse(res, blocked ? 403 : 502, blocked ? "that address isn't allowed" : "the game's server didn't answer, try again in a bit", req);
  }

  const headers = {};
  upstream.headers.forEach((value, name) => {
    if (!DROP_RESPONSE_HEADERS.has(name)) headers[name] = value;
  });
  const setCookies = upstream.headers.getSetCookie?.() || [];
  if (setCookies.length) headers["set-cookie"] = setCookies.map(sanitizeSetCookie);
  fixContentType(target, headers);
  headers["access-control-allow-origin"] = "*";
  headers["cross-origin-resource-policy"] = "cross-origin";

  // redirects stay inside the proxy so relative urls keep working
  if (upstream.status >= 300 && upstream.status < 400 && upstream.headers.get("location")) {
    clearTimeout(timeout);
    let location;
    try {
      location = proxyUrl(new URL(upstream.headers.get("location"), target).href);
    } catch {
      return errorResponse(res, 502, "the game sent a broken redirect", req);
    }
    headers.location = location;
    headers["cache-control"] = "no-store";
    res.writeHead(upstream.status, securityHeaders(headers));
    return res.end();
  }

  const contentType = String(headers["content-type"] || "").toLowerCase();
  const looksHtml =
    contentType.includes("text/html") ||
    (isDocument && (!contentType || contentType.includes("text/plain") || contentType.includes("octet-stream")) && !assetLike);
  const isCss = contentType.includes("text/css");

  try {
    if (looksHtml || isCss) {
      const body = await readAll(upstream.body, 24 * 1024 * 1024);
      clearTimeout(timeout);
      const source = decodeText(body, contentType);
      const rewritten = looksHtml ? rewriteHtml(source, target) : rewriteCss(source, target);
      headers["content-type"] = looksHtml ? "text/html; charset=utf-8" : "text/css; charset=utf-8";
      headers["cache-control"] = looksHtml ? "no-store" : headers["cache-control"] || "public, max-age=300";
      // rewritten stylesheets are cached too, so a game's css only gets rewritten once
      if (isCss && cacheable && upstream.status === 200 && !setCookies.length) {
        cacheSet(target, { status: 200, headers: { ...headers }, body: Buffer.from(rewritten), expires: Date.now() + CACHE_TTL });
      }
      const cookies = [].concat(headers["set-cookie"] || []);
      if (looksHtml && token) cookies.push(`mochi_base=${token}; Path=/; SameSite=Lax`);
      if (cookies.length) headers["set-cookie"] = cookies;
      return finish(req, res, upstream.status, headers, Buffer.from(rewritten));
    }

    if (cacheable && upstream.status === 200 && !setCookies.length) {
      const declared = Number(upstream.headers.get("content-length") || 0);
      if (!declared || declared <= CACHE_ENTRY_MAX) {
        const body = await readAll(upstream.body, CACHE_ENTRY_MAX * 4);
        clearTimeout(timeout);
        headers["cache-control"] ||= "public, max-age=600";
        if (cover) headers["cache-control"] = "public, max-age=86400";
        cacheSet(target, { status: 200, headers: { ...headers }, body, expires: Date.now() + CACHE_TTL });
        return finish(req, res, 200, headers, body);
      }
    }

    // big stuff (unity data files, videos) streams straight through
    res.writeHead(upstream.status, securityHeaders(headers));
    if (!upstream.body || req.method === "HEAD") {
      clearTimeout(timeout);
      return res.end();
    }
    const stream = Readable.fromWeb(upstream.body);
    stream.on("end", () => clearTimeout(timeout));
    stream.on("error", () => {
      clearTimeout(timeout);
      res.destroy();
    });
    stream.pipe(res);
  } catch {
    clearTimeout(timeout);
    errorResponse(res, 502, "the game's files didn't come through", req);
  }
}

/** entry point for /!!/... and /!cover!/... */
export function handlePrefixed(req, res, pathname, search) {
  const cover = pathname.startsWith(COVER_PREFIX);
  const prefix = cover ? COVER_PREFIX : PROXY_PREFIX;
  const raw = pathname.slice(prefix.length) + search;
  const resolved = resolveToken(raw) || resolveFromReferer(req, "/" + raw);
  if (!resolved) return errorResponse(res, 400, "that game link is broken", req);
  return proxyGame(req, res, { target: resolved.url, token: resolved.token, cover });
}

/** entry point for root-relative requests coming from inside a game */
export function handleFallback(req, res, pathAndQuery) {
  const fromReferer = resolveFromReferer(req, pathAndQuery);
  if (fromReferer) return proxyGame(req, res, { target: fromReferer.url, token: null });
  const base = cookieBase(req);
  if (base) return proxyGame(req, res, { target: new URL(pathAndQuery, base).href, token: null });
  return false;
}

// ---- websockets for multiplayer games -------------------------------------------

const wss = new WebSocketServer({ noServer: true, maxPayload: 16 * 1024 * 1024 });
let openRelays = 0;
const MAX_RELAYS = Number(process.env.GAME_WS_LIMIT || 512);

export async function handleGameSocket(req, socket, head, pathname) {
  let target;
  try {
    target = decodeURIComponent(pathname.slice(`${PROXY_PREFIX}ws/`.length));
    const url = new URL(target.replace(/^http/, "ws"));
    if (url.protocol !== "ws:" && url.protocol !== "wss:") throw new Error("bad scheme");
    const host = url.hostname.replace(/^\[|\]$/g, "");
    const { address } = await dns.lookup(host);
    if (!isPublicIp(address)) throw new Error("private");
    target = url.href;
  } catch {
    socket.write("HTTP/1.1 400 Bad Request\r\n\r\n");
    return socket.destroy();
  }
  if (openRelays >= MAX_RELAYS) {
    socket.write("HTTP/1.1 503 Service Unavailable\r\n\r\n");
    return socket.destroy();
  }

  const protocols = String(req.headers["sec-websocket-protocol"] || "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  const origin = new URL(target.replace(/^ws/, "http")).origin;
  const upstream = new WebSocket(target, protocols, {
    headers: { "user-agent": BROWSER_UA, origin },
    handshakeTimeout: 10_000,
    lookup: (host, options, callback) =>
      dns.lookup(host, options).then(
        (result) => (isPublicIp(result.address) ? callback(null, result.address, result.family) : callback(new Error("blocked"))),
        callback,
      ),
  });
  openRelays += 1;
  let released = false;
  const release = () => {
    if (!released) {
      released = true;
      openRelays -= 1;
    }
  };

  upstream.once("open", () => {
    wss.handleUpgrade(req, socket, head, (client) => {
      client.on("message", (data, binary) => upstream.readyState === 1 && upstream.send(data, { binary }));
      upstream.on("message", (data, binary) => client.readyState === 1 && client.send(data, { binary }));
      const close = (code, reason) => {
        release();
        const safe = code >= 1000 && code < 5000 && code !== 1005 && code !== 1006 ? code : 1000;
        if (client.readyState <= 1) client.close(safe, reason);
        if (upstream.readyState <= 1) upstream.close(safe, reason);
      };
      client.on("close", close);
      upstream.on("close", close);
      client.on("error", () => close(1011));
      upstream.on("error", () => close(1011));
    });
  });
  upstream.once("error", () => {
    release();
    if (!socket.destroyed) {
      socket.write("HTTP/1.1 502 Bad Gateway\r\n\r\n");
      socket.destroy();
    }
  });
}

export { encodeTarget, proxyUrl };
