import express from "express";
import { createServer } from "http";
import path from "path";
import { fileURLToPath } from "url";
import compression from "compression";
import { WebSocketServer } from "ws";
import { baremuxPath } from "@mercuryworkshop/bare-mux/node";
import { epoxyPath } from "@mercuryworkshop/epoxy-transport";
import { libcurlPath } from "@mercuryworkshop/libcurl-transport";
import { uvPath } from "@titaniumnetwork-dev/ultraviolet";
import { server as wisp, logging as wispLogging } from "@mercuryworkshop/wisp-js/server";
import { createSyncRouter } from "./sync.mjs";
import { createCwsRouter } from "./cws.mjs";
import { createAiRouter } from "./ai.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// Server-only secrets (e.g. SYNC_SECRET) live in .env, which is never served.
try {
  process.loadEnvFile(path.join(__dirname, ".env"));
} catch {}
const publicPath = path.join(__dirname, "public");
const pkgDir = (name) => path.join(__dirname, "node_modules", name);
wispLogging.set_level(wispLogging.WARN);
const scramjetLatestPath = path.join(pkgDir("@mercuryworkshop/scramjet"), "dist");
const scramjetLegacyPath = path.join(pkgDir("scramjet-v1"), "dist");
const controllerPath = path.join(pkgDir("@mercuryworkshop/scramjet-controller"), "dist");
const epoxyV3Path = path.join(pkgDir("epoxy-transport-v3"), "dist");
const libcurlV2Path = path.join(pkgDir("libcurl-transport-v2"), "dist");

const VERSION = "1.0.0";
const app = express();

app.disable("x-powered-by");
app.use(compression({ level: 6, threshold: 1024 }));

// Bare-mux transports (Ultraviolet + Scramjet 1.1.0)
app.use("/baremux/", express.static(baremuxPath));
app.use("/epoxy/", express.static(epoxyPath));
app.use("/libcurl/", express.static(libcurlPath));
// proxy-transports (Scramjet latest)
app.use("/epoxy3/", express.static(epoxyV3Path));
app.use("/libcurl2/", express.static(libcurlV2Path));
// public/data holds the cloud sync accounts. It sits in the web root but is never served.
// Decode and normalize first so /%64ata, /assets/../data or (on Windows) /DATA./ can't slip past.
const dataDir = process.env.DATA_DIR || path.join(publicPath, "data");
app.use((req, res, next) => {
  let p;
  try {
    p = decodeURIComponent(req.path);
  } catch {
    return res.status(400).end();
  }
  const first = path.posix.normalize(p.replace(/\\/g, "/")).split("/").find(Boolean) || "";
  if (/^data(?:[\s.:]|$)/i.test(first)) return res.status(404).end();
  next();
});
// Proxy engines
app.use(express.static(publicPath));
app.use("/uv/", express.static(uvPath));
app.use("/scram/", express.static(scramjetLegacyPath));
app.use("/scramjet/", express.static(scramjetLatestPath));
app.use("/controller/", express.static(controllerPath));
// Developer tools: Chromium's DevTools frontend (via chii) plus the in-page protocol backend (chobitsu)
app.use("/devtools/front_end/", express.static(path.join(pkgDir("chii"), "public", "front_end"), { maxAge: "7d" }));
app.get("/devtools/chobitsu.js", (req, res) => res.sendFile(path.join(pkgDir("chobitsu"), "dist", "chobitsu.js"), { maxAge: "7d" }));

// Chrome Web Store search + .crx download for the extensions page
app.use("/api/cws", createCwsRouter());
// Built-in AI (OpenRouter relay; the key never leaves the server)
app.use("/api/ai", createAiRouter());
// Cloud sync (accounts + encrypted snapshots in public/data, or $DATA_DIR)
app.use("/api/sync", createSyncRouter(dataDir, { envFile: path.join(__dirname, ".env") }));

