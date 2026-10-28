import fs from "node:fs";
import path from "node:path";
import { config } from "../config.js";

export const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".cjs": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".map": "application/json; charset=utf-8",
  ".wasm": "application/wasm",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".avif": "image/avif",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".otf": "font/otf",
  ".mp3": "audio/mpeg",
  ".mp4": "video/mp4",
  ".webm": "video/webm",
  ".txt": "text/plain; charset=utf-8",
  ".xml": "application/xml",
};

export const NO_STORE = "no-store, max-age=0";
export const IMMUTABLE = "public, max-age=31536000, immutable";
export const REVALIDATE = "public, max-age=0, must-revalidate";

export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

export function securityHeaders(extra = {}) {
  return {
    "X-Content-Type-Options": "nosniff",
    // other sites only ever learn which site you came from, never the page.
    // ad networks need that much to know their ads are running here.
    "Referrer-Policy": "strict-origin-when-cross-origin",
    ...extra,
  };
}

export function send(res, status, body, headers = {}) {
  if (res.headersSent) return;
  res.writeHead(status, securityHeaders(headers));
  res.end(body);
}

export function json(res, status, data, headers = {}) {
  send(res, status, JSON.stringify(data), {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": NO_STORE,
    ...headers,
  });
}

export function text(res, status, body, headers = {}) {
  send(res, status, body, {
    "Content-Type": "text/plain; charset=utf-8",
    "Cache-Control": NO_STORE,
    ...headers,
  });
}

export function readBody(req, limit = 256 * 1024) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > limit) {
        reject(new HttpError(413, "that's way too much data"));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

export async function readJson(req, limit) {
  const raw = await readBody(req, limit);
  if (!raw.length) return {};
  try {
    const data = JSON.parse(raw.toString("utf8"));
    return data && typeof data === "object" ? data : {};
  } catch {
    throw new HttpError(400, "that wasn't valid json");
  }
}

export function parseCookies(header = "") {
  const out = Object.create(null);
  for (const part of header.split(";")) {
    const index = part.indexOf("=");
    if (index < 0) continue;
    const name = part.slice(0, index).trim();
    if (!name) continue;
    let value = part.slice(index + 1).trim();
    try {
      value = decodeURIComponent(value);
    } catch {}
    out[name] = value;
  }
  return out;
}

export function isSecure(req) {
  if (req.socket.encrypted) return true;
  return config.trustProxy && String(req.headers["x-forwarded-proto"] || "").split(",")[0].trim() === "https";
}

export function serializeCookie(name, value, options = {}) {
  let cookie = `${name}=${encodeURIComponent(value)}`;
  cookie += `; Path=${options.path || "/"}`;
  if (options.maxAge !== undefined) cookie += `; Max-Age=${Math.floor(options.maxAge)}`;
  if (options.httpOnly) cookie += "; HttpOnly";
  if (options.secure) cookie += "; Secure";
  cookie += `; SameSite=${options.sameSite || "Lax"}`;
  return cookie;
}

export function clientIp(req) {
  if (config.trustProxy) {
    const forwarded = req.headers["x-forwarded-for"];
    if (forwarded) return String(forwarded).split(",")[0].trim();
    const real = req.headers["x-real-ip"];
    if (real) return String(real).trim();
  }
  return req.socket.remoteAddress || "unknown";
}

/**
 * A fixed-window rate limiter. It's not fancy, it doesn't need to be,
 * it just needs to stop one kid with a while(true) loop from ruining lunch.
 */
export function createLimiter({ windowMs, max, maxKeys = 50_000 }) {
  const hits = new Map();
  const timer = setInterval(() => {
    const cutoff = Date.now() - windowMs;
    for (const [key, state] of hits) if (state.start < cutoff) hits.delete(key);
  }, windowMs);
  timer.unref?.();

  return function limited(key) {
    const now = Date.now();
    const state = hits.get(key);
    if (!state || now - state.start > windowMs) {
      if (!state && hits.size >= maxKeys) hits.delete(hits.keys().next().value);
      hits.set(key, { start: now, count: 1 });
      return false;
    }
    state.count += 1;
    return state.count > max;
  };
}

export function safeJoin(root, relative) {
  let decoded;
  try {
    decoded = decodeURIComponent(relative);
  } catch {
    return null;
  }
  decoded = decoded.replace(/\\/g, "/").replace(/^\/+/, "");
  if (decoded.includes("\0") || decoded.split("/").includes("..")) return null;
  const resolvedRoot = path.resolve(root);
  const resolved = path.resolve(resolvedRoot, decoded);
  if (resolved !== resolvedRoot && !resolved.startsWith(resolvedRoot + path.sep)) return null;
  return resolved;
}

export async function serveFile(req, res, filePath, { cacheControl = REVALIDATE, status = 200, headers = {} } = {}) {
  let stats;
  try {
    stats = await fs.promises.stat(filePath);
  } catch {
    return false;
  }
  if (!stats.isFile()) return false;

  const etag = `W/"${stats.size.toString(16)}-${Math.trunc(stats.mtimeMs).toString(16)}"`;
  const type = MIME[path.extname(filePath).toLowerCase()] || "application/octet-stream";
  const baseHeaders = securityHeaders({
    "Content-Type": type,
    "Cache-Control": cacheControl,
    ETag: etag,
    "Last-Modified": stats.mtime.toUTCString(),
    "Accept-Ranges": "bytes",
    ...headers,
  });

  if (status === 200 && cacheControl !== NO_STORE && req.headers["if-none-match"] === etag) {
    res.writeHead(304, baseHeaders);
    res.end();
    return true;
  }

  const range = req.headers.range && /^bytes=(\d*)-(\d*)$/.exec(req.headers.range);
  if (range && status === 200) {
    let start = range[1] ? Number(range[1]) : stats.size - Number(range[2]);
    let end = range[1] && range[2] ? Number(range[2]) : stats.size - 1;
    if (!range[1]) end = stats.size - 1;
    if (start < 0 || start >= stats.size || end < start) {
      res.writeHead(416, { ...baseHeaders, "Content-Range": `bytes */${stats.size}` });
      res.end();
      return true;
    }
    end = Math.min(end, stats.size - 1);
    res.writeHead(206, {
      ...baseHeaders,
      "Content-Range": `bytes ${start}-${end}/${stats.size}`,
      "Content-Length": end - start + 1,
    });
    if (req.method === "HEAD") return res.end(), true;
    fs.createReadStream(filePath, { start, end }).pipe(res);
    return true;
  }

  res.writeHead(status, { ...baseHeaders, "Content-Length": stats.size });
  if (req.method === "HEAD") {
    res.end();
    return true;
  }
  fs.createReadStream(filePath).on("error", () => res.destroy()).pipe(res);
  return true;
}

export function routeParams(pattern, pathname) {
  const p = pattern.split("/");
  const s = pathname.split("/");
  if (p.length !== s.length) return null;
  const params = {};
  for (let i = 0; i < p.length; i++) {
    if (p[i].startsWith(":")) {
      try {
        params[p[i].slice(1)] = decodeURIComponent(s[i]);
      } catch {
        return null;
      }
    } else if (p[i] !== s[i]) return null;
  }
  return params;
}
