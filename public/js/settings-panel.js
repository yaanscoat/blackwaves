import * as settings from "./settings.js";
import * as storage from "./storage.js";
import * as history from "./history.js";
import * as cloud from "./cloudsync.js";
import { themes } from "./themes.js";
import { icons } from "./icons.js";
import { escapeHtml, timeAgo } from "./util.js";
import { supportsLiquid } from "./glass.js";

export const version = "2.1.0";

const tabs = [
    { id: "preferences", label: "Preferences", icon: icons.screwdriver },
    { id: "appearance", label: "Appearance", icon: icons.paintbrush },
    { id: "cloaking", label: "Cloaking", icon: icons.spy },
    { id: "advanced", label: "Advanced", icon: icons.hammer },
    { id: "cloudsync", label: "CloudSync", icon: icons.cloud },
    { id: "about", label: "About", icon: icons.info }
];

const changelog = [
    {
        version: "2.1.0",
        date: "2026-10-18",
        notes: [
            "The dock is now a full top bar with the blackwaves name, and it folds into a three-line menu.",
            "Notifications live behind the bell in the top bar.",
            "Click the logo on the home page for confetti.",
            "Flatter look with Lexend everywhere, plus smoother page, toast and menu animations."
        ]
    },
    {
        version: "2.0.0",
        date: "2026-10-18",
        notes: [
            "New home page with the floating liquid-glass dock.",
            "Games: over 4,000 titles from gn-math, Seraph, Truffled, CKV and UGS, with favorites and recents.",
            "Apps, Movies and a tabbed proxy browser with ten search engines (DuckDuckGo first).",
            "Settings moved into this popup.",
            "52 themes, adjustable liquid glass and four motion levels.",
            "Three hidden light sources with dust, plus snow, rain, fire sparks, plain black or your own background.",
            "15 tab cloaks with about:blank and blob: launching, including auto-launch.",
            "CloudSync accounts that carry settings, history, cookies and backgrounds between devices."
        ]
    },
    {
        version: "1.0.0",
        date: "2026-08-04",
        notes: ["First release: Scramjet proxy with libcurl, epoxy and bare transports."]
    }
];

const credits = [
    ["yaanscoat", "owner"],
    ["beery-tomato", "co-owner"],
    ["gn-math", "game source"],
    ["gmshelf", "game source"],
    ["truffled", "game source"],
    ["ckv", "game source"],
    ["ugs", "game source"],
    ["seraph", "game source"]
];

const toggle = (key, title, detail) => `
  <label class="row row--toggle">
    <span class="row__text"><span class="row__title">${title}</span>${detail ? `<span class="row__detail">${detail}</span>` : ""}</span>
    <span class="toggle"><input type="checkbox" role="switch" data-setting="${key}"><span class="toggle__track" aria-hidden="true"></span></span>
  </label>`;

const section = (title, body, note = "") => `
  <section class="set-section">
    <h3>${title}</h3>${note ? `<p class="set-note">${note}</p>` : ""}
    ${body}
  </section>`;

const textInput = (key, label, placeholder, attrs = "") => `
  <label class="field-row">
    <span class="row__title">${label}</span>
    <input type="text" class="input" data-setting="${key}" placeholder="${escapeHtml(placeholder)}" spellcheck="false" autocomplete="off" ${attrs}>
  </label>`;

