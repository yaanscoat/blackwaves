// game proxy urls look like /!!/<token>/ where token = base64url(xor(encodeURIComponent(url))).
// is the xor "encryption"? no. it's there so school filters don't see
// "coolmathgames.com" sitting in plain text in the url. that's the whole job.

export const XOR_KEY = "q7Zx!9pL";
const KEY = Buffer.from(XOR_KEY);

export const PROXY_PREFIX = "/!!/";
export const COVER_PREFIX = "/!cover!/";

export function encodeTarget(url) {
  const bytes = Buffer.from(encodeURIComponent(url));
  for (let i = 0; i < bytes.length; i++) bytes[i] ^= KEY[i % KEY.length];
  return bytes.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function decodeTarget(token) {
  try {
    const bytes = Buffer.from(token.replace(/-/g, "+").replace(/_/g, "/"), "base64");
    if (!bytes.length) return null;
    for (let i = 0; i < bytes.length; i++) bytes[i] ^= KEY[i % KEY.length];
    const url = decodeURIComponent(bytes.toString("utf8"));
    return url.startsWith("http://") || url.startsWith("https://") ? url : null;
  } catch {
    return null;
  }
}

export function proxyUrl(url) {
  return `${PROXY_PREFIX}${encodeTarget(url)}/`;
}
