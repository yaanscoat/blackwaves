import { Readable } from "node:stream";
import express from "express";

// Every game source blackwaves can pull from. gmshelf repos are served from
// jsDelivr with raw GitHub as a fallback (jsDelivr refuses files over 20MB);
// gn-math is blocked on jsDelivr, so it goes straight to raw GitHub.
const gmshelf = (id, label, listCovers = false) => ({
    id,
    label,
    catalog: `https://cdn.jsdelivr.net/gh/gmshelf/${id}@main/${id}.json`,
    upstreams: [
        `https://cdn.jsdelivr.net/gh/gmshelf/${id}@main/`,
        `https://raw.githubusercontent.com/gmshelf/${id}/main/`
    ],
    coverBase: `https://cdn.jsdelivr.net/gh/gmshelf/${id}@main`,
    coverListing: listCovers && `https://api.github.com/repos/gmshelf/${id}/contents/covers`
});

export const sources = {
    "gn-math": {
        id: "gn-math",
        label: "gn-math",
        catalog: "https://raw.githubusercontent.com/gn-math/assets/main/zones.json",
        upstreams: ["https://raw.githubusercontent.com/gn-math/html/main/"],
        coverBase: "https://raw.githubusercontent.com/gn-math/covers/main"
    },
    seraph: gmshelf("seraph", "Seraph", true),
    truffled: gmshelf("truffled", "Truffled", true),
    ckv: gmshelf("ckv", "CKV"),
    ugs: gmshelf("ugs", "UGS")
};

const catalogTtlMs = 60 * 60 * 1000;
const catalogCache = new Map();

const fetchJson = async (url) => {
    const headers = { "user-agent": "blackwaves" };
    if (process.env.GITHUB_TOKEN && url.startsWith("https://api.github.com/"))
        headers.authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
    const response = await fetch(url, { headers });
    if (!response.ok)
        throw new Error(`${url} answered ${response.status}`);
    return response.json();
};

const encodePath = (path) => path.split("/").map(encodeURIComponent).join("/");

const stemOf = (name) => name.replace(/\.[^./]+$/, "");

const prettify = (name) => {
    const s = String(name ?? "").trim();
    return s ? s[0].toUpperCase() + s.slice(1) : "Untitled";
};

// Seraph and Truffled ship a covers/ folder but list a placeholder in their
// catalog. Covers are named after the game folder or the html file. The repos
// are too big for jsDelivr's listing API, so this asks GitHub (set
// GITHUB_TOKEN to lift the 60 requests/hour anonymous limit).
const loadCoverStems = async (source) => {
    if (!source.coverListing)
        return new Map();
    try {
        const listing = await fetchJson(source.coverListing);
        const stems = new Map();
        for (const file of Array.isArray(listing) ? listing : []) {
            if (file.type === "file" && typeof file.name === "string")
                stems.set(stemOf(file.name).toLowerCase(), `${source.coverBase}/covers/${encodeURIComponent(file.name)}`);
        }
        return stems;
    }
    catch {
        return new Map();
    }
};

const normalize = async (source) => {
    const raw = await fetchJson(source.catalog);
    const list = Array.isArray(raw) ? raw : raw.games ?? [];
    if (source.id === "gn-math") {
        return list
            // Skip the discord / comments / request entries mixed into the list.
            .filter(game => typeof game.url === "string" && game.url.startsWith("{HTML_URL}/") && !/^\[!\]/.test(String(game.name)))
            .map(game => ({
                n: prettify(game.name),
                u: `/gs/gn-math/${encodePath(game.url.slice("{HTML_URL}/".length))}`,
                i: typeof game.cover === "string"
                    ? game.cover.replace("{COVER_URL}", source.coverBase)
                    : null,
                s: source.id
            }));
    }
    const stems = await loadCoverStems(source);
    return list
        .filter(game => typeof game.url === "string" && game.url.startsWith("/"))
        .map(game => {
            const parts = game.url.split("/").filter(Boolean);
            let cover = null;
            if (typeof game.img === "string" && game.img.startsWith("/covers/"))
                cover = source.coverBase + encodePath(game.img);
            else {
                const folder = (parts.length > 2 ? parts[1] : "").toLowerCase();
                const base = stemOf(parts.at(-1) ?? "").toLowerCase();
                cover = stems.get(folder) ?? stems.get(base) ?? null;
            }
            return {
                n: prettify(game.name),
                u: `/gs/${source.id}/${encodePath(parts.join("/"))}`,
                i: cover,
                s: source.id
            };
        });
};

