import * as history from "./history.js";
import * as settings from "./settings.js";
import { escapeHtml } from "./util.js";
import { icons } from "./icons.js";

const greetings = ["hiya!", "howdy.", "welcome black."];

const pick = (previous) => {
    const options = greetings.filter(text => text !== previous);
    return options[Math.floor(Math.random() * options.length)];
};

// Types a random greeting into the placeholder, holds it, erases it, and
// picks another. With motion at Minimal it just swaps them.
const typewriter = (input) => {
    let text = "";
    let timer = 0;
    const wait = (ms, fn) => {
        clearTimeout(timer);
        timer = setTimeout(fn, ms);
    };
    const cycle = () => {
        text = pick(text);
        if (settings.get("motion") === 0) {
            input.placeholder = text;
            wait(4500, cycle);
            return;
        }
        let i = 0;
        const type = () => {
            input.placeholder = text.slice(0, ++i);
            if (i < text.length)
                wait(65 + Math.random() * 70, type);
            else
                wait(2600, erase);
        };
        const erase = () => {
            input.placeholder = text.slice(0, --i);
            if (i > 0)
                wait(32, erase);
            else
                wait(420, cycle);
        };
        type();
    };
    cycle();
};

export const createHome = ({ onSearch }) => {
    const form = document.querySelector("#home-search");
    const input = document.querySelector("#home-input");
    const list = document.querySelector("#home-suggest");
    let items = [];
    let selected = -1;

    typewriter(input);

    const close = () => {
        list.hidden = true;
        input.setAttribute("aria-expanded", "false");
        input.removeAttribute("aria-activedescendant");
        selected = -1;
    };

    const render = () => {
        const q = input.value.trim().toLowerCase();
        items = history.searches()
            .map(item => item.q)
            .filter(text => !q || (text.toLowerCase().includes(q) && text.toLowerCase() !== q))
            .slice(0, 6);
        if (!items.length || document.activeElement !== input) {
            close();
            return;
        }
        list.innerHTML = items.map((text, i) => `<li role="option" id="home-opt-${i}" data-i="${i}" aria-selected="${i === selected}">${icons.history}<span>${escapeHtml(text)}</span></li>`).join("");
        list.hidden = false;
        input.setAttribute("aria-expanded", "true");
        if (selected >= 0)
            input.setAttribute("aria-activedescendant", `home-opt-${selected}`);
    };

    const submit = (value) => {
        const text = value.trim();
        if (!text)
            return;
        close();
        input.value = "";
        input.blur();
        onSearch(text);
    };

    form.addEventListener("submit", event => {
        event.preventDefault();
        submit(selected >= 0 ? items[selected] : input.value);
    });
    input.addEventListener("input", () => {
        selected = -1;
        render();
    });
    input.addEventListener("focus", render);
    input.addEventListener("blur", () => setTimeout(close, 120));
    input.addEventListener("keydown", event => {
        if (list.hidden)
            return;
        if (event.key === "ArrowDown" || event.key === "ArrowUp") {
            event.preventDefault();
            const step = event.key === "ArrowDown" ? 1 : -1;
            // Cycle through -1 (what you typed) and each suggestion.
            const n = items.length + 1;
            selected = (((selected + 1 + step) % n) + n) % n - 1;
            render();
        }
        else if (event.key === "Escape")
            close();
    });
    list.addEventListener("pointerdown", event => {
        const option = event.target.closest("[data-i]");
        if (option) {
            event.preventDefault();
            submit(items[Number(option.dataset.i)]);
        }
    });

    return { focus: () => input.focus() };
};
