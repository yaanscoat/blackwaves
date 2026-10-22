import { useEffect, useLayoutEffect, useRef, useState } from "preact/hooks";
import { Icon } from "./Icon.jsx";
import { Avatar } from "./Avatar.jsx";
import { NAV, openAuth, openSettings } from "../lib/ui.js";
import { navigate, route, section } from "../lib/router.js";
import { me, coinPulse, logout, canClaimDaily, claimDaily } from "../lib/account.js";
import { notifications, markAllRead, clearNotifications, toast } from "../lib/notify.js";
import { settings } from "../lib/settings.js";
import { openProfile } from "./ProfileCard.jsx";

function useClickAway(ref, open, close) {
  useEffect(() => {
    if (!open) return;
    const onDown = (event) => ref.current && !ref.current.contains(event.target) && close();
    const onKey = (event) => event.key === "Escape" && close();
    setTimeout(() => window.addEventListener("pointerdown", onDown), 0);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("pointerdown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);
}

function timeAgo(at) {
  const s = Math.max(1, Math.round((Date.now() - at) / 1000));
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.round(s / 60)}m`;
  if (s < 86400) return `${Math.round(s / 3600)}h`;
  return `${Math.round(s / 86400)}d`;
}

function Bell() {
  const [open, setOpen] = useState(false);
  const wrap = useRef(null);
  useClickAway(wrap, open, () => setOpen(false));
  const list = notifications.value;
  const unread = list.filter((entry) => !entry.read).length;
  return (
    <div class="dock-pop" ref={wrap}>
      <button
        class="dock-item"
        aria-label={`Notifications${unread ? ` (${unread} unread)` : ""}`}
        data-tip="Notifications"
        aria-expanded={open}
        onClick={() => {
          setOpen(!open);
          if (!open) setTimeout(markAllRead, 1200);
        }}
      >
        <Icon name="bell" />
        {unread > 0 && <span class="dock-dot">{unread > 9 ? "9+" : unread}</span>}
      </button>
      {open && (
        <div class="popover glass liquid notif-pop">
          <div class="notif-head">
            <h3>Notifications</h3>
            {list.length > 0 && (
              <button class="btn ghost sm" onClick={clearNotifications}>
                Clear all
              </button>
            )}
          </div>
          {list.length === 0 ? (
            <div class="empty small">
              <Icon name="bell" />
              <p>You're all caught up.</p>
            </div>
          ) : (
            <div class="notif-list">
              {list.map((entry) => (
                <button
                  key={entry.id}
                  class={`notif ${entry.read ? "" : "unread"}`}
                  onClick={() => {
                    if (entry.href) navigate(entry.href);
                    setOpen(false);
                  }}
                >
                  <span class="notif-icon">
                    <Icon name={entry.icon} size={16} />
                  </span>
                  <span class="notif-text">
                    <strong>{entry.title}</strong>
                    {entry.body && <span class="muted">{entry.body}</span>}
                  </span>
                  <span class="faint small">{timeAgo(entry.at)}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function Account() {
  const [open, setOpen] = useState(false);
  const wrap = useRef(null);
  useClickAway(wrap, open, () => setOpen(false));
  const user = me.value;
  const go = (path) => {
    setOpen(false);
    navigate(path);
  };
  return (
    <div class="dock-pop" ref={wrap}>
      <button class="dock-item dock-avatar" aria-label="Account" data-tip={user ? user.displayName : "Sign in"} onClick={() => setOpen(!open)}>
        {user ? <Avatar user={user} size={30} /> : <Icon name="user" />}
      </button>
      {open && (
        <div class="popover glass liquid account-pop">
          {user ? (
            <>
              <button class="account-head" onClick={() => (setOpen(false), openProfile(user.username))}>
                <Avatar user={user} size={44} />
                <span>
                  <strong>{user.displayName}</strong>
                  <span class="muted small">@{user.username}</span>
                </span>
              </button>
              <div class="menu-sep" />
              {canClaimDaily(user) && (
                <button
                  class="menu-item daily"
                  onClick={() => {
                    setOpen(false);
                    claimDaily().catch((error) => toast(error.message, { kind: "error" }));
                  }}
                >
                  <Icon name="gift" size={18} /> Claim daily coins
                </button>
              )}
              <button class="menu-item" onClick={() => go("/profile")}>
                <Icon name="edit" size={18} /> Edit profile
              </button>
              <button class="menu-item" onClick={() => go("/shop")}>
                <Icon name="shop" size={18} /> Shop
              </button>
              <button class="menu-item" onClick={() => (setOpen(false), openSettings("account"))}>
                <Icon name="cloud" size={18} /> CloudSync
              </button>
              <div class="menu-sep" />
              <button class="menu-item danger" onClick={() => (setOpen(false), logout())}>
                <Icon name="logout" size={18} /> Sign out
              </button>
            </>
          ) : (
            <>
              <p class="muted small account-pitch">Sign in to sync your stuff, chat, earn coins and shop.</p>
              <button class="menu-item" onClick={() => (setOpen(false), openAuth("login"))}>
                <Icon name="user" size={18} /> Sign in
              </button>
              <button class="menu-item" onClick={() => (setOpen(false), openAuth("register"))}>
                <Icon name="plus" size={18} /> Create account
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}

function Coins() {
  const user = me.value;
  const [bump, setBump] = useState(false);
  useEffect(() => {
    if (!coinPulse.value) return;
    setBump(true);
    const timer = setTimeout(() => setBump(false), 700);
    return () => clearTimeout(timer);
  }, [coinPulse.value]);
  if (!user) return null;
  return (
    <button class={`dock-coins ${bump ? "bump" : ""}`} onClick={() => navigate("/shop")} data-tip="Your coins" aria-label={`${user.coins} coins`}>
      <Icon name="coin" size={18} />
      <span>{user.coins.toLocaleString()}</span>
    </button>
  );
}

export function TopBar() {
  const dock = useRef(null);
  const indicator = useRef(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const current = section(route.value);

  // slide the glowing pill under whichever item is active
  useLayoutEffect(() => {
    const target = dock.current?.querySelector(".dock-item.nav[aria-current='page']");
    const pill = indicator.current;
    if (!pill) return;
    if (!target || target.offsetParent === null) {
      pill.style.opacity = "0";
      return;
    }
    pill.style.opacity = "1";
    pill.style.transform = `translateX(${target.offsetLeft + target.offsetWidth / 2 - 3}px)`;
  });

  // the dock-magnify thing. items near the cursor swell a little.
  const magnet = useRef({ items: [], x: 0, raf: 0 });
  const onEnter = () => {
    // measure item centers once per hover instead of on every pointermove
    magnet.current.items = [...dock.current.querySelectorAll(".dock-item")].map((item) => {
      const rect = item.getBoundingClientRect();
      return { item, center: rect.left + rect.width / 2 };
    });
  };
  const onMove = (event) => {
    if (settings.value.motion !== "full") return;
    const state = magnet.current;
    state.x = event.clientX;
    if (state.raf) return;
    state.raf = requestAnimationFrame(() => {
      state.raf = 0;
      for (const { item, center } of state.items) {
        const scale = 1 + Math.max(0, 1 - Math.abs(state.x - center) / 120) * 0.22;
        item.style.setProperty("--mag", scale.toFixed(3));
      }
    });
  };
  const onLeave = () => magnet.current.items.forEach(({ item }) => item.style.setProperty("--mag", "1"));

  return (
    <header class="topbar">
      <nav class="dock glass liquid" ref={dock} onPointerEnter={onEnter} onPointerMove={onMove} onPointerLeave={onLeave} aria-label="Main">
        <a
          class="brand"
          href="/"
          onClick={(event) => {
            event.preventDefault();
            navigate("/");
          }}
          aria-label="blackwaves home"
        >
          <img class="logo-img" src="/favicon.ico" alt="" width="30" height="20" />
          <span class="brand-name">blackwaves</span>
        </a>
        <span class="dock-sep" />
        <div class="dock-nav">
          {NAV.map((item) => (
            <a
              key={item.id}
              href={item.path}
              class="dock-item nav"
              aria-label={item.label}
              aria-current={current === item.id ? "page" : undefined}
              data-tip={`${item.label}  ·  Alt+${item.key.toUpperCase()}`}
              onClick={(event) => {
                event.preventDefault();
                navigate(item.path);
              }}
            >
              <Icon name={item.icon} />
            </a>
          ))}
          <span class="dock-indicator" ref={indicator} />
        </div>
        <span class="dock-sep" />
        <div class="dock-right">
          <Coins />
          <Bell />
          <button class="dock-item" aria-label="Settings" data-tip="Settings  ·  Alt+," onClick={() => openSettings()}>
            <Icon name="settings" />
          </button>
          <Account />
          <button class="dock-item dock-burger" aria-label="Menu" aria-expanded={menuOpen} onClick={() => setMenuOpen(!menuOpen)}>
            <Icon name={menuOpen ? "x" : "menu"} />
          </button>
        </div>
      </nav>
      {menuOpen && (
        <div class="mobile-menu glass liquid" onClick={() => setMenuOpen(false)}>
          {NAV.map((item, index) => (
            <a
              key={item.id}
              href={item.path}
              class={`mobile-item ${current === item.id ? "active" : ""}`}
              style={{ "--i": index }}
              onClick={(event) => {
                event.preventDefault();
                navigate(item.path);
              }}
            >
              <Icon name={item.icon} />
              <span>{item.label}</span>
            </a>
          ))}
        </div>
      )}
    </header>
  );
}

export function useShortcuts() {
  useEffect(() => {
    const onKey = (event) => {
      if (!event.altKey || event.ctrlKey || event.metaKey) return;
      // event.code, not event.key: on a mac alt+g types "©", which is cute but useless
      if (event.code === "Comma") {
        event.preventDefault();
        openSettings();
        return;
      }
      const letter = event.code.startsWith("Key") ? event.code.slice(3).toLowerCase() : "";
      const item = NAV.find((entry) => entry.key === letter);
      if (item) {
        event.preventDefault();
        navigate(item.path);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
}
