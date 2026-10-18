import * as storage from "./storage.js";
import * as settings from "./settings.js";
import * as history from "./history.js";
import * as idb from "./idb.js";
import { debounce } from "./util.js";

// Account data lives on this blackwaves server (see api/sync.js). What
// syncs: every setting (themes, cloaks, motion...), browsing and search
// history, game favourites/recents, proxied-site cookies and the custom
// background.
const storeKey = "cloudsync";
const maxBackgroundBytes = 7 * 1024 * 1024;
const listeners = new Set();
let applying = false;
let busy = false;
let lastError = "";

const account = () => storage.read(storeKey, null);
const saveAccount = (value) => {
    if (value)
        storage.write(storeKey, value);
    else
        storage.remove(storeKey);
    emit();
};

const emit = () => listeners.forEach(fn => fn(status()));

export const onStatus = (fn) => {
    listeners.add(fn);
    return () => listeners.delete(fn);
};

export const status = () => {
    const a = account();
    return {
        signedIn: Boolean(a?.token),
        username: a?.username ?? "",
        lastSync: a?.lastSync ?? 0,
        auto: a?.auto !== false,
        busy,
        error: lastError
    };
};

const request = async (method, path, body, token = account()?.token) => {
    const headers = { "content-type": "application/json" };
    if (token)
        headers.authorization = `Bearer ${token}`;
    const response = await fetch(`/api/sync/${path}`, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
        cache: "no-store"
    });
    let data = {};
    try {
        data = await response.json();
    }
    catch { }
    if (response.status === 401 && path === "data")
        saveAccount(null);
    if (!response.ok)
        throw new Error(data.error ?? `CloudSync answered ${response.status}`);
    return data;
};

const blobToDataUrl = (blob) => new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
});

const collect = async () => {
    const data = {
        v: 1,
        savedAt: Date.now(),
        settings: settings.all(),
        history: history.exportAll(),
        cookies: settings.get("saveCookies") ? await idb.readCookies() : null,
        background: null
    };
    if (settings.get("customBg")) {
        const blob = await idb.get("background");
        if (blob instanceof Blob && blob.size <= maxBackgroundBytes)
            data.background = await blobToDataUrl(blob);
    }
    return data;
};

// Returns true when the page has to reload for pulled cookies to apply.
const applyData = async (data) => {
    if (!data || typeof data !== "object")
        return false;
    applying = true;
    let reload = false;
    try {
        if (typeof data.background === "string" && data.background.startsWith("data:")) {
            const blob = await (await fetch(data.background)).blob();
            await idb.set("background", blob);
        }
        if (data.settings)
            settings.replace({ ...data.settings, customBg: Boolean(data.background) || Boolean(data.settings.customBg && (await idb.get("background"))) });
        if (data.history)
            history.importAll(data.history);
        if (typeof data.cookies === "string" && settings.get("saveCookies")) {
            const local = await idb.readCookies();
            if (local !== data.cookies) {
                await idb.writeCookies(data.cookies);
                reload = true;
            }
        }
    }
    finally {
        applying = false;
    }
    return reload;
};

const run = async (task) => {
    busy = true;
    lastError = "";
    emit();
    try {
        return await task();
    }
    catch (error) {
        lastError = error.message;
        throw error;
    }
    finally {
        busy = false;
        emit();
    }
};

export const push = () => run(async () => {
    const a = account();
    if (!a?.token)
        return;
    const { updatedAt } = await request("PUT", "data", { data: await collect() });
    saveAccount({ ...account(), lastSync: updatedAt });
});

export const pull = () => run(async () => {
    const a = account();
    if (!a?.token)
        return false;
    const { data, updatedAt } = await request("GET", "data");
    const reload = await applyData(data);
    saveAccount({ ...account(), lastSync: updatedAt || Date.now() });
    return reload;
});

// Sign in or create an account. An existing account's data wins over this
// browser's; a brand new account starts from this browser's data.
export const signIn = async (username, password, create = false) => {
    const result = await run(() => request("POST", create ? "register" : "login", { username, password }, null));
    saveAccount({ token: result.token, username: result.username, lastSync: 0, auto: true });
    if (!create && result.updatedAt)
        return pull();
    await push();
    return false;
};

export const signOut = async () => {
    try {
        await request("POST", "logout", {});
    }
    catch { }
    lastError = "";
    saveAccount(null);
};

export const deleteAccount = async (password) => {
    await run(() => request("DELETE", "account", { password }));
    saveAccount(null);
};

export const setAuto = (auto) => {
    const a = account();
    if (a)
        saveAccount({ ...a, auto });
};

const autoPush = debounce(() => {
    const s = status();
    if (s.signedIn && s.auto && !applying)
        push().catch(() => { });
}, 4000);

export const start = () => {
    settings.onChange(() => !applying && autoPush());
    history.onChange(() => !applying && autoPush());
    // Pick up changes made on other devices when the tab comes back.
    document.addEventListener("visibilitychange", () => {
        const s = status();
        if (document.visibilityState === "visible" && s.signedIn && s.auto && Date.now() - s.lastSync > 60000)
            pull().catch(() => { });
    });
};

export const backgroundChanged = () => autoPush();
