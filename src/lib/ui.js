import { signal } from "@preact/signals";

export const settingsOpen = signal(null); // null or the tab id to open on
export const authOpen = signal(null); // null | "login" | "register"

export function openSettings(tab = "appearance") {
  settingsOpen.value = tab;
}

export function openAuth(mode = "login") {
  authOpen.value = mode;
}

export const NAV = [
  { id: "home", path: "/", icon: "home", label: "Home", key: "h" },
  { id: "browser", path: "/browser", icon: "browser", label: "Browser", key: "b" },
  { id: "games", path: "/games", icon: "games", label: "Games", key: "g" },
  { id: "movies", path: "/movies", icon: "movies", label: "Movies & shows", key: "m" },
  { id: "music", path: "/music", icon: "music", label: "Music", key: "u" },
  { id: "manga", path: "/manga", icon: "manga", label: "Manga", key: "r" },
  { id: "cloud", path: "/cloud", icon: "cloud", label: "Cloud gaming", key: "l" },
  { id: "chat", path: "/chat", icon: "chat", label: "Chat", key: "c" },
  { id: "ai", path: "/ai", icon: "ai", label: "AI", key: "a" },
  { id: "shop", path: "/shop", icon: "shop", label: "Shop", key: "s" },
];
