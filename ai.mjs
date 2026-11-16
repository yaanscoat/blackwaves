/*
 * blackwaves AI: a server-side relay to OpenRouter.
 *
 * The API key lives only on the server (OPENROUTER_API_KEY in .env) and is never sent to
 * browsers. Clients call:
 *   GET  /api/ai/models   free models this key can use, plus the default
 *   POST /api/ai/chat     { model, messages } -> text/event-stream of { delta } / { model } / { error }
 */
import express from "express";

const API = "https://openrouter.ai/api/v1";
const DEFAULT_MODEL = "nvidia/nemotron-3-ultra-550b-a55b:free";
// Tried in order when the chosen model is rate-limited or down.
const FALLBACKS = [
  "nvidia/nemotron-3-ultra-550b-a55b:free",
  "google/gemma-4-31b-it:free",
  "nvidia/nemotron-3.5-super-vl:free",
  "baidu/ernie-5.5-flash-preview:free",
  "google/gemma-4-26b-a4b-it:free",
];
const BLOCKED_MODELS = /inkling|code/i; // agent-only / coding-only models
// Everything the model may say about blackwaves. Models invent product details (Docker images,
// docs sites, fake domains) when they only know a name, so give them the real facts and forbid guessing.
function systemPrompt(siteUrl) {
  return `You are blackwaves AI, a friendly, concise assistant built into blackwaves.

## Facts about blackwaves (the ONLY things you know about it)
- blackwaves is a web proxy website made by yaanscoat (GitHub: https://github.com/yaanscoat). It is based on Waves by xojw.
- The official blackwaves website is https://blackwaveson.top${siteUrl.replace(/^https?:\/\//, '') === 'blackwaveson.top' ? '' : ` (the user is currently using a copy at ${siteUrl})`}. These are the only blackwaves addresses you know.
- Official Discord: https://discord.gg/rH2bMPPNq
- Movies site: https://yaanscoat.github.io/blackwaves-movies/
- It runs on Node.js with Express. Self-hosting: get the code from yaanscoat's GitHub profile, run "npm i" then "npm start", and open http://localhost:3000. It needs a Node server; it cannot run on static hosting. You do NOT know the exact repository name or URL, so never write a git clone command or a repo link; point to https://github.com/yaanscoat instead.
- Proxy engines (Settings > Advanced): Scramjet (latest, the default), Scramjet 1.1.0, and Ultraviolet (marked unstable). Transports: Epoxy or Libcurl, over the Wisp protocol.
- Browsing happens in a tabbed browser with vertical tabs. "New tab" (or Alt+T) opens a small search bar.
- Games from five libraries: Selenite, Truffled, Seraph, UGS and CKV.
- Extensions: install from the Chrome Web Store (built-in search), .crx/.zip files, unpacked folders, or .user.js userscripts.
- Ad blocking: BlackWaves Shield (recommended) and/or uBlock Origin Lite. Users may use either, both, or neither.
- Cloaking: 40 tab disguises (Google Classroom, Docs, Canvas, etc.), about:blank and blob: launching, disguise-only-when-away, and a panic key.
- Appearance: 15 themes, motion levels (full, minimal, reduced, off), and seasonal effects (snow, autumn leaves, sakura, Christmas and more).
- Cloud Sync accounts sync settings, themes, history, open tabs, extensions and AI chats.
- Downloads made inside blackwaves save to the user's computer, and are listed in the Downloads panel.
- This AI uses free models through OpenRouter.

## Rules
- Never invent facts about blackwaves. If asked something not covered above (release dates, team members, pricing, docs sites, Docker images, other features), say you don't know and point to the Discord.
- Never make up URLs, domains, email addresses, usernames or links, for blackwaves or anything else. Only give a link if you are certain it is real.
- For any topic, if you are not sure, say so instead of guessing.
- Be concise. Use Markdown, and fenced code blocks for code.
- Today's date is ${new Date().toISOString().slice(0, 10)}.`;
}
const MAX_MESSAGES = 24;
const MAX_CHARS = 24000;

