/*
 * Vertical tabs. Every tab owns its own proxied <iframe>; only the active one is shown.
 * Also drives the toolbar (back / forward / reload / address bar) for the active tab,
 * the "New tab" search prompt, and saving/restoring the tab session.
 */
(function () {
  const S = BW.settings;
  const $ = (id) => document.getElementById(id);
  const list = $('tab-list');
  const framesEl = $('frames');
  const urlInput = $('url-input');
  const lockIcon = $('lock-icon');
  const overlay = $('newtab-overlay');
  const newtabInput = $('newtab-input');
  const SESSION_KEY = 'bw:tabs';
  const GLOBE = 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="#8a8a96" stroke-width="1.8"><circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c2.5 2.7 2.5 15.3 0 18M12 3c-2.5 2.7-2.5 15.3 0 18"/></svg>');

  let tabs = [];
  let activeId = null;
  let nextId = 1;

  const byId = (id) => tabs.find((t) => t.id === id);
  const active = () => byId(activeId);

  /* ---------------- Tab lifecycle ---------------- */
  function createFrame(tab) {
    const iframe = document.createElement('iframe');
    iframe.className = 'bw-frame';
    iframe.title = 'blackwaves tab';
    iframe.dataset.tabId = tab.id;
    iframe.setAttribute('allow', 'fullscreen; autoplay; clipboard-read; clipboard-write; encrypted-media; picture-in-picture; gamepad');
    iframe.setAttribute('allowfullscreen', '');
    framesEl.appendChild(iframe);
    tab.iframe = iframe;
    BW.loader.watchFrame(iframe);
    BW.extensions.attachFrame(iframe, tab.id);
    iframe.addEventListener('load', () => {
      sync(tab);
      try {
        const doc = iframe.contentDocument;
        doc.addEventListener('keydown', (e) => {
          BW.cloak.handleKey(e);
          shortcut(e);
        }, true);
      } catch {}
    });
  }

  /**
   * Open a tab. `target` is a URL (already resolved) or a game object.
   * lazy: create the tab but don't load it until it's activated (session restore).
   */
  function open(target, { activate = true, lazy = false, title } = {}) {
    const tab = { id: nextId++, url: '', title: title || 'New tab', favicon: '', pending: null, iframe: null };
    tabs.push(tab);
    createFrame(tab);
    const isGame = target && typeof target === 'object';
    tab.url = isGame ? (target.proxied ? target.url : new URL(target.url, location.origin).href) : target || '';
    if (isGame) tab.title = target.name;
    tab.pending = target;
    if (!lazy) load(tab);
    if (activate || !activeId) activateTab(tab.id);
    else render();
    saveSession();
    BW.app.showBrowser();
    return tab;
  }

  function load(tab) {
    const target = tab.pending;
    tab.pending = null;
    if (!target) return;
    if (typeof target === 'object') {
      BW.loader.loadGame(tab.iframe, target).catch(() => {});
    } else {
      let host = target;
      try {
        host = new URL(target).hostname.replace(/^www\./, '');
      } catch {}
      BW.loader.loadPage(tab.iframe, target, { label: `Opening ${host}...` }).catch(() => {});
    }
    render();
  }

  function activateTab(id) {
    const tab = byId(id);
    if (!tab) return;
    activeId = id;
    for (const t of tabs) t.iframe.classList.toggle('active', t.id === id);
    if (tab.pending) load(tab);
    BW.loader.setActive(tab.iframe);
    $('ext-popover').hidden = true;
    updateChrome();
    render();
    saveSession();
  }

  function close(id) {
    const tab = byId(id);
    if (!tab) return;
    const index = tabs.indexOf(tab);
    tab.iframe.src = 'about:blank';
    tab.iframe.remove();
    BW.loader.hide(tab.iframe);
    tabs.splice(index, 1);
    if (!tabs.length) {
      activeId = null;
      BW.loader.setActive(null);
      saveSession();
      render();
      BW.app.showHome();
      return;
    }
    if (activeId === id) activateTab(tabs[Math.min(index, tabs.length - 1)].id);
    else render();
    saveSession();
  }

  function navigate(id, input) {
    const tab = byId(id);
    if (!tab || !input || !input.trim()) return;
    tab.pending = BW.searchUrl(input);
    tab.url = tab.pending;
    load(tab);
    if (tab.id === activeId) updateChrome();
  }

  /* ---------------- Reading tab state from the proxied page ---------------- */
  function sync(tab) {
    let win, doc;
    try {
      win = tab.iframe.contentWindow;
      doc = tab.iframe.contentDocument;
      if (!win || win.location.href === 'about:blank') return;
    } catch {
      return;
    }
    const url = BW.proxy.decode(win.location.href);
    const title = (doc && doc.title) || url;
    let changed = false;
    if (url !== tab.url) {
      tab.url = url;
      tab.favicon = '';
      changed = true;
      BW.history.add(url, title);
    }
    if (title !== tab.title) {
      tab.title = title;
      changed = true;
      BW.history.add(url, title);
    }
    if (!tab.favicon) {
      const link = doc && doc.querySelector('link[rel~="icon"], link[rel="shortcut icon"], link[rel="apple-touch-icon"]');
      if (link && link.href) tab.favicon = link.href;
      else {
        try {
          // fetch the site's /favicon.ico through the same engine; local pages (games) keep the globe
          if (/^https?:/.test(url) && !url.startsWith(location.origin)) tab.favicon = BW.proxy.encode(`${new URL(url).origin}/favicon.ico`, tab.iframe);
        } catch {}
      }
      if (tab.favicon) changed = true;
    }
    if (changed) {
      if (tab.id === activeId) updateChrome();
      render();
      saveSession();
    }
  }
  setInterval(() => tabs.forEach(sync), 800);

  /* ---------------- Rendering ---------------- */
  let renderQueued = false;
  function render() {
    if (renderQueued) return;
    renderQueued = true;
    requestAnimationFrame(() => {
      renderQueued = false;
      list.innerHTML = tabs
        .map((t) => {
          const loading = BW.loader.isLoading(t.iframe);
          const icon = loading ? '<span class="tab-spinner"></span>' : `<img src="${BW.esc(t.favicon || GLOBE)}" alt="" onerror="this.src='${GLOBE}'">`;
          return `<div class="tab-item${t.id === activeId ? ' active' : ''}" role="tab" aria-selected="${t.id === activeId}" draggable="true" data-id="${t.id}" title="${BW.esc(t.title)}\n${BW.esc(t.url)}">
            <span class="tab-icon">${icon}</span>
            <span class="tab-title">${BW.esc(t.title || 'New tab')}</span>
            <button class="tab-close" data-close="${t.id}" aria-label="Close tab"><i class="fa-solid fa-xmark"></i></button>
          </div>`;
        })
        .join('');
      updateResume();
    });
  }

  function setLock(url) {
    const secure = /^https:/.test(url) || url.startsWith(location.origin);
    lockIcon.className = `fa-solid ${secure ? 'fa-lock' : 'fa-lock-open'}`;
    lockIcon.classList.toggle('insecure', !secure);
  }

  function updateChrome() {
    const tab = active();
    if (!tab) return;
    if (document.activeElement !== urlInput) urlInput.value = tab.url;
    setLock(tab.url);
    BW.cloak.setLiveTitle(tab.title && tab.title !== tab.url ? tab.title : '');
  }

  function updateResume() {
    const btn = $('resume-tabs');
    const saved = tabs.length ? null : readSession();
    if (tabs.length) {
      btn.hidden = false;
      btn.dataset.mode = 'resume';
      btn.querySelector('span').textContent = `Back to ${tabs.length} open tab${tabs.length === 1 ? '' : 's'}`;
    } else if (saved && saved.tabs.length) {
      btn.hidden = false;
      btn.dataset.mode = 'restore';
      btn.querySelector('span').textContent = `Restore ${saved.tabs.length} tab${saved.tabs.length === 1 ? '' : 's'} from last time`;
    } else {
      btn.hidden = true;
    }
  }

  /* ---------------- Session (saved locally + cloud sync) ---------------- */
  function readSession() {
    try {
      const s = JSON.parse(localStorage.getItem(SESSION_KEY));
      return s && Array.isArray(s.tabs) ? s : null;
    } catch {
      return null;
    }
  }

  let saveTimer = null;
  let restored = false;
  function saveSession() {
    // Don't overwrite the previous session until the user has opened or restored tabs.
    if (!tabs.length && !restored) return;
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      const session = {
        tabs: tabs.map((t) => ({ url: t.url, title: t.title })).filter((t) => /^https?:/.test(t.url)),
        active: Math.max(0, tabs.findIndex((t) => t.id === activeId)),
      };
      try {
        localStorage.setItem(SESSION_KEY, JSON.stringify(session));
      } catch {}
      BW.emitChange('tabs');
    }, 400);
  }

  function restore() {
    const session = readSession();
    if (!session || !session.tabs.length) return;
    restored = true;
    const created = session.tabs.map((t) => open(t.url, { activate: false, lazy: true, title: t.title }));
    activateTab((created[session.active] || created[0]).id);
  }

  /* ---------------- New tab prompt ---------------- */
  function promptNewTab() {
    BW.app.showBrowser(true);
    overlay.hidden = false;
    newtabInput.value = '';
    requestAnimationFrame(() => {
      overlay.classList.add('visible');
      newtabInput.focus();
    });
  }
  function closePrompt() {
    overlay.classList.remove('visible');
    overlay.hidden = true;
    if (!tabs.length) BW.app.showHome();
  }
  $('newtab-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const value = newtabInput.value.trim();
    if (!value) return;
    overlay.classList.remove('visible');
    overlay.hidden = true;
    open(BW.searchUrl(value));
  });
  overlay.addEventListener('mousedown', (e) => {
    if (e.target === overlay) closePrompt();
  });
  newtabInput.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closePrompt();
  });

  /* ---------------- Tab list interactions ---------------- */
  list.addEventListener('click', (e) => {
    const closeBtn = e.target.closest('[data-close]');
    if (closeBtn) {
      e.stopPropagation();
      return close(+closeBtn.dataset.close);
    }
    const item = e.target.closest('.tab-item');
    if (item) activateTab(+item.dataset.id);
  });
  list.addEventListener('auxclick', (e) => {
    const item = e.target.closest('.tab-item');
    if (item && e.button === 1) {
      e.preventDefault();
      close(+item.dataset.id);
    }
  });

  // drag to reorder
  let dragId = null;
  list.addEventListener('dragstart', (e) => {
    const item = e.target.closest('.tab-item');
    if (!item) return;
    dragId = +item.dataset.id;
    item.classList.add('dragging');
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', String(dragId));
  });
  list.addEventListener('dragover', (e) => {
    if (dragId == null) return;
    e.preventDefault();
    const over = e.target.closest('.tab-item');
    list.querySelectorAll('.drop-before,.drop-after').forEach((el) => el.classList.remove('drop-before', 'drop-after'));
    if (over && +over.dataset.id !== dragId) {
      const r = over.getBoundingClientRect();
      over.classList.add(e.clientY < r.top + r.height / 2 ? 'drop-before' : 'drop-after');
    }
  });
  list.addEventListener('drop', (e) => {
    e.preventDefault();
    const over = e.target.closest('.tab-item');
    if (over && dragId != null && +over.dataset.id !== dragId) {
      const moving = byId(dragId);
      const before = over.classList.contains('drop-before');
      tabs.splice(tabs.indexOf(moving), 1);
      const target = tabs.indexOf(byId(+over.dataset.id));
      tabs.splice(before ? target : target + 1, 0, moving);
      saveSession();
    }
    dragId = null;
    render();
  });
  list.addEventListener('dragend', () => {
    dragId = null;
    render();
  });

  $('new-tab').addEventListener('click', promptNewTab);
  $('rail-home').addEventListener('click', () => BW.app.showHome());
  $('rail-games').addEventListener('click', () => {
    BW.app.showHome();
    BW.games.open();
  });
  $('rail-settings').addEventListener('click', () => BW.settingsUI.open());
  $('rail-ai').addEventListener('click', () => {
    BW.app.showHome();
    BW.ai.open();
  });
  const rail = $('tab-rail');
  const applyCollapsed = () => {
    rail.classList.toggle('collapsed', !!S.get('tabsCollapsed'));
    $('rail-collapse').querySelector('i').className = `fa-solid ${S.get('tabsCollapsed') ? 'fa-angles-right' : 'fa-angles-left'}`;
  };
  $('rail-collapse').addEventListener('click', () => S.set('tabsCollapsed', !S.get('tabsCollapsed')));
  S.on('tabsCollapsed', applyCollapsed);
  applyCollapsed();

  /* ---------------- Toolbar for the active tab ---------------- */
  const withActive = (fn) => () => {
    const tab = active();
    if (!tab) return;
    try {
      fn(tab);
    } catch {}
  };
  $('nav-back').addEventListener('click', withActive((t) => t.iframe.contentWindow.history.back()));
  $('nav-forward').addEventListener('click', withActive((t) => t.iframe.contentWindow.history.forward()));
  $('nav-reload').addEventListener('click', (e) => {
    const icon = e.currentTarget.querySelector('i');
    icon.classList.add('spin');
    setTimeout(() => icon.classList.remove('spin'), 500);
    withActive((t) => {
      try {
        t.iframe.contentWindow.location.reload();
      } catch {
        navigate(t.id, t.url);
      }
    })();
  });
  $('nav-fullscreen').addEventListener('click', withActive((t) => (t.iframe.requestFullscreen || t.iframe.webkitRequestFullscreen).call(t.iframe)));
  $('nav-extensions').addEventListener('click', (e) => {
    e.stopPropagation();
    BW.extensions.togglePopover();
  });
  urlInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && activeId) {
      navigate(activeId, urlInput.value);
      urlInput.blur();
    } else if (e.key === 'Escape') {
      updateChrome();
      urlInput.blur();
    }
  });
  urlInput.addEventListener('focus', () => urlInput.select());

  /* ---------------- Keyboard shortcuts ---------------- */
  function shortcut(e) {
    if (!e.altKey || e.ctrlKey || e.metaKey || $('browser').hidden) return;
    const k = e.key.toLowerCase();
    if (k === 't') promptNewTab();
    else if (k === 'w' && activeId) close(activeId);
    else if (/^[1-9]$/.test(k) && tabs[+k - 1]) activateTab(tabs[+k - 1].id);
    else if (k === 'arrowdown' || k === 'arrowup') {
      const i = tabs.indexOf(active());
      const next = tabs[(i + (k === 'arrowdown' ? 1 : -1) + tabs.length) % tabs.length];
      if (next) activateTab(next.id);
    } else return;
    e.preventDefault();
  }
  document.addEventListener('keydown', shortcut, true);

  // A download started: tabs still waiting on their first page were download links. Stop their
  // loader now; blank ones close once the file is saved (closing earlier would cancel it).
  function downloadStarted(info) {
    for (const tab of tabs) {
      if (!BW.loader.isLoading(tab.iframe)) continue;
      let blank = false;
      try {
        blank = tab.iframe.contentWindow.location.href === 'about:blank';
      } catch {}
      BW.loader.hide(tab.iframe);
      if (blank) {
        tab.downloadId = info.id;
        tab.title = `Downloading ${info.filename}`;
      }
    }
    render();
  }

  function downloadFinished(id) {
    for (const tab of [...tabs]) {
      if (tab.downloadId !== id) continue;
      let blank = false;
      try {
        blank = tab.iframe.contentWindow.location.href === 'about:blank';
      } catch {}
      if (blank) setTimeout(() => close(tab.id), 1000);
      else tab.downloadId = null;
    }
  }

  BW.tabs = {
    downloadStarted,
    downloadFinished,
    open,
    openGame: (game) => open(game),
    close,
    navigate,
    activate: activateTab,
    promptNewTab,
    restore,
    refresh: render,
    count: () => tabs.length,
    hasSession: () => !!(readSession() || {}).tabs?.length,
    activeFrame: () => (active() ? active().iframe : null),
    list: () => tabs.map((t) => ({ id: t.id, iframe: t.iframe, url: t.url, title: t.title, favicon: t.favicon, active: t.id === activeId })),
    readSession,
    updateResume: render,
  };
  render();
})();
