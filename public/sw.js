importScripts("/scram/scramjet.all.js");

const { ScramjetServiceWorker } = $scramjetLoadWorker();
const scramjet = new ScramjetServiceWorker();

scramjet.dispatch = async function skipBrokenCookieSync() {};

const browserKeepsBodies = "body" in Request.prototype;

if (!browserKeepsBodies) {
  self.Request = class RequestWithBody extends Request {
    constructor(input, options) {
      super(input, options);
      this.body = options?.body ?? null;
    }
  };
}

async function withBody(request) {
  if (browserKeepsBodies || request.method === "GET" || request.method === "HEAD") {
    return request;
  }
  const body = await request.arrayBuffer();
  return new Proxy(request, {
    get: (target, key) => (key === "body" ? body : target[key])
  });
}

async function handleRequest(event) {
  await scramjet.loadConfig();
  if (scramjet.route(event)) {
    return scramjet.fetch({ request: await withBody(event.request), clientId: event.clientId });
  }
  return fetch(event.request);
}

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));
self.addEventListener("fetch", (event) => {
  event.respondWith(handleRequest(event));
});
