import { sql } from "../lib/db.js";
import { HttpError, createLimiter } from "../lib/http.js";
import { earnActivity, getUserById, getUserByName, isAdmin, publicUser } from "../cloudsync/accounts.js";
import { isOnline, onlineUserIds, publishToChannel, sendToUser } from "./realtime.js";
import { CHANNELS, CHANNEL_IDS, MESSAGE_MAX, REACTIONS, dmChannel, dmMembers } from "../../shared/chat.js";

const sendLimiter = createLimiter({ windowMs: 6_000, max: 5 });
const lastContent = new Map();

function canAccess(user, channel) {
  if (CHANNEL_IDS.has(channel)) return true;
  const members = dmMembers(channel);
  return Boolean(user && members && members.includes(user.id));
}

function isBlocked(byUserId, userId) {
  return Boolean(sql("SELECT 1 FROM blocks WHERE user_id = ? AND blocked_id = ?").get(byUserId, userId));
}

function reactionsFor(messageIds, viewerId) {
  const map = new Map();
  if (!messageIds.length) return map;
  const rows = sql(
    `SELECT message_id, emoji, COUNT(*) AS count, SUM(CASE WHEN user_id = ? THEN 1 ELSE 0 END) AS mine
     FROM reactions WHERE message_id IN (${messageIds.map(() => "?").join(",")})
     GROUP BY message_id, emoji`,
  ).all(viewerId || 0, ...messageIds);
  for (const row of rows) {
    if (!map.has(row.message_id)) map.set(row.message_id, []);
    map.get(row.message_id).push({ emoji: row.emoji, count: row.count, me: row.mine > 0 });
  }
  return map;
}

function shapeMessages(rows, viewerId) {
  const authors = new Map();
  const online = onlineUserIds();
  const reactions = reactionsFor(rows.map((row) => row.id), viewerId);
  return rows.map((row) => {
    if (!authors.has(row.user_id)) authors.set(row.user_id, publicUser(getUserById(row.user_id), online.has(row.user_id)));
    let reply = null;
    if (row.reply_to) {
      const parent = sql("SELECT id, user_id, content FROM messages WHERE id = ?").get(row.reply_to);
      if (parent) {
        const parentAuthor = getUserById(parent.user_id);
        reply = { id: parent.id, content: parent.content.slice(0, 120), author: parentAuthor?.display_name || "deleted user" };
      }
    }
    return {
      id: row.id,
      channel: row.channel,
      content: row.content,
      createdAt: row.created_at,
      editedAt: row.edited_at,
      author: authors.get(row.user_id),
      reply,
      reactions: reactions.get(row.id) || [],
    };
  });
}

export function listChannels() {
  return CHANNELS;
}

export function listMessages(user, channel, before) {
  if (!canAccess(user, channel)) throw new HttpError(403, "you can't read that channel");
  const rows = before
    ? sql("SELECT * FROM messages WHERE channel = ? AND id < ? ORDER BY id DESC LIMIT 50").all(channel, Number(before))
    : sql("SELECT * FROM messages WHERE channel = ? ORDER BY id DESC LIMIT 50").all(channel);
  const visible = user ? rows.filter((row) => !isBlocked(user.id, row.user_id)) : rows;
  return shapeMessages(visible.reverse(), user?.id);
}

