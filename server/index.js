// blackwaves server. one node process doing the job that used to take four
// rust services, a caddy config and a prayer: static files, the wisp proxy,
// the game proxy, cloudsync, chat, the shop and a handful of media apis.
import http from "node:http";
import path from "node:path";
import fs from "node:fs";
import { server as wisp, logging as wispLogging } from "@mercuryworkshop/wisp-js/server";
import { config, paths } from "./config.js";
import {
  HttpError,
  IMMUTABLE,
  NO_STORE,
  REVALIDATE,
  clientIp,
  createLimiter,
  json,
  readJson,
  routeParams,
  safeJoin,
  securityHeaders,
  serveFile,
  text,
} from "./lib/http.js";
import { detectLocation, serverLocation } from "./lib/geo.js";
import { suggestions } from "./lib/suggest.js";
import * as accounts from "./cloudsync/accounts.js";
import { readSnapshot, writeSnapshot, SYNC_MAX_BYTES } from "./cloudsync/sync.js";
import * as chat from "./social/chat.js";
import { handleUpgrade as realtimeUpgrade, isOnline, onlineCount, refreshUser } from "./social/realtime.js";
import { handleFallback, handleGameSocket, handlePrefixed, refererIsGame } from "./gameproxy/index.js";
import { handleMovies } from "./media/movies.js";
import { handleManga } from "./media/manga/index.js";
import { handleMusic } from "./media/music.js";
import { handleCloud } from "./media/cloud.js";
import { SHOP_ITEMS } from "../shared/shop.js";

// ---- wisp (the thing the proxy browser actually tunnels through) ----------------
wispLogging.set_level(config.dev ? wispLogging.WARN : wispLogging.ERROR);
Object.assign(wisp.options, {
  allow_private_ips: false,
  allow_loopback_ips: false,
  allow_udp_streams: false,
  parse_real_ip: config.trustProxy,
  // don't set stream_limit_per_host: wisp-js 0.5.0 iterates an object there and
  // crashes the whole process the first time someone opens a website. ask us how we know.
  stream_limit_total: 512,
  dns_result_order: "ipv4first",
});

const apiLimiter = createLimiter({ windowMs: 60_000, max: 600 });
const authLimiter = createLimiter({ windowMs: 10 * 60_000, max: 20 });

// ---- static mounts ------------------------------------------------------------------
const MOUNTS = [
  ["/scram/", path.join(paths.modules, "@mercuryworkshop/scramjet/dist")],
  ["/ctrl/", path.join(paths.modules, "@mercuryworkshop/scramjet-controller/dist")],
  ["/epoxy/", path.join(paths.modules, "@mercuryworkshop/epoxy-transport/dist")],
  ["/libcurl/", path.join(paths.modules, "@mercuryworkshop/libcurl-transport/dist")],
  // decor = the processed gifs from scripts/process-decor.js (placeholder avatar erased)
  ["/assets/decor/", path.join(paths.assets, "decor")],
  ["/assets/img/", path.join(paths.assets, "images")],
];

// hotfixes for the scramjet alpha build, applied when we serve the file so
// node_modules stays untouched. each one is [what to find, what to put there, why].
const SCRAMJET_PATCHES = [
  [
    "s=(0,n.Qf)(t.args[2]);",
    "s=t.args[2]==null?t.args[2]:(0,n.Qf)(t.args[2]);",
    // history.replaceState(state, "", undefined) means "keep the url". scramjet
    // String()s it into "/undefined" first, which is why tiktok kept 404ing.
    "history undefined url",
  ],
];
let patchedScramjet = null;

async function serveScramjet(req, res) {
  if (!patchedScramjet) {
    let source = await fs.promises.readFile(path.join(paths.modules, "@mercuryworkshop/scramjet/dist/scramjet.js"), "utf8");
    for (const [find, replace, name] of SCRAMJET_PATCHES) {
      if (source.includes(find)) source = source.replace(find, replace);
      else console.warn(`scramjet patch "${name}" didn't apply, the bundle probably changed`);
    }
    patchedScramjet = Buffer.from(source);
  }
  res.writeHead(200, securityHeaders({ "Content-Type": "text/javascript; charset=utf-8", "Cache-Control": REVALIDATE }));
  res.end(req.method === "HEAD" ? undefined : patchedScramjet);
}

