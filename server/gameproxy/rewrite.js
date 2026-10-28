import { proxyUrl } from "./encoding.js";
import { clientScript, siteExtras } from "./inject.js";

// a small, forgiving html tag rewriter. it does not build a dom, it walks
// tags and rewrites the url-ish attributes we care about. the rust version
// used lol_html; this one uses regex and stubbornness.

const URL_ATTRS = {
  a: ["href"],
  area: ["href"],
  link: ["href"],
  script: ["src"],
  img: ["src", "srcset"],
  input: ["src"],
  track: ["src"],
  source: ["src", "srcset"],
  video: ["src", "poster"],
  audio: ["src"],
  iframe: ["src"],
  frame: ["src"],
  embed: ["src"],
  object: ["data"],
  form: ["action"],
  image: ["href", "xlink:href"],
  use: ["href", "xlink:href"],
};

const SKIP_SCHEME = /^(data:|blob:|javascript:|mailto:|tel:|about:|#)/i;
const ATTR_RE = /([^\s"'<>/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;

function decodeEntities(value) {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#0*39;|&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec) => String.fromCodePoint(Number(dec)));
}

function escapeAttr(value) {
  return value.replace(/&/g, "&amp;").replace(/"/g, "&quot;");
}

export function rewriteUrl(raw, base) {
  const value = raw.trim();
  if (!value || SKIP_SCHEME.test(value) || value.startsWith("/!!/") || value.startsWith("/!cover!/")) return null;
  try {
    const resolved = new URL(value, base);
    if (resolved.protocol !== "http:" && resolved.protocol !== "https:") return null;
    return proxyUrl(resolved.href);
  } catch {
    return null;
  }
}

function rewriteSrcset(value, base) {
  return value
    .split(",")
    .map((candidate) => {
      const parts = candidate.trim().split(/\s+/);
      if (!parts[0]) return candidate;
      const rewritten = rewriteUrl(parts[0], base);
      if (rewritten) parts[0] = rewritten;
      return parts.join(" ");
    })
    .join(", ");
}

export function rewriteCss(css, base) {
  let out = css.replace(/url\(\s*(["']?)([^"')]*?)\1\s*\)/gi, (match, quote, value) => {
    const rewritten = rewriteUrl(decodeEntities(value), base);
    return rewritten ? `url("${rewritten}")` : match;
  });
  out = out.replace(/@import\s+(["'])([^"']+)\1/gi, (match, quote, value) => {
    const rewritten = rewriteUrl(value, base);
    return rewritten ? `@import "${rewritten}"` : match;
  });
  return out;
}

function parseAttrs(source) {
  const attrs = [];
  ATTR_RE.lastIndex = 0;
  let match;
  while ((match = ATTR_RE.exec(source))) {
    const value = match[2] ?? match[3] ?? match[4];
    attrs.push({ name: match[1], value: value === undefined ? null : decodeEntities(value) });
  }
  return attrs;
}

function buildTag(name, attrs, selfClosing) {
  let out = `<${name}`;
  for (const attr of attrs) {
    out += attr.value === null ? ` ${attr.name}` : ` ${attr.name}="${escapeAttr(attr.value)}"`;
  }
  return out + (selfClosing ? " />" : ">");
}

/**
 * rewrite one opening tag. returns the new tag text and, for <base>, the new
 * document base url (relative links after a <base> resolve against it).
 */
function rewriteTag(tagName, attrSource, selfClosing, state) {
  const name = tagName.toLowerCase();
  const attrs = parseAttrs(attrSource);
  const targets = URL_ATTRS[name] || [];
  let changed = false;

  if (name === "base") {
    const href = attrs.find((attr) => attr.name.toLowerCase() === "href");
    if (href?.value) {
      try {
        state.base = new URL(href.value, state.base).href;
        attrs.push({ name: "data-bw-href", value: state.base });
        href.value = proxyUrl(state.base);
        changed = true;
      } catch {}
    }
  }

  for (const attr of attrs) {
    const key = attr.name.toLowerCase();
    if (attr.value === null) continue;
    if (targets.includes(key)) {
      const rewritten = key === "srcset" ? rewriteSrcset(attr.value, state.base) : rewriteUrl(attr.value, state.base);
      if (rewritten && rewritten !== attr.value) {
        attr.value = rewritten;
        changed = true;
      }
    } else if (key === "style") {
      const rewritten = rewriteCss(attr.value, state.base);
      if (rewritten !== attr.value) {
        attr.value = rewritten;
        changed = true;
      }
    } else if (key === "integrity" && (name === "link" || name === "script")) {
      attr.drop = true;
      changed = true;
    } else if (key === "type" && name === "script") {
      // cloudflare rocket loader renames script types to "<hash>-text/javascript"
      const rocket = /^[0-9a-f]{8,}-(.+)$/i.exec(attr.value);
      if (rocket) {
        attr.value = rocket[1];
        changed = true;
      }
    } else if (name === "meta" && key === "content") {
      const httpEquiv = attrs.find((other) => other.name.toLowerCase() === "http-equiv")?.value?.toLowerCase();
      if (httpEquiv === "refresh") {
        const refresh = /^(\s*\d+\s*;\s*url\s*=\s*)(['"]?)(.+?)\2\s*$/i.exec(attr.value);
        const rewritten = refresh && rewriteUrl(refresh[3], state.base);
        if (rewritten) {
          attr.value = `${refresh[1]}${rewritten}`;
          changed = true;
        }
      } else if (httpEquiv === "content-security-policy") {
        attr.drop = true;
        changed = true;
      }
    }
  }

  if (!changed) return null;
  return buildTag(tagName, attrs.filter((attr) => !attr.drop), selfClosing);
}

export function rewriteHtml(html, target) {
  const state = { base: target };
  const inject = clientScript(target) + siteExtras(target);
  let out = "";
  let index = 0;
  let injected = false;
  const tagRe = /<!--[\s\S]*?-->|<!\[CDATA\[[\s\S]*?\]\]>|<!doctype[^>]*>|<\/?([a-zA-Z][a-zA-Z0-9:-]*)((?:[^>"']|"[^"]*"|'[^']*')*?)(\/?)>/gi;
  let match;

  while ((match = tagRe.exec(html))) {
    out += html.slice(index, match.index);
    index = tagRe.lastIndex;
    const whole = match[0];
    const tagName = match[1];

    if (!tagName || whole.startsWith("</")) {
      out += whole;
      continue;
    }

    const lower = tagName.toLowerCase();
    const baseBefore = state.base;
    const rewritten = rewriteTag(tagName, match[2] || "", match[3] === "/", state);
    let tag = rewritten || whole;
    if (lower === "base" && state.base !== baseBefore) {
      tag += `<script>window.__MOCHI_TARGET__=${JSON.stringify(state.base).replace(/</g, "\\u003c")};</script>`;
    }

    if (!injected && lower === "head") {
      tag += inject;
      injected = true;
    } else if (!injected && lower !== "html" && lower !== "!doctype") {
      // no <head>? stick the script right before the first real tag
      tag = inject + tag;
      injected = true;
    }
    out += tag;

    // don't go poking around inside scripts. style blocks get their url()s fixed.
    if (lower === "script" || lower === "style" || lower === "textarea" || lower === "title") {
      const closeRe = new RegExp(`</${lower}\\s*>`, "ig");
      closeRe.lastIndex = index;
      const close = closeRe.exec(html);
      const end = close ? close.index : html.length;
      const inner = html.slice(index, end);
      out += lower === "style" ? rewriteCss(inner, state.base) : inner;
      index = end;
      tagRe.lastIndex = end;
    }
  }
  out += html.slice(index);
  if (!injected) out = inject + out;
  return out;
}
