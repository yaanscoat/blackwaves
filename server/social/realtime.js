import { WebSocketServer } from "ws";
import { earnActivity, getUserById, privateUser, sessionUser } from "../cloudsync/accounts.js";
import { dmMembers } from "../../shared/chat.js";

const wss = new WebSocketServer({ noServer: true, maxPayload: 16 * 1024 });
const sockets = new Set();
const lastMinuteCredit = new Map();
let onlineDirty = false;

function send(socket, payload) {
  if (socket.readyState === socket.OPEN) socket.send(JSON.stringify(payload));
}

/** how many humans are here. one browser with five tabs is still one human. */
export function onlineCount() {
  const ids = new Set();
  for (const socket of sockets) ids.add(socket.meta.cid || socket.meta.key);
  return ids.size;
}

export function onlineUserIds() {
  const ids = new Set();
  for (const socket of sockets) if (socket.meta.userId) ids.add(socket.meta.userId);
  return ids;
}

export function isOnline(userId) {
  for (const socket of sockets) if (socket.meta.userId === userId) return true;
  return false;
}

function markOnlineDirty() {
  if (onlineDirty) return;
  onlineDirty = true;
  setTimeout(() => {
    onlineDirty = false;
    broadcast({ t: "online", count: onlineCount(), users: [...onlineUserIds()] });
  }, 400).unref?.();
}

export function broadcast(payload) {
  const data = JSON.stringify(payload);
  for (const socket of sockets) if (socket.readyState === socket.OPEN) socket.send(data);
}

export function sendToUser(userId, payload) {
  for (const socket of sockets) if (socket.meta.userId === userId) send(socket, payload);
}

/** public channels go to everyone, dms only go to the two people in them */
export function publishToChannel(channel, payload) {
  const members = dmMembers(channel);
  if (!members) return broadcast(payload);
  for (const id of new Set(members)) sendToUser(id, payload);
}

export function refreshUser(userId) {
  const user = getUserById(userId);
  if (user) sendToUser(userId, { t: "me", user: privateUser(user) });
}

const typingSeen = new Map();

function handleMessage(socket, raw) {
  let message;
  try {
    message = JSON.parse(raw.toString());
  } catch {
    return;
  }
  if (!message || typeof message !== "object") return;
  const meta = socket.meta;

  switch (message.t) {
    case "hello":
      if (typeof message.cid === "string" && /^[a-z0-9-]{8,64}$/i.test(message.cid)) meta.cid = message.cid;
      markOnlineDirty();
      send(socket, { t: "online", count: onlineCount(), users: [...onlineUserIds()] });
      break;
    case "active": {
      // one coin per real minute, enforced here so a fast client can't speed-run the economy
      if (!meta.userId) return;
      const last = lastMinuteCredit.get(meta.userId) || 0;
      if (Date.now() - last < 55_000) return;
      lastMinuteCredit.set(meta.userId, Date.now());
      const earned = earnActivity(meta.userId, "minute");
      if (earned > 0) {
        const user = getUserById(meta.userId);
        sendToUser(meta.userId, { t: "coins", coins: user.coins, earned, reason: "active minute" });
      }
      break;
    }
    case "typing": {
      if (!meta.userId || typeof message.channel !== "string") return;
      const key = `${meta.userId}:${message.channel}`;
      if (Date.now() - (typingSeen.get(key) || 0) < 2500) return;
      typingSeen.set(key, Date.now());
      const members = dmMembers(message.channel);
      if (members && !members.includes(meta.userId)) return;
      const user = getUserById(meta.userId);
      publishToChannel(message.channel, {
        t: "typing",
        channel: message.channel,
        userId: meta.userId,
        name: user?.display_name || "someone",
      });
      break;
    }
    case "ping":
      send(socket, { t: "pong" });
      break;
    default:
      break;
  }
}

export function handleUpgrade(req, socket, head) {
  const user = sessionUser(req);
  wss.handleUpgrade(req, socket, head, (ws) => {
    ws.meta = { userId: user?.id || 0, cid: "", key: Math.random().toString(36).slice(2) };
    ws.isAlive = true;
    sockets.add(ws);
    ws.on("pong", () => {
      ws.isAlive = true;
    });
    ws.on("message", (data) => handleMessage(ws, data));
    ws.on("close", () => {
      sockets.delete(ws);
      markOnlineDirty();
    });
    ws.on("error", () => ws.terminate());
    if (user) send(ws, { t: "me", user: privateUser(user) });
    markOnlineDirty();
  });
}

const heartbeat = setInterval(() => {
  for (const ws of sockets) {
    if (!ws.isAlive) {
      ws.terminate();
      continue;
    }
    ws.isAlive = false;
    ws.ping();
  }
  markOnlineDirty();
}, 20_000);
heartbeat.unref?.();

const typingCleanup = setInterval(() => {
  const cutoff = Date.now() - 60_000;
  for (const [key, at] of typingSeen) if (at < cutoff) typingSeen.delete(key);
}, 60_000);
typingCleanup.unref?.();
