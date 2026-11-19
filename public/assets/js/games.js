/* Games browser: source picker, search and an incrementally rendered grid. */
(function () {
  const view = document.getElementById('games-view');
  const grid = document.getElementById('games-grid');
  const countEl = document.getElementById('games-count');
  const searchInput = document.getElementById('games-search');
  const PLACEHOLDER = '/assets/images/placeholder.svg';
  const PAGE = 90;

  let all = [];
  let filtered = [];
  let rendered = 0;
  let loadToken = 0;

  const sourceOptions = [{ value: 'all', label: 'All sources', icon: 'fa-solid fa-layer-group' }].concat(
    BW.loader.GAME_SOURCES.map((s) => ({ value: s.id, label: s.label, icon: 'fa-solid fa-gamepad' }))
  );

  const sourceDropdown = BW.dropdown(document.getElementById('games-source'), {
    options: sourceOptions,
    value: BW.settings.get('gameSource'),
    onChange: (v) => load(v),
  });
  BW.settings.on('gameSource', (v) => sourceDropdown.set(v, true));

  function sourceLabel(id) {
    return BW.loader.GAME_SOURCES.find((s) => s.id === id)?.label || id;
  }

  function card(game, index) {
    return `<button class="game-card" data-index="${index}" title="${BW.esc(game.name)}">
      <div class="game-thumb"><img src="${BW.esc(game.img || PLACEHOLDER)}" alt="" loading="lazy" decoding="async" referrerpolicy="no-referrer"></div>
      <div class="game-meta"><span class="game-name">${BW.esc(game.name)}</span><span class="game-source">${BW.esc(sourceLabel(game.source))}</span></div>
    </button>`;
  }

  function renderMore() {
    if (rendered >= filtered.length) return;
    const next = filtered.slice(rendered, rendered + PAGE);
    grid.insertAdjacentHTML('beforeend', next.map((g, i) => card(g, rendered + i)).join(''));
    rendered += next.length;
  }

  function applyFilter() {
    const q = searchInput.value.trim().toLowerCase();
    filtered = q ? all.filter((g) => g.name.toLowerCase().includes(q)) : all;
    grid.innerHTML = '';
    rendered = 0;
    countEl.textContent = `${filtered.length} game${filtered.length === 1 ? '' : 's'}${q ? ` matching "${searchInput.value.trim()}"` : ''}`;
    if (!filtered.length) {
      grid.innerHTML = `<div class="games-empty"><i class="fa-solid fa-ghost"></i><p>No games found.</p></div>`;
      return;
    }
    renderMore();
  }

  async function load(source) {
    const token = ++loadToken;
    grid.innerHTML = Array.from({ length: 18 }, () => '<div class="game-card skeleton"><div class="game-thumb"></div><div class="game-meta"><span></span></div></div>').join('');
    countEl.textContent = source === 'all' ? 'Loading game sources...' : `Loading ${sourceLabel(source)}...`;
    const { games, failed } = await BW.loader.loadGames(source, (done, total, label) => {
      if (token === loadToken && total > 1) countEl.textContent = `Loading game sources (${done}/${total}) - ${label} done`;
    });
    if (token !== loadToken) return;
    all = games;
    applyFilter();
    if (failed.length) BW.toast(`Some sources failed to load: ${BW.esc(failed.join(', '))}`, 'warning', 6000);
  }

  grid.addEventListener('error', (e) => {
    if (e.target.tagName === 'IMG' && !e.target.src.endsWith(PLACEHOLDER)) e.target.src = PLACEHOLDER;
  }, true);
  // thumbnails fade in over the placeholder instead of popping in from an empty box
  grid.addEventListener('load', (e) => {
    if (e.target.tagName === 'IMG') e.target.parentElement.classList.add('loaded');
  }, true);

  grid.addEventListener('click', (e) => {
    const el = e.target.closest('.game-card[data-index]');
    if (!el) return;
    const game = filtered[+el.dataset.index];
    if (game) BW.app.openGame(game);
  });

  view.addEventListener('scroll', () => {
    if (view.scrollTop + view.clientHeight > view.scrollHeight - 600) renderMore();
  });

  let searchTimer;
  searchInput.addEventListener('input', () => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(applyFilter, 120);
  });

  BW.games = {
    open() {
      BW.ai && BW.ai.close();
      view.hidden = false;
      document.body.classList.add('games-open');
      if (!all.length) load(sourceDropdown.value);
      setTimeout(() => searchInput.focus(), 50);
    },
    close() {
      view.hidden = true;
      document.body.classList.remove('games-open');
    },
  };
  document.getElementById('games-close').addEventListener('click', () => BW.games.close());
})();
