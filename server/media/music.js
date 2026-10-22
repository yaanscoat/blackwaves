// music: youtube music (through youtubei.js) and soundcloud (its public web
// api) for search and playback. every byte of audio and every cover image comes
// back through this server, so the browser only ever talks to blackwaves.
//
// ids carry their source: "y:<videoId>" youtube music, "s:<trackId>" soundcloud,
// "ya:<browseId>" yt album, "yr:<channelId>" yt artist, "sr:<userId>" sc artist.
// "a:<id>" is audius, kept so songs liked before 3.0 still play.
import crypto from "node:crypto";
import vm from "node:vm";
import { Readable } from "node:stream";
import { Innertube, Log, Platform } from "youtubei.js";
import { BROWSER_UA, publicFetch } from "../lib/net.js";
import { createCache } from "../lib/cache.js";
import { json, securityHeaders, text } from "../lib/http.js";

Log.setLevel(Log.Level.NONE);

const cache = createCache({ max: 2000, ttl: 20 * 60 * 1000 });
const SIGNING_KEY = crypto.randomBytes(32);
const httpError = (status, message) => Object.assign(new Error(message), { status });

function sign(url) {
  return crypto.createHmac("sha256", SIGNING_KEY).update(url).digest("base64url").slice(0, 32);
}
const signed = (kind, url) => (url ? `/api/music/${kind}?u=${encodeURIComponent(url)}&s=${sign(url)}` : "");

// ---- youtube music ---------------------------------------------------------------------

// youtube scrambles stream urls with functions from its player script. youtubei.js
// finds them, we run them in a throwaway vm context with a timeout.
Platform.shim.eval = async (data, env) => {
  const props = [];
  if (env.n) props.push(`n: exportedVars.nFunction(${JSON.stringify(env.n)})`);
  if (env.sig) props.push(`sig: exportedVars.sigFunction(${JSON.stringify(env.sig)})`);
  return vm.runInNewContext(`(function(){${data.output}\nreturn { ${props.join(", ")} };})()`, {}, { timeout: 3000 });
};

let innertube = null;
let innertubeAt = 0;
async function yt() {
  // the player script rotates, so start a fresh session every few hours
  if (!innertube || Date.now() - innertubeAt > 4 * 60 * 60 * 1000) {
    innertube = Innertube.create({ generate_session_locally: true, retrieve_player: true }).catch((error) => {
      innertube = null;
      throw error;
    });
    innertubeAt = Date.now();
  }
  return innertube;
}

function ytThumb(thumbnail, size = 544) {
  const list = thumbnail?.contents || thumbnail || [];
  const url = (Array.isArray(list) ? list : [])[0]?.url || "";
  if (!url) return "";
  // googleusercontent urls take a size suffix, so ask for something crisp
  return signed("art", url.replace(/=w\d+-h\d+[^&]*/, `=w${size}-h${size}-l90-rj`));
}

function ytArtists(item) {
  const list = item.artists || (item.author ? [item.author] : []);
  return list.filter((artist) => artist?.name);
}

function ytTrack(item, fallback = {}) {
  const artists = ytArtists(item);
  const first = artists[0] || fallback.artist;
  return {
    id: `y:${item.id}`,
    title: item.title?.text || item.title || "Untitled",
    duration: item.duration?.seconds || 0,
    explicit: Boolean(item.badges?.some?.((badge) => /explicit/i.test(badge.label || ""))),
    artist: first ? { id: first.channel_id ? `yr:${first.channel_id}` : "", name: artists.map((artist) => artist.name).join(", ") || first.name } : null,
    album: item.album ? { id: item.album.id ? `ya:${item.album.id}` : "", title: item.album.name, cover: ytThumb(item.thumbnail) || fallback.cover || "" } : { id: "", title: "", cover: ytThumb(item.thumbnail) || fallback.cover || "" },
    source: "ytmusic",
  };
}

function ytAlbum(item) {
  const artists = ytArtists(item);
  return {
    id: `ya:${item.id}`,
    title: item.title?.text || item.title || item.name || "Untitled",
    cover: ytThumb(item.thumbnail, 400),
    artist: artists[0] ? { id: artists[0].channel_id ? `yr:${artists[0].channel_id}` : "", name: artists[0].name } : null,
    year: item.year || "",
    count: 0,
    source: "ytmusic",
  };
}

