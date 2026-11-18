/*
 * Developer tools: the real Chromium DevTools frontend, docked under (or beside) the page.
 *
 *   frontend  /devtools/front_end/chii_app.html (Chrome's DevTools UI, packaged by chii), in an
 *             iframe in this page. In "embedded" mode it speaks the DevTools protocol over postMessage.
 *   backend   chobitsu, a JavaScript implementation of the DevTools protocol, injected into the
 *             proxied page in the active tab. Proxied pages share our origin, so we can reach in.
 *
 * Messages are relayed between the two. The panel follows the active tab and re-attaches when the
 * page navigates. F12 / Ctrl+Shift+I toggle it.
 */
(function () {
  const $ = (id) => document.getElementById(id);
  const btn = $('nav-devtools');
  const notice = $('devtools-notice');
  const FRONTEND = '/devtools/front_end/chii_app.html';
  const STORE = 'bw:devtools';

  let prefs = { dock: 'bottom', bottom: 0.4, right: 0.4 };
  try {
    Object.assign(prefs, JSON.parse(localStorage.getItem(STORE)) || {});
  } catch {}
  const savePrefs = () => {
    try {
      localStorage.setItem(STORE, JSON.stringify(prefs));
    } catch {}
  };

  let panel = null; // the docked element
  let devFrame = null; // DevTools frontend iframe
  let target = null; // the tab iframe being inspected
  let backendCode = null;

  /* ---------------- backend (inside the page) ---------------- */
  async function loadBackend() {
    if (backendCode) return backendCode;
    const res = await fetch('/devtools/chobitsu.js');
    if (!res.ok) throw new Error('DevTools files are missing. Run npm i on the server.');
    backendCode = await res.text();
    return backendCode;
  }

  // Put chobitsu into the page and point its output at the frontend. Returns false if we can't reach the page.
  async function inject(frame) {
    let win;
    try {
      win = frame.contentWindow;
      if (!win.document || !win.document.documentElement) return false;
    } catch {
      return false;
    }
    if (!win.chobitsu) {
      const code = await loadBackend();
      // Scramjet turns console.log & co. into accessors that ignore assignment, which stops
      // chobitsu from capturing logs. Make them plain writable methods again on this page.
      for (const name of ['log', 'warn', 'error', 'info', 'debug', 'dir', 'table', 'group', 'groupCollapsed', 'groupEnd', 'clear', 'trace', 'assert']) {
        try {
          const d = Object.getOwnPropertyDescriptor(win.console, name);
          if (d && d.get && d.configurable) Object.defineProperty(win.console, name, { value: d.get.call(win.console), writable: true, configurable: true, enumerable: d.enumerable });
        } catch {}
      }
      new win.Function(`${code}\n//# sourceURL=blackwaves-devtools/chobitsu.js`).call(win);
    }
    if (!win.chobitsu) return false;
    win.chobitsu.setOnMessage((msg) => {
      // replies to our own bookkeeping requests stay here
      if (msg.includes('"id":"bw-')) return;
      if (devFrame && frame === target) devFrame.contentWindow.postMessage(msg, location.origin);
    });
    hookKeys(win);
    return true;
  }

  const toFrontend = (msg) => devFrame && devFrame.contentWindow.postMessage(JSON.stringify(msg), location.origin);
  let seq = 0;
  const toBackend = (msg) => {
    try {
      target.contentWindow.chobitsu.sendRawMessage(JSON.stringify({ ...msg, id: `bw-${++seq}` }));
    } catch {}
  };

  window.addEventListener('message', (e) => {
    if (!devFrame || e.source !== devFrame.contentWindow || typeof e.data !== 'string') return;
    try {
      target.contentWindow.chobitsu.sendRawMessage(e.data);
    } catch {}
  });

  // The page navigated: tell the already-open frontend it's a new document (same sequence chii uses).
  async function reattach() {
    if (!(await inject(target))) return;
    const dt = devFrame.contentWindow;
    try {
      const sdk = await dt.runtime.loadLegacyModule('core/sdk/sdk.js');
      for (const model of sdk.TargetManager.TargetManager.instance().models(sdk.ResourceTreeModel.ResourceTreeModel)) {
        model.dispatchEventToListeners(sdk.ResourceTreeModel.Events.WillReloadPage, model);
      }
    } catch {}
    toFrontend({ method: 'Page.frameNavigated', params: { frame: { id: '1', mimeType: 'text/html', securityOrigin: location.origin, url: location.href }, type: 'Navigation' } });
    toBackend({ method: 'Network.enable' });
    toFrontend({ method: 'Runtime.executionContextsCleared' });
    for (const domain of ['Runtime', 'Debugger', 'DOMStorage', 'DOM', 'CSS', 'Overlay']) toBackend({ method: `${domain}.enable` });
    toFrontend({ method: 'DOM.documentUpdated' });
    toBackend({ method: 'Page.enable' });
    toFrontend({ method: 'Page.loadEventFired' });
  }

  /* ---------------- panel ---------------- */
  function isLightTheme() {
    return getComputedStyle(document.documentElement).getPropertyValue('--scheme').trim() === 'light';
  }

  function buildPanel() {
    panel = document.createElement('div');
    panel.className = 'devtools-dock';
    panel.innerHTML = `<div class="devtools-resizer" aria-hidden="true"></div>
      <div class="devtools-bar">
        <span class="devtools-name"><i class="fa-solid fa-code"></i> devtools</span>
        <span class="devtools-target"></span>
        <button class="icon-btn small" data-act="dock" aria-label="Change dock side"></button>
        <button class="icon-btn small" data-act="close" aria-label="Close devtools"><i class="fa-solid fa-xmark"></i></button>
      </div>
      <div class="devtools-body"><div class="devtools-loading"><span class="tab-spinner inline"></span> starting devtools...</div><iframe class="devtools-frame" title="Developer tools"></iframe></div>`;
    devFrame = panel.querySelector('iframe');
    panel.querySelector('[data-act="close"]').onclick = close;
    panel.querySelector('[data-act="dock"]').onclick = () => {
      prefs.dock = prefs.dock === 'bottom' ? 'right' : 'bottom';
      savePrefs();
      layout();
    };
    panel.querySelector('.devtools-resizer').addEventListener('pointerdown', startResize);
    $('frames').after(panel);
  }

  function layout() {
    if (!panel) return;
    const frames = $('frames');
    const right = prefs.dock === 'right';
    const host = frames.parentElement.getBoundingClientRect();
    const top = frames.offsetTop;
    const max = right ? host.width - 160 : host.height - top - 120;
    const size = Math.max(160, Math.min(max, Math.round((right ? host.width : host.height - top) * prefs[prefs.dock])));
    panel.dataset.dock = prefs.dock;
    panel.style.top = right ? `${top}px` : '';
    panel.style.width = right ? `${size}px` : '';
    panel.style.height = right ? '' : `${size}px`;
    frames.style.marginRight = right ? `${size}px` : '';
    frames.style.marginBottom = right ? '' : `${size}px`;
    panel.querySelector('[data-act="dock"]').innerHTML = right ? '<i class="fa-solid fa-table-columns fa-rotate-270"></i>' : '<i class="fa-solid fa-table-columns"></i>';
    panel.querySelector('[data-act="dock"]').setAttribute('aria-label', right ? 'Dock to bottom' : 'Dock to right');
  }

  function startResize(e) {
    e.preventDefault();
    const frames = $('frames');
    const host = frames.parentElement.getBoundingClientRect();
    const top = frames.getBoundingClientRect().top;
    panel.classList.add('resizing');
    const move = (ev) => {
      if (prefs.dock === 'right') prefs.right = Math.min(0.85, Math.max(0.15, (host.right - ev.clientX) / host.width));
      else prefs.bottom = Math.min(0.85, Math.max(0.15, (host.bottom - ev.clientY) / (host.bottom - top)));
      layout();
    };
    const up = () => {
      panel.classList.remove('resizing');
      removeEventListener('pointermove', move);
      removeEventListener('pointerup', up);
      savePrefs();
    };
    addEventListener('pointermove', move);
    addEventListener('pointerup', up);
  }

  function setTitle() {
    if (!panel) return;
    const tab = BW.tabs.list().find((t) => t.iframe === target);
    panel.querySelector('.devtools-target').textContent = tab ? tab.title || tab.url : '';
  }

  // (Re)start the frontend against the active tab.
  async function connect() {
    target = BW.tabs.activeFrame();
    if (!target) return close();
    panel.classList.add('loading');
    setTitle();
    notice.hidden = false;
    try {
      if (!(await inject(target))) {
        BW.toast('Developer tools can\'t reach this page yet. Wait for it to load and try again.', 'warning');
        return close();
      }
    } catch (e) {
      BW.toast(BW.esc(e.message || 'Developer tools failed to start.'), 'error', 6000);
      return close();
    } finally {
      notice.hidden = true;
    }
    // DevTools keeps its preferences in localStorage when hosted like this; match our theme.
    try {
      localStorage.setItem('uiTheme', JSON.stringify(isLightTheme() ? 'default' : 'dark'));
    } catch {}
    // A fresh frontend for every page we attach to. (Its settings come from the URL hash, so a
    // cache-busting query string would break it; swap the iframe instead.)
    const fresh = devFrame.cloneNode(false);
    devFrame.replaceWith(fresh);
    devFrame = fresh;
    devFrame.onload = () => panel && panel.classList.remove('loading');
    devFrame.src = `${FRONTEND}#?embedded=${encodeURIComponent(location.origin)}`;
  }

  function open() {
    if (!BW.tabs.activeFrame()) return BW.toast('Open a page first.', 'info');
    if (!panel) buildPanel();
    layout();
    btn.classList.add('active');
    connect();
  }

  function close() {
    if (!panel) return;
    panel.remove();
    panel = devFrame = target = null;
    const frames = $('frames');
    frames.style.marginRight = frames.style.marginBottom = '';
    btn.classList.remove('active');
  }

  const toggle = () => (panel ? close() : open());

  /* ---------------- wiring ---------------- */
  btn.addEventListener('click', toggle);

  // tab frames: re-attach after a navigation, follow tab switches
  $('frames').addEventListener('load', (e) => {
    const frame = e.target;
    if (!(frame instanceof HTMLIFrameElement)) return;
    try {
      hookKeys(frame.contentWindow);
    } catch {}
    if (panel && frame === target) {
      setTitle();
      reattach();
    }
  }, true);
  setInterval(() => {
    if (!panel) return;
    const active = BW.tabs.activeFrame();
    if (!active) close();
    else if (active !== target) connect();
    else setTitle();
  }, 500);
  addEventListener('resize', layout);

  // F12 / Ctrl+Shift+I (Cmd+Opt+I), from blackwaves itself and from inside proxied pages
  function onKey(e) {
    const devKey = e.key === 'F12' || ((e.ctrlKey || e.metaKey) && e.shiftKey && e.code === 'KeyI') || (e.metaKey && e.altKey && e.code === 'KeyI');
    if (!devKey || document.body.classList.contains('browsing') === false) return;
    e.preventDefault();
    toggle();
  }
  function hookKeys(win) {
    if (!win || win.__bwDevKeys) return;
    win.__bwDevKeys = true;
    win.addEventListener('keydown', onKey, true);
  }
  addEventListener('keydown', onKey, true);

  BW.devtools = { open, close, toggle, isOpen: () => !!panel };
})();
