import { signal, effect } from "@preact/signals";
import { storage } from "./storage.js";
import { THEME_BY_ID } from "../data/themes.js";

export const DEFAULTS = {
  theme: "abyss",
  accent: "",
  glass: true,
  glassStrength: 60,
  glassStyle: "liquid",
  glassRefraction: 55,
  glassSheen: true,
  topbarStyle: "floating",
  topbarSize: "regular",
  topbarLabels: "hover",
  topbarIndicator: "dot",
  topbarBrand: true,
  topbarMagnify: true,
  topbarHidden: [],
  motion: "full",
  background: "tide",
  particles: "dust",
  particleDensity: 50,
  cursorTrail: "off",
  clickSparks: true,
  browserMode: false,
  bookmarksBar: true,
  searchEngine: "duckduckgo",
  transport: "epoxy",
  gameSource: "gn-math",
  cloak: "none",
  focusCloak: false,
  autoLaunch: "off",
  panicKey: "`",
  panicUrl: "https://classroom.google.com",
  showOnline: true,
  showLocation: true,
  suggestions: true,
  confirmClose: false,
  musicQuality: "HIGH",
};

export const settings = signal({ ...DEFAULTS });

export function loadSettings() {
  settings.value = { ...DEFAULTS, ...(storage.get("settings") || {}) };
}

export function setSetting(key, value) {
  settings.value = { ...settings.value, [key]: value };
  storage.set("settings", settings.value);
  storage.set("settingsUpdatedAt", Date.now());
}

export function resetSettings() {
  settings.value = { ...DEFAULTS };
  storage.set("settings", settings.value);
}

function hexToRgb(hex) {
  const value = parseInt(hex.slice(1), 16);
  return `${(value >> 16) & 255} ${(value >> 8) & 255} ${value & 255}`;
}

/** push the current settings onto <html> as css variables and data attributes */
export function startApplyingSettings() {
  effect(() => {
    const s = settings.value;
    const root = document.documentElement;
    const theme = THEME_BY_ID.get(s.theme) || THEME_BY_ID.get("abyss");
    const accent = s.accent || theme.accent;
    root.style.setProperty("--bg", theme.bg);
    root.style.setProperty("--surface", theme.surface);
    root.style.setProperty("--text", theme.text);
    root.style.setProperty("--accent", accent);
    root.style.setProperty("--bg-rgb", hexToRgb(theme.bg));
    root.style.setProperty("--surface-rgb", hexToRgb(theme.surface));
    root.style.setProperty("--text-rgb", hexToRgb(theme.text));
    root.style.setProperty("--accent-rgb", hexToRgb(accent));
    root.style.setProperty("--glass-blur", `${Math.round(6 + s.glassStrength * 0.22)}px`);
    root.style.setProperty("--glass-alpha", String(0.62 - s.glassStrength * 0.0042));
    root.dataset.light = theme.light ? "true" : "false";
    root.dataset.glass = s.glass ? "on" : "off";
    root.dataset.motion = s.motion;
    root.dataset.browserMode = s.browserMode ? "on" : "off";
    root.dataset.glassStyle = s.glassStyle;
    root.dataset.sheen = s.glassSheen ? "on" : "off";
    root.dataset.tbStyle = s.topbarStyle;
    root.dataset.tbSize = s.topbarSize;
    root.dataset.tbLabels = s.topbarLabels;
    root.dataset.tbIndicator = s.topbarIndicator;
    root.dataset.tbBrand = s.topbarBrand ? "on" : "off";
    document.querySelector('meta[name="theme-color"]')?.setAttribute("content", theme.bg);
    document.querySelector('meta[name="color-scheme"]')?.setAttribute("content", theme.light ? "light" : "dark");
  });
}

export const motionScale = () => ({ full: 1, reduced: 0.5, minimal: 0, off: 0 })[settings.value.motion] ?? 1;