export function postMessage(user, body) {
  const channel = String(body.channel || "");
  const content = String(body.content || "").replace(/\r\n/g, "\n").trim();
  if (!canAccess(user, channel)) throw new HttpError(403, "you can't post there");
  const meta = CHANNELS.find((entry) => entry.id === channel);
  if (meta?.readOnly && !isAdmin(user)) throw new HttpError(403, "only the devs can post announcements");
  if (!content) throw new HttpError(400, "you can't send an empty message");
  if (content.length > MESSAGE_MAX) throw new HttpError(400, `messages max out at ${MESSAGE_MAX} characters`);
  if (sendLimiter(user.id)) throw new HttpError(429, "slow down a little");
  const previous = lastContent.get(user.id);
  if (previous && previous.content === content && Date.now() - previous.at < 30_000) {
    throw new HttpError(429, "you just said that");
  }
  lastContent.set(user.id, { content, at: Date.now() });

  const members = dmMembers(channel);
  if (members) {
    const other = members.find((id) => id !== user.id) ?? user.id;
    if (isBlocked(other, user.id)) throw new HttpError(403, "you can't message this person");
  }

  const replyTo = Number(body.replyTo) || null;
  const result = sql("INSERT INTO messages (channel, user_id, content, reply_to, created_at) VALUES (?, ?, ?, ?, ?)").run(
    channel,
    user.id,
    content,
    replyTo,
    Date.now(),
  );
  const row = sql("SELECT * FROM messages WHERE id = ?").get(Number(result.lastInsertRowid));
  const [message] = shapeMessages([row], user.id);
  publishToChannel(channel, { t: "message", message });

  // mentions ping people even if they're not looking at the channel
  const mentioned = new Set(content.match(/@([a-zA-Z0-9_.-]{3,20})/g)?.map((tag) => tag.slice(1).toLowerCase()) || []);
  for (const name of mentioned) {
    const target = getUserByName(name);
    if (target && target.id !== user.id && canAccess(target, channel)) {
      sendToUser(target.id, { t: "mention", message });
    }
  }
  if (members) {
    for (const id of members) if (id !== user.id) sendToUser(id, { t: "dm", message });
  }

  const earned = earnActivity(user.id, "chat");
  if (earned > 0) {
    const fresh = getUserById(user.id);
    sendToUser(user.id, { t: "coins", coins: fresh.coins, earned, reason: "chatting" });
  }
  return message;
}

function ownedMessage(user, id) {
  const row = sql("SELECT * FROM messages WHERE id = ?").get(Number(id));
  if (!row) throw new HttpError(404, "that message is gone");
  return row;
}

export function editMessage(user, id, body) {
  const row = ownedMessage(user, id);
  if (row.user_id !== user.id) throw new HttpError(403, "that's not your message");
  const content = String(body.content || "").trim();
  if (!content || content.length > MESSAGE_MAX) throw new HttpError(400, "that edit doesn't work");
  sql("UPDATE messages SET content = ?, edited_at = ? WHERE id = ?").run(content, Date.now(), row.id);
  const [message] = shapeMessages([sql("SELECT * FROM messages WHERE id = ?").get(row.id)], user.id);
  publishToChannel(row.channel, { t: "edit", message });
  return message;
}

export function deleteMessage(user, id) {
  const row = ownedMessage(user, id);
  if (row.user_id !== user.id && !isAdmin(user)) throw new HttpError(403, "that's not your message");
  sql("DELETE FROM messages WHERE id = ?").run(row.id);
  publishToChannel(row.channel, { t: "delete", id: row.id, channel: row.channel });
}

export function toggleReaction(user, id, body) {
  const row = ownedMessage(user, id);
  if (!canAccess(user, row.channel)) throw new HttpError(403, "you can't react there");
  const emoji = String(body.emoji || "");
  if (!REACTIONS.includes(emoji)) throw new HttpError(400, "that reaction isn't available");
  const existing = sql("SELECT 1 FROM reactions WHERE message_id = ? AND user_id = ? AND emoji = ?").get(row.id, user.id, emoji);
  if (existing) sql("DELETE FROM reactions WHERE message_id = ? AND user_id = ? AND emoji = ?").run(row.id, user.id, emoji);
  else sql("INSERT INTO reactions (message_id, user_id, emoji) VALUES (?, ?, ?)").run(row.id, user.id, emoji);
  const reactions = reactionsFor([row.id], 0).get(row.id) || [];
  // "me" is per viewer, so we send counts and let the clients figure out their own flag
  publishToChannel(row.channel, { t: "react", id: row.id, channel: row.channel, reactions, userId: user.id, emoji, added: !existing });
  return reactionsFor([row.id], user.id).get(row.id) || [];
}

