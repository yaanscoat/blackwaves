import { engine } from "./engine.js";
import * as settings from "./settings.js";
import * as storage from "./storage.js";
import * as history from "./history.js";
import * as idb from "./idb.js";
import * as glass from "./glass.js";
import * as cloud from "./cloudsync.js";
import { applyTheme, findTheme } from "./themes.js";
import { applyCloak, autoLaunch, launch, isWrapped } from "./cloak.js";
import { createEffects } from "./effects.js";
import { createConfetti } from "./confetti.js";
import { createNotifications } from "./notifications.js";
import { icons } from "./icons.js";
import { createHome } from "./home.js";
import { createBrowser } from "./browser.js";
import { createGames } from "./games.js";
import { createApps } from "./apps.js";
import { createMovies } from "./movies.js";
import { createSettingsPanel } from "./settings-panel.js";
import { enginePicker } from "./engine-picker.js";
const $ = (selector) => document.querySelector(selector);
const root = document.documentElement;

for (const el of document.querySelectorAll("[data-icon]"))
    el.insertAdjacentHTML("afterbegin", icons[el.dataset.icon] ?? "");

// ---- toasts
const toasts = $("#toasts");
const toast = (message, ms = 4200) => {
    if (!message)
        return;
    const el = document.createElement("div");
    el.className = "toast";
    el.setAttribute("role", "status");
    el.textContent = message;
    toasts.append(el);
    requestAnimationFrame(() => el.classList.add("is-in"));
    setTimeout(() => {
        el.classList.add("is-out");
        setTimeout(() => el.remove(), 400);
    }, ms);
};

// ---- appearance
const effects = createEffects($("#bg-canvas"));
const bgMedia = $("#bg-media");
let bgUrl = "";

const applyMotion = (level) => {
    root.dataset.motion = String(level);
};

const loadBackground = async () => {
    if (bgUrl)
        URL.revokeObjectURL(bgUrl);
    bgUrl = "";
    bgMedia.replaceChildren();
    if (!settings.get("customBg"))
        return;
    const blob = await idb.get("background");
    if (!(blob instanceof Blob)) {
        settings.set({ customBg: false });
        return;
    }
    bgUrl = URL.createObjectURL(blob);
    const media = blob.type.startsWith("video/")
        ? Object.assign(document.createElement("video"), { src: bgUrl, autoplay: true, muted: true, loop: true, playsInline: true })
        : Object.assign(document.createElement("img"), { src: bgUrl, alt: "" });
    bgMedia.append(media);
};

const applyAppearance = (values, changed = Object.keys(values)) => {
    const has = (...keys) => keys.some(key => changed.includes(key));
    let theme = null;
    if (has("theme"))
        theme = applyTheme(values.theme);
    if (has("motion"))
        applyMotion(values.motion);
    if (has("liquid", "motion"))
        glass.configure({ liquid: values.liquid, motion: values.motion });
    if (has("theme", "motion", "lighting", "bgEffect"))
        effects.configure({
            theme: theme ?? findTheme(values.theme),
            motion: values.motion,
            lighting: values.lighting,
            mode: values.bgEffect
        });
    if (has("bgDim"))
        root.style.setProperty("--bg-dim", String(values.bgDim / 100));
    if (has("customBg"))
        void loadBackground();
};

applyAppearance(settings.all());

// ---- views
const views = ["home", "games", "apps", "movies", "browser"];
let view = "home";
const dock = $("#dock");

const syncEffects = () => {
    const visible = view === "home" || view === "apps" || (view === "games" && !games?.playing);
    effects.setActive(visible);
};

