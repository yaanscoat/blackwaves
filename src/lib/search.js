import { ENGINES } from "../data/catalogs.js";
import { settings } from "./settings.js";

const TLD_HINT = /^[a-z0-9-]+(\.[a-z0-9-]+)+(:\d+)?(\/.*)?$/i;

/** turns whatever you typed into a url: a real url, a domain, or a search */
export function resolveInput(raw) {
  const input = raw.trim();
  if (!input) return "";
  if (/^https?:\/\//i.test(input)) return input;
  if (!/\s/.test(input) && TLD_HINT.test(input)) return `https://${input}`;
  if (/^localhost(:\d+)?(\/|$)/i.test(input)) return `http://${input}`;
  const engine = ENGINES.find((entry) => entry.id === settings.value.searchEngine) || ENGINES[0];
  return engine.url.replace("%s", encodeURIComponent(input));
}

let suggestController = null;

export async function fetchSuggestions(query) {
  if (!settings.value.suggestions || !query.trim()) return [];
  suggestController?.abort();
  suggestController = new AbortController();
  try {
    const response = await fetch(`/api/suggest?q=${encodeURIComponent(query)}`, { signal: suggestController.signal });
    if (!response.ok) return [];
    return (await response.json()).suggestions || [];
  } catch {
    return [];
  }
}
