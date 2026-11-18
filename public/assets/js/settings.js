/* Settings: centered modal with sidebar tabs. */
(function () {
  const S = BW.settings;
  const esc = BW.esc;
  const VERSION = '1.0.0';

  const TABS = [
    { id: 'preferences', name: 'Preferences', icon: 'fa-solid fa-sliders' },
    { id: 'appearance', name: 'Appearance', icon: 'fa-solid fa-palette' },
    { id: 'cloaking', name: 'Cloaking', icon: 'fa-solid fa-user-secret' },
    { id: 'extensions', name: 'Extensions', icon: 'fa-solid fa-puzzle-piece' },
    { id: 'advanced', name: 'Advanced', icon: 'fa-solid fa-microchip' },
    { id: 'sync', name: 'Cloud Sync', icon: 'fa-solid fa-cloud' },
    { id: 'about', name: 'About', icon: 'fa-solid fa-circle-info' },
  ];
  const REPO_URL = 'https://github.com/yaanscoat/blackwaves';

  const root = document.getElementById('settings-root');
  root.innerHTML = `
    <div class="settings-overlay" id="settings-overlay" hidden>
      <div class="settings-modal" role="dialog" aria-modal="true" aria-labelledby="settings-heading">
        <aside class="settings-sidebar">
          <div class="settings-brand"><i class="fa-solid fa-gear"></i><span>Settings</span></div>
          <nav class="settings-tabs">
            ${TABS.map((t) => `<button class="settings-tab" data-tab="${t.id}"><i class="${t.icon}"></i><span>${t.name}</span></button>`).join('')}
          </nav>
          <div class="settings-foot">blackwaves v${VERSION}<br>by <a href="https://github.com/yaanscoat" target="_blank" rel="noopener">yaanscoat</a><br><a href="${BW.DISCORD_URL}" target="_blank" rel="noopener"><i class="fa-brands fa-discord"></i> Join the Discord</a></div>
        </aside>
        <section class="settings-main">
          <header class="settings-header">
            <h2 id="settings-heading"></h2>
            <button class="icon-btn" id="settings-close" aria-label="Close settings"><i class="fa-solid fa-xmark"></i></button>
          </header>
          <div class="settings-scroll" id="settings-scroll"></div>
        </section>
      </div>
    </div>`;

  const overlay = document.getElementById('settings-overlay');
  const scroll = document.getElementById('settings-scroll');
  const heading = document.getElementById('settings-heading');
  let current = 'preferences';

  /* ---------------- building blocks ---------------- */
  function section(title, note) {
    const el = document.createElement('div');
    el.className = 'settings-section';
    el.innerHTML = `<h3>${esc(title)}</h3>${note ? `<p class="section-note">${note}</p>` : ''}`;
    scroll.appendChild(el);
    return el;
  }

  function row(parent, title, desc, control, opts = {}) {
    const el = document.createElement('div');
    el.className = `setting-row${opts.stack ? ' stack' : ''}`;
    el.innerHTML = `<div class="setting-text"><div class="setting-title">${esc(title)}${opts.tag ? ` <span class="tag ${opts.tag.type || ''}">${esc(opts.tag.text)}</span>` : ''}</div>${desc ? `<div class="setting-desc">${desc}</div>` : ''}</div><div class="setting-control"></div>`;
    const slot = el.querySelector('.setting-control');
    if (control) [].concat(control).forEach((c) => slot.appendChild(c));
    parent.appendChild(el);
    return el;
  }

  function dropdownEl(options, value, onChange, searchable) {
    const el = document.createElement('div');
    BW.dropdown(el, { options, value, onChange, searchable });
    return el;
  }

  function input(value, placeholder, onCommit, type = 'text') {
    const wrap = document.createElement('div');
    wrap.className = 'input-group';
    wrap.innerHTML = `<input class="bw-input" type="${type}" placeholder="${esc(placeholder)}" value="${esc(value)}" autocomplete="off" spellcheck="false"><button class="bw-btn small">Save</button>`;
    const field = wrap.querySelector('input');
    const commit = () => onCommit(field.value.trim(), field);
    wrap.querySelector('button').addEventListener('click', commit);
    field.addEventListener('keydown', (e) => e.key === 'Enter' && commit());
    return wrap;
  }

  function button(label, onClick, cls = '') {
    const b = document.createElement('button');
    b.className = `bw-btn ${cls}`;
    b.innerHTML = label;
    b.addEventListener('click', onClick);
    return b;
  }

  function toggleSetting(key, onMsg, offMsg) {
    return BW.toggle(S.get(key), (v) => {
      S.set(key, v);
      if (onMsg || offMsg) BW.toast(v ? onMsg : offMsg, v ? 'success' : 'info');
    });
  }

  function needsReload(what) {
    BW.toast(`${what} changed. <button class="toast-action" onclick="location.reload()">Reload now</button>`, 'info', 8000);
  }

  /* ---------------- Preferences ---------------- */
  function renderPreferences() {
    const general = section('General');
    row(general, 'Display name', 'Used for the greeting on the home page.', input(S.get('userName'), 'Your name', (v) => {
      S.set('userName', v);
      BW.app && BW.app.updateGreeting();
      BW.toast(v ? `We'll call you ${esc(v)}.` : 'Name cleared.', 'success');
    }));

    const search = section('Search');
    const engineOptions = Object.entries(BW.SEARCH_ENGINES).map(([id, e]) => ({
      value: id,
      label: e.name,
      icon: e.home ? `https://www.google.com/s2/favicons?sz=32&domain=${new URL(e.home).hostname}` : 'fa-solid fa-pen',
    }));
    const customRow = document.createElement('div');
    row(search, 'Search engine', 'Where searches from the home page and address bar go.', dropdownEl(engineOptions, S.get('searchEngine'), (v) => {
      S.set('searchEngine', v);
      customRow.hidden = v !== 'custom';
      BW.toast(`Search engine set to ${esc(BW.SEARCH_ENGINES[v].name)}.`, 'success');
    }));
    customRow.hidden = S.get('searchEngine') !== 'custom';
    search.appendChild(customRow);
    row(customRow, 'Custom search URL', 'Use <code>%s</code> where the query goes.', input(S.get('customSearch'), 'https://example.com/search?q=%s', (v) => {
      if (!/^https?:\/\//.test(v)) return BW.toast('Enter a full http(s) URL.', 'error');
      S.set('customSearch', v.includes('%s') ? v : `${v}%s`);
      BW.toast('Custom search engine saved.', 'success');
    }));

    const games = section('Games');
    row(games, 'Game source', 'Which library opens first in Games.', dropdownEl(
      [{ value: 'all', label: 'All sources', icon: 'fa-solid fa-layer-group' }].concat(BW.loader.GAME_SOURCES.map((s) => ({ value: s.id, label: s.label, icon: 'fa-solid fa-gamepad' }))),
      S.get('gameSource'),
      (v) => {
        S.set('gameSource', v);
        BW.toast('Game source updated.', 'success');
      }
    ));

    const behavior = section('Behavior');
    row(behavior, 'Prevent tab closing', 'Ask before the tab closes or reloads, so you never lose a game by accident.', toggleSetting('preventClose', 'Tab close protection on.', 'Tab close protection off.'));
    row(behavior, 'Navigation bar', 'Show the toolbar above proxied pages.', toggleSetting('navbar'));
    row(behavior, 'Welcome tutorial', 'Walk through the basics again.', button('<i class="fa-solid fa-play"></i> Replay', () => {
      close();
      BW.tutorial.start();
    }));
  }

  /* ---------------- Appearance ---------------- */
  function renderAppearance() {
    const themes = section('Theme', `${BW.THEMES.length} themes. Changes apply instantly.`);
    const grid = document.createElement('div');
    grid.className = 'theme-grid';
    grid.innerHTML = BW.THEMES.map((t) => `<button class="theme-card${S.get('theme') === t.id ? ' active' : ''}" data-theme-id="${t.id}" style="--t-bg:${t.colors[0]};--t-surface:${t.colors[1]};--t-accent:${t.colors[2]}">
        <span class="theme-preview"><span class="tp-bar"></span><span class="tp-line"></span><span class="tp-line short"></span><span class="tp-dot"></span></span>
        <span class="theme-name">${esc(t.name)}</span></button>`).join('');
    grid.addEventListener('click', (e) => {
      const card = e.target.closest('.theme-card');
      if (!card) return;
      grid.querySelectorAll('.theme-card').forEach((c) => c.classList.toggle('active', c === card));
      S.set('theme', card.dataset.themeId);
    });
    themes.appendChild(grid);

    const motion = section('Motion');
    row(motion, 'Motion effects', '<b>Full</b> everything on. <b>Minimal</b> quick fades only. <b>Reduced</b> slow and sparse. <b>Off</b> no animation at all.', BW.segmented(BW.MOTION, S.get('motion'), (v) => S.set('motion', v)), { stack: true });

    const seasonal = section('Seasonal');
    const autoNote = () => `Automatic follows the calendar, with a starry night between seasons. Right now that's <b>${esc(BW.SEASONAL.find((x) => x.id === BW.seasonForDate()).name)}</b>.`;
    row(seasonal, 'Seasonal look', autoNote(), dropdownEl(BW.SEASONAL.map((x) => ({ value: x.id, label: x.name })), S.get('seasonal'), (v) => S.set('seasonal', v)));

    const cursor = section('Cursor');
    row(cursor, 'Custom cursor', 'The Mario Gant cursor set by Behelit. Turn it off to use your system cursor.', BW.toggle(S.get('customCursor'), (v) => S.set('customCursor', v)));
  }

  /* ---------------- Cloaking ---------------- */
  function renderCloaking() {
    const tab = section('Tab disguise', 'Make the tab look like a normal school or work site.');
    const presetOptions = [
      { value: 'none', label: 'None (blackwaves)', icon: '/favicon.ico' },
      { value: 'custom', label: 'Custom...', icon: 'fa-solid fa-pen' },
    ].concat(BW.cloak.PRESETS.map((p) => ({ value: p.id, label: p.name, icon: p.icon, hint: p.title })));
    const custom = document.createElement('div');
    row(tab, 'Preset', `${BW.cloak.PRESETS.length} presets with real titles and icons.`, dropdownEl(presetOptions, S.get('cloakPreset'), (v) => {
      S.set('cloakPreset', v);
      custom.hidden = v !== 'custom';
    }, true));
    custom.hidden = S.get('cloakPreset') !== 'custom';
    tab.appendChild(custom);
    row(custom, 'Custom title', '', input(S.get('cloakTitle'), 'Tab title', (v) => S.set('cloakTitle', v) || BW.toast('Title saved.', 'success')));
    row(custom, 'Custom icon URL', '', input(S.get('cloakIcon'), 'https://example.com/favicon.ico', (v) => S.set('cloakIcon', v) || BW.toast('Icon saved.', 'success')));
    row(tab, 'When to disguise', '<b>Always</b> keeps the disguise on. <b>Only when away</b> switches to it when you leave the tab, and back when you return.', BW.segmented([{ id: 'always', name: 'Always' }, { id: 'away', name: 'Only when away' }], S.get('cloakMode'), (v) => S.set('cloakMode', v)), { stack: true });

    const launch = section('Launching', 'Open blackwaves inside a blank tab so the real URL never shows up in history.');
    row(launch, 'Launch method', '<b>about:blank</b> opens a blank page. <b>blob:</b> opens a one-off blob URL.', BW.segmented([{ id: 'none', name: 'Off' }, { id: 'aboutblank', name: 'about:blank' }, { id: 'blob', name: 'blob:' }], S.get('launchMode'), (v) => S.set('launchMode', v)), { stack: true });
    row(launch, 'Launch automatically', 'Every time blackwaves opens, jump straight into the cloaked tab.', toggleSetting('autoLaunch', 'Auto-launch on.', 'Auto-launch off.'));
    row(launch, 'Redirect this tab to', 'After launching, the original tab goes here.', input(S.get('redirectUrl'), 'https://classroom.google.com', (v) => S.set('redirectUrl', v) || BW.toast('Redirect saved.', 'success')));
    row(launch, 'Launch now', '', button('<i class="fa-solid fa-rocket"></i> Launch', () => {
      if (S.get('launchMode') === 'none') return BW.toast('Choose about:blank or blob: first.', 'warning');
      if (BW.cloak.inLauncher()) return BW.toast('Already running in a cloaked tab.', 'info');
      if (!BW.cloak.launch()) BW.toast('Pop-up blocked. Allow pop-ups for this site and try again.', 'error');
    }, 'primary'));

    const panic = section('Panic key', 'One key press sends the tab somewhere safe.');
    const keyBtn = button(S.get('panicKey') ? `<kbd>${esc(S.get('panicKey'))}</kbd>` : 'Set key', () => {
      keyBtn.innerHTML = 'Press a key...';
      const handler = (e) => {
        e.preventDefault();
        e.stopPropagation();
        document.removeEventListener('keydown', handler, true);
        if (e.key === 'Escape' || e.key === 'Backspace') {
          S.set('panicKey', '');
          keyBtn.innerHTML = 'Set key';
          return BW.toast('Panic key cleared.', 'info');
        }
        S.set('panicKey', e.key);
        keyBtn.innerHTML = `<kbd>${esc(e.key)}</kbd>`;
        BW.toast(`Panic key set to ${esc(e.key)}.`, 'success');
      };
      document.addEventListener('keydown', handler, true);
    });
    row(panic, 'Key', 'Click, then press a key. Esc clears it.', keyBtn);
    row(panic, 'Panic URL', '', input(S.get('panicUrl'), 'https://classroom.google.com', (v) => S.set('panicUrl', v) || BW.toast('Panic URL saved.', 'success')));
  }

  /* ---------------- Extensions ---------------- */
  function renderExtensions() {
    renderAdBlocking();
    const inst = section('Install', 'Chrome extensions (.crx, .zip or an unpacked folder) and userscripts (.user.js). Built on a JavaScript rewrite of <a href="https://github.com/x8rr/sapphire" target="_blank" rel="noopener">Sapphire</a>, so they run on every engine. Compatibility is best-effort.');
    const drop = document.createElement('div');
    drop.className = 'drop-zone';
    drop.innerHTML = `<i class="fa-solid fa-cloud-arrow-up"></i><p>Drop an extension or userscript here</p>
      <div class="drop-actions"><label class="bw-btn primary"><input type="file" accept=".crx,.zip,.js" hidden data-pick="file"><i class="fa-solid fa-file-zipper"></i> Choose file</label>
      <label class="bw-btn"><input type="file" webkitdirectory hidden data-pick="folder"><i class="fa-solid fa-folder-open"></i> Load unpacked</label></div>`;
    const doInstall = async (input) => {
      const close = BW.toast('Installing...', 'info', 0);
      try {
        const rec = await BW.extensions.install(input);
        close();
        BW.toast(`Installed ${esc(rec.manifest.name)}.`, 'success');
        render('extensions');
      } catch (err) {
        close();
        BW.toast(`Install failed: ${esc(err.message)}`, 'error', 6000);
      }
    };
    drop.querySelector('[data-pick="file"]').addEventListener('change', (e) => e.target.files[0] && doInstall(e.target.files[0]));
    drop.querySelector('[data-pick="folder"]').addEventListener('change', (e) => e.target.files.length && doInstall([...e.target.files]));
    drop.addEventListener('dragover', (e) => {
      e.preventDefault();
      drop.classList.add('over');
    });
    drop.addEventListener('dragleave', () => drop.classList.remove('over'));
    drop.addEventListener('drop', (e) => {
      e.preventDefault();
      drop.classList.remove('over');
      if (e.dataTransfer.files[0]) doInstall(e.dataTransfer.files[0]);
    });
    inst.appendChild(drop);

    renderStoreSearch();

    const builtin = section('Built-in');
    for (const b of BW.extensions.BUILTINS.filter((x) => !x.hidden && x.id !== 'adshield')) {
      const el = row(builtin, b.name, esc(b.description), BW.toggle(S.get('builtinExtensions').includes(b.id), (v) => {
        const set = new Set(S.get('builtinExtensions'));
        v ? set.add(b.id) : set.delete(b.id);
        S.set('builtinExtensions', [...set]);
        BW.toast(`${esc(b.name)} ${v ? 'enabled' : 'disabled'}. Applies to the next page you load.`, v ? 'success' : 'info');
      }));
      el.querySelector('.setting-title').insertAdjacentHTML('afterbegin', `<i class="${b.icon} ext-icon"></i>`);
    }

    const installed = section('Installed');
    const list = BW.extensions.list();
    if (!list.length) {
      installed.insertAdjacentHTML('beforeend', '<p class="empty-note">Nothing installed yet.</p>');
      return;
    }
    for (const rec of list) {
      const controls = [BW.toggle(rec.enabled, async (v) => {
        await BW.extensions.setEnabled(rec.id, v);
        BW.toast(`${esc(rec.manifest.name)} ${v ? 'enabled' : 'disabled'}.`, v ? 'success' : 'info');
      })];
      if (BW.extensions.hasOptions(rec.id)) {
        controls.unshift(button('<i class="fa-solid fa-gear"></i>', () => BW.extensions.openOptions(rec.id), 'small ghost'));
        controls[0].setAttribute('aria-label', 'Options');
      }
      controls.unshift(pinButton(rec));
      controls.unshift(button('<i class="fa-solid fa-trash"></i>', async () => {
        await BW.extensions.remove(rec.id);
        BW.toast(`Removed ${esc(rec.manifest.name)}.`, 'info');
        render('extensions');
      }, 'small ghost danger'));
      const icon = BW.extensions.iconUrl(rec.id);
      const el = row(installed, rec.manifest.name, `${esc(rec.manifest.description || '')}<br><small>v${esc(rec.manifest.version || '?')} &middot; ${rec.type === 'userscript' ? 'Userscript' : `Manifest V${rec.manifest.manifest_version || 2}`}</small>`, controls);
      el.querySelector('.setting-title').insertAdjacentHTML('afterbegin', icon ? `<img class="ext-icon" src="${icon}" alt="">` : '<i class="fa-solid fa-puzzle-piece ext-icon"></i>');
    }
  }

  // Pin / unpin an installed extension to the navbar.
  function pinButton(rec) {
    const b = button('<i class="fa-solid fa-thumbtack"></i>', () => {
      const on = !BW.extensions.isPinned(rec.id);
      BW.extensions.setPinned(rec.id, on);
      paint();
      BW.toast(`${esc(rec.manifest.name)} ${on ? 'pinned to' : 'unpinned from'} the toolbar.`, 'info');
    }, 'small ghost pin-btn');
    const paint = () => {
      const on = BW.extensions.isPinned(rec.id);
      b.classList.toggle('pinned', on);
      b.setAttribute('aria-pressed', String(on));
      b.title = on ? 'Unpin from toolbar' : 'Pin to toolbar';
    };
    paint();
    return b;
  }

  /* Ad blocking: BlackWaves Shield (recommended) and/or uBlock Origin Lite. Both are optional; nothing is forced. */
  const UBOL_ID = 'ddkjiahejlhfcafbddmgiahcphecmpfh';
  let unsubscribeStats = null;
  function renderAdBlocking() {
    const sec = section('Ad blocking', 'We recommend <b>BlackWaves Shield</b>: it is tuned for blackwaves, light, and rarely breaks sites. Prefer <b>uBlock Origin</b>? Go for it. Use either, both, or neither. It is your browser, we won\'t control you.');
    const shieldOn = S.get('builtinExtensions').includes('adshield');
    const shieldRow = row(sec, 'BlackWaves Shield', `Blocks ${BW.filters.SHIELD_DOMAINS.length}+ ad and tracking networks at the network level, hides ad slots and stops pop-unders.`, BW.toggle(shieldOn, (v) => {
      const set = new Set(S.get('builtinExtensions'));
      v ? set.add('adshield') : set.delete('adshield');
      S.set('builtinExtensions', [...set]);
      BW.toast(`BlackWaves Shield ${v ? 'on' : 'off'}.`, v ? 'success' : 'info');
    }), { tag: { text: 'Recommended' } });
    shieldRow.querySelector('.setting-title').insertAdjacentHTML('afterbegin', '<i class="fa-solid fa-shield-halved ext-icon"></i>');

    const ubol = BW.extensions.list().find((r) => r.id === UBOL_ID);
    const controls = [];
    if (ubol && ubol.enabled) {
      controls.push(pinButton(ubol), button('<i class="fa-solid fa-gauge"></i> Dashboard', () => BW.extensions.openOptions(UBOL_ID), 'small ghost'));
    }
    controls.push(BW.toggle(!!(ubol && ubol.enabled), async (v) => {
      try {
        if (v && !ubol) {
          const closeToast = BW.toast('Downloading uBlock Origin Lite from the Chrome Web Store...', 'info', 0);
          const res = await fetch(`/api/cws/crx/${UBOL_ID}`);
          if (!res.ok) {
            closeToast();
            throw new Error((await res.json().catch(() => ({}))).error || `Download failed (${res.status})`);
          }
          await BW.extensions.install(new File([await res.arrayBuffer()], `${UBOL_ID}.crx`));
          closeToast();
        } else if (ubol) {
          await BW.extensions.setEnabled(UBOL_ID, v);
        }
        BW.toast(`uBlock Origin ${v ? 'on' : 'off'}.`, v ? 'success' : 'info');
      } catch (e) {
        BW.toast(`Couldn't enable uBlock Origin: ${esc(e.message)}`, 'error', 6000);
      }
      render('extensions');
    }));
    const ublockRow = row(sec, 'uBlock Origin', `uBlock Origin Lite${ubol ? ` v${esc(ubol.manifest.version)}` : ''} by Raymond Hill, installed from the Chrome Web Store. Network blocking uses its full uBlock, EasyList and EasyPrivacy filter lists.`, controls);
    ublockRow.querySelector('.setting-title').insertAdjacentHTML('afterbegin', '<img class="ext-icon" src="https://www.google.com/s2/favicons?sz=32&domain=ublockorigin.com" alt="">');

    const statsEl = document.createElement('p');
    statsEl.className = 'section-note blocked-stats';
    const fmt = (st) => {
      const shield = st.bySource.blackwaves || 0;
      const ub = st.bySource[UBOL_ID] || 0;
      return `<i class="fa-solid fa-ban"></i> ${st.total.toLocaleString()} request${st.total === 1 ? '' : 's'} blocked this session${st.total ? ` (Shield ${shield.toLocaleString()}, uBlock ${ub.toLocaleString()})` : ''}`;
    };
    statsEl.innerHTML = fmt(BW.filters.stats());
    sec.appendChild(statsEl);
    unsubscribeStats = BW.filters.onStats((st) => (statsEl.innerHTML = fmt(st)));
  }

  /* Chrome Web Store search: results come from /api/cws/search, installs download the .crx via /api/cws/crx/<id>. */
  let storeQuery = '';
  let storeResults = null;
  function renderStoreSearch() {
    const sec = section('Chrome Web Store', 'Search the store and install with one click. You can also paste a store link or extension id.');
    const form = document.createElement('form');
    form.className = 'store-search';
    form.innerHTML = `<i class="fa-brands fa-chrome"></i><input class="bw-input" placeholder="Search extensions, e.g. Dark Reader" value="${esc(storeQuery)}" autocomplete="off" spellcheck="false"><button class="bw-btn primary small" type="submit">Search</button>`;
    const results = document.createElement('div');
    results.className = 'store-results';
    sec.append(form, results);

    const fmtUsers = (n) => (n == null ? '' : n >= 1e6 ? `${(n / 1e6).toFixed(n >= 1e7 ? 0 : 1)}M users` : n >= 1e3 ? `${Math.round(n / 1e3)}K users` : `${n} users`);
    const installedIds = () => new Set(BW.extensions.list().map((r) => r.id));

    function show(items) {
      const installed = installedIds();
      if (!items.length) {
        results.innerHTML = '<p class="empty-note">No extensions found.</p>';
        return;
      }
      results.innerHTML = items
        .map((it) => `<div class="store-item">
          ${it.icon ? `<img src="${esc(it.icon)}=s64" alt="" loading="lazy" referrerpolicy="no-referrer">` : '<i class="fa-solid fa-puzzle-piece store-icon"></i>'}
          <div class="store-text">
            <div class="store-name">${esc(it.name || it.id)}</div>
            <div class="store-meta">${it.rating ? `<span><i class="fa-solid fa-star"></i> ${it.rating}</span>` : ''}${it.users != null ? `<span>${fmtUsers(it.users)}</span>` : ''}</div>
            ${it.description ? `<div class="store-desc">${esc(it.description)}</div>` : ''}
          </div>
          ${installed.has(it.id) ? '<button class="bw-btn small" disabled><i class="fa-solid fa-check"></i> Installed</button>' : `<button class="bw-btn primary small" data-install="${esc(it.id)}" data-name="${esc(it.name || it.id)}"><i class="fa-solid fa-download"></i> Install</button>`}
        </div>`)
        .join('');
    }

    async function search(q) {
      storeQuery = q;
      const id = (q.match(/\b([a-p]{32})\b/) || [])[1];
      if (id) {
        storeResults = [{ id, name: `Extension ${id}`, icon: '', description: 'Install straight from the Chrome Web Store.' }];
        return show(storeResults);
      }
      results.innerHTML = '<p class="empty-note"><span class="tab-spinner inline"></span> Searching the Chrome Web Store...</p>';
      try {
        const res = await fetch(`/api/cws/search?q=${encodeURIComponent(q)}`);
        const data = await res.json();
        if (!res.ok) throw new Error(data.error);
        storeResults = data;
        show(data);
      } catch (e) {
        results.innerHTML = `<p class="empty-note">${esc(e.message || 'Search failed.')}</p>`;
      }
    }

    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const q = form.querySelector('input').value.trim();
      if (q) search(q);
    });

    results.addEventListener('click', async (e) => {
      const btn = e.target.closest('[data-install]');
      if (!btn) return;
      const { install: id, name } = btn.dataset;
      btn.disabled = true;
      btn.innerHTML = '<span class="tab-spinner inline"></span> Installing';
      try {
        const res = await fetch(`/api/cws/crx/${id}`);
        if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || `Download failed (${res.status})`);
        const rec = await BW.extensions.install(new File([await res.arrayBuffer()], `${id}.crx`));
        BW.toast(`Installed ${esc(rec.manifest.name)}.`, 'success');
        render('extensions');
      } catch (err) {
        btn.disabled = false;
        btn.innerHTML = '<i class="fa-solid fa-download"></i> Install';
        BW.toast(`Couldn't install ${esc(name)}: ${esc(err.message)}`, 'error', 6000);
      }
    });

    if (storeResults) show(storeResults);
  }

  /* ---------------- Advanced ---------------- */
  function renderAdvanced() {
    const engine = section('Proxy engine', 'Changes here reload the page.');
    const protoOptions = [
      { value: 'scramjet', label: 'Scramjet (latest)', hint: '2.0.67-alpha.2' },
      { value: 'scramjet-legacy', label: 'Scramjet 1.1.0', hint: 'stable' },
      { value: 'uv', label: 'Ultraviolet', hint: 'unstable' },
    ];
    const uvNotice = document.createElement('div');
    uvNotice.className = 'notice warning';
    uvNotice.innerHTML = '<i class="fa-solid fa-triangle-exclamation"></i><span><b>Ultraviolet is unstable.</b> It is no longer actively maintained and many modern sites break or load slowly. Use it only if a site fails on both Scramjet versions.</span>';
    uvNotice.hidden = S.get('protocol') !== 'uv';
    row(engine, 'Protocol', 'The proxy engine that rewrites and loads pages.', dropdownEl(protoOptions, S.get('protocol'), (v) => {
      S.set('protocol', v);
      uvNotice.hidden = v !== 'uv';
      needsReload('Protocol');
    }), { tag: { text: BW.PROTOCOLS[BW.proxy.protocol].short + ' active' } });
    engine.appendChild(uvNotice);
    row(engine, 'Transport', 'How encrypted traffic leaves your browser. Epoxy is faster, Libcurl is more compatible.', dropdownEl(
      [{ value: 'epoxy', label: 'Epoxy' }, { value: 'libcurl', label: 'Libcurl' }],
      S.get('transport'),
      (v) => {
        S.set('transport', v);
        needsReload('Transport');
      }
    ));
    const wisp = input(S.get('wispUrl') || BW.defaultWisp(), BW.defaultWisp(), (v) => {
      try {
        const u = new URL(v);
        if (!/^wss?:$/.test(u.protocol)) throw 0;
      } catch {
        return BW.toast('Enter a valid ws:// or wss:// URL.', 'error');
      }
      S.set('wispUrl', v === BW.defaultWisp() ? '' : v.endsWith('/') ? v : `${v}/`);
      needsReload('Wisp server');
    });
    wisp.appendChild(button('Reset', () => {
      S.set('wispUrl', '');
      wisp.querySelector('input').value = BW.defaultWisp();
      needsReload('Wisp server');
    }, 'small ghost'));
    row(engine, 'Wisp server', 'Keep the default unless you run your own.', wisp, { stack: true });

    const perf = section('Performance & privacy');
    row(perf, 'Pre-load search engine', 'Warm up your search engine in the background so the first search opens faster.', toggleSetting('preloadSearch'));
    const historyBox = document.createElement('div');
    historyBox.className = 'history-box';
    const renderHistory = () => {
      const items = BW.history.list();
      historyBox.innerHTML = items.length
        ? `<div class="history-list">${items.slice(0, 60).map((h) => `<button class="history-item" data-url="${esc(h.url)}"><span class="h-title">${esc(h.title)}</span><span class="h-url">${esc(h.url)}</span><span class="h-time">${new Date(h.time).toLocaleString()}</span></button>`).join('')}</div>`
        : '<p class="empty-note">No history yet.</p>';
    };
    historyBox.addEventListener('click', (e) => {
      const item = e.target.closest('.history-item');
      if (!item) return;
      close();
      BW.app.go(item.dataset.url);
    });
    row(perf, 'Save browsing history', 'Keeps a local list of pages you visit. Stored only in this browser.', [
      button('Clear', () => {
        BW.history.clear();
        renderHistory();
        BW.toast('History cleared.', 'success');
      }, 'small ghost'),
      toggleSetting('saveHistory', 'History saving on.', 'History saving off.'),
    ]);
    renderHistory();
    perf.appendChild(historyBox);

    const danger = section('Reset');
    row(danger, 'Reset all settings', 'Restore every setting to its default and clear history.', button('Reset', () => {
      if (!confirm('reset all blackwaves settings?')) return;
      S.reset();
      location.reload();
    }, 'danger'));

  }

  /* ---------------- Cloud Sync ---------------- */
  let unsubscribeSync = null;
  function timeAgo(t) {
    if (!t) return 'never';
    const s = Math.round((Date.now() - t) / 1000);
    if (s < 10) return 'just now';
    if (s < 60) return `${s}s ago`;
    if (s < 3600) return `${Math.round(s / 60)} min ago`;
    if (s < 86400) return `${Math.round(s / 3600)} h ago`;
    return new Date(t).toLocaleString();
  }

  function renderSync() {
    const st = BW.sync.status();
    const what = '<ul class="sync-list"><li><i class="fa-solid fa-palette"></i>Theme, motion &amp; seasonal look</li><li><i class="fa-solid fa-sliders"></i>Every setting, incl. cloaking &amp; engine</li><li><i class="fa-solid fa-clock-rotate-left"></i>Recent history</li><li><i class="fa-solid fa-table-columns"></i>Open tabs</li><li><i class="fa-solid fa-puzzle-piece"></i>Chrome Web Store extensions</li><li><i class="fa-solid fa-user"></i>Your name</li></ul>';

    if (!st.signedIn) {
      const sec = section('Cloud Sync', 'Sign in on any device to bring all your blackwaves stuff with you. Accounts live on this blackwaves server only, and synced data is stored encrypted.');
      sec.insertAdjacentHTML('beforeend', what);
      const form = document.createElement('form');
      form.className = 'sync-form';
      form.innerHTML = `<input class="bw-input" name="username" placeholder="Username" autocomplete="username" maxlength="24" spellcheck="false">
        <input class="bw-input" name="password" type="password" placeholder="Password (8+ characters for new accounts)" autocomplete="current-password">
        <p class="sync-error" hidden></p>
        <div class="sync-actions"><button class="bw-btn primary" data-mode="login" type="submit"><i class="fa-solid fa-right-to-bracket"></i> Sign in</button><button class="bw-btn" data-mode="register" type="button"><i class="fa-solid fa-user-plus"></i> Create account</button></div>`;
      const err = form.querySelector('.sync-error');
      const submit = async (create) => {
        const username = form.username.value.trim();
        const password = form.password.value;
        err.hidden = true;
        form.querySelectorAll('button').forEach((b) => (b.disabled = true));
        try {
          await BW.sync.signIn(username, password, create);
          render('sync');
        } catch (e) {
          err.textContent = e.message;
          err.hidden = false;
          form.querySelectorAll('button').forEach((b) => (b.disabled = false));
        }
      };
      form.addEventListener('submit', (e) => {
        e.preventDefault();
        submit(false);
      });
      form.querySelector('[data-mode="register"]').addEventListener('click', () => submit(true));
      sec.appendChild(form);
      return;
    }

    const acct = section('Account');
    const statusText = () => {
      const s = BW.sync.status();
      if (s.syncing) return '<span class="sync-dot busy"></span>Syncing...';
      if (s.error) return `<span class="sync-dot error"></span>${esc(s.error)}`;
      if (s.dirty) return '<span class="sync-dot busy"></span>Changes waiting to sync';
      return `<span class="sync-dot ok"></span>Synced ${timeAgo(s.lastSync)}`;
    };
    const statusRow = row(acct, `Signed in as ${st.username}`, statusText(), [
      button('<i class="fa-solid fa-rotate"></i> Sync now', () => BW.sync.syncNow(), 'small'),
      button('Sign out', async () => {
        await BW.sync.signOut();
        BW.toast('Signed out. Everything stays on this device.', 'info');
        render('sync');
      }, 'small ghost'),
    ]);
    row(acct, 'Sign out everywhere', 'Ends every session on every device, including this one. Use it if you signed in on a computer that isn\'t yours.', [
      button('<i class="fa-solid fa-right-from-bracket"></i> Sign out everywhere', async () => {
        await BW.sync.signOut(true);
        BW.toast('Signed out on every device.', 'info');
        render('sync');
      }, 'small ghost'),
    ]);
    statusRow.querySelector('.setting-title').insertAdjacentHTML('afterbegin', '<i class="fa-solid fa-circle-user ext-icon"></i>');
    const desc = statusRow.querySelector('.setting-desc');
    unsubscribeSync = BW.sync.onStatus(() => (desc.innerHTML = statusText()));

    const info = section('What syncs', 'Changes upload a few seconds after you make them. Other devices pick them up when you switch back to them. Each account stores up to 3 KB, so history keeps the most recent sites that fit. AI chats, extension settings, unpacked extensions and userscripts stay on this device.');
    info.insertAdjacentHTML('beforeend', what);

    const danger = section('Delete account');
    const del = input('', 'Password', async (pw, field) => {
      if (!pw) return BW.toast('Enter your password to confirm.', 'warning');
      if (!confirm('delete your blackwaves cloud account and its synced data? data on this device stays.')) return;
      try {
        await BW.sync.deleteAccount(pw);
        BW.toast('Account deleted.', 'info');
        render('sync');
      } catch (e) {
        field.value = '';
        BW.toast(esc(e.message), 'error');
      }
    }, 'password');
    del.querySelector('button').textContent = 'Delete';
    del.querySelector('button').classList.add('danger');
    row(danger, 'Delete cloud account', 'Removes the account and everything stored on the server.', del);
  }

  /* ---------------- About ---------------- */
  const link = (href, text) => `<a href="${href}" target="_blank" rel="noopener">${text}</a>`;
  const PEOPLE = [
    { name: 'yaanscoat', href: 'https://github.com/yaanscoat', role: 'coding everything, owner and creator', icon: 'fa-solid fa-crown' },
    { name: 'bog', role: 'gave me the tools and info to make this website', icon: 'fa-solid fa-toolbox' },
    { name: 'claude code', href: 'https://claude.com/claude-code', role: 'legendary backend maker', icon: 'fa-solid fa-robot' },
  ];
  const SOURCES = [
    { name: 'selenite', href: 'https://selenite.cc/', what: 'game source' },
    { name: "chicken king's vault", href: 'https://github.com/gmshelf/ckv', what: 'game source' },
    { name: 'seraph', href: 'https://github.com/gmshelf/seraph', what: 'game source' },
    { name: 'ugs', href: 'https://github.com/gmshelf/ugs', what: 'game source' },
    { name: 'truffled', href: 'https://truffled.lol', what: 'game source' },
    { name: 'titanium network', href: 'https://github.com/titaniumnetwork-dev/ultraviolet/', what: 'ultraviolet' },
    { name: 'mercury workshop', href: 'https://github.com/mercuryworkshop/', what: 'scramjet, epoxy, and libcurl' },
  ];

  function renderAbout() {
    const hero = document.createElement('div');
    hero.className = 'about-hero';
    hero.innerHTML = `<img src="/favicon.ico" alt="">
      <div class="about-hero-text"><div class="about-name">blackwaves</div><div class="about-version">version ${VERSION}</div></div>
      <div class="about-links">
        ${link('https://blackwaveson.top', '<i class="fa-solid fa-globe"></i> website')}
        ${link(REPO_URL, '<i class="fa-brands fa-github"></i> github')}
        ${link(BW.DISCORD_URL, '<i class="fa-brands fa-discord"></i> discord')}
      </div>`;
    scroll.appendChild(hero);

    const people = section('Credits');
    people.insertAdjacentHTML('beforeend', `<ul class="credit-people">${PEOPLE.map((p) => `<li><i class="${p.icon}"></i><div><b>${p.href ? link(p.href, esc(p.name)) : esc(p.name)}</b><span>${esc(p.role)}</span></div></li>`).join('')}</ul>`);

    const sources = section('Games & engines');
    sources.insertAdjacentHTML('beforeend', `<ul class="credit-list">${SOURCES.map((x) => `<li>${link(x.href, esc(x.name))}<span>${esc(x.what)}</span></li>`).join('')}</ul>`);

    const thanks = section('Thanks');
    thanks.insertAdjacentHTML('beforeend', `<p class="about-text">That's it! Thanks so much for using BlackWaves!! If you have any suggestions, tweaks, issues, ideas, drop them in the ${link(BW.DISCORD_URL, 'discord server')} or open a issue on the ${link(`${REPO_URL}/issues`, 'github repository')}.</p>
      <p class="about-fine">Based on Waves by ${link('https://luy.lat', 'luyy')}. Extension engine modelled on ${link('https://github.com/x8rr/sapphire', 'Sapphire')}. Mario Gant cursors by ${link('https://www.deviantart.com/behelit/art/Mario-Gant-32008915', 'Behelit')} (CC BY-NC).</p>`);
  }

  const RENDERERS = { preferences: renderPreferences, appearance: renderAppearance, cloaking: renderCloaking, extensions: renderExtensions, advanced: renderAdvanced, sync: renderSync, about: renderAbout };

  function render(tab) {
    if (unsubscribeSync) unsubscribeSync();
    unsubscribeSync = null;
    if (unsubscribeStats) unsubscribeStats();
    unsubscribeStats = null;
    current = tab;
    heading.textContent = TABS.find((t) => t.id === tab).name;
    overlay.querySelectorAll('.settings-tab').forEach((b) => b.classList.toggle('active', b.dataset.tab === tab));
    scroll.innerHTML = '';
    scroll.scrollTop = 0;
    RENDERERS[tab]();
  }

  function open(tab) {
    render(tab || current);
    overlay.hidden = false;
    requestAnimationFrame(() => overlay.classList.add('visible'));
  }

  function close() {
    overlay.classList.remove('visible');
    setTimeout(() => (overlay.hidden = true), 150);
  }

  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) close();
    const tab = e.target.closest('.settings-tab');
    if (tab) render(tab.dataset.tab);
  });
  document.getElementById('settings-close').addEventListener('click', close);
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !overlay.hidden && !document.querySelector('.bw-dropdown.open')) close();
  });
  document.getElementById('settings-open').addEventListener('click', () => open());

  BW.settingsUI = { open, close };
})();