/* ------------------------------------------------------------------ */
/* Server info: location + active clients                              */
/* ------------------------------------------------------------------ */

let serverLocation = process.env.SERVER_LOCATION || null;
const startedAt = Date.now();

// Shown short, like "nsw, aus": the state code and the ISO 3166 alpha-3 country code.
const ALPHA3 = Object.fromEntries(
  ("AD:AND AE:ARE AF:AFG AG:ATG AI:AIA AL:ALB AM:ARM AO:AGO AQ:ATA AR:ARG AS:ASM AT:AUT AU:AUS AW:ABW AX:ALA AZ:AZE " +
    "BA:BIH BB:BRB BD:BGD BE:BEL BF:BFA BG:BGR BH:BHR BI:BDI BJ:BEN BL:BLM BM:BMU BN:BRN BO:BOL BQ:BES BR:BRA BS:BHS " +
    "BT:BTN BV:BVT BW:BWA BY:BLR BZ:BLZ CA:CAN CC:CCK CD:COD CF:CAF CG:COG CH:CHE CI:CIV CK:COK CL:CHL CM:CMR CN:CHN " +
    "CO:COL CR:CRI CU:CUB CV:CPV CW:CUW CX:CXR CY:CYP CZ:CZE DE:DEU DJ:DJI DK:DNK DM:DMA DO:DOM DZ:DZA EC:ECU EE:EST " +
    "EG:EGY EH:ESH ER:ERI ES:ESP ET:ETH FI:FIN FJ:FJI FK:FLK FM:FSM FO:FRO FR:FRA GA:GAB GB:GBR GD:GRD GE:GEO GF:GUF " +
    "GG:GGY GH:GHA GI:GIB GL:GRL GM:GMB GN:GIN GP:GLP GQ:GNQ GR:GRC GS:SGS GT:GTM GU:GUM GW:GNB GY:GUY HK:HKG HM:HMD " +
    "HN:HND HR:HRV HT:HTI HU:HUN ID:IDN IE:IRL IL:ISR IM:IMN IN:IND IO:IOT IQ:IRQ IR:IRN IS:ISL IT:ITA JE:JEY JM:JAM " +
    "JO:JOR JP:JPN KE:KEN KG:KGZ KH:KHM KI:KIR KM:COM KN:KNA KP:PRK KR:KOR KW:KWT KY:CYM KZ:KAZ LA:LAO LB:LBN LC:LCA " +
    "LI:LIE LK:LKA LR:LBR LS:LSO LT:LTU LU:LUX LV:LVA LY:LBY MA:MAR MC:MCO MD:MDA ME:MNE MF:MAF MG:MDG MH:MHL MK:MKD " +
    "ML:MLI MM:MMR MN:MNG MO:MAC MP:MNP MQ:MTQ MR:MRT MS:MSR MT:MLT MU:MUS MV:MDV MW:MWI MX:MEX MY:MYS MZ:MOZ NA:NAM " +
    "NC:NCL NE:NER NF:NFK NG:NGA NI:NIC NL:NLD NO:NOR NP:NPL NR:NRU NU:NIU NZ:NZL OM:OMN PA:PAN PE:PER PF:PYF PG:PNG " +
    "PH:PHL PK:PAK PL:POL PM:SPM PN:PCN PR:PRI PS:PSE PT:PRT PW:PLW PY:PRY QA:QAT RE:REU RO:ROU RS:SRB RU:RUS RW:RWA " +
    "SA:SAU SB:SLB SC:SYC SD:SDN SE:SWE SG:SGP SH:SHN SI:SVN SJ:SJM SK:SVK SL:SLE SM:SMR SN:SEN SO:SOM SR:SUR SS:SSD " +
    "ST:STP SV:SLV SX:SXM SY:SYR SZ:SWZ TC:TCA TD:TCD TF:ATF TG:TGO TH:THA TJ:TJK TK:TKL TL:TLS TM:TKM TN:TUN TO:TON " +
    "TR:TUR TT:TTO TV:TUV TW:TWN TZ:TZA UA:UKR UG:UGA UM:UMI US:USA UY:URY UZ:UZB VA:VAT VC:VCT VE:VEN VG:VGB VI:VIR " +
    "VN:VNM VU:VUT WF:WLF WS:WSM XK:XKX YE:YEM YT:MYT ZA:ZAF ZM:ZMB ZW:ZWE")
    .split(" ")
    .map((pair) => pair.split(":"))
);

