// wisp-js is built for a handful of users. at a few hundred, a browser that
// stops reading (slow wifi, a frozen tab) makes the server hoard data for it,
// and enough of those take the whole process down. we tested this: stock
// wisp-js ran out of memory with 300 stalled browsers. it has no hooks for any
// of this, so we patch a few things:
// - each browser connection buffers at most WS_BUFFER (1mb) instead of 32mb
//   before we stop reading from the websites it's talking to
// - waiting for that buffer to empty uses the socket's own "drain" event
//   instead of every stream polling every 10ms (2,400 stalled streams made
//   ~240k timer wake-ups a second and froze the event loop)
// - each stream queues at most RECV_CHUNKS chunks (~256kb) instead of 128 (~8mb).
//   the website just waits, which is what tcp flow control is for
// - when memory is critical, new streams are refused (the page retries) and
//   open streams shrink their queues further
// - with YOUTUBE_PROXY set, youtube hosts are tunnelled through that proxy
import { memoryCritical, onPressure } from "./memory.js";
import { isYoutubeHost, tunnelYoutube } from "./youtube-route.js";

const WS_BUFFER = 1024 * 1024;
const RECV_CHUNKS = 4;
const SQUEEZED_CHUNKS = 1;
const SEND_PACKETS = 32;
// a browser that hasn't read anything for this long while memory is critical
// gets disconnected; its proxy transport reconnects by itself when it wakes up
const STALL_MS = 20_000;
const live = new Set();
const stalled = new Set();

onPressure((level) => {
  if (level !== "critical") return;
  for (const socket of live) socket.data_queue.max_size = SQUEEZED_CHUNKS;
  const now = Date.now();
  for (const ws of stalled) {
    if (ws.readyState !== 1) stalled.delete(ws);
    else if (now - ws.__bwStalledAt > STALL_MS) {
      stalled.delete(ws);
      ws.terminate();
    }
  }
});

/** one shared "wait until this websocket has room" promise per connection */
function room(ws) {
  if (ws.bufferedAmount <= WS_BUFFER / 2 || ws.readyState !== 1) return null;
  if (ws.__bwRoom) return ws.__bwRoom;
  ws.__bwStalledAt = Date.now();
  stalled.add(ws);
  ws.__bwRoom = new Promise((resolve) => {
    const socket = ws._socket;
    const check = () => {
      if (ws.bufferedAmount > WS_BUFFER / 2 && ws.readyState === 1) return;
      socket?.off("drain", check);
      ws.off("close", check);
      clearInterval(fallback);
      stalled.delete(ws);
      ws.__bwRoom = null;
      resolve();
    };
    socket?.on("drain", check);
    ws.on("close", check);
    // belt and braces in case a drain is missed
    const fallback = setInterval(check, 250);
    fallback.unref?.();
  });
  return ws.__bwRoom;
}

export async function tuneWisp() {
  const base = new URL("../../node_modules/@mercuryworkshop/wisp-js/src/", import.meta.url);
  const load = (file) => import(new URL(file, base).href);
  const [{ NodeTCPSocket }, { ServerStream }, { AsyncWebSocket }, { WispPacket }] = await Promise.all([
    load("server/net.mjs"),
    load("server/connection.mjs"),
    load("websocket.mjs"),
    load("packet.mjs"),
  ]);

  // packets a browser may send ahead of us (uploads); wisp tells clients this number
  ServerStream.buffer_size = SEND_PACKETS;

  AsyncWebSocket.prototype.send = async function send(data) {
    if (data instanceof WispPacket) data = data.serialize().bytes;
    this.ws.send(data);
    if (this.ws.bufferedAmount <= WS_BUFFER) return;
    const wait = room(this.ws);
    if (wait) await wait;
  };

  // stock wisp-js resumes reading after every send even when the queue is full,
  // and every chunk that arrives meanwhile gets parked in memory waiting for room.
  // against a fast website and a stalled browser that grows forever (we measured
  // 10.7gb at 100 users). so: pause the moment the queue is full, and only
  // resume once there's room again.
  const full = (socket) => socket.data_queue.size >= socket.data_queue.max_size;
  const brake = (socket) => {
    if (socket.socket && full(socket)) {
      socket.socket.pause();
      socket.paused = true;
    }
  };
  NodeTCPSocket.prototype.resume = function resume() {
    if (!this.socket || !this.paused || full(this)) return;
    this.socket.resume();
    this.paused = false;
  };
  const originalRecv = NodeTCPSocket.prototype.recv;
  NodeTCPSocket.prototype.recv = async function recv() {
    const data = await originalRecv.call(this);
    this.resume();
    return data;
  };

  const original = NodeTCPSocket.prototype.connect;
  const originalClose = NodeTCPSocket.prototype.close;
  NodeTCPSocket.prototype.close = async function close() {
    live.delete(this);
    return originalClose.call(this);
  };
  NodeTCPSocket.prototype.connect = async function connect() {
    if (memoryCritical()) throw new Error("server is low on memory, try again in a moment");
    this.data_queue.max_size = RECV_CHUNKS;
    if (!tunnelYoutube || !isYoutubeHost(this.hostname)) {
      await original.call(this);
      this.socket?.on("data", () => brake(this));
      this.socket?.once("close", () => live.delete(this));
      live.add(this);
      return;
    }
    const socket = await tunnelYoutube(this.hostname, this.port);
    this.socket = socket;
    this.connected = true;
    live.add(this);
    socket.setNoDelay(true);
    socket.on("data", (data) => {
      this.data_queue.put(data);
      brake(this);
    });
    socket.on("close", () => {
      live.delete(this);
      this.data_queue.close();
      this.socket = null;
    });
    socket.on("error", () => {});
    socket.on("end", () => {
      if (!this.socket) return;
      this.socket.destroy();
      this.socket = null;
    });
  };
}
