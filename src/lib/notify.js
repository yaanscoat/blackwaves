import { signal } from "@preact/signals";
import { storage } from "./storage.js";

export const toasts = signal([]);
export const notifications = signal([]);
let counter = 0;

export function toast(message, { kind = "info", timeout = 3800, action } = {}) {
  const id = ++counter;
  toasts.value = [...toasts.value.slice(-3), { id, message, kind, action, leaving: false }];
  setTimeout(() => dismissToast(id), timeout);
  return id;
}

export function dismissToast(id) {
  toasts.value = toasts.value.map((entry) => (entry.id === id ? { ...entry, leaving: true } : entry));
  setTimeout(() => {
    toasts.value = toasts.value.filter((entry) => entry.id !== id);
  }, 260);
}

export function loadNotifications() {
  notifications.value = storage.get("notifications", []);
}

/** things that land behind the bell. they stick around until you clear them. */
export function notify({ title, body = "", icon = "bell", href = "" }) {
  const entry = { id: `${Date.now()}-${++counter}`, title, body, icon, href, at: Date.now(), read: false };
  notifications.value = [entry, ...notifications.value].slice(0, 50);
  storage.set("notifications", notifications.value);
  return entry;
}

export function markAllRead() {
  notifications.value = notifications.value.map((entry) => ({ ...entry, read: true }));
  storage.set("notifications", notifications.value);
}

export function clearNotifications() {
  notifications.value = [];
  storage.set("notifications", []);
}