function shortLocation(regionCode, regionName, countryCode) {
  // some countries use numeric region codes (Tokyo is "13"), so fall back to the name there
  const region = regionCode && !/^\d+$/.test(regionCode) ? regionCode : regionName;
  const country = ALPHA3[String(countryCode || "").toUpperCase()] || countryCode;
  return [region, country].filter(Boolean).join(", ").toLowerCase();
}

async function resolveLocation() {
  if (serverLocation) return;
  const providers = [
    async () => {
      const r = await fetch("http://ip-api.com/json/?fields=status,countryCode,region,regionName");
      const j = await r.json();
      if (j.status !== "success") throw new Error("ip-api failed");
      return shortLocation(j.region, j.regionName, j.countryCode);
    },
    async () => {
      const r = await fetch("https://ipwho.is/");
      const j = await r.json();
      if (!j.success) throw new Error("ipwho failed");
      return shortLocation(j.region_code, j.region, j.country_code);
    },
  ];
  for (const provider of providers) {
    try {
      const location = await provider();
      if (location) {
        serverLocation = location;
        return;
      }
    } catch {}
  }
  serverLocation = "unknown";
}

app.get("/api/info", (req, res) => {
  res.set("Cache-Control", "no-store");
  res.json({
    name: "blackwaves",
    version: VERSION,
    location: serverLocation || "locating...",
    clients: clientSockets.size,
    uptime: Math.floor((Date.now() - startedAt) / 1000),
  });
});

/* ------------------------------------------------------------------ */
/* Game sources                                                        */
/* ------------------------------------------------------------------ */

const GMS_RAW = "https://raw.githubusercontent.com/gmshelf";
const PLACEHOLDER = "/assets/images/placeholder.svg";

