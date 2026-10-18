import * as storage from "./storage.js";
import { themeIds } from "./themes.js";
const text = (max = 200) => (value, fallback) => {
    const s = typeof value === "string" ? value.trim() : "";
    return s.length <= max ? s : fallback;
};
const bool = (value, fallback) => typeof value === "boolean" ? value : fallback;
const oneOf = (allowed) => (value, fallback) => allowed.includes(value) ? value : fallback;
const int = (min, max) => (value, fallback) => {
    const n = typeof value === "string" ? Number(value) : value;
    return Number.isFinite(n) ? Math.min(max, Math.max(min, Math.round(n))) : fallback;
};
const httpUrl = (value, fallback) => {
    const s = typeof value === "string" ? value.trim() : "";
    if (!s)
        return "";
    try {
        const url = new URL(s);
        return ["http:", "https:"].includes(url.protocol) ? url.href : fallback;
    }
    catch {
        return fallback;
    }
};
const iconUrl = (value, fallback) => {
    const s = typeof value === "string" ? value.trim() : "";
    if (!s)
        return "";
    if (s.startsWith("data:image/"))
        return s.length < 200000 ? s : fallback;
    return httpUrl(s, fallback);
};
const transportIds = [
    "libcurl",
    "epoxy",
    "bare"
];
const wispUrl = (value, fallback) => {
    const s = typeof value === "string" ? value.trim() : "";
    if (!s)
        return "";
    try {
        const url = new URL(s);
        if (!["ws:", "wss:"].includes(url.protocol))
            return fallback;
        if (url.username || url.password || url.hash || s.includes("?"))
            return fallback;
        if (location.protocol === "https:" && url.protocol !== "wss:")
            return fallback;
        if (!url.pathname.endsWith("/"))
            url.pathname += "/";
        return url.href;
    }
    catch {
        return fallback;
    }
};
export const searchEngines = [
    { id: "duckduckgo", label: "DuckDuckGo", domain: "duckduckgo.com", template: "https://duckduckgo.com/?q=%s", home: "https://duckduckgo.com/" },
    { id: "brave", label: "Brave", domain: "search.brave.com", template: "https://search.brave.com/search?q=%s", home: "https://search.brave.com/" },
    { id: "google", label: "Google", domain: "google.com", template: "https://www.google.com/search?q=%s", home: "https://www.google.com/" },
    { id: "bing", label: "Bing", domain: "bing.com", template: "https://www.bing.com/search?q=%s", home: "https://www.bing.com/" },
    { id: "startpage", label: "Startpage", domain: "startpage.com", template: "https://www.startpage.com/sp/search?query=%s", home: "https://www.startpage.com/" },
    { id: "yahoo", label: "Yahoo", domain: "search.yahoo.com", template: "https://search.yahoo.com/search?p=%s", home: "https://search.yahoo.com/" },
    { id: "ecosia", label: "Ecosia", domain: "ecosia.org", template: "https://www.ecosia.org/search?q=%s", home: "https://www.ecosia.org/" },
    { id: "qwant", label: "Qwant", domain: "qwant.com", template: "https://www.qwant.com/?q=%s", home: "https://www.qwant.com/" },
    { id: "mojeek", label: "Mojeek", domain: "mojeek.com", template: "https://www.mojeek.com/search?q=%s", home: "https://www.mojeek.com/" },
    { id: "yandex", label: "Yandex", domain: "yandex.com", template: "https://yandex.com/search/?text=%s", home: "https://yandex.com/" }
];
export const engineById = (id) => searchEngines.find(engine => engine.id === id) ?? searchEngines[0];
export const gameSources = [
    { id: "all", label: "All sources" },
    { id: "gn-math", label: "gn-math" },
    { id: "seraph", label: "Seraph" },
    { id: "truffled", label: "Truffled" },
    { id: "ckv", label: "CKV" },
    { id: "ugs", label: "UGS" }
];
// Fifteen disguises plus "none" and "custom". Icons come through the
// server's favicon relay so they work under cross-origin isolation.
export const cloakPresets = [
    { id: "none", label: "None", title: "", domain: "" },
    { id: "classroom", label: "Google Classroom", title: "Home", domain: "classroom.google.com" },
    { id: "drive", label: "Google Drive", title: "My Drive - Google Drive", domain: "drive.google.com" },
    { id: "docs", label: "Google Docs", title: "Google Docs", domain: "docs.google.com" },
    { id: "slides", label: "Google Slides", title: "Google Slides", domain: "slides.google.com" },
    { id: "forms", label: "Google Forms", title: "Google Forms", domain: "forms.google.com" },
    { id: "gmail", label: "Gmail", title: "Inbox - Gmail", domain: "mail.google.com" },
    { id: "google", label: "Google", title: "Google", domain: "google.com" },
    { id: "canvas", label: "Canvas", title: "Dashboard", domain: "instructure.com" },
    { id: "schoology", label: "Schoology", title: "Home | Schoology", domain: "schoology.com" },
    { id: "clever", label: "Clever", title: "Clever | Portal", domain: "clever.com" },
    { id: "khan", label: "Khan Academy", title: "Dashboard | Khan Academy", domain: "khanacademy.org" },
    { id: "desmos", label: "Desmos", title: "Desmos | Graphing Calculator", domain: "desmos.com" },
    { id: "quizlet", label: "Quizlet", title: "Your Sets | Quizlet", domain: "quizlet.com" },
    { id: "kahoot", label: "Kahoot!", title: "Kahoot!", domain: "kahoot.it" },
    { id: "wikipedia", label: "Wikipedia", title: "Wikipedia, the free encyclopedia", domain: "wikipedia.org" },
    { id: "custom", label: "Custom", title: "", domain: "" }
];
export const iconFor = (domain) => domain ? new URL(`/api/icon/${domain}`, location.href).href : "";
export const bgEffects = [
    { id: "dust", label: "Dust & light" },
    { id: "snow", label: "Snow" },
    { id: "rain", label: "Rain" },
    { id: "sparks", label: "Fire sparks" },
    { id: "plain", label: "Plain black" }
];
export const motionLevels = ["Minimal", "Reduced", "Balanced", "Full"];
export const transports = [
    { id: "libcurl", label: "libcurl", detail: "curl in WebAssembly, over wisp. Widest site compatibility." },
    { id: "epoxy", label: "epoxy", detail: "A Rust TLS stack in WebAssembly, over wisp. Smaller than libcurl." },
    { id: "bare", label: "bare", detail: "Request/response only. Works on serverless hosts, but WebSocket sites will not." }
];
export const schema = {
    // preferences
    searchEngine: { default: "duckduckgo", validate: oneOf(searchEngines.map(engine => engine.id)) },
    gameSource: { default: "all", validate: oneOf(gameSources.map(source => source.id)) },
    preventClose: { default: false, validate: bool },
    // appearance
    theme: { default: "blackwaves", validate: oneOf(themeIds) },
    motion: { default: 3, validate: int(0, 3) },
    liquid: { default: 0, validate: int(0, 100) },
    lighting: { default: true, validate: bool },
    bgEffect: { default: "dust", validate: oneOf(bgEffects.map(effect => effect.id)) },
    bgDim: { default: 35, validate: int(0, 90) },
    customBg: { default: false, validate: bool },
    // cloaking
    cloakPreset: { default: "none", validate: oneOf(cloakPresets.map(preset => preset.id)) },
    cloakTitle: { default: "", validate: text(120) },
    cloakFavicon: { default: "", validate: iconUrl },
    autoCloak: { default: "off", validate: oneOf(["off", "aboutblank", "blob"]) },
    cloakRedirect: { default: "https://classroom.google.com/", validate: httpUrl },
    // advanced
    transport: { default: "libcurl", validate: oneOf(transportIds) },
    wispUrl: { default: "", validate: wispUrl },
    preloadSearch: { default: true, validate: bool },
    saveCookies: { default: true, validate: bool },
    saveHistory: { default: true, validate: bool },
    saveSiteData: { default: true, validate: bool }
};
export const defaults = Object.fromEntries(Object.entries(schema).map(([key, def]) => [key, def.default]));
const storeKey = "settings";
let current = null;
const listeners = new Set();
const validate = (raw) => {
    const out = {};
    const rejected = [];
    for (const [name, entry] of Object.entries(schema)) {
        const def = entry;
        const incoming = raw?.[name];
        if (incoming === undefined) {
            out[name] = def.default;
            continue;
        }
        const invalid = Symbol(name);
        const value = def.validate(incoming, invalid);
        if (value === invalid) {
            rejected.push(name);
            out[name] = def.default;
        }
        else {
            out[name] = value;
        }
    }
    return { settings: out, rejected };
};
export const load = () => {
    if (current)
        return current;
    current = validate(storage.read(storeKey, {})).settings;
    return current;
};
export const get = (name) => load()[name];
export const all = () => ({ ...load() });
const commit = (settings, rejected, previous) => {
    current = settings;
    const persisted = storage.write(storeKey, settings);
    const changed = Object.keys(settings).filter(key => settings[key] !== previous[key]);
    if (changed.length)
        for (const fn of listeners)
            fn(settings, changed, rejected);
    return { settings, rejected, persisted, changed };
};
export const set = (patch) => {
    const previous = load();
    const { settings, rejected } = validate({ ...previous, ...patch });
    return commit(settings, rejected, previous);
};
// Replace everything at once, e.g. when CloudSync pulls an account.
export const replace = (raw) => {
    const previous = load();
    const { settings, rejected } = validate(raw);
    return commit(settings, rejected, previous);
};
export const reset = () => {
    const previous = load();
    return commit({ ...defaults }, [], previous);
};
export const onChange = (fn) => {
    listeners.add(fn);
    return () => listeners.delete(fn);
};
