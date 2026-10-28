import { signal } from "@preact/signals";
import { navigate } from "./router.js";
import { storage } from "./storage.js";

// tabs live here so they survive you wandering off to the games page and back
export const tabs = signal([]);
export const activeTab = signal(null);
export const browserVisited = signal(false);
let counter = 0;

export function newTab(url = "", { focus = true } = {}) {
  const tab = { id: ++counter, url, title: url ? "Loading..." : "New tab", favicon: "", loading: Boolean(url), nav: 0 };
  tabs.value = [...tabs.value, tab];
  if (focus) activeTab.value = tab.id;
  browserVisited.value = true;
  return tab;
}

export function openInBrowser(url) {
  const current = tabs.value.find((tab) => tab.id === activeTab.value);
  if (current && !current.url) updateTab(current.id, { url, title: "Loading...", loading: true, nav: current.nav + 1 });
  else newTab(url);
  navigate("/browser");
}

export function updateTab(id, patch) {
  tabs.value = tabs.value.map((tab) => (tab.id === id ? { ...tab, ...patch } : tab));
}

/** drag-to-reorder: drops tab `id` where tab `target` currently sits */
export function moveTab(id, target) {
  const list = [...tabs.value];
  const from = list.findIndex((tab) => tab.id === id);
  const to = list.findIndex((tab) => tab.id === target);
  if (from < 0 || to < 0 || from === to) return;
  list.splice(to, 0, list.splice(from, 1)[0]);
  tabs.value = list;
}

export function closeTab(id) {
  const index = tabs.value.findIndex((tab) => tab.id === id);
  const next = tabs.value.filter((tab) => tab.id !== id);
  tabs.value = next;
  if (activeTab.value === id) activeTab.value = next[Math.max(0, index - 1)]?.id ?? null;
  if (!next.length) newTab();
}

export function addHistory(url, title) {
  if (!url || url.startsWith("about:")) return;
  const history = storage.get("history", []);
  if (history[0]?.url === url) {
    if (title && history[0].title !== title) {
      history[0] = { ...history[0], title };
      storage.set("history", history);
    }
    return;
  }
  storage.set("history", [{ url, title: title || url, at: Date.now() }, ...history].slice(0, 300));
}