const GAME_SOURCES = {
  selenite: {
    label: "Selenite",
    url: "https://selenite.cc/resources/games.json",
    normalize: (data) =>
      data.map((g) => ({
        name: g.name,
        url: `https://selenite.cc/resources/semag/${g.directory}/index.html`,
        img: g.image ? `https://selenite.cc/resources/semag/${g.directory}/${g.image}` : PLACEHOLDER,
        tags: g.tags || [],
        proxied: true,
      })),
  },
  truffled: {
    label: "Truffled",
    url: "https://truffled.lol/js/json/g.json",
    normalize: (data) =>
      (data.games || data).map((g) => ({
        name: g.name,
        url: new URL(g.url, "https://truffled.lol/").href,
        img: g.thumbnail ? new URL(g.thumbnail, "https://truffled.lol/").href : PLACEHOLDER,
        tags: g.frameType ? [g.frameType] : [],
        proxied: true,
      })),
  },
  seraph: {
    label: "Seraph",
    url: `${GMS_RAW}/seraph/main/seraph.json`,
    normalize: async (data) => {
      const covers = await getSeraphCovers();
      return data.map((g) => {
        const dir = (g.url.match(/^\/seraph\/([^/]+)\//) || [])[1];
        const key = (dir || "").toLowerCase();
        const alt = g.name.toLowerCase().replace(/[^a-z0-9]/g, "");
        const cover = covers.get(key) || covers.get(alt);
        return {
          name: g.name,
          url: `/gms/seraph${g.url}`,
          img: cover ? `/gms/seraph/covers/${cover}` : PLACEHOLDER,
          tags: [],
          proxied: false,
        };
      });
    },
  },
  ugs: {
    label: "UGS",
    url: `${GMS_RAW}/ugs/main/ugs.json`,
    normalize: (data) =>
      data.map((g) => ({ name: g.name, url: `/gms/ugs${g.url}`, img: PLACEHOLDER, tags: [], proxied: false })),
  },
  ckv: {
    label: "CKV",
    url: `${GMS_RAW}/ckv/main/ckv.json`,
    normalize: (data) =>
      (data.games || data).map((g) => ({
        name: prettifyName(g.name),
        url: `/gms/ckv${g.url}`,
        img: g.img ? `/gms/ckv${g.img}` : PLACEHOLDER,
        tags: [],
        proxied: false,
      })),
  },
};

function prettifyName(name) {
  if (/[A-Z ]/.test(name)) return name;
  return name.replace(/(\d+)/g, " $1 ").replace(/\s+/g, " ").trim().replace(/^./, (c) => c.toUpperCase());
}

let seraphCovers = null;
async function getSeraphCovers() {
  if (seraphCovers) return seraphCovers;
  const map = new Map();
  try {
    const r = await fetch("https://api.github.com/repos/gmshelf/seraph/contents/covers", {
      headers: { "User-Agent": "blackwaves", Accept: "application/vnd.github+json" },
    });
    const list = await r.json();
    if (Array.isArray(list)) {
      for (const f of list) map.set(f.name.replace(/\.[^.]+$/, "").toLowerCase(), f.name);
      seraphCovers = map;
    }
  } catch {}
  return map;
}

const gameCache = new Map();
const GAME_TTL = 60 * 60 * 1000;

app.get("/api/games", (req, res) => {
  res.json(Object.entries(GAME_SOURCES).map(([id, s]) => ({ id, label: s.label })));
});

app.get("/api/games/:source", async (req, res) => {
  const source = GAME_SOURCES[req.params.source];
  if (!source) return res.status(404).json({ error: "Unknown game source" });
  const cached = gameCache.get(req.params.source);
  if (cached && Date.now() - cached.time < GAME_TTL) return res.json(cached.games);
  try {
    const r = await fetch(source.url, { headers: { "User-Agent": "blackwaves" } });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const games = (await source.normalize(await r.json()))
      .filter((g) => g.name && g.url)
      .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));
    gameCache.set(req.params.source, { time: Date.now(), games });
    res.json(games);
  } catch (err) {
    if (cached) return res.json(cached.games);
    res.status(502).json({ error: `Failed to load ${source.label}: ${err.message}` });
  }
});

/* gmshelf repos have no GitHub Pages, so relay their files with real MIME types. */
const relayCache = new Map();
let relayCacheBytes = 0;
const RELAY_CACHE_LIMIT = 256 * 1024 * 1024;
const RELAY_ITEM_LIMIT = 16 * 1024 * 1024;

app.get(/^\/gms\/(seraph|ugs|ckv)\/(.+)$/, async (req, res) => {
  const repo = req.params[0];
  const file = req.params[1].split("/").map(encodeURIComponent).join("/");
  const key = `${repo}/${file}`;
  const type = express.static.mime.lookup(file) || "application/octet-stream";
  res.set("Cache-Control", "public, max-age=86400");
  const hit = relayCache.get(key);
  if (hit) {
    relayCache.delete(key);
    relayCache.set(key, hit);
    return res.type(type).send(hit);
  }
  try {
    const r = await fetch(`${GMS_RAW}/${repo}/main/${file}`);
    if (!r.ok) return res.status(r.status).type("text/plain").send(`Not found (${r.status})`);
    const buf = Buffer.from(await r.arrayBuffer());
    if (buf.length <= RELAY_ITEM_LIMIT) {
      relayCache.set(key, buf);
      relayCacheBytes += buf.length;
      for (const [k, v] of relayCache) {
        if (relayCacheBytes <= RELAY_CACHE_LIMIT) break;
        relayCache.delete(k);
        relayCacheBytes -= v.length;
      }
    }
    res.type(type).send(buf);
  } catch (err) {
    res.status(502).type("text/plain").send(`Relay failed: ${err.message}`);
  }
});

