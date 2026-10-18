import { escapeHtml } from "./util.js";

// [name, url, icon domain, category]
const table = [
    ["YouTube", "https://www.youtube.com/", "youtube.com", "Watch"],
    ["Spotify", "https://open.spotify.com/", "spotify.com", "Listen"],
    ["Snapchat", "https://web.snapchat.com/", "snapchat.com", "Social"],
    ["Discord", "https://discord.com/app", "discord.com", "Social"],
    ["TikTok", "https://www.tiktok.com/", "tiktok.com", "Social"],
    ["Instagram", "https://www.instagram.com/", "instagram.com", "Social"],
    ["X", "https://x.com/", "x.com", "Social"],
    ["Reddit", "https://www.reddit.com/", "reddit.com", "Social"],
    ["Twitch", "https://www.twitch.tv/", "twitch.tv", "Watch"],
    ["Kick", "https://kick.com/", "kick.com", "Watch"],
    ["Netflix", "https://www.netflix.com/", "netflix.com", "Watch"],
    ["Crunchyroll", "https://www.crunchyroll.com/", "crunchyroll.com", "Watch"],
    ["YouTube Music", "https://music.youtube.com/", "music.youtube.com", "Listen"],
    ["SoundCloud", "https://soundcloud.com/", "soundcloud.com", "Listen"],
    ["Pandora", "https://www.pandora.com/", "pandora.com", "Listen"],
    ["Roblox", "https://www.roblox.com/", "roblox.com", "Play"],
    ["now.gg", "https://now.gg/", "now.gg", "Play"],
    ["GeForce NOW", "https://play.geforcenow.com/", "geforcenow.com", "Play"],
    ["Xbox Cloud", "https://www.xbox.com/play", "xbox.com", "Play"],
    ["Poki", "https://poki.com/", "poki.com", "Play"],
    ["CrazyGames", "https://www.crazygames.com/", "crazygames.com", "Play"],
    ["Coolmath Games", "https://www.coolmathgames.com/", "coolmathgames.com", "Play"],
    ["Chess.com", "https://www.chess.com/", "chess.com", "Play"],
    ["ChatGPT", "https://chatgpt.com/", "chatgpt.com", "Tools"],
    ["Claude", "https://claude.ai/", "claude.ai", "Tools"],
    ["Gemini", "https://gemini.google.com/", "gemini.google.com", "Tools"],
    ["Character.AI", "https://character.ai/", "character.ai", "Tools"],
    ["WhatsApp", "https://web.whatsapp.com/", "whatsapp.com", "Social"],
    ["Telegram", "https://web.telegram.org/", "telegram.org", "Social"],
    ["Messenger", "https://www.messenger.com/", "messenger.com", "Social"],
    ["Facebook", "https://www.facebook.com/", "facebook.com", "Social"],
    ["Pinterest", "https://www.pinterest.com/", "pinterest.com", "Social"],
    ["Threads", "https://www.threads.net/", "threads.net", "Social"],
    ["Bluesky", "https://bsky.app/", "bsky.app", "Social"],
    ["Tumblr", "https://www.tumblr.com/", "tumblr.com", "Social"],
    ["GitHub", "https://github.com/", "github.com", "Tools"],
    ["Wikipedia", "https://www.wikipedia.org/", "wikipedia.org", "Tools"],
    ["Google Translate", "https://translate.google.com/", "translate.google.com", "Tools"],
    ["Duolingo", "https://www.duolingo.com/", "duolingo.com", "Tools"],
    ["Amazon", "https://www.amazon.com/", "amazon.com", "Tools"]
];

export const apps = table.map(([name, url, domain, category]) => ({ name, url, domain, category }));

export const createApps = ({ onOpen }) => {
    const grid = document.querySelector("#apps-grid");
    const search = document.querySelector("#apps-search");
    const chips = document.querySelector("#apps-chips");
    const categories = ["All", ...new Set(apps.map(app => app.category))];
    let category = "All";

    chips.innerHTML = categories.map(name => `<button type="button" class="chip" data-category="${name}" aria-pressed="${name === category}">${name}</button>`).join("");
    chips.addEventListener("click", event => {
        const chip = event.target.closest("[data-category]");
        if (!chip)
            return;
        category = chip.dataset.category;
        for (const c of chips.children)
            c.setAttribute("aria-pressed", String(c === chip));
        render();
    });

    const render = () => {
        const q = search.value.trim().toLowerCase();
        const list = apps.filter(app => (category === "All" || app.category === category) && (!q || app.name.toLowerCase().includes(q)));
        grid.innerHTML = list.length
            ? list.map(app => `
            <button type="button" class="app-tile" data-url="${escapeHtml(app.url)}" style="--i:${apps.indexOf(app)}">
              <span class="app-tile__icon"><img src="/api/icon/${app.domain}" alt="" width="40" height="40" loading="lazy"></span>
              <span class="app-tile__name">${escapeHtml(app.name)}</span>
              <span class="app-tile__cat">${app.category}</span>
            </button>`).join("")
            : `<p class="empty">No apps match “${escapeHtml(search.value)}”. Press Enter to search the web for it.</p>`;
        for (const img of grid.querySelectorAll("img"))
            img.addEventListener("error", () => img.replaceWith(Object.assign(document.createElement("b"), { textContent: img.closest(".app-tile").querySelector(".app-tile__name").textContent[0] })), { once: true });
    };

    grid.addEventListener("click", event => {
        const tile = event.target.closest("[data-url]");
        if (tile)
            onOpen(tile.dataset.url);
    });
    search.addEventListener("input", render);
    search.addEventListener("keydown", event => {
        if (event.key === "Enter" && search.value.trim()) {
            const first = grid.querySelector("[data-url]");
            onOpen(first ? first.dataset.url : search.value.trim());
        }
    });
    render();
    return { focus: () => search.focus() };
};
