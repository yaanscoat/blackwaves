/*
 * Startup splash. The blackwaves icon sits in the middle of the screen while three jobs run:
 *   browser  the service worker + proxy engine (BW.proxy.ready)
 *   games    the game catalog for the chosen source, so the games page opens instantly
 *   sync     a cloud sync check, when signed in
 * Then the icon flies up into the top bar and the splash fades away. It never waits longer than
 * MAX_WAIT; anything still running finishes in the background.
 * BW.splash.done resolves once the splash is gone.
 */
(function () {
  const MIN_SHOW = 900;
  const MAX_WAIT = 8000;
  const splash = document.getElementById('splash');
  const shownAt = performance.now();
  let finish;
  const done = new Promise((resolve) => (finish = resolve));
  BW.splash = { done };
  if (!splash) return finish();

  const ICONS = { busy: '<span class="splash-spinner"></span>', done: '<i class="fa-solid fa-check"></i>', skip: '<i class="fa-solid fa-minus"></i>', warn: '<i class="fa-solid fa-triangle-exclamation"></i>' };
  const bar = splash.querySelector('.splash-bar span');
  let settled = 0;

  function setStep(id, state, text) {
    const el = splash.querySelector(`[data-step="${id}"]`);
    el.dataset.state = state;
    el.querySelector('.st').innerHTML = ICONS[state];
    if (text) el.querySelector('.label').textContent = text;
    if (state !== 'busy') bar.style.width = `${(++settled / 3) * 100}%`;
  }

  const timeout = (promise, ms) => Promise.race([promise, new Promise((_, reject) => setTimeout(() => reject(new Error('timed out')), ms))]);

  // The custom busy cursor is an animated .ani in the original set; play its frames while we wait.
  let cursorTimer = null;
  if (document.documentElement.dataset.cursor === 'custom') {
    const frames = [...Array(8)].map((_, i) => {
      const src = `/assets/cur/busy-${i}.png`;
      new Image().src = src;
      return `url("${src}") 0 0, wait`;
    });
    let f = 0;
    cursorTimer = setInterval(() => (splash.style.cursor = frames[(f = (f + 1) % frames.length)]), 167);
  }

  async function run() {
    setStep('browser', 'busy');
    setStep('games', 'busy');
    setStep('sync', 'busy');

    const browser = timeout(BW.proxy.ready, MAX_WAIT).then(
      () => setStep('browser', 'done', 'browser ready'),
      () => setStep('browser', 'warn', 'browser still starting')
    );
    const games = timeout(BW.loader.loadGames(BW.settings.get('gameSource') || 'all'), MAX_WAIT).then(
      ({ games }) => setStep('games', games.length ? 'done' : 'warn', games.length ? `${games.length.toLocaleString()} games loaded` : 'games unavailable right now'),
      () => setStep('games', 'warn', 'games still loading')
    );
    const sync = BW.sync.status().signedIn
      ? timeout(BW.sync.ready, MAX_WAIT).then(
          () => {
            const s = BW.sync.status();
            if (!s.signedIn) setStep('sync', 'warn', 'signed out of cloud sync');
            else if (s.error) setStep('sync', 'warn', 'cloud sync will retry');
            else setStep('sync', 'done', 'cloud sync up to date');
          },
          () => setStep('sync', 'warn', 'cloud sync still checking')
        )
      : Promise.resolve(setStep('sync', 'skip', 'cloud sync off'));

    await Promise.all([browser, games, sync]);
    const wait = MIN_SHOW - (performance.now() - shownAt);
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    leave();
  }

  function leave() {
    clearInterval(cursorTimer);
    const motion = document.documentElement.dataset.motion;
    const remove = () => {
      splash.remove();
      brand && (brand.style.visibility = '');
      finish();
    };
    const brand = document.querySelector('#top-bar:not([hidden]) .brand-icon');
    if (motion === 'off') return remove();

    const fadeMs = motion === 'full' ? 650 : 220;
    splash.classList.add('leaving');
    splash.animate([{ backgroundColor: getComputedStyle(splash).backgroundColor }, { backgroundColor: 'transparent' }], { duration: fadeMs, easing: 'ease', fill: 'forwards' });
    splash.querySelector('.splash-status').animate([{ opacity: 1 }, { opacity: 0 }], { duration: fadeMs / 2, fill: 'forwards' });

    const logo = splash.querySelector('.splash-logo img');
    const from = logo.getBoundingClientRect();
    const to = brand && brand.getBoundingClientRect();
    if (motion === 'full' && to && to.width) {
      // fly the icon into its spot in the top bar
      brand.style.visibility = 'hidden';
      splash.querySelector('.splash-logo').classList.add('flying');
      const dx = to.left + to.width / 2 - (from.left + from.width / 2);
      const dy = to.top + to.height / 2 - (from.top + from.height / 2);
      logo
        .animate([{ transform: 'none' }, { transform: `translate(${dx}px, ${dy}px) scale(${to.width / from.width})` }], { duration: fadeMs, easing: 'cubic-bezier(.65,0,.25,1)', fill: 'forwards' })
        .finished.then(remove, remove);
    } else {
      splash.animate([{ opacity: 1 }, { opacity: 0 }], { duration: fadeMs, fill: 'forwards' }).finished.then(remove, remove);
    }
  }

  // Everything else is loaded by the time the DOM is ready (scripts sit at the end of <body>).
  const start = () => run().catch((err) => {
    console.warn('[splash]', err);
    leave();
  });
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true });
  else start();
})();
