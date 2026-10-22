import { useEffect, useRef, useState } from "preact/hooks";
import { Icon } from "./Icon.jsx";
import { fetchSuggestions } from "../lib/search.js";

/** a search input with a suggestions dropdown. used on home and in the new tab page. */
export function SearchBox({ placeholder, onSubmit, autoFocus = false, class: className = "", big = false }) {
  const [value, setValue] = useState("");
  const [items, setItems] = useState([]);
  const [index, setIndex] = useState(-1);
  const [open, setOpen] = useState(false);
  const input = useRef(null);
  const timer = useRef(0);

  useEffect(() => {
    if (autoFocus) input.current?.focus({ preventScroll: true });
  }, []);

  const update = (next) => {
    setValue(next);
    setIndex(-1);
    clearTimeout(timer.current);
    if (!next.trim()) {
      setItems([]);
      return;
    }
    timer.current = setTimeout(async () => {
      setItems(await fetchSuggestions(next));
      setOpen(true);
    }, 140);
  };

  const submit = (text) => {
    if (!text.trim()) return;
    setOpen(false);
    setItems([]);
    onSubmit(text.trim());
    setValue("");
  };

  const onKey = (event) => {
    if (event.key === "ArrowDown" && items.length) {
      event.preventDefault();
      setIndex((index + 1) % items.length);
    } else if (event.key === "ArrowUp" && items.length) {
      event.preventDefault();
      setIndex(index <= 0 ? items.length - 1 : index - 1);
    } else if (event.key === "Enter") {
      event.preventDefault();
      submit(index >= 0 ? items[index] : value);
    } else if (event.key === "Escape") {
      setOpen(false);
    }
  };

  return (
    <div class={`search-wrap ${big ? "big" : ""} ${className}`}>
      <div class="searchbox glass liquid">
        <Icon name="search" />
        <input
          ref={input}
          value={value}
          placeholder={placeholder}
          aria-label="Search the web or type a URL"
          autocomplete="off"
          spellcheck={false}
          onInput={(event) => update(event.currentTarget.value)}
          onKeyDown={onKey}
          onFocus={() => setOpen(true)}
          onBlur={() => setTimeout(() => setOpen(false), 150)}
        />
        {value && (
          <button class="btn ghost sm icon-only" aria-label="Clear" onClick={() => update("")}>
            <Icon name="x" size={16} />
          </button>
        )}
      </div>
      {open && items.length > 0 && (
        <ul class="suggestions glass" role="listbox">
          {items.map((item, i) => (
            <li key={item} role="option" aria-selected={i === index}>
              <button onMouseDown={(event) => event.preventDefault()} onClick={() => submit(item)}>
                <Icon name="search" size={15} />
                <span>{item}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
