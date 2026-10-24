import { useState } from "preact/hooks";
import { Modal } from "./Modal.jsx";
import { Icon } from "./Icon.jsx";
import { settingsOpen, openAuth, NAV } from "../lib/ui.js";
import { settings, setSetting, resetSettings } from "../lib/settings.js";
import { THEMES, ACCENTS } from "../data/themes.js";
import { BACKGROUNDS } from "../lib/fx/scenes.js";
import { PARTICLES } from "../lib/fx/particles.js";
import { CLOAKS, ENGINES, DISCORD } from "../data/catalogs.js";
import { CHANGELOG, CREDITS, TEAM, VERSION } from "../data/changelog.js";
import { putBlob, storage } from "../lib/storage.js";
import { launchCloaked } from "../lib/cloak.js";
import { me, logout } from "../lib/account.js";
import { syncState, push, pull, markBackgroundChanged } from "../lib/cloudsync.js";
import { post } from "../lib/api.js";
import { toast } from "../lib/notify.js";
import { switchTransport } from "../lib/proxy.js";
import { consent } from "./Welcome.jsx";
import { SECRETS, found } from "../lib/easter.js";
import { navigate } from "../lib/router.js";

const TABS = [
  { id: "appearance", label: "Appearance", icon: "palette" },
  { id: "effects", label: "Effects", icon: "sparkles" },
  { id: "privacy", label: "Privacy & cloaking", icon: "shield" },
  { id: "browser", label: "Browser", icon: "browser" },
  { id: "account", label: "CloudSync", icon: "cloud" },
  { id: "about", label: "About", icon: "info" },
];

function Row({ title, hint, children, stack = false }) {
  return (
    <div class={`set-row ${stack ? "stack" : ""}`}>
      <div class="set-label">
        <span>{title}</span>
        {hint && <span class="muted small">{hint}</span>}
      </div>
      <div class="set-control">{children}</div>
    </div>
  );
}

function Toggle({ k, label }) {
  const value = settings.value[k];
  return <button class="toggle" role="switch" aria-checked={Boolean(value)} aria-label={label} onClick={() => setSetting(k, !value)} />;
}

function Select({ k, options, label, onPick }) {
  return (
    <select
      class="select"
      aria-label={label}
      value={settings.value[k]}
      onChange={(event) => {
        setSetting(k, event.currentTarget.value);
        onPick?.(event.currentTarget.value);
      }}
    >
      {options.map((option) => (
        <option key={option.id} value={option.id}>
          {option.name}
        </option>
      ))}
    </select>
  );
}

function Segmented({ k, options, label }) {
  return (
    <div class="segmented" role="radiogroup" aria-label={label}>
      {options.map((option) => (
        <button key={option.id} role="radio" aria-checked={settings.value[k] === option.id} onClick={() => setSetting(k, option.id)}>
          {option.name}
        </button>
      ))}
    </div>
  );
}

const DOCK_EXTRAS = [
  { id: "coins", icon: "coin", label: "Coins" },
  { id: "bell", icon: "bell", label: "Notifications" },
  { id: "settings", icon: "settings", label: "Settings" },
];

function DockItems() {
  const hidden = Array.isArray(settings.value.topbarHidden) ? settings.value.topbarHidden : [];
  const flip = (id) => setSetting("topbarHidden", hidden.includes(id) ? hidden.filter((entry) => entry !== id) : [...hidden, id]);
  return (
    <div class="dock-picker">
      {[...NAV, ...DOCK_EXTRAS].map((item) => {
        const shown = !hidden.includes(item.id);
        return (
          <button key={item.id} class={`dock-pick ${shown ? "on" : ""}`} aria-pressed={shown} onClick={() => flip(item.id)}>
            <Icon name={item.icon} size={18} />
            <span>{item.label}</span>
            <span class="dock-pick-check">
              <Icon name={shown ? "check" : "plus"} size={13} stroke={2.4} />
            </span>
          </button>
        );
      })}
    </div>
  );
}

