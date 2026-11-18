/*
 * Cloud sync client. Signs in to the blackwaves server and keeps one small snapshot per account
 * (3 KB of JSON max, stored encrypted): changed settings, Chrome Web Store extensions, open tabs
 * and as much recent history as fits.
 *
 * The session is an HttpOnly cookie, so no script on this origin (proxied sites included) can
 * read it. Changes push ~2.5s after they happen. Other devices notice on focus / every minute and
 * pull. Last write wins, except history, which merges.
 */
(function () {
  const KEY = 'bw:sync';
  const CLEARED_KEY = 'bw:historyCleared';
  const LIMIT = 3 * 1024; // bytes, matches the server
  const RELOAD_KEYS = ['protocol', 'transport', 'wispUrl'];
  const listeners = new Set();

  let state = read();
  let applying = false;
  let dirty = false;
  let pushTimer = null;
  let chain = Promise.resolve();
  let syncing = false;
  let lastError = '';

  function read() {
    try {
      return JSON.parse(localStorage.getItem(KEY)) || {};
    } catch {
      return {};
    }
  }
  function save() {
    try {
      localStorage.setItem(KEY, JSON.stringify(state));
    } catch {}
  }
  const notify = () => listeners.forEach((fn) => fn(status()));
  const signedIn = () => !!state.username;

  function status() {
    return { signedIn: signedIn(), username: state.username || '', lastSync: state.lastSync || 0, syncing, error: lastError, dirty };
  }

  function signedOutHere() {
    clearTimeout(pushTimer);
    state = {};
    dirty = false;
    save();
    notify();
  }

  async function request(method, path, body) {
    const headers = { 'Content-Type': 'application/json', 'X-BW-Sync': '1' };
    // older versions kept the token in localStorage; send it once so the server moves it to a cookie
    if (state.token) headers.Authorization = `Bearer ${state.token}`;
    const res = await fetch(`/api/sync${path}`, { method, headers, body: body ? JSON.stringify(body) : undefined, cache: 'no-store', credentials: 'same-origin' });
    let data = {};
    try {
      data = await res.json();
    } catch {}
    if (res.status === 401 && signedIn() && !['/login', '/register', '/account'].includes(path)) {
      signedOutHere();
      BW.toast(BW.esc(data.error || 'Signed out of cloud sync.'), 'warning');
    }
    if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
    if (state.token) {
      delete state.token;
      save();
    }
    return data;
  }

  // Run sync jobs one at a time.
  function run(job) {
    chain = chain.then(async () => {
      syncing = true;
      notify();
      try {
        await job();
        lastError = '';
      } catch (err) {
        lastError = err.message;
        console.warn('[sync]', err);
      } finally {
        syncing = false;
        notify();
      }
    });
    return chain;
  }

  /* ---------------- Snapshot (3 KB) ---------------- */
  const size = (v) => new TextEncoder().encode(JSON.stringify(v)).length;
  const short = (s, n) => (s && s.length > n ? `${s.slice(0, n - 1)}…` : s || '');
  const historyCleared = () => +localStorage.getItem(CLEARED_KEY) || 0;

  /**
   * Compact snapshot, filled by priority until it hits 3 KB:
   *   s  settings that differ from the defaults
   *   x  Chrome Web Store extensions, [[id, enabled]]
   *   t  open tabs, { a: active index, u: [[url, title]] }
   *   h  recent history, [[url, title, seconds]], newest first; hc = when history was last cleared
   */
  function collect() {
    const s = {};
    const defaults = BW.settings.DEFAULTS;
    for (const [k, v] of Object.entries(BW.settings.all())) {
      if (!(k in defaults) || JSON.stringify(v) === JSON.stringify(defaults[k])) continue;
      if (typeof v === 'string' && v.length > 400) continue; // e.g. a custom tab icon uploaded as a data: URL
      s[k] = v;
    }
    const data = { v: 2, s, x: BW.extensions.syncList(), hc: historyCleared(), t: { a: 0, u: [] }, h: [] };

    const session = BW.tabs.readSession();
    if (session) {
      data.t.a = session.active || 0;
      for (const t of session.tabs) {
        if (t.url.length > 300) continue;
        data.t.u.push([t.url, short(t.title, 40)]);
        if (size(data) > LIMIT) {
          data.t.u.pop();
          break;
        }
      }
    }
    for (const h of BW.history.list()) {
      if (h.url.length > 200) continue;
      data.h.push([h.url, short(h.title === h.url ? '' : h.title, 40), Math.floor(h.time / 1000)]);
      if (size(data) > LIMIT) {
        data.h.pop();
        break;
      }
    }
    return data;
  }

  function mergeHistory(incoming, clearedAt) {
    if (clearedAt > historyCleared()) {
      try {
        localStorage.setItem(CLEARED_KEY, String(clearedAt));
      } catch {}
    }
    const since = Math.max(clearedAt, historyCleared());
    const byUrl = new Map();
    const remote = incoming.filter((h) => Array.isArray(h) && typeof h[0] === 'string').map(([url, title, t]) => ({ url, title: title || url, time: t * 1000 }));
    // one entry per URL, the newest visit wins (synced times are floored, so local copies win ties)
    for (const h of [...BW.history.list(), ...remote]) {
      const prev = byUrl.get(h.url);
      if (h.time <= since || (prev && prev.time >= h.time)) continue;
      if (prev && h.title === h.url) h.title = prev.title;
      byUrl.set(h.url, h);
    }
    BW.history.replace([...byUrl.values()].sort((a, b) => b.time - a.time), true);
  }

  async function apply(data) {
    if (!data || data.v !== 2) return; // snapshots from older versions are ignored and replaced
    applying = true;
    let needsReload = false;
    try {
      const incoming = data.s || {};
      for (const key of Object.keys(BW.settings.DEFAULTS)) {
        const value = key in incoming ? incoming[key] : BW.settings.DEFAULTS[key];
        if (key === 'cloakIcon' && !(key in incoming) && String(BW.settings.get(key)).length > 400) continue; // never synced
        if (JSON.stringify(BW.settings.get(key)) === JSON.stringify(value)) continue;
        if (RELOAD_KEYS.includes(key)) needsReload = true;
        BW.settings.set(key, value);
      }
      if (Array.isArray(data.h)) mergeHistory(data.h, +data.hc || 0);
      if (data.t && Array.isArray(data.t.u)) {
        try {
          localStorage.setItem('bw:tabs', JSON.stringify({ tabs: data.t.u.map(([url, title]) => ({ url, title })), active: data.t.a || 0 }));
        } catch {}
        BW.tabs.updateResume();
      }
      if (Array.isArray(data.x)) {
        const failed = await BW.extensions.applySyncList(data.x);
        if (failed.length) BW.toast(`Couldn't install ${failed.length} synced extension${failed.length === 1 ? '' : 's'} from the Chrome Web Store.`, 'warning', 6000);
      }
      BW.app && BW.app.updateGreeting();
    } finally {
      applying = false;
    }
    if (needsReload) BW.toast('Synced engine settings changed. <button class="toast-action" onclick="location.reload()">Reload now</button>', 'info', 9000);
  }

  /* ---------------- Push / pull ---------------- */
  async function push() {
    if (!signedIn()) return;
    dirty = false;
    const res = await request('PUT', '', { data: collect() });
    state.lastSync = res.updatedAt;
    save();
  }

  async function pull() {
    const res = await request('GET', '');
    if (res.data) await apply(res.data);
    state.lastSync = res.updatedAt || Date.now();
    dirty = false;
    save();
  }

  /** Pull if another device pushed since we last synced, otherwise push pending changes. */
  async function check() {
    if (!signedIn()) return;
    const meta = await request('GET', '/meta');
    if (meta.updatedAt > (state.lastSync || 0)) await pull();
    else if (dirty) await push();
  }

  function schedule() {
    if (applying || !signedIn()) return;
    dirty = true;
    notify();
    clearTimeout(pushTimer);
    pushTimer = setTimeout(() => run(push), 2500);
  }

  async function signIn(username, password, create) {
    const res = await request('POST', create ? '/register' : '/login', { username, password });
    state = { username: res.username, lastSync: 0 };
    save();
    notify();
    if (res.updatedAt > 0) {
      await run(pull);
      if (lastError) throw new Error(lastError);
      BW.toast(`Signed in as ${BW.esc(res.username)}. Your stuff was synced from the cloud.`, 'success');
    } else {
      await run(push);
      if (lastError) throw new Error(lastError);
      BW.toast(`${create ? 'Account created' : 'Signed in'}. This device is now backed up.`, 'success');
    }
  }

  async function signOut(everywhere) {
    try {
      await request('POST', everywhere ? '/logout-all' : '/logout');
    } catch {}
    signedOutHere();
  }

  async function deleteAccount(password) {
    await request('DELETE', '/account', { password });
    signedOutHere();
  }

  BW.onChange((what) => {
    if (what === 'history' && !BW.history.list().length) {
      try {
        localStorage.setItem(CLEARED_KEY, String(Date.now()));
      } catch {}
    }
    schedule();
  });
  window.addEventListener('focus', () => signedIn() && run(check));
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && signedIn()) run(check);
    else if (document.hidden && dirty && signedIn()) {
      clearTimeout(pushTimer);
      run(push);
    }
  });
  setInterval(() => {
    if (signedIn() && !document.hidden) run(check);
  }, 60000);
  // first check after load; the splash screen waits on this
  const ready = signedIn() ? BW.extensions.ready.then(() => run(check)) : Promise.resolve();

  BW.sync = {
    ready,
    status,
    signIn,
    signOut,
    deleteAccount,
    syncNow: () =>
      run(async () => {
        await check();
        if (!dirty) await push();
      }),
    onStatus: (fn) => {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
  };
})();
