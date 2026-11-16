/*
 * blackwaves unified service worker.
 * One worker at scope "/" serves all three engines, each under its own prefix:
 *   Scramjet latest  -> /~/sj/       (controller-based, transport runs in the page)
 *   Scramjet 1.1.0   -> /service/sj/ (bare-mux)
 *   Ultraviolet      -> /service/uv/ (bare-mux)
 * It also serves installed extension files (/bw-ext/<id>/...) and runs the network filter
 * (BlackWaves Shield + declarativeNetRequest extensions like uBlock Origin Lite) on every
 * proxied request.
 */
importScripts('/uv/uv.bundle.js', '/uv/uv.config.js', '/uv/uv.sw.js');
importScripts('/scram/scramjet.all.js');
importScripts('/controller/controller.sw.js');
importScripts('/assets/js/filter-engine.js');

const uv = new UVServiceWorker();

const LEGACY_PREFIX = '/service/sj/';
// Scramjet 1.1.0 also answers its wasm path itself (as a `self.WASM = ...` script for proxied pages).
const LEGACY_WASM = '/scram/scramjet.wasm.wasm';
const LATEST_PATH = /^\/~\/sj\/[^/]+\/[^/]+\/(.*)$/;
// Built lazily: its constructor opens the "$scramjet" DB without an upgrade handler, which
// would create an empty database before the page's ScramjetController.init() can add its stores.
let scramjetLegacy = null;

async function handleLegacy(event) {
  if (!scramjetLegacy) {
    const { ScramjetServiceWorker } = $scramjetLoadWorker();
    scramjetLegacy = new ScramjetServiceWorker();
  }
  await scramjetLegacy.loadConfig();
  if (scramjetLegacy.route(event)) return scramjetLegacy.fetch(event);
  return fetch(event.request);
}

