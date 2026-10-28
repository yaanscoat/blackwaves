// liquid glass lenses. each glass element gets its own svg filter whose
// displacement map is drawn for that element's exact size and corner radius:
// flat in the middle, curving hard at the bevel, so the backdrop bends at the
// edges the way it does through a thick slab of glass. chromium is the only
// engine that runs svg filters inside backdrop-filter, so this is a bonus layer
// on top of regular frosted glass, not a requirement.
import { settings } from "../settings.js";

const NS = "http://www.w3.org/2000/svg";
let defs = null;
const lenses = new Map();

function ensureDefs() {
  if (defs) return defs;
  const svg = document.createElementNS(NS, "svg");
  svg.setAttribute("width", "0");
  svg.setAttribute("height", "0");
  svg.setAttribute("aria-hidden", "true");
  svg.style.position = "absolute";
  defs = document.createElementNS(NS, "defs");
  svg.append(defs);
  document.body.append(svg);
  return defs;
}

/** signed distance from (px, py) to a rounded rectangle centered at the origin */
function roundedRectSdf(px, py, hw, hh, r) {
  const qx = Math.abs(px) - (hw - r);
  const qy = Math.abs(py) - (hh - r);
  const ox = Math.max(qx, 0);
  const oy = Math.max(qy, 0);
  return Math.hypot(ox, oy) + Math.min(Math.max(qx, qy), 0) - r;
}

/**
 * builds the displacement map. red/green = how far to push the sample along x/y,
 * 128 means "leave it alone". we compute at half resolution because the map is
 * smooth anyway and the filter scales it back up.
 */
function buildMap(width, height, radius, bevel) {
  const scale = 0.5;
  const w = Math.max(8, Math.round(width * scale));
  const h = Math.max(8, Math.round(height * scale));
  const r = Math.min(radius * scale, w / 2, h / 2);
  const b = Math.max(2, bevel * scale);
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  const image = ctx.createImageData(w, h);
  const data = image.data;
  const hw = w / 2;
  const hh = h / 2;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const px = x + 0.5 - hw;
      const py = y + 0.5 - hh;
      const d = -roundedRectSdf(px, py, hw, hh, r);
      let dx = 0;
      let dy = 0;
      if (d > 0 && d < b) {
        // the surface normal is the gradient of the distance field
        const gx = roundedRectSdf(px + 1, py, hw, hh, r) - roundedRectSdf(px - 1, py, hw, hh, r);
        const gy = roundedRectSdf(px, py + 1, hw, hh, r) - roundedRectSdf(px, py - 1, hw, hh, r);
        const len = Math.hypot(gx, gy) || 1;
        // a circular bevel profile: steepest right at the rim, flat by the time it reaches the face
        const t = 1 - d / b;
        const strength = 1 - Math.sqrt(1 - t * t);
        dx = (gx / len) * strength;
        dy = (gy / len) * strength;
      }
      const i = (y * w + x) * 4;
      data[i] = 128 + dx * 127;
      data[i + 1] = 128 + dy * 127;
      data[i + 2] = 128;
      data[i + 3] = 255;
    }
  }
  ctx.putImageData(image, 0, 0);
  return canvas.toDataURL();
}

function el(name, attrs = {}, parent) {
  const node = document.createElementNS(NS, name);
  for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, value);
  parent?.append(node);
  return node;
}

/**
 * the filter: displace the backdrop through the lens map, three times with
 * slightly different strengths for red, green and blue, then recombine. that
 * gives the faint rainbow fringe real glass has right at the edge.
 */
function buildFilter(id) {
  const filter = el("filter", { id, x: "0", y: "0", width: "100%", height: "100%", filterUnits: "userSpaceOnUse", "color-interpolation-filters": "sRGB" });
  const image = el("feImage", { result: "map", preserveAspectRatio: "none", x: "0", y: "0" }, filter);
  const channels = [
    ["r", "1 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 1 0", 1],
    ["g", "0 0 0 0 0  0 1 0 0 0  0 0 0 0 0  0 0 0 1 0", 0.94],
    ["b", "0 0 0 0 0  0 0 0 0 0  0 0 1 0 0  0 0 0 1 0", 0.88],
  ];
  const maps = [];
  for (const [name, matrix, factor] of channels) {
    const displaced = el("feDisplacementMap", { in: "SourceGraphic", in2: "map", xChannelSelector: "R", yChannelSelector: "G", result: `d${name}` }, filter);
    el("feColorMatrix", { in: `d${name}`, type: "matrix", values: matrix, result: `c${name}` }, filter);
    maps.push([displaced, factor]);
  }
  el("feBlend", { in: "cr", in2: "cg", mode: "screen", result: "rg" }, filter);
  el("feBlend", { in: "rg", in2: "cb", mode: "screen" }, filter);
  return { filter, image, maps };
}

function update(lens) {
  const { node, parts, options } = lens;
  const width = Math.round(node.offsetWidth);
  const height = Math.round(node.offsetHeight);
  if (!width || !height) return;
  const radius = parseFloat(getComputedStyle(node).borderTopLeftRadius) || 0;
  const key = `${width}x${height}r${radius}`;
  if (lens.key !== key) {
    lens.key = key;
    parts.image.setAttribute("href", buildMap(width, height, radius, options.bevel ?? Math.min(26, height * 0.42)));
    parts.image.setAttribute("width", String(width));
    parts.image.setAttribute("height", String(height));
    parts.filter.setAttribute("width", String(width));
    parts.filter.setAttribute("height", String(height));
  }
  const amount = (settings.value.glassRefraction / 100) * (options.strength ?? 70);
  for (const [map, factor] of parts.maps) map.setAttribute("scale", String((amount * factor).toFixed(1)));
}

/** give an element a lens. returns a cleanup function. */
export function attachLens(node, id, options = {}) {
  if (!node) return () => {};
  ensureDefs();
  const parts = buildFilter(id);
  defs.append(parts.filter);
  const lens = { node, parts, options, key: "" };
  lenses.set(id, lens);
  node.style.setProperty("--lens", `url(#${id})`);
  update(lens);
  const observer = new ResizeObserver(() => update(lens));
  observer.observe(node);
  return () => {
    observer.disconnect();
    parts.filter.remove();
    lenses.delete(id);
  };
}

/** called when the refraction slider moves */
export function refreshLenses() {
  for (const lens of lenses.values()) update(lens);
}

// ---- the specular sheen: a soft highlight that slides toward your cursor -----------------

let sheenTarget = null;
export function initSheen() {
  window.addEventListener(
    "pointermove",
    (event) => {
      if (!settings.value.glassSheen || settings.value.motion === "off") return;
      const target = event.target instanceof Element ? event.target.closest(".sheen") : null;
      if (sheenTarget && sheenTarget !== target) sheenTarget.removeAttribute("data-sheen");
      sheenTarget = target;
      if (!target) return;
      const rect = target.getBoundingClientRect();
      target.style.setProperty("--sx", `${event.clientX - rect.left}px`);
      target.style.setProperty("--sy", `${event.clientY - rect.top}px`);
      target.setAttribute("data-sheen", "");
    },
    { passive: true },
  );
}