function Appearance() {
  const s = settings.value;
  return (
    <>
      <h3 class="set-h">Theme</h3>
      <div class="theme-grid">
        {THEMES.map((theme) => (
          <button
            key={theme.id}
            class="theme-swatch"
            aria-pressed={s.theme === theme.id}
            onClick={() => setSetting("theme", theme.id)}
            style={{ "--sw-bg": theme.bg, "--sw-surface": theme.surface, "--sw-text": theme.text, "--sw-accent": theme.accent }}
          >
            <span class="swatch-preview">
              <span />
              <span />
            </span>
            <span class="swatch-name">{theme.name}</span>
          </button>
        ))}
      </div>
      <Row title="Accent color" hint="Overrides the theme's accent.">
        <div class="accent-row">
          <button class="accent-dot reset" aria-pressed={!s.accent} onClick={() => setSetting("accent", "")} data-tip="Theme default">
            <Icon name="refresh" size={14} />
          </button>
          {ACCENTS.map((color) => (
            <button key={color} class="accent-dot" style={{ background: color }} aria-pressed={s.accent === color} aria-label={color} onClick={() => setSetting("accent", color)} />
          ))}
          <label class="accent-dot custom" data-tip="Pick any color">
            <input type="color" value={s.accent || "#7aa7ff"} onInput={(event) => setSetting("accent", event.currentTarget.value)} />
            <Icon name="plus" size={14} />
          </label>
        </div>
      </Row>
      <Row title="Liquid glass" hint="Frosted, light-bending glass on the top bar, cards and popups.">
        <Toggle k="glass" label="Liquid glass" />
      </Row>
      {s.glass && (
        <>
          <Row title="Glass style" stack>
            <Segmented
              k="glassStyle"
              label="Glass style"
              options={[
                { id: "liquid", name: "Liquid" },
                { id: "frosted", name: "Frosted" },
                { id: "clear", name: "Clear" },
                { id: "tinted", name: "Tinted" },
              ]}
            />
          </Row>
          <Row title="Blur" hint={`${s.glassStrength}%`}>
            <input class="range" type="range" min="0" max="100" value={s.glassStrength} onInput={(event) => setSetting("glassStrength", Number(event.currentTarget.value))} />
          </Row>
          {s.glassStyle === "liquid" && (
            <Row title="Refraction" hint={document.documentElement.dataset.liquid === "on" ? `${s.glassRefraction}%: how much the edges bend what's behind them` : "Needs Chrome, Edge, Opera or another Chromium browser"}>
              <input
                class="range"
                type="range"
                min="0"
                max="100"
                value={s.glassRefraction}
                disabled={document.documentElement.dataset.liquid !== "on"}
                onInput={(event) => setSetting("glassRefraction", Number(event.currentTarget.value))}
              />
            </Row>
          )}
          <Row title="Light reflections" hint="A highlight that follows your cursor across glass.">
            <Toggle k="glassSheen" label="Light reflections" />
          </Row>
        </>
      )}
      <h3 class="set-h">Top bar</h3>
      <Row title="Style" stack>
        <Segmented
          k="topbarStyle"
          label="Top bar style"
          options={[
            { id: "floating", name: "Floating dock" },
            { id: "bar", name: "Full-width bar" },
            { id: "pill", name: "Minimal pill" },
            { id: "bottom", name: "Bottom dock" },
          ]}
        />
      </Row>
      <Row title="Size" stack>
        <Segmented
          k="topbarSize"
          label="Top bar size"
          options={[
            { id: "compact", name: "Compact" },
            { id: "regular", name: "Regular" },
            { id: "large", name: "Large" },
          ]}
        />
      </Row>
      <Row title="Labels" hint="Icons only, with names on hover, or names always showing." stack>
        <Segmented
          k="topbarLabels"
          label="Top bar labels"
          options={[
            { id: "hover", name: "On hover" },
            { id: "always", name: "Always" },
          ]}
        />
      </Row>
      <Row title="Current page marker" stack>
        <Segmented
          k="topbarIndicator"
          label="Current page marker"
          options={[
            { id: "dot", name: "Glowing dot" },
            { id: "underline", name: "Underline" },
            { id: "pill", name: "Highlight" },
            { id: "none", name: "None" },
          ]}
        />
      </Row>
      <Row title="What's in the top bar" hint="Tap to hide or show. Hidden pages move into the menu button and their Alt shortcuts still work." stack>
        <DockItems />
      </Row>
      <Row title="Show the blackwaves name">
        <Toggle k="topbarBrand" label="Show the blackwaves name" />
      </Row>
      <Row title="Magnify icons on hover" hint="The mac-dock swell.">
        <Toggle k="topbarMagnify" label="Magnify icons on hover" />
      </Row>
      <Row title="Motion" hint="How much stuff moves around." stack>
        <Segmented
          k="motion"
          label="Motion"
          options={[
            { id: "full", name: "Full" },
            { id: "reduced", name: "Reduced" },
            { id: "minimal", name: "Minimal" },
            { id: "off", name: "Off" },
          ]}
        />
      </Row>
      <Row title="Browser mode (beta)" hint="Makes blackwaves look like a normal browser: tabs and an address bar, no dock.">
        <Toggle k="browserMode" label="Browser mode" />
      </Row>
      <Row title="Server location" hint="Bottom-right corner.">
        <Toggle k="showLocation" label="Show server location" />
      </Row>
      <Row title="Online counter">
        <Toggle k="showOnline" label="Show online counter" />
      </Row>
    </>
  );
}