const ytArtist = (item) => ({ id: `yr:${item.id}`, name: item.name || item.title?.text || "Artist", picture: ytThumb(item.thumbnail, 400) });

const isSong = (item) => item?.id && (item.item_type === "song" || item.item_type === "video" || item.type === "MusicResponsiveListItem" && item.duration);
const isAlbumLike = (item) => item?.id && ["album", "playlist", "single", "ep"].includes(item.item_type);

const ytmusic = {
  async search(query, type) {
    const filter = { tracks: "song", albums: "album", artists: "artist" }[type] || "song";
    const result = await (await yt()).music.search(query, { type: filter });
    if (type === "albums") return (result.albums?.contents || []).map(ytAlbum);
    if (type === "artists") return (result.artists?.contents || []).map(ytArtist);
    return (result.songs?.contents || []).filter((item) => item.id).map((item) => ytTrack(item));
  },
  async home() {
    const client = await yt();
    // the home feed plus the explore page (trending, new releases); moods are just links, skip them
    const [feed, explore] = await Promise.allSettled([client.music.getHomeFeed(), client.music.getExplore()]);
    const sections = [
      ...(feed.status === "fulfilled" ? feed.value.sections || [] : []),
      ...(explore.status === "fulfilled" ? explore.value.sections || [] : []),
    ].filter((section) => !/mood|genre|video/i.test(section.header?.title?.text || ""));
    const shelves = [];
    for (const section of sections) {
      const items = section.contents || [];
      const title = section.header?.title?.text;
      if (!title || !items.length) continue;
      const songs = items.filter(isSong).map((item) => ytTrack(item));
      const albums = items.filter(isAlbumLike).map(ytAlbum);
      if (songs.length >= 4) shelves.push({ title, kind: "tracks", items: songs.slice(0, 16) });
      else if (albums.length >= 4) shelves.push({ title, kind: "albums", items: albums.slice(0, 16) });
      if (shelves.length >= 6) break;
    }
    return shelves;
  },
  async album(id) {
    const album = await (await yt()).music.getAlbum(id);
    const header = album.header || {};
    const artistName = header.author?.name || header.strapline_text_one?.text || header.subtitle?.text?.split("•")[1]?.trim() || "";
    const cover = ytThumb(header.thumbnail, 544);
    const info = {
      id: `ya:${id}`,
      title: header.title?.text || "Album",
      cover,
      artist: artistName ? { id: header.author?.channel_id ? `yr:${header.author.channel_id}` : "", name: artistName } : null,
      year: (header.subtitle?.text || "").match(/\b(19|20)\d{2}\b/)?.[0] || "",
      count: album.contents?.length || 0,
      source: "ytmusic",
    };
    const tracks = (album.contents || [])
      .filter((item) => item.id)
      .map((item) => ytTrack(item, { artist: info.artist, cover }))
      .map((track) => ({ ...track, album: { id: info.id, title: info.title, cover } }));
    return { album: info, tracks };
  },
  async artist(id) {
    const artist = await (await yt()).music.getArtist(id);
    const header = artist.header || {};
    const info = { id: `yr:${id}`, name: header.title?.text || "Artist", picture: ytThumb(header.thumbnail || header.foreground_thumbnail, 544) };
    let tracks = [];
    let albums = [];
    for (const section of artist.sections || []) {
      const title = (section.header?.title?.text || section.title?.text || "").toLowerCase();
      if (!tracks.length && title.includes("song")) tracks = (section.contents || []).filter((item) => item.id).map((item) => ytTrack(item));
      if (title.includes("album") || title.includes("single")) albums.push(...(section.contents || []).filter(isAlbumLike).map(ytAlbum));
    }
    return { artist: info, albums: albums.slice(0, 20), tracks };
  },
  async stream(id) {
    return cache.wrap(`ys:${id}`, async () => {
      const client = await yt();
      const info = await client.music.getInfo(id);
      if (info.playability_status?.status && info.playability_status.status !== "OK") {
        throw httpError(403, info.playability_status.reason || "youtube won't play that one here");
      }
      const format = info.chooseFormat({ type: "audio", quality: "best", format: "mp4" });
      const url = await format.decipher(client.session.player);
      return { stream: signed("stream", url), type: "file" };
    }, 60 * 60 * 1000);
  },
};

// ---- soundcloud -------------------------------------------------------------------------

const SC_API = "https://api-v2.soundcloud.com";
let scClient = null;
let scClientAt = 0;

