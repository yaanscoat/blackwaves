// ads keep blackwaves free. they only load for people who said yes to them on
// the welcome screen (or later in settings > browser), because the ad networks
// set their own cookies.
import { effect } from "@preact/signals";
import { consent } from "../components/Welcome.jsx";

const SITE_WIDE = ["https://abscloud.org/1/a69c1cf61bdf88014ceb4bbd2eaa771d", "https://bauval.org/14/1e0c4bb224bb07eeb34d25e32aeaeef8"];
export const NATIVE = { id: "container-0c733ac60250f60ea2f0ffc39771d27e", src: "https://bauval.org/21/0c733ac60250f60ea2f0ffc39771d27e" };
export const SPONSOR_URL = "https://araplhn.org/4/c20c087b904f418669bb94b70c46efe6";

export const adsAllowed = () => Boolean(consent.value?.ads);

export function injectScript(src) {
  const script = document.createElement("script");
  script.src = src;
  script.async = true;
  script.setAttribute("data-cfasync", "false");
  document.head.append(script);
  return script;
}

// ---- an ad tab every few clicks ----------------------------------------------------
// every 3 to 6 clicks (a fresh random number each time) the sponsor link opens in
// a new tab. it has to happen inside the click itself or the popup blocker eats it.
// the count lives in sessionStorage so reloading doesn't reset it.
const CLICKS_MIN = 3;
const CLICKS_MAX = 6;
// clicks that never count: typing into things, the cookie screen, the ads switch,
// and the ads themselves (they open their own tabs)
const IGNORE = 'input, textarea, select, [contenteditable="true"], .welcome, [aria-label="Show ads"], .ad-slot, .ad-sponsor';

const nextTarget = () => CLICKS_MIN + Math.floor(Math.random() * (CLICKS_MAX - CLICKS_MIN + 1));

function readCounter() {
  try {
    const saved = JSON.parse(sessionStorage.getItem("bw_adclicks") || "null");
    if (saved && saved.count >= 0 && saved.target >= CLICKS_MIN) return saved;
  } catch {}
  return { count: 0, target: nextTarget() };
}

function saveCounter(state) {
  try {
    sessionStorage.setItem("bw_adclicks", JSON.stringify(state));
  } catch {}
}

function onClick(event) {
  if (!event.isTrusted || event.button !== 0 || !adsAllowed()) return;
  if (event.target instanceof Element && event.target.closest(IGNORE)) return;
  const state = readCounter();
  state.count += 1;
  if (state.count >= state.target) {
    window.open(SPONSOR_URL, "_blank", "noopener");
    state.count = 0;
    state.target = nextTarget();
  }
  saveCounter(state);
}

let started = false;
export function initAds() {
  effect(() => {
    if (started || !adsAllowed()) return;
    started = true;
    for (const src of SITE_WIDE) injectScript(src);
    document.addEventListener("click", onClick, true);
  });
}
