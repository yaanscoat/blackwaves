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
import { Innertube, Log, Platform, YTNodes } from "youtubei.js";
import { mint } from "./potoken.js";
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
  // the player script rotates, so start a fresh session every few hours. the
  // session is tied to the same visitor the po tokens are minted for.
  if (!innertube || Date.now() - innertubeAt > 4 * 60 * 60 * 1000) {
    innertube = (async () => {
      const session = await mint().catch(() => null);
      return Innertube.create({
        generate_session_locally: true,
        retrieve_player: true,
        ...(session ? { po_token: session.token, visitor_data: session.visitorData } : {}),
      });
    })().catch((error) => {
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
  // artist pages don't fill in .album, it's only in the raw columns (title | artist | plays | album)
  const columns = (item.flex_columns || []).map((column) => column.title);
  const albumRun = columns.flatMap((column) => column?.runs || []).find((run) => run.endpoint?.payload?.browseId?.startsWith("MPRE"));
  const album = item.album || (albumRun ? { id: albumRun.endpoint.payload.browseId, name: albumRun.text } : null);
  const plays = columns.map((column) => column?.text || "").find((value) => /\bplays?$/i.test(value)) || "";
  return {
    id: `y:${item.id}`,
    title: item.title?.text || item.title || "Untitled",
    duration: item.duration?.seconds || 0,
    explicit: Boolean(item.badges?.some?.((badge) => /explicit/i.test(badge.label || ""))),
    artist: first ? { id: first.channel_id ? `yr:${first.channel_id}` : "", name: artists.map((artist) => artist.name).join(", ") || first.name } : null,
    album: album ? { id: album.id ? `ya:${album.id}` : "", title: album.name, cover: ytThumb(item.thumbnail) || fallback.cover || "" } : { id: "", title: "", cover: ytThumb(item.thumbnail) || fallback.cover || "" },
    ...(plays ? { plays: plays.replace(/\s*plays?$/i, "") } : {}),
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
    year: item.year || (item.subtitle?.text || "").match(/\b(19|20)\d{2}\b/)?.[0] || "",
    kind: /single|\bep\b/i.test(item.item_type || item.subtitle?.text || "") ? "Single" : "Album",
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
  /**
   * the whole artist page: photo, bio, popular songs, every song, every album and
   * single (the page itself only shows ten of each, so we follow its "more" links)
   * and the artists fans also like.
   */
  async artist(id) {
    const client = await yt();
    const artist = await client.music.getArtist(id);
    const header = artist.header || {};
    const photo = header.thumbnail || header.foreground_thumbnail;
    const info = {
      id: `yr:${id}`,
      name: header.title?.text || "Artist",
      picture: ytThumb(photo, 544),
      banner: ytThumb(photo, 1080),
      description: (header.description?.text || "").split("\n")[0].slice(0, 600),
      followers: header.subscription_button?.subscriber_count?.text || "",
      source: "ytmusic",
    };
    let popular = [];
    let related = [];
    const albums = [];
    const singles = [];
    const expand = async (section, into) => {
      into.push(...(section.contents || []).filter((item) => item.id).map(ytAlbum));
      const endpoint = section.header?.more_content?.endpoint;
      if (!endpoint) return;
      try {
        const page = await endpoint.call(client.actions, { client: "YTMUSIC", parse: true });
        const all = (page.contents_memo?.getType(YTNodes.MusicTwoRowItem) || []).filter((item) => item.id).map(ytAlbum);
        if (all.length > into.length) into.splice(0, into.length, ...all);
      } catch {}
    };
    const jobs = [];
    for (const section of artist.sections || []) {
      const title = (section.header?.title?.text || section.title?.text || "").toLowerCase();
      if (!popular.length && title.includes("song")) popular = (section.contents || []).filter((item) => item.id).map((item) => ytTrack(item));
      else if (title.startsWith("album")) jobs.push(expand(section, albums));
      else if (title.startsWith("single")) jobs.push(expand(section, singles));
      else if (title.includes("also like") || title.includes("similar")) related = (section.contents || []).filter((item) => item.id).map(ytArtist);
    }
    let tracks = [];
    jobs.push(
      artist
        .getAllSongs()
        .then((list) => (tracks = (list?.contents || []).filter((item) => item.id).map((item) => ytTrack(item))))
        .catch(() => {}),
    );
    await Promise.all(jobs);
    // the top songs shelf has no lengths, borrow them from the full list
    const lengths = new Map(tracks.map((track) => [track.id, track.duration]));
    for (const track of popular) track.duration ||= lengths.get(track.id) || 0;
    // and it only has five, so top it up to ten
    const seen = new Set(popular.map((track) => track.id));
    for (const track of tracks) {
      if (popular.length >= 10) break;
      if (!seen.has(track.id)) popular.push(track), seen.add(track.id);
    }
    const credit = (track) => (track.artist?.name ? track : { ...track, artist: { id: info.id, name: info.name } });
    singles.forEach((single) => (single.kind = "Single"));
    return { artist: info, popular: popular.map(credit), tracks: (tracks.length ? tracks : popular).map(credit), albums, singles, related };
  },
  async stream(id) {
    return cache.wrap(`ys:${id}`, async () => {
      const client = await yt();
      // the youtube music client plus a token bound to this exact video is the
      // only combination youtube still streams start to finish
      const token = (await mint(id).catch(() => null))?.token;
      let info;
      try {
        info = await client.getBasicInfo(id, { client: "YTMUSIC", ...(token ? { po_token: token } : {}) });
        if (info.playability_status?.status && info.playability_status.status !== "OK") throw new Error(info.playability_status.reason || "unplayable");
        const format = info.chooseFormat({ type: "audio", quality: "best", format: "mp4" });
        let url = await format.decipher(client.session.player);
        if (token) url = `${url.replace(/&pot=[^&]*/, "")}&pot=${token}`;
        return { stream: signed("stream", url), type: "file" };
      } catch (error) {
        // youtube said no (bot check, region lock, datacenter ip...). play the same song from soundcloud instead.
        const title = info?.basic_info?.title;
        const artist = info?.basic_info?.author?.replace(/ - Topic$/, "");
        if (title) {
          const match = (await soundcloud.search(`${artist || ""} ${title}`.trim(), "tracks").catch(() => []))[0];
          if (match) return { ...(await soundcloud.stream(match.id.slice(2))), fallback: "soundcloud" };
        }
        throw httpError(403, "youtube won't play that one right now");
      }
    }, 50 * 60 * 1000);
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

const COMPACT = new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 });
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
  ...(track.playback_count ? { plays: COMPACT.format(track.playback_count) } : {}),
  source: "soundcloud",
});

const scAlbum = (playlist, artist) => ({
  id: `sa:${playlist.id}`,
  title: playlist.title || "Untitled",
  cover: scArt(playlist.artwork_url || playlist.tracks?.[0]?.artwork_url || playlist.user?.avatar_url),
  artist,
  year: String(playlist.release_date || playlist.display_date || playlist.created_at || "").slice(0, 4),
  kind: ["ep", "single"].includes(playlist.set_type) ? "Single" : "Album",
  count: playlist.track_count || 0,
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
    const none = { collection: [] };
    const [user, top, tracks, albums] = await Promise.all([
      sc(`/users/${id}`),
      sc(`/users/${id}/toptracks`, { limit: 10 }).catch(() => none),
      sc(`/users/${id}/tracks`, { limit: 80 }).catch(() => none),
      sc(`/users/${id}/albums`, { limit: 50 }).catch(() => none),
    ]);
    const base = scArtist(user);
    const info = {
      ...base,
      banner: user.visuals?.visuals?.[0]?.visual_url ? signed("art", user.visuals.visuals[0].visual_url) : "",
      description: String(user.description || "").split("\n")[0].slice(0, 600),
      followers: user.followers_count ? `${Number(user.followers_count).toLocaleString("en-US")} followers` : "",
      source: "soundcloud",
    };
    const all = (tracks.collection || []).filter(scPlayable).map(scTrack);
    const popular = (top.collection || []).filter(scPlayable).map(scTrack);
    const records = (albums.collection || []).map((playlist) => scAlbum(playlist, base));
    return {
      artist: info,
      popular: (popular.length ? popular : all).slice(0, 10),
      tracks: all,
      albums: records.filter((album) => album.kind === "Album"),
      singles: records.filter((album) => album.kind === "Single"),
      related: [],
    };
  },
  async album(id) {
    const playlist = await sc(`/playlists/${id}`);
    // soundcloud only fills in the first few tracks, the rest come back as bare ids
    const listed = playlist.tracks || [];
    const full = listed.filter((track) => track.title);
    const missing = listed.filter((track) => !track.title).map((track) => track.id);
    for (let i = 0; i < missing.length; i += 50) {
      const batch = await sc("/tracks", { ids: missing.slice(i, i + 50).join(",") }).catch(() => []);
      if (Array.isArray(batch)) full.push(...batch);
    }
    const order = new Map(listed.map((track, index) => [track.id, index]));
    full.sort((a, b) => order.get(a.id) - order.get(b.id));
    const album = { ...scAlbum(playlist, scArtist(playlist.user)), count: full.length };
    return { album, tracks: full.filter(scPlayable).map(scTrack).map((track) => ({ ...track, album: { id: album.id, title: album.title, cover: track.album.cover || album.cover } })) };
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
  const match = /^(y|s|ya|yr|sr|sa|a):([A-Za-z0-9_-]+)$/.exec(String(id));
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

/**
 * youtube's media servers 403 any open-ended range ("bytes=0-", no range at
 * all, "bytes=1000-"). browsers and downloads always ask open-ended. so we read
 * the real size from the url (clen) and walk the file in bounded chunks,
 * handing the browser one normal-looking response.
 */
const YT_CHUNK = 2 * 1024 * 1024;
async function pipeYoutube(req, res, url, download) {
  const total = Number(new URL(url).searchParams.get("clen"));
  if (!total) return pipe(req, res, url, { audio: true, download, chunked: false });
  const match = !download && /bytes=(\d*)-(\d*)/.exec(req.headers.range || "");
  let start = match && match[1] ? Number(match[1]) : 0;
  let end = match && match[2] ? Math.min(Number(match[2]), total - 1) : total - 1;
  if (match && !match[1] && match[2]) {
    start = Math.max(0, total - Number(match[2]));
    end = total - 1;
  }
  if (start >= total || end < start) {
    res.writeHead(416, securityHeaders({ "Content-Range": `bytes */${total}` }));
    return res.end();
  }
  const mime = new URL(url).searchParams.get("mime") || "audio/mp4";
  const headers = { "Content-Type": mime, "Content-Length": end - start + 1, "Accept-Ranges": "bytes", "Cache-Control": "private, max-age=3600" };
  if (download) headers["Content-Disposition"] = attachment(download, mime);
  if (match) headers["Content-Range"] = `bytes ${start}-${end}/${total}`;
  res.writeHead(match ? 206 : 200, securityHeaders(headers));
  if (req.method === "HEAD") return res.end();
  let closed = false;
  res.on("close", () => (closed = true));
  for (let offset = start; offset <= end && !closed; offset += YT_CHUNK) {
    const last = Math.min(offset + YT_CHUNK - 1, end);
    try {
      const upstream = await publicFetch(url, { headers: { "user-agent": BROWSER_UA, range: `bytes=${offset}-${last}` }, signal: AbortSignal.timeout(30_000) });
      if (!upstream.ok || !upstream.body) throw new Error(`youtube ${upstream.status}`);
      for await (const chunk of upstream.body) {
        if (closed) break;
        if (!res.write(chunk)) await new Promise((resolve) => (res.once("drain", resolve), res.once("close", resolve)));
      }
    } catch {
      return res.destroy();
    }
  }
  res.end();
}

async function pipe(req, res, url, { audio, download = "", chunked = true }) {
  if (audio && chunked && /\.googlevideo\.com$/.test(new URL(url).hostname)) return pipeYoutube(req, res, url, download);
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
      if (kind === "sa") return json(res, 200, await cache.wrap(`sal:${id}`, () => soundcloud.album(id)));
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