/** soundcloud's web app ships a public client_id in its js bundles; we borrow it */
async function scClientId(force = false) {
  if (!force && scClient && Date.now() - scClientAt < 12 * 60 * 60 * 1000) return scClient;
  const html = await (await publicFetch("https://soundcloud.com/", { headers: { "user-agent": BROWSER_UA }, signal: AbortSignal.timeout(8000) })).text();
  const scripts = [...html.matchAll(/<script[^>]+src="(https:\/\/a-v2\.sndcdn\.com\/assets\/[^"]+\.js)"/g)].map((match) => match[1]).reverse();
  for (const src of scripts) {
    const js = await (await publicFetch(src, { signal: AbortSignal.timeout(8000) })).text();
    const match = js.match(/client_id\s*:\s*"([a-zA-Z0-9]{32})"/) || js.match(/client_id=([a-zA-Z0-9]{32})/);
    if (match) {
      scClient = match[1];
      scClientAt = Date.now();
      return scClient;
    }
  }
  throw httpError(502, "couldn't connect to soundcloud");
}

async function sc(path, params = {}, retried = false) {
  const url = new URL(SC_API + path);
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  url.searchParams.set("client_id", await scClientId());
  const response = await publicFetch(url, { headers: { "user-agent": BROWSER_UA, accept: "application/json" }, signal: AbortSignal.timeout(9000) });
  if ((response.status === 401 || response.status === 403) && !retried) {
    await scClientId(true);
    return sc(path, params, true);
  }
  if (!response.ok) throw httpError(response.status === 404 ? 404 : 502, "soundcloud didn't answer");
  return response.json();
}

const scArt = (url, size = "t500x500") => (url ? signed("art", url.replace("-large.", `-${size}.`)) : "");
const scPlayable = (track) => track && track.policy !== "BLOCK" && track.media?.transcodings?.length;
const scArtist = (user) => (user ? { id: `sr:${user.id}`, name: user.username || user.full_name || "Artist", picture: scArt(user.avatar_url) } : null);
const scTrack = (track) => ({
  id: `s:${track.id}`,
  title: track.title,
  duration: Math.round((track.full_duration || track.duration || 0) / 1000),
  explicit: false,
  artist: scArtist(track.user),
  album: { id: "", title: track.genre || "", cover: scArt(track.artwork_url || track.user?.avatar_url) },
  source: "soundcloud",
});

const SC_GENRES = { all: "all-music" };

const soundcloud = {
  async search(query, type) {
    if (type === "artists") return (await sc("/search/users", { q: query, limit: 20 })).collection.map(scArtist);
    if (type === "albums") return [];
    return (await sc("/search/tracks", { q: query, limit: 30 })).collection.filter(scPlayable).map(scTrack);
  },
  async charts(genre = "all") {
    const data = await sc("/charts", { kind: "trending", genre: `soundcloud:genres:${SC_GENRES[genre] || "all-music"}`, limit: 24 });
    return (data.collection || []).map((entry) => entry.track).filter(scPlayable).map(scTrack);
  },
  async artist(id) {
    const [user, tracks] = await Promise.all([sc(`/users/${id}`), sc(`/users/${id}/tracks`, { limit: 40 })]);
    return { artist: scArtist(user), albums: [], tracks: (tracks.collection || []).filter(scPlayable).map(scTrack) };
  },
  async stream(id) {
    return cache.wrap(`ss:${id}`, async () => {
      const track = await sc(`/tracks/${id}`);
      if (!scPlayable(track)) throw httpError(403, "soundcloud won't stream that track");
      // progressive mp3 first, then hls aac, then whatever's left. soundcloud
      // still lists an mp3-over-hls option that 404s, so we just try them in order.
      const rank = (entry) => (entry.format.protocol === "progressive" ? 0 : entry.format.mime_type.includes("mp4") ? 1 : 2);
      const options = [...track.media.transcodings].sort((a, b) => rank(a) - rank(b));
      const params = track.track_authorization ? { track_authorization: track.track_authorization } : {};
      for (const option of options) {
        try {
          const resolved = await sc(new URL(option.url).pathname, params);
          if (!resolved.url) continue;
          return option.format.protocol === "hls" ? { stream: signed("hls", resolved.url), type: "hls" } : { stream: signed("stream", resolved.url), type: "file" };
        } catch {}
      }
      throw httpError(403, "soundcloud won't stream that track");
    }, 10 * 60 * 1000);
  },
};

