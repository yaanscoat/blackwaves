import { useEffect, useRef, useState } from "preact/hooks";
import { Icon } from "./Icon.jsx";

export function Modal({ title, onClose, wide = false, children, class: className = "", hideHead = false }) {
  const [closing, setClosing] = useState(false);
  const panel = useRef(null);

  const close = () => {
    if (closing) return;
    setClosing(true);
    setTimeout(onClose, 190);
  };

  useEffect(() => {
    const onKey = (event) => event.key === "Escape" && close();
    window.addEventListener("keydown", onKey);
    const previous = document.activeElement;
    panel.current?.querySelector("input, button, [tabindex]")?.focus({ preventScroll: true });
    return () => {
      window.removeEventListener("keydown", onKey);
      previous?.focus?.({ preventScroll: true });
    };
  }, []);

  return (
    <div class={`modal-backdrop ${closing ? "closing" : ""}`} onPointerDown={(event) => event.target === event.currentTarget && close()}>
      <div ref={panel} class={`modal glass liquid ${wide ? "wide" : ""} ${className}`} role="dialog" aria-modal="true" aria-label={title}>
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
