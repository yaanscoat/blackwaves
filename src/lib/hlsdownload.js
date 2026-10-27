// downloads an hls stream (movies, soundcloud songs) on this device. the server
// only relays one segment at a time; the stitching happens here, so the file
// lives in your browser or on your disk instead of in the server's memory.
import { signal } from "@preact/signals";

export const downloads = signal([]);

const AHEAD = 4;
let counter = 0;

function update(id, patch) {
  downloads.value = downloads.value.map((entry) => (entry.id === id ? { ...entry, ...patch } : entry));
}

function finish(id, patch) {
  update(id, patch);
  setTimeout(() => (downloads.value = downloads.value.filter((entry) => entry.id !== id)), patch.error ? 8000 : 4000);
}

export function cancelDownload(id) {
  downloads.value.find((entry) => entry.id === id)?.controller.abort();
}

async function fetchText(url, signal) {
  const response = await fetch(url, { signal, credentials: "same-origin" });
  if (!response.ok) throw new Error(`the stream didn't load (${response.status})`);
  return response.text();
}

/** reads a playlist (picking the best quality from a master one) into segment urls */
async function segments(playlistUrl, signal) {
  let url = new URL(playlistUrl, location.href).href;
  let playlist = await fetchText(url, signal);
  if (!playlist.startsWith("#EXTM3U")) throw new Error("that isn't a stream");
  if (playlist.includes("#EXT-X-STREAM-INF")) {
    const lines = playlist.split("\n");
    let best = null;
    for (let i = 0; i < lines.length; i++) {
      const bandwidth = /BANDWIDTH=(\d+)/.exec(lines[i]);
      const next = lines[i + 1]?.trim();
      if (bandwidth && next && !next.startsWith("#") && (!best || Number(bandwidth[1]) > best.bandwidth)) best = { bandwidth: Number(bandwidth[1]), uri: next };
    }
    if (!best) throw new Error("no downloadable quality in that stream");
    url = new URL(best.uri, url).href;
    playlist = await fetchText(url, signal);
  }
  if (/#EXT-X-KEY:METHOD=(?!NONE)/.test(playlist)) throw new Error("this stream is encrypted and can't be downloaded");
  const parts = [];
  let fmp4 = false;
  for (const line of playlist.split("\n")) {
    const map = /#EXT-X-MAP:URI="([^"]+)"/.exec(line);
    if (map) {
      fmp4 = true;
      parts.push(new URL(map[1], url).href);
    } else if (line.trim() && !line.startsWith("#")) parts.push(new URL(line.trim(), url).href);
  }
  if (!parts.length) throw new Error("that stream is empty");
  return { parts, fmp4 };
}

/**
 * kind: "video" or "audio". mpeg-ts segments join into a valid .ts and fmp4
 * segments (init map first) into a valid .mp4/.m4a, so no remuxing is needed.
 */
export async function downloadHls({ url, name, kind = "video" }) {
  const id = ++counter;
  const controller = new AbortController();
  const safe = String(name || "download").replace(/[\\/:*?"<>|]+/g, "").trim().slice(0, 120) || "download";
  downloads.value = [...downloads.value, { id, name: safe, progress: 0, state: "starting", controller }];
  try {
    const { parts, fmp4 } = await segments(url, controller.signal);
    const audioMp3 = kind === "audio" && parts.some((part) => /\.mp3(\?|&|$)/i.test(decodeURIComponent(part)));
    const ext = kind === "audio" ? (audioMp3 ? "mp3" : "m4a") : fmp4 ? "mp4" : "ts";
    const type = kind === "audio" ? (audioMp3 ? "audio/mpeg" : "audio/mp4") : fmp4 ? "video/mp4" : "video/mp2t";
    const file = `${safe}.${ext}`;

    // chrome and edge can write straight to disk as segments arrive; everyone
    // else collects them into a blob (browsers page big blobs out to disk too)
    let writable = null;
    if (window.showSaveFilePicker) {
      try {
        const handle = await window.showSaveFilePicker({ suggestedName: file });
        writable = await handle.createWritable();
      } catch (error) {
        if (error.name === "AbortError") throw error;
      }
    }
    const blobs = [];
    update(id, { state: "downloading", name: file });

    const grab = (part) => {
      const pending = fetch(part, { signal: controller.signal, credentials: "same-origin" }).then((response) => {
        if (!response.ok) throw new Error(`a piece of the stream failed (${response.status})`);
        return response.blob();
      });
      pending.catch(() => {});
      return pending;
    };
    const queue = parts.slice(0, AHEAD).map(grab);
    for (let index = 0; index < parts.length; index++) {
      if (index + AHEAD < parts.length) queue.push(grab(parts[index + AHEAD]));
      const blob = await queue[index];
      queue[index] = null;
      if (writable) await writable.write(blob);
      else blobs.push(blob);
      update(id, { progress: (index + 1) / parts.length });
    }

    if (writable) await writable.close();
    else {
      const link = document.createElement("a");
      link.href = URL.createObjectURL(new Blob(blobs, { type }));
      link.download = file;
      document.body.append(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(link.href), 60_000);
    }
    finish(id, { state: "done", progress: 1 });
  } catch (error) {
    if (error.name === "AbortError") finish(id, { state: "cancelled" });
    else finish(id, { state: "failed", error: error.message || "the download failed" });
  }
}
