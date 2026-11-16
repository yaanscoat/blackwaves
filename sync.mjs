/*
 * blackwaves cloud sync: tiny account system + one JSON snapshot per user.
 *
 *   data/accounts.json        usernames, scrypt password hashes, hashed session tokens
 *   data/sync/<user>.json     the user's latest snapshot { updatedAt, data }
 *
 * Last write wins: every push replaces the snapshot, and clients pull when the
 * server copy is newer than what they last saw.
 */
import express from "express";
import fs from "fs/promises";
import path from "path";
import crypto from "crypto";

const USERNAME_RE = /^[a-z0-9_-]{3,24}$/;
const MAX_SNAPSHOT = "8mb";
const SESSION_TTL = 1000 * 60 * 60 * 24 * 90; // 90 days

export function createSyncRouter(dataDir) {
  const router = express.Router();
  const accountsFile = path.join(dataDir, "accounts.json");
  const snapshotDir = path.join(dataDir, "sync");
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
    writeQueue = writeQueue.then(async () => {
      const tmp = `${file}.${process.pid}.tmp`;
      await fs.writeFile(tmp, JSON.stringify(value));
      await fs.rename(tmp, file);
    });
    return writeQueue;
  }
  const saveAccounts = () => writeJson(accountsFile, accounts);
  const snapshotPath = (user) => path.join(snapshotDir, `${user}.json`);

  const hashPassword = (password, salt) =>
    new Promise((resolve, reject) =>
      crypto.scrypt(password, salt, 64, { N: 16384, r: 8, p: 1 }, (err, key) => (err ? reject(err) : resolve(key.toString("hex"))))
    );
  const hashToken = (token) => crypto.createHash("sha256").update(token).digest("hex");

  async function issueToken(user) {
    const token = crypto.randomBytes(32).toString("base64url");
    accounts.sessions[hashToken(token)] = { user, createdAt: Date.now() };
    // drop expired sessions while we're here
    for (const [k, s] of Object.entries(accounts.sessions)) {
      if (Date.now() - s.createdAt > SESSION_TTL) delete accounts.sessions[k];
    }
    await saveAccounts();
    return token;
  }

  /* simple per-IP limiter for credential endpoints */
  const attempts = new Map();
  function rateLimited(req) {
    const ip = req.headers["x-forwarded-for"]?.split(",")[0].trim() || req.socket.remoteAddress;
    const now = Date.now();
    const list = (attempts.get(ip) || []).filter((t) => now - t < 10 * 60 * 1000);
    list.push(now);
    attempts.set(ip, list);
    return list.length > 20;
  }

  async function auth(req, res, next) {
    await load();
    const header = req.headers.authorization || "";
    const token = header.startsWith("Bearer ") ? header.slice(7) : "";
    const session = token && accounts.sessions[hashToken(token)];
    if (!session || Date.now() - session.createdAt > SESSION_TTL || !accounts.users[session.user]) {
      return res.status(401).json({ error: "Session expired. Sign in again." });
    }
    req.user = session.user;
    req.tokenHash = hashToken(token);
    next();
  }

  function readCredentials(req, res) {
    const username = String(req.body?.username || "").trim().toLowerCase();
    const password = String(req.body?.password || "");
    if (!USERNAME_RE.test(username)) {
      res.status(400).json({ error: "Username must be 3-24 characters: letters, numbers, _ or -." });
      return null;
    }
    if (password.length < 6 || password.length > 200) {
      res.status(400).json({ error: "Password must be at least 6 characters." });
      return null;
    }
    return { username, password };
  }

  const small = express.json({ limit: "16kb" });

  router.post("/register", small, async (req, res) => {
    if (rateLimited(req)) return res.status(429).json({ error: "Too many attempts. Try again in a few minutes." });
    const creds = readCredentials(req, res);
    if (!creds) return;
    await load();
    if (accounts.users[creds.username]) return res.status(409).json({ error: "That username is taken." });
    const salt = crypto.randomBytes(16).toString("hex");
    accounts.users[creds.username] = { salt, hash: await hashPassword(creds.password, salt), createdAt: Date.now() };
    const token = await issueToken(creds.username);
    res.json({ token, username: creds.username, updatedAt: 0 });
  });

  router.post("/login", small, async (req, res) => {
    if (rateLimited(req)) return res.status(429).json({ error: "Too many attempts. Try again in a few minutes." });
    const creds = readCredentials(req, res);
    if (!creds) return;
    await load();
    const user = accounts.users[creds.username];
    const hash = user ? await hashPassword(creds.password, user.salt) : await hashPassword(creds.password, "x".repeat(32));
    if (!user || !crypto.timingSafeEqual(Buffer.from(hash, "hex"), Buffer.from(user.hash, "hex"))) {
      return res.status(401).json({ error: "Wrong username or password." });
    }
    const token = await issueToken(creds.username);
    let updatedAt = 0;
    try {
      updatedAt = JSON.parse(await fs.readFile(snapshotPath(creds.username), "utf8")).updatedAt || 0;
    } catch {}
    res.json({ token, username: creds.username, updatedAt });
  });

  router.post("/logout", auth, async (req, res) => {
    delete accounts.sessions[req.tokenHash];
    await saveAccounts();
    res.json({ ok: true });
  });

  router.get("/", auth, async (req, res) => {
    res.set("Cache-Control", "no-store");
    try {
      res.type("json").send(await fs.readFile(snapshotPath(req.user), "utf8"));
    } catch {
      res.json({ updatedAt: 0, data: null });
    }
  });

  router.get("/meta", auth, async (req, res) => {
    res.set("Cache-Control", "no-store");
    try {
      const stat = JSON.parse(await fs.readFile(snapshotPath(req.user), "utf8"));
      res.json({ updatedAt: stat.updatedAt || 0 });
    } catch {
      res.json({ updatedAt: 0 });
    }
  });

  router.put("/", auth, express.json({ limit: MAX_SNAPSHOT }), async (req, res) => {
    const data = req.body?.data;
    if (!data || typeof data !== "object") return res.status(400).json({ error: "Missing data." });
    const updatedAt = Date.now();
    await writeJson(snapshotPath(req.user), { updatedAt, data });
    res.json({ updatedAt });
  });

  router.delete("/account", auth, small, async (req, res) => {
    const user = accounts.users[req.user];
    const hash = await hashPassword(String(req.body?.password || ""), user.salt);
    if (!crypto.timingSafeEqual(Buffer.from(hash, "hex"), Buffer.from(user.hash, "hex"))) {
      return res.status(401).json({ error: "Wrong password." });
    }
    delete accounts.users[req.user];
    for (const [k, s] of Object.entries(accounts.sessions)) if (s.user === req.user) delete accounts.sessions[k];
    await saveAccounts();
    await fs.rm(snapshotPath(req.user), { force: true });
    res.json({ ok: true });
  });

  router.use((err, req, res, next) => {
    if (err.type === "entity.too.large") return res.status(413).json({ error: "Sync data is too large (8 MB max)." });
    next(err);
  });

  return router;
}
