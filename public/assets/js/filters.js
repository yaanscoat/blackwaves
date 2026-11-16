/*
 * Builds the network filter the service worker enforces on every proxied request:
 *   - BlackWaves Shield: blackwaves' own blocklist of ad + tracking networks (when enabled)
 *   - every enabled extension's declarativeNetRequest rules (static rulesets, dynamic, session),
 *     which is how uBlock Origin Lite blocks requests
 * Compiled with filter-engine.js and stored in IndexedDB ("bw-filters") for the worker.
 */
(function () {
  // Third-party requests to these networks are blocked by BlackWaves Shield.
  const SHIELD_DOMAINS = [
    'doubleclick.net', 'googlesyndication.com', 'googleadservices.com', 'adservice.google.com', 'pagead2.googlesyndication.com',
    'google-analytics.com', 'googletagservices.com', 'amazon-adsystem.com', 'adnxs.com', 'adsrvr.org', 'taboola.com',
    'outbrain.com', 'criteo.com', 'criteo.net', 'popads.net', 'popcash.net', 'propellerads.com', 'adsterra.com', 'exoclick.com',
    'exdynsrv.com', 'mgid.com', 'revcontent.com', 'zedo.com', 'pubmatic.com', 'rubiconproject.com', 'openx.net', 'media.net',
    'yieldmo.com', '33across.com', 'casalemedia.com', 'smartadserver.com', 'adform.net', 'adcolony.com', 'applovin.com',
    'unityads.unity3d.com', 'moatads.com', 'scorecardresearch.com', 'quantserve.com', 'hotjar.com', 'mixpanel.com',
    'segment.io', 'clarity.ms', 'connect.facebook.net', 'ads-twitter.com', 'ads.linkedin.com', 'bat.bing.com', 'adroll.com',
    'teads.tv', 'sharethrough.com', 'indexww.com', 'bidswitch.net', 'lijit.com', 'sovrn.com', 'contextweb.com', 'gumgum.com',
    'undertone.com', 'spotxchange.com', 'springserve.com', 'adskeeper.com', 'onclickads.net', 'hilltopads.net', 'juicyads.com',
    'trafficjunky.net', 'clickadu.com', 'a-ads.com', 'coinzilla.com', 'ad-maven.com', 'admaven.com', 'popmyads.com',
    'onclasrv.com', 'rtmark.net', 'betweendigital.com', 'acint.net', 'yandexadexchange.net',
  ];
  const SHIELD_RULES = [{ id: 1, priority: 1, action: { type: 'block' }, condition: { requestDomains: SHIELD_DOMAINS, domainType: 'thirdParty' } }];

  const stats = { total: 0, bySource: {} };
  const statListeners = new Set();
  let timer = null;
  let lastSig = null;

  function idbPut(value) {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open('bw-filters', 1);
      req.onupgradeneeded = () => req.result.createObjectStore('kv');
      req.onerror = () => reject(req.error);
      req.onsuccess = () => {
        const db = req.result;
        const tx = db.transaction('kv', 'readwrite');
        tx.objectStore('kv').put(value, 'engine');
        tx.oncomplete = () => {
          db.close();
          resolve();
        };
        tx.onerror = () => reject(tx.error);
      };
    });
  }

  function notifyWorker(message) {
    const sw = navigator.serviceWorker && navigator.serviceWorker.controller;
    if (sw) sw.postMessage(message);
    else if (navigator.serviceWorker) navigator.serviceWorker.ready.then((r) => r.active && r.active.postMessage(message));
  }

  async function collectSources() {
    await BW.extensions.ready;
    const sources = [];
    if (BW.settings.get('builtinExtensions').includes('adshield')) sources.push({ id: 'blackwaves', rules: SHIELD_RULES });
    for (const rt of BW.extensions._runtimes()) {
      if (!rt.record.enabled) continue;
      const resources = (rt.manifest.declarative_net_request && rt.manifest.declarative_net_request.rule_resources) || [];
      const rules = [];
      for (const res of resources) {
        if (!rt.dnr.enabled.has(res.id)) continue;
        try {
          rules.push(...JSON.parse((await rt.text(res.path.replace(/^\//, ''))) || '[]'));
        } catch (e) {
          console.warn(`[filters] couldn't read ruleset ${res.id} of ${rt.manifest.name}`, e);
        }
      }
      rules.push(...rt.dnr.dynamic, ...rt.dnr.session);
      if (rules.length) sources.push({ id: rt.id, rules });
    }
    return sources;
  }

  function signature() {
    const parts = [BW.settings.get('builtinExtensions').includes('adshield') ? 'shield' : ''];
    for (const rt of BW.extensions._runtimes()) {
      if (!rt.record.enabled || !rt.manifest.declarative_net_request) continue;
      parts.push(rt.id, rt.record.installedAt, [...rt.dnr.enabled].sort().join(','), JSON.stringify(rt.dnr.dynamic).length, JSON.stringify(rt.dnr.session));
    }
    return parts.join('|');
  }

  async function build(force) {
    try {
      await BW.extensions.ready;
      const sig = signature();
      let stored = null;
      try {
        stored = localStorage.getItem('bw:filters-sig');
      } catch {}
      if (!force && (sig === lastSig || (lastSig === null && sig === stored))) {
        lastSig = sig;
        return;
      }
      lastSig = sig;
      const started = performance.now();
      const engine = BWFilterEngine.compile(await collectSources());
      await idbPut(engine);
      try {
        localStorage.setItem('bw:filters-sig', sig);
      } catch {}
      notifyWorker({ bwFilters: 'reload' });
      console.log(`%c[blackwaves]%c network filter: ${engine.rules.length} rules from ${engine.sources.length} source(s) in ${Math.round(performance.now() - started)}ms`, 'color:#5ee39a;font-weight:bold', 'color:inherit');
    } catch (e) {
      console.warn('[filters] build failed', e);
    }
  }

  function rebuild() {
    clearTimeout(timer);
    timer = setTimeout(() => build(false), 300);
  }

  if (navigator.serviceWorker) {
    navigator.serviceWorker.addEventListener('message', (e) => {
      const counts = e.data && e.data.bwBlocked;
      if (!counts) return;
      for (const [src, n] of Object.entries(counts)) {
        stats.total += n;
        stats.bySource[src] = (stats.bySource[src] || 0) + n;
      }
      statListeners.forEach((fn) => fn(stats));
    });
  }

  BW.settings.on('builtinExtensions', rebuild);
  BW.onChange((what) => {
    if (what === 'extensions') {
      notifyWorker({ bwExtensions: 'changed' });
      rebuild();
    }
  });
  BW.extensions.ready.then(() => build(false));

  BW.filters = {
    rebuild,
    rebuildNow: () => build(true),
    stats: () => stats,
    onStats: (fn) => {
      statListeners.add(fn);
      return () => statListeners.delete(fn);
    },
    SHIELD_DOMAINS,
  };
})();
