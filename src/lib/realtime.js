import { signal } from "@preact/signals";
import { storage } from "./storage.js";

export const online = signal(0);
export const onlineUsers = signal(new Set());
export const connected = signal(false);

const handlers = new Map();
let socket = null;
let retry = 0;
let wanted = false;
let lastInput = Date.now();

export function on(type, fn) {
  if (!handlers.has(type)) handlers.set(type, new Set());
  handlers.get(type).add(fn);
  return () => handlers.get(type).delete(fn);
}

function emit(type, payload) {
  handlers.get(type)?.forEach((fn) => {
    try {
      fn(payload);
    } catch (error) {
      console.error(error);
    }
  });
}

function clientId() {
  let id = storage.get("cid");
  if (!id) {
    id = crypto.randomUUID();
    storage.set("cid", id);
  }
  return id;
}

export function send(payload) {
  if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify(payload));
}

export function connect() {
  wanted = true;
  if (socket && socket.readyState <= WebSocket.OPEN) return;
  socket = new WebSocket(`${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/api/ws`);
  socket.onopen = () => {
    retry = 0;
    connected.value = true;
    send({ t: "hello", cid: clientId() });
    emit("open");
  };
  socket.onmessage = (event) => {
    let data;
    try {
      data = JSON.parse(event.data);
    } catch {
      return;
    }
    if (data.t === "online") {
      online.value = data.count;
      onlineUsers.value = new Set(data.users || []);
    }
    emit(data.t, data);
  };
  socket.onclose = () => {
    connected.value = false;
    socket = null;
    if (!wanted) return;
    // exponential backoff, capped, with a pinch of jitter so 400 tabs don't reconnect in lockstep
    const delay = Math.min(30_000, 1000 * 2 ** retry++) + Math.random() * 800;
    setTimeout(connect, delay);
  };
}

/** reconnect so the server picks up a new login cookie */
export function reconnect() {
  if (socket) {
    socket.onclose = null;
    socket.close();
    socket = null;
  }
  connect();
}

for (const name of ["pointerdown", "keydown", "wheel", "touchstart"]) {
  window.addEventListener(name, () => (lastInput = Date.now()), { passive: true, capture: true });
}

// one coin a minute, but only if a human is actually here
setInterval(() => {
  if (document.visibilityState === "visible" && Date.now() - lastInput < 3 * 60_000) send({ t: "active" });
}, 60_000);
