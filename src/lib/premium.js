// blackwaves premium on the page side. premium lives on your cloudsync account
// (me.value.premium); the server turns it on when stripe tells it you paid.
import { signal } from "@preact/signals";
import { get } from "./api.js";
import { me, refreshMe } from "./account.js";
import { toast } from "./notify.js";

export const premiumOpen = signal(false);
// true while we're watching for a checkout someone just started in another tab
export const awaitingPayment = signal(false);

export const isPremium = () => Boolean(me.value?.premium);

export function openPremium() {
  premiumOpen.value = true;
}

/** runs `fn` for premium accounts and shows the premium page to everyone else */
export function premiumOnly(fn) {
  return (...args) => (isPremium() ? fn(...args) : openPremium());
}

export const PERKS = [
  { icon: "zap", title: "Priority search", body: "Your searches skip the line when blackwaves is busy, and your limits follow your account instead of your network." },
  { icon: "ai", title: "More AI, longer answers", body: "Over 3x the messages, replies up to 16,000 tokens, longer chat memory and more backup models when one is busy." },
  { icon: "sliders", title: "Custom instructions", body: "Tell blackwaves AI how to answer you (tone, length, what you're studying) once, and it remembers in every chat." },
  { icon: "attach", title: "Attach files", body: "Drop notes, essays, code or spreadsheets (as text) into a chat and ask about them." },
  { icon: "paraphrase", title: "Every rewrite style", body: "Formal, academic, creative, shorter and longer paraphrasing, plus casual, professional and student humanizer voices." },
  { icon: "file", title: "5x longer rewrites", body: "Paraphrase or humanize up to 25,000 characters at once instead of 5,000." },
  { icon: "crown", title: "Premium badge", body: "A crown on your profile and in chat." },
];

let watcher = null;

/**
 * opens stripe in a new tab, then keeps checking your account until premium
 * shows up (stripe tells the server within seconds of paying) or 20 minutes pass
 */
export async function startCheckout() {
  // fresh link, so it always carries the account that's signed in right now
  const status = await get("/api/premium");
  if (!status.signedIn || !status.checkout) throw new Error("sign in to CloudSync first");
  // (with "noopener" window.open always returns null, so cut the link by hand)
  const tab = window.open(status.checkout, "_blank");
  if (tab) tab.opener = null;
  else location.href = status.checkout;
  watchForPayment();
  return status;
}

export function watchForPayment() {
  clearInterval(watcher);
  awaitingPayment.value = true;
  const until = Date.now() + 20 * 60 * 1000;
  const check = async () => {
    if (!document.hidden) await refreshMe();
    if (isPremium() || Date.now() > until) stopWatching();
  };
  watcher = setInterval(check, 5000);
  window.addEventListener("focus", check);
  stopWatching.check = check;
}

function stopWatching() {
  clearInterval(watcher);
  watcher = null;
  if (stopWatching.check) window.removeEventListener("focus", stopWatching.check);
  awaitingPayment.value = false;
}

// premium can also arrive over the realtime socket (the server pushes your
// account when the payment lands), so this celebrates whichever comes first
let wasPremium = null;
me.subscribe((user) => {
  const now = Boolean(user?.premium);
  if (wasPremium === false && now) {
    toast("welcome to blackwaves Premium. thank you for supporting us!", { kind: "success" });
    stopWatching();
  }
  wasPremium = user ? now : null;
});
