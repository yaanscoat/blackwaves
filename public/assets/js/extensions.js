/*
 * blackwaves extensions - a JavaScript rewrite of the ideas in x8rr/sapphire
 * (https://github.com/x8rr/sapphire), which emulates chrome.* extension APIs for Scramjet.
 *
 * Sapphire is a TypeScript plugin bound to the Scramjet 2 controller's hooks. This version is
 * engine-agnostic: every engine serves proxied pages from our own origin, so we reach into the
 * frame's window directly and run extension code there. That makes it work the same on
 * Scramjet latest, Scramjet 1.1.0 and Ultraviolet.
 *
 * Supported: MV2/MV3 .crx / .zip / unpacked folders and .user.js userscripts.
 *   content_scripts (matches, exclude_matches, globs, run_at, all_frames, css + js)
 *   background (scripts, page, service_worker) in a hidden same-origin frame
 *   action/browser_action popups and options pages
 *   chrome.runtime, storage (local/sync/session), i18n, tabs, scripting, alarms, action,
 *   notifications, permissions, contextMenus (stub), webRequest/declarativeNetRequest (stub)
 */
(function () {
  /* ================================================================ */
  /* Match patterns (ported from sapphire/src/matchPatterns.ts)        */
  /* ================================================================ */
  const patternCache = new Map();

  function globToRegExp(glob, questionMark) {
    let re = '';
    for (const ch of glob) {
      if (ch === '*') re += '.*';
      else if (ch === '?' && questionMark) re += '.';
      else re += ch.replace(/[.+^${}()|[\]\\?]/g, '\\$&');
    }
    return new RegExp(`^${re}$`, 's');
  }

  function compilePattern(pattern) {
    if (patternCache.has(pattern)) return patternCache.get(pattern);
    let result = null;
    if (pattern === '<all_urls>') {
      result = { all: true };
    } else {
      const m = pattern.match(/^(\*|[a-z][a-z0-9+.-]*):\/\/([^/]*)(\/.*)?$/i);
      if (m) {
        const scheme = m[1].toLowerCase();
        let hostPart = m[2].toLowerCase();
        let port = null;
        const pm = hostPart.match(/^(.*?)(?::(\d+|\*))?$/);
        if (pm) {
          hostPart = pm[1];
          port = pm[2] && pm[2] !== '*' ? pm[2] : null;
        }
        let host = hostPart;
        let subdomains = false;
        if (host === '*' || (host === '' && scheme === 'file')) host = null;
        else if (host.startsWith('*.')) {
          host = host.slice(2);
          subdomains = true;
        }
        result = {
          all: false,
          schemes: scheme === '*' ? ['http', 'https', 'ws', 'wss'] : [scheme],
          host,
          subdomains,
          port,
          path: globToRegExp(m[3] || '/*', false),
        };
      }
    }
    patternCache.set(pattern, result);
    return result;
  }

  function matchPattern(pattern, url) {
    const c = compilePattern(pattern);
    if (!c) return false;
    let u;
    try {
      u = typeof url === 'string' ? new URL(url) : url;
    } catch {
      return false;
    }
    const scheme = u.protocol.slice(0, -1).toLowerCase();
    if (c.all) return ['http', 'https', 'ws', 'wss', 'ftp', 'file', 'data'].includes(scheme);
    if (!c.schemes.includes(scheme)) return false;
    const hostname = u.hostname.toLowerCase();
    if (c.host !== null) {
      if (c.subdomains) {
        if (hostname !== c.host && !hostname.endsWith(`.${c.host}`)) return false;
      } else if (hostname !== c.host) return false;
    }
    if (c.port !== null) {
      const eff = u.port || (scheme === 'https' || scheme === 'wss' ? '443' : '80');
      if (eff !== c.port) return false;
    }
    return c.path.test((u.pathname || '/') + u.search);
  }

  const matchGlob = (glob, url) => globToRegExp(glob, true).test(url);

  function urlMatchesContentScript(url, cs) {
    if (!(cs.matches || []).some((p) => matchPattern(p, url))) return false;
    if ((cs.exclude_matches || []).some((p) => matchPattern(p, url))) return false;
    if ((cs.include_globs || []).length && !cs.include_globs.some((g) => matchGlob(g, url))) return false;
    if ((cs.exclude_globs || []).some((g) => matchGlob(g, url))) return false;
    return true;
  }

  /* ================================================================ */
  /* CRX parsing + extension ids (ported from sapphire/src/crx.ts)     */
  /* ================================================================ */
  function readVarint(buf, pos) {
    let result = 0;
    let shift = 0;
    while (pos < buf.length) {
      const b = buf[pos++];
      result += (b & 0x7f) * 2 ** shift;
      if (!(b & 0x80)) break;
      shift += 7;
    }
    return [result, pos];
  }

  function protoField(buf, wanted) {
    let pos = 0;
    while (pos < buf.length) {
      const [key, afterKey] = readVarint(buf, pos);
      pos = afterKey;
      const field = Math.floor(key / 8);
      const wire = key & 7;
      if (wire === 2) {
        const [len, afterLen] = readVarint(buf, pos);
        if (field === wanted) return buf.subarray(afterLen, afterLen + len);
        pos = afterLen + len;
      } else if (wire === 0) pos = readVarint(buf, pos)[1];
      else if (wire === 1) pos += 8;
      else if (wire === 5) pos += 4;
      else return null;
    }
    return null;
  }

  function bytesToExtensionId(bytes) {
    let id = '';
    for (let i = 0; i < 16; i++) id += String.fromCharCode(97 + (bytes[i] >> 4)) + String.fromCharCode(97 + (bytes[i] & 15));
    return id;
  }

  function parseCrx(buffer) {
    const view = new DataView(buffer);
    if (buffer.byteLength < 12) return { zip: buffer, crxId: null };
    const magic = String.fromCharCode(view.getUint8(0), view.getUint8(1), view.getUint8(2), view.getUint8(3));
    if (magic !== 'Cr24') return { zip: buffer, crxId: null };
    const version = view.getUint32(4, true);
    if (version === 2) {
      const pubLen = view.getUint32(8, true);
      const sigLen = view.getUint32(12, true);
      return { zip: buffer.slice(16 + pubLen + sigLen), crxId: null };
    }
    if (version === 3) {
      const headerSize = view.getUint32(8, true);
      const header = new Uint8Array(buffer, 12, headerSize);
      const signed = protoField(header, 10000);
      const raw = signed && protoField(signed, 1);
      return { zip: buffer.slice(12 + headerSize), crxId: raw && raw.length === 16 ? bytesToExtensionId(raw) : null };
    }
    throw new Error(`Unknown CRX version ${version}`);
  }

  async function idFromBytes(bytes) {
    return bytesToExtensionId(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)));
  }
  const idFromKey = (key) => idFromBytes(Uint8Array.from(atob(key.replace(/\s+/g, '')), (c) => c.charCodeAt(0)));
  const idFromSeed = (seed) => idFromBytes(new TextEncoder().encode(seed));

  const MIME = {
    js: 'text/javascript', mjs: 'text/javascript', css: 'text/css', html: 'text/html', htm: 'text/html',
    json: 'application/json', txt: 'text/plain', xml: 'application/xml', svg: 'image/svg+xml',
    png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp',
    ico: 'image/x-icon', woff: 'font/woff', woff2: 'font/woff2', ttf: 'font/ttf', otf: 'font/otf',
    wasm: 'application/wasm', mp3: 'audio/mpeg', wav: 'audio/wav', ogg: 'audio/ogg', mp4: 'video/mp4', webm: 'video/webm',
  };
  const guessMime = (p) => MIME[(p.split(/[?#]/)[0].split('.').pop() || '').toLowerCase()] || 'application/octet-stream';

  /* ================================================================ */
  /* Storage (IndexedDB)                                               */
  /* ================================================================ */
  let dbPromise = null;
  function db() {
    if (!dbPromise) {
      dbPromise = new Promise((resolve, reject) => {
        const req = indexedDB.open('bw-extensions', 1);
        req.onupgradeneeded = () => {
          req.result.createObjectStore('extensions', { keyPath: 'id' });
          req.result.createObjectStore('storage');
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      });
    }
    return dbPromise;
  }
  async function idb(store, mode, fn) {
    const d = await db();
    return new Promise((resolve, reject) => {
      const tx = d.transaction(store, mode);
      const req = fn(tx.objectStore(store));
      tx.oncomplete = () => resolve(req && req.result);
      tx.onerror = () => reject(tx.error);
    });
  }

  /* ================================================================ */
  /* Small helpers                                                     */
  /* ================================================================ */
  class ChromeEvent {
    constructor() {
      this.listeners = new Set();
    }
    addListener(fn) {
      this.listeners.add(fn);
    }
    removeListener(fn) {
      this.listeners.delete(fn);
    }
    hasListener(fn) {
      return this.listeners.has(fn);
    }
    hasListeners() {
      return this.listeners.size > 0;
    }
    dispatch(...args) {
      const out = [];
      for (const fn of [...this.listeners]) {
        try {
          out.push(fn(...args));
        } catch (e) {
          console.error('[extensions] listener error', e);
        }
      }
      return out;
    }
  }

  // MV3 style: return a promise unless a callback is passed as the last argument.
  function api(fn) {
    return function (...args) {
      const cb = typeof args[args.length - 1] === 'function' ? args.pop() : null;
      const p = Promise.resolve().then(() => fn(...args));
      if (cb) {
        p.then((v) => cb(v), (e) => console.warn('[extensions]', e));
        return undefined;
      }
      return p;
    };
  }

  const RTL = new Set(['ar', 'he', 'fa', 'ur', 'yi', 'ps', 'sd', 'ug', 'dv']);
  function lowerKeys(m) {
    const out = {};
    for (const [k, v] of Object.entries(m || {})) {
      if (!v || typeof v !== 'object') continue;
      const ph = {};
      for (const [pk, pv] of Object.entries(v.placeholders || {})) ph[pk.toLowerCase()] = pv;
      out[k.toLowerCase()] = { message: String(v.message ?? ''), placeholders: ph };
    }
    return out;
  }

  /* ================================================================ */
  /* Extension runtime                                                 */
  /* ================================================================ */
  const runtimes = new Map(); // id -> Runtime

  class Runtime {
    constructor(record) {
      this.record = record;
      this.id = record.id;
      this.manifest = record.manifest;
      this.texts = new Map();
      this.events = {
        message: new ChromeEvent(), // background/popup listeners for runtime.onMessage
        connect: new ChromeEvent(),
        installed: new ChromeEvent(),
        startup: new ChromeEvent(),
        alarm: new ChromeEvent(),
        actionClicked: new ChromeEvent(),
        storageChanged: new ChromeEvent(),
        tabUpdated: new ChromeEvent(),
        menuClicked: new ChromeEvent(),
      };
      this.contentEvents = new Map(); // "message:<tabId>" / "connect:<tabId>" -> ChromeEvent
      this.alarms = new Map();
      this.badge = '';
      this.storage = { local: {}, sync: {}, session: {} };
      this.messages = {};
      this.uiLocale = 'en';
      this.background = null;
      // declarativeNetRequest state: enabled static rulesets, dynamic + session rules
      this.dnr = { enabled: new Set(), dynamic: [], session: [] };
      this.registeredScripts = []; // scripting.registerContentScripts + userScripts.register
    }

    async load() {
      for (const area of ['local', 'sync']) {
        this.storage[area] = (await idb('storage', 'readonly', (s) => s.get(`${this.id}:${area}`))) || {};
      }
      const files = Object.keys(this.record.files || {});
      const locales = [...new Set(files.map((f) => (f.match(/^_locales\/([^/]+)\/messages\.json$/) || [])[1]).filter(Boolean))];
      const langs = [...(navigator.languages || []), navigator.language].filter(Boolean).map((l) => l.replace('-', '_'));
      this.uiLocale = langs.find((l) => locales.includes(l)) || langs.map((l) => l.split('_')[0]).find((l) => locales.includes(l)) || this.manifest.default_locale || locales[0] || 'en';
      const chain = [this.manifest.default_locale, this.uiLocale.split('_')[0], this.uiLocale].filter(Boolean);
      for (const l of chain) {
        const text = await this.text(`_locales/${l}/messages.json`);
        if (text) {
          try {
            Object.assign(this.messages, lowerKeys(JSON.parse(text.replace(/^﻿/, ''))));
          } catch {}
        }
      }
      const dnr = await idb('storage', 'readonly', (s) => s.get(`${this.id}:dnr`));
      const resources = (this.manifest.declarative_net_request && this.manifest.declarative_net_request.rule_resources) || [];
      this.dnr.enabled = new Set(dnr && dnr.enabled ? dnr.enabled : resources.filter((r) => r.enabled).map((r) => r.id));
      this.dnr.dynamic = (dnr && dnr.dynamic) || [];
      this.registeredScripts = (await idb('storage', 'readonly', (s) => s.get(`${this.id}:scripts`))) || [];
    }

    async saveDnr() {
      await idb('storage', 'readwrite', (s) => s.put({ enabled: [...this.dnr.enabled], dynamic: this.dnr.dynamic }, `${this.id}:dnr`));
      BW.filters && BW.filters.rebuild();
    }

    async saveScripts() {
      const persistent = this.registeredScripts.filter((x) => x.persistAcrossSessions !== false);
      await idb('storage', 'readwrite', (s) => s.put(persistent, `${this.id}:scripts`));
    }

    file(path) {
      path = String(path || '').replace(/^\.?\//, '').split(/[?#]/)[0];
      return this.record.files ? this.record.files[path] || this.record.files[decodeURIComponent(path)] : null;
    }

    // Extension files are served by the service worker straight from IndexedDB (/bw-ext/<id>/...),
    // so relative imports, CSS url()s and links inside extension pages resolve like in Chrome.
    getURL(path) {
      path = String(path || '').replace(/^\.?\//, '');
      return `${location.origin}/bw-ext/${this.id}/${path}`;
    }

    async text(path) {
      if (this.texts.has(path)) return this.texts.get(path);
      const blob = this.file(path);
      const t = blob ? await blob.text() : null;
      this.texts.set(path, t);
      return t;
    }

    // Resolve url(...) in extension CSS against the extension's own files.
    async css(path) {
      const raw = (await this.text(path)) || '';
      const base = path.includes('/') ? path.slice(0, path.lastIndexOf('/') + 1) : '';
      return raw
        .replace(/url\(\s*(['"]?)(?!data:|https?:|blob:|#|\/\/)([^'")]+)\1\s*\)/g, (m, q, rel) => {
          const resolved = new URL(rel, `https://x/${base}`).pathname.slice(1);
          return `url("${this.getURL(resolved)}")`;
        })
        .replace(/chrome-extension:\/\/__MSG_@@extension_id__\/([^'")\s]+)/g, (m, p) => this.getURL(p));
    }

    getMessage(name, subs, options) {
      const key = String(name ?? '').toLowerCase();
      const rtl = RTL.has(this.uiLocale.split('_')[0]);
      const predefined = {
        '@@extension_id': this.id,
        '@@ui_locale': this.uiLocale,
        '@@bidi_dir': rtl ? 'rtl' : 'ltr',
        '@@bidi_reversed_dir': rtl ? 'ltr' : 'rtl',
        '@@bidi_start_edge': rtl ? 'right' : 'left',
        '@@bidi_end_edge': rtl ? 'left' : 'right',
      };
      if (key in predefined) return predefined[key];
      const entry = this.messages[key];
      if (!entry) return '';
      const list = subs == null ? [] : Array.isArray(subs) ? subs.map(String) : [String(subs)];
      const fill = (t) => t.replace(/\$(\d)/g, (m, d) => (+d >= 1 ? list[+d - 1] ?? '' : m));
      let text = entry.message.replace(/\$([A-Za-z0-9_@]+)\$/g, (m, ph) => {
        const p = entry.placeholders[ph.toLowerCase()];
        return p ? fill(String(p.content ?? '')) : m;
      });
      text = fill(text).replace(/\$\$/g, '$');
      return options && options.escapeLt ? text.replace(/</g, '&lt;') : text;
    }

    async saveStorage(area) {
      if (area === 'session') return;
      await idb('storage', 'readwrite', (s) => s.put(this.storage[area], `${this.id}:${area}`));
    }
  }

  /* ================================================================ */
  /* chrome.* shim                                                     */
  /* ================================================================ */
  function makeStorageArea(rt, area) {
    const changed = new ChromeEvent();
    rt.events.storageChanged.addListener((changes, a) => {
      if (a === area) changed.dispatch(changes);
    });
    const data = () => rt.storage[area];
    const emit = (changes) => {
      if (Object.keys(changes).length) rt.events.storageChanged.dispatch(changes, area);
    };
    const clone = (v) => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));
    return {
      get: api((keys) => {
        const d = data();
        if (keys == null) return clone(d);
        if (typeof keys === 'string') keys = [keys];
        if (Array.isArray(keys)) {
          const out = {};
          keys.forEach((k) => k in d && (out[k] = clone(d[k])));
          return out;
        }
        const out = {};
        for (const [k, def] of Object.entries(keys)) out[k] = k in d ? clone(d[k]) : def;
        return out;
      }),
      set: api(async (items) => {
        const changes = {};
        for (const [k, v] of Object.entries(items || {})) {
          changes[k] = { oldValue: clone(data()[k]), newValue: clone(v) };
          data()[k] = clone(v);
        }
        await rt.saveStorage(area);
        emit(changes);
      }),
      remove: api(async (keys) => {
        const changes = {};
        for (const k of [].concat(keys)) {
          if (k in data()) {
            changes[k] = { oldValue: data()[k] };
            delete data()[k];
          }
        }
        await rt.saveStorage(area);
        emit(changes);
      }),
      clear: api(async () => {
        const changes = {};
        for (const k of Object.keys(data())) changes[k] = { oldValue: data()[k] };
        rt.storage[area] = {};
        await rt.saveStorage(area);
        emit(changes);
      }),
      getBytesInUse: api(() => JSON.stringify(data()).length),
      getKeys: api(() => Object.keys(data())),
      setAccessLevel: api(() => {}),
      onChanged: changed,
      QUOTA_BYTES: 10485760,
    };
  }

  /* chrome.declarativeNetRequest: rules are stored here and enforced by the service worker (filters.js). */
  function makeDnr(rt) {
    const clone = (v) => JSON.parse(JSON.stringify(v ?? null));
    const pick = (rules, filter) => (filter && Array.isArray(filter.ruleIds) ? rules.filter((r) => filter.ruleIds.includes(r.id)) : rules);
    const update = (key) =>
      api(async (opts = {}) => {
        const remove = new Set(opts.removeRuleIds || []);
        const rules = rt.dnr[key].filter((r) => !remove.has(r.id));
        for (const r of opts.addRules || []) {
          if (rules.some((x) => x.id === r.id)) throw new Error(`Rule with id ${r.id} does not have a unique ID.`);
          rules.push(clone(r));
        }
        rt.dnr[key] = rules;
        if (key === 'dynamic') await rt.saveDnr();
        else BW.filters && BW.filters.rebuild();
      });
    return {
      MAX_NUMBER_OF_DYNAMIC_RULES: 30000,
      MAX_NUMBER_OF_SESSION_RULES: 5000,
      MAX_NUMBER_OF_UNSAFE_DYNAMIC_RULES: 5000,
      MAX_NUMBER_OF_UNSAFE_SESSION_RULES: 5000,
      MAX_NUMBER_OF_REGEX_RULES: 1000,
      MAX_NUMBER_OF_ENABLED_STATIC_RULESETS: 50,
      MAX_NUMBER_OF_STATIC_RULESETS: 100,
      GUARANTEED_MINIMUM_STATIC_RULES: 30000,
      DYNAMIC_RULESET_ID: '_dynamic',
      SESSION_RULESET_ID: '_session',
      ResourceType: { MAIN_FRAME: 'main_frame', SUB_FRAME: 'sub_frame', STYLESHEET: 'stylesheet', SCRIPT: 'script', IMAGE: 'image', FONT: 'font', OBJECT: 'object', XMLHTTPREQUEST: 'xmlhttprequest', PING: 'ping', CSP_REPORT: 'csp_report', MEDIA: 'media', WEBSOCKET: 'websocket', WEBTRANSPORT: 'webtransport', WEBBUNDLE: 'webbundle', OTHER: 'other' },
      RuleActionType: { BLOCK: 'block', REDIRECT: 'redirect', ALLOW: 'allow', UPGRADE_SCHEME: 'upgradeScheme', MODIFY_HEADERS: 'modifyHeaders', ALLOW_ALL_REQUESTS: 'allowAllRequests' },
      updateDynamicRules: update('dynamic'),
      updateSessionRules: update('session'),
      getDynamicRules: api((f) => clone(pick(rt.dnr.dynamic, f))),
      getSessionRules: api((f) => clone(pick(rt.dnr.session, f))),
      getEnabledRulesets: api(() => [...rt.dnr.enabled]),
      updateEnabledRulesets: api(async ({ enableRulesetIds = [], disableRulesetIds = [] } = {}) => {
        disableRulesetIds.forEach((id) => rt.dnr.enabled.delete(id));
        enableRulesetIds.forEach((id) => rt.dnr.enabled.add(id));
        await rt.saveDnr();
      }),
      updateStaticRules: api(() => {}),
      getDisabledRuleIds: api(() => []),
      getAvailableStaticRuleCount: api(() => 300000),
      isRegexSupported: api(({ regex } = {}) => {
        try {
          new RegExp(regex);
          return { isSupported: true };
        } catch {
          return { isSupported: false, reason: 'syntaxError' };
        }
      }),
      setExtensionActionOptions: api(() => {}),
      getMatchedRules: api(() => ({ rulesMatchedInfo: [] })),
      testMatchOutcome: api(() => ({ matchedRules: [] })),
      onRuleMatchedDebug: new ChromeEvent(),
    };
  }

  /* Tabs come from the vertical tab manager (tabs.js). */
  const allTabs = () => (BW.tabs ? BW.tabs.list() : []);
  const activeTab = () => allTabs().find((t) => t.active) || allTabs()[0] || null;
  const tabById = (id) => (id == null || id === -2 ? activeTab() : allTabs().find((t) => t.id === id) || null);

  function tabInfo(id) {
    const tab = tabById(id);
    if (!tab) return { id: -1, index: -1, windowId: 1, active: false, url: '', title: '' };
    const tabs = allTabs();
    return {
      id: tab.id,
      index: tabs.findIndex((t) => t.id === tab.id),
      windowId: 1,
      active: !!tab.active,
      highlighted: !!tab.active,
      selected: !!tab.active,
      pinned: false,
      incognito: false,
      status: BW.loader.isLoading(tab.iframe) ? 'loading' : 'complete',
      url: tab.url || '',
      title: tab.title || '',
      favIconUrl: tab.favicon || '',
    };
  }

  function queryTabs(q = {}) {
    return allTabs()
      .map((t) => tabInfo(t.id))
      .filter((t) => (q.active == null || t.active === q.active) && (!q.url || [].concat(q.url).some((p) => matchPattern(p, t.url))));
  }

  // content-script runtime.onMessage / onConnect listeners, one set per tab
  function contentEvent(rt, kind, tabId) {
    const key = `${kind}:${tabId}`;
    if (!rt.contentEvents.has(key)) rt.contentEvents.set(key, new ChromeEvent());
    return rt.contentEvents.get(key);
  }

  // Deliver a message to a set of listeners with Chrome's sendResponse / return-true / promise semantics.
  function deliver(event, message, sender) {
    return new Promise((resolve) => {
      let responded = false;
      const sendResponse = (r) => {
        if (!responded) {
          responded = true;
          resolve(r);
        }
      };
      let keepOpen = false;
      for (const fn of [...event.listeners]) {
        let r;
        try {
          r = fn(message, sender, sendResponse);
        } catch (e) {
          console.error('[extensions] onMessage error', e);
        }
        if (r === true) keepOpen = true;
        else if (r && typeof r.then === 'function') {
          keepOpen = true;
          r.then(sendResponse, () => sendResponse(undefined));
        }
      }
      if (!keepOpen) setTimeout(() => sendResponse(undefined), 0);
    });
  }

  function makePortPair(name, senderA, senderB) {
    const mk = (sender) => ({
      name,
      sender,
      onMessage: new ChromeEvent(),
      onDisconnect: new ChromeEvent(),
      _peer: null,
      _open: true,
      postMessage(msg) {
        if (!this._open) throw new Error('Attempting to use a disconnected port object');
        const peer = this._peer;
        const data = JSON.parse(JSON.stringify(msg ?? null));
        setTimeout(() => peer._open && peer.onMessage.dispatch(data, peer), 0);
      },
      disconnect() {
        if (!this._open) return;
        this._open = false;
        this._peer._open = false;
        const peer = this._peer;
        setTimeout(() => peer.onDisconnect.dispatch(peer), 0);
      },
    });
    const a = mk(senderB);
    const b = mk(senderA);
    a._peer = b;
    b._peer = a;
    return [a, b];
  }

  function makeChrome(rt, ctx) {
    const isContent = ctx.kind === 'content';
    // Extension pages live under /bw-ext/<id>/, so their "origin" is that folder, the way
    // chrome-extension://<id> is in Chrome. uBlock only answers messages from its own origin.
    const extBase = rt.getURL('').replace(/\/$/, '');
    const originOf = (url) => (!url ? '' : url.startsWith(`${extBase}/`) ? extBase : new URL(url).origin);
    const sender = () => ({ id: rt.id, url: ctx.url || '', origin: originOf(ctx.url), frameId: ctx.frameId || 0, tab: isContent ? tabInfo(ctx.tabId) : undefined });
    const onMessage = isContent ? contentEvent(rt, 'message', ctx.tabId) : rt.events.message;
    const action = {
      setBadgeText: api(({ text }) => {
        rt.badge = text || '';
        updatePinBadge(rt);
        // re-render the list only; never replace an open popup
        const pop = document.getElementById('ext-popover');
        if (pop && !pop.classList.contains('ext-popup')) renderPopover();
      }),
      getBadgeText: api(() => rt.badge),
      setBadgeBackgroundColor: api(() => {}),
      setBadgeTextColor: api(() => {}),
      setIcon: api(() => {}),
      setTitle: api(() => {}),
      getTitle: api(() => rt.manifest.name),
      setPopup: api(({ popup }) => {
        rt.popupOverride = popup;
      }),
      getPopup: api(() => rt.popupOverride ?? popupPath(rt) ?? ''),
      enable: api(() => {}),
      disable: api(() => {}),
      openPopup: api(() => openPopup(rt)),
      onClicked: rt.events.actionClicked,
    };

    const runOnTab = async ({ tabId, func, args, files, code, css, cssFiles }) => {
      const tab = tabById(tabId);
      const win = tab && tab.iframe.contentWindow;
      if (!win) return [];
      if (css || cssFiles) {
        let text = css || '';
        for (const f of cssFiles || []) text += await rt.css(f);
        injectStyle(win.document, text, rt.id);
        return [];
      }
      const results = [];
      if (func) results.push({ frameId: 0, result: runInWindow(win, rt, `return (${func.toString()}).apply(this, ${JSON.stringify(args || [])});`, null, tab.id) });
      if (code) results.push({ frameId: 0, result: runInWindow(win, rt, code, null, tab.id) });
      for (const f of files || []) results.push({ frameId: 0, result: runInWindow(win, rt, (await rt.text(f.replace(/^\//, ''))) || '', null, tab.id) });
      return results;
    };

    const chrome = {
      runtime: {
        id: rt.id,
        lastError: undefined,
        getURL: (p) => rt.getURL(p),
        getManifest: () => JSON.parse(JSON.stringify(rt.manifest)),
        getPlatformInfo: api(() => ({ os: 'win', arch: 'x86-64', nacl_arch: 'x86-64' })),
        sendMessage: api((...args) => {
          const message = typeof args[0] === 'string' && args.length > 1 ? args[1] : args[0];
          return deliver(rt.events.message, message, sender());
        }),
        connect: (...args) => {
          const info = (typeof args[0] === 'string' ? args[1] : args[0]) || {};
          const [mine, theirs] = makePortPair(info.name || '', sender(), { id: rt.id });
          setTimeout(() => rt.events.connect.dispatch(theirs), 0);
          return mine;
        },
        onMessage,
        onMessageExternal: new ChromeEvent(),
        onConnect: isContent ? contentEvent(rt, 'connect', ctx.tabId) : rt.events.connect,
        onConnectExternal: new ChromeEvent(),
        onInstalled: rt.events.installed,
        onStartup: rt.events.startup,
        onSuspend: new ChromeEvent(),
        onUpdateAvailable: new ChromeEvent(),
        openOptionsPage: api(() => openOptions(rt)),
        setUninstallURL: api(() => {}),
        reload: () => BW.extensions.reload(rt.id),
        getBackgroundPage: api(() => rt.background && rt.background.contentWindow),
        getContexts: api(() => []),
        requestUpdateCheck: api(() => ['no_update']),
        PlatformOs: { WIN: 'win', MAC: 'mac', LINUX: 'linux', CROS: 'cros' },
      },
      storage: {
        local: makeStorageArea(rt, 'local'),
        sync: makeStorageArea(rt, 'sync'),
        session: makeStorageArea(rt, 'session'),
        managed: { get: api(() => ({})), onChanged: new ChromeEvent() },
        onChanged: rt.events.storageChanged,
      },
      i18n: {
        getMessage: (n, s, o) => rt.getMessage(n, s, o),
        getUILanguage: () => rt.uiLocale.replace('_', '-'),
        getAcceptLanguages: api(() => [...(navigator.languages || [navigator.language])]),
        detectLanguage: api(() => ({ isReliable: false, languages: [{ language: navigator.language.split('-')[0], percentage: 100 }] })),
      },
      extension: {
        getURL: (p) => rt.getURL(p),
        inIncognitoContext: false,
        getBackgroundPage: () => rt.background && rt.background.contentWindow,
        getViews: () => [],
        isAllowedIncognitoAccess: api(() => false),
        sendMessage: (...a) => chrome.runtime.sendMessage(...a),
        onMessage,
      },
      permissions: {
        contains: api(() => true),
        request: api(() => true),
        remove: api(() => true),
        // blackwaves grants everything an extension asks for, including optional host access
        getAll: api(() => ({
          permissions: [...new Set([...(rt.manifest.permissions || []), ...(rt.manifest.optional_permissions || [])])],
          origins: [...new Set([...(rt.manifest.host_permissions || []), ...(rt.manifest.optional_host_permissions || []), '<all_urls>'])],
        })),
        onAdded: new ChromeEvent(),
        onRemoved: new ChromeEvent(),
      },
      notifications: {
        create: api((id, opts) => {
          if (typeof id === 'object') {
            opts = id;
            id = Math.random().toString(36).slice(2);
          }
          BW.toast(`<b>${BW.esc(opts.title || rt.manifest.name)}</b>&nbsp;${BW.esc(opts.message || '')}`, 'info', 5000);
          return id;
        }),
        clear: api(() => true),
        getAll: api(() => ({})),
        onClicked: new ChromeEvent(),
        onClosed: new ChromeEvent(),
        onButtonClicked: new ChromeEvent(),
      },
      alarms: {
        create: api((name, info) => {
          if (typeof name === 'object') {
            info = name;
            name = '';
          }
          name = name || '';
          clearTimeout(rt.alarms.get(name)?.timer);
          const delay = info.when ? Math.max(0, info.when - Date.now()) : (info.delayInMinutes ?? info.periodInMinutes ?? 0) * 60000;
          const alarm = { name, scheduledTime: Date.now() + delay, periodInMinutes: info.periodInMinutes };
          const fire = () => {
            rt.events.alarm.dispatch({ name: alarm.name, scheduledTime: alarm.scheduledTime, periodInMinutes: alarm.periodInMinutes });
            if (alarm.periodInMinutes) {
              alarm.scheduledTime = Date.now() + alarm.periodInMinutes * 60000;
              alarm.timer = setTimeout(fire, alarm.periodInMinutes * 60000);
            } else rt.alarms.delete(name);
          };
          alarm.timer = setTimeout(fire, delay);
          rt.alarms.set(name, alarm);
        }),
        get: api((name = '') => {
          const a = rt.alarms.get(name);
          return a && { name: a.name, scheduledTime: a.scheduledTime, periodInMinutes: a.periodInMinutes };
        }),
        getAll: api(() => [...rt.alarms.values()].map((a) => ({ name: a.name, scheduledTime: a.scheduledTime, periodInMinutes: a.periodInMinutes }))),
        clear: api((name = '') => {
          clearTimeout(rt.alarms.get(name)?.timer);
          return rt.alarms.delete(name);
        }),
        clearAll: api(() => {
          rt.alarms.forEach((a) => clearTimeout(a.timer));
          rt.alarms.clear();
          return true;
        }),
        onAlarm: rt.events.alarm,
      },
      tabs: {
        TAB_ID_NONE: -1,
        query: api((q) => queryTabs(q)),
        get: api((id) => tabInfo(id)),
        getCurrent: api(() => (isContent ? tabInfo(ctx.tabId) : undefined)),
        create: api(({ url, active }) => {
          const target = url ? (url.startsWith('chrome-extension://') ? url : new URL(url, ctx.url || location.href).href) : null;
          const tab = BW.tabs.open(target, { activate: active !== false });
          return tabInfo(tab.id);
        }),
        update: api((id, props) => {
          if (typeof id === 'object') {
            props = id;
            id = undefined;
          }
          const tab = tabById(id);
          if (tab && props && props.url) BW.tabs.navigate(tab.id, props.url);
          if (tab && props && props.active) BW.tabs.activate(tab.id);
          return tabInfo(tab && tab.id);
        }),
        reload: api((id) => {
          const tab = tabById(typeof id === 'number' ? id : undefined);
          if (tab) tab.iframe.contentWindow.location.reload();
        }),
        remove: api((ids) => [].concat(ids).forEach((id) => BW.tabs.close(id))),
        sendMessage: api((tabId, message) => deliver(contentEvent(rt, 'message', tabId), message, { id: rt.id })),
        connect: (tabId, info = {}) => {
          const [mine, theirs] = makePortPair(info.name || '', { id: rt.id }, { id: rt.id, tab: tabInfo(tabId) });
          setTimeout(() => contentEvent(rt, 'connect', tabId).dispatch(theirs), 0);
          return mine;
        },
        executeScript: api((tabId, details) => {
          if (typeof tabId === 'object') {
            details = tabId;
            tabId = undefined;
          }
          return runOnTab(Object.assign({ tabId }, details)).then((r) => r.map((x) => x.result));
        }),
        insertCSS: api((tabId, details) => {
          if (typeof tabId === 'object') {
            details = tabId;
            tabId = undefined;
          }
          return runOnTab({ tabId, css: details.code, cssFiles: details.file ? [details.file] : [] });
        }),
        captureVisibleTab: api(() => ''),
        onUpdated: rt.events.tabUpdated,
        onActivated: new ChromeEvent(),
        onCreated: new ChromeEvent(),
        onRemoved: new ChromeEvent(),
        onReplaced: new ChromeEvent(),
      },
      scripting: {
        executeScript: api((d) => runOnTab({ tabId: d.target && d.target.tabId, func: d.func || d.function, args: d.args, files: d.files })),
        insertCSS: api((d) => runOnTab({ tabId: d.target && d.target.tabId, css: d.css, cssFiles: d.files })),
        removeCSS: api(() => {}),
        registerContentScripts: api(async (scripts) => {
          for (const sc of scripts || []) {
            if (rt.registeredScripts.some((x) => x.id === sc.id)) throw new Error(`Duplicate script ID '${sc.id}'`);
            rt.registeredScripts.push(Object.assign({ kind: 'content' }, sc));
          }
          await rt.saveScripts();
        }),
        updateContentScripts: api(async (scripts) => {
          for (const sc of scripts || []) {
            const i = rt.registeredScripts.findIndex((x) => x.id === sc.id);
            if (i >= 0) rt.registeredScripts[i] = Object.assign({}, rt.registeredScripts[i], sc);
          }
          await rt.saveScripts();
        }),
        unregisterContentScripts: api(async (filter) => {
          const ids = filter && filter.ids;
          rt.registeredScripts = rt.registeredScripts.filter((x) => x.kind !== 'content' || (ids && !ids.includes(x.id)));
          await rt.saveScripts();
        }),
        getRegisteredContentScripts: api((filter) =>
          rt.registeredScripts.filter((x) => x.kind === 'content' && (!filter || !filter.ids || filter.ids.includes(x.id))).map(({ kind, ...x }) => x)
        ),
      },
      userScripts: {
        register: api(async (scripts) => {
          for (const sc of scripts || []) {
            rt.registeredScripts = rt.registeredScripts.filter((x) => !(x.kind === 'user' && x.id === sc.id));
            rt.registeredScripts.push(Object.assign({ kind: 'user' }, sc));
          }
          await rt.saveScripts();
        }),
        update: api(async (scripts) => {
          for (const sc of scripts || []) {
            const i = rt.registeredScripts.findIndex((x) => x.kind === 'user' && x.id === sc.id);
            if (i >= 0) rt.registeredScripts[i] = Object.assign({}, rt.registeredScripts[i], sc);
          }
          await rt.saveScripts();
        }),
        unregister: api(async (filter) => {
          const ids = filter && filter.ids;
          rt.registeredScripts = rt.registeredScripts.filter((x) => x.kind !== 'user' || (ids && !ids.includes(x.id)));
          await rt.saveScripts();
        }),
        getScripts: api((filter) =>
          rt.registeredScripts.filter((x) => x.kind === 'user' && (!filter || !filter.ids || filter.ids.includes(x.id))).map(({ kind, ...x }) => x)
        ),
        configureWorld: api(() => {}),
        getWorldConfigurations: api(() => []),
        resetWorldConfiguration: api(() => {}),
      },
      windows: {
        WINDOW_ID_CURRENT: -2,
        getCurrent: api(() => ({ id: 1, focused: true, type: 'normal', state: 'normal' })),
        getAll: api(() => [{ id: 1, focused: true, type: 'normal', state: 'normal' }]),
        create: api(({ url }) => url && BW.tabs.open([].concat(url)[0])),
        onFocusChanged: new ChromeEvent(),
      },
      contextMenus: {
        create: () => 0,
        update: api(() => {}),
        remove: api(() => {}),
        removeAll: api(() => {}),
        onClicked: rt.events.menuClicked,
      },
      webRequest: { onBeforeRequest: new ChromeEvent(), onBeforeSendHeaders: new ChromeEvent(), onHeadersReceived: new ChromeEvent(), onCompleted: new ChromeEvent(), onErrorOccurred: new ChromeEvent() },
      declarativeNetRequest: makeDnr(rt),
      webNavigation: { onCommitted: new ChromeEvent(), onCompleted: new ChromeEvent(), onDOMContentLoaded: new ChromeEvent(), onHistoryStateUpdated: new ChromeEvent(), onBeforeNavigate: new ChromeEvent() },
      commands: { getAll: api(() => []), onCommand: new ChromeEvent() },
      offscreen: { createDocument: api(() => {}), closeDocument: api(() => {}), hasDocument: api(() => false) },
      sidePanel: { setOptions: api(() => {}), setPanelBehavior: api(() => {}), open: api(() => {}) },
      action,
      browserAction: action,
      pageAction: action,
    };
    // Content scripts only get the subset Chrome exposes to them.
    if (isContent) {
      return {
        runtime: (({ id, getURL, getManifest, sendMessage, connect, onMessage, onConnect, lastError }) => ({ id, getURL, getManifest, sendMessage, connect, onMessage, onConnect, lastError }))(chrome.runtime),
        storage: chrome.storage,
        i18n: chrome.i18n,
        extension: { getURL: chrome.extension.getURL, inIncognitoContext: false },
      };
    }
    return chrome;
  }

  /* ================================================================ */
  /* Running code in proxied windows                                   */
  /* ================================================================ */
  function currentUrl(win) {
    try {
      return BW.proxy.decode(win.location.href);
    } catch {
      return '';
    }
  }

  // Use the frame realm's Function so each engine's own JS hooks apply to extension code.
  function runInWindow(win, rt, code, chromeObj, tabId) {
    chromeObj = chromeObj || makeChrome(rt, { kind: 'content', tabId, url: currentUrl(win), frameId: win === win.top ? 0 : 1 });
    try {
      const fn = new win.Function('chrome', 'browser', `${code}\n//# sourceURL=bw-extension://${rt ? rt.id : 'builtin'}/script.js`);
      return fn.call(win, chromeObj, chromeObj);
    } catch (e) {
      console.warn(`[extensions] ${rt ? rt.manifest.name : 'script'} failed:`, e);
    }
  }

  function injectStyle(doc, css, owner) {
    const style = doc.createElement('style');
    style.dataset.bwExtension = owner;
    style.textContent = css;
    (doc.head || doc.documentElement).appendChild(style);
  }

  function whenReady(win, runAt, fn) {
    const doc = win.document;
    if (runAt === 'document_start') return fn();
    if (runAt === 'document_end') {
      if (doc.readyState !== 'loading') fn();
      else doc.addEventListener('DOMContentLoaded', fn, { once: true });
      return;
    }
    if (doc.readyState === 'complete') setTimeout(fn, 0);
    else win.addEventListener('load', () => setTimeout(fn, 0), { once: true });
  }

  function normalizeCS(cs) {
    return {
      matches: cs.matches || [],
      exclude_matches: cs.exclude_matches || cs.excludeMatches || [],
      include_globs: cs.include_globs || cs.includeGlobs || [],
      exclude_globs: cs.exclude_globs || cs.excludeGlobs || [],
      js: cs.js || [],
      css: cs.css || [],
      run_at: cs.run_at || cs.runAt || 'document_idle',
      all_frames: !!(cs.all_frames || cs.allFrames),
      world: cs.world || 'ISOLATED',
    };
  }

  function injectDocument(win, isTop, tabId) {
    let doc;
    try {
      doc = win.document;
    } catch {
      return;
    }
    if (!doc || win.__bwExtDoc === doc) return;
    const url = currentUrl(win);
    if (!/^https?:/.test(url)) return;
    win.__bwExtDoc = doc;

    for (const b of BUILTINS) {
      if (!b.alwaysOn && !BW.settings.get('builtinExtensions').includes(b.id)) continue;
      if (!isTop && !b.allFrames) continue;
      if (isTop && b.framesOnly) continue;
      if (b.matches && !b.matches.some((p) => matchPattern(p, url))) continue;
      whenReady(win, b.runAt || 'document_end', () => {
        try {
          b.run(win, doc, url);
        } catch (e) {
          console.warn(`[extensions] ${b.name} failed`, e);
        }
      });
    }

    for (const rt of runtimes.values()) {
      if (!rt.record.enabled) continue;
      const scripts = (rt.manifest.content_scripts || []).concat(rt.registeredScripts).map(normalizeCS);
      const chromeObj = makeChrome(rt, { kind: 'content', tabId, url, frameId: isTop ? 0 : 1 });
      for (const cs of scripts) {
        if (!isTop && !cs.all_frames) continue;
        if (!urlMatchesContentScript(url, cs)) continue;
        whenReady(win, cs.run_at, async () => {
          for (const f of cs.css) injectStyle(doc, await rt.css(f), rt.id);
          // js entries are file paths (manifest / scripting API) or {file}/{code} (userScripts API)
          for (const f of cs.js) {
            const code = typeof f === 'string' ? await rt.text(f.replace(/^\//, '')) : f.code != null ? f.code : await rt.text(String(f.file || '').replace(/^\//, ''));
            if (code != null && win.document === doc) runInWindow(win, rt, code, chromeObj);
          }
        });
      }
    }

    watchChildFrames(win, doc, tabId);

    if (isTop) {
      for (const rt of runtimes.values()) {
        if (rt.record.enabled) rt.events.tabUpdated.dispatch(tabId, { status: 'complete', url }, tabInfo(tabId));
      }
    }
  }

  // Catch nested frames the moment their new document exists, so document_start code (and the
  // embed fix) runs before the framed page's own scripts. Polls briefly after an iframe is added,
  // its src changes, or it loads.
  function watchChildFrames(win, doc, tabId) {
    const hook = (iframe) => {
      if (iframe.__bwWatched) return;
      iframe.__bwWatched = true;
      let timer = null;
      const burst = () => {
        clearInterval(timer);
        let n = 0;
        timer = setInterval(() => {
          n++;
          try {
            const cw = iframe.contentWindow;
            if (cw && cw.location.origin === location.origin && cw.location.href !== 'about:blank') {
              scanFrames(cw, false, tabId);
              if (cw.__bwExtDoc === cw.document) clearInterval(timer);
            }
          } catch {}
          if (n > 500 || !iframe.isConnected) clearInterval(timer);
        }, 20);
      };
      burst();
      iframe.addEventListener('load', burst);
      try {
        new win.MutationObserver(burst).observe(iframe, { attributes: true, attributeFilter: ['src'] });
      } catch {}
    };
    try {
      doc.querySelectorAll('iframe').forEach(hook);
      new win.MutationObserver((muts) => {
        for (const m of muts) {
          for (const node of m.addedNodes) {
            if (node.nodeType !== 1) continue;
            if (node.tagName === 'IFRAME') hook(node);
            else if (node.querySelectorAll) node.querySelectorAll('iframe').forEach(hook);
          }
        }
      }).observe(doc.documentElement || doc, { childList: true, subtree: true });
    } catch {}
  }

  function scanFrames(win, isTop, tabId) {
    injectDocument(win, isTop, tabId);
    let frames;
    try {
      frames = win.frames;
    } catch {
      return;
    }
    for (let i = 0; i < frames.length; i++) {
      try {
        if (frames[i].location.origin === location.origin) scanFrames(frames[i], false, tabId);
      } catch {}
    }
  }

  /** Attach the extension engine to a tab's proxied iframe. */
  function attachFrame(iframe, tabId) {
    let poll = null;
    const tick = () => {
      if (!iframe.isConnected) return clearInterval(poll);
      try {
        const win = iframe.contentWindow;
        if (win && win.document && win.location.href !== 'about:blank') scanFrames(win, true, tabId);
      } catch {}
    };
    iframe.addEventListener('load', () => {
      tick();
      clearInterval(poll);
      // keep catching nested frames and new documents
      poll = setInterval(tick, 1000);
      try {
        // catch the next document as early as possible for document_start scripts
        iframe.contentWindow.addEventListener('beforeunload', () => {
          let n = 0;
          const fast = setInterval(() => {
            tick();
            if (++n > 200) clearInterval(fast);
            try {
              if (iframe.contentWindow.__bwExtDoc === iframe.contentWindow.document) clearInterval(fast);
            } catch {}
          }, 25);
        });
      } catch {}
    });
  }

  /* ================================================================ */
  /* Extension pages: background, popup, options                       */
  /* ================================================================ */
  function popupPath(rt) {
    const a = rt.manifest.action || rt.manifest.browser_action || rt.manifest.page_action || {};
    return rt.popupOverride ?? a.default_popup ?? null;
  }

  // Extension pages load straight from /bw-ext/<id>/<page>.html. The service worker injects
  // /assets/js/ext-shim.js at the top of every extension HTML page, which installs chrome.*.
  async function startBackground(rt) {
    const bg = rt.manifest.background;
    if (!bg) return;
    const frame = document.createElement('iframe');
    frame.hidden = true;
    frame.dataset.bwBackground = rt.id;
    frame.src = rt.getURL('__bw_background__.html');
    document.body.appendChild(frame);
    rt.background = frame;
    frame.addEventListener('load', () => {
      setTimeout(() => {
        if (!rt.record.startedOnce) {
          rt.record.startedOnce = true;
          idb('extensions', 'readwrite', (s) => s.put(rt.record)).catch(() => {});
          rt.events.installed.dispatch({ reason: 'install' });
        } else rt.events.startup.dispatch();
      }, 300);
    }, { once: true });
  }

  function stopBackground(rt) {
    if (rt.background) rt.background.remove();
    rt.background = null;
    rt.alarms.forEach((a) => clearTimeout(a.timer));
    rt.alarms.clear();
  }

  // Popups size themselves to their content like Chrome's (25x25 up to 800x600).
  function fitPopup(frame) {
    let observer;
    const fit = () => {
      try {
        const doc = frame.contentDocument;
        if (!doc || !doc.body) return;
        frame.style.width = '25px';
        frame.style.height = '25px';
        const w = Math.max(doc.documentElement.scrollWidth, doc.body.scrollWidth);
        const h = Math.max(doc.documentElement.scrollHeight, doc.body.scrollHeight);
        frame.style.width = `${Math.min(800, Math.max(25, w))}px`;
        frame.style.height = `${Math.min(600, Math.max(25, h))}px`;
      } catch {}
    };
    frame.addEventListener('load', () => {
      fit();
      try {
        observer = new frame.contentWindow.ResizeObserver(() => requestAnimationFrame(fit));
        observer.observe(frame.contentDocument.body);
      } catch {}
      // late-rendering popups (uBlock fills itself in after a message round trip)
      setTimeout(fit, 150);
      setTimeout(fit, 600);
    });
  }

  function openPanel(rt, path, title, anchor) {
    const popover = document.getElementById('ext-popover');
    popover.hidden = false;
    placePopover(anchor);
    const ip = iconPath(rt.manifest);
    popover.classList.add('ext-popup');
    popover.dataset.owner = rt.id;
    popover.innerHTML = `<div class="ext-panel-head"><button class="icon-btn small" data-act="back" aria-label="All extensions"><i class="fa-solid fa-arrow-left"></i></button>${ip ? `<img class="ext-head-icon" src="${rt.getURL(ip)}" alt="">` : ''}<span class="ext-head-title">${BW.esc(title)}</span>${hasOptions(rt) ? '<button class="icon-btn small" data-act="options" aria-label="Options"><i class="fa-solid fa-gear"></i></button>' : ''}</div><iframe class="ext-panel-frame"></iframe>`;
    const frame = popover.querySelector('iframe');
    fitPopup(frame);
    frame.src = rt.getURL(String(path).replace(/^\//, ''));
    popover.querySelector('[data-act="back"]').onclick = () => renderPopover();
    const opt = popover.querySelector('[data-act="options"]');
    if (opt) opt.onclick = () => openOptions(rt);
  }
  const openPopup = (rt, anchor) => {
    const p = popupPath(rt);
    if (p) openPanel(rt, p, rt.manifest.name, anchor);
    else {
      document.getElementById('ext-popover').hidden = true;
      rt.events.actionClicked.dispatch(tabInfo());
    }
  };

  const optionsPath = (rt) => (rt.manifest.options_ui && rt.manifest.options_ui.page) || rt.manifest.options_page || null;
  const hasOptions = (rt) => !!optionsPath(rt);

  // Options pages and dashboards are full pages, so they get a large window of their own instead
  // of the toolbar popover (Chrome opens them in a tab or a dialog).
  function openOptions(rt) {
    const p = optionsPath(rt);
    if (!p) return;
    document.getElementById('ext-popover').hidden = true;
    document.getElementById('ext-page')?.remove();
    const ip = iconPath(rt.manifest);
    const wrap = document.createElement('div');
    wrap.id = 'ext-page';
    wrap.className = 'ext-page-overlay';
    wrap.innerHTML = `<div class="ext-page" role="dialog" aria-modal="true" aria-label="${BW.esc(rt.manifest.name)} options">
        <div class="ext-page-head">
          ${ip ? `<img src="${rt.getURL(ip)}" alt="">` : '<i class="fa-solid fa-puzzle-piece"></i>'}
          <span class="ext-page-title">${BW.esc(rt.manifest.name)}</span>
          <span class="ext-page-sub">options</span>
          <button class="icon-btn small" data-act="reload" aria-label="Reload"><i class="fa-solid fa-rotate-right"></i></button>
          <button class="icon-btn small" data-act="close" aria-label="Close"><i class="fa-solid fa-xmark"></i></button>
        </div>
        <iframe class="ext-page-frame" src="${rt.getURL(String(p).replace(/^\//, ''))}"></iframe>
      </div>`;
    const close = () => {
      wrap.classList.remove('visible');
      document.removeEventListener('keydown', onKey, true);
      setTimeout(() => wrap.remove(), 150);
    };
    const onKey = (e) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        close();
      }
    };
    wrap.addEventListener('click', (e) => {
      if (e.target === wrap || e.target.closest('[data-act="close"]')) close();
      else if (e.target.closest('[data-act="reload"]')) wrap.querySelector('iframe').contentWindow.location.reload();
    });
    document.addEventListener('keydown', onKey, true);
    document.body.appendChild(wrap);
    requestAnimationFrame(() => wrap.classList.add('visible'));
  }

  // Line the popover up under the toolbar button that opened it.
  function placePopover(anchor) {
    const pop = document.getElementById('ext-popover');
    const btn = anchor || document.getElementById('nav-extensions');
    const host = pop.offsetParent || pop.parentElement;
    if (!btn || !host || !btn.offsetParent) return pop.style.removeProperty('right');
    const b = btn.getBoundingClientRect();
    const h = host.getBoundingClientRect();
    pop.style.right = `${Math.max(8, h.right - b.right)}px`;
  }

  /* ================================================================ */
  /* Built-in extensions                                               */
  /* ================================================================ */
  const AD_HOSTS = /(doubleclick\.net|googlesyndication\.com|googleadservices\.com|adservice\.google|amazon-adsystem\.com|adnxs\.com|taboola\.com|outbrain\.com|criteo\.(com|net)|popads\.net|propellerads|adsterra|exoclick|mgid\.com|revcontent|zedo\.com|pubmatic\.com|rubiconproject\.com|openx\.net|media\.net|yieldmo|33across)/i;
  const AD_SELECTORS = ['ins.adsbygoogle', '[id^="google_ads_"]', '[id^="div-gpt-ad"]', '[data-ad-slot]', '[data-ad-client]', '.adsbygoogle', '.ad-container', '.ad-slot', '.ad-banner', '.advertisement', '.sponsored-ad', '.taboola', '#taboola-below-article', '.OUTBRAIN', '[class*="AdSlot"]', 'iframe[src*="doubleclick"]', 'iframe[src*="googlesyndication"]', 'iframe[id^="google_ads_iframe"]'];
  const COOKIE_SELECTORS = ['#onetrust-banner-sdk', '#onetrust-consent-sdk', '.onetrust-pc-dark-filter', '#CybotCookiebotDialog', '#CybotCookiebotDialogBodyUnderlay', '.fc-consent-root', '.qc-cmp2-container', '[id^="sp_message_container"]', '.truste_overlay', '.truste_box_overlay', '#truste-consent-track', '.cc-window', '.cookie-banner', '.cookie-consent', '#cookie-banner', '#cookie-consent', '#cookieConsent', '.cmp-container', '#didomi-host', '.osano-cm-window', '#usercentrics-root', '.evidon-banner', '#gdpr-consent-tool-wrapper', 'tp-yt-paper-dialog.ytd-consent-bump-v2-lightbox'];

  const BUILTINS = [
    {
      // Always on, not listed: makes blob:/data: downloads inside proxied pages save to the computer.
      id: 'downloads',
      name: 'Downloads',
      hidden: true,
      alwaysOn: true,
      allFrames: true,
      runAt: 'document_start',
      run(win) {
        BW.downloads && BW.downloads.hookWindow(win);
      },
    },
    {
      // Always on, not listed in settings. Movie/TV embed players (VidLink, vidsrc, ...) refuse to play
      // when they think they're in a sandboxed iframe. One of their tests embeds a data: PDF in an
      // <object> and treats onerror as "sandboxed"; that object never loads inside a proxied frame,
      // so they show "Please Disable Sandbox". Hide the PDF plugin from framed pages so the test is
      // skipped, and make `document.domain = document.domain` never throw.
      id: 'embedfix',
      name: 'Embed sandbox fix',
      hidden: true,
      alwaysOn: true,
      framesOnly: true,
      allFrames: true,
      runAt: 'document_start',
      run(win) {
        try {
          const plugins = win.navigator.plugins;
          const named = plugins.namedItem.bind(plugins);
          Object.defineProperty(plugins, 'namedItem', { configurable: true, value: (name) => (/pdf/i.test(String(name)) ? null : named(name)) });
        } catch {}
        try {
          const desc = Object.getOwnPropertyDescriptor(win.Document.prototype, 'domain');
          if (desc && desc.get && desc.set) {
            Object.defineProperty(win.document, 'domain', {
              configurable: true,
              get() {
                return desc.get.call(this);
              },
              set(value) {
                try {
                  desc.set.call(this, value);
                } catch {}
              },
            });
          }
        } catch {}
      },
    },
    {
      id: 'adshield',
      name: 'Ad Shield',
      icon: 'fa-solid fa-shield-halved',
      description: 'Hides common ad slots, strips ad network frames and blocks pop-unders.',
      runAt: 'document_start',
      allFrames: false,
      run(win, doc) {
        const css = `${AD_SELECTORS.join(',')}{display:none!important;visibility:hidden!important;height:0!important;min-height:0!important}`;
        const add = () => injectStyle(doc, css, 'adshield');
        doc.head || doc.documentElement ? add() : doc.addEventListener('DOMContentLoaded', add, { once: true });
        const sweep = (root) => {
          root.querySelectorAll && root.querySelectorAll('iframe,script[src]').forEach((el) => {
            const src = el.getAttribute('src') || '';
            if (AD_HOSTS.test(BW.proxy.decode(src)) || AD_HOSTS.test(src)) el.remove();
          });
        };
        new win.MutationObserver((muts) => muts.forEach((m) => m.addedNodes.forEach((n) => n.nodeType === 1 && (sweep(n), n.tagName === 'IFRAME' && sweep(n.parentNode || n))))).observe(doc.documentElement, { childList: true, subtree: true });
        const open = win.open;
        win.open = function (...args) {
          if (win.navigator.userActivation && !win.navigator.userActivation.isActive) return null;
          return open.apply(this, args);
        };
      },
    },
    {
      id: 'ytadskip',
      name: 'YouTube Ad Skipper',
      icon: 'fa-brands fa-youtube',
      description: 'Clicks "Skip" for you and fast-forwards unskippable YouTube ads.',
      matches: ['*://*.youtube.com/*'],
      runAt: 'document_end',
      run(win, doc) {
        win.setInterval(() => {
          const skip = doc.querySelector('.ytp-skip-ad-button, .ytp-ad-skip-button, .ytp-ad-skip-button-modern');
          if (skip) skip.click();
          const player = doc.querySelector('.html5-video-player');
          const video = doc.querySelector('video');
          if (player && video && player.classList.contains('ad-showing')) {
            video.muted = true;
            if (isFinite(video.duration)) video.currentTime = Math.max(video.currentTime, video.duration - 0.1);
          }
          doc.querySelectorAll('ytd-ad-slot-renderer, ytd-in-feed-ad-layout-renderer, #player-ads, ytd-promoted-sparkles-web-renderer').forEach((el) => el.remove());
        }, 400);
      },
    },
    {
      id: 'cookies',
      name: 'Cookie Banner Remover',
      icon: 'fa-solid fa-cookie-bite',
      description: 'Hides consent pop-ups and unlocks page scrolling.',
      runAt: 'document_end',
      run(win, doc) {
        injectStyle(doc, `${COOKIE_SELECTORS.join(',')}{display:none!important}`, 'cookies');
        const unlock = () => {
          for (const el of [doc.documentElement, doc.body]) {
            if (el && win.getComputedStyle(el).overflow === 'hidden') el.style.setProperty('overflow', 'auto', 'important');
          }
        };
        unlock();
        win.setTimeout(unlock, 1500);
        win.setTimeout(unlock, 4000);
      },
    },
    {
      id: 'darkmode',
      name: 'Dark Mode Everywhere',
      icon: 'fa-solid fa-moon',
      description: 'Inverts bright pages into a dark look while keeping images natural.',
      runAt: 'document_idle',
      run(win, doc) {
        const bg = win.getComputedStyle(doc.body || doc.documentElement).backgroundColor;
        const m = bg.match(/\d+(\.\d+)?/g);
        const transparent = !m || (m.length === 4 && +m[3] === 0);
        const lum = m ? (0.2126 * m[0] + 0.7152 * m[1] + 0.0722 * m[2]) / 255 : 1;
        if (!transparent && lum < 0.5) return;
        injectStyle(doc, 'html{filter:invert(.92) hue-rotate(180deg)!important;background:#fff!important}img,video,picture,canvas,iframe,embed,object,svg image,[style*="background-image"]{filter:invert(1) hue-rotate(180deg)!important}', 'darkmode');
      },
    },
    {
      id: 'videospeed',
      name: 'Video Speed Controller',
      icon: 'fa-solid fa-gauge-high',
      description: 'Press S / D to slow down or speed up videos, R to reset.',
      runAt: 'document_end',
      allFrames: true,
      run(win, doc) {
        let badge;
        const show = (rate) => {
          if (!badge) {
            badge = doc.createElement('div');
            badge.style.cssText = 'position:fixed;top:12px;left:12px;z-index:2147483647;background:rgba(0,0,0,.75);color:#fff;font:14px sans-serif;padding:6px 10px;border-radius:8px;pointer-events:none;transition:opacity .3s';
            doc.documentElement.appendChild(badge);
          }
          badge.textContent = `${rate.toFixed(2)}x`;
          badge.style.opacity = '1';
          clearTimeout(badge.t);
          badge.t = setTimeout(() => (badge.style.opacity = '0'), 900);
        };
        doc.addEventListener('keydown', (e) => {
          if (/INPUT|TEXTAREA|SELECT/.test(e.target.tagName) || e.target.isContentEditable || e.ctrlKey || e.metaKey || e.altKey) return;
          const videos = [...doc.querySelectorAll('video')];
          if (!videos.length) return;
          const k = e.key.toLowerCase();
          if (!['s', 'd', 'r'].includes(k)) return;
          for (const v of videos) {
            v.playbackRate = k === 'r' ? 1 : Math.min(16, Math.max(0.1, +(v.playbackRate + (k === 'd' ? 0.25 : -0.25)).toFixed(2)));
          }
          show(videos[0].playbackRate);
        }, true);
      },
    },
    {
      id: 'pip',
      name: 'Picture-in-Picture',
      icon: 'fa-solid fa-clone',
      description: 'Press Alt+P to pop the biggest video on the page into its own window.',
      runAt: 'document_end',
      run(win, doc) {
        doc.addEventListener('keydown', async (e) => {
          if (!(e.altKey && e.key.toLowerCase() === 'p')) return;
          const v = [...doc.querySelectorAll('video')].sort((a, b) => b.clientWidth * b.clientHeight - a.clientWidth * a.clientHeight)[0];
          if (!v) return;
          try {
            doc.pictureInPictureElement ? await doc.exitPictureInPicture() : await v.requestPictureInPicture();
          } catch {}
        });
      },
    },
    {
      id: 'antitrack',
      name: 'Tracker Blocker',
      icon: 'fa-solid fa-user-shield',
      description: 'Stubs common analytics beacons (Google Analytics, Meta Pixel, sendBeacon).',
      runAt: 'document_start',
      run(win) {
        try {
          win.navigator.sendBeacon = () => true;
        } catch {}
        const noop = function () {};
        for (const name of ['ga', 'gtag', 'fbq', '_paq', 'mixpanel', 'amplitude', 'hj', 'clarity']) {
          try {
            Object.defineProperty(win, name, { configurable: true, get: () => noop, set: () => {} });
          } catch {}
        }
      },
    },
  ];

  /* ================================================================ */
  /* Install / manage                                                  */
  /* ================================================================ */
  async function loadJSZip() {
    if (!window.JSZip) await BW.loadScript('https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js');
    return window.JSZip;
  }

  function localizeManifest(manifest, rt) {
    const visit = (v) => {
      if (typeof v === 'string') return v.replace(/__MSG_([A-Za-z0-9_@]+)__/g, (m, n) => rt.getMessage(n) || m);
      if (Array.isArray(v)) return v.map(visit);
      if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, visit(x)]));
      return v;
    };
    return visit(manifest);
  }

  function iconPath(manifest) {
    const icons = manifest.icons || (manifest.action || manifest.browser_action || {}).default_icon;
    if (!icons) return null;
    if (typeof icons === 'string') return icons;
    const sizes = Object.keys(icons).map(Number).sort((a, b) => a - b);
    return icons[sizes.find((s) => s >= 32) || sizes[sizes.length - 1]];
  }

  function parseUserscript(code, fileName) {
    const block = code.match(/\/\/\s*==UserScript==([\s\S]*?)\/\/\s*==\/UserScript==/);
    const meta = { name: [], match: [], include: [], exclude: [], 'run-at': [], description: [], version: [], grant: [] };
    if (block) {
      for (const line of block[1].split('\n')) {
        const m = line.match(/\/\/\s*@([\w-]+)\s+(.+)/);
        if (m && meta[m[1]]) meta[m[1]].push(m[2].trim());
      }
    }
    const toPattern = (inc) => (inc === '*' ? '<all_urls>' : inc);
    const runAt = { 'document-start': 'document_start', 'document-end': 'document_end', 'document-idle': 'document_idle' }[meta['run-at'][0]] || 'document_idle';
    const gm = `const GM_info={script:{name:${JSON.stringify(meta.name[0] || fileName)},version:${JSON.stringify(meta.version[0] || '1.0')}}};
const __s=chrome.storage.local;let __cache={};
const GM_addStyle=(css)=>{const s=document.createElement('style');s.textContent=css;(document.head||document.documentElement).appendChild(s);return s;};
const GM_getValue=(k,d)=>k in __cache?__cache[k]:d;
const GM_setValue=(k,v)=>{__cache[k]=v;__s.set({[k]:v});};
const GM_deleteValue=(k)=>{delete __cache[k];__s.remove(k);};
const GM_listValues=()=>Object.keys(__cache);
const GM_openInTab=(u)=>window.open(u,'_blank');
const GM_setClipboard=(t)=>navigator.clipboard&&navigator.clipboard.writeText(t);
const GM_xmlhttpRequest=(o)=>{fetch(o.url,{method:o.method||'GET',headers:o.headers,body:o.data}).then(async r=>{const t=await r.text();o.onload&&o.onload({status:r.status,responseText:t,response:t,finalUrl:r.url});}).catch(e=>o.onerror&&o.onerror(e));};
const GM={getValue:async(k,d)=>GM_getValue(k,d),setValue:async(k,v)=>GM_setValue(k,v),deleteValue:async(k)=>GM_deleteValue(k),addStyle:GM_addStyle,xmlHttpRequest:GM_xmlhttpRequest,openInTab:GM_openInTab,info:GM_info};
const unsafeWindow=window;
__s.get(null,(all)=>{__cache=all||{};(function(){\n${code}\n}).call(window);});`;
    const matches = meta.match.concat(meta.include.map(toPattern)).filter((p) => compilePattern(p));
    return {
      manifest: {
        manifest_version: 3,
        name: meta.name[0] || fileName.replace(/\.user\.js$|\.js$/, ''),
        version: meta.version[0] || '1.0',
        description: meta.description[0] || 'Userscript',
        content_scripts: [{ matches: matches.length ? matches : ['<all_urls>'], exclude_matches: meta.exclude.filter((p) => compilePattern(p)), js: ['userscript.js'], run_at: runAt }],
      },
      files: { 'userscript.js': new Blob([gm], { type: 'text/javascript' }) },
      type: 'userscript',
    };
  }

  async function filesFromZip(buffer) {
    const JSZip = await loadJSZip();
    const zip = await JSZip.loadAsync(buffer);
    const files = {};
    const entries = Object.values(zip.files).filter((f) => !f.dir);
    await Promise.all(entries.map(async (f) => (files[f.name] = await f.async('blob'))));
    // Some zips wrap everything in one top-level folder
    if (!files['manifest.json']) {
      const m = Object.keys(files).find((p) => /^[^/]+\/manifest\.json$/.test(p));
      if (m) {
        const prefix = m.slice(0, m.indexOf('/') + 1);
        for (const k of Object.keys(files)) {
          if (k.startsWith(prefix)) {
            files[k.slice(prefix.length)] = files[k];
            delete files[k];
          }
        }
      }
    }
    return files;
  }

  async function install(input) {
    let files;
    let crxId = null;
    let type = 'extension';
    let manifest;
    if (Array.isArray(input)) {
      // unpacked folder (webkitdirectory FileList)
      files = {};
      const root = input[0].webkitRelativePath.split('/')[0] + '/';
      for (const f of input) files[f.webkitRelativePath.startsWith(root) ? f.webkitRelativePath.slice(root.length) : f.webkitRelativePath] = f;
    } else if (/\.(user\.)?js$/i.test(input.name)) {
      const us = parseUserscript(await input.text(), input.name);
      files = us.files;
      manifest = us.manifest;
      type = us.type;
    } else {
      const parsed = parseCrx(await input.arrayBuffer());
      crxId = parsed.crxId;
      files = await filesFromZip(parsed.zip);
    }
    if (!manifest) {
      if (!files['manifest.json']) throw new Error('No manifest.json found');
      manifest = JSON.parse((await files['manifest.json'].text()).replace(/^﻿/, ''));
    }
    const id = crxId || (manifest.key ? await idFromKey(manifest.key) : await idFromSeed(`${manifest.name}@${type}`));
    const record = { id, manifest, files, enabled: true, type, installedAt: Date.now() };
    const rt = new Runtime(record);
    await rt.load();
    record.manifest = localizeManifest(manifest, rt);
    record.name = record.manifest.name;
    if (runtimes.has(id)) stopBackground(runtimes.get(id));
    await idb('extensions', 'readwrite', (s) => s.put(record));
    const live = new Runtime(record);
    await live.load();
    runtimes.set(id, live);
    startBackground(live);
    BW.emitChange('extensions');
    return record;
  }

  async function remove(id, silent) {
    const rt = runtimes.get(id);
    if (rt) {
      stopBackground(rt);
    }
    runtimes.delete(id);
    if (isPinned(id)) setPinned(id, false);
    await idb('extensions', 'readwrite', (s) => s.delete(id));
    await idb('storage', 'readwrite', (s) => {
      s.delete(`${id}:local`);
      return s.delete(`${id}:sync`);
    });
    if (!silent) BW.emitChange('extensions');
  }

  async function setEnabled(id, enabled, silent) {
    const rt = runtimes.get(id);
    if (!rt) return;
    rt.record.enabled = enabled;
    await idb('extensions', 'readwrite', (s) => s.put(rt.record));
    if (enabled) startBackground(rt);
    else stopBackground(rt);
    if (!silent) BW.emitChange('extensions');
  }

  /* ---------------- Cloud sync ---------------- */
  // Synced data is capped at 3 KB, so extensions sync as Chrome Web Store ids and other devices
  // download them again. Unpacked folders and userscripts stay on the device they were added on.
  const fromStore = (r) => r.type === 'extension' && /^[a-p]{32}$/.test(r.id) && /^https:\/\/clients2\.google\.com\/service\/update2\/crx/.test(r.manifest.update_url || '');

  /** [[id, enabled], ...] for every extension installed from the Chrome Web Store. */
  const syncList = () => [...runtimes.values()].filter((rt) => fromStore(rt.record)).map((rt) => [rt.record.id, rt.record.enabled ? 1 : 0]);

  /** Make the store extensions match a synced list. Returns the ids that couldn't be installed. */
  async function applySyncList(list) {
    await ready;
    const wanted = new Map((Array.isArray(list) ? list : []).filter((x) => Array.isArray(x) && /^[a-p]{32}$/.test(x[0])).map(([id, on]) => [id, !!on]));
    for (const rt of [...runtimes.values()]) if (fromStore(rt.record) && !wanted.has(rt.record.id)) await remove(rt.record.id, true);
    const failed = [];
    for (const [id, enabled] of wanted) {
      try {
        if (!runtimes.has(id)) {
          const res = await fetch(`/api/cws/crx/${id}`);
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          await install(new File([await res.arrayBuffer()], `${id}.crx`));
        }
        if (runtimes.get(id).record.enabled !== enabled) await setEnabled(id, enabled, true);
      } catch {
        failed.push(id);
      }
    }
    BW.filters && BW.filters.rebuild();
    return failed;
  }

  async function reload(id) {
    const rt = runtimes.get(id);
    if (!rt) return;
    stopBackground(rt);
    if (rt.record.enabled) startBackground(rt);
  }

  const ready = (async () => {
    try {
      const records = (await idb('extensions', 'readonly', (s) => s.getAll())) || [];
      for (const record of records) {
        const rt = new Runtime(record);
        await rt.load();
        runtimes.set(record.id, rt);
        if (record.enabled) startBackground(rt);
      }
    } catch (e) {
      console.warn('[extensions] failed to load installed extensions', e);
    }
  })();

  /* ================================================================ */
  /* Toolbar popover                                                   */
  /* ================================================================ */
  const extIcon = (rt) => {
    const ip = iconPath(rt.manifest);
    return ip ? `<img src="${rt.getURL(ip)}" alt="">` : '<i class="fa-solid fa-puzzle-piece"></i>';
  };

  function renderPopover() {
    const el = document.getElementById('ext-popover');
    if (!el || el.hidden) return;
    el.classList.remove('ext-popup');
    delete el.dataset.owner;
    const pinned = new Set(BW.settings.get('pinnedExtensions'));
    const enabledBuiltins = BUILTINS.filter((b) => BW.settings.get('builtinExtensions').includes(b.id));
    const installed = [...runtimes.values()].filter((rt) => rt.record.enabled);
    const badge = (text) => (text ? `<span class="ext-badge">${BW.esc(text)}</span>` : '');
    el.innerHTML = `<div class="ext-panel-head"><i class="fa-solid fa-puzzle-piece"></i><span>Extensions</span></div>
      <div class="ext-list">
        ${installed.map((rt) => {
          const on = pinned.has(rt.id);
          return `<div class="ext-row">
            <button class="ext-open" data-ext="${rt.id}">${extIcon(rt)}<span class="ext-name">${BW.esc(rt.manifest.name)}</span>${badge(rt.badge)}</button>
            ${hasOptions(rt) ? `<button class="ext-act" data-options="${rt.id}" aria-label="Options"><i class="fa-solid fa-gear"></i></button>` : ''}
            <button class="ext-act ext-pin${on ? ' pinned' : ''}" data-pin="${rt.id}" aria-label="${on ? 'Unpin from toolbar' : 'Pin to toolbar'}" aria-pressed="${on}"><i class="fa-solid fa-thumbtack"></i></button>
          </div>`;
        }).join('')}
        ${enabledBuiltins.length ? `<div class="ext-group">Built-in</div>${enabledBuiltins.map((b) => `<div class="ext-row builtin"><span class="ext-open"><i class="${b.icon}"></i><span class="ext-name">${BW.esc(b.name)}</span>${badge('on')}</span></div>`).join('')}` : ''}
        ${!installed.length && !enabledBuiltins.length ? '<p class="ext-empty">No extensions enabled.</p>' : ''}
      </div>
      <button class="ext-manage" data-act="manage"><i class="fa-solid fa-sliders"></i> Manage extensions</button>`;
  }

  /* Pinned extensions sit in the navbar next to the puzzle button, like Chrome's toolbar. */
  const isPinned = (id) => BW.settings.get('pinnedExtensions').includes(id);
  function setPinned(id, on) {
    const list = BW.settings.get('pinnedExtensions').filter((x) => x !== id);
    if (on) list.push(id);
    BW.settings.set('pinnedExtensions', list);
  }

  function renderPins() {
    const bar = document.getElementById('nav-pins');
    if (!bar) return;
    const pins = BW.settings.get('pinnedExtensions').map((id) => runtimes.get(id)).filter((rt) => rt && rt.record.enabled);
    bar.innerHTML = pins
      .map((rt) => `<button class="nav-btn nav-pin" data-pinned-ext="${rt.id}" title="${BW.esc(rt.manifest.name)}" aria-label="${BW.esc(rt.manifest.name)}">${extIcon(rt)}${rt.badge ? `<span class="nav-pin-badge">${BW.esc(rt.badge)}</span>` : ''}</button>`)
      .join('');
  }
  // badges change often (uBlock counts blocked requests), so only touch the badge text
  function updatePinBadge(rt) {
    const btn = document.querySelector(`#nav-pins [data-pinned-ext="${rt.id}"]`);
    if (!btn) return;
    let el = btn.querySelector('.nav-pin-badge');
    if (!rt.badge) return el && el.remove();
    if (!el) btn.insertAdjacentHTML('beforeend', '<span class="nav-pin-badge"></span>');
    btn.querySelector('.nav-pin-badge').textContent = rt.badge;
  }

  document.addEventListener('click', (e) => {
    const pin = e.target.closest('[data-pinned-ext]');
    if (pin) {
      e.stopPropagation();
      const rt = runtimes.get(pin.dataset.pinnedExt);
      const pop = document.getElementById('ext-popover');
      // clicking the same pinned icon again closes its popup
      if (!pop.hidden && pop.dataset.owner === pin.dataset.pinnedExt) {
        pop.hidden = true;
        return;
      }
      if (rt) openPopup(rt, pin);
      return;
    }
    const pop = document.getElementById('ext-popover');
    if (!pop || pop.hidden) return;
    const extBtn = e.target.closest('[data-ext]');
    if (extBtn && pop.contains(extBtn)) {
      const rt = runtimes.get(extBtn.dataset.ext);
      if (rt) openPopup(rt, isPinned(rt.id) ? document.querySelector(`[data-pinned-ext="${rt.id}"]`) : null);
      return;
    }
    const pinToggle = e.target.closest('[data-pin]');
    if (pinToggle && pop.contains(pinToggle)) {
      setPinned(pinToggle.dataset.pin, !isPinned(pinToggle.dataset.pin));
      renderPopover();
      return;
    }
    const optBtn = e.target.closest('[data-options]');
    if (optBtn && pop.contains(optBtn)) {
      const rt = runtimes.get(optBtn.dataset.options);
      if (rt) openOptions(rt);
      return;
    }
    if (e.target.closest('[data-act="manage"]')) {
      pop.hidden = true;
      BW.settingsUI.open('extensions');
      return;
    }
    if (!pop.contains(e.target) && !e.target.closest('#nav-extensions')) pop.hidden = true;
  });

  BW.settings.on('pinnedExtensions', renderPins);
  BW.onChange((what) => what === 'extensions' && renderPins());
  ready.then(renderPins);

  BW.extensions = {
    ready,
    BUILTINS,
    attachFrame,
    install,
    remove,
    setEnabled,
    reload,
    list: () => [...runtimes.values()].map((rt) => rt.record),
    syncList,
    applySyncList,
    runtime: (id) => runtimes.get(id),
    iconUrl: (id) => {
      const rt = runtimes.get(id);
      const p = rt && iconPath(rt.manifest);
      return p ? rt.getURL(p) : null;
    },
    hasOptions: (id) => {
      const rt = runtimes.get(id);
      return !!(rt && hasOptions(rt));
    },
    openOptions: (id) => {
      const rt = runtimes.get(id);
      if (rt) openOptions(rt);
    },
    isPinned,
    setPinned,
    togglePopover() {
      const el = document.getElementById('ext-popover');
      // the puzzle button always opens the list, even if a pinned popup is showing
      const showingList = !el.hidden && !el.classList.contains('ext-popup');
      el.hidden = showingList;
      if (!el.hidden) placePopover();
      renderPopover();
    },
    refreshPopover: renderPopover,
    matchPattern,
    _shim: (id, kind, url) => {
      const rt = runtimes.get(id);
      return rt ? makeChrome(rt, { kind, url: url || rt.getURL('') }) : {};
    },
    // used by filters.js to compile network rules
    _runtimes: () => [...runtimes.values()],
  };
})();
