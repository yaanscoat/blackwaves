import { signal } from "@preact/signals";
import { get } from "./api.js";
import { storage } from "./storage.js";
import { toast } from "./notify.js";

// one <audio> for the whole app, so music keeps going while you browse
const audio = typeof Audio !== "undefined" ? new Audio() : null;
if (audio) audio.preload = "auto";

export const nowPlaying = signal(null);
export const queue = signal([]);
export const playing = signal(false);
export const progress = signal({ time: 0, duration: 0 });
export const loadingTrack = signal(false);
export const volume = signal(1);
export const shuffle = signal(false);
export const repeat = signal("off"); // "off" | "all" | "one"
export const likes = signal([]);
export const savedAlbums = signal([]);

export function loadMusicState() {
  likes.value = storage.get("musicLikes", []);
  savedAlbums.value = storage.get("musicAlbums", []);
  repeat.value = storage.get("musicRepeat", "off");
  shuffle.value = storage.get("musicShuffle", false);
  volume.value = storage.get("musicVolume", 1);
  if (audio) audio.volume = volume.value;
}

let hls = null;

/** soundcloud mostly serves hls, which only safari plays natively; everyone else gets hls.js */
async function load(stream, type) {
  hls?.destroy();
  hls = null;
  if (type === "hls" && !audio.canPlayType("application/vnd.apple.mpegurl")) {
    const { default: Hls } = await import("hls.js");
    if (Hls.isSupported()) {
      hls = new Hls({ maxBufferLength: 30, enableWorker: true });
      hls.loadSource(stream);
      hls.attachMedia(audio);
      return;
    }
  }
  audio.src = stream;
}

export async function playTrack(track, list = null) {
  if (!audio) return;
  if (list) queue.value = list;
  else if (!queue.value.some((entry) => entry.id === track.id)) queue.value = [track];
  nowPlaying.value = track;
  loadingTrack.value = true;
  try {
    const { stream, type } = await get(`/api/music/track/${encodeURIComponent(track.id)}`);
    if (nowPlaying.value?.id !== track.id) return;
    await load(stream, type);
    await audio.play();
    const recent = storage.get("musicRecents", []).filter((entry) => entry.id !== track.id);
    storage.set("musicRecents", [track, ...recent].slice(0, 30));
    if ("mediaSession" in navigator) {
      navigator.mediaSession.metadata = new MediaMetadata({
        title: track.title,
        artist: track.artist?.name || "",
        artwork: track.album?.cover ? [{ src: track.album.cover, sizes: "480x480" }] : [],
      });
    }
  } catch (error) {
    if (error.name !== "AbortError") toast(error.message || "that track won't play, skipping", { kind: "error" });
    setTimeout(next, 800);
  } finally {
    loadingTrack.value = false;
  }
}

export function toggle() {
  if (!audio || !nowPlaying.value) return;
  if (audio.paused) void audio.play();
  else audio.pause();
}

export function next() {
  const list = queue.value;
  if (!list.length) return;
  const index = list.findIndex((entry) => entry.id === nowPlaying.value?.id);
  let target;
  if (shuffle.value && list.length > 1) {
    do target = list[Math.floor(Math.random() * list.length)];
    while (target.id === nowPlaying.value?.id);
  } else target = list[index + 1] || (repeat.value === "all" ? list[0] : null);
  if (target) void playTrack(target);
  else audio.pause();
}

export function prev() {
  if (!audio) return;
  if (audio.currentTime > 4) {
    audio.currentTime = 0;
    return;
  }
  const list = queue.value;
  const index = list.findIndex((entry) => entry.id === nowPlaying.value?.id);
  if (index > 0) void playTrack(list[index - 1]);
}

export function seek(seconds) {
  if (audio && Number.isFinite(seconds)) audio.currentTime = seconds;
}

export function setVolume(value) {
  volume.value = value;
  if (audio) audio.volume = value;
  storage.set("musicVolume", value);
}

export function stop() {
  if (!audio) return;
  hls?.destroy();
  hls = null;
  audio.pause();
  audio.removeAttribute("src");
  nowPlaying.value = null;
  queue.value = [];
}

export function toggleLike(track) {
  const liked = likes.value.some((entry) => entry.id === track.id);
  likes.value = liked ? likes.value.filter((entry) => entry.id !== track.id) : [track, ...likes.value];
  storage.set("musicLikes", likes.value);
  return !liked;
}

if (audio) {
  audio.addEventListener("play", () => (playing.value = true));
  // the spinner goes away as soon as audio actually flows, not when play() resolves
  audio.addEventListener("playing", () => (loadingTrack.value = false));
  audio.addEventListener("canplay", () => (loadingTrack.value = false));
  audio.addEventListener("error", () => (loadingTrack.value = false));
  audio.addEventListener("pause", () => (playing.value = false));
  audio.addEventListener("timeupdate", () => (progress.value = { time: audio.currentTime, duration: audio.duration || nowPlaying.value?.duration || 0 }));
  audio.addEventListener("ended", () => {
    if (repeat.value === "one") {
      audio.currentTime = 0;
      void audio.play();
    } else next();
  });
  if ("mediaSession" in navigator) {
    navigator.mediaSession.setActionHandler("play", toggle);
    navigator.mediaSession.setActionHandler("pause", toggle);
    navigator.mediaSession.setActionHandler("nexttrack", next);
    navigator.mediaSession.setActionHandler("previoustrack", prev);
  }
}

export function cycleRepeat() {
  repeat.value = { off: "all", all: "one", one: "off" }[repeat.value] || "off";
  storage.set("musicRepeat", repeat.value);
}

export function toggleShuffle() {
  shuffle.value = !shuffle.value;
  storage.set("musicShuffle", shuffle.value);
}

export function isSavedAlbum(album) {
  return savedAlbums.value.some((entry) => entry.id === album.id);
}

export function toggleSavedAlbum(album) {
  const saved = isSavedAlbum(album);
  savedAlbums.value = saved ? savedAlbums.value.filter((entry) => entry.id !== album.id) : [album, ...savedAlbums.value];
  storage.set("musicAlbums", savedAlbums.value);
  return !saved;
}

/** saves the track as a real audio file through our stream proxy */
export async function downloadTrack(track) {
  try {
    toast(`downloading ${track.title}...`);
    const { stream } = await get(`/api/music/track/${encodeURIComponent(track.id)}`);
    const name = [track.artist?.name, track.title].filter(Boolean).join(" - ");
    const link = document.createElement("a");
    link.href = `${stream}&dl=${encodeURIComponent(name)}`;
    link.download = "";
    document.body.append(link);
    link.click();
    link.remove();
  } catch (error) {
    toast(error.message || "that track can't be downloaded", { kind: "error" });
  }
}

export function formatTime(seconds) {
  if (!Number.isFinite(seconds) || seconds < 0) return "0:00";
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}