const panels = {
    preferences: () => `
      ${section("Search engine", `<div class="choice-grid choice-grid--engines">${settings.searchEngines.map(engine => `
        <button type="button" class="choice" data-choice="searchEngine" data-value="${engine.id}">
          <img src="${settings.iconFor(engine.domain)}" alt="" width="20" height="20">
          <span>${engine.label}</span>${engine.id === "duckduckgo" ? '<em class="badge">main</em>' : ""}
        </button>`).join("")}</div>`, "Used by the home search bar and the browser when what you type is not a web address.")}
      ${section("Game source", `<div class="seg seg--wrap">${settings.gameSources.map(source => `
        <button type="button" class="seg__item" data-choice="gameSource" data-value="${source.id}">${source.label}</button>`).join("")}</div>`, "All sources merges every library into one list.")}
      ${section("Tab", toggle("preventClose", "Prevent tab from closing", "Your browser asks before the tab is closed or reloaded."))}
    `,
    appearance: () => `
      ${section("Theme", `<div class="theme-grid">${themes.map(theme => `
        <button type="button" class="theme" data-choice="theme" data-value="${theme.id}" style="--t-bg:${theme.bg};--t-fg:${theme.fg};--t-a:${theme.accent};--t-b:${theme.accent2}" title="${theme.name}">
          <span class="theme__swatch"><i></i><i></i><i></i></span><span class="theme__name">${theme.name}</span>
        </button>`).join("")}</div>`, `${themes.length} themes.`)}
      ${section("Liquid glass", `
        <div class="range-row">
          <span class="range-row__end">Frosted</span>
          <input type="range" min="0" max="100" step="1" data-setting="liquid" aria-label="Liquid glass amount">
          <span class="range-row__end">Liquid</span>
          <output class="range-row__value" data-output="liquid"></output>
        </div>`, supportsLiquid
            ? "How much the glass bends and flows. Drag it and watch this panel."
            : "Refraction needs a Chromium browser (Chrome, Edge, Brave, Opera). Here the slider only changes the frost.")}
      ${section("Motion effects", `
        <div class="range-row range-row--steps">
          <input type="range" min="0" max="3" step="1" data-setting="motion" aria-label="Motion effects">
          <div class="steps">${settings.motionLevels.map(level => `<span>${level}</span>`).join("")}</div>
        </div>`, "Minimal stops all animation. Full turns on everything, including the dock magnifier and flowing glass.")}
      ${section("Background", `
        <div class="choice-grid choice-grid--bg">${settings.bgEffects.map(effect => `
          <button type="button" class="choice choice--bg" data-choice="bgEffect" data-value="${effect.id}">
            ${{ dust: icons.dust, snow: icons.snow, rain: icons.rain, sparks: icons.flame, plain: icons.square }[effect.id]}<span>${effect.label}</span>
          </button>`).join("")}</div>
        ${toggle("lighting", "Dynamic lighting", "Three hidden light sources drift around the screen. You only see them through the dust they light up.")}
        <div class="row row--upload">
          <span class="row__text"><span class="row__title">Your own background</span><span class="row__detail" data-bg-status></span></span>
          <span class="row__actions">
            <label class="btn">${icons.upload}<span>Upload</span><input type="file" accept="image/*,video/mp4,video/webm" data-action="bg-upload" hidden></label>
            <button type="button" class="btn btn--ghost" data-action="bg-remove">${icons.trash}<span>Remove</span></button>
          </span>
        </div>
        <div class="range-row" data-bg-dim>
          <span class="range-row__end">Dim</span>
          <input type="range" min="0" max="90" step="1" data-setting="bgDim" aria-label="Dim custom background">
          <output class="range-row__value" data-output="bgDim"></output>
        </div>`)}
    `,
    cloaking: () => `
      ${section("Tab disguise", `<div class="choice-grid choice-grid--cloak">${settings.cloakPresets.map(preset => `
        <button type="button" class="choice" data-choice="cloakPreset" data-value="${preset.id}">
          ${preset.domain ? `<img src="${settings.iconFor(preset.domain)}" alt="" width="20" height="20">` : preset.id === "none" ? icons.close : icons.sparkle}
          <span>${preset.label}</span>
        </button>`).join("")}</div>`, "Changes this tab's title and icon.")}
      <div class="cloak-custom" data-cloak-custom>
        ${textInput("cloakTitle", "Custom title", "e.g. Assignments")}
        ${textInput("cloakFavicon", "Custom icon URL", "https://…/favicon.ico")}
      </div>
      ${section("Open cloaked", `
        <div class="btn-row">
          <button type="button" class="btn btn--primary" data-action="cloak-aboutblank">${icons.popout}<span>Open in about:blank</span></button>
          <button type="button" class="btn" data-action="cloak-blob">${icons.popout}<span>Open in blob:</span></button>
        </div>`, "Opens blackwaves inside a blank tab, so its address never shows up in your history.")}
      ${section("Auto-launch", `
        <div class="seg">${[["off", "Off"], ["aboutblank", "about:blank"], ["blob", "blob:"]].map(([value, label]) => `
          <button type="button" class="seg__item" data-choice="autoCloak" data-value="${value}">${label}</button>`).join("")}</div>
        ${textInput("cloakRedirect", "Then send this tab to", "https://classroom.google.com/", 'inputmode="url"')}`, "Each time you open blackwaves it reopens itself cloaked, then sends the original tab somewhere harmless.")}
    `,
    advanced: () => `
      ${section("Transport", `<div class="choice-list">${settings.transports.map(transport => `
        <button type="button" class="choice choice--wide" data-choice="transport" data-value="${transport.id}">
          <span class="choice__title">${transport.label}</span><span class="choice__detail">${transport.detail}</span>
        </button>`).join("")}</div>
        ${textInput("wispUrl", "Wisp server", "Blank uses this site's own server", 'inputmode="url"')}`)}
      ${section("Speed", toggle("preloadSearch", "Search engine pre-load", "Warms the proxy up on your search engine in the background, so your first search opens instantly."))}
      ${section("Privacy", `
        ${toggle("saveCookies", "Save cookies", "Keeps you signed in to sites between visits. Off clears them each time blackwaves opens.")}
        ${toggle("saveHistory", "Save browsing history", "Remembers pages you visit and things you search for.")}
        ${toggle("saveSiteData", "Save site data", "Lets sites keep local storage, databases and cache.")}
      `)}
      ${section("Browsing history", `<div data-history></div>
        <div class="btn-row">
          <button type="button" class="btn" data-action="clear-history">${icons.trash}<span>Clear history</span></button>
          <button type="button" class="btn" data-action="clear-cookies">${icons.trash}<span>Clear cookies</span></button>
          <button type="button" class="btn" data-action="clear-data">${icons.trash}<span>Clear site data</span></button>
          <button type="button" class="btn btn--danger" data-action="reset">${icons.reload}<span>Reset all settings</span></button>
        </div>`)}
    `,
    cloudsync: () => `<div data-cloud></div>`,
    about: () => `
      <div class="about-hero">
        <img src="/favicon.ico" alt="" width="56" height="56">
        <div><p class="about-hero__name">blackwaves</p><p class="about-hero__ver">version ${version}</p></div>
      </div>
      <div class="btn-row">
        <a class="btn btn--primary" href="https://discord.gg/mtGdkqXyyU" target="_blank" rel="noopener">${icons.discord}<span>Discord server</span></a>
        <a class="btn" href="https://github.com/yaanscoat/blackwaves" target="_blank" rel="noopener">${icons.github}<span>GitHub</span></a>
      </div>
      ${section("Changelog", changelog.map(entry => `
        <div class="changelog">
          <p class="changelog__head"><strong>${entry.version}</strong><span>${entry.date}</span></p>
          <ul>${entry.notes.map(note => `<li>${escapeHtml(note)}</li>`).join("")}</ul>
        </div>`).join(""))}
      ${section("Credits", `
        <div class="credits">
          <p class="credits__end">That's it! You're reached the end of blackwaves!</p>
          <ul>${credits.map(([name, role]) => `<li><span>${name}</span><span>${role}</span></li>`).join("")}</ul>
        </div>`)}
    `
};

