/*
 * blackwaves hybrid transport: Epoxy first, Libcurl as a fallback.
 *
 * Epoxy's HTTP/2 client (hyper) keeps its default 16 KB response-header limit and doesn't
 * let us raise it. Sites with huge header blocks (YouTube's CSP / permissions-policy /
 * origin-trial / cookies) get their stream reset with:
 *   hyper::Error(Http2, Error { kind: Reset(StreamId(n), PROTOCOL_ERROR, Library) })
 * When Epoxy fails like that, the request is retried through Libcurl, and that host keeps
 * using Libcurl for the rest of the session. Websockets always go through Epoxy.
 *
 * Works as a bare-mux transport (Ultraviolet, Scramjet 1.1.0) and as a proxy-transport
 * (Scramjet latest): both call the same init / request / connect methods.
 *
 * Options: { wisp, epoxy: "/epoxy/index.mjs", libcurl: "/libcurl/index.mjs" }
 */
const RETRYABLE = /Http2|PROTOCOL_ERROR|hyper|header|stream|connection (closed|reset)|unexpected end/i;

export default class HybridTransport {
  ready = false;

  constructor(options = {}) {
    this.options = options;
    this.wisp = options.wisp;
    this.epoxy = null;
    this.libcurl = null;
    this.libcurlLoading = null;
    this.libcurlHosts = new Set();
  }

  async init() {
    const { default: Epoxy } = await import(this.options.epoxy || "/epoxy/index.mjs");
    this.epoxy = new Epoxy({ wisp: this.wisp });
    await this.epoxy.init();
    this.ready = true;
  }

  async meta() {}

  // Libcurl's wasm is ~2 MB, so only load it the first time a site needs it.
  getLibcurl() {
    if (!this.libcurlLoading) {
      this.libcurlLoading = (async () => {
        const { default: Libcurl } = await import(this.options.libcurl || "/libcurl/index.mjs");
        const client = new Libcurl({ wisp: this.wisp });
        await client.init();
        this.libcurl = client;
        return client;
      })().catch((err) => {
        this.libcurlLoading = null;
        throw err;
      });
    }
    return this.libcurlLoading;
  }

  async request(remote, method, body, headers, signal) {
    // Retrying needs a body we can send twice.
    if (body instanceof ReadableStream) body = await new Response(body).arrayBuffer();
    else if (body instanceof Blob) body = await body.arrayBuffer();

    const host = remote.host;
    if (this.libcurlHosts.has(host)) {
      return (await this.getLibcurl()).request(remote, method, body, headers, signal);
    }
    try {
      return await this.epoxy.request(remote, method, body, headers, signal);
    } catch (err) {
      if (signal && signal.aborted) throw err;
      if (!RETRYABLE.test(String((err && err.message) || err))) throw err;
      console.warn(`[blackwaves] Epoxy failed for ${host}, retrying with Libcurl:`, (err && err.message) || err);
      const libcurl = await this.getLibcurl();
      const res = await libcurl.request(remote, method, body, headers, signal);
      this.libcurlHosts.add(host);
      return res;
    }
  }

  connect(url, protocols, requestHeaders, onopen, onmessage, onclose, onerror) {
    return this.epoxy.connect(url, protocols, requestHeaders, onopen, onmessage, onclose, onerror);
  }
}
