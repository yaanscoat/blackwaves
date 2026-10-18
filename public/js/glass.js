// Liquid glass. Each registered surface gets its own SVG filter whose
// displacement map is generated for that surface's exact size and corner
// radius, so the refraction bends around the rim like a lens. A turbulence
// layer mixed into the map is the "fluid" part, and it drifts when motion is
// on full. Only Chromium can feed an SVG filter into backdrop-filter; other
// browsers keep the frosted fallback in styles.css.
const svgNS = "http://www.w3.org/2000/svg";

const chromium = (() => {
    const brands = navigator.userAgentData?.brands;
    if (brands)
        return brands.some(brand => /Chromium|Google Chrome|Microsoft Edge|Opera|Brave/i.test(brand.brand));
    return /Chrome\/\d+/.test(navigator.userAgent) && !/Firefox|FxiOS|Edg\/1[0-7]\b/.test(navigator.userAgent);
})();

let defs = null;
let level = 0;
let motion = 3;
let counter = 0;
let animation = 0;
const surfaces = new Map();

const ensureDefs = () => {
    if (defs)
        return defs;
    const root = document.createElementNS(svgNS, "svg");
    root.setAttribute("aria-hidden", "true");
    root.setAttribute("width", "0");
    root.setAttribute("height", "0");
    root.style.cssText = "position:fixed;width:0;height:0;pointer-events:none";
    defs = document.createElementNS(svgNS, "defs");
    root.append(defs);
    document.body.prepend(root);
    return defs;
};

const el = (name, attrs) => {
    const node = document.createElementNS(svgNS, name);
    for (const [key, value] of Object.entries(attrs))
        node.setAttribute(key, String(value));
    return node;
};

// Signed-distance rounded rectangle -> edge normals encoded in R/G.
const buildMap = (width, height, radius) => {
    const scale = width * height > 200000 ? 0.35 : 0.5;
    const cw = Math.max(2, Math.ceil(width * scale));
    const ch = Math.max(2, Math.ceil(height * scale));
    const canvas = document.createElement("canvas");
    canvas.width = cw;
    canvas.height = ch;
    const ctx = canvas.getContext("2d");
    const image = ctx.createImageData(cw, ch);
    const data = image.data;
    const r = Math.min(radius, width / 2, height / 2);
    const bevel = Math.max(10, Math.min(r * 1.15, Math.min(width, height) * 0.42, 46));
    const hx = width / 2, hy = height / 2;
    for (let y = 0; y < ch; y++) {
        const py = (y + 0.5) / scale - hy;
        for (let x = 0; x < cw; x++) {
            const px = (x + 0.5) / scale - hx;
            const qx = Math.abs(px) - (hx - r);
            const qy = Math.abs(py) - (hy - r);
            const ox = Math.max(qx, 0), oy = Math.max(qy, 0);
            const outside = Math.hypot(ox, oy);
            const sdf = outside + Math.min(Math.max(qx, qy), 0) - r;
            const depth = -sdf;
            let nx = 0, ny = 0, mag = 0;
            if (depth > 0 && depth < bevel) {
                if (qx > 0 && qy > 0) {
                    nx = ox / (outside || 1);
                    ny = oy / (outside || 1);
                }
                else if (qx > qy)
                    nx = 1;
                else
                    ny = 1;
                nx *= Math.sign(px) || 1;
                ny *= Math.sign(py) || 1;
                const t = 1 - depth / bevel;
                mag = t * t * (3 - 2 * t);
            }
            const i = (y * cw + x) * 4;
            data[i] = 128 - nx * mag * 127;
            data[i + 1] = 128 - ny * mag * 127;
            data[i + 2] = 128;
            data[i + 3] = 255;
        }
    }
    ctx.putImageData(image, 0, 0);
    return canvas.toDataURL();
};

const params = () => ({
    scale: 14 + level * 86,
    fluid: level * 0.42,
    blur: Math.max(2.5, 16 - level * 12),
    saturate: 140 + level * 70
});

const updateFilter = (surface) => {
    const { scale, fluid } = params();
    surface.composite.setAttribute("k3", String(fluid));
    surface.composite.setAttribute("k4", String(-fluid / 2));
    surface.displace.setAttribute("scale", String(scale));
};

const applyStyle = (surface) => {
    const { element } = surface;
    if (!chromium || level === 0 || !surface.ready) {
        element.style.removeProperty("backdrop-filter");
        element.style.removeProperty("-webkit-backdrop-filter");
        element.classList.remove("is-liquid");
        return;
    }
    const { blur, saturate } = params();
    const value = `blur(${blur.toFixed(1)}px) url(#${surface.id}) saturate(${saturate.toFixed(0)}%) brightness(1.04)`;
    element.style.setProperty("backdrop-filter", value);
    element.style.setProperty("-webkit-backdrop-filter", value);
    element.classList.add("is-liquid");
};

