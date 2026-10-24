import { useEffect, useRef, useState } from "preact/hooks";
import { Icon } from "../components/Icon.jsx";
import { SearchBox } from "../components/SearchBox.jsx";
import { Bookmarks, useBookmarks } from "../components/Bookmarks.jsx";
import { Avatar } from "../components/Avatar.jsx";
import { openProfile } from "../components/ProfileCard.jsx";
import { tabs, activeTab, newTab, closeTab, updateTab, addHistory, moveTab } from "../lib/browser.js";
import { createFrame, decodeFrameUrl, proxyReady } from "../lib/proxy.js";
import { resolveInput } from "../lib/search.js";
import { faviconUrl } from "../lib/gameurl.js";
import { settings, setSetting } from "../lib/settings.js";
import { storage } from "../lib/storage.js";
import { toast } from "../lib/notify.js";
import { NAV, openSettings, openAuth } from "../lib/ui.js";
import { navigate } from "../lib/router.js";
import { me } from "../lib/account.js";
import { randomSearchMessage } from "../data/catalogs.js";

const frames = new Map();
let dragging = null;

// chrome hides the scheme and www and dims everything after the host
function splitUrl(url) {
  const match = /^https?:\/\/(?:www\.)?([^/?#]+)(.*)$/.exec(url || "");
  if (!match) return { host: url || "", rest: "" };
  return { host: match[1], rest: match[2] === "/" ? "" : match[2] };
}

function Dropdown({ icon, label, children, class: className = "" }) {
  const [open, setOpen] = useState(false);
  const wrap = useRef(null);
  useEffect(() => {
    if (!open) return;
    const away = (event) => !wrap.current?.contains(event.target) && setOpen(false);
    const key = (event) => event.key === "Escape" && setOpen(false);
    // iframes swallow clicks, so losing focus to one counts as clicking away
    const blur = () => setTimeout(() => document.activeElement?.tagName === "IFRAME" && setOpen(false), 0);
    window.addEventListener("pointerdown", away);
    window.addEventListener("keydown", key);
    window.addEventListener("blur", blur);
    return () => {
      window.removeEventListener("pointerdown", away);
      window.removeEventListener("keydown", key);
      window.removeEventListener("blur", blur);
    };
  }, [open]);
  return (
    <div class={`bm-drop ${className}`} ref={wrap}>
      <button class={`bm-btn ${open ? "on" : ""}`} aria-label={label} data-tip={open ? undefined : label} aria-expanded={open} onClick={() => setOpen(!open)}>
        {typeof icon === "string" ? <Icon name={icon} size={18} stroke={icon === "dots" ? 3 : 1.75} /> : icon}
      </button>
      {open && (
        <div class="bm-menu" role="menu" onClick={(event) => event.target.closest(".menu-item") && setOpen(false)}>
          {children}
        </div>
      )}
    </div>
  );
}

function BookmarkBar({ onOpen }) {
  const [list] = useBookmarks();
  return (
    <div class="bm-bookmarks" role="toolbar" aria-label="Bookmarks bar">
      {list.length === 0 && <span class="bm-bookmarks-empty">Bookmark pages with the star to see them here.</span>}
      {list.map((mark, index) => (
        <button key={mark.url + index} class="bm-mark" title={`${mark.title}\n${mark.url}`} onClick={() => onOpen(mark.url)} onAuxClick={(event) => event.button === 1 && newTab(mark.url)}>
          <img src={faviconUrl(mark.url)} alt="" loading="lazy" onError={(event) => (event.currentTarget.style.visibility = "hidden")} />
          <span>{mark.title}</span>
        </button>
      ))}
    </div>
  );
}

function TabFrame({ tab, active }) {
  const iframe = useRef(null);
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setError("");
    createFrame(iframe.current)
      .then((frame) => {
        if (cancelled) return;
        frames.set(tab.id, frame);
        frame.go(tab.url);
      })
      .catch((err) => !cancelled && setError(err.message || "the proxy couldn't start"));
    return () => {
      cancelled = true;
      frames.delete(tab.id);
    };
  }, [retry]);

  // address bar navigations bump tab.nav
  useEffect(() => {
    const frame = frames.get(tab.id);
    if (frame && tab.nav) frame.go(tab.url);
  }, [tab.nav]);

  // there's no event for "the page inside navigated", so we peek every so often
  useEffect(() => {
    if (!active) return;
    const timer = setInterval(() => {
      try {
        const win = iframe.current?.contentWindow;
        if (!win) return;
        const real = decodeFrameUrl(win.location.href);
        const title = win.document?.title?.trim();
        const patch = {};
        if (real && real !== tab.url) {
          patch.url = real;
          patch.favicon = faviconUrl(real);
          addHistory(real, title);
        }
        if (title && title !== tab.title) patch.title = title;
        if (tab.loading && win.document?.readyState === "complete") patch.loading = false;
        if (Object.keys(patch).length) updateTab(tab.id, patch);
      } catch {}
    }, 700);
    return () => clearInterval(timer);
  }, [active, tab.url, tab.title, tab.loading]);

  return (
    <div class="tab-view" hidden={!active}>
      {error ? (
        <div class="empty">
          <Icon name="browser" />
          <h3>The proxy didn't start</h3>
          <p>{error}</p>
          <button class="btn" onClick={() => setRetry(retry + 1)}>
            Try again
          </button>
        </div>
      ) : (
        <iframe
          ref={iframe}
          class="tab-frame"
          title={tab.title}
          allow="fullscreen; autoplay; clipboard-read; clipboard-write; encrypted-media; gamepad; picture-in-picture"
          onLoad={() => updateTab(tab.id, { loading: false })}
        />
      )}
    </div>
  );
}

