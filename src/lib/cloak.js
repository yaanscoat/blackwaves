import { effect } from "@preact/signals";
import { CLOAKS } from "../data/catalogs.js";
import { settings } from "./settings.js";

const ORIGINAL = { title: "blackwaves", icon: "/favicon.ico" };
let expectedTitle = ORIGINAL.title;

function apply({ title, icon }) {
  expectedTitle = title;
  if (document.title !== title) document.title = title;
  let link = document.querySelector("link[rel~='icon']");
  if (!link) {
    link = document.createElement("link");
    link.rel = "icon";
    document.head.append(link);
  }
  if (link.getAttribute("href") !== icon) link.setAttribute("href", icon);
}

function current() {
  const s = settings.value;
  const cloak = CLOAKS.find((entry) => entry.id === s.cloak) || CLOAKS[0];
  // "focus cloak": look like yourself while someone's using the tab, look like homework when they aren't
  if (s.focusCloak && document.visibilityState === "visible" && document.hasFocus()) return ORIGINAL;
  return cloak.id === "none" ? ORIGINAL : cloak;
}

export function isFramed() {
  try {
    return window.self !== window.top;
  } catch {
    return true;
  }
}

function launcherPage(appUrl) {
  const cloak = CLOAKS.find((entry) => entry.id === settings.value.cloak) || CLOAKS[0];
  const appearance = cloak.id === "none" ? { title: "about:blank", icon: "" } : cloak;
  const esc = (value) => String(value).replace(/[&<>"']/g, (char) => `&#${char.charCodeAt(0)};`);
  return `<!doctype html><html><head><title>${esc(appearance.title)}</title>${appearance.icon ? `<link rel="icon" href="${esc(appearance.icon)}">` : ""}</head><body style="margin:0;background:#000"><iframe src="${esc(appUrl)}" style="position:fixed;inset:0;width:100%;height:100%;border:0" allow="fullscreen; autoplay; clipboard-read; clipboard-write; gamepad"></iframe></body></html>`;
}

/** open blackwaves inside an about:blank or blob: tab so it never shows up in history */
export function launchCloaked(mode) {
  const appUrl = location.origin + "/";
  let popup = null;
  if (mode === "about:blank") {
    popup = window.open("about:blank", "_blank");
    if (popup) {
      popup.document.open();
      popup.document.write(launcherPage(appUrl));
      popup.document.close();
    }
  } else if (mode === "blob") {
    const url = URL.createObjectURL(new Blob([launcherPage(appUrl)], { type: "text/html" }));
    popup = window.open(url, "_blank");
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
  }
  return Boolean(popup && !popup.closed);
}

export function panic() {
  const url = settings.value.panicUrl || "https://classroom.google.com";
  // if we're inside an about:blank / blob: cloak, take the whole tab with us
  try {
    window.top.location.replace(url);
  } catch {
    location.replace(url);
  }
}

function onPanicKey(event) {
  const key = settings.value.panicKey;
  if (!key || event.key !== key) return;
  const target = event.target;
  if (target && target.nodeType === 1 && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName))) return;
  event.preventDefault();
  event.stopPropagation();
  panic();
}

/**
 * key presses inside iframes never reach this page, so the panic key wouldn't
 * work while you're in a game, the browser or a movie. everything we proxy runs
 * on our own origin, so we can reach into every frame (and frames inside those)
 * and listen there too. re-hooked on every load because navigation swaps documents.
 */
const hooked = new WeakSet();
function hookFrame(frame) {
  if (hooked.has(frame)) return;
  hooked.add(frame);
  const attach = () => {
    try {
      const doc = frame.contentDocument;
      if (!doc || doc.__bwPanic) return;
      doc.__bwPanic = true;
      doc.addEventListener("keydown", onPanicKey, true);
      watchFrames(doc);
    } catch {}
  };
  frame.addEventListener("load", attach);
  attach();
}

function watchFrames(doc) {
  try {
    doc.querySelectorAll("iframe, frame").forEach(hookFrame);
    new MutationObserver((records) => {
      for (const record of records) {
        for (const node of record.addedNodes) {
          if (node.nodeType !== 1) continue;
          if (node.tagName === "IFRAME" || node.tagName === "FRAME") hookFrame(node);
          else node.querySelectorAll?.("iframe, frame").forEach(hookFrame);
        }
      }
    }).observe(doc.documentElement, { childList: true, subtree: true });
  } catch {}
}

export function initCloak() {
  effect(() => {
    void settings.value.cloak;
    void settings.value.focusCloak;
    apply(current());
  });
  const refresh = () => setTimeout(() => apply(current()), 20);
  window.addEventListener("focus", refresh);
  window.addEventListener("blur", refresh);
  document.addEventListener("visibilitychange", refresh);

  // some pages (looking at you, proxied sites) love to rename our tab. no.
  const titleEl = document.querySelector("title");
  if (titleEl) {
    new MutationObserver(() => {
      if (document.title !== expectedTitle) document.title = expectedTitle;
    }).observe(titleEl, { childList: true, characterData: true, subtree: true });
  }

  document.addEventListener("keydown", onPanicKey, true);
  watchFrames(document);

  const mode = settings.value.autoLaunch;
  if (mode !== "off" && !isFramed() && !sessionStorage.getItem("bw-launched")) {
    const attempt = () => {
      if (!launchCloaked(mode)) return false;
      sessionStorage.setItem("bw-launched", "1");
      location.replace(settings.value.panicUrl || "https://classroom.google.com");
      return true;
    };
    // browsers block popups without a click, so if the first try fails we
    // quietly wait for the first click anywhere and try again
    window.addEventListener(
      "load",
      () => {
        if (!attempt()) window.addEventListener("pointerdown", attempt, { once: true, capture: true });
      },
      { once: true },
    );
  }
}