// ---- audius (only for songs liked before 3.0) ---------------------------------------------

const audius = {
  async stream(id) {
    const response = await publicFetch(`https://api.audius.co/v1/tracks/${encodeURIComponent(id)}?app_name=blackwaves`, { signal: AbortSignal.timeout(9000) });
    const track = response.ok ? (await response.json()).data : null;
    const url = track?.stream?.url || `https://api.audius.co/v1/tracks/${encodeURIComponent(id)}/stream?app_name=blackwaves`;
    return { stream: signed("stream", url), type: "file" };
  },
};

function provider(id) {
  const match = /^(y|s|ya|yr|sr|a):([A-Za-z0-9_-]+)$/.exec(String(id));
  if (!match) throw httpError(400, "bad id");
  return [match[1], match[2]];
}

// ---- byte pipes -------------------------------------------------------------------------

function verify(searchParams) {
  const url = searchParams.get("u") || "";
  const signature = searchParams.get("s") || "";
  const expected = sign(url);
  if (signature.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) return null;
  return url;
}

const AUDIO_EXT = { "audio/mpeg": "mp3", "audio/mp3": "mp3", "audio/flac": "flac", "audio/mp4": "m4a", "audio/aac": "aac", "audio/ogg": "ogg", "audio/webm": "webm", "audio/wav": "wav" };

function attachment(name, type) {
  const ext = AUDIO_EXT[String(type).split(";")[0].trim()] || "mp3";
  const file = `${name.replace(/[\\/:*?"<>|]+/g, "").slice(0, 120) || "track"}.${ext}`;
  return `attachment; filename="${file.replace(/[^\x20-\x7e]/g, "_")}"; filename*=UTF-8''${encodeURIComponent(file)}`;
}

async function pipe(req, res, url, { audio, download = "" }) {
  try {
    const headers = { "user-agent": BROWSER_UA };
    if (audio && req.headers.range && !download) headers.range = req.headers.range;
    const upstream = await publicFetch(url, { headers, signal: AbortSignal.timeout(audio ? 15 * 60 * 1000 : 15_000) });
    if (!upstream.ok && upstream.status !== 206) return text(res, 502, "upstream error");
    const out = {
      "Content-Type": upstream.headers.get("content-type") || (audio ? "audio/mpeg" : "image/jpeg"),
      "Cache-Control": audio ? "private, max-age=3600" : "public, max-age=604800",
    };
    if (audio) out["Accept-Ranges"] = "bytes";
    if (download) out["Content-Disposition"] = attachment(download, out["Content-Type"]);
    for (const name of ["content-length", "content-range"]) {
      const value = upstream.headers.get(name);
      if (value) out[name] = value;
    }
    res.writeHead(upstream.status, securityHeaders(out));
    if (!upstream.body) return res.end();
    const body = Readable.fromWeb(upstream.body);
    res.on("close", () => body.destroy());
    body.on("error", () => res.destroy()).pipe(res);
  } catch {
    if (!res.headersSent) text(res, 502, "upstream error");
    else res.destroy();
  }
}

/** soundcloud hls: rewrite the playlist so every segment comes back through us, signed */
async function hls(req, res, url, download) {
  try {
    const response = await publicFetch(url, { headers: { "user-agent": BROWSER_UA }, signal: AbortSignal.timeout(15_000) });
    if (!response.ok) return text(res, 502, "upstream error");
    const type = response.headers.get("content-type") || "";
    if (!type.includes("mpegurl") && !/\.m3u8(\?|$)/.test(new URL(url).pathname)) return pipe(req, res, url, { audio: true });
    const playlist = await response.text();
    const lines = playlist.split("\n");
    const resolve = (value) => new URL(value, url).href;

    if (download) {
      // downloads get every segment glued into one file (works for mp3 and fragmented mp4)
      const parts = [];
      for (const line of lines) {
        const map = /#EXT-X-MAP:URI="([^"]+)"/.exec(line);
        if (map) parts.push(resolve(map[1]));
        else if (line.trim() && !line.startsWith("#")) parts.push(resolve(line.trim()));
      }
      const mp3 = parts.some((part) => /\.mp3(\?|$)/.test(part)) || /mp3|mpeg/.test(url);
      res.writeHead(200, securityHeaders({ "Content-Type": mp3 ? "audio/mpeg" : "audio/mp4", "Content-Disposition": attachment(download, mp3 ? "audio/mpeg" : "audio/mp4"), "Cache-Control": "no-store" }));
      for (const part of parts) {
        if (res.destroyed) return;
        const chunk = await publicFetch(part, { headers: { "user-agent": BROWSER_UA }, signal: AbortSignal.timeout(30_000) });
        if (!chunk.ok) break;
        res.write(Buffer.from(await chunk.arrayBuffer()));
      }
      return res.end();
    }

    const rewritten = lines
      .map((line) => {
        if (!line.trim()) return line;
        if (line.startsWith("#")) return line.replace(/URI="([^"]+)"/g, (_, uri) => `URI="${signed("hls", resolve(uri))}"`);
        return signed("hls", resolve(line.trim()));
      })
      .join("\n");
    text(res, 200, rewritten, { "Content-Type": "application/vnd.apple.mpegurl" });
  } catch {
    if (!res.headersSent) text(res, 502, "upstream error");
  }
}

