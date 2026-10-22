import { useEffect, useRef, useState } from "preact/hooks";
import { Icon } from "../components/Icon.jsx";
import { SearchBox } from "../components/SearchBox.jsx";
import { Bookmarks } from "../components/Bookmarks.jsx";
import { tabs, activeTab, newTab, closeTab, updateTab, addHistory } from "../lib/browser.js";
import { createFrame, decodeFrameUrl, proxyReady } from "../lib/proxy.js";
import { resolveInput } from "../lib/search.js";
import { faviconUrl } from "../lib/gameurl.js";
import { settings } from "../lib/settings.js";
import { storage } from "../lib/storage.js";
import { toast } from "../lib/notify.js";
import { NAV, openSettings } from "../lib/ui.js";
import { navigate } from "../lib/router.js";
import { randomSearchMessage } from "../data/catalogs.js";

const frames = new Map();

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
  const browserMode = settings.value.browserMode;
  return (
    <div class="newtab">
      <img class="logo-img newtab-logo" src="/favicon.ico" alt="" />
      <SearchBox big autoFocus placeholder={placeholder} onSubmit={(text) => go(resolveInput(text))} />
      <Bookmarks onOpen={go} />
      {browserMode && (
        <div class="newtab-apps">
          {NAV.filter((item) => item.id !== "home" && item.id !== "browser").map((item) => (
            <button key={item.id} class="newtab-app glass" onClick={() => navigate(item.path)}>
              <Icon name={item.icon} size={22} />
              <span>{item.label}</span>
            </button>
          ))}
          <button class="newtab-app glass" onClick={() => openSettings()}>
            <Icon name="settings" size={22} />
            <span>Settings</span>
          </button>
        </div>
      )}
    </div>
  );
}

export function Browser({ visible }) {
  const list = tabs.value;
  const active = list.find((tab) => tab.id === activeTab.value) || list[0];
  const [address, setAddress] = useState("");
  const [editing, setEditing] = useState(false);
  const browserMode = settings.value.browserMode;

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

  const bookmark = () => {
    if (!active.url) return;
    const list = storage.get("bookmarks") || [];
    storage.set("bookmarks", [...list, { title: active.title || active.url, url: active.url }]);
    toast("bookmarked", { kind: "success" });
  };

  return (
    <section class={`browser ${browserMode ? "chrome-mode" : ""}`} hidden={!visible} aria-label="Proxy browser">
      <div class="browser-chrome glass liquid">
        <div class="tabstrip" role="tablist">
          {browserMode && (
            <button class="tab-home" aria-label="blackwaves home" data-tip="blackwaves" onClick={() => newTab()}>
              <img class="logo-img" src="/favicon.ico" alt="" />
            </button>
          )}
          {list.map((tab) => (
            <div
              key={tab.id}
              role="tab"
              aria-selected={tab.id === active.id}
              class={`tab ${tab.id === active.id ? "active" : ""}`}
              onClick={() => (activeTab.value = tab.id)}
              onAuxClick={(event) => event.button === 1 && closeTab(tab.id)}
              title={tab.title}
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
          <form class="address" onSubmit={go}>
            <Icon name={active.url?.startsWith("https://") ? "lock" : "search"} size={15} />
            <input
              value={address}
              placeholder="Search or type a URL"
              aria-label="Address"
              spellcheck={false}
              onFocus={(event) => {
                setEditing(true);
                event.currentTarget.select();
              }}
              onBlur={() => setEditing(false)}
              onInput={(event) => setAddress(event.currentTarget.value)}
            />
          </form>
          <button class="btn ghost icon-only sm" aria-label="Bookmark this page" data-tip="Bookmark" onClick={bookmark} disabled={!active.url}>
            <Icon name="star" size={17} />
          </button>
          <button
            class="btn ghost icon-only sm"
            aria-label="Fullscreen"
            data-tip="Fullscreen"
            onClick={() => document.querySelector(`.tab-view:not([hidden])`)?.requestFullscreen?.()}
            disabled={!active.url}
          >
            <Icon name="fullscreen" size={17} />
          </button>
          {browserMode && (
            <button class="btn ghost icon-only sm" aria-label="Settings" data-tip="Settings" onClick={() => openSettings()}>
              <Icon name="settings" size={17} />
            </button>
          )}
          {!browserMode && (
            <button class="btn ghost icon-only sm" aria-label="Back to blackwaves" data-tip="Home" onClick={() => navigate("/")}>
              <Icon name="home" size={17} />
            </button>
          )}
        </div>
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
