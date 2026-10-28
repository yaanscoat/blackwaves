// cloud gaming, based on x8rr/stratus-api (https://github.com/x8rr/stratus-api).
// the catalog is real, the servers are not: stratus needs a pool of raccoongame
// accounts, a disposable mail service and webrtc signalling we don't run.
// so this is a very pretty menu for a restaurant that's closed. sorry.
import fs from "node:fs";
import { Readable } from "node:stream";
import { publicFetch } from "../lib/net.js";
import { json, securityHeaders, text } from "../lib/http.js";

const games = JSON.parse(fs.readFileSync(new URL("./cloud-games.json", import.meta.url), "utf8")).map((game) => ({
  ...game,
  image: game.image ? `/api/cloud/img?u=${encodeURIComponent(game.image)}` : "",
  cover: game.cover ? `/api/cloud/img?u=${encodeURIComponent(game.cover)}` : "",
}));

export async function handleCloud(req, res, pathname, searchParams) {
  if (pathname === "/api/cloud/games") return json(res, 200, { online: false, games }, { "Cache-Control": "public, max-age=3600" });
  if (pathname === "/api/cloud/start") {
    return json(res, 503, { error: "cloud gaming servers are offline right now", online: false });
  }
  if (pathname === "/api/cloud/img") {
    const raw = searchParams.get("u") || "";
    let url;
    try {
      url = new URL(raw);
    } catch {
      return text(res, 400, "bad image");
    }
    if (url.hostname !== "download-oss.raccoongame.com") return text(res, 400, "bad image");
    try {
      const upstream = await publicFetch(url, { signal: AbortSignal.timeout(12_000) });
      if (!upstream.ok) return text(res, 502, "image error");
      res.writeHead(200, securityHeaders({ "Content-Type": upstream.headers.get("content-type") || "image/jpeg", "Cache-Control": "public, max-age=604800" }));
      return Readable.fromWeb(upstream.body).on("error", () => res.destroy()).pipe(res);
    } catch {
      return text(res, 502, "image error");
    }
  }
  return json(res, 404, { error: "not found" });
}
