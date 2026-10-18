export const escapeHtml = (value) => String(value).replace(/[&<>"']/g, c => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
})[c]);

export const debounce = (fn, ms) => {
    let timer = 0;
    const wrapped = (...args) => {
        clearTimeout(timer);
        timer = setTimeout(() => fn(...args), ms);
    };
    wrapped.flush = (...args) => {
        clearTimeout(timer);
        fn(...args);
    };
    return wrapped;
};

export const timeAgo = (ms) => {
    const s = Math.round((Date.now() - ms) / 1000);
    if (s < 45)
        return "just now";
    const m = Math.round(s / 60);
    if (m < 60)
        return `${m}m ago`;
    const h = Math.round(m / 60);
    if (h < 24)
        return `${h}h ago`;
    return `${Math.round(h / 24)}d ago`;
};