const APP_ROUTES =/^\/(home|browser|games|movies|music|manga|cloud|chat|shop|profile|legal|settings|u)?(\/.*)?$/;

let vite = null;

async function serveStatic(req, res, pathname) {
  if (pathname === "/scram/scramjet.js") return serveScramjet(req, res).then(() => true);
  for (const [prefix, root] of MOUNTS) {
    if (!pathname.startsWith(prefix) || pathname.endsWith(".map")) continue;
    const file = safeJoin(root, pathname.slice(prefix.length));
    if (file && (await serveFile(req, res, file, { cacheControl: prefix.startsWith("/assets/") ? "public, max-age=604800" : REVALIDATE }))) {
      return true;
    }
  }
  if (pathname === "/favicon.ico") {
    return serveFile(req, res, path.join(paths.assets, "..", "favicon.ico"), { cacheControl: "public, max-age=86400" });
  }
  if (vite) return false;
  if (pathname === "/" || pathname.endsWith("/")) return false;
  const file = safeJoin(paths.dist, pathname);
  if (!file) return false;
  // hashed bundles live forever, everything else gets re-checked. this is the
  // "site loads blank after an update" fix: no more year-long caching of index.html.
  const cacheControl = pathname.startsWith("/_bw/") ? IMMUTABLE : pathname === "/sw.js" ? NO_STORE : REVALIDATE;
  return serveFile(req, res, file, { cacheControl });
}

async function serveApp(req, res) {
  const index = path.join(paths.dist, "index.html");
  if (await serveFile(req, res, index, { cacheControl: NO_STORE })) return;
  text(res, 503, "blackwaves hasn't been built yet. run `npm run build` first.");
}

// ---- api ------------------------------------------------------------------------------
const routes = [];
const route = (method, pattern, handler) => routes.push({ method, pattern, handler });

route("GET", "/api/info", () => ({
  name: "blackwaves",
  version: config.version,
  online: onlineCount(),
  location: serverLocation(),
  discord: config.discord,
}));
route("GET", "/api/online", () => ({ online: onlineCount() }));
route("GET", "/api/suggest", async ({ query }) => ({ suggestions: await suggestions(query.get("q")) }));

// cloudsync accounts
route("POST", "/api/auth/register", async ({ req, res, ip }) => {
  if (authLimiter(`r:${ip}`)) throw new HttpError(429, "too many attempts, wait a few minutes");
  return { user: await accounts.register(req, res, await readJson(req)) };
});
route("POST", "/api/auth/login", async ({ req, res, ip }) => {
  if (authLimiter(`l:${ip}`)) throw new HttpError(429, "too many attempts, wait a few minutes");
  return { user: await accounts.login(req, res, await readJson(req)) };
});
route("POST", "/api/auth/logout", ({ req, res }) => {
  accounts.logout(req, res);
  return { ok: true };
});
route("GET", "/api/auth/me", ({ req }) => {
  const user = accounts.sessionUser(req);
  return { user: user ? accounts.privateUser(user) : null };
});
route("POST", "/api/auth/password", async ({ req }) => {
  const user = accounts.requireUser(req);
  await accounts.changePassword(user, await readJson(req));
  return { ok: true };
});
route("POST", "/api/auth/delete", async ({ req, res }) => {
  const user = accounts.requireUser(req);
  await accounts.deleteAccount(req, res, user, await readJson(req));
  return { ok: true };
});

// cloudsync data
route("GET", "/api/sync", ({ req }) => readSnapshot(accounts.requireUser(req)));
route("PUT", "/api/sync", async ({ req }) => {
  const user = accounts.requireUser(req);
  return writeSnapshot(user, await readJson(req, SYNC_MAX_BYTES + 64 * 1024));
});

