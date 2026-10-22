// the search bar spotlight, ported from lyra: a soft light that trails your
// cursor across any search field and lights up the rim it's closest to.
// one delegated listener for the whole app instead of one rAF loop per bar.
import { settings } from "../settings.js";

const SELECTOR = ".searchbox, .address, .composer";
let active = null;
let target = { x: 0, y: 0 };
let current = { x: 0, y: 0 };
let raf = 0;

function step() {
  if (!active) {
    raf = 0;
    return;
  }
  // ease toward the cursor so the light feels like it has a little weight
  current.x += (target.x - current.x) * 0.18;
  current.y += (target.y - current.y) * 0.18;
  active.style.setProperty("--lx", `${current.x.toFixed(1)}px`);
  active.style.setProperty("--ly", `${current.y.toFixed(1)}px`);
  if (Math.abs(target.x - current.x) > 0.3 || Math.abs(target.y - current.y) > 0.3) raf = requestAnimationFrame(step);
  else raf = 0;
}

function leave() {
  if (!active) return;
  active.removeAttribute("data-lit");
  active = null;
}

export function initSearchLight() {
  window.addEventListener(
    "pointermove",
    (event) => {
      const motion = settings.value.motion;
      if (motion === "off" || motion === "minimal") return leave();
      const el = event.target instanceof Element ? event.target.closest(SELECTOR) : null;
      if (el !== active) {
        leave();
        if (!el) return;
        active = el;
        const rect = el.getBoundingClientRect();
        current = { x: event.clientX - rect.left, y: event.clientY - rect.top };
        el.setAttribute("data-lit", "");
      }
      const rect = active.getBoundingClientRect();
      target = { x: event.clientX - rect.left, y: event.clientY - rect.top };
      if (!raf) raf = requestAnimationFrame(step);
    },
    { passive: true },
  );
  document.addEventListener("pointerleave", leave);
}
