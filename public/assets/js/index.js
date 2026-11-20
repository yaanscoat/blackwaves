/* blackwaves app shell: switches between the home page and the tabbed browser. */
(function () {
  const S = BW.settings;
  const $ = (id) => document.getElementById(id);
  const home = $('home');
  const topBar = $('top-bar');
  const browser = $('browser');
  const searchInput = $('search-input');

  const MOVIES_URL = 'https://yaanscoat.github.io/blackwaves-movies/';

  $('protocol-badge').textContent = BW.PROTOCOLS[BW.proxy.protocol].short;
  $('protocol-badge').title = `Engine: ${BW.PROTOCOLS[BW.proxy.protocol].name}`;

  /* ---------------- Home ---------------- */
  function greetingText() {
    const h = new Date().getHours();
    if (h >= 5 && h < 12) return ['fa-solid fa-cloud-sun', 'Good morning'];
    if (h >= 12 && h < 17) return ['fa-solid fa-sun', 'Good afternoon'];
    if (h >= 17 && h < 21) return ['fa-solid fa-cloud-moon', 'Good evening'];
    return ['fa-solid fa-moon', 'Good night'];
  }

  function updateGreeting() {
    const [icon, text] = greetingText();
    const name = S.get('userName');
    $('greeting').innerHTML = `<i class="${icon}"></i> ${text}${name ? `, ${BW.esc(name)}` : ''}`;
  }

  $('footer-version').addEventListener('click', () => BW.settingsUI.open('about'));

  /* Search bar hint: random lines from /assets/js/json/text.json, typed out one after another. */
  (async () => {
    let texts = [];
    try {
      const res = await fetch('/assets/js/json/text.json', { cache: 'no-cache' });
      texts = ((await res.json()).texts || []).filter((t) => typeof t === 'string' && t.trim());
    } catch {}
    if (!texts.length) return; // keep the plain "search the web or enter a url"
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));
    const animate = () => !['off', 'reduced'].includes(S.get('motion'));
    let last = -1;
    const pick = () => {
      let i = Math.floor(Math.random() * texts.length);
      if (texts.length > 1 && i === last) i = (i + 1) % texts.length;
      last = i;
      return texts[i];
    };
    for (;;) {
      const text = pick();
      if (!animate() || home.hidden) {
        searchInput.placeholder = text;
        await wait(5000);
        continue;
      }
      for (let n = 1; n <= text.length; n++) {
        searchInput.placeholder = text.slice(0, n);
        await wait(45 + Math.random() * 45);
      }
      await wait(3200);
      for (let n = text.length - 1; n >= 0; n--) {
        searchInput.placeholder = text.slice(0, n);
        await wait(22);
      }
      await wait(350);
    }
  })();

  function updateEngineChip() {
    const id = S.get('searchEngine');
    $('engine-chip').textContent = id === 'custom' ? 'Custom' : BW.SEARCH_ENGINES[id]?.name || 'DuckDuckGo';
  }

  /* ---------------- View switching ---------------- */
  function applyNavbar() {
    browser.classList.toggle('no-nav', !S.get('navbar'));
  }

  function showBrowser() {
    if (!browser.hidden) return;
    BW.games.close();
    home.hidden = true;
    topBar.hidden = true;
    document.body.classList.add('browsing');
    browser.hidden = false;
    applyNavbar();
    BW.seasonal.pause();
  }

  function showHome() {
    browser.hidden = true;
    home.hidden = false;
    topBar.hidden = false;
    document.body.classList.remove('browsing');
    $('ext-popover').hidden = true;
    BW.cloak.setLiveTitle('');
    BW.seasonal.restart();
    BW.tabs.refresh();
    searchInput.focus();
  }

  function go(input) {
    if (!input || !input.trim()) return;
    BW.tabs.open(BW.searchUrl(input));
    searchInput.value = '';
  }

  const nav = document.createElement('div');
  nav.className = 'nav-reveal';
  $('navbar').before(nav);
  S.on('navbar', applyNavbar);

  /* ---------------- Home actions ---------------- */
  searchInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') go(searchInput.value);
  });
  $('resume-tabs').addEventListener('click', (e) => {
    if (e.currentTarget.dataset.mode === 'restore') BW.tabs.restore();
    else showBrowser();
  });
  $('nav-home').addEventListener('click', (e) => {
    e.preventDefault();
    BW.games.close();
  });
  $('nav-games').addEventListener('click', (e) => {
    e.preventDefault();
    BW.games.open();
  });
  $('nav-movies').addEventListener('click', (e) => {
    e.preventDefault();
    go(MOVIES_URL);
  });
  $('nav-ai').addEventListener('click', (e) => {
    e.preventDefault();
    BW.ai.open();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === '/' && browser.hidden && document.activeElement === document.body && $('settings-overlay').hidden) {
      e.preventDefault();
      searchInput.focus();
    }
  });

  window.addEventListener('beforeunload', (e) => {
    if (S.get('preventClose')) {
      e.preventDefault();
      e.returnValue = '';
    }
  });

  S.on('userName', updateGreeting);
  S.on('searchEngine', updateEngineChip);
  updateGreeting();
  updateEngineChip();

  // Warm the search engine once the engine is up and the page is idle.
  BW.proxy.ready.then(
    () => {
      if (!S.get('preloadSearch')) return;
      const id = S.get('searchEngine');
      const target = id === 'custom' ? S.get('customSearch').replace('%s', '') : BW.SEARCH_ENGINES[id]?.home;
      if (!target) return;
      const idle = window.requestIdleCallback || ((fn) => setTimeout(fn, 0));
      setTimeout(() => idle(() => BW.proxy.preload(target).catch(() => {}), { timeout: 5000 }), 2500);
    },
    (err) => BW.toast(`Proxy engine failed to start: ${BW.esc(err.message)}`, 'error', 8000)
  );

  if (S.get('tutorialDone')) searchInput.focus();

  BW.app = {
    go,
    openGame: (game) => BW.tabs.openGame(game),
    showBrowser,
    showHome,
    closeBrowser: showHome,
    ensureBrowser: showBrowser,
    updateGreeting,
  };
})();
