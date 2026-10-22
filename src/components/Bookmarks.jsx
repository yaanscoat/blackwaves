import { useEffect, useState } from "preact/hooks";
import { Icon } from "./Icon.jsx";
import { Modal } from "./Modal.jsx";
import { storage } from "../lib/storage.js";
import { DEFAULT_BOOKMARKS } from "../data/catalogs.js";
import { faviconUrl } from "../lib/gameurl.js";
import { resolveInput } from "../lib/search.js";

function useBookmarks() {
  const [list, setList] = useState(() => storage.get("bookmarks") || DEFAULT_BOOKMARKS);
  useEffect(() => storage.on("bookmarks", (value) => setList(value || DEFAULT_BOOKMARKS)), []);
  return [list, (next) => storage.set("bookmarks", next)];
}

export function Bookmarks({ onOpen }) {
  const [list, save] = useBookmarks();
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState("");
  const [url, setUrl] = useState("");

  return (
    <div class="bookmarks">
      {list.map((mark, index) => (
        <div key={mark.url + index} class={`bookmark ${editing ? "wiggle" : ""}`} style={{ "--i": index }}>
          <button class="bookmark-btn" onClick={() => !editing && onOpen(mark.url)} aria-label={mark.title} data-tip={mark.title}>
            <span class="bookmark-icon glass">
              <img src={faviconUrl(mark.url)} alt="" loading="lazy" onError={(event) => (event.currentTarget.style.visibility = "hidden")} />
            </span>
          </button>
          {editing && (
            <button class="bookmark-remove" aria-label={`Remove ${mark.title}`} onClick={() => save(list.filter((_, i) => i !== index))}>
              <Icon name="x" size={12} />
            </button>
          )}
        </div>
      ))}
      <button class="bookmark-btn" onClick={() => setAdding(true)} aria-label="Add bookmark" data-tip="Add bookmark">
        <span class="bookmark-icon glass add">
          <Icon name="plus" />
        </span>
      </button>
      {list.length > 0 && (
        <button class="bookmark-btn" onClick={() => setEditing(!editing)} aria-label={editing ? "Done editing" : "Edit bookmarks"} data-tip={editing ? "Done" : "Edit bookmarks"}>
          <span class="bookmark-icon glass add">
            <Icon name={editing ? "check" : "edit"} size={18} />
          </span>
        </button>
      )}
      {adding && (
        <Modal title="Add a bookmark" onClose={() => setAdding(false)}>
          {(close) => (
            <form
              class="auth-form"
              onSubmit={(event) => {
                event.preventDefault();
                const resolved = resolveInput(url);
                if (!resolved) return;
                save([...list, { title: title.trim() || new URL(resolved).hostname, url: resolved }]);
                setTitle("");
                setUrl("");
                close();
              }}
            >
              <label class="field">
                <span>Address</span>
                <input class="input" placeholder="example.com" value={url} onInput={(e) => setUrl(e.currentTarget.value)} required />
              </label>
              <label class="field">
                <span>Name (optional)</span>
                <input class="input" value={title} onInput={(e) => setTitle(e.currentTarget.value)} maxLength={40} />
              </label>
              <button class="btn primary">Add bookmark</button>
            </form>
          )}
        </Modal>
      )}
    </div>
  );
}