export const createSettingsPanel = ({ actions, toast }) => {
    const backdrop = document.querySelector("#settings");
    const dialog = document.querySelector("#settings-dialog");
    const nav = document.querySelector("#settings-nav");
    const title = document.querySelector("#settings-title");
    const content = document.querySelector("#settings-content");
    let current = storage.read("settingsTab", "preferences");
    if (!tabs.some(tab => tab.id === current))
        current = "preferences";
    let returnFocus = null;

    nav.innerHTML = tabs.map(tab => `
      <button type="button" class="set-tab" role="tab" data-tab="${tab.id}" id="set-tab-${tab.id}" aria-controls="settings-content">
        ${tab.icon}<span>${tab.label}</span>
      </button>`).join("");

    const sync = () => {
        const values = settings.all();
        for (const el of content.querySelectorAll("[data-choice]"))
            el.setAttribute("aria-pressed", String(String(values[el.dataset.choice]) === el.dataset.value));
        for (const el of content.querySelectorAll("[data-setting]")) {
            const value = values[el.dataset.setting];
            if (el.type === "checkbox")
                el.checked = Boolean(value);
            else if (document.activeElement !== el)
                el.value = value ?? "";
            if (el.type === "range")
                el.style.setProperty("--fill", `${((value - el.min) / (el.max - el.min)) * 100}%`);
        }
        for (const out of content.querySelectorAll("[data-output]"))
            out.textContent = `${values[out.dataset.output]}%`;
        const custom = content.querySelector("[data-cloak-custom]");
        if (custom) {
            custom.hidden = values.cloakPreset !== "custom";
        }
        const bgStatus = content.querySelector("[data-bg-status]");
        if (bgStatus) {
            bgStatus.textContent = values.customBg ? "In use. Effects still play on top; pick Plain black to show only your image." : "Images, GIFs or short MP4/WebM videos.";
            content.querySelector('[data-action="bg-remove"]').disabled = !values.customBg;
            content.querySelector("[data-bg-dim]").hidden = !values.customBg;
        }
        renderHistory();
        renderCloud();
    };

    const renderHistory = () => {
        const host = content.querySelector("[data-history]");
        if (!host)
            return;
        if (!settings.get("saveHistory")) {
            host.innerHTML = `<p class="set-note">History saving is off.</p>`;
            return;
        }
        const visits = history.visits().slice(0, 8);
        const searches = history.searches().length;
        host.innerHTML = visits.length
            ? `<ul class="history-list">${visits.map(item => `<li><img src="/api/icon/${escapeHtml(new URL(item.url).hostname)}" alt="" width="16" height="16"><span>${escapeHtml(item.title || item.url)}</span><time>${timeAgo(item.at)}</time></li>`).join("")}</ul>
               <p class="set-note">${history.visits().length} pages and ${searches} searches saved.</p>`
            : `<p class="set-note">Nothing yet. ${searches ? `${searches} searches saved.` : ""}</p>`;
    };

    const renderCloud = () => {
        const host = content.querySelector("[data-cloud]");
        if (!host)
            return;
        const s = cloud.status();
        if (host.dataset.state === JSON.stringify(s))
            return;
        host.dataset.state = JSON.stringify(s);
        const what = `<ul class="sync-list">
            <li>${icons.paintbrush}Themes, motion, glass and backgrounds</li>
            <li>${icons.screwdriver}Every setting and tab cloak</li>
            <li>${icons.history}Browsing and search history</li>
            <li>${icons.lock}Cookies, so you stay signed in to sites</li>
            <li>${icons.star}Favorite and recent games</li>
          </ul>`;
        if (!s.signedIn) {
            host.innerHTML = `
              ${section("CloudSync", `
                <form class="sync-form" data-sync-form>
                  <label class="field-row"><span class="row__title">Username</span><input class="input" name="username" autocomplete="username" spellcheck="false" required minlength="3" maxlength="24" pattern="[a-zA-Z0-9_.\\-]{3,24}"></label>
                  <label class="field-row"><span class="row__title">Password</span><input class="input" name="password" type="password" autocomplete="current-password" required minlength="6" maxlength="128"></label>
                  ${s.error ? `<p class="form-error" role="alert">${escapeHtml(s.error)}</p>` : ""}
                  <div class="btn-row">
                    <button type="submit" class="btn btn--primary" value="login" ${s.busy ? "disabled" : ""}>${icons.user}<span>Sign in</span></button>
                    <button type="submit" class="btn" value="register" ${s.busy ? "disabled" : ""}>${icons.plus}<span>Create account</span></button>
                  </div>
                </form>`, "Sign in with a username and password and everything follows you to any device running blackwaves.")}
              ${section("What syncs", what)}`;
            return;
        }
        host.innerHTML = `
          ${section("CloudSync", `
            <div class="sync-card">
              <span class="sync-card__avatar">${escapeHtml(s.username[0]?.toUpperCase() ?? "?")}</span>
              <div><p class="row__title">${escapeHtml(s.username)}</p><p class="row__detail">${s.busy ? "Syncing…" : s.lastSync ? `Last synced ${timeAgo(s.lastSync)}` : "Not synced yet"}</p></div>
            </div>
            ${s.error ? `<p class="form-error" role="alert">${escapeHtml(s.error)}</p>` : ""}
            <label class="row row--toggle">
              <span class="row__text"><span class="row__title">Sync automatically</span><span class="row__detail">Uploads a few seconds after anything changes.</span></span>
              <span class="toggle"><input type="checkbox" role="switch" data-cloud-auto ${s.auto ? "checked" : ""}><span class="toggle__track" aria-hidden="true"></span></span>
            </label>
            <div class="btn-row">
              <button type="button" class="btn btn--primary" data-action="sync-push" ${s.busy ? "disabled" : ""}>${icons.upload}<span>Sync now</span></button>
              <button type="button" class="btn" data-action="sync-pull" ${s.busy ? "disabled" : ""}>${icons.sync}<span>Restore from cloud</span></button>
              <button type="button" class="btn btn--ghost" data-action="sync-signout">${icons.close}<span>Sign out</span></button>
            </div>`)}
          ${section("What syncs", what)}
          ${section("Delete account", `
            <form class="sync-delete" data-sync-delete>
              <input class="input" type="password" name="password" placeholder="Password" autocomplete="current-password" required aria-label="Password">
              <button type="submit" class="btn btn--danger">${icons.trash}<span>Delete account</span></button>
            </form>`, "Removes your account and its data from this server.")}`;
    };

    const show = (id) => {
        current = id;
        storage.write("settingsTab", id);
        for (const button of nav.children) {
            const on = button.dataset.tab === id;
            button.setAttribute("aria-selected", String(on));
            button.tabIndex = on ? 0 : -1;
        }
        const tab = tabs.find(t => t.id === id);
        title.innerHTML = `${tab.icon}<span>${tab.label}</span>`;
        content.setAttribute("aria-labelledby", `set-tab-${id}`);
        content.innerHTML = panels[id]();
        content.scrollTop = 0;
        content.classList.remove("is-entering");
        void content.offsetWidth;
        content.classList.add("is-entering");
        sync();
    };

    nav.addEventListener("click", event => {
        const button = event.target.closest("[data-tab]");
        if (button)
            show(button.dataset.tab);
    });
    nav.addEventListener("keydown", event => {
        const keys = { ArrowDown: 1, ArrowRight: 1, ArrowUp: -1, ArrowLeft: -1 };
        if (!(event.key in keys))
            return;
        event.preventDefault();
        const index = tabs.findIndex(t => t.id === current);
        const next = tabs[(index + keys[event.key] + tabs.length) % tabs.length];
        show(next.id);
        nav.querySelector(`[data-tab="${next.id}"]`).focus();
    });

    content.addEventListener("click", async event => {
        const choice = event.target.closest("[data-choice]");
        if (choice) {
            const key = choice.dataset.choice;
            const raw = choice.dataset.value;
            settings.set({ [key]: typeof settings.defaults[key] === "number" ? Number(raw) : raw });
            return;
        }
        const action = event.target.closest("button[data-action]")?.dataset.action;
        if (action && actions[action]) {
            try {
                await actions[action]();
            }
            catch (error) {
                toast(error.message);
            }
            sync();
        }
    });

    content.addEventListener("input", event => {
        const el = event.target;
        if (el.matches("input[type=range][data-setting]"))
            settings.set({ [el.dataset.setting]: Number(el.value) });
    });

    content.addEventListener("change", async event => {
        const el = event.target;
        if (el.matches("[data-setting]")) {
            if (el.type === "checkbox")
                settings.set({ [el.dataset.setting]: el.checked });
            else if (el.type !== "range") {
                const { rejected } = settings.set({ [el.dataset.setting]: el.value });
                if (rejected.includes(el.dataset.setting))
                    toast("That value is not valid, so it was reset.");
                el.value = settings.get(el.dataset.setting);
            }
            return;
        }
        if (el.matches("[data-action=bg-upload]") && el.files?.[0]) {
            try {
                await actions["bg-upload"](el.files[0]);
            }
            catch (error) {
                toast(error.message);
            }
            el.value = "";
            sync();
            return;
        }
        if (el.matches("[data-cloud-auto]"))
            cloud.setAuto(el.checked);
    });

    content.addEventListener("submit", async event => {
        event.preventDefault();
        const form = event.target;
        if (form.matches("[data-sync-form]")) {
            const create = event.submitter?.value === "register";
            const data = new FormData(form);
            try {
                const reload = await cloud.signIn(String(data.get("username")), String(data.get("password")), create);
                toast(create ? "Account created. You're syncing." : "Signed in. Your data is restored.");
                if (reload)
                    actions["reload-for-cookies"]();
            }
            catch { }
            return;
        }
        if (form.matches("[data-sync-delete]")) {
            const password = String(new FormData(form).get("password"));
            if (!confirm("Delete your CloudSync account and everything stored in it?"))
                return;
            try {
                await cloud.deleteAccount(password);
                toast("Account deleted.");
            }
            catch (error) {
                toast(error.message);
            }
        }
    });

    settings.onChange(() => {
        if (!backdrop.hidden)
            sync();
    });
    history.onChange(() => {
        if (!backdrop.hidden && current === "advanced")
            renderHistory();
    });
    cloud.onStatus(() => {
        if (!backdrop.hidden && current === "cloudsync")
            renderCloud();
    });

    const focusables = () => [...dialog.querySelectorAll('button:not([disabled]), [href], input:not([disabled]):not([type=hidden]), select, textarea, [tabindex]:not([tabindex="-1"])')].filter(el => el.offsetParent !== null || el === document.activeElement);

    dialog.addEventListener("keydown", event => {
        if (event.key === "Escape") {
            event.preventDefault();
            close();
            return;
        }
        if (event.key !== "Tab")
            return;
        const list = focusables();
        if (!list.length)
            return;
        const first = list[0], last = list[list.length - 1];
        if (event.shiftKey && document.activeElement === first) {
            event.preventDefault();
            last.focus();
        }
        else if (!event.shiftKey && document.activeElement === last) {
            event.preventDefault();
            first.focus();
        }
    });
    backdrop.addEventListener("pointerdown", event => {
        if (event.target === backdrop)
            close();
    });
    document.querySelector("#settings-close").addEventListener("click", () => close());

    const open = (tab = current) => {
        returnFocus = document.activeElement;
        backdrop.hidden = false;
        document.documentElement.classList.add("settings-open");
        show(tab);
        requestAnimationFrame(() => {
            backdrop.classList.add("is-open");
            nav.querySelector(`[data-tab="${current}"]`)?.focus();
        });
    };

    const close = () => {
        if (backdrop.hidden)
            return;
        backdrop.classList.remove("is-open");
        document.documentElement.classList.remove("settings-open");
        const done = () => {
            backdrop.hidden = true;
            content.innerHTML = "";
        };
        const duration = parseFloat(getComputedStyle(backdrop).transitionDuration) * 1000;
        if (duration > 0)
            setTimeout(done, duration);
        else
            done();
        returnFocus?.focus?.();
    };

    return {
        open,
        close,
        toggle: () => (backdrop.hidden ? open() : close()),
        get isOpen() {
            return !backdrop.hidden;
        }
    };
};
