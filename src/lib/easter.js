// hidden stuff. if you're reading this to find them all: that's cheating,
// but honestly we respect the hustle.
import { signal } from "@preact/signals";
import { storage } from "./storage.js";
import { toast } from "./notify.js";
import { confetti, emojiRain } from "./fx/overlay.js";

export const SECRETS = ["tsunami", "wavy", "neko", "barrel", "gravity", "party", "watermelon", "logo-spam"];
export const found = signal([]);

export function loadSecrets() {
  found.value = storage.get("secrets", []);
}

function discover(id, message) {
  if (!found.value.includes(id)) {
    found.value = [...found.value, id];
    storage.set("secrets", found.value);
    toast(`${message}  (${found.value.length}/${SECRETS.length} secrets)`, { kind: "success", timeout: 5000 });
  }
}

function typing(target) {
  return target instanceof HTMLElement && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName));
}

function flash(className, duration) {
  document.documentElement.classList.add(className);
  setTimeout(() => document.documentElement.classList.remove(className), duration);
}

export function tsunami() {
  const wave = document.createElement("div");
  wave.className = "egg-tsunami";
  wave.innerHTML = `<svg viewBox="0 0 1200 400" preserveAspectRatio="none"><path d="M0 400V180C120 60 260 20 380 90s200 160 340 110 220-170 340-150 120 60 140 80v270z"/></svg>`;
  document.body.append(wave);
  setTimeout(() => wave.remove(), 2600);
  discover("tsunami", "↑↑↓↓←→←→BA: you summoned a tsunami");
}

export function barrelRoll() {
  flash("egg-barrel", 1300);
  discover("barrel", "do a barrel roll: done");
}

export function partyMode() {
  flash("egg-party", 10_000);
  confetti(innerWidth - 120, innerHeight - 60, 90);
  discover("party", "party mode: you poked the online counter too much");
}

let logoClicks = [];
export function logoClicked(x, y) {
  confetti(x, y);
  const now = Date.now();
  logoClicks = [...logoClicks.filter((at) => now - at < 4000), now];
  if (logoClicks.length >= 10) {
    logoClicks = [];
    flash("egg-logo-spin", 1500);
    discover("logo-spam", "ok that's enough confetti for one day");
  }
}

let neko = null;
function toggleNeko() {
  if (neko) {
    neko.stop();
    neko = null;
    return;
  }
  // oneko: the little cat that chases your cursor. sprite sheet is 8x4 frames of 32px.
  const el = document.createElement("div");
  el.className = "egg-neko";
  document.body.append(el);
  let x = 32;
  let y = 32;
  let mx = x;
  let my = y;
  let frame = 0;
  let idle = 0;
  const sprites = {
    idle: [[-3, -3]],
    alert: [[-7, -3]],
    N: [[-1, -2], [-1, -3]],
    NE: [[0, -2], [0, -3]],
    E: [[-3, 0], [-3, -1]],
    SE: [[-5, -1], [-5, -2]],
    S: [[-6, -3], [-7, -2]],
    SW: [[-5, -3], [-6, -1]],
    W: [[-4, -2], [-4, -3]],
    NW: [[-1, 0], [-1, -1]],
    sleep: [[-2, 0], [-2, -1]],
  };
  const set = (name, f) => {
    const sprite = sprites[name][f % sprites[name].length];
    el.style.backgroundPosition = `${sprite[0] * 32}px ${sprite[1] * 32}px`;
  };
  const onMove = (event) => {
    mx = event.clientX;
    my = event.clientY;
  };
  window.addEventListener("pointermove", onMove);
  const timer = setInterval(() => {
    frame++;
    const dx = x - mx;
    const dy = y - my;
    const dist = Math.hypot(dx, dy);
    if (dist < 48) {
      idle++;
      set(idle > 40 ? "sleep" : "idle", Math.floor(frame / 4));
      return;
    }
    idle = 0;
    let dir = dy / dist > 0.5 ? "N" : dy / dist < -0.5 ? "S" : "";
    dir += dx / dist > 0.5 ? "W" : dx / dist < -0.5 ? "E" : "";
    set(dir || "idle", frame);
    x -= (dx / dist) * 10;
    y -= (dy / dist) * 10;
    el.style.transform = `translate(${x - 16}px, ${y - 16}px)`;
  }, 100);
  neko = {
    stop() {
      clearInterval(timer);
      window.removeEventListener("pointermove", onMove);
      el.remove();
    },
  };
  discover("neko", "a wild neko appeared. type neko again to send it home");
}

const WORDS = {
  blackwaves: () => {
    flash("egg-wavy", 2400);
    discover("wavy", "you said the magic word");
  },
  neko: toggleNeko,
  gravity: () => {
    flash("egg-gravity", 2600);
    discover("gravity", "gravity: still works");
  },
  watermelon: () => {
    emojiRain("🍉", 50);
    discover("watermelon", "hello, your son is a watermelon");
  },
};

const KONAMI = ["ArrowUp", "ArrowUp", "ArrowDown", "ArrowDown", "ArrowLeft", "ArrowRight", "ArrowLeft", "ArrowRight", "b", "a"];

export function initEasterEggs() {
  let typed = "";
  let konami = 0;
  window.addEventListener("keydown", (event) => {
    if (typing(event.target) || event.ctrlKey || event.metaKey || event.altKey) return;
    const key = event.key.length === 1 ? event.key.toLowerCase() : event.key;
    konami = key === KONAMI[konami] ? konami + 1 : key === KONAMI[0] ? 1 : 0;
    if (konami === KONAMI.length) {
      konami = 0;
      tsunami();
    }
    if (key.length !== 1) return;
    typed = (typed + key).slice(-12);
    for (const [word, run] of Object.entries(WORDS)) {
      if (typed.endsWith(word)) {
        typed = "";
        run();
      }
    }
  });
}
