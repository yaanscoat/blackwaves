import express from "express";

// App tiles and cloak presets need real favicons, but the page is
// cross-origin isolated and Google's favicon service sends no CORP header.
// Relaying them makes them same-origin.
const maxEntries = 400;
const cache = new Map();
const domainPattern = /^(?=.{3,253}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/i;

const load = async (domain) => {
    const response = await fetch(`https://www.google.com/s2/favicons?domain=${encodeURIComponent(domain)}&sz=128`);
    // Unknown domains come back as a 404 that still carries Google's default
    // globe icon, which beats a broken image.
    const type = response.headers.get("content-type") ?? "";
    if (!response.ok && !(response.status === 404 && type.startsWith("image/")))
        throw new Error(`favicon ${response.status}`);
    return {
        type: response.headers.get("content-type") ?? "image/png",
        body: Buffer.from(await response.arrayBuffer())
    };
};

export const iconsRouter = () => {
    const router = express.Router();
    router.get("/api/icon/:domain", async (req, res) => {
        const domain = req.params.domain.toLowerCase();
        if (!domainPattern.test(domain)) {
            res.status(400).end();
            return;
        }
        let entry = cache.get(domain);
        if (!entry) {
            entry = load(domain);
            cache.set(domain, entry);
            if (cache.size > maxEntries)
                cache.delete(cache.keys().next().value);
        }
        try {
            const { type, body } = await entry;
            res.setHeader("Content-Type", type);
            res.setHeader("Cache-Control", "public, max-age=604800");
            res.send(body);
        }
        catch {
            cache.delete(domain);
            res.status(502).end();
        }
    });
    return router;
};