const catalog = async (id) => {
    const cached = catalogCache.get(id);
    if (cached && Date.now() - cached.at < catalogTtlMs)
        return cached.games;
    const pending = cached?.pending ?? normalize(sources[id]);
    catalogCache.set(id, { ...cached, pending });
    try {
        const games = await pending;
        catalogCache.set(id, { at: Date.now(), games });
        return games;
    }
    catch (error) {
        // Serve stale data rather than nothing if the upstream hiccups.
        if (cached?.games) {
            catalogCache.set(id, { at: Date.now() - catalogTtlMs / 2, games: cached.games });
            return cached.games;
        }
        catalogCache.delete(id);
        throw error;
    }
};

const mime = {
    html: "text/html; charset=utf-8",
    htm: "text/html; charset=utf-8",
    js: "text/javascript; charset=utf-8",
    mjs: "text/javascript; charset=utf-8",
    cjs: "text/javascript; charset=utf-8",
    css: "text/css; charset=utf-8",
    json: "application/json; charset=utf-8",
    webmanifest: "application/manifest+json",
    txt: "text/plain; charset=utf-8",
    xml: "application/xml",
    wasm: "application/wasm",
    png: "image/png",
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    gif: "image/gif",
    webp: "image/webp",
    avif: "image/avif",
    svg: "image/svg+xml",
    ico: "image/x-icon",
    bmp: "image/bmp",
    mp3: "audio/mpeg",
    ogg: "audio/ogg",
    oga: "audio/ogg",
    wav: "audio/wav",
    m4a: "audio/mp4",
    mp4: "video/mp4",
    webm: "video/webm",
    ttf: "font/ttf",
    otf: "font/otf",
    woff: "font/woff",
    woff2: "font/woff2",
    swf: "application/x-shockwave-flash"
};

const contentTypeFor = (path) => {
    const ext = /\.([a-z0-9]+)$/i.exec(path)?.[1]?.toLowerCase() ?? "";
    return mime[ext] ?? "application/octet-stream";
};

// Safari has no COEP: credentialless and would treat it as unsafe-none,
// which a require-corp parent refuses to embed.
const embedderPolicyFor = (userAgent = "") => /Safari\//.test(userAgent) && !/Chrome\/|Chromium\/|Firefox\//.test(userAgent)
    ? "require-corp"
    : "credentialless";

const relay = async (req, res) => {
    const source = sources[req.params.source];
    const path = req.params[0] ?? "";
    if (!source || !path || path.split("/").some(part => part === ".." || part === ".")) {
        res.status(404).end();
        return;
    }
    const forwarded = {};
    if (req.headers.range)
        forwarded.range = req.headers.range;
    let upstream = null;
    for (const base of source.upstreams) {
        try {
            const response = await fetch(base + encodePath(path), { headers: forwarded });
            if (response.ok || response.status === 206) {
                upstream = response;
                break;
            }
            await response.body?.cancel();
        }
        catch { }
    }
    if (!upstream) {
        res.status(404).type("text/plain").send("Game file not found upstream.");
        return;
    }
    res.status(upstream.status);
    res.setHeader("Content-Type", contentTypeFor(path));
    res.setHeader("Cache-Control", "public, max-age=86400");
    res.setHeader("Cross-Origin-Embedder-Policy", embedderPolicyFor(req.headers["user-agent"]));
    res.setHeader("Cross-Origin-Resource-Policy", "same-origin");
    for (const name of ["content-range", "accept-ranges", "etag", "last-modified"]) {
        const value = upstream.headers.get(name);
        if (value)
            res.setHeader(name, value);
    }
    if (!upstream.body) {
        res.end();
        return;
    }
    const body = Readable.fromWeb(upstream.body);
    body.on("error", () => res.destroy());
    req.on("close", () => body.destroy());
    body.pipe(res);
};

export const gamesRouter = () => {
    const router = express.Router();
    router.get("/api/games/:source", async (req, res) => {
        const id = req.params.source;
        const ids = id === "all" ? Object.keys(sources) : [id];
        if (!ids.every(key => sources[key])) {
            res.status(404).json({ error: "Unknown source" });
            return;
        }
        const results = await Promise.allSettled(ids.map(catalog));
        const games = results.flatMap(result => result.status === "fulfilled" ? result.value : []);
        const failed = ids.filter((_, index) => results[index].status === "rejected");
        if (!games.length && failed.length) {
            res.status(502).json({ error: "Could not reach the game sources", failed });
            return;
        }
        res.setHeader("Cache-Control", "public, max-age=600");
        res.json({ games, failed });
    });
    router.get("/gs/:source/*", relay);
    return router;
};
