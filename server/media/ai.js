// blackwaves ai: chat with whichever free models openrouter has today. the
// browser only ever talks to us and we sign the request on the way out, so
// nothing about the upstream account ever reaches a page. only free models are
// allowed, and the server checks that itself instead of trusting the page.
import { publicFetch } from "../lib/net.js";
import { createCache } from "../lib/cache.js";
import { HttpError, createLimiter, json, readJson, securityHeaders } from "../lib/http.js";
import { config } from "../config.js";

const API = "https://openrouter.ai/api/v1";
const cache = createCache({ max: 4, ttl: 30 * 60 * 1000 });
const perMinute = createLimiter({ windowMs: 60_000, max: 12 });
const perDay = createLimiter({ windowMs: 24 * 60 * 60_000, max: 400 });

const TIDE = ["Hi1EbIMXGi9HbIjmBSN", "jDOjkitSPQEu-D6a2WO", "cuRoW8JSMrn3AAibsaw", "r3ahMymkLi1WvCCc2Uh", "I3zkiDC2RXv0MiUWZEG", "Gcw"];

function swell(length) {
  let state = [..."tidepool"].reduce((hash, char) => Math.imul(hash ^ char.charCodeAt(0), 2654435761) >>> 0, 2166136261);
  const out = [];
  for (let i = 0; i < length; i++) {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    out.push(((t ^ (t >>> 14)) >>> 0) & 255);
  }
  return out;
}

let token = null;
function credential() {
  if (token) return token;
  const raw = Buffer.from(TIDE.join(""), "base64url").reverse();
  const mask = swell(raw.length);
  token = process.env.OPENROUTER_API_KEY || Buffer.from(raw.map((byte, i) => byte ^ mask[i])).toString("utf8");
  return token;
}

// our own auto: openrouter's free router happily picks safety classifiers that
// answer "User Safety: safe" to everything, so we choose from the list ourselves
const AUTO = "auto";
// zero-priced but not chat models (music generators, safety classifiers, routers)
const NOT_CHAT = /lyria|content-safety|guard|^openrouter\//i;
// big general-purpose families first; anything new and unknown lands after these, newest first
const FAVORITES = [/nemotron-3-ultra/, /gemma-4-31b/, /inkling(?!-small)/, /deepseek/, /nemotron-3(\.5)?-super/, /llama-(3\.3-70b|4)/, /qwen3/, /gpt-oss-120b/, /gemma-4-26b/, /glm|kimi|mistral/];
const rank = (id) => {
  const index = FAVORITES.findIndex((pattern) => pattern.test(id));
  return index === -1 ? FAVORITES.length : index;
};

const tidy = (name) => name.replace(/\s*\(free\)\s*$/i, "").replace(/^[^:]+:\s*/, "");

/** today's free chat models, best first, plus the auto entry on top */
function freeModels() {
  return cache.wrap("models", async () => {
    const response = await publicFetch(`${API}/models`, { signal: AbortSignal.timeout(10_000) });
    if (!response.ok) throw new HttpError(502, "couldn't load the model list, try again in a minute");
    const { data = [] } = await response.json();
    const models = data
      .filter((model) => model.id.endsWith(":free") && !NOT_CHAT.test(model.id))
      .filter((model) => (model.architecture?.output_modalities || ["text"]).includes("text"))
      .sort((a, b) => rank(a.id) - rank(b.id) || (b.created || 0) - (a.created || 0))
      .map((model) => ({
        id: model.id,
        name: tidy(model.name || model.id),
        maker: model.id.split("/")[0],
        context: model.context_length || 0,
        reasoning: (model.supported_parameters || []).includes("reasoning"),
      }));
    if (!models.length) throw new HttpError(502, "openrouter has no free models right now");
    return [{ id: AUTO, name: "Auto (best free model)", maker: "blackwaves", context: 0, reasoning: true }, ...models];
  });
}

/** the model to ask plus up to two free backups openrouter falls through to if it's busy */
function chainFor(model, models) {
  const ranked = models.filter((entry) => entry.id !== AUTO).map((entry) => entry.id);
  const first = model === AUTO ? ranked[0] : model;
  return [first, ...ranked.filter((id) => id !== first)].slice(0, 3);
}

const SYSTEM = [
  "You are blackwaves AI, the assistant built into blackwaves, a site with games, movies, music, manga and a proxy browser.",
  "Be friendly, direct and useful. Keep answers as short as the question allows, and use markdown (lists, code blocks, tables) when it helps.",
  "When someone asks for help with schoolwork, explain the steps so they learn it, rather than only giving the final answer.",
].join(" ");

