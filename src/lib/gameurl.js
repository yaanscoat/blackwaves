// mirror of server/gameproxy/encoding.js. same xor, same base64url, same
// "this isn't encryption, it's camouflage" disclaimer.
const KEY = "q7Zx!9pL";

export function encodeTarget(url) {
  const encoded = encodeURIComponent(url);
  let out = "";
  for (let i = 0; i < encoded.length; i++) out += String.fromCharCode(encoded.charCodeAt(i) ^ KEY.charCodeAt(i % KEY.length));
  return btoa(out).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function proxyUrl(url) {
  return url ? `/!!/${encodeTarget(url)}/` : "";
}

export function coverUrl(url) {
  return url ? `/!cover!/${encodeTarget(url)}/` : "";
}

export function faviconUrl(pageUrl) {
  try {
    return coverUrl(`https://www.google.com/s2/favicons?domain=${new URL(pageUrl).hostname}&sz=64`);
  } catch {
    return "";
  }
}

/** /!!/<token>/rest -> the real url, or "" if it isn't one of ours */
export function decodeProxyPath(path) {
  try {
    const url = new URL(path, location.origin);
    if (!url.pathname.startsWith("/!!/")) return "";
    const [token, ...rest] = url.pathname.slice(4).split("/");
    let b64 = token.replace(/-/g, "+").replace(/_/g, "/");
    while (b64.length % 4) b64 += "=";
    const raw = atob(b64);
    let out = "";
    for (let i = 0; i < raw.length; i++) out += String.fromCharCode(raw.charCodeAt(i) ^ KEY.charCodeAt(i % KEY.length));
    const base = decodeURIComponent(out);
    const suffix = rest.join("/");
    return (suffix ? new URL(suffix, base).href : base) + url.search;
  } catch {
    return "";
  }
}
