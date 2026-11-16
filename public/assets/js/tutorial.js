/* First-run welcome tutorial. */
(function () {
  const S = BW.settings;
  const root = document.getElementById('tutorial-root');
  let step = 0;

  const STEPS = [
    {
      icon: 'fa-solid fa-water',
      title: 'Welcome to blackwaves',
      body: () => `<p>A fast, private way to browse, play and watch. This takes about 30 seconds.</p>`,
    },
    {
      icon: 'fa-solid fa-hand-sparkles',
      title: 'What should we call you?',
      body: () => `<p>Your name is only stored in this browser.</p><input class="bw-input tut-name" id="tut-name" placeholder="Your name" maxlength="32" autocomplete="off" value="${BW.esc(S.get('userName'))}">`,
      onLeave: () => {
        const v = document.getElementById('tut-name').value.trim();
        if (v) S.set('userName', v);
      },
    },
    {
      icon: 'fa-solid fa-palette',
      title: 'Pick a look',
      body: () => `<p>You can change this any time in Settings &gt; Appearance.</p><div class="tut-themes">${BW.THEMES.map((t) => `<button class="tut-swatch${S.get('theme') === t.id ? ' active' : ''}" data-theme-id="${t.id}" title="${BW.esc(t.name)}" style="--a:${t.colors[0]};--b:${t.colors[2]}"></button>`).join('')}</div>`,
    },
    {
      icon: 'fa-solid fa-magnifying-glass',
      title: 'Search anything',
      body: () => `<ul class="tut-list">
        <li><i class="fa-solid fa-globe"></i><span>Type a search or a URL in the bar. Pages open in <b>vertical tabs</b> through ${BW.esc(BW.PROTOCOLS[BW.proxy.protocol].name)}. <b>Alt+T</b> opens a new tab.</span></li>
        <li><i class="fa-solid fa-gamepad"></i><span><b>Games</b> pulls from Selenite, Truffled, Seraph, UGS and CKV.</span></li>
        <li><i class="fa-solid fa-film"></i><span><b>Movies</b> opens blackwaves movies.</span></li>
        <li><i class="fa-solid fa-puzzle-piece"></i><span>Add <b>extensions</b> and userscripts in Settings.</span></li>
        <li><i class="fa-solid fa-cloud"></i><span><b>Cloud Sync</b> carries your themes, history, tabs and extensions to any device.</span></li></ul>`,
    },
    {
      icon: 'fa-solid fa-user-secret',
      title: 'Stay low-key',
      body: () => `<p>Disguise the tab as Google Classroom, Docs or 40 other sites, and launch inside about:blank so nothing shows up in history.</p>
        <label class="tut-check"><span>Disguise this tab as Google Classroom</span></label>`,
      mount: (el) => {
        const label = el.querySelector('.tut-check');
        label.appendChild(BW.toggle(S.get('cloakPreset') !== 'none', (v) => S.set('cloakPreset', v ? 'classroom' : 'none')));
      },
    },
    {
      icon: 'fa-solid fa-circle-check',
      title: "You're all set",
      body: () => `<p>${S.get('userName') ? `Enjoy, ${BW.esc(S.get('userName'))}!` : 'Enjoy!'} Settings live behind the <i class="fa-solid fa-gear"></i> in the top bar.</p><a class="bw-btn tut-discord" href="${BW.DISCORD_URL}" target="_blank" rel="noopener"><i class="fa-brands fa-discord"></i> Join the Discord</a>`,
    },
  ];

  function render() {
    const s = STEPS[step];
    root.innerHTML = `<div class="tutorial-overlay visible"><div class="tutorial-card" role="dialog" aria-modal="true">
      <button class="tut-skip" data-act="skip">Skip</button>
      <div class="tut-icon"><i class="${s.icon}"></i></div>
      <h2>${s.title}</h2>
      <div class="tut-body">${s.body()}</div>
      <div class="tut-footer">
        <div class="tut-dots">${STEPS.map((_, i) => `<span class="${i === step ? 'active' : ''}"></span>`).join('')}</div>
        <div class="tut-actions">${step > 0 ? '<button class="bw-btn ghost" data-act="back">Back</button>' : ''}<button class="bw-btn primary" data-act="next">${step === STEPS.length - 1 ? 'Start browsing' : 'Next'}</button></div>
      </div></div></div>`;
    const card = root.querySelector('.tutorial-card');
    if (s.mount) s.mount(card);
    const nameInput = card.querySelector('#tut-name');
    if (nameInput) {
      nameInput.focus();
      nameInput.addEventListener('keydown', (e) => e.key === 'Enter' && go(1));
    }
  }

  function go(delta) {
    const s = STEPS[step];
    if (s.onLeave) s.onLeave();
    step += delta;
    if (step >= STEPS.length) return finish();
    render();
  }

  function finish() {
    const s = STEPS[step];
    if (s && s.onLeave) s.onLeave();
    S.set('tutorialDone', true);
    root.innerHTML = '';
    BW.app && BW.app.updateGreeting();
    const name = S.get('userName');
    BW.toast(name ? `Welcome aboard, ${BW.esc(name)}!` : 'Welcome aboard!', 'success');
  }

  root.addEventListener('click', (e) => {
    const swatch = e.target.closest('.tut-swatch');
    if (swatch) {
      S.set('theme', swatch.dataset.themeId);
      root.querySelectorAll('.tut-swatch').forEach((b) => b.classList.toggle('active', b === swatch));
      return;
    }
    const act = e.target.closest('[data-act]')?.dataset.act;
    if (act === 'next') go(1);
    else if (act === 'back') go(-1);
    else if (act === 'skip') finish();
  });

  BW.tutorial = {
    start() {
      step = 0;
      render();
    },
  };

  if (!S.get('tutorialDone')) {
    // Users coming from Waves already have a name stored
    try {
      const legacy = localStorage.getItem('userName');
      if (legacy && !S.get('userName')) S.set('userName', legacy);
    } catch {}
    BW.tutorial.start();
  }
})();
