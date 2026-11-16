/*
 * Proxy engine. Registers the unified service worker and boots exactly one engine:
 *   scramjet         Scramjet latest (2.x controller, proxy-transports in the page)
 *   scramjet-legacy  Scramjet 1.1.0 (bare-mux)
 *   uv               Ultraviolet (bare-mux)
 * Only the selected engine's scripts are loaded, so the two Scramjet builds never share a realm.
 */
(function () {
  const protocol = BW.PROTOCOLS[BW.settings.get('protocol')] ? BW.settings.get('protocol') : 'scramjet';
  const SJ_LATEST_PATH = /^\/~\/sj\/[^/]+\/[^/]+\/(.*)$/;

  let encodeImpl = null;
  let decodeImpl = null;
  let controller = null;
  const frames = new WeakMap();

  const log = (msg, color = '#8ab4ff') => console.log(`%c[blackwaves]%c ${msg}`, `color:${color};font-weight:bold`, 'color:inherit');

  function waitForController(timeoutMs = 8000) {
    if (navigator.serviceWorker.controller) return Promise.resolve();
    return Promise.race([
      navigator.serviceWorker.ready.then(() => {}),
      new Promise((resolve) => navigator.serviceWorker.addEventListener('controllerchange', resolve, { once: true })),
      new Promise((resolve) => setTimeout(resolve, timeoutMs)),
    ]);
  }

  async function registerSW() {
    if (!('serviceWorker' in navigator)) {
      throw new Error('Service workers are unavailable. Try a non-private window or a different browser.');
    }
    // Older builds registered the worker under a narrower scope; drop those.
    for (const reg of await navigator.serviceWorker.getRegistrations()) {
      if (reg.scope !== `${location.origin}/`) await reg.unregister();
    }
    const reg = await navigator.serviceWorker.register('/sw.js', { scope: '/', updateViaCache: 'none' });
    await waitForController();
    const sw = navigator.serviceWorker.controller || reg.active || reg.waiting || reg.installing;
    if (!sw) throw new Error('Service worker failed to activate.');
    return sw;
  }

  async function setupBareMux() {
    await BW.loadScript('/baremux/index.js');
    const conn = new BareMux.BareMuxConnection('/baremux/worker.js');
    if (BW.settings.get('transport') === 'libcurl') {
      await conn.setTransport('/libcurl/index.mjs', [{ wisp: BW.wispUrl() }]);
    } else {
      // Epoxy with an automatic Libcurl fallback for sites Epoxy's HTTP/2 client rejects (e.g. YouTube)
      await conn.setTransport(HYBRID_TRANSPORT, [{ wisp: BW.wispUrl(), epoxy: '/epoxy/index.mjs', libcurl: '/libcurl/index.mjs' }]);
    }
  }
  const HYBRID_TRANSPORT = '/assets/transports/hybrid.mjs';

  async function bootUltraviolet() {
    await BW.loadScript('/uv/uv.bundle.js');
    await BW.loadScript('/uv/uv.config.js');
    await setupBareMux();
    const cfg = self.__uv$config;
    encodeImpl = (url) => cfg.prefix + cfg.encodeUrl(url);
    decodeImpl = (path) => (path.startsWith(cfg.prefix) ? cfg.decodeUrl(path.slice(cfg.prefix.length)) : null);
  }

  const LEGACY_STORES = ['config', 'cookies', 'redirectTrackers', 'referrerPolicies', 'publicSuffixList'];

  // If "$scramjet" was ever created without its stores, init() can never add them (same version). Drop it.
  function repairLegacyDb() {
    return new Promise((resolve) => {
      const req = indexedDB.open('$scramjet');
      req.onupgradeneeded = () => req.transaction.abort(); // doesn't exist yet: don't create it here
      req.onerror = () => resolve();
      req.onsuccess = () => {
        const db = req.result;
        const healthy = LEGACY_STORES.every((s) => db.objectStoreNames.contains(s));
        db.close();
        if (healthy) return resolve();
        log('Repairing Scramjet 1.1.0 database...', '#f5b94a');
        const del = indexedDB.deleteDatabase('$scramjet');
        del.onsuccess = del.onerror = () => resolve();
        del.onblocked = () => setTimeout(resolve, 1500);
      };
    });
  }

  async function bootScramjetLegacy() {
    await repairLegacyDb();
    await BW.loadScript('/scram/scramjet.all.js');
    const { ScramjetController } = $scramjetLoadController();
    const sj = new ScramjetController({
      prefix: '/service/sj/',
      files: {
        wasm: '/scram/scramjet.wasm.wasm',
        all: '/scram/scramjet.all.js',
        sync: '/scram/scramjet.sync.js',
      },
    });
    await sj.init();
    await setupBareMux();
    encodeImpl = (url) => sj.encodeUrl(url);
    decodeImpl = (path) => (path.startsWith('/service/sj/') ? sj.decodeUrl(location.origin + path) : null);
  }

  async function bootScramjetLatest(sw) {
    await BW.loadScript('/scramjet/scramjet.js');
    await BW.loadScript('/controller/controller.api.js');
    const useLibcurl = BW.settings.get('transport') === 'libcurl';
    const mod = await import(useLibcurl ? '/libcurl2/index.mjs' : HYBRID_TRANSPORT);
    const Transport = mod.default;
    const transport = new Transport({ wisp: BW.wispUrl(), epoxy: '/epoxy3/index.mjs', libcurl: '/libcurl2/index.mjs' });
    await transport.init();
    controller = new $scramjetController.Controller({ serviceworker: sw, transport });
    await controller.wait();
    encodeImpl = (url, iframe) => {
      const frame = frameFor(iframe);
      return frame.prefix + controller.config.codec.encode(url);
    };
    decodeImpl = (path) => {
      const m = path.match(SJ_LATEST_PATH);
      if (!m) return null;
      const real = controller.config.codec.decode(m[1]);
      // Scramjet tracks redirects with its own "$"-prefixed query params; hide them from the address bar.
      try {
        const u = new URL(real);
        if ([...u.searchParams.keys()].some((k) => k.startsWith('$'))) {
          for (const k of [...u.searchParams.keys()]) if (k.startsWith('$')) u.searchParams.delete(k);
          return u.href;
        }
      } catch {}
      return real;
    };
  }

  function frameFor(iframe) {
    iframe = iframe || BW.tabs.activeFrame();
    if (!frames.has(iframe)) frames.set(iframe, controller.createFrame(iframe));
    return frames.get(iframe);
  }

  async function init() {
    const started = performance.now();
    log(`Booting ${BW.PROTOCOLS[protocol].name} with ${BW.settings.get('transport')}...`);
    const sw = await registerSW();
    if (protocol === 'uv') await bootUltraviolet();
    else if (protocol === 'scramjet-legacy') await bootScramjetLegacy();
    else await bootScramjetLatest(sw);
    log(`${BW.PROTOCOLS[protocol].name} ready in ${Math.round(performance.now() - started)}ms`, '#5ee39a');
  }

  const ready = init().catch((err) => {
    console.error('[blackwaves] proxy failed to start', err);
    throw err;
  });
  ready.catch(() => {});

  function encode(url, iframe) {
    return encodeImpl(url, iframe);
  }

  /** Turn a proxied frame href back into the real URL. Non-proxied same-origin pages pass through. */
  function decode(href) {
    if (!href) return '';
    try {
      const u = new URL(href, location.origin);
      if (u.origin !== location.origin) return u.href;
      const path = u.pathname + u.search + u.hash;
      const real = decodeImpl && decodeImpl(path);
      if (real) return real;
      return u.href;
    } catch {
      return href;
    }
  }

  async function navigate(iframe, url) {
    await ready;
    iframe.src = encode(url, iframe);
  }

  /** Warm up a URL (DNS, TLS, wisp stream, cached assets) in a throwaway hidden frame. */
  async function preload(url) {
    await ready;
    const f = document.createElement('iframe');
    f.setAttribute('aria-hidden', 'true');
    f.tabIndex = -1;
    f.style.cssText = 'position:fixed;width:1px;height:1px;left:-9999px;top:-9999px;opacity:0;pointer-events:none;border:0';
    document.body.appendChild(f);
    const done = () => setTimeout(() => f.remove(), 1500);
    f.addEventListener('load', done, { once: true });
    setTimeout(() => f.remove(), 25000);
    f.src = encode(url, f);
  }

  BW.proxy = { protocol, ready, encode, decode, navigate, preload, frameFor: (el) => controller && frameFor(el) };
})();
