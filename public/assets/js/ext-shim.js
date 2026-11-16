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

  const chrome = host.BW.extensions._shim(id, kind, location.href);
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
