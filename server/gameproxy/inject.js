import { XOR_KEY } from "./encoding.js";

// this runs inside every proxied game page, before the game's own scripts.
// it patches fetch/xhr/websocket/workers/element urls so the game keeps
// talking to /!!/ instead of the real internet. it is a pile of monkey
// patches held together by optimism, and it works on a surprising number of games.
const CLIENT = String.raw`(function(){
if (window.__BW_PATCHED__) return; window.__BW_PATCHED__ = true;
var _U = window.URL, KEY = ${JSON.stringify(XOR_KEY)};
var PREFIX = "/!!/";
window.__MOCHI_PREFIX__ = PREFIX;
window.__MOCHI_TARGET__ = __TARGET__;
window.__MOCHI_BASE__ = location.origin + PREFIX;
try { var b = document.querySelector("base[data-bw-href]"); if (b) window.__MOCHI_TARGET__ = b.getAttribute("data-bw-href"); } catch (e) {}
function enc(url){ try { var e = encodeURIComponent(url), x = ""; for (var i = 0; i < e.length; i++) x += String.fromCharCode(e.charCodeAt(i) ^ KEY.charCodeAt(i % KEY.length)); return btoa(x).replace(/\+/g,"-").replace(/\//g,"_").replace(/=+$/,"") + "/"; } catch (err) { return url; } }
function rw(url){
  if (url == null) return url;
  if (typeof url !== "string") { try { url = String(url); } catch (e) { return url; } }
  if (!url || /^(blob:|data:|javascript:|about:|mailto:|tel:|#)/i.test(url)) return url;
  if (url.indexOf(PREFIX) === 0 || url.indexOf(location.origin + PREFIX) === 0 || url.indexOf("/!cover!/") === 0) return url;
  try {
    var r = new _U(url, window.__MOCHI_TARGET__);
    if (r.protocol !== "http:" && r.protocol !== "https:") return url;
    if (r.origin === location.origin) return url;
    return window.__MOCHI_BASE__ + enc(r.href);
  } catch (e) { return url; }
}
window.__bwRewrite = rw;
try {
  var F = function (u, b) { if ((u === undefined || u === "") && b === undefined) return new _U(window.__MOCHI_TARGET__); return b === undefined ? new _U(u) : new _U(u, b); };
  F.prototype = _U.prototype;
  Object.getOwnPropertyNames(_U).forEach(function (k) { if (!(k in F)) try { F[k] = _U[k]; } catch (e) {} });
  F.createObjectURL = function (o) { return _U.createObjectURL(o); };
  F.revokeObjectURL = function (u) { return _U.revokeObjectURL(u); };
  if (_U.canParse) F.canParse = function (u, b) { return _U.canParse(u, b); };
  window.URL = F;
} catch (e) {}
try {
  if (navigator.serviceWorker) Object.defineProperty(navigator, "serviceWorker", { configurable: true, value: {
    register: function(){ return Promise.reject(new DOMException("service workers are off inside games","NotSupportedError")); },
    getRegistration: function(){ return Promise.resolve(undefined); },
    getRegistrations: function(){ return Promise.resolve([]); },
    addEventListener: function(){}, removeEventListener: function(){}, controller: null,
    get ready(){ var p = Promise.reject(new DOMException("service workers are off inside games","NotSupportedError")); p.catch(function(){}); return p; }
  }});
} catch (e) {}
try {
  var hp = history.pushState, hr = history.replaceState;
  history.pushState = function (s, t, u) { try { return hp.call(this, s, t, u); } catch (e) {} };
  history.replaceState = function (s, t, u) { try { return hr.call(this, s, t, u); } catch (e) {} };
  var ael = window.addEventListener;
  window.addEventListener = function (t, l, o) { if (t === "beforeunload") return; return ael.call(this, t, l, o); };
  Object.defineProperty(window, "onbeforeunload", { configurable: true, get: function(){ return null; }, set: function(){} });
} catch (e) {}
var of = window.fetch;
window.fetch = function (input, init) {
  try {
    if (input instanceof Request) { var u = rw(input.url); if (u !== input.url) input = new Request(u, input); }
    else input = rw(String(input));
  } catch (e) {}
  return of.call(this, input, init);
};
var oo = XMLHttpRequest.prototype.open;
XMLHttpRequest.prototype.open = function (m, u) { var a = Array.prototype.slice.call(arguments); a[1] = rw(String(u)); return oo.apply(this, a); };
if (navigator.sendBeacon) { var sb = navigator.sendBeacon.bind(navigator); navigator.sendBeacon = function (u, d) { return sb(rw(String(u)), d); }; }
var ow = window.open;
window.open = function (u, n, f) { return ow.call(window, u ? rw(String(u)) : u, n, f); };
var OWS = window.WebSocket;
function WS(url, protocols) {
  var target = String(url);
  try { target = new _U(target, window.__MOCHI_TARGET__).href.replace(/^http/, "ws"); } catch (e) {}
  var host = ""; try { host = new _U(target).hostname.replace(/^www\./, ""); } catch (e) {}
  if (/(^|\.)discord(app)?\.(com|gg|media|net)$/.test(host)) return new OWS(target, protocols);
  var ws = new OWS((location.protocol === "https:" ? "wss://" : "ws://") + location.host + PREFIX + "ws/" + encodeURIComponent(target), protocols);
  ws.binaryType = "arraybuffer";
  return ws;
}
WS.prototype = OWS.prototype; WS.CONNECTING = 0; WS.OPEN = 1; WS.CLOSING = 2; WS.CLOSED = 3;
window.WebSocket = WS;
var OW = window.Worker;
if (OW) { window.Worker = function (s, o) { return new OW(rw(String(s)), o); }; window.Worker.prototype = OW.prototype; }
function hook(proto, prop) {
  try {
    var d = Object.getOwnPropertyDescriptor(proto, prop);
    if (!d || !d.set) return;
    Object.defineProperty(proto, prop, { configurable: true, enumerable: d.enumerable, get: d.get, set: function (v) { return d.set.call(this, rw(String(v))); } });
  } catch (e) {}
}
hook(HTMLIFrameElement.prototype, "src"); hook(HTMLImageElement.prototype, "src");
hook(HTMLScriptElement.prototype, "src"); hook(HTMLSourceElement.prototype, "src");
hook(HTMLMediaElement.prototype, "src"); hook(HTMLEmbedElement.prototype, "src");
hook(HTMLObjectElement.prototype, "data"); hook(HTMLLinkElement.prototype, "href");
hook(HTMLAnchorElement.prototype, "href"); hook(HTMLFormElement.prototype, "action");
if (window.HTMLTrackElement) hook(HTMLTrackElement.prototype, "src");
var osa = Element.prototype.setAttribute;
Element.prototype.setAttribute = function (n, v) {
  var k = String(n).toLowerCase();
  if (typeof v === "string" && (k === "src" || k === "href" || k === "poster" || k === "data" || k === "action")) v = rw(v);
  return osa.call(this, n, v);
};
document.addEventListener("click", function (e) {
  if (e.defaultPrevented) return;
  var a = e.target && e.target.closest ? e.target.closest("a[href]") : null;
  if (!a) return;
  var h = a.getAttribute("href") || "";
  if (/\.(zip|rar|7z|exe|msi|apk|dmg|pdf|mp3|mp4|wav|iso)(\?|$)/i.test(h) || a.hasAttribute("download")) { e.preventDefault(); window.open(rw(h), "_blank"); }
}, true);
window.dataLayer = []; window.gtag = function(){}; window.ga = function(){};
window.google = window.google || {};
window.google.ima = window.google.ima || { AdsLoader: function(){ return { addEventListener: function(){}, contentComplete: function(){}, requestAds: function(){} }; }, AdDisplayContainer: function(){ return { initialize: function(){} }; }, AdsManagerLoadedEvent: { Type: { ADS_MANAGER_LOADED: "adsManagerLoaded" } }, AdErrorEvent: { Type: { AD_ERROR: "adError" } }, ViewMode: { NORMAL: "normal" } };
window.__tcfapi = function (a, b, c) { if (typeof c === "function") c(null, false); };
})();`;

const GN_MATH = String.raw`<script>(function(){
var f = window.fetch.bind(window);
window.fetch = function (u, o) { var s = typeof u === "string" ? u : (u && u.url) || String(u); if (s.indexOf("data.jsdelivr.com/v1/stats/") !== -1) return Promise.resolve(new Response('{"total":0,"files":[],"versions":[]}', { status: 200, headers: { "Content-Type": "application/json" } })); return f(u, o); };
})();</script><style>.zone-header,header,main,footer{display:none!important}#zoneViewer{display:flex!important;position:fixed;inset:0;z-index:9999;background:#000}#zoneFrame{flex:1;width:100%;height:100%;border:none}body{margin:0;padding:0;overflow:hidden;background:#000}</style>`;

export function clientScript(target) {
  const literal = JSON.stringify(target).replace(/</g, "\\u003c");
  return `<script data-bw-inject>${CLIENT.replace("__TARGET__", () => literal)}</script>`;
}

export function siteExtras(target) {
  return /(^|\.)gn-math\.(dev|com|net)$/.test(new URL(target).hostname) ? GN_MATH : "";
}