/* ------------------------------------------------------------------ */
/* IndexedDB helpers                                                   */
/* ------------------------------------------------------------------ */
function openDb(name, version, upgrade) {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(name, version);
    req.onupgradeneeded = () => upgrade && upgrade(req.result);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
function idbGet(db, store, key) {
  return new Promise((resolve, reject) => {
    const req = db.transaction(store, 'readonly').objectStore(store).get(key);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

/* ------------------------------------------------------------------ */
/* Extension files: /bw-ext/<id>/<path>                                */
/* ------------------------------------------------------------------ */
const MIME = {
  js: 'text/javascript', mjs: 'text/javascript', css: 'text/css', html: 'text/html', htm: 'text/html', json: 'application/json',
  svg: 'image/svg+xml', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', ico: 'image/x-icon',
  woff: 'font/woff', woff2: 'font/woff2', ttf: 'font/ttf', otf: 'font/otf', wasm: 'application/wasm', txt: 'text/plain', xml: 'application/xml',
  mp3: 'audio/mpeg', mp4: 'video/mp4', webm: 'video/webm', ogg: 'audio/ogg', wav: 'audio/wav',
};
const mimeOf = (p) => MIME[(p.split('.').pop() || '').toLowerCase()] || 'application/octet-stream';
const extCache = new Map(); // id -> { record, time }

async function getExtension(id) {
  const hit = extCache.get(id);
  if (hit && Date.now() - hit.time < 15000) return hit.record;
  const db = await openDb('bw-extensions', 1, (d) => {
    d.createObjectStore('extensions', { keyPath: 'id' });
    d.createObjectStore('storage');
  });
  const record = await idbGet(db, 'extensions', id);
  db.close();
  extCache.set(id, { record, time: Date.now() });
  return record;
}

function escAttr(s) {
  return String(s).replace(/[&"<>]/g, (c) => ({ '&': '&amp;', '"': '&quot;', '<': '&lt;', '>': '&gt;' }[c]));
}

async function serveExtension(url) {
  const m = url.pathname.match(/^\/bw-ext\/([a-p]{32})\/(.*)$/);
  if (!m) return new Response('Not found', { status: 404 });
  const id = m[1];
  const path = decodeURIComponent(m[2]);
  const record = await getExtension(id);
  if (!record) return new Response('Extension not installed', { status: 404 });
  const shim = (kind) => `<script src="/assets/js/ext-shim.js" data-id="${escAttr(id)}" data-kind="${kind}"></script>`;

  if (path === '__bw_background__.html') {
    const bg = (record.manifest && record.manifest.background) || {};
    if (bg.page) {
      const file = record.files[bg.page.replace(/^\//, '')];
      const html = file ? await file.text() : '';
      return htmlResponse(injectShim(html, shim('background')));
    }
    const scripts = bg.service_worker ? [bg.service_worker] : bg.scripts || [];
    const type = bg.type === 'module' ? ' type="module"' : '';
    const tags = scripts.map((s) => `<script${type} src="/bw-ext/${id}/${escAttr(String(s).replace(/^\//, ''))}"></script>`).join('');
    return htmlResponse(`<!DOCTYPE html><html><head><meta charset="utf-8">${shim('background')}${tags}</head><body></body></html>`);
  }

  const file = record.files[path] || record.files[path.replace(/^\//, '')];
  if (!file) return new Response('Not found', { status: 404 });
  const type = mimeOf(path);
  if (type === 'text/html') {
    const kind = /popup/i.test(path) ? 'popup' : 'page';
    return htmlResponse(injectShim(await file.text(), shim(kind)));
  }
  return new Response(file, { headers: { 'Content-Type': type, 'Cache-Control': 'no-cache' } });
}

// In Chrome "/" inside an extension means the extension's root. Extension pages here live under
// /bw-ext/<id>/, so map root-relative requests they make (fetch('/rulesets/x.json'), import '/js/a.js')
// back into the extension, unless the path belongs to blackwaves itself.
const APP_PATHS = /^\/(?:assets|uv|scram|scramjet|controller|baremux|epoxy3?|libcurl2?|api|w|gms|bw-ext|service|~)\/|^\/(?:sw\.js|favicon\.ico|404\.html)?$/;
const EXT_URL = /^https?:\/\/[^/]+\/bw-ext\/([a-p]{32})\//;

async function extensionFor(event) {
  const ref = event.request.referrer && event.request.referrer.match(EXT_URL);
  if (ref) return ref[1];
  if (!event.clientId) return null;
  try {
    const client = await self.clients.get(event.clientId);
    const m = client && client.url.match(EXT_URL);
    return m ? m[1] : null;
  } catch {
    return null;
  }
}

async function serveExtensionRelative(event, url) {
  const id = await extensionFor(event);
  if (id) {
    const record = await getExtension(id);
    const path = decodeURIComponent(url.pathname.slice(1));
    if (record && record.files[path]) return serveExtension(new URL(`/bw-ext/${id}/${url.pathname.slice(1)}`, location.origin));
  }
  return fetch(event.request);
}

function injectShim(html, tag) {
  if (/<head[^>]*>/i.test(html)) return html.replace(/<head[^>]*>/i, (h) => h + tag);
  if (/<html[^>]*>/i.test(html)) return html.replace(/<html[^>]*>/i, (h) => `${h}<head>${tag}</head>`);
  return tag + html;
}
const htmlResponse = (html) => new Response(html, { headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-cache' } });

/* ------------------------------------------------------------------ */
/* Network filtering                                                   */
/* ------------------------------------------------------------------ */
let engine = null;
let engineLoading = null;

function loadEngine() {
  if (!engineLoading) {
    engineLoading = (async () => {
      try {
        const db = await openDb('bw-filters', 1, (d) => d.createObjectStore('kv'));
        engine = (await idbGet(db, 'kv', 'engine')) || null;
        db.close();
      } catch {
        engine = null;
      }
      return engine;
    })();
  }
  return engineLoading;
}

/** Real URL behind a proxied path, for whichever engine served it. */
function realUrl(href) {
  let u;
  try {
    u = new URL(href);
  } catch {
    return null;
  }
  if (u.origin !== location.origin) return null;
  const path = u.pathname + u.search;
  try {
    const m = u.pathname.match(LATEST_PATH);
    if (m) return decodeURIComponent(m[1] + u.search);
    if (u.pathname.startsWith(LEGACY_PREFIX)) return decodeURIComponent(path.slice(LEGACY_PREFIX.length));
    if (u.pathname.startsWith(__uv$config.prefix)) return __uv$config.decodeUrl(u.pathname.slice(__uv$config.prefix.length));
  } catch {}
  return null;
}

const DEST_TYPE = {
  script: 'script', style: 'stylesheet', image: 'image', font: 'font', object: 'object', embed: 'object',
  audio: 'media', video: 'media', track: 'media', iframe: 'sub_frame', frame: 'sub_frame', document: 'main_frame',
  worker: 'other', sharedworker: 'other', serviceworker: 'other', manifest: 'other', report: 'csp_report', '': 'xmlhttprequest',
};

let blockedSinceFlush = {};
let flushTimer = null;
function countBlocked(source) {
  blockedSinceFlush[source] = (blockedSinceFlush[source] || 0) + 1;
  if (flushTimer) return;
  flushTimer = setTimeout(async () => {
    const counts = blockedSinceFlush;
    blockedSinceFlush = {};
    flushTimer = null;
    for (const c of await self.clients.matchAll({ type: 'window' })) {
      if (!realUrl(c.url)) c.postMessage({ bwBlocked: counts });
    }
  }, 800);
}

async function filterDecision(event, url) {
  const target = realUrl(url.href);
  if (!target || !/^https?:/.test(target)) return null;
  const eng = engine || (await loadEngine());
  if (!eng || !eng.rules || !eng.rules.length) return null;

  const req = event.request;
  let type = DEST_TYPE[req.destination] || 'other';
  let initiatorUrl = '';
  let frameUrl = '';
  if (req.mode === 'navigate') {
    // A navigation whose referrer is a proxied page is a nested frame; otherwise it's a tab itself.
    const parent = realUrl(req.referrer);
    if (!parent) return null; // never block a tab's own page
    type = 'sub_frame';
    initiatorUrl = frameUrl = parent;
  } else {
    let client = null;
    try {
      client = event.clientId ? await self.clients.get(event.clientId) : null;
    } catch {}
    initiatorUrl = frameUrl = (client && realUrl(client.url)) || realUrl(req.referrer) || '';
    if (type === 'xmlhttprequest' && req.headers.get('accept') === 'text/event-stream') type = 'other';
  }
  return BWFilterEngine.match(eng, { url: target, type, method: req.method, initiatorUrl, frameUrl, frameType: 'main_frame' });
}

async function blockedResponse(decision, event) {
  countBlocked(decision.source);
  if (decision.action === 'redirect' && decision.redirect) {
    const r = decision.redirect;
    try {
      if (r.ext) {
        const record = await getExtension(r.ext);
        const file = record && record.files[String(r.path).replace(/^\//, '').split('?')[0]];
        if (file) return new Response(file, { headers: { 'Content-Type': mimeOf(r.path) } });
      } else if (r.url && r.url.startsWith('data:')) {
        return fetch(r.url);
      }
    } catch {}
  }
  if (event.request.mode === 'navigate') return htmlResponse('<!DOCTYPE html><html><body></body></html>');
  return Response.error();
}

/* ------------------------------------------------------------------ */
/* Downloads: let the browser save them natively, report progress      */
/* ------------------------------------------------------------------ */
const DOWNLOAD_TYPES = /^application\/(octet-stream|zip|x-zip-compressed|gzip|x-gzip|x-tar|x-7z-compressed|x-rar-compressed|vnd\.rar|x-msdownload|x-msi|x-ms-installer|vnd\.android\.package-archive|x-apple-diskimage|x-iso9660-image|x-bittorrent|x-debian-package|x-redhat-package-manager|java-archive|x-xz|x-bzip2|zstd|vnd\.ms-excel|vnd\.openxmlformats|msword|vnd\.oasis)/i;

async function notifyApp(message) {
  for (const c of await self.clients.matchAll({ type: 'window' })) {
    if (!realUrl(c.url) && !c.url.includes('/bw-ext/')) c.postMessage(message);
  }
}

function downloadName(disposition, url) {
  const star = disposition.match(/filename\*\s*=\s*(?:UTF-8|utf-8)?''([^;]+)/i);
  if (star) {
    try {
      return decodeURIComponent(star[1].trim().replace(/^"|"$/g, ''));
    } catch {}
  }
  const plain = disposition.match(/filename\s*=\s*("([^"]*)"|[^;]+)/i);
  if (plain) return (plain[2] != null ? plain[2] : plain[1]).trim();
  try {
    const last = new URL(url).pathname.split('/').filter(Boolean).pop();
    if (last) return decodeURIComponent(last);
  } catch {}
  return 'download';
}

function isDownload(response) {
  const disposition = response.headers.get('content-disposition') || '';
  if (/^\s*attachment/i.test(disposition)) return true;
  return DOWNLOAD_TYPES.test(response.headers.get('content-type') || '');
}

function trackDownload(response, url) {
  const id = Math.random().toString(36).slice(2, 10);
  const size = +response.headers.get('content-length') || 0;
  const info = {
    id,
    url,
    filename: downloadName(response.headers.get('content-disposition') || '', url),
    size,
    type: (response.headers.get('content-type') || '').split(';')[0],
  };
  notifyApp({ bwDownload: Object.assign({ state: 'started' }, info) });
  if (!response.body) {
    notifyApp({ bwDownload: { id, state: 'done', loaded: size } });
    return response;
  }
  let loaded = 0;
  let last = 0;
  const reader = response.body.getReader();
  const body = new ReadableStream({
    async pull(ctrl) {
      try {
        const { done, value } = await reader.read();
        if (done) {
          notifyApp({ bwDownload: { id, state: 'done', loaded } });
          ctrl.close();
          return;
        }
        loaded += value.byteLength;
        ctrl.enqueue(value);
        if (Date.now() - last > 300) {
          last = Date.now();
          notifyApp({ bwDownload: { id, state: 'progress', loaded } });
        }
      } catch (err) {
        notifyApp({ bwDownload: { id, state: 'interrupted', loaded } });
        ctrl.error(err);
      }
    },
    cancel(reason) {
      // the user cancelled it in the browser's download bar
      notifyApp({ bwDownload: { id, state: 'interrupted', loaded } });
      reader.cancel(reason).catch(() => {});
    },
  });
  return new Response(body, { status: response.status, statusText: response.statusText, headers: response.headers });
}

/* ------------------------------------------------------------------ */
/* Fetch routing                                                       */
/* ------------------------------------------------------------------ */
function routeProxy(event, url) {
  if ($scramjetController.shouldRoute(event)) return $scramjetController.route(event);
  if (url.pathname.startsWith(LEGACY_PREFIX) || url.pathname === LEGACY_WASM) return handleLegacy(event);
  if (uv.route(event)) return uv.fetch(event);
  return null;
}

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return;

  if (url.pathname.startsWith('/bw-ext/')) {
    event.respondWith(serveExtension(url));
    return;
  }

  const isProxied =
    $scramjetController.shouldRoute(event) || url.pathname.startsWith(LEGACY_PREFIX) || url.pathname === LEGACY_WASM || uv.route(event);
  if (!isProxied) {
    if (!APP_PATHS.test(url.pathname)) event.respondWith(serveExtensionRelative(event, url));
    return;
  }

  event.respondWith(
    (async () => {
      let decision = null;
      try {
        decision = await filterDecision(event, url);
      } catch {}
      if (decision) return blockedResponse(decision, event);
      const response = await routeProxy(event, url);
      if (event.request.mode === 'navigate' && response && response.ok && isDownload(response)) {
        return trackDownload(response, realUrl(url.href) || url.href);
      }
      return response;
    })()
  );
});

self.addEventListener('message', (event) => {
  if (event.data && event.data.bwFilters === 'reload') {
    engineLoading = null;
    loadEngine();
  }
  if (event.data && event.data.bwExtensions === 'changed') extCache.clear();
});
