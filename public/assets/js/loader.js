/*
 * loader.js - one loader for everything that takes a moment:
 *   - the loading screen shown over a tab while Scramjet/Ultraviolet open a page or a game starts
 *   - the thin progress bar for in-page navigations inside a proxied tab
 *   - fetching + caching the game catalogs
 * Loading state is kept per frame, and the screen always reflects the active tab.
 */
(function () {
  const $ = (id) => document.getElementById(id);
  const states = new WeakMap(); // iframe -> { text, sub, progress, slow }
  const navigating = new WeakSet(); // iframes mid in-page navigation
  let active = null;

  /* ---------------- Loading screen ---------------- */
  let hideTimer = null;

  function render() {
    const el = $('loading-screen');
    const s = active && states.get(active);
    clearTimeout(hideTimer);
    if (s) {
      $('loading-text').textContent = s.text;
      $('loading-sub').textContent = s.sub;
      $('loading-bar-fill').style.width = `${Math.max(0, Math.min(1, s.progress)) * 100}%`;
      el.hidden = false;
      requestAnimationFrame(() => el.classList.add('visible'));
    } else {
      el.classList.remove('visible');
      hideTimer = setTimeout(() => (el.hidden = true), 250);
    }
    renderProgress();
  }

  function show(iframe, text = 'Loading...', sub = '') {
    const prev = states.get(iframe);
    if (prev) clearTimeout(prev.slow);
    const s = { text, sub, progress: 0.08 };
    s.slow = setTimeout(() => {
      s.sub = 'This is taking longer than usual. Hang tight, or try another engine in Settings > Advanced.';
      if (iframe === active) render();
    }, 15000);
    states.set(iframe, s);
    if (iframe === active) render();
  }

  function update(iframe, text, sub, progress) {
    const s = states.get(iframe);
    if (!s) return;
    if (text != null) s.text = text;
    if (sub != null) s.sub = sub;
    if (progress != null) s.progress = progress;
    if (iframe === active) render();
  }

  function hide(iframe) {
    const s = states.get(iframe);
    if (s) clearTimeout(s.slow);
    states.delete(iframe);
    // a navigation that turned into a download never fires "load"
    navigating.delete(iframe);
    if (iframe === active) render();
    BW.tabs && BW.tabs.refresh();
  }

  /** Called by the tab manager whenever the visible tab changes. */
  function setActive(iframe) {
    active = iframe;
    render();
  }

  const isLoading = (iframe) => states.has(iframe) || navigating.has(iframe);

  /* ---------------- In-page navigation bar ---------------- */
  let trickle = null;
  function renderProgress() {
    const bar = $('page-progress');
    clearInterval(trickle);
    if (active && navigating.has(active) && !states.has(active)) {
      let p = 0.1;
      bar.style.opacity = '1';
      bar.style.width = '10%';
      trickle = setInterval(() => {
        p += (0.9 - p) * 0.08;
        bar.style.width = `${p * 100}%`;
      }, 200);
    } else if (bar.style.opacity === '1') {
      bar.style.width = '100%';
      setTimeout(() => {
        bar.style.opacity = '0';
        setTimeout(() => (bar.style.width = '0'), 200);
      }, 150);
    }
  }

  /**
   * Open a URL in a frame through the active engine with the loading screen.
   * Resolves once the first document has loaded.
   */
  async function loadPage(iframe, url, { label, proxied = true } = {}) {
    const engine = BW.PROTOCOLS[BW.proxy.protocol].name;
    show(iframe, label || 'Opening page...', proxied ? `via ${engine}` : '');
    try {
      if (proxied) {
        update(iframe, null, 'Starting the proxy engine...', 0.25);
        await BW.proxy.ready;
        update(iframe, null, `Connecting through ${engine}...`, 0.5);
      }
      await new Promise((resolve) => {
        const done = () => {
          iframe.removeEventListener('load', done);
          resolve();
        };
        iframe.addEventListener('load', done);
        setTimeout(done, 30000);
        iframe.src = proxied ? BW.proxy.encode(url, iframe) : url;
        update(iframe, null, null, 0.7);
      });
    } catch (err) {
      hide(iframe);
      BW.toast(`Couldn't start the proxy: ${BW.esc(err.message)}. Try switching the engine in Settings > Advanced.`, 'error', 7000);
      throw err;
    }
    hide(iframe);
  }

  /** Hook a same-origin proxied frame so in-page navigations show the progress bar. */
  function watchFrame(iframe) {
    iframe.addEventListener('load', () => {
      navigating.delete(iframe);
      if (iframe === active) renderProgress();
      BW.tabs && BW.tabs.refresh();
      try {
        iframe.contentWindow.addEventListener('beforeunload', () => {
          navigating.add(iframe);
          if (iframe === active) renderProgress();
          BW.tabs && BW.tabs.refresh();
        });
      } catch {}
    });
  }

  /* ---------------- Games ---------------- */
  const SOURCES = [
    { id: 'selenite', label: 'Selenite' },
    { id: 'truffled', label: 'Truffled' },
    { id: 'seraph', label: 'Seraph' },
    { id: 'ugs', label: 'UGS' },
    { id: 'ckv', label: 'CKV' },
  ];
  const memory = new Map();

  async function fetchSource(id) {
    if (memory.has(id)) return memory.get(id);
    const cacheKey = `bw:games:${id}`;
    try {
      const cached = JSON.parse(sessionStorage.getItem(cacheKey));
      if (cached && Date.now() - cached.time < 30 * 60 * 1000) {
        memory.set(id, cached.games);
        return cached.games;
      }
    } catch {}
    const res = await fetch(`/api/games/${id}`);
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
    const games = data.map((g) => Object.assign(g, { source: id }));
    memory.set(id, games);
    try {
      sessionStorage.setItem(cacheKey, JSON.stringify({ time: Date.now(), games }));
    } catch {}
    return games;
  }

  /** Load one source or "all". onProgress(doneCount, total, label) */
  async function loadGames(source, onProgress) {
    const ids = source === 'all' ? SOURCES.map((s) => s.id) : [source];
    let done = 0;
    const failed = [];
    const results = await Promise.all(
      ids.map(async (id) => {
        try {
          return await fetchSource(id);
        } catch (err) {
          failed.push(`${SOURCES.find((s) => s.id === id)?.label || id} (${err.message})`);
          return [];
        } finally {
          done++;
          onProgress && onProgress(done, ids.length, SOURCES.find((s) => s.id === id)?.label);
        }
      })
    );
    let games = results.flat();
    const junk = (name) => (/^[\p{L}\p{N}]/u.test(name) ? 0 : 1);
    if (source === 'all') games.sort((a, b) => junk(a.name) - junk(b.name) || a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));
    return { games, failed };
  }

  async function loadGame(iframe, game) {
    await loadPage(iframe, game.proxied ? game.url : new URL(game.url, location.origin).href, {
      label: `Loading ${game.name}...`,
      proxied: game.proxied,
    });
  }

  BW.loader = { show, update, hide, setActive, isLoading, loadPage, watchFrame, loadGames, loadGame, GAME_SOURCES: SOURCES };
})();
