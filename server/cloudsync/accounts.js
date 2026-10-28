import crypto from "node:crypto";
import { promisify } from "node:util";
import { config } from "../config.js";
import { sql, transaction } from "../lib/db.js";
import { HttpError, isSecure, parseCookies, serializeCookie } from "../lib/http.js";
import { DECORATIONS, ECONOMY, SHOP_BY_ID } from "../../shared/shop.js";

const scrypt = promisify(crypto.scrypt);

export const SESSION_COOKIE = "bw_session";
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const USERNAME_RE = /^[a-zA-Z0-9_.-]{3,20}$/;
const RESERVED = new Set(["admin", "system", "blackwaves", "moderator", "mod", "staff", "everyone", "here"]);
const AVATAR_RE = /^data:image\/(png|jpeg|webp|gif);base64,[A-Za-z0-9+/=]+$/;
const COLOR_RE = /^#[0-9a-fA-F]{6}$/;

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

async function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const key = await scrypt(password, salt, 64, { N: 16384, r: 8, p: 1 });
  return `scrypt$${salt.toString("base64")}$${key.toString("base64")}`;
}

async function verifyPassword(password, stored) {
  const [scheme, saltB64, keyB64] = String(stored).split("$");
  if (scheme !== "scrypt" || !saltB64 || !keyB64) return false;
  const expected = Buffer.from(keyB64, "base64");
  const actual = await scrypt(password, Buffer.from(saltB64, "base64"), expected.length, { N: 16384, r: 8, p: 1 });
  return crypto.timingSafeEqual(actual, expected);
}

