// custom cursor packs (made by scripts/process-cursors.js). browsers only show
// still cursor images, and they'd need every `cursor: pointer` in our css
// rewritten to use them. so instead, whenever the mouse moves onto an element we
// read the cursor it wants (pointer, text, wait...) and put the pack's version
// on just that element as an inline style. animated cursors are the same thing
// with the image swapped on a timer, which only touches that one element.
import { signal, effect } from "@preact/signals";
import { settings, motionScale } from "./settings.js";

const BASE = "/assets/cursors/";

/** the packs from index.json, or null until they've loaded */
export const cursorPacks = signal(null);

// css cursor keyword -> the cursor a pack draws for it. keywords not listed
// (none, zoom-in, a url of our own...) are left alone.
const ROLES = {
  auto: "default",
  default: "default",
  "context-menu": "default",
  alias: "default",
  copy: "default",
  cell: "crosshair",
  pointer: "pointer",
  text: "text",
  "vertical-text": "text",
  help: "help",
  wait: "wait",
  progress: "progress",
  crosshair: "crosshair",
  move: "move",
  "all-scroll": "move",
  grab: "grab",
  grabbing: "grabbing",
  "not-allowed": "not-allowed",
  "no-drop": "not-allowed",
  "ns-resize": "ns-resize",
  "n-resize": "ns-resize",
  "s-resize": "ns-resize",
  "row-resize": "ns-resize",
  "ew-resize": "ew-resize",
  "e-resize": "ew-resize",
  "w-resize": "ew-resize",
  "col-resize": "ew-resize",
  "nwse-resize": "nwse-resize",
  "nw-resize": "nwse-resize",
  "se-resize": "nwse-resize",
  "nesw-resize": "nesw-resize",
  "ne-resize": "nesw-resize",
  "sw-resize": "nesw-resize",
};
// what to use when a pack doesn't draw that one
const FALLBACK = { grab: "pointer", grabbing: "move", progress: "wait", wait: "progress" };
const TYPING = 'input:not([type=button],[type=submit],[type=reset],[type=checkbox],[type=radio],[type=range],[type=color],[type=file],[type=image]), textarea, [contenteditable=""], [contenteditable=true]';

export function loadCursorPacks() {
  if (cursorPacks.value) return Promise.resolve(cursorPacks.value);
  return fetch(`${BASE}index.json`)
    .then((response) => (response.ok ? response.json() : []))
    .catch(() => [])
    .then((packs) => (cursorPacks.value = packs));
}

export const cursorUrl = (pack, file) => `${BASE}${pack.id}/${file}`;

let pack = null;
let preloaded = [];
// the element wearing our cursor right now
let current = null;
let timer = 0;

function roleFor(element) {
  // our own style has to come off first, or we'd just read it back
  const cursor = getComputedStyle(element).cursor;
  // the page drew its own (like the try-it-on previews in settings)
  if (cursor.includes("url(")) return null;
  const keyword = cursor.split(",").pop().trim();
  let role = ROLES[keyword];
  if (!role) return null;
  // auto is the browser's "text over text, arrow elsewhere"; we can only tell for fields
  if (keyword === "auto" && element.closest(TYPING)) role = "text";
  const entry = pack.roles[role] || pack.roles[FALLBACK[role]];
  return entry ? { entry, keyword } : null;
}

function paint() {
  const { element, entry, keyword, step } = current;
  const file = entry.frames[step % entry.frames.length];
  const value = `url("${cursorUrl(pack, file)}") ${entry.hot[0]} ${entry.hot[1]}, ${keyword === "auto" ? "default" : keyword}`;
  element.style.setProperty("cursor", value, "important");
  current.value = element.style.getPropertyValue("cursor");
}

function animate() {
  clearTimeout(timer);
  const { entry } = current;
  if (!entry.ms || motionScale() === 0 || matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  timer = setTimeout(function tick() {
    if (!current) return;
    current.step = (current.step + 1) % entry.frames.length;
    paint();
    timer = setTimeout(tick, entry.ms[current.step]);
  }, entry.ms[current.step]);
}

function release() {
  clearTimeout(timer);
  if (!current) return;
  const { element, before, priority, value } = current;
  // leave it be if the page has set its own cursor there since
  if (element.style.getPropertyValue("cursor") === value) {
    if (before) element.style.setProperty("cursor", before, priority);
    else element.style.removeProperty("cursor");
  }
  current = null;
}

function wear(element) {
  if (current?.element === element) return;
  release();
  if (!pack || !(element instanceof Element) || !element.style) return;
  const before = element.style.getPropertyValue("cursor");
  const priority = element.style.getPropertyPriority("cursor");
  const found = roleFor(element);
  if (!found) return;
  current = { element, before, priority, ...found, step: 0, value: "" };
  paint();
  animate();
}

function onOver(event) {
  if (event.pointerType && event.pointerType !== "mouse") return;
  wear(event.composedPath?.()[0] || event.target);
}

export function initCursors() {
  effect(() => {
    const id = settings.value.cursorPack;
    // re-read motion so turning animation off applies straight away
    void settings.value.motion;
    release();
    if (!id || id === "none") {
      pack = null;
      preloaded = [];
      return;
    }
    loadCursorPacks().then((packs) => {
      if (settings.value.cursorPack !== id) return;
      pack = packs.find((entry) => entry.id === id) || null;
      if (!pack) return;
      // fetch every frame now so the cursor doesn't blink while one loads
      const files = new Set(Object.values(pack.roles).flatMap((entry) => entry.frames));
      preloaded = [...files].map((file) => Object.assign(new Image(), { src: cursorUrl(pack, file) }));
      const hovered = document.querySelectorAll(":hover");
      if (hovered.length) wear(hovered[hovered.length - 1]);
    });
  });
  document.addEventListener("pointerover", onOver, { capture: true, passive: true });
  // the hovered element can change cursor without the mouse moving (a button
  // turning disabled, a drag starting); re-check it on clicks and keys
  for (const type of ["pointerup", "pointerdown", "keyup"]) {
    document.addEventListener(
      type,
      () => {
        if (!current) return;
        const { element } = current;
        release();
        wear(element);
      },
      { capture: true, passive: true },
    );
  }
}
