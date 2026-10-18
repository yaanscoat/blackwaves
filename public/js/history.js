import * as storage from "./storage.js";
import * as settings from "./settings.js";

const limits = { visits: 400, searches: 150, recentGames: 24 };
const listeners = new Set();
const emit = (kind) => listeners.forEach(fn => fn(kind));

export const onChange = (fn) => {
    listeners.add(fn);
    return () => listeners.delete(fn);
};

const list = (name) => {
    const value = storage.read(name, []);
    return Array.isArray(value) ? value : [];
};

const push = (name, entry, same) => {
    const next = [entry, ...list(name).filter(item => !same(item))].slice(0, limits[name]);
    storage.write(name, next);
    emit(name);
};

export const visits = () => list("visits");
export const searches = () => list("searches");

export const addVisit = (url, title = "") => {
    if (!settings.get("saveHistory") || !/^https?:/i.test(url))
        return;
    push("visits", { url, title, at: Date.now() }, item => item.url === url);
};

export const updateTitle = (url, title) => {
    if (!settings.get("saveHistory") || !title)
        return;
    const items = visits();
    const hit = items.find(item => item.url === url);
    if (!hit || hit.title === title)
        return;
    hit.title = title;
    storage.write("visits", items);
    emit("visits");
};

export const addSearch = (query) => {
    const q = query.trim();
    if (!settings.get("saveHistory") || !q)
        return;
    push("searches", { q, at: Date.now() }, item => item.q.toLowerCase() === q.toLowerCase());
};

export const clear = () => {
    storage.write("visits", []);
    storage.write("searches", []);
    emit("visits");
    emit("searches");
};

// Game favourites and recents are not "browsing history", so they stay even
// when history saving is off.
export const favorites = () => list("favorites");
export const isFavorite = (url) => favorites().includes(url);
export const toggleFavorite = (url) => {
    const items = favorites();
    const next = items.includes(url) ? items.filter(item => item !== url) : [url, ...items];
    storage.write("favorites", next);
    emit("favorites");
    return next.includes(url);
};
export const recentGames = () => list("recentGames");
export const addRecentGame = (url) => push("recentGames", url, item => item === url);

// Raw access for CloudSync.
export const exportAll = () => ({
    visits: visits(),
    searches: searches(),
    favorites: favorites(),
    recentGames: recentGames()
});
export const importAll = (data) => {
    for (const name of ["visits", "searches", "favorites", "recentGames"]) {
        if (Array.isArray(data?.[name])) {
            storage.write(name, data[name]);
            emit(name);
        }
    }
};
