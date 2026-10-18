// [id, name, background, text, accent, second accent, dust, light?]
// The three hidden light sources take accent, second accent and dust.
const table = [
    ["blackwaves", "Blackwaves", "#050505", "#ebebeb", "#e6e6e6", "#9a9a9a", "#ffffff"],
    ["abyss", "Abyss", "#01030a", "#dce6ff", "#4f8cff", "#2fe0c8", "#bcd6ff"],
    ["midnight", "Midnight", "#05060f", "#e1e3f5", "#7b86ff", "#4cc3ff", "#d6dcff"],
    ["obsidian", "Obsidian", "#07070a", "#e6e4ec", "#a58cff", "#ff8ad8", "#efe7ff"],
    ["onyx", "Onyx", "#0a0a0a", "#f0f0f0", "#d6d6d6", "#8f8f8f", "#ffffff"],
    ["graphite", "Graphite", "#121314", "#e8e9ea", "#9fb4c7", "#c7b29f", "#f4f4f4"],
    ["carbon", "Carbon", "#0d0f10", "#dfe5e8", "#5ce1e6", "#8a9ba8", "#e7fbff"],
    ["eclipse", "Eclipse", "#050304", "#f2e6df", "#ffb25c", "#ff5c5c", "#ffe2bf"],
    ["nebula", "Nebula", "#07030f", "#eadfff", "#b26bff", "#ff6bd5", "#e8d4ff"],
    ["aurora", "Aurora", "#020a0a", "#dcfff5", "#3dffb0", "#6b8cff", "#c9ffe9"],
    ["ocean", "Ocean", "#020812", "#d9ecff", "#2fa8ff", "#00e0d1", "#c4e6ff"],
    ["deepsea", "Deep Sea", "#00040a", "#cfe3f2", "#2b6cff", "#14b8a6", "#a9d4ff"],
    ["lagoon", "Lagoon", "#021012", "#d8fbfb", "#2ee6e6", "#7cf0a8", "#d2ffff"],
    ["glacier", "Glacier", "#060b10", "#e8f6ff", "#9fe3ff", "#e0f4ff", "#ffffff"],
    ["frost", "Frost", "#0a0f17", "#eaf2ff", "#b8d4ff", "#d8c8ff", "#ffffff"],
    ["ember", "Ember", "#0c0503", "#ffe9dc", "#ff7a2f", "#ffc23d", "#ffd2a8"],
    ["inferno", "Inferno", "#0d0202", "#ffe2dc", "#ff3d2e", "#ff9a3d", "#ffc4a8"],
    ["magma", "Magma", "#100403", "#ffe6d6", "#ff5a1f", "#d4145a", "#ffb08a"],
    ["sunset", "Sunset", "#0f0508", "#ffe6e8", "#ff7a59", "#ff4f9a", "#ffd0b8"],
    ["dusk", "Dusk", "#0a0610", "#efe2f5", "#e48bff", "#ff9f6b", "#f6d9ff"],
    ["rose", "Rose", "#0f0609", "#ffe3ea", "#ff6b8f", "#ffb3c6", "#ffd6e0"],
    ["sakura", "Sakura", "#100a0d", "#ffeef3", "#ffa3c4", "#ffd1e0", "#fff0f5"],
    ["bubblegum", "Bubblegum", "#10060f", "#ffe8fb", "#ff5fd2", "#7ce0ff", "#ffd1f4"],
    ["lavender", "Lavender", "#0b0910", "#f0eaff", "#b9a3ff", "#e3d6ff", "#f3eeff"],
    ["amethyst", "Amethyst", "#09040f", "#efe1ff", "#9b5cff", "#d65cff", "#e2c9ff"],
    ["grape", "Grape", "#0c0412", "#f3e2ff", "#c13dff", "#6b3dff", "#e8c2ff"],
    ["forest", "Forest", "#030a05", "#e0f5e4", "#4ccf6a", "#c3e05c", "#d8f7cf"],
    ["moss", "Moss", "#080b05", "#e9efdc", "#9fbf4c", "#d6c45c", "#eff5d0"],
    ["matrix", "Matrix", "#000500", "#c8ffc8", "#00ff66", "#00b347", "#a8ffbf"],
    ["terminal", "Terminal", "#070500", "#ffe9bf", "#ffb000", "#ff7a00", "#ffd98a"],
    ["toxic", "Toxic", "#050800", "#efffd6", "#b6ff00", "#00ffa2", "#e3ffb0"],
    ["gold", "Gold", "#0a0802", "#fff4d6", "#ffcf4d", "#ffa23d", "#fff0c2"],
    ["sand", "Sand", "#0e0c08", "#f6eedf", "#e6c48f", "#c99a6b", "#fff4e0"],
    ["coffee", "Coffee", "#0d0806", "#f2e4da", "#c78b5c", "#e6b98a", "#f5dcc8"],
    ["mocha", "Mocha", "#120d0b", "#efe2dc", "#d1a58c", "#a37a6b", "#f6e4dc"],
    ["crimson", "Crimson", "#0a0204", "#ffe0e6", "#ff2e5b", "#ff7a8c", "#ffc2cf"],
    ["bloodmoon", "Blood Moon", "#080000", "#f7d9d9", "#d40000", "#ff6a00", "#ffb3a3"],
    ["cyberpunk", "Cyberpunk", "#06050a", "#fffbe0", "#fcee0a", "#00f0ff", "#fff8b3"],
    ["synthwave", "Synthwave", "#0d0221", "#ffe6ff", "#ff2fd6", "#7a5cff", "#ffc2f6"],
    ["vaporwave", "Vaporwave", "#0b0616", "#f2e9ff", "#ff71ce", "#01cdfe", "#b9fbff"],
    ["nord", "Nord", "#1b1f27", "#e5e9f0", "#88c0d0", "#b48ead", "#eceff4"],
    ["dracula", "Dracula", "#16171f", "#f8f8f2", "#bd93f9", "#ff79c6", "#f1e6ff"],
    ["gruvbox", "Gruvbox", "#1a1817", "#ebdbb2", "#fabd2f", "#fe8019", "#fbf1c7"],
    ["monokai", "Monokai", "#191a16", "#f8f8f2", "#a6e22e", "#f92672", "#fdfde0"],
    ["solarized", "Solarized", "#001b22", "#e2e5d8", "#268bd2", "#2aa198", "#fdf6e3"],
    ["tokyonight", "Tokyo Night", "#0f1018", "#c0caf5", "#7aa2f7", "#bb9af7", "#dfe5ff"],
    ["catppuccin", "Catppuccin", "#14141f", "#cdd6f4", "#cba6f7", "#89dceb", "#f5e0dc"],
    ["onedark", "One Dark", "#16191e", "#dcdfe4", "#61afef", "#c678dd", "#eef3ff"],
    ["paper", "Paper", "#f4f1ea", "#1d1b17", "#3a5bd9", "#d94f3a", "#4a4234", true],
    ["snowfield", "Snowfield", "#eef3f8", "#141a22", "#2f7de1", "#7a5cff", "#3b4a5c", true],
    ["latte", "Latte", "#f2ebe3", "#2b2119", "#b0603a", "#7a8f3a", "#5c4632", true],
    ["cream", "Cream", "#faf5e8", "#272215", "#c28a00", "#d1495b", "#5e5333", true]
];

export const themes = table.map(([id, name, bg, fg, accent, accent2, dust, light = false]) => ({ id, name, bg, fg, accent, accent2, dust, light }));

export const themeIds = themes.map(theme => theme.id);

export const findTheme = (id) => themes.find(theme => theme.id === id) ?? themes[0];

export const hexToRgb = (hex) => {
    const n = parseInt(hex.slice(1), 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};

export const applyTheme = (id) => {
    const theme = findTheme(id);
    const root = document.documentElement;
    const set = (name, value) => root.style.setProperty(name, value);
    set("--bg", theme.bg);
    set("--fg", theme.fg);
    set("--accent", theme.accent);
    set("--accent-2", theme.accent2);
    set("--accent-rgb", hexToRgb(theme.accent).join(" "));
    set("--fg-rgb", hexToRgb(theme.fg).join(" "));
    set("--bg-rgb", hexToRgb(theme.bg).join(" "));
    root.dataset.scheme = theme.light ? "light" : "dark";
    root.style.colorScheme = theme.light ? "light" : "dark";
    document.querySelector('meta[name="theme-color"]')?.setAttribute("content", theme.bg);
    return theme;
};
