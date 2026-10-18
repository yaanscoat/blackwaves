import { engine } from "./engine.js";
import { resolveInput, formatForDisplay } from "./url.js";
import * as settings from "./settings.js";
import * as history from "./history.js";
import { icons } from "./icons.js";

const $ = (selector, root = document) => root.querySelector(selector);

const hostOf = (url) => {
    try {
        return new URL(url).hostname;
    }
    catch {
        return "";
    }
};

export const createBrowser = ({ onInternal, toast }) => {
    const strip = $("#tabstrip");
    const frames = $("#frames");
    const newtab = $("#newtab");
    const address = $("#address");
    const back = $("#back");
    const forward = $("#forward");
    const reload = $("#reload");
    const tabs = [];
    let active = null;
    let counter = 0;
    let addressFocused = false;
    address.addEventListener("focus", () => (addressFocused = true));
    address.addEventListener("blur", () => {
        addressFocused = false;
        render();
    });

    const template = () => settings.engineById(settings.get("searchEngine")).template;

    const makeTab = () => {
        const frame = document.createElement("iframe");
        frame.className = "frame";
        frame.setAttribute("allow", "autoplay; fullscreen; clipboard-read; clipboard-write; gamepad; pointer-lock; microphone; camera; display-capture; encrypted-media; picture-in-picture");
        frame.setAttribute("allowfullscreen", "");
        frames.append(frame);
        const tab = {
            id: ++counter,
            frame,
            session: null,
            pending: null,
            url: "",
            title: "New tab",
            loading: false,
            visited: [],
            index: -1,
            preloaded: false,
            button: document.createElement("div")
        };
        tab.button.className = "tab";
        tab.button.setAttribute("role", "tab");
        tab.button.tabIndex = 0;
        tab.button.innerHTML = `<span class="tab__icon"></span><span class="tab__label"></span><button class="tab__close" type="button" aria-label="Close tab">${icons.close}</button>`;
        tab.button.addEventListener("click", event => {
            if (event.target.closest(".tab__close"))
                closeTab(tab);
            else
                activate(tab);
        });
        tab.button.addEventListener("auxclick", event => {
            if (event.button === 1)
                closeTab(tab);
        });
        tab.button.addEventListener("keydown", event => {
            if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                activate(tab);
            }
            else if (event.key === "Delete")
                closeTab(tab);
        });
        strip.append(tab.button);
        tabs.push(tab);
        return tab;
    };

    const record = (tab, url) => {
        tab.url = url;
        if (tab.visited[tab.index] === url)
            return;
        const existing = tab.visited.lastIndexOf(url, tab.index - 1);
        if (existing >= 0) {
            tab.index = existing;
            return;
        }
        tab.visited.splice(tab.index + 1);
        tab.visited.push(url);
        tab.index = tab.visited.length - 1;
    };

    const readTitle = (tab) => {
        try {
            const title = tab.frame.contentDocument?.title?.trim();
            if (title) {
                tab.title = title;
                history.updateTitle(tab.url, title);
                return;
            }
        }
        catch { }
        tab.title = formatForDisplay(tab.url) || "New tab";
    };

    const ensureSession = async (tab) => {
        if (tab.session)
            return tab.session;
        if (tab.pending)
            return tab.pending;
        tab.pending = engine.createSession(tab.frame, {
            url: url => {
                record(tab, url);
                if (!tab.preloaded)
                    history.addVisit(url);
                readTitle(tab);
                render();
            },
            loading: () => {
                tab.loading = true;
                render();
            },
            ready: () => {
                tab.loading = false;
                readTitle(tab);
                render();
            },
            error: error => {
                tab.loading = false;
                render();
                if (tab === active)
                    toast(error?.message ?? String(error));
            },
            escape: url => void open(url, { newTab: true })
        });
        try {
            tab.session = await tab.pending;
        }
        finally {
            tab.pending = null;
        }
        return tab.session;
    };

    const navigate = async (tab, input, options = {}) => {
        const { url, kind } = resolveInput(input, template());
        switch (kind) {
            case "empty":
                return;
            case "blocked":
                toast("That address cannot be opened through the proxy.");
                return;
            case "external":
                location.assign(url);
                return;
            case "internal":
                onInternal(url);
                return;
        }
        if (kind === "search")
            history.addSearch(String(input));
        if (!options.preload)
            tab.preloaded = false;
        try {
            await ensureSession(tab);
        }
        catch (error) {
            toast(`The proxy is not ready: ${error.message}`);
            return;
        }
        if (options.record === false)
            tab.url = url;
        else
            record(tab, url);
        tab.title = formatForDisplay(url);
        tab.session.go(url);
        render();
    };

    const activate = (tab) => {
        active = tab;
        for (const t of tabs) {
            t.frame.classList.toggle("frame--active", t === tab);
            t.button.classList.toggle("tab--active", t === tab);
            t.button.setAttribute("aria-selected", String(t === tab));
        }
        tab.button.scrollIntoView({ block: "nearest", inline: "nearest" });
        render();
    };

    const closeTab = (tab) => {
        const index = tabs.indexOf(tab);
        if (index < 0)
            return;
        tabs.splice(index, 1);
        tab.button.remove();
        if (tab.session)
            tab.session.destroy();
        else
            tab.frame.remove();
        if (!tabs.length) {
            activate(makeTab());
            focusAddress();
        }
        else if (tab === active)
            activate(tabs[Math.min(index, tabs.length - 1)]);
    };

    const isBlank = (tab) => !tab.url || tab.preloaded;

    // Reuse an empty (or still-preloaded) tab rather than piling up tabs.
    const open = (input, { newTab = false } = {}) => {
        let tab = !newTab && active && isBlank(active) ? active : null;
        tab ??= !newTab ? tabs.find(isBlank) : null;
        tab ??= makeTab();
        activate(tab);
        void navigate(tab, input);
        return tab;
    };

    const render = () => {
        for (const tab of tabs) {
            const label = $(".tab__label", tab.button);
            const icon = $(".tab__icon", tab.button);
            label.textContent = tab.title || "New tab";
            tab.button.title = tab.title || "New tab";
            const host = hostOf(tab.url);
            const iconKey = tab.loading ? "loading" : host;
            if (icon.dataset.key !== iconKey) {
                icon.dataset.key = iconKey;
                icon.innerHTML = tab.loading
                    ? '<span class="spinner" aria-hidden="true"></span>'
                    : host
                        ? `<img src="/api/icon/${host}" alt="" width="16" height="16">`
                        : icons.browser;
                const img = $("img", icon);
                if (img)
                    img.onerror = () => (icon.innerHTML = icons.browser);
            }
        }
        if (!active)
            return;
        if (!addressFocused)
            address.value = active.url ? formatForDisplay(active.url) : "";
        back.disabled = active.index <= 0;
        forward.disabled = active.index < 0 || active.index >= active.visited.length - 1;
        reload.disabled = !active.session;
        const blank = !active.url;
        newtab.hidden = !blank;
        frames.classList.toggle("is-blank", blank);
    };

    $("#omnibox").addEventListener("submit", event => {
        event.preventDefault();
        address.blur();
        void navigate(active, address.value);
    });
    back.addEventListener("click", () => {
        if (active.index <= 0)
            return;
        void navigate(active, active.visited[--active.index], { record: false });
    });
    forward.addEventListener("click", () => {
        if (active.index >= active.visited.length - 1)
            return;
        void navigate(active, active.visited[++active.index], { record: false });
    });
    reload.addEventListener("click", () => active.session?.reload());
    $("#tab-new").addEventListener("click", () => {
        activate(makeTab());
        focusAddress();
    });
    $("#browser-fullscreen").addEventListener("click", () => {
        if (!active.url)
            return;
        frames.requestFullscreen?.().catch(() => toast("Fullscreen was blocked."));
    });
    $("#newtab-form").addEventListener("submit", event => {
        event.preventDefault();
        const input = $("#newtab-input");
        const value = input.value;
        input.value = "";
        void navigate(active, value);
    });
    newtab.addEventListener("click", event => {
        const link = event.target.closest("[data-url]");
        if (link)
            void navigate(active, link.dataset.url);
    });

    const focusAddress = () => {
        requestAnimationFrame(() => {
            const target = active && !active.url ? $("#newtab-input") : address;
            target.focus();
            target.select?.();
        });
    };

    activate(makeTab());

    return {
        open,
        focusAddress,
        newTab() {
            activate(makeTab());
            focusAddress();
        },
        closeActive() {
            if (active)
                closeTab(active);
        },
        cycle(step) {
            if (tabs.length < 2)
                return;
            activate(tabs[(tabs.indexOf(active) + step + tabs.length) % tabs.length]);
        },
        // Warm the proxy up on the search engine's home page so the first
        // search does not pay for the service worker, wasm and TLS setup.
        preload() {
            const tab = tabs.find(t => !t.url && !t.session) ?? null;
            if (!tab)
                return;
            tab.preloaded = true;
            void navigate(tab, settings.engineById(settings.get("searchEngine")).home, { preload: true });
        },
        get hasPage() {
            return Boolean(active?.url);
        }
    };
};