function Effects() {
  const s = settings.value;
  const upload = async (event) => {
    const file = event.currentTarget.files?.[0];
    if (!file) return;
    if (file.size > 40 * 1024 * 1024) return toast("keep it under 40mb please", { kind: "error" });
    if (!/^(image|video)\//.test(file.type)) return toast("that needs to be an image or a video", { kind: "error" });
    await putBlob("background", file);
    markBackgroundChanged();
    setSetting("background", "custom");
    window.dispatchEvent(new CustomEvent("bw:background-changed"));
    toast("background set", { kind: "success" });
    if (file.size > 4 * 1024 * 1024) toast("heads up: backgrounds over 4mb stay on this device and won't sync");
  };
  return (
    <>
      <Row title="Background" stack>
        <div class="option-grid">
          {BACKGROUNDS.map((entry) => (
            <button key={entry.id} class="option-card" aria-pressed={s.background === entry.id} onClick={() => setSetting("background", entry.id)}>
              <span class={`bg-thumb bg-thumb-${entry.id}`} />
              <span>{entry.name}</span>
            </button>
          ))}
        </div>
      </Row>
      <Row title="Your own background" hint="An image or a video. Stays encrypted on your device.">
        <label class="btn">
          <Icon name="upload" size={16} /> Choose file
          <input type="file" accept="image/*,video/*" hidden onChange={upload} />
        </label>
      </Row>
      <Row title="Particles" stack>
        <div class="chips">
          {PARTICLES.map((entry) => (
            <button key={entry.id} class="chip" aria-pressed={s.particles === entry.id} onClick={() => setSetting("particles", entry.id)}>
              {entry.name}
            </button>
          ))}
        </div>
      </Row>
      {s.particles !== "off" && (
        <Row title="Particle amount" hint={`${s.particleDensity}%`}>
          <input class="range" type="range" min="10" max="150" value={s.particleDensity} onInput={(event) => setSetting("particleDensity", Number(event.currentTarget.value))} />
        </Row>
      )}
      <Row title="Cursor trail" stack>
        <Segmented
          k="cursorTrail"
          label="Cursor trail"
          options={[
            { id: "off", name: "Off" },
            { id: "comet", name: "Comet" },
            { id: "sparkle", name: "Sparkle" },
            { id: "ribbon", name: "Ribbon" },
            { id: "rainbow", name: "Rainbow" },
          ]}
        />
      </Row>
      <Row title="Click sparks" hint="A little burst wherever you click.">
        <Toggle k="clickSparks" label="Click sparks" />
      </Row>
    </>
  );
}

function Privacy() {
  const s = settings.value;
  const [listening, setListening] = useState(false);
  return (
    <>
      <Row title="Tab cloak" hint="What the tab title and icon pretend to be.">
        <Select k="cloak" options={CLOAKS} label="Tab cloak" />
      </Row>
      <Row title="Only cloak when you look away" hint="Shows blackwaves while the tab is focused and the cloak when it isn't.">
        <Toggle k="focusCloak" label="Focus cloak" />
      </Row>
      <Row title="Open in a hidden tab" hint="Launches blackwaves inside an about:blank or blob: tab that doesn't show up in history.">
        <div class="btn-row">
          <button class="btn" onClick={() => launchCloaked("about:blank") || toast("your browser blocked the popup", { kind: "error" })}>
            about:blank
          </button>
          <button class="btn" onClick={() => launchCloaked("blob") || toast("your browser blocked the popup", { kind: "error" })}>
            blob:
          </button>
        </div>
      </Row>
      <Row title="Auto-launch" hint="Do that automatically every time you open blackwaves.">
        <Select
          k="autoLaunch"
          label="Auto-launch"
          options={[
            { id: "off", name: "Off" },
            { id: "about:blank", name: "about:blank" },
            { id: "blob", name: "blob:" },
          ]}
        />
      </Row>
      <Row title="Panic key" hint="Press it to jump to a safe page instantly.">
        <button
          class="btn"
          onClick={() => {
            setListening(true);
            const onKey = (event) => {
              event.preventDefault();
              setSetting("panicKey", event.key === "Escape" ? "" : event.key);
              setListening(false);
              window.removeEventListener("keydown", onKey, true);
            };
            window.addEventListener("keydown", onKey, true);
          }}
        >
          {listening ? "Press a key (Esc to clear)" : s.panicKey ? <span class="kbd">{s.panicKey}</span> : "Not set"}
        </button>
      </Row>
      <Row title="Panic page">
        <input class="input" value={s.panicUrl} onChange={(event) => setSetting("panicUrl", event.currentTarget.value)} />
      </Row>
      <Row title="Search suggestions" hint="Sends what you type in the search bar to our server.">
        <Toggle k="suggestions" label="Search suggestions" />
      </Row>
      <Row title="Cookie choices" hint={consent.value ? `Saved ${new Date(consent.value.at).toLocaleDateString()}` : ""}>
        <button
          class="btn"
          onClick={() => {
            document.cookie = "bw_consent=; Path=/; Max-Age=0";
            consent.value = null;
            settingsOpen.value = null;
          }}
        >
          Change
        </button>
      </Row>
      <Row title="Legal">
        <div class="btn-row">
          {[
            ["privacy", "Privacy"],
            ["terms", "Terms"],
            ["cookies", "Cookies"],
            ["dmca", "DMCA"],
          ].map(([id, label]) => (
            <button key={id} class="btn sm" onClick={() => ((settingsOpen.value = null), navigate(`/legal/${id}`))}>
              {label}
            </button>
          ))}
        </div>
      </Row>
      <Row title="Reset blackwaves" hint="Deletes everything saved on this device, including the encryption key.">
        <button
          class="btn danger"
          onClick={() => {
            if (!confirm("Reset blackwaves on this device? This can't be undone.")) return;
            storage.reset();
            location.reload();
          }}
        >
          Reset
        </button>
      </Row>
    </>
  );
}

function BrowserTab() {
  return (
    <>
      <Row title="Search engine">
        <Select k="searchEngine" options={ENGINES} label="Search engine" />
      </Row>
      <Row title="Transport" hint="How the proxy browser tunnels to the internet. Try the other one if a site won't load.">
        <Select
          k="transport"
          label="Transport"
          options={[
            { id: "epoxy", name: "epoxy (default)" },
            { id: "libcurl", name: "libcurl" },
          ]}
          onPick={(value) => switchTransport(value).then(() => toast(`switched to ${value}`))}
        />
      </Row>
      <Row title="Confirm before closing" hint="Ask before you close the tab while blackwaves is open.">
        <Toggle k="confirmClose" label="Confirm before closing" />
      </Row>
      <Row title="Browsing history">
        <button
          class="btn"
          onClick={() => {
            storage.set("history", []);
            toast("history cleared");
          }}
        >
          Clear history
        </button>
      </Row>
      <Row title="Bookmarks">
        <button
          class="btn"
          onClick={() => {
            storage.remove("bookmarks");
            toast("bookmarks reset to the defaults");
          }}
        >
          Reset bookmarks
        </button>
      </Row>
    </>
  );
}

function Account() {
  const user = me.value;
  const sync = syncState.value;
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  if (!user) {
    return (
      <div class="empty">
        <Icon name="cloud" />
        <h3>CloudSync</h3>
        <p>One account syncs your settings, bookmarks, history, favorites and background across devices, and unlocks chat, coins and the shop.</p>
        <div class="btn-row">
          <button class="btn primary" onClick={() => openAuth("register")}>
            Create account
          </button>
          <button class="btn" onClick={() => openAuth("login")}>
            Sign in
          </button>
        </div>
      </div>
    );
  }
  return (
    <>
      <Row title={`Signed in as ${user.displayName}`} hint={`@${user.username}`}>
        <button class="btn" onClick={logout}>
          <Icon name="logout" size={16} /> Sign out
        </button>
      </Row>
      <Row
        title="Sync status"
        hint={sync.status === "error" ? sync.error : sync.at ? `Last synced ${new Date(sync.at).toLocaleTimeString()}` : "Waiting for the first sync"}
      >
        <button class="btn" onClick={() => pull().then(push)}>
          <Icon name="refresh" size={16} /> Sync now
        </button>
      </Row>
      <Row title="Change password" stack>
        <form
          class="inline-form"
          onSubmit={async (event) => {
            event.preventDefault();
            try {
              await post("/api/auth/password", { currentPassword: current, newPassword: next });
              setCurrent("");
              setNext("");
              toast("password changed", { kind: "success" });
            } catch (error) {
              toast(error.message, { kind: "error" });
            }
          }}
        >
          <input class="input" type="password" placeholder="Current password" value={current} onInput={(e) => setCurrent(e.currentTarget.value)} autocomplete="current-password" />
          <input class="input" type="password" placeholder="New password" value={next} onInput={(e) => setNext(e.currentTarget.value)} autocomplete="new-password" />
          <button class="btn">Change</button>
        </form>
      </Row>
      <Row title="Delete account" hint="Removes your account, profile, coins, items and messages for good.">
        <button
          class="btn danger"
          onClick={async () => {
            const password = prompt("Type your password to delete your account forever:");
            if (!password) return;
            try {
              await post("/api/auth/delete", { password });
              location.reload();
            } catch (error) {
              toast(error.message, { kind: "error" });
            }
          }}
        >
          Delete
        </button>
      </Row>
    </>
  );
}

function About() {
  const [open, setOpen] = useState(CHANGELOG[0].version);
  return (
    <div class="about">
      <div class="about-hero">
        <img class="logo-img" src="/favicon.ico" alt="" />
        <div>
          <h2>blackwaves</h2>
          <p class="muted">
            Version {VERSION} · built on <a href="https://github.com/gayq/lyra" target="_blank" rel="noreferrer">lyra by gayq</a>
          </p>
        </div>
        <a class="btn" href={DISCORD} target="_blank" rel="noreferrer">
          <Icon name="discord" size={16} /> Discord
        </a>
      </div>

      <h3 class="set-h">The team</h3>
      <div class="team">
        {TEAM.map((person) => (
          <a key={person.name} class="team-card glass" href={person.url} target="_blank" rel="noreferrer">
            <img src={`https://github.com/${person.name}.png?size=96`} alt="" loading="lazy" />
            <span>
              <strong>{person.name}</strong>
              <span class="muted small">{person.role}</span>
            </span>
            <Icon name="github" size={18} />
          </a>
        ))}
      </div>

      <h3 class="set-h">Changelog</h3>
      <div class="changelog">
        {CHANGELOG.map((release) => (
          <div key={release.version} class={`release ${open === release.version ? "open" : ""}`}>
            <button class="release-head" onClick={() => setOpen(open === release.version ? "" : release.version)} aria-expanded={open === release.version}>
              <span class="release-version">v{release.version}</span>
              <span class="muted">{release.title}</span>
              <Icon name="down" size={16} />
            </button>
            {open === release.version && (
              <div class="release-body">
                {release.groups.map((group) => (
                  <div key={group.label}>
                    <h4>{group.label}</h4>
                    <ul>
                      {group.items.map((item) => (
                        <li key={item}>{item}</li>
                      ))}
                    </ul>
                  </div>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>

      <h3 class="set-h">Credits</h3>
      <ul class="credits">
        {CREDITS.map((credit) => (
          <li key={credit.name}>
            <a href={credit.url} target="_blank" rel="noreferrer">
              {credit.name}
            </a>
            <span class="muted"> {credit.what}</span>
          </li>
        ))}
      </ul>

      <h3 class="set-h">Shortcuts</h3>
      <div class="shortcuts">
        {[
          ["H", "Home"],
          ["B", "Browser"],
          ["G", "Games"],
          ["M", "Movies"],
          ["U", "Music"],
          ["R", "Manga"],
          ["L", "Cloud gaming"],
          ["C", "Chat"],
          ["S", "Shop"],
          [",", "Settings"],
        ].map(([key, label]) => (
          <span key={key}>
            <span class="kbd">Alt</span> <span class="kbd">{key}</span> {label}
          </span>
        ))}
      </div>
      <p class="small panic-hint">
        <span class="kbd">{settings.value.panicKey || "not set"}</span> Panic key: jumps to {settings.value.panicUrl.replace("https://", "").replace("http://", "")} from anywhere on blackwaves, even inside games, the browser and movies. Change it in Privacy & cloaking.
      </p>
      <p class="faint small about-secrets">
        Secrets found: {found.value.length}/{SECRETS.length}
      </p>
    </div>
  );
}

const PANES = { appearance: Appearance, effects: Effects, privacy: Privacy, browser: BrowserTab, account: Account, about: About };

export function Settings() {
  const tab = settingsOpen.value;
  if (!tab) return null;
  const Pane = PANES[tab] || Appearance;
  return (
    <Modal title="Settings" wide onClose={() => (settingsOpen.value = null)} class="settings-modal">
      <div class="settings-layout">
        <nav class="settings-tabs" aria-label="Settings sections">
          {TABS.map((entry) => (
            <button key={entry.id} class="settings-tab" aria-current={tab === entry.id ? "true" : undefined} onClick={() => (settingsOpen.value = entry.id)}>
              <Icon name={entry.icon} size={18} />
              <span>{entry.label}</span>
            </button>
          ))}
          <button class="settings-tab subtle" onClick={() => confirm("Reset all settings to default?") && resetSettings()}>
            <Icon name="refresh" size={18} />
            <span>Reset settings</span>
          </button>
        </nav>
        <div class="settings-pane" key={tab}>
          <Pane />
        </div>
      </div>
    </Modal>
  );
}