function NewTabPage({ tab }) {
  const [placeholder] = useState(randomSearchMessage);
  const go = (url) => updateTab(tab.id, { url, title: "Loading...", loading: true, nav: tab.nav + 1, favicon: faviconUrl(url) });
  return (
    <div class="newtab">
      <img class="logo-img newtab-logo" src="/favicon.ico" alt="" />
      <SearchBox big autoFocus placeholder={placeholder} onSubmit={(text) => go(resolveInput(text))} />
      <Bookmarks onOpen={go} />
    </div>
  );
}

export function Browser({ visible }) {
  const list = tabs.value;
  const active = list.find((tab) => tab.id === activeTab.value) || list[0];
  const [address, setAddress] = useState("");
  const [editing, setEditing] = useState(false);
  const browserMode = settings.value.browserMode;
  const [bookmarks, saveBookmarks] = useBookmarks();

  useEffect(() => {
    if (!list.length) newTab();
    storage.set("browserUsed", true);
    void proxyReady().catch(() => {});
  }, []);

  useEffect(() => {
    if (!editing) setAddress(active?.url || "");
  }, [active?.id, active?.url, editing]);

  useEffect(() => {
    if (!settings.value.confirmClose) return;
    const warn = (event) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [settings.value.confirmClose]);

  // ctrl+t / ctrl+w only steal the shortcut when the browser is on screen
  useEffect(() => {
    if (!visible) return;
    const onKey = (event) => {
      if (!(event.ctrlKey || event.metaKey) || !event.altKey) return;
      if (event.code === "KeyT") {
        event.preventDefault();
        newTab();
      } else if (event.code === "KeyW" && active) {
        event.preventDefault();
        closeTab(active.id);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [visible, active?.id]);

  if (!active) return null;
  const frame = () => frames.get(active.id);

  const go = (event) => {
    event.preventDefault();
    const text = address.trim();
    setEditing(false);
    if (!text) return;
    const url = resolveInput(text);
    updateTab(active.id, { url, title: "Loading...", loading: true, nav: active.nav + 1, favicon: faviconUrl(url) });
    event.currentTarget.querySelector("input")?.blur();
  };

  const marked = bookmarks.some((mark) => mark.url === active.url);
  const bookmark = () => {
    if (!active.url) return;
    if (marked) {
      saveBookmarks(bookmarks.filter((mark) => mark.url !== active.url));
      return toast("removed from bookmarks");
    }
    saveBookmarks([...bookmarks, { title: active.title || splitUrl(active.url).host, url: active.url }]);
    toast("bookmarked", { kind: "success" });
  };

  const openHere = (url) => updateTab(active.id, { url, title: "Loading...", loading: true, nav: active.nav + 1, favicon: faviconUrl(url) });
  const goHome = () => updateTab(active.id, { url: "", title: "New tab", favicon: "", loading: false });
  const fullscreen = () => document.querySelector(`.tab-view:not([hidden])`)?.requestFullscreen?.();
  const { host, rest } = splitUrl(active.url);
  const secure = active.url?.startsWith("https://");

  return (
    <section class={`browser ${browserMode ? "chrome-mode" : ""}`} hidden={!visible} aria-label="Proxy browser">
      <div class={`browser-chrome ${browserMode ? "" : "glass liquid"}`}>
        <div class="tabstrip" role="tablist" onDblClick={(event) => browserMode && event.target === event.currentTarget && newTab()}>
          {list.map((tab) => (
            <div
              key={tab.id}
              role="tab"
              aria-selected={tab.id === active.id}
              class={`tab ${tab.id === active.id ? "active" : ""}`}
              onClick={() => (activeTab.value = tab.id)}
              onAuxClick={(event) => event.button === 1 && closeTab(tab.id)}
              title={tab.title}
              draggable={browserMode}
              onDragStart={(event) => {
                dragging = tab.id;
                event.dataTransfer.effectAllowed = "move";
              }}
              onDragOver={(event) => {
                event.preventDefault();
                if (dragging && dragging !== tab.id) moveTab(dragging, tab.id);
              }}
              onDragEnd={() => (dragging = null)}
            >
              {tab.loading ? <span class="spinner tab-spin" /> : tab.favicon ? <img class="tab-icon" src={tab.favicon} alt="" /> : <Icon name="browser" size={15} />}
              <span class="tab-title">{tab.title || "New tab"}</span>
              <button
                class="tab-close"
                aria-label="Close tab"
                onClick={(event) => {
                  event.stopPropagation();
                  closeTab(tab.id);
                }}
              >
                <Icon name="x" size={13} />
              </button>
            </div>
          ))}
          <button class="tab-new" aria-label="New tab" data-tip="New tab" onClick={() => newTab()}>
            <Icon name="plus" size={16} />
          </button>
        </div>
        <div class="toolbar">
          <button class="btn ghost icon-only sm" aria-label="Back" data-tip="Back" onClick={() => frame()?.back()} disabled={!active.url}>
            <Icon name="back" size={17} />
          </button>
          <button class="btn ghost icon-only sm" aria-label="Forward" data-tip="Forward" onClick={() => frame()?.forward()} disabled={!active.url}>
            <Icon name="forward" size={17} />
          </button>
          <button class="btn ghost icon-only sm" aria-label="Reload" data-tip="Reload" onClick={() => frame()?.reload()} disabled={!active.url}>
            <Icon name="refresh" size={17} />
          </button>
          {browserMode && (
            <button class="btn ghost icon-only sm" aria-label="New tab page" data-tip="Home" onClick={goHome}>
              <Icon name="home" size={17} />
            </button>
          )}
          <form class={`address ${browserMode && !editing && active.url ? "pretty" : ""}`} onSubmit={go}>
            {browserMode ? (
              <span class={`omni-chip ${active.url ? "" : "blank"}`} data-tip={active.url ? (secure ? "Connection is secure" : "Not secure") : undefined}>
                <Icon name={!active.url ? "search" : secure ? "lock" : "info"} size={14} />
              </span>
            ) : (
              <Icon name={secure ? "lock" : "search"} size={15} />
            )}
            <span class="omni-field">
              <input
                value={address}
                placeholder={browserMode ? "Search the web or type a URL" : "Search or type a URL"}
                aria-label="Address"
                spellcheck={false}
                onFocus={(event) => {
                  setEditing(true);
                  event.currentTarget.select();
                }}
                onBlur={() => setEditing(false)}
                onInput={(event) => setAddress(event.currentTarget.value)}
              />
              {browserMode && !editing && active.url && (
                <span class="omni-display" aria-hidden="true">
                  <b>{host}</b>
                  {rest}
                </span>
              )}
            </span>
            {browserMode && active.url && (
              <button type="button" class={`omni-star ${marked ? "on" : ""}`} aria-label={marked ? "Remove bookmark" : "Bookmark this tab"} data-tip={marked ? "Edit bookmark" : "Bookmark this tab"} onClick={bookmark}>
                <Icon name="star" size={16} fill={marked} />
              </button>
            )}
          </form>
          {browserMode ? (
            <>
              <Dropdown icon="grid" label="blackwaves apps">
                <div class="bm-apps">
                  {NAV.filter((item) => item.id !== "browser").map((item) => (
                    <button key={item.id} class="menu-item bm-app" onClick={() => navigate(item.path)}>
                      <Icon name={item.icon} size={20} />
                      <span>{item.label.split(" ")[0]}</span>
                    </button>
                  ))}
                </div>
              </Dropdown>
              <button
                class="bm-btn bm-profile"
                aria-label={me.value ? me.value.displayName : "Sign in"}
                data-tip={me.value ? me.value.displayName : "Sign in"}
                onClick={() => (me.value ? openProfile(me.value.username) : openAuth("login"))}
              >
                {me.value ? <Avatar user={me.value} size={26} /> : <Icon name="user" size={18} />}
              </button>
              <Dropdown icon="dots" label="Customize and control blackwaves">
                <button class="menu-item" onClick={() => newTab()}>
                  <Icon name="plus" size={17} /> New tab <kbd>Ctrl+Alt+T</kbd>
                </button>
                <button class="menu-item" onClick={() => closeTab(active.id)}>
                  <Icon name="x" size={17} /> Close tab <kbd>Ctrl+Alt+W</kbd>
                </button>
                <div class="menu-sep" />
                <button class="menu-item" onClick={bookmark} disabled={!active.url}>
                  <Icon name="star" size={17} /> {marked ? "Remove bookmark" : "Bookmark this tab"}
                </button>
                <button class="menu-item" onClick={() => setSetting("bookmarksBar", !settings.value.bookmarksBar)}>
                  <Icon name="bookmark" size={17} /> {settings.value.bookmarksBar ? "Hide bookmarks bar" : "Show bookmarks bar"}
                </button>
                <button class="menu-item" onClick={fullscreen} disabled={!active.url}>
                  <Icon name="fullscreen" size={17} /> Full screen
                </button>
                <div class="menu-sep" />
                <button class="menu-item" onClick={() => openSettings()}>
                  <Icon name="settings" size={17} /> Settings
                </button>
                <button class="menu-item" onClick={() => (setSetting("browserMode", false), navigate("/"))}>
                  <Icon name="logout" size={17} /> Exit browser mode
                </button>
              </Dropdown>
            </>
          ) : (
            <>
              <button class="btn ghost icon-only sm" aria-label="Bookmark this page" data-tip="Bookmark" onClick={bookmark} disabled={!active.url}>
                <Icon name="star" size={17} fill={marked} />
              </button>
              <button class="btn ghost icon-only sm" aria-label="Fullscreen" data-tip="Fullscreen" onClick={fullscreen} disabled={!active.url}>
                <Icon name="fullscreen" size={17} />
              </button>
              <button class="btn ghost icon-only sm" aria-label="Back to blackwaves" data-tip="Home" onClick={() => navigate("/")}>
                <Icon name="home" size={17} />
              </button>
            </>
          )}
        </div>
        {browserMode && settings.value.bookmarksBar && <BookmarkBar onOpen={openHere} />}
        {active.loading && active.url && <span class="bm-progress" />}
      </div>
      <div class="browser-body">
        {list.map((tab) => {
          if (!tab.url) {
            return (
              <div key={`${tab.id}-new`} class="tab-view" hidden={tab.id !== active.id}>
                <NewTabPage tab={tab} />
              </div>
            );
          }
          return <TabFrame key={tab.id} tab={tab} active={tab.id === active.id && visible} />;
        })}
      </div>
    </section>
  );
}