// ---- routes -------------------------------------------------------------------------------

async function home() {
  return cache.wrap("home", async () => {
    // soundcloud only has the all-genre trending chart left; the genre charts all 404 now
    const [ytShelves, trending] = await Promise.allSettled([ytmusic.home(), soundcloud.charts("all")]);
    const shelves = [];
    if (ytShelves.status === "fulfilled") shelves.push(...ytShelves.value.map((shelf) => ({ ...shelf, source: "ytmusic" })));
    if (trending.status === "fulfilled" && trending.value.length) shelves.splice(1, 0, { title: "Trending on SoundCloud", kind: "tracks", items: trending.value, source: "soundcloud" });
    if (!shelves.length) throw httpError(502, "youtube music and soundcloud are both being shy right now");
    return shelves;
  }, 30 * 60 * 1000);
}

export async function handleMusic(req, res, pathname, searchParams) {
  const rest = pathname.slice("/api/music".length);
  if (rest === "/stream" || rest === "/art" || rest === "/hls") {
    const url = verify(searchParams);
    if (!url) return text(res, 403, "bad link");
    const download = String(searchParams.get("dl") || "");
    if (rest === "/hls") return hls(req, res, url, download);
    return pipe(req, res, url, { audio: rest === "/stream", download: rest === "/stream" ? download : "" });
  }
  try {
    if (rest === "/home") return json(res, 200, { shelves: await home() });
    if (rest === "/search") {
      const query = String(searchParams.get("q") || "").trim().slice(0, 120);
      const type = ["tracks", "albums", "artists"].includes(searchParams.get("type")) ? searchParams.get("type") : "tracks";
      const source = searchParams.get("source") === "soundcloud" ? "soundcloud" : "ytmusic";
      if (!query) return json(res, 200, { source, items: [] });
      const items = await cache.wrap(`q:${source}:${type}:${query.toLowerCase()}`, () => (source === "soundcloud" ? soundcloud : ytmusic).search(query, type));
      return json(res, 200, { source, items });
    }
    if (rest === "/charts") return json(res, 200, { source: "soundcloud", items: await cache.wrap(`c:${searchParams.get("genre")}`, () => soundcloud.charts(String(searchParams.get("genre") || "all"))) });
    let match;
    if ((match = /^\/album\/(.+)$/.exec(rest))) {
      const [kind, id] = provider(decodeURIComponent(match[1]));
      if (kind !== "ya") throw httpError(400, "that isn't an album");
      return json(res, 200, await cache.wrap(`al:${id}`, () => ytmusic.album(id)));
    }
    if ((match = /^\/artist\/(.+)$/.exec(rest))) {
      const [kind, id] = provider(decodeURIComponent(match[1]));
      if (kind === "yr") return json(res, 200, await cache.wrap(`ar:${id}`, () => ytmusic.artist(id)));
      if (kind === "sr") return json(res, 200, await cache.wrap(`sr:${id}`, () => soundcloud.artist(id)));
      throw httpError(400, "that isn't an artist");
    }
    if ((match = /^\/track\/(.+)$/.exec(rest))) {
      const [kind, id] = provider(decodeURIComponent(match[1]));
      const source = { y: ytmusic, s: soundcloud, a: audius }[kind];
      if (!source) throw httpError(400, "that isn't a track");
      return json(res, 200, await source.stream(id));
    }
  } catch (error) {
    return json(res, error.status || 502, { error: [400, 403, 404].includes(error.status) ? error.message : "the music servers are being shy, try again" });
  }
  return json(res, 404, { error: "not found" });
}
