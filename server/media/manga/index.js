import { Readable } from "node:stream";
import { proxyMangadex } from "./mangadex.js";
import { isAllowedImage, proxyPill } from "./mangapill.js";
import { BROWSER_UA, publicFetch } from "../../lib/net.js";
import { createCache } from "../../lib/cache.js";
import { json, securityHeaders, text } from "../../lib/http.js";

const results = createCache({ max: 800, ttl: 5 * 60 * 1000 });

export async function handleManga(req, res, pathname, searchParams) {
  if (pathname === "/api/manga/img") return mangaImage(req, res, searchParams.get("u") || "");

  const rest = pathname.slice("/api/manga".length);
  const key = rest + "?" + searchParams.toString();
  let result;
  if (rest.startsWith("/mangadex")) {
    result = await results.wrap(key, () => proxyMangadex(rest, searchParams, publicFetch));
  } else if (rest.startsWith("/pill")) {
    result = await results.wrap(key, () => proxyPill(rest, searchParams, publicFetch, "/api/manga/img"));
  } else {
    return json(res, 404, { error: "unknown manga source" });
  }
  if (result.status !== 200) results.set(key, result, 15_000);
  return json(res, result.status, result.body, { "Cache-Control": result.status === 200 ? "public, max-age=120" : "no-store" });
}

async function mangaImage(req, res, raw) {
  const url = isAllowedImage(raw);
  if (!url) return text(res, 400, "bad image");
  try {
    const upstream = await publicFetch(url, {
      headers: {
        "user-agent": BROWSER_UA,
        referer: url.hostname.includes("mangadex") ? "https://mangadex.org/" : "https://mangapill.com/",
      },
      signal: AbortSignal.timeout(15_000),
    });
    const type = upstream.headers.get("content-type") || "";
    if (!upstream.ok || !type.startsWith("image/")) return text(res, 502, "image upstream error");
    res.writeHead(200, securityHeaders({ "Content-Type": type, "Cache-Control": "public, max-age=86400" }));
    Readable.fromWeb(upstream.body).on("error", () => res.destroy()).pipe(res);
  } catch {
    text(res, 502, "image upstream error");
  }
}