const showView = (name, { focus = false } = {}) => {
    if (!views.includes(name))
        name = "home";
    const previous = view;
    view = name;
    for (const id of views) {
        const el = $(`#view-${id}`);
        const on = id === name;
        el.hidden = !on;
        el.classList.toggle("is-active", on);
    }
    for (const button of dock.querySelectorAll("[data-view]")) {
        if (button.dataset.view === name)
            button.setAttribute("aria-current", "page");
        else
            button.removeAttribute("aria-current");
    }
    root.dataset.view = name;
    placeIndicator();
    notify.close();
    if (name === "games")
        games.show();
    if (name === "movies")
        movies.show();
    syncEffects();
    if (focus || previous !== name) {
        if (name === "browser")
            browser.focusAddress();
        else if (name === "home" && focus)
            home.focus();
    }
    const hash = name === "home" ? "" : `#/${name}`;
    if (location.hash !== hash)
        window.history.replaceState(null, "", hash || location.pathname);
};

const viewFromHash = () => location.hash.replace(/^#\/?/, "") || "home";
addEventListener("hashchange", () => showView(viewFromHash()));

// ---- modules
// blackwaves://settings, blackwaves://games ...
const pageName = (url) => {
    try {
        const parsed = new URL(url);
        return parsed.hostname || parsed.pathname.replace(/^\/+/, "");
    }
    catch {
        return null;
    }
};
const onInternal = (url) => {
    const name = pageName(url);
    if (name === "settings")
        panel.open();
    else if (views.includes(name ?? ""))
        showView(name);
    else
        toast(`blackwaves://${name} is not a page.`);
};

const browser = createBrowser({ onInternal, toast });
const openInBrowser = (input) => {
    showView("browser");
    browser.open(input);
};
const home = createHome({ onSearch: openInBrowser });
const games = createGames({ onPlay: syncEffects, onExit: syncEffects, toast });
createApps({ onOpen: openInBrowser });
const movies = createMovies({ toast });

enginePicker($("#home-engine"));
enginePicker($("#browser-engine"));

// ---- settings actions
const reloadWith = (task, message) => {
    if (!confirm(`${message} blackwaves will reload. Continue?`))
        return;
    storage.write("pendingClear", task);
    location.reload();
};

const actions = {
    "cloak-aboutblank": () => {
        if (!launch("aboutblank"))
            throw new Error("The browser blocked the popup. Allow popups for this site.");
        toast("Opened in about:blank. You can close this tab.");
    },
    "cloak-blob": () => {
        if (!launch("blob"))
            throw new Error("The browser blocked the popup. Allow popups for this site.");
        toast("Opened in blob:. You can close this tab.");
    },
    "clear-history": () => {
        history.clear();
        toast("History cleared.");
    },
    "clear-cookies": () => reloadWith("cookies", "This signs you out of every site."),
    "clear-data": () => reloadWith("data", "This clears what sites saved locally."),
    reset: () => {
        if (!confirm("Reset every setting to its default?"))
            return;
        settings.reset();
        toast("Settings reset.");
    },
    "bg-upload": async (file) => {
        if (!/^(image|video)\//.test(file.type))
            throw new Error("Pick an image or a video.");
        if (file.size > 40 * 1024 * 1024)
            throw new Error("That file is over 40MB.");
        await idb.set("background", file);
        if (settings.get("customBg"))
            await loadBackground();
        else
            settings.set({ customBg: true });
        cloud.backgroundChanged();
        toast(file.size > 7 * 1024 * 1024 ? "Background set. It's over 7MB, so CloudSync will skip it." : "Background set.");
    },
    "bg-remove": async () => {
        await idb.del("background");
        settings.set({ customBg: false });
        toast("Background removed.");
    },
    "sync-push": async () => {
        await cloud.push();
        toast("Synced.");
    },
    "sync-pull": async () => {
        const reload = await cloud.pull();
        toast("Restored from the cloud.");
        if (reload)
            actions["reload-for-cookies"]();
    },
    "sync-signout": async () => {
        await cloud.signOut();
        toast("Signed out. Your data stays on this device.");
    },
    "reload-for-cookies": () => {
        toast("Reloading to apply your synced cookies…");
        setTimeout(() => location.reload(), 1200);
    }
};

const panel = createSettingsPanel({ actions, toast });

settings.onChange((values, changed) => {
    applyAppearance(values, changed);
    if (changed.some(key => key.startsWith("cloak")))
        applyCloak();
    if (changed.includes("transport") || changed.includes("wispUrl"))
        void applyTransport();
});

// ---- dock
for (const button of dock.querySelectorAll("[data-view]")) {
    button.addEventListener("click", event => {
        event.preventDefault();
        showView(button.dataset.view, { focus: true });
    });
}
$("#dock-settings").addEventListener("click", () => panel.toggle());

const notify = createNotifications({
    button: $("#dock-notify"),
    badge: $("#dock-badge"),
    panel: $("#notify-panel"),
    motion: () => settings.get("motion"),
    onUnread: count => dock.toggleAttribute("data-unread", count > 0)
});

// Sliding pill behind the current page's icon.
const dockNav = dock.querySelector(".dock__nav");
const indicator = dock.querySelector(".dock__indicator");
const placeIndicator = () => {
    const active = dockNav.querySelector('[aria-current="page"]');
    if (!active) {
        indicator.classList.remove("is-on");
        return;
    }
    // Appear in place instead of sliding over from wherever it was hidden.
    const instant = !indicator.classList.contains("is-on");
    indicator.classList.toggle("is-instant", instant);
    indicator.style.setProperty("--x", `${active.offsetLeft}px`);
    indicator.style.setProperty("--w", `${active.offsetWidth}px`);
    indicator.style.setProperty("--mag", active.style.getPropertyValue("--mag") || "1");
    if (instant)
        void indicator.offsetWidth;
    indicator.classList.add("is-on");
    indicator.classList.remove("is-instant");
};
addEventListener("resize", placeIndicator);

// Folding: every icon merges into the three-line button and back.
const dockMenu = $("#dock-menu");
const dockToggle = $("#dock-toggle");
const dockItems = [...dockMenu.querySelectorAll(".dock__item")];
dockItems.forEach((item, i) => {
    item.style.setProperty("--i", String(i));
    item.style.setProperty("--n", String(dockItems.length));
});
let foldTimer = 0;
const setCollapsed = (collapsed, { animate = true } = {}) => {
    clearTimeout(foldTimer);
    const instant = !animate || settings.get("motion") === 0;
    dock.classList.toggle("is-instant", instant);
    dock.classList.toggle("is-folding", !instant);
    dock.toggleAttribute("data-collapsed", collapsed);
    dockMenu.inert = collapsed;
    dockToggle.setAttribute("aria-expanded", String(!collapsed));
    dockToggle.setAttribute("aria-label", collapsed ? "Open menu" : "Collapse menu");
    dockToggle.querySelector(".dock__label").textContent = collapsed ? "Menu" : "Collapse";
    if (collapsed)
        notify.close();
    storage.write("dockCollapsed", collapsed);
    if (instant)
        requestAnimationFrame(() => requestAnimationFrame(() => dock.classList.remove("is-instant")));
    else
        foldTimer = setTimeout(() => {
            dock.classList.remove("is-folding");
            placeIndicator();
        }, 950);
};
setCollapsed(storage.read("dockCollapsed", false) === true, { animate: false });
dockToggle.addEventListener("click", () => setCollapsed(!dock.hasAttribute("data-collapsed")));

// macOS-style magnification while motion is on full.
const resetMagnify = () => {
    for (const item of dockItems)
        item.style.removeProperty("--mag");
    indicator.style.setProperty("--mag", "1");
};
dock.addEventListener("pointermove", event => {
    if (settings.get("motion") < 3 || event.pointerType !== "mouse" || dock.hasAttribute("data-collapsed") || event.target.closest(".notify")) {
        resetMagnify();
        return;
    }
    for (const item of dockItems) {
        const rect = item.getBoundingClientRect();
        const distance = Math.abs(event.clientX - (rect.left + rect.width / 2));
        const t = Math.max(0, 1 - distance / 120);
        const mag = (1 + 0.32 * t * t).toFixed(3);
        item.style.setProperty("--mag", mag);
        if (item.hasAttribute("aria-current"))
            indicator.style.setProperty("--mag", mag);
    }
});
dock.addEventListener("pointerleave", resetMagnify);

// ---- home logo confetti
const confetti = createConfetti();
const heroArt = $("#hero-logo .hero__logo-art");
$("#hero-logo").addEventListener("click", () => {
    const motion = settings.get("motion");
    if (motion === 0) {
        toast("Confetti needs motion turned on in Appearance.");
        return;
    }
    confetti.burst(motion);
    heroArt.classList.remove("is-pop");
    void heroArt.offsetWidth;
    heroArt.classList.add("is-pop");
});
heroArt.addEventListener("animationend", event => {
    if (event.animationName === "logo-pop")
        heroArt.classList.remove("is-pop");
});

for (const el of document.querySelectorAll("[data-glass]"))
    glass.register(el);

// ---- transport + proxy engine
const applyTransport = async () => {
    try {
        await engine.setTransport?.({
            kind: settings.get("transport"),
            wisp: settings.get("wispUrl")
        });
    }
    catch (error) {
        toast(`Could not switch transport: ${error.message}`);
    }
};

// ---- privacy on startup. This has to finish before the proxy engine
// opens its cookie database.
const prepareStorage = async () => {
    const pending = storage.read("pendingClear", null);
    if (pending)
        storage.remove("pendingClear");
    if (!settings.get("saveCookies") || pending === "cookies")
        await idb.clearCookies();
    if (!settings.get("saveSiteData") || pending === "data")
        await idb.clearSiteData();
    if (pending === "cookies")
        toast("Cookies cleared.");
    if (pending === "data")
        toast("Site data cleared.");
};

// ---- tab protection
const guard = (event) => {
    if (!settings.get("preventClose"))
        return;
    event.preventDefault();
    event.returnValue = "";
};
addEventListener("beforeunload", guard);
if (isWrapped()) {
    try {
        parent.addEventListener("beforeunload", guard);
    }
    catch { }
}

// ---- keyboard
const typing = (el) => el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || el?.isContentEditable;
addEventListener("keydown", event => {
    const mod = event.ctrlKey || event.metaKey;
    if (mod && event.key === ",") {
        event.preventDefault();
        panel.toggle();
        return;
    }
    if (panel.isOpen)
        return;
    if (view === "browser") {
        if (mod && event.key.toLowerCase() === "l") {
            event.preventDefault();
            browser.focusAddress();
        }
        else if (event.altKey && event.key.toLowerCase() === "t") {
            event.preventDefault();
            browser.newTab();
        }
        else if (event.altKey && event.key.toLowerCase() === "w") {
            event.preventDefault();
            browser.closeActive();
        }
        else if (mod && event.key === "Tab") {
            event.preventDefault();
            browser.cycle(event.shiftKey ? -1 : 1);
        }
        return;
    }
    if (event.key === "/" && !typing(document.activeElement) && !mod) {
        event.preventDefault();
        if (view === "home")
            home.focus();
        else if (view === "games")
            games.focus();
        else if (view === "apps")
            $("#apps-search").focus();
    }
});

// ---- boot
applyCloak();
autoLaunch(() => toast("Click anywhere to reopen blackwaves cloaked.", 6000));
cloud.start();
showView(viewFromHash());
requestAnimationFrame(() => root.classList.add("is-ready"));

const storageReady = prepareStorage();
engine.waitFor(storageReady);
(async () => {
    await storageReady;
    void applyTransport();
    try {
        await engine.init();
    }
    catch {
        toast("Could not reach the proxy backend.");
        return;
    }
    if (settings.get("preloadSearch")) {
        const idle = window.requestIdleCallback ?? (fn => setTimeout(fn, 600));
        idle(() => browser.preload(), { timeout: 2500 });
    }
})();
