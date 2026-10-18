import * as settings from "./settings.js";
import { icons } from "./icons.js";

let openMenu = null;

const close = () => {
    openMenu?.remove();
    openMenu?._button?.setAttribute("aria-expanded", "false");
    openMenu = null;
};

addEventListener("pointerdown", event => {
    if (openMenu && !openMenu.contains(event.target) && !openMenu._button.contains(event.target))
        close();
}, true);
addEventListener("keydown", event => {
    if (event.key === "Escape" && openMenu) {
        event.stopPropagation();
        const button = openMenu._button;
        close();
        button.focus();
    }
}, true);
addEventListener("resize", close);

// A small favicon button that switches the search engine everywhere.
export const enginePicker = (button) => {
    button.type = "button";
    button.classList.add("engine-picker");
    button.setAttribute("aria-haspopup", "menu");
    button.setAttribute("aria-expanded", "false");
    const render = () => {
        const engine = settings.engineById(settings.get("searchEngine"));
        button.title = `Searching with ${engine.label}`;
        button.setAttribute("aria-label", `Search engine: ${engine.label}`);
        button.innerHTML = `<img src="${settings.iconFor(engine.domain)}" alt="" width="18" height="18">${icons.chevronDown}`;
    };
    render();
    settings.onChange((_, changed) => {
        if (changed.includes("searchEngine"))
            render();
    });
    button.addEventListener("click", () => {
        if (openMenu?._button === button) {
            close();
            return;
        }
        close();
        const current = settings.get("searchEngine");
        const menu = document.createElement("div");
        menu.className = "engine-menu";
        menu.setAttribute("role", "menu");
        menu._button = button;
        menu.innerHTML = `<p class="engine-menu__title">Search with</p>` + settings.searchEngines.map(engine => `
            <button type="button" role="menuitemradio" aria-checked="${engine.id === current}" data-engine="${engine.id}">
              <img src="${settings.iconFor(engine.domain)}" alt="" width="18" height="18">
              <span>${engine.label}</span>
              ${engine.id === "duckduckgo" ? '<em>main</em>' : ""}
              ${engine.id === current ? icons.check : ""}
            </button>`).join("");
        menu.addEventListener("click", event => {
            const item = event.target.closest("[data-engine]");
            if (!item)
                return;
            settings.set({ searchEngine: item.dataset.engine });
            close();
            button.focus();
        });
        document.body.append(menu);
        const rect = button.getBoundingClientRect();
        const width = menu.offsetWidth;
        menu.style.left = `${Math.max(12, Math.min(innerWidth - width - 12, rect.left))}px`;
        const below = rect.bottom + 8;
        menu.style.top = below + menu.offsetHeight > innerHeight - 12
            ? `${Math.max(12, rect.top - menu.offsetHeight - 8)}px`
            : `${below}px`;
        button.setAttribute("aria-expanded", "true");
        openMenu = menu;
        menu.querySelector('[aria-checked="true"]')?.focus();
    });
};
