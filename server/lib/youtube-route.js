// youtube decides whether you get "sign in to confirm you're not a bot" from
// the ip asking, and a lot of server ips (datacenters, some countries) are on
// its naughty list. if YOUTUBE_PROXY is set, everything youtube-shaped leaves
// through that proxy instead: music lookups, the audio itself, and youtube.com
// in the proxy browser. everything else keeps going out directly.
import net from "node:net";
import tls from "node:tls";
import { fetch as undiciFetch, ProxyAgent } from "undici";
import { config } from "../config.js";
import { publicFetch } from "./net.js";

const YOUTUBE_HOST = /(^|\.)(youtube\.com|youtube-nocookie\.com|youtu\.be|googlevideo\.com|youtubei\.googleapis\.com)$/i;

export const isYoutubeHost = (host) => YOUTUBE_HOST.test(String(host || "").replace(/\.$/, ""));

let proxy = null;
if (config.youtubeProxy) {
  try {
    proxy = new URL(config.youtubeProxy);
    if (!/^https?:$/.test(proxy.protocol)) throw new Error("only http:// and https:// proxies are supported");
  } catch (error) {
    console.warn(`YOUTUBE_PROXY ignored: ${error.message}`);
    proxy = null;
  }
}

export const youtubeProxied = Boolean(proxy);
const agent = proxy ? new ProxyAgent(proxy.href) : null;

/** fetch for anything youtube: through the proxy when there is one */
export function youtubeFetch(url, init = {}) {
  if (!agent) return publicFetch(url, init);
  return undiciFetch(url, { ...init, dispatcher: agent });
}

/**
 * youtubei.js hands its fetch Request objects from node's own undici, which the
 * undici package won't accept, so unpack them into plain url + options first.
 */
export async function innertubeFetch(input, init = {}) {
  if (typeof input === "string" || input instanceof URL) return youtubeFetch(String(input), init);
  const body = input.method === "GET" || input.method === "HEAD" ? undefined : await input.arrayBuffer();
  return youtubeFetch(input.url, { method: input.method, headers: input.headers, body, ...init });
}

/** opens a raw tcp tunnel to host:port through the proxy with http CONNECT */
function tunnel(host, port) {
  return new Promise((resolve, reject) => {
    const proxyPort = Number(proxy.port) || (proxy.protocol === "https:" ? 443 : 80);
    const socket =
      proxy.protocol === "https:"
        ? tls.connect({ host: proxy.hostname, port: proxyPort, servername: proxy.hostname })
        : net.connect({ host: proxy.hostname, port: proxyPort });
    const fail = (error) => {
      socket.destroy();
      reject(error);
    };
    socket.setTimeout(15_000, () => fail(new Error("youtube proxy timed out")));
    socket.once("error", fail);
    socket.once(proxy.protocol === "https:" ? "secureConnect" : "connect", () => {
      const auth = proxy.username ? `Proxy-Authorization: Basic ${Buffer.from(`${decodeURIComponent(proxy.username)}:${decodeURIComponent(proxy.password)}`).toString("base64")}\r\n` : "";
      socket.write(`CONNECT ${host}:${port} HTTP/1.1\r\nHost: ${host}:${port}\r\n${auth}\r\n`);
    });
    let head = Buffer.alloc(0);
    const onData = (chunk) => {
      head = Buffer.concat([head, chunk]);
      const end = head.indexOf("\r\n\r\n");
      if (end === -1) return head.length > 16_384 && fail(new Error("youtube proxy sent a giant header"));
      socket.off("data", onData);
      const status = Number(/^HTTP\/1\.[01] (\d{3})/.exec(head.subarray(0, end).toString("latin1"))?.[1]);
      if (status !== 200) return fail(new Error(`youtube proxy refused the tunnel (${status || "bad reply"})`));
      socket.setTimeout(0);
      socket.off("error", fail);
      const rest = head.subarray(end + 4);
      if (rest.length) socket.unshift(rest);
      resolve(socket);
    };
    socket.on("data", onData);
  });
}

/** opens a tunnel to a youtube host through YOUTUBE_PROXY (null when there's no proxy) */
export const tunnelYoutube = proxy ? tunnel : null;
if (proxy) console.log(`youtube traffic goes through ${proxy.hostname}:${proxy.port || "default port"}`);
