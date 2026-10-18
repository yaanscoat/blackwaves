import * as settings from "./settings.js";
const originalTitle = document.title;
const originalIcon = document.querySelector("link[rel~='icon']")?.href ?? "";
export const resolve = () => {
    const preset = settings.cloakPresets.find(p => p.id === settings.get("cloakPreset"));
    if (!preset || preset.id === "none")
        return { title: "", favicon: "" };
    return preset.id === "custom"
        ? {
            title: settings.get("cloakTitle"),
            favicon: settings.get("cloakFavicon")
        }
        : { title: preset.title, favicon: settings.iconFor(preset.domain) };
};
const applyTo = (target, title, favicon) => {
    target.title = title || originalTitle;
    const existing = target.querySelector("link[rel~='icon']");
    if (!favicon && !originalIcon) {
        existing?.remove();
        return;
    }
    const link = existing ?? target.createElement("link");
    link.rel = "icon";
    link.href = favicon || originalIcon;
    if (!existing)
        target.head.append(link);
};
// True when this page is already running inside an about:blank / blob:
// wrapper we opened.
export const isWrapped = () => {
    try {
        return parent !== window && parent.location.origin === location.origin && parent.document.documentElement.dataset.blackwavesCloak === "1";
    }
    catch {
        return false;
    }
};
export const applyCloak = () => {
    const { title, favicon } = resolve();
    applyTo(document, title, favicon);
    if (isWrapped()) {
        try {
            applyTo(parent.document, title, favicon);
        }
        catch { }
    }
};
const fill = (doc, src, title, favicon) => {
    doc.documentElement.dataset.blackwavesCloak = "1";
    doc.title = title;
    doc.body.replaceChildren();
    if (favicon) {
        const link = doc.createElement("link");
        link.rel = "icon";
        link.href = favicon;
        doc.head.append(link);
    }
    const style = doc.createElement("style");
    style.textContent = "html,body{margin:0;height:100%;overflow:hidden;background:#000}iframe{width:100%;height:100%;border:0;display:block}";
    doc.head.append(style);
    const iframe = doc.createElement("iframe");
    iframe.src = src;
    iframe.allow = "autoplay; fullscreen; clipboard-read; clipboard-write; gamepad; pointer-lock; microphone; camera; display-capture";
    iframe.setAttribute("allowfullscreen", "");
    doc.body.append(iframe);
};
// Opens `src` (this site by default) inside a fresh about:blank or blob:
// tab so the real URL never shows in the address bar or history.
// Returns false when the popup was blocked.
export const launch = (kind, src = location.href) => {
    const resolved = resolve();
    const title = resolved.title || "Google Classroom";
    const favicon = resolved.favicon || settings.iconFor("classroom.google.com");
    if (kind === "aboutblank") {
        const tab = window.open("about:blank", "_blank");
        if (!tab)
            return false;
        fill(tab.document, src, title, favicon);
        return true;
    }
    const doc = document.implementation.createHTMLDocument(title);
    fill(doc, src, title, favicon);
    const url = URL.createObjectURL(new Blob(["<!doctype html>" + doc.documentElement.outerHTML], { type: "text/html" }));
    const tab = window.open(url, "_blank");
    if (!tab) {
        URL.revokeObjectURL(url);
        return false;
    }
    setTimeout(() => URL.revokeObjectURL(url), 60000);
    return true;
};
// Called once on startup. Browsers block popups that are not caused by a
// click, so if the first attempt fails we wait for the next one.
export const autoLaunch = (onBlocked) => {
    const kind = settings.get("autoCloak");
    if (kind === "off" || parent !== window)
        return;
    const go = () => {
        if (!launch(kind))
            return false;
        location.replace(settings.get("cloakRedirect") || "https://classroom.google.com/");
        return true;
    };
    if (go())
        return;
    onBlocked?.();
    const retry = () => {
        if (go())
            removeEventListener("pointerdown", retry, true);
    };
    addEventListener("pointerdown", retry, true);
};
