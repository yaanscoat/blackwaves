/*
 * Chrome Web Store helpers for the extensions page.
 *
 *   GET /api/cws/search?q=dark+reader   top results scraped from the store's search page
 *   GET /api/cws/crx/<id>               the extension's .crx, fetched from Google's update service
 *
 * The store has no public search API; its search page embeds results as JSON in an
 * AF_initDataCallback block, where each item is an array starting with the 32-letter id.
 */
import express from "express";

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";
const CHROME_VERSION = "131.0.6778.86";
const ID_RE = /^[a-p]{32}$/;
const MAX_CRX = 40 * 1024 * 1024;

function extractItems(html) {
  const items = [];
  const seen = new Set();
  const re = /AF_initDataCallback\(\{key: '(ds:\d+)'[\s\S]*?data:([\s\S]*?), sideChannel: \{\}\}\);<\/script>/g;
  let m;
  while ((m = re.exec(html))) {
    let data;
    try {
      data = JSON.parse(m[2]);
    } catch {
      continue;
    }
    const walk = (v) => {
      if (!Array.isArray(v)) return;
      if (typeof v[0] === "string" && ID_RE.test(v[0]) && typeof v[2] === "string" && v.length > 6) {
        if (!seen.has(v[0])) {
          seen.add(v[0]);
          items.push({
            id: v[0],
            icon: typeof v[1] === "string" ? v[1] : "",
            name: v[2],
            rating: typeof v[3] === "number" ? Math.round(v[3] * 10) / 10 : null,
            ratingCount: typeof v[4] === "number" ? v[4] : 0,
            description: typeof v[6] === "string" ? v[6] : "",
            users: typeof v[14] === "number" ? v[14] : null,
          });
        }
        return;
      }
      v.forEach(walk);
    };
    walk(data);
  }
  return items;
}

export function createCwsRouter() {
  const router = express.Router();
  const searchCache = new Map();

  router.get("/search", async (req, res) => {
    const q = String(req.query.q || "").trim().slice(0, 100);
    if (!q) return res.json([]);
    const key = q.toLowerCase();
    const hit = searchCache.get(key);
    if (hit && Date.now() - hit.time < 10 * 60 * 1000) return res.json(hit.items);
    try {
      const r = await fetch(`https://chromewebstore.google.com/search/${encodeURIComponent(q)}?hl=en`, {
        headers: { "User-Agent": UA, "Accept-Language": "en-US,en;q=0.9" },
      });
      if (!r.ok) throw new Error(`Chrome Web Store returned ${r.status}`);
      const items = extractItems(await r.text());
      searchCache.set(key, { time: Date.now(), items });
      if (searchCache.size > 200) searchCache.delete(searchCache.keys().next().value);
      res.json(items);
    } catch (err) {
      res.status(502).json({ error: `Search failed: ${err.message}` });
    }
  });

  router.get("/crx/:id", async (req, res) => {
    const id = String(req.params.id).toLowerCase();
    if (!ID_RE.test(id)) return res.status(400).json({ error: "Invalid extension id." });
    const url = `https://clients2.google.com/service/update2/crx?response=redirect&prodversion=${CHROME_VERSION}&acceptformat=crx2,crx3&x=id%3D${id}%26uc`;
    try {
      const r = await fetch(url, { headers: { "User-Agent": UA }, redirect: "follow" });
      if (r.status === 204 || r.status === 404) return res.status(404).json({ error: "That extension isn't available for download." });
      if (!r.ok) throw new Error(`Google returned ${r.status}`);
      const buf = Buffer.from(await r.arrayBuffer());
      if (buf.length > MAX_CRX) return res.status(413).json({ error: "Extension is too large (40 MB max)." });
      if (buf.subarray(0, 4).toString() !== "Cr24") return res.status(502).json({ error: "Google didn't return a valid extension package." });
      res.set("Cache-Control", "private, max-age=3600");
      res.type("application/x-chrome-extension").send(buf);
    } catch (err) {
      res.status(502).json({ error: `Download failed: ${err.message}` });
    }
  });

  return router;
}
