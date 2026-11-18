/* blackwaves settings store. Everything persists in localStorage under one key. */
(function () {
  const KEY = 'bw:settings';
  const HISTORY_KEY = 'bw:history';

  const DEFAULTS = {
    // Preferences
    userName: '',
    tutorialDone: false,
    searchEngine: 'duckduckgo',
    customSearch: '',
    gameSource: 'all',
    preventClose: false,
    navbar: true,
    tabsCollapsed: false,
    aiModel: '',
    // Appearance
    theme: 'midnight',
    motion: 'full',
    seasonal: 'auto',
    customCursor: true,
    // Cloaking
    cloakPreset: 'none',
    cloakTitle: '',
    cloakIcon: '',
    cloakMode: 'always',
    launchMode: 'none',
    autoLaunch: false,
    redirectUrl: 'https://classroom.google.com',
    panicKey: '',
    panicUrl: 'https://classroom.google.com',
    // Advanced
    protocol: 'scramjet',
    transport: 'epoxy',
    wispUrl: '',
    preloadSearch: true,
    saveHistory: true,
    // Extensions (ids of enabled built-ins)
    builtinExtensions: ['adshield'],
    // installed extensions shown as icons in the navbar
    pinnedExtensions: [],
  };

  const SEARCH_ENGINES = {
    duckduckgo: { name: 'DuckDuckGo', url: 'https://duckduckgo.com/?q=%s', home: 'https://duckduckgo.com/' },
    google: { name: 'Google', url: 'https://www.google.com/search?q=%s', home: 'https://www.google.com/' },
    bing: { name: 'Bing', url: 'https://www.bing.com/search?q=%s', home: 'https://www.bing.com/' },
    brave: { name: 'Brave Search', url: 'https://search.brave.com/search?q=%s', home: 'https://search.brave.com/' },
    startpage: { name: 'Startpage', url: 'https://www.startpage.com/do/search?q=%s', home: 'https://www.startpage.com/' },
    yahoo: { name: 'Yahoo', url: 'https://search.yahoo.com/search?p=%s', home: 'https://search.yahoo.com/' },
    ecosia: { name: 'Ecosia', url: 'https://www.ecosia.org/search?q=%s', home: 'https://www.ecosia.org/' },
    qwant: { name: 'Qwant', url: 'https://www.qwant.com/?q=%s', home: 'https://www.qwant.com/' },
    custom: { name: 'Custom', url: '', home: '' },
  };

  const PROTOCOLS = {
    scramjet: { name: 'Scramjet (latest)', short: 'SJ' },
    'scramjet-legacy': { name: 'Scramjet 1.1.0', short: 'SJ 1.1' },
    uv: { name: 'Ultraviolet', short: 'UV' },
  };

  function read() {
    try {
      const raw = localStorage.getItem(KEY);
      return raw ? JSON.parse(raw) : {};
    } catch {
      return {};
    }
  }

  let state = Object.assign({}, DEFAULTS, read());
  const listeners = new Map();

  function persist() {
    try {
      localStorage.setItem(KEY, JSON.stringify(state));
    } catch {}
  }

  const settings = {
    DEFAULTS,
    get(key) {
      return state[key];
    },
    all() {
      return Object.assign({}, state);
    },
    set(key, value) {
      const old = state[key];
      state[key] = value;
      persist();
      if (old !== value) {
        (listeners.get(key) || []).forEach((fn) => fn(value, old));
        (listeners.get('*') || []).forEach((fn) => fn(key, value, old));
      }
    },
    on(key, fn) {
      if (!listeners.has(key)) listeners.set(key, []);
      listeners.get(key).push(fn);
    },
    reset() {
      try {
        localStorage.removeItem(KEY);
        localStorage.removeItem(HISTORY_KEY);
      } catch {}
      state = Object.assign({}, DEFAULTS);
    },
  };

  // Another tab (e.g. an about:blank launch) changed settings
  window.addEventListener('storage', (e) => {
    if (e.key !== KEY) return;
    const next = Object.assign({}, DEFAULTS, read());
    for (const k of Object.keys(next)) {
      if (next[k] !== state[k] && typeof next[k] !== 'object') settings.set(k, next[k]);
    }
  });

  const history = {
    list() {
      try {
        return JSON.parse(localStorage.getItem(HISTORY_KEY)) || [];
      } catch {
        return [];
      }
    },
    add(url, title) {
      if (!settings.get('saveHistory') || !url || url === 'about:blank') return;
      const list = history.list();
      if (list[0] && list[0].url === url) {
        if (!title || list[0].title === title) return;
        list[0].title = title;
      } else {
        list.unshift({ url, title: title || url, time: Date.now() });
      }
      history.replace(list);
    },
    replace(list, silent) {
      try {
        localStorage.setItem(HISTORY_KEY, JSON.stringify((list || []).slice(0, 300)));
      } catch {}
      if (!silent) emit('history');
    },
    clear() {
      try {
        localStorage.removeItem(HISTORY_KEY);
      } catch {}
      emit('history');
    },
  };

  // Tiny change bus so cloud sync can notice anything worth pushing.
  const changeListeners = new Set();
  function emit(what) {
    changeListeners.forEach((fn) => {
      try {
        fn(what);
      } catch {}
    });
  }
  settings.on('*', (key) => emit(`settings:${key}`));

  function searchUrl(query) {
    query = query.trim();
    try {
      const url = new URL(query);
      if (/^(https?|ftp):$/.test(url.protocol)) return url.href;
    } catch {}
    if (!/\s/.test(query)) {
      try {
        const url = new URL(`https://${query}`);
        if (url.hostname.includes('.') && !url.hostname.endsWith('.')) return url.href;
      } catch {}
    }
    const id = settings.get('searchEngine');
    let template = SEARCH_ENGINES[id] ? SEARCH_ENGINES[id].url : SEARCH_ENGINES.duckduckgo.url;
    if (id === 'custom') template = settings.get('customSearch') || SEARCH_ENGINES.duckduckgo.url;
    if (!template.includes('%s')) template += '%s';
    return template.replace('%s', encodeURIComponent(query));
  }

  function defaultWisp() {
    return `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/w/`;
  }

  window.BW = window.BW || {};
  Object.assign(window.BW, {
    settings,
    history,
    emitChange: emit,
    onChange: (fn) => changeListeners.add(fn),
    DISCORD_URL: 'https://discord.gg/rH2bMPPNq',
    searchUrl,
    defaultWisp,
    wispUrl: () => settings.get('wispUrl') || defaultWisp(),
    SEARCH_ENGINES,
    PROTOCOLS,
  });
})();