app.get("/", (req, res) => {
  res.sendFile(path.join(publicPath, "index.html"));
});
app.use((req, res) => {
  res.status(404).sendFile(path.join(publicPath, "404.html"));
});

/* ------------------------------------------------------------------ */
/* WebSockets: ping + live client count, wisp                          */
/* ------------------------------------------------------------------ */

const port = parseInt(process.env.PORT || "8000");
const server = createServer(app);
const pingWSS = new WebSocketServer({ noServer: true });
const clientSockets = new Set();

function broadcastClients() {
  const msg = JSON.stringify({ type: "clients", count: clientSockets.size });
  for (const ws of clientSockets) {
    if (ws.readyState === ws.OPEN) ws.send(msg);
  }
}

pingWSS.on("connection", (ws) => {
  clientSockets.add(ws);
  broadcastClients();
  ws.send(JSON.stringify({ type: "location", location: serverLocation || "locating..." }));
  const pingInterval = setInterval(() => {
    ws.send(JSON.stringify({ type: "ping", timestamp: Date.now() }));
  }, 5000);
  ws.on("message", (message) => {
    try {
      const data = JSON.parse(message);
      if (data.type === "pong" && data.timestamp) {
        ws.send(JSON.stringify({ type: "latency", latency: Date.now() - data.timestamp }));
      }
    } catch {}
  });
  ws.on("close", () => {
    clearInterval(pingInterval);
    clientSockets.delete(ws);
    broadcastClients();
  });
});

server.on("upgrade", (req, socket, head) => {
  if (req.url === "/w/ping") {
    pingWSS.handleUpgrade(req, socket, head, (ws) => pingWSS.emit("connection", ws, req));
  } else if (req.url.startsWith("/w/")) {
    wisp.routeRequest(req, socket, head);
  } else {
    socket.end();
  }
});

const STARTUP_ART = String.raw`
   _     _            _
  | |__ | | __ _  ___| | ____      ____ ___   _____  ___
  | '_ \| |/ _' |/ __| |/ /\ \ /\ / / _' \ \ / / _ \/ __|
  | |_) | | (_| | (__|   <  \ V  V / (_| |\ V /  __/\__ \
  |_.__/|_|\__,_|\___|_|\_\  \_/\_/ \__,_| \_/ \___||___/

         \o/      cowabunga! the server is surfing.
  ~^~^~^~^~|~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~
`;

const SHUTDOWN_ART = String.raw`
      (-.-) zzZ     blackwaves is heading to bed.
      /|  |\       the tide went out. bye!
  ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
`;

server.on("listening", () => {
  const address = server.address();
  console.log(STARTUP_ART);
  console.log(`  [blackwaves] v${VERSION} by yaanscoat - https://github.com/yaanscoat`);
  console.log(`  [blackwaves] Running at http://localhost:${address.port}`);
  console.log(`  [blackwaves] Engines: Scramjet latest | Scramjet 1.1.0 | Ultraviolet\n`);
  resolveLocation().then(() => {
    console.log(`  [blackwaves] Server location: ${serverLocation}`);
    const msg = JSON.stringify({ type: "location", location: serverLocation });
    for (const ws of clientSockets) if (ws.readyState === ws.OPEN) ws.send(msg);
  });
});

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));

let shuttingDown = false;
function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(SHUTDOWN_ART);
  console.log(`  [blackwaves] ${signal} received, closing ${clientSockets.size} client(s)...`);
  for (const ws of clientSockets) ws.terminate();
  server.close(() => {
    console.log("  [blackwaves] Server closed. See you next wave!\n");
    process.exit(0);
  });
  setTimeout(() => process.exit(0), 3000).unref();
}

server.listen(port);
