/*
 * blackwaves cloud sync: tiny account system + one small encrypted JSON snapshot per user.
 *
 *   public/data/accounts.json        usernames, scrypt password hashes, hashed session tokens
 *   public/data/sync/<hmac>.json     the user's latest snapshot (3 KB of JSON max), encrypted
 *
 * The data folder sits in the web root, but index.mjs never serves it. Snapshots are also
 * deflated and encrypted with AES-256-GCM using SYNC_SECRET (generated into .env on first run),
 * and file names are an HMAC of the username, so a leaked folder reveals nothing readable.
 *
 * Sessions live in an HttpOnly cookie that page scripts (including proxied sites) can't read.
 * Every request must carry an "X-BW-Sync: 1" header, which other sites can't send without a
 * CORS preflight we never approve.
 *
 * Last write wins: every push replaces the snapshot, and clients pull when the server copy is
 * newer than what they last saw.
 */
import express from "express";
import fs from "fs/promises";
import { appendFileSync } from "fs";
import path from "path";
import crypto from "crypto";
import zlib from "zlib";

const USERNAME_RE = /^[a-z0-9_-]{3,24}$/;
const MAX_SNAPSHOT = 3 * 1024; // bytes of JSON per account
const COOKIE = "bw_sync";
const SESSION_MAX_AGE = 1000 * 60 * 60 * 24 * 90; // signed out after 90 days no matter what
const SESSION_IDLE = 1000 * 60 * 60 * 24 * 30; // ...or after 30 days unused
const MAX_SESSIONS = 10; // per account; the least recently used one goes first
const LOCK_AFTER = 8; // wrong passwords in a row for one account...
const LOCK_FOR = 15 * 60 * 1000; // ...lock it this long

function loadSecret(envFile) {
  let secret = process.env.SYNC_SECRET;
  if (!secret) {
    secret = crypto.randomBytes(32).toString("hex");
    process.env.SYNC_SECRET = secret;
    try {
      appendFileSync(envFile, `\n# Encrypts cloud sync data. Keep it: if it's lost, synced data can't be read.\nSYNC_SECRET=${secret}\n`);
    } catch (err) {
      console.warn(`  [sync] Couldn't save SYNC_SECRET to ${envFile} (${err.message}). Synced data won't survive a restart.`);
    }
  }
  return secret;
}