// profiles
route("GET", "/api/users/:name", ({ params }) => {
  const user = accounts.getUserByName(params.name) || (/^\d+$/.test(params.name) ? accounts.getUserById(Number(params.name)) : null);
  if (!user || user.banned) throw new HttpError(404, "nobody goes by that name");
  return { user: accounts.publicUser(user, isOnline(user.id)) };
});
route("PATCH", "/api/profile", async ({ req }) => {
  const user = accounts.requireUser(req);
  const updated = accounts.updateProfile(user, await readJson(req, 600 * 1024));
  refreshUser(user.id);
  return { user: accounts.privateUser(updated) };
});
route("GET", "/api/avatar/:id", ({ res, params }) => {
  const avatar = accounts.avatarBytes(Number(params.id));
  if (!avatar) throw new HttpError(404, "no avatar");
  res.writeHead(200, securityHeaders({ "Content-Type": avatar.type, "Cache-Control": "public, max-age=604800, immutable" }));
  res.end(avatar.body);
});

// shop & coins
route("GET", "/api/shop", () => ({ items: SHOP_ITEMS }));
route("POST", "/api/shop/buy", async ({ req }) => {
  const user = accounts.requireUser(req);
  const body = await readJson(req);
  const updated = accounts.buyItem(user, body.itemId);
  refreshUser(user.id);
  return { user: updated };
});
route("POST", "/api/coins/daily", ({ req }) => {
  const result = accounts.claimDaily(accounts.requireUser(req));
  refreshUser(result.user.id);
  return result;
});
route("GET", "/api/coins/ledger", ({ req }) => ({ entries: accounts.ledger(accounts.requireUser(req)) }));

// chat
route("GET", "/api/chat/channels", () => ({ channels: chat.listChannels() }));
route("GET", "/api/chat/messages", ({ req, query }) => ({
  messages: chat.listMessages(accounts.sessionUser(req), String(query.get("channel") || "general"), query.get("before")),
}));
route("POST", "/api/chat/messages", async ({ req }) => ({ message: chat.postMessage(accounts.requireUser(req), await readJson(req)) }));
route("PATCH", "/api/chat/messages/:id", async ({ req, params }) => ({
  message: chat.editMessage(accounts.requireUser(req), params.id, await readJson(req)),
}));
route("DELETE", "/api/chat/messages/:id", ({ req, params }) => {
  chat.deleteMessage(accounts.requireUser(req), params.id);
  return { ok: true };
});
route("POST", "/api/chat/messages/:id/react", async ({ req, params }) => ({
  reactions: chat.toggleReaction(accounts.requireUser(req), params.id, await readJson(req)),
}));
route("GET", "/api/chat/dms", ({ req }) => ({ dms: chat.listDms(accounts.requireUser(req)) }));
route("POST", "/api/chat/dms", async ({ req }) => chat.openDm(accounts.requireUser(req), await readJson(req)));
route("POST", "/api/chat/read", async ({ req }) => {
  chat.markRead(accounts.requireUser(req), await readJson(req));
  return { ok: true };
});
route("GET", "/api/chat/members", () => ({ members: chat.members() }));
route("GET", "/api/chat/blocks", ({ req }) => ({ blocked: chat.blockedIds(accounts.requireUser(req)) }));
route("POST", "/api/chat/blocks", async ({ req }) => {
  const body = await readJson(req);
  chat.setBlocked(accounts.requireUser(req), body.userId, body.blocked !== false);
  return { ok: true };
});
route("POST", "/api/admin/ban", async ({ req }) => {
  chat.banUser(accounts.requireUser(req), await readJson(req));
  return { ok: true };
});

async function handleApi(req, res, url, ip) {
  const { pathname, searchParams } = url;
  if (apiLimiter(ip)) return json(res, 429, { error: "slow down, you're sending way too many requests" });

  if (pathname.startsWith("/api/movies/")) return handleMovies(req, res, pathname, searchParams);
  if (pathname.startsWith("/api/manga/")) return handleManga(req, res, pathname, searchParams);
  if (pathname.startsWith("/api/music/")) return handleMusic(req, res, pathname, searchParams);
  if (pathname.startsWith("/api/cloud/")) return handleCloud(req, res, pathname, searchParams);

  for (const entry of routes) {
    if (entry.method !== req.method && !(entry.method === "GET" && req.method === "HEAD")) continue;
    const params = entry.pattern.includes(":") ? routeParams(entry.pattern, pathname) : entry.pattern === pathname ? {} : null;
    if (!params) continue;
    try {
      const result = await entry.handler({ req, res, params, query: searchParams, ip });
      if (result !== undefined && !res.headersSent) json(res, 200, result);
    } catch (error) {
      if (error instanceof HttpError) return json(res, error.status, { error: error.message });
      console.error("api error", pathname, error);
      return json(res, 500, { error: "something broke on our end" });
    }
    return;
  }
  json(res, 404, { error: "that endpoint doesn't exist" });
}

