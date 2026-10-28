import { sql } from "../lib/db.js";
import { HttpError } from "../lib/http.js";

export const SYNC_MAX_BYTES = 6 * 1024 * 1024;

export function readSnapshot(user) {
  const row = sql("SELECT revision, data, updated_at FROM sync_snapshots WHERE user_id = ?").get(user.id);
  if (!row) return { revision: 0, data: null, updatedAt: 0 };
  let data = null;
  try {
    data = JSON.parse(row.data);
  } catch {}
  return { revision: row.revision, data, updatedAt: row.updated_at };
}

/**
 * optimistic concurrency: you tell us which revision you started from.
 * if someone (you, on another laptop) got there first, you get a 409 and
 * the newer snapshot, and the client merges. revolutionary stuff.
 */
export function writeSnapshot(user, body) {
  const base = Number(body.revision) || 0;
  if (!body.data || typeof body.data !== "object") throw new HttpError(400, "snapshot data is missing");
  const serialized = JSON.stringify(body.data);
  if (Buffer.byteLength(serialized) > SYNC_MAX_BYTES) {
    throw new HttpError(413, "your synced data is over 6mb, try a smaller custom background");
  }
  const current = sql("SELECT revision FROM sync_snapshots WHERE user_id = ?").get(user.id);
  const currentRevision = current?.revision || 0;
  if (base !== currentRevision) {
    return { conflict: true, ...readSnapshot(user) };
  }
  const revision = currentRevision + 1;
  const now = Date.now();
  sql(
    `INSERT INTO sync_snapshots (user_id, revision, data, updated_at) VALUES (?, ?, ?, ?)
     ON CONFLICT(user_id) DO UPDATE SET revision = excluded.revision, data = excluded.data, updated_at = excluded.updated_at`,
  ).run(user.id, revision, serialized, now);
  return { conflict: false, revision, updatedAt: now };
}
