import dns from "node:dns";
import net from "node:net";
import ipaddr from "ipaddr.js";
import { Agent, fetch as undiciFetch } from "undici";

export const BROWSER_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36";

/**
 * Only plain public unicast addresses get through. Everything else
 * (loopback, 10/8, 192.168/16, link-local, the cloud metadata box at
 * 169.254.169.254, carrier NAT, ...) is the server's private business.
 */
export function isPublicIp(address) {
  try {
    let parsed = ipaddr.parse(address);
    if (parsed.kind() === "ipv6" && parsed.isIPv4MappedAddress()) parsed = parsed.toIPv4Address();
    return parsed.range() === "unicast";
  } catch {
    return false;
  }
}

class BlockedTargetError extends Error {
  constructor(host) {
    super(`blocked private network target: ${host}`);
    this.code = "EBLOCKED";
  }
}

function safeLookup(hostname, options, callback) {
  dns.lookup(hostname, { ...options, all: true }, (error, addresses) => {
    if (error) return callback(error);
    const list = Array.isArray(addresses) ? addresses : [{ address: addresses, family: options.family || 4 }];
    const allowed = list.filter((entry) => isPublicIp(entry.address));
    if (!allowed.length) return callback(new BlockedTargetError(hostname));
    if (options.all) return callback(null, allowed);
    callback(null, allowed[0].address, allowed[0].family);
  });
}

export const publicAgent = new Agent({
  connect: { lookup: safeLookup, timeout: 10_000 },
  keepAliveTimeout: 30_000,
  connections: 256,
  headersTimeout: 30_000,
  bodyTimeout: 120_000,
});

export function assertPublicUrl(value) {
  let url;
  try {
    url = value instanceof URL ? value : new URL(value);
  } catch {
    throw new BlockedTargetError(String(value));
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") throw new BlockedTargetError(url.href);
  if (url.username || url.password) throw new BlockedTargetError(url.host);
  const host = url.hostname.replace(/^\[|\]$/g, "");
  if (net.isIP(host) && !isPublicIp(host)) throw new BlockedTargetError(host);
  if (/^(localhost|.*\.localhost|.*\.local|.*\.internal|metadata\.google\.internal)$/i.test(host)) {
    throw new BlockedTargetError(host);
  }
  return url;
}

/** fetch() that refuses to talk to anything private, even after redirects. */
export function publicFetch(url, init = {}) {
  assertPublicUrl(url);
  return undiciFetch(url, { ...init, dispatcher: publicAgent });
}

export function withTimeout(ms, signal) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error("upstream timed out")), ms);
  timer.unref?.();
  if (signal) {
    if (signal.aborted) controller.abort(signal.reason);
    else signal.addEventListener("abort", () => controller.abort(signal.reason), { once: true });
  }
  return { signal: controller.signal, done: () => clearTimeout(timer) };
}