export function openDm(user, body) {
  const target = body.userId ? getUserById(Number(body.userId)) : getUserByName(String(body.username || ""));
  if (!target) throw new HttpError(404, "nobody goes by that name");
  if (target.id === user.id) return { channel: dmChannel(user.id, user.id), user: publicUser(target, true) };
  return { channel: dmChannel(user.id, target.id), user: publicUser(target, isOnline(target.id)) };
}

export function listDms(user) {
  const rows = sql(
    `SELECT channel, MAX(id) AS last_id FROM messages
     WHERE channel LIKE 'dm:%' AND (channel LIKE ? OR channel LIKE ?)
     GROUP BY channel ORDER BY last_id DESC LIMIT 50`,
  ).all(`dm:${user.id}:%`, `dm:%:${user.id}`);
  const out = [];
  for (const row of rows) {
    const members = dmMembers(row.channel);
    if (!members || !members.includes(user.id)) continue;
    const otherId = members[0] === user.id ? members[1] : members[0];
    const other = getUserById(otherId);
    if (!other) continue;
    const last = sql("SELECT content, user_id, created_at FROM messages WHERE id = ?").get(row.last_id);
    const read = sql("SELECT last_read FROM dm_reads WHERE user_id = ? AND channel = ?").get(user.id, row.channel);
    const unread = sql("SELECT COUNT(*) AS n FROM messages WHERE channel = ? AND id > ? AND user_id != ?").get(
      row.channel,
      read?.last_read || 0,
      user.id,
    ).n;
    out.push({
      channel: row.channel,
      user: publicUser(other, isOnline(other.id)),
      last: last ? { content: last.content.slice(0, 80), mine: last.user_id === user.id, createdAt: last.created_at } : null,
      unread,
    });
  }
  return out;
}

export function markRead(user, body) {
  const channel = String(body.channel || "");
  if (!dmMembers(channel)?.includes(user.id)) return;
  sql(
    `INSERT INTO dm_reads (user_id, channel, last_read) VALUES (?, ?, ?)
     ON CONFLICT(user_id, channel) DO UPDATE SET last_read = MAX(last_read, excluded.last_read)`,
  ).run(user.id, channel, Number(body.id) || 0);
}

export function members() {
  const online = onlineUserIds();
  const recent = sql("SELECT * FROM users WHERE banned = 0 ORDER BY seen_at DESC LIMIT 60").all();
  const seen = new Set(recent.map((user) => user.id));
  for (const id of online) if (!seen.has(id)) {
    const user = getUserById(id);
    if (user) recent.push(user);
  }
  return recent.map((user) => publicUser(user, online.has(user.id)));
}

export function setBlocked(user, targetId, blocked) {
  const target = getUserById(Number(targetId));
  if (!target || target.id === user.id) throw new HttpError(400, "you can't block that");
  if (blocked) sql("INSERT OR IGNORE INTO blocks (user_id, blocked_id) VALUES (?, ?)").run(user.id, target.id);
  else sql("DELETE FROM blocks WHERE user_id = ? AND blocked_id = ?").run(user.id, target.id);
}

export function blockedIds(user) {
  return sql("SELECT blocked_id FROM blocks WHERE user_id = ?").all(user.id).map((row) => row.blocked_id);
}

export function banUser(admin, body) {
  if (!isAdmin(admin)) throw new HttpError(403, "nice try");
  const target = getUserByName(String(body.username || ""));
  if (!target) throw new HttpError(404, "no such user");
  if (isAdmin(target)) throw new HttpError(400, "you can't ban a dev");
  sql("UPDATE users SET banned = ? WHERE id = ?").run(body.banned === false ? 0 : 1, target.id);
  sql("DELETE FROM sessions WHERE user_id = ?").run(target.id);
}
