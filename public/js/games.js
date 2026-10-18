import * as settings from "./settings.js";
import * as history from "./history.js";
import { icons } from "./icons.js";
import { escapeHtml, debounce } from "./util.js";
import { launch } from "./cloak.js";

const pageSize = 96;
const sourceLabel = Object.fromEntries(settings.gameSources.map(source => [source.id, source.label]));

const hue = (text) => {
    let h = 0;
    for (const ch of text)
        h = (h * 31 + ch.charCodeAt(0)) >>> 0;
    return h % 360;
};

const fallbackCover = (name) => `<span class="game-card__fallback" style="--h:${hue(name)}">${escapeHtml(name.replace(/[^a-z0-9]/gi, "").slice(0, 2) || "?")}</span>`;

export const createGames = ({ onPlay, onExit, toast }) => {
    const grid = document.querySelector("#games-grid");
    const search = document.querySelector("#games-search");
    const chips = document.querySelector("#games-chips");
    const count = document.querySelector("#games-count");
    const sentinel = document.querySelector("#games-more");
    const scroller = grid.closest(".view");
    const player = document.querySelector("#player");
    const playerFrame = document.querySelector("#player-frame");
    const playerTitle = document.querySelector("#player-title");
    const playerSource = document.querySelector("#player-source");
    const playerFav = document.querySelector("#player-fav");
    let games = [];
    let filtered = [];
    let shown = 0;
    let loading = null;
    let shelf = "all";
    let current = null;

    const chipList = [
        ...settings.gameSources.map(source => ({ key: `source:${source.id}`, label: source.label })),
        { key: "shelf:favorites", label: "Favorites", icon: icons.star },
        { key: "shelf:recent", label: "Recent", icon: icons.history }
    ];
    chips.innerHTML = chipList.map(chip => `<button type="button" class="chip" data-chip="${chip.key}">${chip.icon ?? ""}${chip.label}</button>`).join("");

    const syncChips = () => {
        const source = settings.get("gameSource");
        for (const chip of chips.children) {
            const [kind, id] = chip.dataset.chip.split(":");
            chip.setAttribute("aria-pressed", String(kind === "source" ? shelf === "all" && id === source : shelf === id));
        }
    };

    chips.addEventListener("click", event => {
        const chip = event.target.closest("[data-chip]");
        if (!chip)
            return;
        const [kind, id] = chip.dataset.chip.split(":");
        if (kind === "source") {
            shelf = "all";
            settings.set({ gameSource: id });
        }
        else
            shelf = shelf === id ? "all" : id;
        syncChips();
        apply();
    });

    const card = (game) => {
        const fav = history.isFavorite(game.u);
        return `<div class="game-card" role="listitem">
          <button type="button" class="game-card__play" data-play="${escapeHtml(game.u)}" aria-label="Play ${escapeHtml(game.n)}">
            <span class="game-card__cover">${game.i
            ? `<img src="${escapeHtml(game.i)}" alt="" loading="lazy" decoding="async" crossorigin="anonymous">`
            : fallbackCover(game.n)}</span>
            <span class="game-card__meta"><span class="game-card__name">${escapeHtml(game.n)}</span><span class="game-card__src">${sourceLabel[game.s] ?? game.s}</span></span>
          </button>
          <button type="button" class="game-card__fav" data-fav="${escapeHtml(game.u)}" aria-pressed="${fav}" aria-label="${fav ? "Remove from" : "Add to"} favorites">${fav ? icons.starFilled : icons.star}</button>
        </div>`;
    };

    const more = () => {
        if (shown >= filtered.length)
            return;
        const slice = filtered.slice(shown, shown + pageSize);
        shown += slice.length;
        grid.insertAdjacentHTML("beforeend", slice.map(card).join(""));
        sentinel.hidden = shown >= filtered.length;
    };

    // Broken covers fall back to the generated tile.
    grid.addEventListener("error", event => {
        const img = event.target;
        if (img.tagName !== "IMG")
            return;
        const name = img.closest(".game-card")?.querySelector(".game-card__name")?.textContent ?? "?";
        img.outerHTML = fallbackCover(name);
    }, true);

    const apply = () => {
        const q = search.value.trim().toLowerCase();
        const source = settings.get("gameSource");
        let list;
        if (shelf === "favorites") {
            const favs = new Set(history.favorites());
            list = games.filter(game => favs.has(game.u));
        }
        else if (shelf === "recent") {
            const byUrl = new Map(games.map(game => [game.u, game]));
            list = history.recentGames().map(url => byUrl.get(url)).filter(Boolean);
        }
        else
            list = source === "all" ? games : games.filter(game => game.s === source);
        if (q)
            list = list.filter(game => game.n.toLowerCase().includes(q));
        filtered = list;
        shown = 0;
        grid.replaceChildren();
        scroller.scrollTop = 0;
        count.textContent = games.length
            ? `${filtered.length.toLocaleString()} ${filtered.length === 1 ? "game" : "games"}`
            : "";
        if (!filtered.length && games.length) {
            grid.innerHTML = `<p class="empty">${shelf === "favorites"
                ? "No favorites yet. Tap the star on any game."
                : shelf === "recent"
                    ? "Nothing played yet."
                    : `No games match “${escapeHtml(search.value)}”.`}</p>`;
        }
        more();
    };

    new IntersectionObserver(entries => {
        if (entries.some(entry => entry.isIntersecting))
            more();
    }, { root: scroller, rootMargin: "600px" }).observe(sentinel);

    const load = () => {
        loading ??= (async () => {
            grid.innerHTML = `<div class="games-loading">${Array.from({ length: 18 }, () => '<span class="skeleton"></span>').join("")}</div>`;
            try {
                const response = await fetch("/api/games/all");
                if (!response.ok)
                    throw new Error(`HTTP ${response.status}`);
                const data = await response.json();
                // Letters first, then numbers, then names that start with symbols.
                const rank = (name) => /^[a-z]/i.test(name) ? 0 : /^\d/.test(name) ? 1 : 2;
                games = data.games.sort((a, b) => rank(a.n) - rank(b.n) || a.n.localeCompare(b.n, undefined, { numeric: true, sensitivity: "base" }));
                if (data.failed?.length)
                    toast(`Some game sources did not answer: ${data.failed.map(id => sourceLabel[id] ?? id).join(", ")}.`);
                apply();
            }
            catch (error) {
                loading = null;
                grid.innerHTML = `<div class="empty"><p>Could not load the game library (${escapeHtml(error.message)}).</p><button type="button" class="btn" data-retry>Try again</button></div>`;
            }
        })();
        return loading;
    };

    grid.addEventListener("click", event => {
        if (event.target.closest("[data-retry]")) {
            void load();
            return;
        }
        const fav = event.target.closest("[data-fav]");
        if (fav) {
            const on = history.toggleFavorite(fav.dataset.fav);
            fav.setAttribute("aria-pressed", String(on));
            fav.innerHTML = on ? icons.starFilled : icons.star;
            if (shelf === "favorites" && !on)
                apply();
            return;
        }
        const play = event.target.closest("[data-play]");
        if (play)
            open(games.find(game => game.u === play.dataset.play));
    });

    search.addEventListener("input", debounce(apply, 120));

    const setFav = () => {
        const on = current && history.isFavorite(current.u);
        playerFav.setAttribute("aria-pressed", String(Boolean(on)));
        playerFav.innerHTML = on ? icons.starFilled : icons.star;
    };

    const open = (game) => {
        if (!game)
            return;
        current = game;
        history.addRecentGame(game.u);
        playerTitle.textContent = game.n;
        playerSource.textContent = sourceLabel[game.s] ?? game.s;
        setFav();
        playerFrame.src = game.u;
        player.hidden = false;
        document.documentElement.classList.add("is-playing");
        onPlay();
        requestAnimationFrame(() => playerFrame.focus());
    };

    const close = () => {
        if (player.hidden)
            return;
        player.hidden = true;
        playerFrame.src = "about:blank";
        current = null;
        document.documentElement.classList.remove("is-playing");
        if (document.fullscreenElement)
            void document.exitFullscreen();
        onExit();
        if (shelf === "recent")
            apply();
    };

    document.querySelector("#player-back").addEventListener("click", close);
    document.querySelector("#player-reload").addEventListener("click", () => {
        if (current)
            playerFrame.src = current.u;
    });
    document.querySelector("#player-fullscreen").addEventListener("click", () => {
        playerFrame.requestFullscreen?.().catch(() => toast("Fullscreen was blocked."));
    });
    document.querySelector("#player-popout").addEventListener("click", () => {
        if (!current)
            return;
        if (!launch("aboutblank", new URL(current.u, location.href).href))
            toast("The browser blocked the popup.");
    });
    playerFav.addEventListener("click", () => {
        if (!current)
            return;
        history.toggleFavorite(current.u);
        setFav();
    });

    settings.onChange((_, changed) => {
        if (changed.includes("gameSource")) {
            syncChips();
            if (games.length)
                apply();
        }
    });
    syncChips();

    return {
        show() {
            void load();
        },
        close,
        get playing() {
            return !player.hidden;
        },
        focus: () => search.focus()
    };
};
