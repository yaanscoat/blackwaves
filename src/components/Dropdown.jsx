// our own dropdown, in place of <select>: the native one opens a plain grey
// os list that ignores the theme. the list is portalled to <body> with fixed
// positioning so scrolling modals and overflow: hidden can't clip it, and it
// keeps the keyboard behaviour of a select (arrows, home/end, type to jump).
import { createPortal } from "preact/compat";
import { useEffect, useLayoutEffect, useRef, useState } from "preact/hooks";
import { Icon } from "./Icon.jsx";

let count = 0;
// lists this long get a search box
const SEARCH_FROM = 12;

/**
 * options: [{ value, label, hint?, icon? }]. `display` changes what the closed
 * button shows; `class` goes on the button.
 */
export function Dropdown({ value, options, onChange, label, class: className = "", disabled = false, icon, display, align = "start" }) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [query, setQuery] = useState("");
  const [place, setPlace] = useState(null);
  const button = useRef(null);
  const list = useRef(null);
  const typed = useRef({ text: "", at: 0 });
  const id = useRef(`bw-dd-${++count}`).current;

  const selected = options.find((option) => option.value === value);
  const needle = query.trim().toLowerCase();
  const shown = needle ? options.filter((option) => `${option.label} ${option.hint || ""}`.toLowerCase().includes(needle)) : options;
  const searchable = options.length >= SEARCH_FROM;

  const close = (refocus = true) => {
    setOpen(false);
    setPlace(null);
    setQuery("");
    if (refocus) button.current?.focus({ preventScroll: true });
  };
  const show = () => {
    if (disabled) return;
    setActive(Math.max(0, options.findIndex((option) => option.value === value)));
    setOpen(true);
  };
  const pick = (option) => {
    if (!option || option.disabled) return;
    close();
    if (option.value !== value) onChange(option.value);
  };

  // place the list under the button, or above it when there's no room below
  useLayoutEffect(() => {
    if (!open) return;
    const measure = () => {
      const box = button.current?.getBoundingClientRect();
      if (!box) return;
      const room = window.innerHeight - box.bottom - 12;
      const up = room < 240 && box.top > room;
      const width = Math.max(box.width, 200);
      const left = align === "end" ? box.right - width : box.left;
      setPlace({
        left: Math.max(8, Math.min(left, window.innerWidth - width - 8)),
        width,
        maxHeight: Math.min(360, (up ? box.top : room) - 12),
        ...(up ? { bottom: window.innerHeight - box.top + 6 } : { top: box.bottom + 6 }),
        up,
      });
    };
    measure();
    window.addEventListener("resize", measure);
    // a scrolling page or modal would leave the list floating; follow it
    window.addEventListener("scroll", measure, true);
    return () => {
      window.removeEventListener("resize", measure);
      window.removeEventListener("scroll", measure, true);
    };
  }, [open]);

  // the list only exists once it has been placed, so wait for that
  const shownList = open && place !== null;
  useEffect(() => {
    if (!shownList) return;
    const outside = (event) => {
      if (!list.current?.contains(event.target) && !button.current?.contains(event.target)) close(false);
    };
    document.addEventListener("pointerdown", outside, true);
    if (searchable) list.current?.querySelector("input")?.focus({ preventScroll: true });
    else list.current?.focus({ preventScroll: true });
    return () => document.removeEventListener("pointerdown", outside, true);
  }, [shownList]);

  // keep the highlighted one in view
  useEffect(() => {
    if (open) list.current?.querySelector(`#${id}-${active}`)?.scrollIntoView({ block: "nearest" });
  }, [open, active, place]);

  useEffect(() => setActive(0), [needle]);

  const move = (step) => {
    if (!shown.length) return;
    let next = active;
    for (let i = 0; i < shown.length; i++) {
      next = (next + step + shown.length) % shown.length;
      if (!shown[next].disabled) break;
    }
    setActive(next);
  };

  const onListKey = (event) => {
    const keys = {
      ArrowDown: () => move(1),
      ArrowUp: () => move(-1),
      Home: () => setActive(0),
      End: () => setActive(shown.length - 1),
      PageDown: () => setActive(Math.min(shown.length - 1, active + 8)),
      PageUp: () => setActive(Math.max(0, active - 8)),
      Enter: () => pick(shown[active]),
      Escape: () => close(),
      Tab: () => close(false),
    };
    if (event.key === " " && !searchable) keys[" "] = () => pick(shown[active]);
    if (keys[event.key]) {
      // escape would otherwise also close the modal we're in
      event.stopPropagation();
      if (event.key !== "Tab") event.preventDefault();
      keys[event.key]();
      return;
    }
    // type a few letters to jump, like a select
    if (!searchable && event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey) {
      const now = Date.now();
      typed.current = { text: (now - typed.current.at < 700 ? typed.current.text : "") + event.key.toLowerCase(), at: now };
      const hit = shown.findIndex((option) => option.label.toLowerCase().startsWith(typed.current.text));
      if (hit !== -1) setActive(hit);
    }
  };

  const onButtonKey = (event) => {
    if (open && event.key === "Escape") {
      event.stopPropagation();
      return close();
    }
    if (["ArrowDown", "ArrowUp", "Enter", " "].includes(event.key)) {
      event.preventDefault();
      show();
    }
  };

  return (
    <>
      <button
        ref={button}
        type="button"
        class={`dropdown ${open ? "open" : ""} ${className}`}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        aria-label={label}
        disabled={disabled}
        onClick={() => (open ? close() : show())}
        onKeyDown={onButtonKey}
      >
        {icon && <Icon name={icon} size={16} class="dropdown-lead" />}
        <span class="dropdown-value">{display ? display(selected) : selected?.label ?? ""}</span>
        <Icon name="down" size={12} class="dropdown-chevron" />
      </button>
      {open &&
        place &&
        createPortal(
          <div
            ref={list}
            id={id}
            class={`dropdown-list glass liquid ${place.up ? "up" : ""}`}
            style={{ left: place.left, top: place.top, bottom: place.bottom, width: place.width, maxHeight: place.maxHeight }}
            role="listbox"
            aria-label={label}
            aria-activedescendant={shown[active] ? `${id}-${active}` : undefined}
            tabIndex={-1}
            onKeyDown={onListKey}
          >
            {searchable && (
              <label class="dropdown-search">
                <Icon name="search" size={14} />
                <input value={query} onInput={(event) => setQuery(event.currentTarget.value)} placeholder="Search" aria-label={`Search ${label}`} spellcheck={false} />
              </label>
            )}
            <div class="dropdown-options">
              {shown.map((option, index) => (
                <div
                  key={option.value}
                  id={`${id}-${index}`}
                  class={`dropdown-option ${index === active ? "active" : ""}`}
                  role="option"
                  aria-selected={option.value === value}
                  aria-disabled={option.disabled || undefined}
                  onPointerMove={() => index !== active && setActive(index)}
                  onClick={() => pick(option)}
                >
                  {option.icon && <Icon name={option.icon} size={15} />}
                  <span class="dropdown-text">
                    <span>{option.label}</span>
                    {option.hint && <small>{option.hint}</small>}
                  </span>
                  {option.value === value && <Icon name="check" size={13} class="dropdown-check" />}
                </div>
              ))}
              {!shown.length && <p class="dropdown-empty">Nothing matches "{query.trim()}"</p>}
            </div>
          </div>,
          document.body,
        )}
    </>
  );
}
