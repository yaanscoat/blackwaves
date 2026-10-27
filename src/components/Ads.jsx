import { useEffect } from "preact/hooks";
import { NATIVE, SPONSOR_URL, adsAllowed, injectScript } from "../lib/ads.js";

/**
 * the native banner. its script fills the container by id when it loads, so we
 * add a fresh copy of the script every time the slot appears (pages come and go).
 */
export function NativeAd({ class: className = "" }) {
  const allowed = adsAllowed();
  useEffect(() => {
    if (!allowed) return;
    const script = injectScript(NATIVE.src);
    return () => script.remove();
  }, [allowed]);
  if (!allowed) return null;
  return (
    <aside class={`ad-slot ${className}`} aria-label="Sponsored">
      <span class="ad-label">Sponsored</span>
      <div id={NATIVE.id} />
    </aside>
  );
}

export function SponsorLink() {
  if (!adsAllowed()) return null;
  return (
    <a class="ad-sponsor" href={SPONSOR_URL} target="_blank" rel="sponsored noopener">
      Check out our sponsor
    </a>
  );
}
