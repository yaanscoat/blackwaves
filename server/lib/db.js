import path from "node:path";
import { config } from "../config.js";

// node:sqlite still prints an "experimental" warning on some node versions.
// we heard you the first time, node.
const originalEmit = process.emit;
process.emit = function (name, data, ...rest) {
  if (name === "warning" && data?.name === "ExperimentalWarning" && /SQLite/i.test(String(data?.message))) {
    return false;
  }
  return originalEmit.call(this, name, data, ...rest);
};

const { DatabaseSync } = await import("node:sqlite");

export const db = new DatabaseSync(path.join(config.dataDir, "blackwaves.db"));

db.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA synchronous = NORMAL;
  PRAGMA foreign_keys = ON;
  PRAGMA busy_timeout = 5000;

  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT NOT NULL UNIQUE COLLATE NOCASE,
    display_name TEXT NOT NULL,
    pass_hash TEXT NOT NULL,
    bio TEXT NOT NULL DEFAULT '',
    pronouns TEXT NOT NULL DEFAULT '',
    avatar TEXT NOT NULL DEFAULT '',
    banner TEXT NOT NULL DEFAULT '#5b8cff',
    accent TEXT NOT NULL DEFAULT '#5b8cff',
    status TEXT NOT NULL DEFAULT '',
    coins INTEGER NOT NULL DEFAULT 150,
    owned TEXT NOT NULL DEFAULT '[]',
    decoration TEXT NOT NULL DEFAULT '',
    title TEXT NOT NULL DEFAULT '',
    favorites TEXT NOT NULL DEFAULT '{}',
    daily_at INTEGER NOT NULL DEFAULT 0,
    daily_streak INTEGER NOT NULL DEFAULT 0,
    earn_day TEXT NOT NULL DEFAULT '',
    earned_today INTEGER NOT NULL DEFAULT 0,
    chat_earned_today INTEGER NOT NULL DEFAULT 0,
    banned INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL,
    seen_at INTEGER NOT NULL DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS sessions (
    token_hash TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at INTEGER NOT NULL,
    expires_at INTEGER NOT NULL,
    user_agent TEXT NOT NULL DEFAULT ''
  );
  CREATE INDEX IF NOT EXISTS sessions_user ON sessions(user_id);

  CREATE TABLE IF NOT EXISTS sync_snapshots (
    user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    revision INTEGER NOT NULL,
    data TEXT NOT NULL,
    updated_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    channel TEXT NOT NULL,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    content TEXT NOT NULL,
    reply_to INTEGER,
    created_at INTEGER NOT NULL,
    edited_at INTEGER
  );
  CREATE INDEX IF NOT EXISTS messages_channel ON messages(channel, id);

  CREATE TABLE IF NOT EXISTS reactions (
    message_id INTEGER NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    emoji TEXT NOT NULL,
    PRIMARY KEY (message_id, user_id, emoji)
  );

  CREATE TABLE IF NOT EXISTS dm_reads (
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    channel TEXT NOT NULL,
    last_read INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (user_id, channel)
  );

  CREATE TABLE IF NOT EXISTS blocks (
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    blocked_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    PRIMARY KEY (user_id, blocked_id)
  );

  CREATE TABLE IF NOT EXISTS ledger (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    amount INTEGER NOT NULL,
    reason TEXT NOT NULL,
    created_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS ledger_user ON ledger(user_id, id);
`);

const cache = new Map();

/** prepared statements, cached, because re-preparing SQL every request is how you get slow. */
export function sql(query) {
  let statement = cache.get(query);
  if (!statement) {
    statement = db.prepare(query);
    cache.set(query, statement);
  }
  return statement;
}

export function transaction(fn) {
  db.exec("BEGIN IMMEDIATE");
  try {
    const result = fn();
    db.exec("COMMIT");
    return result;
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

const cleanup = setInterval(() => {
  sql("DELETE FROM sessions WHERE expires_at < ?").run(Date.now());
}, 60 * 60 * 1000);
cleanup.unref?.();