// ---- the request handler ---------------------------------------------------------------
async function onRequest(req, res) {
  let url;
  try {
    url = new URL(req.url, "http://localhost");
  } catch {
    return text(res, 400, "bad url");
  }
  const { pathname, search } = url;
  const ip = clientIp(req);

  try {
    if (pathname === "/health") return text(res, 200, "ok");

    // game proxy first, including root-relative requests made by game pages
    if (pathname.startsWith("/!!/") || pathname.startsWith("/!cover!/")) return await handlePrefixed(req, res, pathname, search);
    if (refererIsGame(req)) {
      const handled = await handleFallback(req, res, pathname + search);
      if (handled !== false) return;
    }

    if (pathname.startsWith("/api/")) return await handleApi(req, res, url, ip);

    if (req.method !== "GET" && req.method !== "HEAD") return text(res, 405, "method not allowed");
    if (await serveStatic(req, res, pathname)) return;

    if (vite) return vite.middlewares(req, res, () => text(res, 404, "not found"));

    // some games load files with no referer at all; the mochi_base cookie remembers which game
    const dest = req.headers["sec-fetch-dest"];
    if (!APP_ROUTES.test(pathname) || (dest && dest !== "document")) {
      const handled = await handleFallback(req, res, pathname + search);
      if (handled !== false) return;
    }

    if (APP_ROUTES.test(pathname)) return await serveApp(req, res);
    if (await serveFile(req, res, path.join(paths.dist, "404.html"), { cacheControl: NO_STORE, status: 404 })) return;
    text(res, 404, "not found");
  } catch (error) {
    console.error("request failed", pathname, error);
    if (!res.headersSent) text(res, 500, "something broke on our end");
    else res.destroy();
  }
}

const server = http.createServer({ requestTimeout: 0, headersTimeout: 30_000, keepAliveTimeout: 65_000 }, onRequest);

server.on("upgrade", (req, socket, head) => {
  const pathname = (req.url || "/").split("?")[0];
  socket.on("error", () => socket.destroy());
  if (pathname.startsWith("/wisp/")) return wisp.routeRequest(req, socket, head);
  if (pathname === "/api/ws") return realtimeUpgrade(req, socket, head);
  if (pathname.startsWith("/!!/ws/")) return handleGameSocket(req, socket, head, pathname);
  if (vite) return; // vite's hmr socket lives here in dev
  socket.destroy();
});

if (config.dev) {
  const { createServer } = await import("vite");
  vite = await createServer({
    configFile: path.join(paths.src, "..", "vite.config.js"),
    server: { middlewareMode: true, hmr: { server } },
    appType: "spa",
  });
} else if (!fs.existsSync(path.join(paths.dist, "index.html"))) {
  console.warn("heads up: dist/index.html is missing. `npm start` builds it for you, or run `npm run build`.");
}

server.on("error", (error) => {
  // a taken port isn't something we can shrug off, so actually stop
  console.error(error.code === "EADDRINUSE" ? `port ${config.port} is already in use, is blackwaves already running?` : error);
  process.exit(1);
});

server.listen(config.port, config.host, () => {
  console.log(`blackwaves v${config.version} listening on http://${config.host}:${config.port}${config.dev ? " (dev)" : ""}`);
  console.log(`data lives in ${config.dataDir}${config.tmdbKey ? "" : " · movies are off until you set TMDB_API_KEY"}`);
});

void detectLocation().then((location) => console.log(`server location: ${location.region ? `${location.region}, ` : ""}${location.country}`));

function shutdown() {
  console.log("shutting down...");
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 3000).unref();
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

// one broken socket inside a dependency shouldn't take every user offline
process.on("uncaughtException", (error) => console.error("uncaught exception (kept running):", error));
process.on("unhandledRejection", (error) => console.error("unhandled rejection (kept running):", error));
