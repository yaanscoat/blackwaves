import { signal } from "@preact/signals";
import { get, post, patch } from "./api.js";
import { on, reconnect } from "./realtime.js";
import { notify, toast } from "./notify.js";
import { navigate, route } from "./router.js";
import { startSync, stopSync } from "./cloudsync.js";

export const me = signal(null);
export const coinPulse = signal(0);

export async function refreshMe() {
  try {
    const { user } = await get("/api/auth/me");
    me.value = user;
    if (user) startSync();
  } catch {
    me.value = null;
  }
}

export async function login(username, password) {
  const { user } = await post("/api/auth/login", { username, password });
  me.value = user;
  reconnect();
  startSync({ fresh: true });
  toast(`signed in as ${user.displayName}`, { kind: "success" });
  return user;
}

export async function register(username, password, displayName) {
  const { user } = await post("/api/auth/register", { username, password, displayName });
  me.value = user;
  reconnect();
  startSync({ fresh: true });
  toast(`welcome to blackwaves, ${user.displayName}. here's 150 coins.`, { kind: "success" });
  return user;
}

export async function logout() {
  await post("/api/auth/logout");
  stopSync();
  me.value = null;
  reconnect();
  toast("signed out");
}

export async function updateProfile(fields) {
  const { user } = await patch("/api/profile", fields);
  me.value = user;
  return user;
}

export async function claimDaily() {
  const result = await post("/api/coins/daily");
  me.value = result.user;
  coinPulse.value++;
  toast(`+${result.amount} coins · day ${result.streak} streak`, { kind: "coins" });
  return result;
}

export function canClaimDaily(user = me.value) {
  if (!user) return false;
  return new Date(user.dailyAt || 0).toISOString().slice(0, 10) !== new Date().toISOString().slice(0, 10);
}

on("me", ({ user }) => {
  me.value = user;
});

on("coins", ({ coins, earned }) => {
  if (!me.value) return;
  me.value = { ...me.value, coins };
  if (earned) coinPulse.value++;
});

on("mention", ({ message }) => {
  notify({ title: `${message.author.displayName} mentioned you`, body: message.content.slice(0, 120), icon: "chat", href: `/chat/${message.channel}` });
  if (!route.value.startsWith("/chat")) {
    toast(`${message.author.displayName} mentioned you in #${message.channel}`, { action: { label: "open", run: () => navigate(`/chat/${message.channel}`) } });
  }
});

on("dm", ({ message }) => {
  if (route.value === `/chat/${message.channel}`) return;
  notify({ title: `new message from ${message.author.displayName}`, body: message.content.slice(0, 120), icon: "chat", href: `/chat/${message.channel}` });
  toast(`${message.author.displayName}: ${message.content.slice(0, 60)}`, { action: { label: "reply", run: () => navigate(`/chat/${message.channel}`) } });
});
