// the proxy browser runtime: scramjet (2.x controller build) running through a
// service worker, tunnelling over wisp with epoxy or libcurl. everything here
// happens in your browser; the server only relays the encrypted tcp streams.
import { settings } from "./settings.js";

const PREFIX = "/~/sj/";
let readyPromise = null;
let controller = null;

function loadScript(src) {
  return new Promise((resolve, reject) => {
    if (document.querySelector(`script[data-src="${src}"]`)) return resolve();
    const script = document.createElement("script");
    script.src = src;
    script.dataset.src = src;
    script.onload = resolve;
    script.onerror = () => reject(new Error(`couldn't load ${src}`));
    document.head.append(script);
  });
}

function wispUrl() {
  return `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/wisp/`;
}

// requests we answer with nothing: ad networks, trackers, and the anti-devtools
// script some movie embeds ship that mistakes our proxy for open devtools.
// every blocked request is one less round trip through wisp, so pages load faster too.
const BLOCKED_HOSTS = [
  "doubleclick.net",
  "googlesyndication.com",
  "googleadservices.com",
  "adservice.google.com",
  "amazon-adsystem.com",
  "adnxs.com",
  "taboola.com",
  "outbrain.com",
  "popads.net",
  "popcash.net",
  "propellerads.com",
  "onclickads.net",
  "adsterra.com",
  "exoclick.com",
  "juicyads.com",
  "tagivi.com",
  "hotjar.com",
  "clarity.ms",
  "scorecardresearch.com",
];
const BLOCKED_PATHS = /disable-devtool|devtools-detect/i;

function isBlocked(url) {
  const host = url.hostname;
  return BLOCKED_HOSTS.some((blocked) => host === blocked || host.endsWith(`.${blocked}`)) || BLOCKED_PATHS.test(url.pathname);
}

const EMPTY = () => ({ body: new ArrayBuffer(0), headers: [["content-type", "text/plain"]], status: 204, statusText: "No Content" });

/** epoxy and libcurl both choke if headers show up as a plain object, so we normalize first */
function normalizeTransport(inner) {
  const entries = (headers) => (headers && typeof headers[Symbol.iterator] === "function" ? headers : Object.entries(headers || {}));
  return {
    get ready() {
      return inner.ready;
    },
    init: () => inner.init(),
    request: async (remote, method, body, headers, signal) => {
      if (isBlocked(remote)) return EMPTY();
      return inner.request(remote, method, body, entries(headers), signal);
    },
    connect: (url, protocols, headers, ...rest) => inner.connect(url, protocols, entries(headers), ...rest),
  };
}

async function makeTransport(name) {
  const path = name === "libcurl" ? "/libcurl/index.mjs" : "/epoxy/index.mjs";
  // a full runtime url so the bundler doesn't try to inline the transport
  const module = await import(/* @vite-ignore */ new URL(path, location.origin).href);
  const Transport = module.default || module.LibcurlClient;
  const transport = normalizeTransport(new Transport({ wisp: wispUrl() }));
  await transport.init();
  return transport;
}

async function activeWorker() {
  if (!("serviceWorker" in navigator)) throw new Error("this browser doesn't support service workers, so the proxy can't run");
  const registration = await navigator.serviceWorker.register("/sw.js", { scope: "/", updateViaCache: "none" });
  if (registration.active) return registration.active;
  const worker = registration.installing || registration.waiting;
  await new Promise((resolve) => {
    worker.addEventListener("statechange", () => worker.state === "activated" && resolve());
    if (worker.state === "activated") resolve();
  });
  return registration.active || worker;
}

export function proxyReady() {
  readyPromise ||= (async () => {
    await loadScript("/scram/scramjet.js");
    await loadScript("/ctrl/controller.api.js");
    const worker = await activeWorker();
    const transport = await makeTransport(settings.value.transport);
    controller = new window.$scramjetController.Controller({
      serviceworker: worker,
      transport,
      config: {
        prefix: PREFIX,
        scramjetPath: "/scram/scramjet.js",
        injectPath: "/ctrl/controller.inject.js",
        wasmPath: "/scram/scramjet.wasm",
      },
    });
    await controller.wait();
    return controller;
  })().catch((error) => {
    readyPromise = null;
    throw error;
  });
  return readyPromise;
}

export async function switchTransport(name) {
  if (!controller) return;
  controller.setTransport(await makeTransport(name));
}

export async function createFrame(iframe) {
  const ctrl = await proxyReady();
  return ctrl.createFrame(iframe);
}

/** read the real url back out of a /~/sj/<controller>/<frame>/<encoded url> path */
export function decodeFrameUrl(href) {
  try {
    const url = new URL(href, location.href);
    if (!url.pathname.startsWith(PREFIX)) return "";
    const rest = url.pathname.slice(PREFIX.length).split("/").slice(2).join("/");
    const real = new URL(decodeURIComponent(rest));
    // scramjet tags urls with its own $io / $rfp / $rfs params. nobody needs to see those.
    for (const key of [...url.searchParams.keys()]) if (!key.startsWith("$")) real.searchParams.append(key, url.searchParams.get(key));
    for (const key of [...real.searchParams.keys()]) if (key.startsWith("$")) real.searchParams.delete(key);
    return real.href + url.hash;
  } catch {
    return "";
  }
}
