/*
 * Loaded first in every extension page served from /bw-ext/<id>/... (background, popup, options).
 * Finds the blackwaves page hosting it and installs that extension's chrome.* API.
 */
(function () {
  const script = document.currentScript;
  const id = script.dataset.id;
  const kind = script.dataset.kind || 'page';

  let host = null;
  try {
    for (let w = window.parent; w; w = w.parent) {
      if (w.BW && w.BW.extensions) {
        host = w;
        break;
      }
      if (w === w.parent) break;
    }
  } catch {}
  if (!host) {
    console.warn('[blackwaves] This extension page only works inside blackwaves.');
    return;
  }

  // The chrome.* objects are built by the blackwaves page, so anything they hand back (tabs,
  // storage values, messages from other pages) belongs to that page's realm, and checks like
  // `tab instanceof Object` fail here. Chrome serializes everything that crosses into an extension
  // page, so do the same: copy values into this realm with structuredClone. Things that can't be
  // copied (ports, events) are wrapped instead, so their methods are copied too.
  const wrapped = new WeakMap();
  const callbacks = new WeakMap();
  const copy = (v) => {
    if (v === null || (typeof v !== 'object' && typeof v !== 'function')) return v;
    if (typeof v === 'function') return localize(v);
    try {
      return structuredClone(v);
    } catch {
      return localize(v);
    }
  };
  const settle = (r) => (r && typeof r.then === 'function' && !(r instanceof Promise) ? new Promise((res, rej) => r.then((v) => res(copy(v)), (e) => rej(copy(e)))) : copy(r));
  const callback = (cb) => {
    if (typeof cb !== 'function') return cb;
    if (!callbacks.has(cb)) callbacks.set(cb, function (...args) {
      return cb.apply(this, args.map(copy));
    });
    return callbacks.get(cb);
  };
  function localize(obj) {
    if (wrapped.has(obj)) return wrapped.get(obj);
    const methods = new Map();
    const proxy = new Proxy(obj, {
      get(target, key) {
        const v = Reflect.get(target, key);
        if (typeof v === 'function') {
          if (!methods.has(key)) methods.set(key, function (...args) {
            return settle(v.apply(target, args.map(callback)));
          });
          return methods.get(key);
        }
        return v && typeof v === 'object' ? localize(v) : v;
      },
      apply(target, self, args) {
        return settle(Reflect.apply(target, self, args.map(callback)));
      },
    });
    wrapped.set(obj, proxy);
    return proxy;
  }

  const chrome = localize(host.BW.extensions._shim(id, kind, location.href));
  try {
    Object.defineProperty(window, 'chrome', { configurable: true, writable: true, value: chrome });
  } catch {
    window.chrome = chrome;
  }
  window.browser = chrome;

  if (kind === 'background') {
    // MV3 backgrounds are written for a service worker; give them the globals they expect.
    if (!self.ServiceWorkerGlobalScope) self.ServiceWorkerGlobalScope = function ServiceWorkerGlobalScope() {};
    self.registration = {
      scope: location.href,
      showNotification: (title, opts) => chrome.notifications.create({ title, message: (opts && opts.body) || '' }),
    };
    self.clients = { matchAll: async () => [], claim: async () => {}, openWindow: async (url) => chrome.tabs.create({ url }) };
    self.skipWaiting = async () => {};
    self.importScripts = (...paths) => {
      for (const p of paths) {
        const xhr = new XMLHttpRequest();
        xhr.open('GET', new URL(p, location.href).href, false);
        xhr.send();
        (0, eval)(xhr.responseText);
      }
    };
  }
})();
