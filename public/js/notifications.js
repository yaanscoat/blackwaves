// Notification centre behind the bell in the top bar. Add new entries to the
// top of the list with a unique id; anything the visitor hasn't opened the
// panel since shows up as unread.
import * as storage from "./storage.js";
import { escapeHtml } from "./util.js";

// type: feature | update | announcement | fix
export const notifications = [
    {
        id: "2026-10-18-topbar",
        type: "feature",
        title: "A bigger top bar",
        body: "The dock is now a full top bar. Press the menu button on the right to fold every icon into three lines, and press it again to bring them back.",
        date: "2026-10-18"
    },
    {
        id: "2026-10-18-confetti",
        type: "feature",
        title: "Click the logo",
        body: "There's a surprise behind the logo on the home page.",
        date: "2026-10-18"
    },
    {
        id: "2026-10-18-look",
        type: "update",
        title: "Fresh coat of paint",
        body: "Flatter surfaces, Lexend everywhere and snappier animations. Liquid glass is still in Appearance if you miss it.",
        date: "2026-10-18"
    },
    {
        id: "2026-10-18-v2",
        type: "announcement",
        title: "blackwaves 2.0",
        body: "Games, apps, movies, a tabbed browser, 52 themes, cloaking and CloudSync.",
        date: "2026-10-18"
    }
];

const typeLabels = { feature: "new feature", update: "update", announcement: "announcement", fix: "bug fix" };

const formatDate = (iso) => {
    const date = new Date(`${iso}T00:00:00`);
    return Number.isNaN(date.getTime()) ? iso : date.toLocaleDateString("en", { month: "short", day: "numeric", year: "numeric" });
};

export const createNotifications = ({ button, badge, panel, motion, onUnread }) => {
    let seen = new Set(storage.read("notificationsSeen", []));
    // Ids that were unread when the panel opened; they stay highlighted
    // until it closes.
    let fresh = new Set();
    let closing = 0;

    const unread = () => notifications.filter(item => !seen.has(item.id)).length;

    const syncBadge = () => {
        const count = unread();
        badge.textContent = count > 9 ? "9+" : String(count);
        badge.hidden = count === 0;
        button.setAttribute("aria-label", count ? `Notifications, ${count} unread` : "Notifications");
        onUnread?.(count);
    };

    const render = () => {
        const count = fresh.size;
        panel.innerHTML = `
          <header class="notify__head">
            <span class="notify__heading">Notifications</span>
            <span class="notify__count">${count ? `${count} new` : "all caught up"}</span>
          </header>
          ${notifications.length
            ? `<ul class="notify__list">${notifications.map((item, i) => `
              <li class="notify__item${fresh.has(item.id) ? " is-unread" : ""}" style="--i:${i}">
                <span class="notify__dot" data-type="${escapeHtml(item.type)}" aria-hidden="true"></span>
                <div class="notify__text">
                  <p class="notify__name">${escapeHtml(item.title)}</p>
                  <p class="notify__body">${escapeHtml(item.body)}</p>
                  <p class="notify__meta">${escapeHtml(typeLabels[item.type] ?? item.type)} · ${escapeHtml(formatDate(item.date))}</p>
                </div>
              </li>`).join("")}</ul>`
            : `<p class="notify__empty">Nothing here yet.</p>`}`;
    };

    const isOpen = () => !panel.hidden && !panel.classList.contains("is-closing");

    const open = () => {
        clearTimeout(closing);
        panel.classList.remove("is-closing");
        fresh = new Set(notifications.filter(item => !seen.has(item.id)).map(item => item.id));
        render();
        panel.hidden = false;
        button.setAttribute("aria-expanded", "true");
        // Opening the panel counts as reading everything in it.
        seen = new Set(notifications.map(item => item.id));
        storage.write("notificationsSeen", [...seen]);
        syncBadge();
    };

    const close = () => {
        if (!isOpen())
            return;
        button.setAttribute("aria-expanded", "false");
        if (motion() === 0) {
            panel.hidden = true;
            return;
        }
        panel.classList.add("is-closing");
        closing = setTimeout(() => {
            panel.hidden = true;
            panel.classList.remove("is-closing");
        }, 180);
    };

    button.addEventListener("click", event => {
        event.stopPropagation();
        if (isOpen())
            close();
        else
            open();
    });
    document.addEventListener("pointerdown", event => {
        if (isOpen() && !panel.contains(event.target) && !button.contains(event.target))
            close();
    });
    addEventListener("keydown", event => {
        if (event.key === "Escape" && isOpen()) {
            close();
            button.focus();
        }
    });

    syncBadge();
    // A little ring on load when something new is waiting.
    if (unread() && motion() > 0)
        setTimeout(() => {
            button.classList.add("is-ringing");
            button.addEventListener("animationend", () => button.classList.remove("is-ringing"), { once: true });
        }, 1400);

    return { open, close, isOpen, unread };
};