const rebuild = (surface) => {
    const { element } = surface;
    const rect = element.getBoundingClientRect();
    const width = Math.round(element.offsetWidth || rect.width);
    const height = Math.round(element.offsetHeight || rect.height);
    if (width < 4 || height < 4)
        return;
    if (width === surface.width && height === surface.height && surface.ready)
        return;
    surface.width = width;
    surface.height = height;
    const radius = parseFloat(getComputedStyle(element).borderTopLeftRadius) || 0;
    surface.filter.setAttribute("width", String(width));
    surface.filter.setAttribute("height", String(height));
    surface.image.setAttribute("width", String(width));
    surface.image.setAttribute("height", String(height));
    surface.image.setAttribute("href", buildMap(width, height, radius));
    surface.ready = true;
    applyStyle(surface);
};

const observer = new ResizeObserver(entries => {
    for (const entry of entries) {
        const surface = surfaces.get(entry.target);
        if (!surface)
            continue;
        cancelAnimationFrame(surface.pending);
        surface.pending = requestAnimationFrame(() => rebuild(surface));
    }
});

export const register = (element) => {
    if (surfaces.has(element))
        return;
    element.classList.add("glass");
    // The specular sheen follows the pointer on every browser.
    element.addEventListener("pointermove", event => {
        const rect = element.getBoundingClientRect();
        element.style.setProperty("--mx", `${(((event.clientX - rect.left) / rect.width) * 100).toFixed(1)}%`);
        element.style.setProperty("--my", `${(((event.clientY - rect.top) / rect.height) * 100).toFixed(1)}%`);
    }, { passive: true });
    if (!chromium) {
        surfaces.set(element, { element });
        return;
    }
    const id = `bw-liquid-${++counter}`;
    const filter = el("filter", {
        id,
        x: 0,
        y: 0,
        width: 1,
        height: 1,
        filterUnits: "userSpaceOnUse",
        primitiveUnits: "userSpaceOnUse",
        "color-interpolation-filters": "sRGB"
    });
    const image = el("feImage", { x: 0, y: 0, width: 1, height: 1, preserveAspectRatio: "none", result: "edge" });
    const seed = counter * 7 + 3;
    const turbulence = el("feTurbulence", { type: "fractalNoise", baseFrequency: "0.011 0.016", numOctaves: 2, seed, result: "noise" });
    const composite = el("feComposite", { in: "edge", in2: "noise", operator: "arithmetic", k1: 0, k2: 1, k3: 0, k4: 0, result: "map" });
    const displace = el("feDisplacementMap", { in: "SourceGraphic", in2: "map", scale: 0, xChannelSelector: "R", yChannelSelector: "G" });
    filter.append(image, turbulence, composite, displace);
    ensureDefs().append(filter);
    const surface = { element, id, filter, image, turbulence, composite, displace, seed, ready: false, width: 0, height: 0, pending: 0 };
    surfaces.set(element, surface);
    updateFilter(surface);
    observer.observe(element);
};

export const unregister = (element) => {
    const surface = surfaces.get(element);
    if (!surface)
        return;
    observer.unobserve(element);
    surface.filter?.remove();
    surfaces.delete(element);
};

// Slow drift of the fluid noise so the glass looks like it is moving.
const animate = (now) => {
    animation = requestAnimationFrame(animate);
    if (document.hidden)
        return;
    const t = now * 0.00025;
    for (const surface of surfaces.values()) {
        if (!surface.turbulence)
            continue;
        const fx = 0.011 + Math.sin(t + surface.seed) * 0.0022;
        const fy = 0.016 + Math.cos(t * 0.8 + surface.seed) * 0.0028;
        surface.turbulence.setAttribute("baseFrequency", `${fx.toFixed(5)} ${fy.toFixed(5)}`);
    }
};

const syncAnimation = () => {
    const want = chromium && level > 0 && motion >= 3;
    if (want && !animation)
        animation = requestAnimationFrame(animate);
    else if (!want && animation) {
        cancelAnimationFrame(animation);
        animation = 0;
    }
};

export const configure = ({ liquid, motion: motionLevel }) => {
    if (typeof liquid === "number")
        level = Math.max(0, Math.min(1, liquid / 100));
    if (typeof motionLevel === "number")
        motion = motionLevel;
    document.documentElement.style.setProperty("--liquid", level.toFixed(2));
    for (const surface of surfaces.values()) {
        if (!surface.filter)
            continue;
        updateFilter(surface);
        applyStyle(surface);
    }
    syncAnimation();
};

export const supportsLiquid = chromium;
