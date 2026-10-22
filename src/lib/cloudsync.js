// cloudsync: keeps the stuff you care about the same on every device.
// each synced key carries its own timestamp and the newest one wins.
// (the old version never noticed when your settings changed. this one listens.)
import { signal } from "@preact/signals";
import { getBlob, putBlob, storage } from "./storage.js";
import { get, put } from "./api.js";
import { loadSettings } from "./settings.js";

export const SYNCED_KEYS = [
  "settings",
  "bookmarks",
  "history",
  "gameFavorites",
  "gameRecents",
  "watchProgress",
  "watchlist",
  "musicLikes",
  "musicRecents",
  "musicAlbums",
  "mangaProgress",
];

export const syncState = signal({ status: "idle", at: 0, error: "" });

let active = false;
let revision = 0;
let pushTimer = null;
let pullTimer = null;
let applying = false;
const unsubscribers = [];

function meta() {
  return storage.get("syncMeta", {});
}

function touch(key) {
  if (applying) return;
  storage.set("syncMeta", { ...meta(), [key]: Date.now() });
  schedulePush();
}

function schedulePush() {
  if (!active) return;
  clearTimeout(pushTimer);
  pushTimer = setTimeout(push, 4000);
}

async function backgroundEntry() {
  const blob = await getBlob("background");
  if (!blob || blob.size > 4 * 1024 * 1024) return null;
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => resolve(null);
    reader.readAsDataURL(blob);
  });
}

async function snapshot() {
  const stamps = meta();
  const data = {};
  for (const key of SYNCED_KEYS) {
    const value = storage.get(key);
    if (value !== null) data[key] = { v: value, t: stamps[key] || 0 };
  }
  if (stamps.background) data.background = { v: await backgroundEntry(), t: stamps.background };
  return data;
}

async function applyRemote(remote) {
  const stamps = meta();
  let changed = false;
  applying = true;
  try {
    for (const [key, entry] of Object.entries(remote || {})) {
      if (!entry || typeof entry !== "object" || (stamps[key] || 0) >= entry.t) continue;
      if (key === "background") {
        if (entry.v) {
          const blob = await (await fetch(entry.v)).blob();
          await putBlob("background", blob);
        } else await putBlob("background", null);
        window.dispatchEvent(new CustomEvent("bw:background-changed"));
      } else if (SYNCED_KEYS.includes(key)) {
        storage.set(key, entry.v);
      } else continue;
      stamps[key] = entry.t;
      changed = true;
    }
    if (changed) {
      storage.set("syncMeta", stamps);
      loadSettings();
    }
  } finally {
    applying = false;
  }
  return changed;
}

function hasLocalNewer(remote) {
  const stamps = meta();
  return Object.entries(stamps).some(([key, t]) => !remote?.[key] || remote[key].t < t);
}

export async function pull() {
  if (!active) return;
  try {
    syncState.value = { ...syncState.value, status: "syncing" };
    const result = await get("/api/sync");
    revision = result.revision;
    await applyRemote(result.data);
    if (hasLocalNewer(result.data)) await push();
    syncState.value = { status: "synced", at: Date.now(), error: "" };
  } catch (error) {
    syncState.value = { status: "error", at: syncState.value.at, error: error.message };
  }
}

export async function push(attempt = 0) {
  if (!active) return;
  clearTimeout(pushTimer);
  try {
    syncState.value = { ...syncState.value, status: "syncing" };
    const result = await put("/api/sync", { revision, data: await snapshot() });
    if (result.conflict) {
      revision = result.revision;
      await applyRemote(result.data);
      if (attempt < 3) return push(attempt + 1);
      throw new Error("sync conflict kept happening");
    }
    revision = result.revision;
    syncState.value = { status: "synced", at: Date.now(), error: "" };
  } catch (error) {
    syncState.value = { status: "error", at: syncState.value.at, error: error.message };
  }
}

export function markBackgroundChanged() {
  touch("background");
}

export function startSync() {
  if (active) return;
  active = true;
  for (const key of SYNCED_KEYS) unsubscribers.push(storage.on(key, () => touch(key)));
  void pull();
  pullTimer = setInterval(pull, 2 * 60 * 1000);
  window.addEventListener("focus", pull);
}

export function stopSync() {
  active = false;
  revision = 0;
  clearTimeout(pushTimer);
  clearInterval(pullTimer);
  window.removeEventListener("focus", pull);
  unsubscribers.splice(0).forEach((fn) => fn());
  syncState.value = { status: "idle", at: 0, error: "" };
}