export function createAiRouter() {
  const router = express.Router();
  const key = process.env.OPENROUTER_API_KEY || "";
  let models = null;
  let modelsAt = 0;

  async function listModels() {
    if (models && Date.now() - modelsAt < 60 * 60 * 1000) return models;
    try {
      const r = await fetch(`${API}/models`);
      const j = await r.json();
      const free = j.data
        .filter((m) => m.id.endsWith(":free") && !BLOCKED_MODELS.test(m.id))
        .map((m) => ({ id: m.id, name: m.name.replace(/\s*\(free\)\s*$/i, ""), context: m.context_length }));
      // default first, then the fallback chain, then everything else by name
      const rank = (m) => (FALLBACKS.includes(m.id) ? FALLBACKS.indexOf(m.id) : FALLBACKS.length);
      free.sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name));
      models = free;
      modelsAt = Date.now();
    } catch {
      models = models || FALLBACKS.map((id) => ({ id, name: id }));
    }
    return models;
  }

  // Shared key, so keep any one visitor from burning the daily quota.
  const hits = new Map();
  function limited(req) {
    const ip = req.headers["x-forwarded-for"]?.split(",")[0].trim() || req.socket.remoteAddress;
    const now = Date.now();
    const list = (hits.get(ip) || []).filter((t) => now - t < 10 * 60 * 1000);
    list.push(now);
    hits.set(ip, list);
    return list.length > 20;
  }

  router.get("/models", async (req, res) => {
    res.json({ enabled: !!key, default: DEFAULT_MODEL, models: key ? await listModels() : [] });
  });

  router.post("/chat", express.json({ limit: "256kb" }), async (req, res) => {
    if (!key) return res.status(503).json({ error: "AI isn't configured on this server." });
    if (limited(req)) return res.status(429).json({ error: "You're sending messages too fast. Wait a few minutes and try again." });

    let messages = Array.isArray(req.body?.messages) ? req.body.messages : [];
    messages = messages
      .filter((m) => m && (m.role === "user" || m.role === "assistant") && typeof m.content === "string" && m.content.trim())
      .slice(-MAX_MESSAGES)
      .map((m) => ({ role: m.role, content: m.content }));
    while (messages.length > 1 && messages.reduce((n, m) => n + m.content.length, 0) > MAX_CHARS) messages.shift();
    if (!messages.length || messages[messages.length - 1].role !== "user") return res.status(400).json({ error: "Send a message first." });

    const available = await listModels();
    const requested = String(req.body?.model || DEFAULT_MODEL);
    // The address the user actually reached us at, so the model never guesses a domain.
    const host = /^[a-z0-9.-]+(:d+)?$/i.test(req.headers.host || "") ? req.headers.host : "localhost:3000";
    const proto = String(req.headers["x-forwarded-proto"] || (req.socket.encrypted ? "https" : "http")).split(",")[0].trim();
    const siteUrl = `${proto === "https" ? "https" : "http"}://${host}`;
    // "Generate another answer" asks for more variety; normal answers stay focused.
    const temperature = req.body?.regenerate ? 0.95 : 0.5;
    const order = [requested, ...FALLBACKS].filter((id, i, a) => a.indexOf(id) === i && available.some((m) => m.id === id));
    if (!order.length) order.push(DEFAULT_MODEL);

    res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-store", Connection: "keep-alive", "X-Accel-Buffering": "no" });
    const send = (obj) => res.write(`data: ${JSON.stringify(obj)}\n\n`);
    const abort = new AbortController();
    res.on("close", () => abort.abort());

    let lastError = "";
    for (const model of order) {
      let upstream;
      try {
        upstream = await fetch(`${API}/chat/completions`, {
          method: "POST",
          signal: abort.signal,
          headers: {
            Authorization: `Bearer ${key}`,
            "Content-Type": "application/json",
            "HTTP-Referer": "https://github.com/yaanscoat",
            "X-Title": "blackwaves",
          },
          body: JSON.stringify({ model, stream: true, temperature, messages: [{ role: "system", content: systemPrompt(siteUrl) }, ...messages] }),
        });
      } catch (err) {
        if (abort.signal.aborted) return res.end();
        lastError = err.message;
        continue;
      }
      if (!upstream.ok) {
        const body = await upstream.json().catch(() => ({}));
        lastError = body?.error?.message || `HTTP ${upstream.status}`;
        if (upstream.status === 429 && /limit/i.test(lastError) && !/provider/i.test(lastError)) {
          send({ error: "blackwaves AI hit its daily free limit. Try again tomorrow." });
          return res.end();
        }
        continue; // rate-limited or unavailable upstream: try the next model
      }

      send({ model });
      let gotText = false;
      let buffer = "";
      const decoder = new TextDecoder();
      try {
        for await (const chunk of upstream.body) {
          buffer += decoder.decode(chunk, { stream: true });
          let nl;
          while ((nl = buffer.indexOf("\n")) >= 0) {
            const line = buffer.slice(0, nl).trim();
            buffer = buffer.slice(nl + 1);
            if (!line.startsWith("data:")) continue;
            const data = line.slice(5).trim();
            if (data === "[DONE]") continue;
            try {
              const j = JSON.parse(data);
              if (j.error) {
                send({ error: j.error.message || "The model returned an error." });
                continue;
              }
              const d = j.choices?.[0]?.delta || {};
              if (d.reasoning) send({ thinking: true });
              if (d.content) {
                gotText = true;
                send({ delta: d.content });
              }
            } catch {}
          }
        }
      } catch {
        if (abort.signal.aborted) return res.end();
      }
      if (gotText) {
        send({ done: true });
        return res.end();
      }
      lastError = "The model returned an empty answer.";
    }
    send({ error: `All AI models are busy right now (${lastError}). Try again in a minute.` });
    res.end();
  });

  return router;
}