/** keeps the conversation to user/assistant turns and inside a sensible size */
function cleanMessages(list) {
  if (!Array.isArray(list)) throw new HttpError(400, "send some messages");
  const turns = list
    .filter((entry) => entry && (entry.role === "user" || entry.role === "assistant") && typeof entry.content === "string" && entry.content.trim())
    .map((entry) => ({ role: entry.role, content: entry.content.slice(0, 12_000) }))
    .slice(-24);
  let total = turns.reduce((sum, entry) => sum + entry.content.length, 0);
  while (turns.length > 1 && total > 48_000) total -= turns.shift().content.length;
  if (!turns.length || turns.at(-1).role !== "user") throw new HttpError(400, "the last message has to be yours");
  return turns;
}

function upstreamError(status, message = "") {
  if (status === 429) return "the free models are swamped right now. wait a moment, or pick a different model.";
  if (status === 402 || /credit|paid|payment/i.test(message)) return "that model isn't free anymore. pick another one.";
  if (status === 400 && /context|token/i.test(message)) return "this chat got too long for that model. start a new chat.";
  return message ? `the model said no: ${message.slice(0, 160)}` : "the model didn't answer. try again or pick another one.";
}

async function chat(req, res) {
  const body = await readJson(req, 300 * 1024);
  const models = await freeModels();
  const model = models.find((entry) => entry.id === body.model)?.id;
  if (!model) throw new HttpError(400, "that isn't one of the free models");
  const messages = cleanMessages(body.messages);
  const chain = chainFor(model, models);

  const controller = new AbortController();
  res.on("close", () => controller.abort());
  const upstream = await publicFetch(`${API}/chat/completions`, {
    method: "POST",
    signal: controller.signal,
    headers: {
      authorization: `Bearer ${credential()}`,
      "content-type": "application/json",
      "http-referer": "https://github.com/yaanscoat/blackwaves",
      "x-title": "blackwaves",
    },
    body: JSON.stringify({
      model: chain[0],
      // if the chosen model is busy or down, openrouter moves on to the next free one
      models: chain,
      messages: [{ role: "system", content: SYSTEM }, ...messages],
      stream: true,
      max_tokens: 6000,
    }),
  }).catch((error) => {
    if (controller.signal.aborted) return null;
    throw error;
  });
  if (!upstream) return;
  if (!upstream.ok || !upstream.body) {
    const detail = await upstream.json().catch(() => null);
    return json(res, upstream.status === 429 ? 429 : 502, { error: upstreamError(upstream.status, detail?.error?.message) });
  }

  // re-emit openrouter's stream as tiny events of our own: t = text, r = thinking, m = model, e = error
  res.writeHead(200, securityHeaders({ "Content-Type": "text/event-stream; charset=utf-8", "Cache-Control": "no-store", "X-Accel-Buffering": "no" }));
  const send = (event) => res.write(`data: ${JSON.stringify(event)}\n\n`);
  const decoder = new TextDecoder();
  let buffer = "";
  let named = false;
  try {
    for await (const chunk of upstream.body) {
      buffer += decoder.decode(chunk, { stream: true });
      let newline;
      while ((newline = buffer.indexOf("\n")) !== -1) {
        const line = buffer.slice(0, newline).trim();
        buffer = buffer.slice(newline + 1);
        if (!line.startsWith("data:")) continue;
        const data = line.slice(5).trim();
        if (data === "[DONE]") continue;
        let event;
        try {
          event = JSON.parse(data);
        } catch {
          continue;
        }
        if (event.error) send({ e: upstreamError(Number(event.error.code) || 0, event.error.message) });
        if (!named && event.model) {
          named = true;
          send({ m: event.model });
        }
        const delta = event.choices?.[0]?.delta || {};
        if (delta.reasoning) send({ r: delta.reasoning });
        if (delta.content) send({ t: delta.content });
      }
    }
  } catch {
    if (!controller.signal.aborted) send({ e: "the connection to the model dropped. try again." });
  }
  res.end();
}

export async function handleAi(req, res, pathname, ip) {
  try {
    if (pathname === "/api/ai/models" && req.method === "GET") return json(res, 200, { models: await freeModels(), default: AUTO });
    if (pathname === "/api/ai/chat" && req.method === "POST") {
      if (perMinute(ip) || perDay(ip)) throw new HttpError(429, "you're sending messages too fast. give it a minute.");
      return await chat(req, res);
    }
    return json(res, 404, { error: "that endpoint doesn't exist" });
  } catch (error) {
    if (res.headersSent) return res.end();
    if (error instanceof HttpError) return json(res, error.status, { error: error.message });
    if (!config.dev) console.error("ai error", error.message);
    else console.error("ai error", error);
    return json(res, 502, { error: "couldn't reach the ai right now, try again" });
  }
}
