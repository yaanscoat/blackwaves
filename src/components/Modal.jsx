import { useEffect, useRef, useState } from "preact/hooks";
import { Icon } from "./Icon.jsx";
import { attachLens } from "../lib/fx/lens.js";

let lensCount = 0;

export function Modal({ title, onClose, wide = false, children, class: className = "", hideHead = false }) {
  const [closing, setClosing] = useState(false);
  const panel = useRef(null);

  const close = () => {
    if (closing) return;
    setClosing(true);
    setTimeout(onClose, 190);
  };

  useEffect(() => attachLens(panel.current, `bw-lens-modal-${++lensCount}`, { strength: 45, bevel: 30 }), []);

  useEffect(() => {
    const onKey = (event) => event.key === "Escape" && close();
    window.addEventListener("keydown", onKey);
    const previous = document.activeElement;
    const field = panel.current?.querySelector("input:not([type=hidden]), textarea, select");
    (field || panel.current)?.focus({ preventScroll: true });
    return () => {
      window.removeEventListener("keydown", onKey);
      previous?.focus?.({ preventScroll: true });
    };
  }, []);

  return (
    <div class={`modal-backdrop ${closing ? "closing" : ""}`} onPointerDown={(event) => event.target === event.currentTarget && close()}>
      <div ref={panel} class={`modal glass liquid ${wide ? "wide" : ""} ${className}`} role="dialog" aria-modal="true" aria-label={title} tabIndex={-1}>
        {!hideHead && (
          <div class="modal-head">
            <h2>{title}</h2>
            <button class="btn ghost icon-only" onClick={close} aria-label="Close" data-tip="Close">
              <Icon name="x" />
            </button>
          </div>
        )}
        {typeof children === "function" ? children(close) : children}
      </div>
    </div>
  );
}