export function createSyncRouter(dataDir, { envFile = ".env" } = {}) {
  const router = express.Router();
  const accountsFile = path.join(dataDir, "accounts.json");
  const snapshotDir = path.join(dataDir, "sync");
  const secret = loadSecret(envFile);
  const subkey = (label) => crypto.createHmac("sha256", secret).update(label).digest();
  const encKey = subkey("bw-sync:encrypt");
  const nameKey = subkey("bw-sync:filename");
  let accounts = null;
  let writeQueue = Promise.resolve();

  async function load() {
    if (accounts) return accounts;
    await fs.mkdir(snapshotDir, { recursive: true });
    try {
      accounts = JSON.parse(await fs.readFile(accountsFile, "utf8"));
    } catch {
      accounts = { users: {}, sessions: {} };
    }
    return accounts;
  }

  // Serialize writes and replace files atomically so a crash never leaves half a JSON file.
  function writeJson(file, value) {
    writeQueue = writeQueue
      .catch(() => {})
      .then(async () => {
        const tmp = `${file}.${process.pid}.tmp`;
        await fs.writeFile(tmp, JSON.stringify(value), { mode: 0o600 });
        await fs.rename(tmp, file);
      });
    return writeQueue;
  }
  const saveAccounts = () => writeJson(accountsFile, accounts);
  const snapshotPath = (user) => path.join(snapshotDir, `${crypto.createHmac("sha256", nameKey).update(user).digest("hex").slice(0, 32)}.json`);
  // Older versions stored plain-text snapshots named after the user; they're removed on sight.
  const removeLegacy = (user) => fs.rm(path.join(snapshotDir, `${user}.json`), { force: true });

  /* ---------------- Encrypted snapshots ---------------- */
  // The username is bound in as associated data, so one account's file can't be swapped into another's.
  function seal(user, updatedAt, data) {
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv("aes-256-gcm", encKey, iv);
    cipher.setAAD(Buffer.from(user));
    const body = Buffer.concat([cipher.update(zlib.deflateRawSync(JSON.stringify(data))), cipher.final()]);
    return { v: 2, updatedAt, iv: iv.toString("base64"), tag: cipher.getAuthTag().toString("base64"), data: body.toString("base64") };
  }
  function open(user, file) {
    const decipher = crypto.createDecipheriv("aes-256-gcm", encKey, Buffer.from(file.iv, "base64"));
    decipher.setAAD(Buffer.from(user));
    decipher.setAuthTag(Buffer.from(file.tag, "base64"));
    const plain = Buffer.concat([decipher.update(Buffer.from(file.data, "base64")), decipher.final()]);
    return JSON.parse(zlib.inflateRawSync(plain).toString("utf8"));
  }
  async function readSnapshot(user) {
    let file;
    try {
      file = JSON.parse(await fs.readFile(snapshotPath(user), "utf8"));
    } catch {
      return { updatedAt: 0, data: null };
    }
    try {
      return { updatedAt: file.updatedAt || 0, data: open(user, file) };
    } catch {
      console.warn(`  [sync] Couldn't decrypt the snapshot for "${user}" (was SYNC_SECRET changed?). It will be replaced on the next push.`);
      return { updatedAt: 0, data: null };
    }
  }

  /* ---------------- Passwords & sessions ---------------- */
  const hashPassword = (password, salt) =>
    new Promise((resolve, reject) =>
      crypto.scrypt(password, salt, 64, { N: 16384, r: 8, p: 1 }, (err, key) => (err ? reject(err) : resolve(key.toString("hex"))))
    );
  const hashToken = (token) => crypto.createHash("sha256").update(token).digest("hex");
  const sameHash = (a, b) => crypto.timingSafeEqual(Buffer.from(a, "hex"), Buffer.from(b, "hex"));
  const expired = (s, now = Date.now()) => now - s.createdAt > SESSION_MAX_AGE || now - (s.lastUsed || s.createdAt) > SESSION_IDLE;

  const isHttps = (req) => req.secure || String(req.headers["x-forwarded-proto"] || "").split(",")[0].trim() === "https";
  function setCookie(req, res, value, maxAgeMs) {
    // SameSite=None + Partitioned keeps sync working when blackwaves is embedded in another site;
    // the X-BW-Sync header check is what stops cross-site requests.
    const site = isHttps(req) ? "SameSite=None; Secure; Partitioned" : "SameSite=Strict";
    res.append("Set-Cookie", `${COOKIE}=${value}; Path=/api/sync; HttpOnly; ${site}; Max-Age=${Math.floor(maxAgeMs / 1000)}`);
  }
  const clearCookie = (req, res) => setCookie(req, res, "", 0);
  const cookieToken = (req) => (/(?:^|;\s*)bw_sync=([A-Za-z0-9_-]{20,})/.exec(req.headers.cookie || "") || [])[1] || "";

  async function startSession(req, res, user) {
    const token = crypto.randomBytes(32).toString("base64url");
    const now = Date.now();
    accounts.sessions[hashToken(token)] = { user, createdAt: now, lastUsed: now };
    const mine = [];
    for (const [k, s] of Object.entries(accounts.sessions)) {
      if (expired(s, now)) delete accounts.sessions[k];
      else if (s.user === user) mine.push([k, s.lastUsed || s.createdAt]);
    }
    mine.sort((a, b) => a[1] - b[1]);
    for (const [k] of mine.slice(0, Math.max(0, mine.length - MAX_SESSIONS))) delete accounts.sessions[k];
    await saveAccounts();
    setCookie(req, res, token, SESSION_MAX_AGE);
  }

  /* ---------------- Abuse limits ---------------- */
  const ipOf = (req) => req.headers["x-forwarded-for"]?.split(",")[0].trim() || req.socket.remoteAddress;
  const attempts = new Map(); // ip -> attempt times on credential endpoints
  const failures = new Map(); // username -> { count, first, until }
  function rateLimited(req) {
    const now = Date.now();
    const list = (attempts.get(ipOf(req)) || []).filter((t) => now - t < 10 * 60 * 1000);
    list.push(now);
    attempts.set(ipOf(req), list);
    return list.length > 20;
  }
  const locked = (user) => (failures.get(user)?.until || 0) > Date.now();
  function recordFailure(user) {
    const now = Date.now();
    let f = failures.get(user);
    if (!f || now - f.first > LOCK_FOR) f = { count: 0, first: now, until: 0 };
    if (++f.count >= LOCK_AFTER) f = { count: 0, first: now, until: now + LOCK_FOR };
    failures.set(user, f);
  }
  setInterval(() => {
    const now = Date.now();
    for (const [ip, list] of attempts) if (!list.some((t) => now - t < 10 * 60 * 1000)) attempts.delete(ip);
    for (const [user, f] of failures) if (f.until < now && now - f.first > LOCK_FOR) failures.delete(user);
  }, 10 * 60 * 1000).unref();

  const LOCKED = "Too many wrong passwords for this account. Try again in 15 minutes.";
  const TOO_MANY = "Too many attempts. Try again in a few minutes.";

  /* ---------------- Middleware ---------------- */
  router.use((req, res, next) => {
    res.set("Cache-Control", "no-store");
    if (req.get("x-bw-sync") !== "1") return res.status(403).json({ error: "Missing sync header." });
    next();
  });

  async function auth(req, res, next) {
    await load();
    const header = req.headers.authorization || "";
    const bearer = header.startsWith("Bearer ") ? header.slice(7) : "";
    const token = cookieToken(req) || bearer;
    const key = token && hashToken(token);
    const session = key && accounts.sessions[key];
    if (!session || expired(session) || !accounts.users[session.user]) {
      if (session) {
        delete accounts.sessions[key];
        await saveAccounts();
      }
      clearCookie(req, res);
      return res.status(401).json({ error: "Session expired. Sign in again." });
    }
    // Older clients kept the token in localStorage; move them onto the cookie.
    if (!cookieToken(req)) setCookie(req, res, token, SESSION_MAX_AGE - (Date.now() - session.createdAt));
    if (Date.now() - (session.lastUsed || session.createdAt) > 60 * 60 * 1000) {
      session.lastUsed = Date.now();
      await saveAccounts();
    }
    req.user = session.user;
    req.sessionKey = key;
    next();
  }

  function readCredentials(req, res, isNew) {
    const username = String(req.body?.username || "").trim().toLowerCase();
    const password = String(req.body?.password || "");
    if (!USERNAME_RE.test(username)) {
      res.status(400).json({ error: "Username must be 3-24 characters: letters, numbers, _ or -." });
      return null;
    }
    if (!password || password.length > 200) {
      res.status(400).json({ error: "Enter your password (200 characters max)." });
      return null;
    }
    if (isNew && (password.length < 8 || password.toLowerCase() === username)) {
      res.status(400).json({ error: "Use a password of at least 8 characters that isn't your username." });
      return null;
    }
    return { username, password };
  }

  const small = express.json({ limit: "4kb" });

  /* ---------------- Routes ---------------- */
  router.post("/register", small, async (req, res) => {
    if (rateLimited(req)) return res.status(429).json({ error: TOO_MANY });
    const creds = readCredentials(req, res, true);
    if (!creds) return;
    await load();
    if (accounts.users[creds.username]) return res.status(409).json({ error: "That username is taken." });
    const salt = crypto.randomBytes(16).toString("hex");
    accounts.users[creds.username] = { salt, hash: await hashPassword(creds.password, salt), createdAt: Date.now() };
    await startSession(req, res, creds.username);
    res.json({ username: creds.username, updatedAt: 0 });
  });

  router.post("/login", small, async (req, res) => {
    if (rateLimited(req)) return res.status(429).json({ error: TOO_MANY });
    const creds = readCredentials(req, res, false);
    if (!creds) return;
    if (locked(creds.username)) return res.status(429).json({ error: LOCKED });
    await load();
    const user = accounts.users[creds.username];
    // hash even for unknown users so the response time doesn't reveal which usernames exist
    const hash = await hashPassword(creds.password, user ? user.salt : "x".repeat(32));
    if (!user || !sameHash(hash, user.hash)) {
      recordFailure(creds.username);
      return res.status(401).json({ error: "Wrong username or password." });
    }
    failures.delete(creds.username);
    await startSession(req, res, creds.username);
    res.json({ username: creds.username, updatedAt: (await readSnapshot(creds.username)).updatedAt });
  });

  router.post("/logout", auth, async (req, res) => {
    delete accounts.sessions[req.sessionKey];
    await saveAccounts();
    clearCookie(req, res);
    res.json({ ok: true });
  });

  router.post("/logout-all", auth, async (req, res) => {
    for (const [k, s] of Object.entries(accounts.sessions)) if (s.user === req.user) delete accounts.sessions[k];
    await saveAccounts();
    clearCookie(req, res);
    res.json({ ok: true });
  });

  router.get("/", auth, async (req, res) => {
    res.json(await readSnapshot(req.user));
  });

  router.get("/meta", auth, async (req, res) => {
    res.json({ username: req.user, updatedAt: (await readSnapshot(req.user)).updatedAt });
  });

  router.put("/", auth, express.json({ limit: "8kb" }), async (req, res) => {
    const data = req.body?.data;
    if (!data || typeof data !== "object" || Array.isArray(data)) return res.status(400).json({ error: "Missing data." });
    if (Buffer.byteLength(JSON.stringify(data)) > MAX_SNAPSHOT) return res.status(413).json({ error: "Sync data is over 3 KB." });
    const updatedAt = Date.now();
    await writeJson(snapshotPath(req.user), seal(req.user, updatedAt, data));
    await removeLegacy(req.user);
    res.json({ updatedAt });
  });

  router.delete("/account", auth, small, async (req, res) => {
    if (locked(req.user)) return res.status(429).json({ error: LOCKED });
    const user = accounts.users[req.user];
    if (!sameHash(await hashPassword(String(req.body?.password || ""), user.salt), user.hash)) {
      recordFailure(req.user);
      return res.status(401).json({ error: "Wrong password." });
    }
    delete accounts.users[req.user];
    for (const [k, s] of Object.entries(accounts.sessions)) if (s.user === req.user) delete accounts.sessions[k];
    await saveAccounts();
    await fs.rm(snapshotPath(req.user), { force: true });
    await removeLegacy(req.user);
    clearCookie(req, res);
    res.json({ ok: true });
  });

  router.use((err, req, res, next) => {
    if (err.type === "entity.too.large") return res.status(413).json({ error: "Sync data is over 3 KB." });
    next(err);
  });

  return router;
}
