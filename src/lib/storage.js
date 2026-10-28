// everything blackwaves keeps on your device is encrypted with aes-gcm.
// the key lives in a cookie (bw_k). clear your cookies and the key is gone,
// which means the data is unreadable, which means blackwaves starts fresh.
// that's not a bug, that's the privacy feature working exactly as advertised.

const KEY_COOKIE = "bw_k";
const PREFIX = "bw:";
const memory = new Map();
const listeners = new Map();
let key = null;
let ready = null;

const b64 = {
  encode(bytes) {
    let binary = "";
    const view = new Uint8Array(bytes);
    for (let i = 0; i < view.length; i += 0x8000) binary += String.fromCharCode(...view.subarray(i, i + 0x8000));
    return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  },
  decode(text) {
    let value = text.replace(/-/g, "+").replace(/_/g, "/");
    while (value.length % 4) value += "=";
    return Uint8Array.from(atob(value), (char) => char.charCodeAt(0));
  },
};

export function readCookie(name) {
  const match = document.cookie.split("; ").find((part) => part.startsWith(name + "="));
  return match ? decodeURIComponent(match.slice(name.length + 1)) : "";
}

export function writeCookie(name, value, days = 400) {
  const secure = location.protocol === "https:" ? "; Secure" : "";
  document.cookie = `${name}=${encodeURIComponent(value)}; Path=/; Max-Age=${Math.floor(days * 86400)}; SameSite=Lax${secure}`;
}

function wipeLocal() {
  for (let i = localStorage.length - 1; i >= 0; i--) {
    const name = localStorage.key(i);
    if (name?.startsWith(PREFIX)) localStorage.removeItem(name);
  }
  try {
    indexedDB.deleteDatabase("blackwaves-blobs");
  } catch {}
}

async function encrypt(data) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const cipher = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, data);
  const out = new Uint8Array(12 + cipher.byteLength);
  out.set(iv);
  out.set(new Uint8Array(cipher), 12);
  return out;
}

async function decrypt(bytes) {
  return crypto.subtle.decrypt({ name: "AES-GCM", iv: bytes.slice(0, 12) }, key, bytes.slice(12));
}

export function initStorage() {
  ready ||= (async () => {
    let raw = readCookie(KEY_COOKIE);
    if (!raw || raw.length < 40) {
      // new key = new you. anything encrypted with an old key is useless now.
      wipeLocal();
      const fresh = crypto.getRandomValues(new Uint8Array(32));
      raw = b64.encode(fresh);
      writeCookie(KEY_COOKIE, raw);
    } else {
      writeCookie(KEY_COOKIE, raw); // refresh the expiry
    }
    key = await crypto.subtle.importKey("raw", b64.decode(raw), "AES-GCM", false, ["encrypt", "decrypt"]);

    const names = [];
    for (let i = 0; i < localStorage.length; i++) {
      const name = localStorage.key(i);
      if (name?.startsWith(PREFIX)) names.push(name);
    }
    await Promise.all(
      names.map(async (name) => {
        try {
          const plain = await decrypt(b64.decode(localStorage.getItem(name)));
          memory.set(name.slice(PREFIX.length), JSON.parse(new TextDecoder().decode(plain)));
        } catch {
          localStorage.removeItem(name);
        }
      }),
    );
  })();
  return ready;
}

const pendingWrites = new Map();

function flush(name) {
  pendingWrites.delete(name);
  if (!memory.has(name)) {
    localStorage.removeItem(PREFIX + name);
    return;
  }
  const bytes = new TextEncoder().encode(JSON.stringify(memory.get(name)));
  encrypt(bytes)
    .then((cipher) => {
      try {
        localStorage.setItem(PREFIX + name, b64.encode(cipher));
      } catch {
        console.warn("blackwaves storage is full, something big didn't save");
      }
    })
    .catch(() => {});
}

export const storage = {
  get(name, fallback = null) {
    return memory.has(name) ? memory.get(name) : fallback;
  },
  set(name, value) {
    memory.set(name, value);
    if (!pendingWrites.has(name)) pendingWrites.set(name, setTimeout(() => flush(name), 120));
    listeners.get(name)?.forEach((fn) => fn(value));
  },
  remove(name) {
    memory.delete(name);
    if (!pendingWrites.has(name)) pendingWrites.set(name, setTimeout(() => flush(name), 0));
    listeners.get(name)?.forEach((fn) => fn(null));
  },
  keys() {
    return [...memory.keys()];
  },
  on(name, fn) {
    if (!listeners.has(name)) listeners.set(name, new Set());
    listeners.get(name).add(fn);
    return () => listeners.get(name).delete(fn);
  },
  /** nuke it all: data, key, everything. used by "reset blackwaves" in settings. */
  reset() {
    wipeLocal();
    document.cookie = `${KEY_COOKIE}=; Path=/; Max-Age=0`;
    memory.clear();
  },
};

window.addEventListener("beforeunload", () => {
  for (const name of [...pendingWrites.keys()]) {
    clearTimeout(pendingWrites.get(name));
    flush(name);
  }
});

// ---- big things (custom backgrounds) go to indexeddb, still encrypted --------------

function idb() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open("blackwaves-blobs", 1);
    request.onupgradeneeded = () => request.result.createObjectStore("blobs");
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export async function putBlob(name, blob) {
  const db = await idb();
  const cipher = blob ? await encrypt(new Uint8Array(await blob.arrayBuffer())) : null;
  await new Promise((resolve, reject) => {
    const tx = db.transaction("blobs", "readwrite");
    if (cipher) tx.objectStore("blobs").put({ type: blob.type, data: cipher }, name);
    else tx.objectStore("blobs").delete(name);
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
  });
}

export async function getBlob(name) {
  try {
    const db = await idb();
    const entry = await new Promise((resolve, reject) => {
      const request = db.transaction("blobs").objectStore("blobs").get(name);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    if (!entry) return null;
    return new Blob([await decrypt(entry.data)], { type: entry.type });
  } catch {
    return null;
  }
}

export { b64 };
