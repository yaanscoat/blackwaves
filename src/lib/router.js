import { signal } from "@preact/signals";

export const route = signal(location.pathname);

export function navigate(path, { replace = false } = {}) {
  if (path === location.pathname + location.search) return;
  if (replace) history.replaceState(null, "", path);
  else history.pushState(null, "", path);
  route.value = location.pathname;
  window.scrollTo({ top: 0 });
}

window.addEventListener("popstate", () => {
  route.value = location.pathname;
});

/** "/movies/tv/1399" -> ["movies", "tv", "1399"] */
export function segments(path = route.value) {
  return path.split("/").filter(Boolean).map((part) => {
    try {
      return decodeURIComponent(part);
    } catch {
      return part;
    }
  });
}

export function section(path = route.value) {
  return segments(path)[0] || "home";
}