function parseJson(value, fallback) {
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

export function isAdmin(user) {
  return Boolean(user) && config.adminUsers.includes(String(user.username).toLowerCase());
}

/** premium comes from a stripe purchase, see premium.js */
export function isPremium(user) {
  return Boolean(user) && user.premium_until > Date.now();
}

export function badgesFor(user) {
  const badges = [];
  if (isAdmin(user)) badges.push("developer");
  if (isPremium(user)) badges.push("premium");
  if (user.id <= 100) badges.push("early");
  const owned = parseJson(user.owned, []);
  if (owned.includes("pink-cat-ears")) badges.push("pink-ears");
  if (owned.length >= 10) badges.push("collector");
  return badges;
}

export function avatarUrl(user) {
  if (!user.avatar) return "";
  return `/api/avatar/${user.id}?v=${sha256(user.avatar).slice(0, 10)}`;
}

/** the version of you everybody else gets to see */
export function publicUser(user, online = false) {
  if (!user) return null;
  return {
    id: user.id,
    username: user.username,
    displayName: user.display_name,
    bio: user.bio,
    pronouns: user.pronouns,
    avatar: avatarUrl(user),
    banner: user.banner,
    accent: user.accent,
    status: user.status,
    decoration: user.decoration,
    title: user.title ? SHOP_BY_ID.get(user.title)?.name || "" : "",
    titleId: user.title,
    badges: badgesFor(user),
    createdAt: user.created_at,
    seenAt: user.seen_at,
    online,
  };
}

/** the version only you get to see */
export function privateUser(user) {
  return {
    ...publicUser(user, true),
    coins: user.coins,
    owned: parseJson(user.owned, []),
    dailyAt: user.daily_at,
    dailyStreak: user.daily_streak,
    earnedToday: user.earn_day === today() ? user.earned_today : 0,
    admin: isAdmin(user),
    premium: isPremium(user),
    premiumUntil: user.premium_until || 0,
  };
}

export function today(now = Date.now()) {
  return new Date(now).toISOString().slice(0, 10);
}

export function getUserById(id) {
  return sql("SELECT * FROM users WHERE id = ?").get(id) || null;
}

export function getUserByName(username) {
  return sql("SELECT * FROM users WHERE username = ? COLLATE NOCASE").get(String(username || "")) || null;
}

function sessionCookie(req, token, maxAgeMs) {
  // path=/api means the cookie never rides along to /!!/ game pages or
  // the proxy browser, so websites you open can't see your login.
  // samesite=none (when we're on https) keeps you signed in when blackwaves
  // is embedded somewhere; assertTrustedRequest handles the csrf side.
  const secure = isSecure(req);
  return serializeCookie(SESSION_COOKIE, token, {
    path: "/api",
    httpOnly: true,
    secure,
    sameSite: secure ? "None" : "Lax",
    maxAge: maxAgeMs / 1000,
  });
}

function createSession(req, res, userId) {
  const token = crypto.randomBytes(32).toString("base64url");
  const now = Date.now();
  sql("INSERT INTO sessions (token_hash, user_id, created_at, expires_at, user_agent) VALUES (?, ?, ?, ?, ?)").run(
    sha256(token),
    userId,
    now,
    now + SESSION_TTL_MS,
    String(req.headers["user-agent"] || "").slice(0, 200),
  );
  res.setHeader("Set-Cookie", sessionCookie(req, token, SESSION_TTL_MS));
}

export function sessionUser(req) {
  const token = parseCookies(req.headers.cookie)[SESSION_COOKIE];
  if (!token || token.length > 100) return null;
  const row = sql(
    "SELECT users.* FROM sessions JOIN users ON users.id = sessions.user_id WHERE sessions.token_hash = ? AND sessions.expires_at > ?",
  ).get(sha256(token), Date.now());
  if (!row || row.banned) return null;
  return row;
}

/**
 * proxied pages run on our origin, so we refuse account changes that come
 * from them. not bulletproof, but it stops the lazy attacks cold.
 */
export function assertTrustedRequest(req) {
  const site = req.headers["sec-fetch-site"];
  if (site && site !== "same-origin") throw new HttpError(403, "cross-site request refused");
  const referer = req.headers.referer;
  if (referer) {
    try {
      const path = new URL(referer).pathname;
      if (path.startsWith("/!!") || path.startsWith("/!cover!") || path.startsWith("/~/")) {
        throw new HttpError(403, "proxied pages can't touch your account");
      }
    } catch (error) {
      if (error instanceof HttpError) throw error;
    }
  }
}

export function requireUser(req) {
  const user = sessionUser(req);
  if (!user) throw new HttpError(401, "you need to sign in to cloudsync first");
  assertTrustedRequest(req);
  return user;
}

export async function register(req, res, body) {
  assertTrustedRequest(req);
  const username = String(body.username || "").trim();
  const password = String(body.password || "");
  const displayName = String(body.displayName || username).trim().slice(0, 32) || username;
  if (!USERNAME_RE.test(username)) {
    throw new HttpError(400, "usernames are 3-20 letters, numbers, dots, dashes or underscores");
  }
  if (RESERVED.has(username.toLowerCase())) throw new HttpError(400, "that username is reserved");
  if (password.length < 6 || password.length > 200) throw new HttpError(400, "passwords need at least 6 characters");
  if (getUserByName(username)) throw new HttpError(409, "that username is taken");

  const passHash = await hashPassword(password);
  const now = Date.now();
  const result = sql(
    "INSERT INTO users (username, display_name, pass_hash, coins, created_at, seen_at) VALUES (?, ?, ?, ?, ?, ?)",
  ).run(username, displayName, passHash, ECONOMY.startingCoins, now, now);
  const id = Number(result.lastInsertRowid);
  sql("INSERT INTO ledger (user_id, amount, reason, created_at) VALUES (?, ?, ?, ?)").run(id, ECONOMY.startingCoins, "welcome gift", now);
  createSession(req, res, id);
  return privateUser(getUserById(id));
}

export async function login(req, res, body) {
  assertTrustedRequest(req);
  const user = getUserByName(String(body.username || "").trim());
  const password = String(body.password || "");
  // always run the hash so "user doesn't exist" and "wrong password" take the same time
  const ok = await verifyPassword(password, user?.pass_hash || "scrypt$AAAAAAAAAAAAAAAAAAAAAA==$" + "A".repeat(86) + "==");
  if (!user || !ok) throw new HttpError(401, "wrong username or password");
  if (user.banned) throw new HttpError(403, "this account has been banned");
  createSession(req, res, user.id);
  return privateUser(user);
}

export function logout(req, res) {
  const token = parseCookies(req.headers.cookie)[SESSION_COOKIE];
  if (token) sql("DELETE FROM sessions WHERE token_hash = ?").run(sha256(token));
  res.setHeader("Set-Cookie", sessionCookie(req, "", 0));
}

export async function changePassword(user, body) {
  const current = String(body.currentPassword || "");
  const next = String(body.newPassword || "");
  if (!(await verifyPassword(current, user.pass_hash))) throw new HttpError(401, "your current password is wrong");
  if (next.length < 6 || next.length > 200) throw new HttpError(400, "passwords need at least 6 characters");
  sql("UPDATE users SET pass_hash = ? WHERE id = ?").run(await hashPassword(next), user.id);
}

export async function deleteAccount(req, res, user, body) {
  if (!(await verifyPassword(String(body.password || ""), user.pass_hash))) throw new HttpError(401, "wrong password");
  sql("DELETE FROM users WHERE id = ?").run(user.id);
  logout(req, res);
}

export function updateProfile(user, body) {
  const fields = {};
  if (body.displayName !== undefined) {
    const value = String(body.displayName).trim().slice(0, 32);
    if (!value) throw new HttpError(400, "your display name can't be empty");
    fields.display_name = value;
  }
  if (body.bio !== undefined) fields.bio = String(body.bio).slice(0, 300);
  if (body.pronouns !== undefined) fields.pronouns = String(body.pronouns).slice(0, 24);
  if (body.status !== undefined) fields.status = String(body.status).slice(0, 80);
  for (const key of ["banner", "accent"]) {
    if (body[key] !== undefined) {
      if (!COLOR_RE.test(String(body[key]))) throw new HttpError(400, `${key} has to be a hex color`);
      fields[key] = String(body[key]);
    }
  }
  if (body.avatar !== undefined) {
    const avatar = String(body.avatar);
    if (avatar && (!AVATAR_RE.test(avatar) || avatar.length > 400_000)) {
      throw new HttpError(400, "avatars must be an image under ~300kb");
    }
    fields.avatar = avatar;
  }
  const owned = parseJson(user.owned, []);
  if (body.decoration !== undefined) {
    const id = String(body.decoration);
    if (id && (!owned.includes(id) || SHOP_BY_ID.get(id)?.kind !== "decoration")) {
      throw new HttpError(403, "you don't own that decoration");
    }
    fields.decoration = id;
  }
  if (body.title !== undefined) {
    const id = String(body.title);
    if (id && (!owned.includes(id) || SHOP_BY_ID.get(id)?.kind !== "title")) {
      throw new HttpError(403, "you don't own that title");
    }
    fields.title = id;
  }
  const keys = Object.keys(fields);
  if (keys.length) {
    sql(`UPDATE users SET ${keys.map((key) => `${key} = ?`).join(", ")} WHERE id = ?`).run(...keys.map((key) => fields[key]), user.id);
  }
  return getUserById(user.id);
}

export function credit(userId, amount, reason) {
  sql("UPDATE users SET coins = coins + ? WHERE id = ?").run(amount, userId);
  sql("INSERT INTO ledger (user_id, amount, reason, created_at) VALUES (?, ?, ?, ?)").run(userId, amount, reason, Date.now());
}

/** active-minute coins, capped per day so nobody leaves a tab open for a year and buys everything */
export function earnActivity(userId, kind) {
  return transaction(() => {
    const user = getUserById(userId);
    if (!user) return 0;
    const day = today();
    let earned = user.earn_day === day ? user.earned_today : 0;
    let chatEarned = user.earn_day === day ? user.chat_earned_today : 0;
    let amount = 0;
    if (kind === "minute") {
      amount = Math.max(0, Math.min(ECONOMY.perActiveMinute, ECONOMY.activeDailyCap - earned));
      earned += amount;
    } else if (kind === "chat") {
      amount = Math.max(0, Math.min(ECONOMY.perChatMessage, ECONOMY.chatDailyCap - chatEarned));
      chatEarned += amount;
    }
    sql("UPDATE users SET earn_day = ?, earned_today = ?, chat_earned_today = ?, coins = coins + ?, seen_at = ? WHERE id = ?").run(
      day,
      earned,
      chatEarned,
      amount,
      Date.now(),
      userId,
    );
    return amount;
  });
}

export function claimDaily(user) {
  return transaction(() => {
    const fresh = getUserById(user.id);
    const now = Date.now();
    const lastDay = fresh.daily_at ? today(fresh.daily_at) : "";
    if (lastDay === today(now)) throw new HttpError(429, "you already claimed today's coins, come back tomorrow");
    const yesterday = today(now - 24 * 60 * 60 * 1000);
    const streak = lastDay === yesterday ? Math.min(fresh.daily_streak + 1, ECONOMY.dailyStreakMax) : 1;
    const amount = ECONOMY.dailyBase + (streak - 1) * ECONOMY.dailyStreakBonus;
    sql("UPDATE users SET daily_at = ?, daily_streak = ? WHERE id = ?").run(now, streak, fresh.id);
    credit(fresh.id, amount, `daily reward (day ${streak})`);
    return { amount, streak, user: privateUser(getUserById(fresh.id)) };
  });
}

export function buyItem(user, itemId) {
  const item = SHOP_BY_ID.get(String(itemId));
  if (!item) throw new HttpError(404, "that item doesn't exist");
  return transaction(() => {
    const fresh = getUserById(user.id);
    const owned = parseJson(fresh.owned, []);
    if (owned.includes(item.id)) throw new HttpError(409, "you already own that");
    if (fresh.coins < item.price) {
      throw new HttpError(402, `you need ${(item.price - fresh.coins).toLocaleString("en-US")} more coins`);
    }
    owned.push(item.id);
    sql("UPDATE users SET owned = ?, coins = coins - ? WHERE id = ?").run(JSON.stringify(owned), item.price, fresh.id);
    sql("INSERT INTO ledger (user_id, amount, reason, created_at) VALUES (?, ?, ?, ?)").run(fresh.id, -item.price, `bought ${item.name}`, Date.now());
    return privateUser(getUserById(fresh.id));
  });
}

export function ledger(user) {
  return sql("SELECT amount, reason, created_at AS createdAt FROM ledger WHERE user_id = ? ORDER BY id DESC LIMIT 50").all(user.id);
}

export function avatarBytes(userId) {
  const user = getUserById(userId);
  const match = user && /^data:(image\/[a-z]+);base64,(.+)$/.exec(user.avatar);
  if (!match) return null;
  return { type: match[1], body: Buffer.from(match[2], "base64") };
}

export const DECORATION_IDS = new Set(DECORATIONS.map((item) => item.id));
