// the blackwaves service worker. its only job is handing /~/sj/ requests to
// scramjet. it caches nothing on purpose: the last version of this site
// cached index.html for a year and people stared at blank pages after updates.
importScripts("/ctrl/controller.sw.js");

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

// upstream scramjet hands the transport a streaming request body. epoxy and
// libcurl can't send streams, so every POST (youtube's player api, logins,
// searches...) quietly failed and youtube decided you were "offline".
// read the body into an ArrayBuffer first, like lyra's fork did.
async function withBufferedBody(event) {
  const request = event.request;
  if (request.method === "GET" || request.method === "HEAD") return event;
  const body = await request.arrayBuffer();
  return {
    clientId: event.clientId,
    resultingClientId: event.resultingClientId,
    request: {
      url: request.url,
      referrer: request.referrer,
      destination: request.destination,
      mode: request.mode,
      method: request.method,
      cache: request.cache,
      headers: request.headers,
      signal: request.signal,
      body: body.byteLength ? body : null,
    },
  };
}

self.addEventListener("fetch", (event) => {
  if (!self.$scramjetController.shouldRoute(event)) return;
  event.respondWith(withBufferedBody(event).then((routed) => self.$scramjetController.route(routed)));
});
