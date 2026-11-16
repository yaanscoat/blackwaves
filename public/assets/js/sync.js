/*
 * Cloud sync client. Signs in to the blackwaves server and keeps one snapshot per account:
 * every setting (theme, cloak, search engine...), browsing history, the open tab session and
 * installed extensions with their storage.
 *
 * Changes push ~2.5s after they happen. Other devices notice on focus / every minute and pull.
 * Last write wins.
 */
(function () {
  const KEY = 'bw:sync';
  const RELOAD_KEYS = ['protocol', 'transport', 'wispUrl'];
  const listeners = new Set();

  let state = read();
  let applying = false;
  let dirty = false;
  let pushTimer = null;
  let chain = Promise.resolve();
  let syncing = false;
  let lastError = '';
  let warnedSkipped = '';

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

  function status() {
    return { signedIn: !!state.token, username: state.username || '', lastSync: state.lastSync || 0, syncing, error: lastError, dirty };
  }

  async function request(method, path, body) {
    const headers = { 'Content-Type': 'application/json' };
    if (state.token) headers.Authorization = `Bearer ${state.token}`;
    const res = await fetch(`/api/sync${path}`, { method, headers, body: body ? JSON.stringify(body) : undefined, cache: 'no-store' });
    let data = {};
    try {
      data = await res.json();
    } catch {}
    if (res.status === 401 && state.token && !['/login', '/register', '/account'].includes(path)) {
      state = {};
      save();
      notify();
      BW.toast(BW.esc(data.error || 'Signed out of cloud sync.'), 'warning');
    }
    if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
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

  async function collect() {
    const { extensions, skipped } = await BW.extensions.exportAll();
    if (skipped.length && skipped.join() !== warnedSkipped) {
      warnedSkipped = skipped.join();
      BW.toast(`Not synced (over 3 MB): ${BW.esc(skipped.join(', '))}`, 'warning', 6000);
    }
    return {
      version: 1,
      device: navigator.userAgent.slice(0, 120),
      settings: BW.settings.all(),
      history: BW.history.list(),
      tabs: BW.tabs.readSession(),
      aiChats: BW.ai.exportChats(),
      extensions,
    };
  }

  async function apply(data) {
    applying = true;
    let needsReload = false;
    try {
      for (const [key, value] of Object.entries(data.settings || {})) {
        if (!(key in BW.settings.DEFAULTS)) continue;
        if (JSON.stringify(BW.settings.get(key)) === JSON.stringify(value)) continue;
        if (RELOAD_KEYS.includes(key)) needsReload = true;
        BW.settings.set(key, value);
      }
      if (Array.isArray(data.history)) BW.history.replace(data.history, true);
      if (data.tabs && Array.isArray(data.tabs.tabs)) {
        try {
          localStorage.setItem('bw:tabs', JSON.stringify(data.tabs));
        } catch {}
        BW.tabs.updateResume();
      }
      if (Array.isArray(data.aiChats)) BW.ai.importChats(data.aiChats);
      if (Array.isArray(data.extensions)) await BW.extensions.importAll(data.extensions);
      BW.app && BW.app.updateGreeting();
    } finally {
      applying = false;
    }
    if (needsReload) BW.toast('Synced engine settings changed. <button class="toast-action" onclick="location.reload()">Reload now</button>', 'info', 9000);
  }

  async function push() {
    if (!state.token) return;
    dirty = false;
    const data = await collect();
    const res = await request('PUT', '', { data });
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
    if (!state.token) return;
    const meta = await request('GET', '/meta');
    if (meta.updatedAt > (state.lastSync || 0)) await pull();
    else if (dirty) await push();
  }

  function schedule() {
    if (applying || !state.token) return;
    dirty = true;
    notify();
    clearTimeout(pushTimer);
    pushTimer = setTimeout(() => run(push), 2500);
  }

  async function signIn(username, password, create) {
    const res = await request('POST', create ? '/register' : '/login', { username, password });
    state = { token: res.token, username: res.username, lastSync: 0 };
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

  async function signOut() {
    try {
      await request('POST', '/logout');
    } catch {}
    clearTimeout(pushTimer);
    state = {};
    dirty = false;
    save();
    notify();
  }

  async function deleteAccount(password) {
    await request('DELETE', '/account', { password });
    state = {};
    save();
    notify();
  }

  BW.onChange(() => schedule());
  window.addEventListener('focus', () => state.token && run(check));
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && state.token) run(check);
    else if (document.hidden && dirty && state.token) {
      clearTimeout(pushTimer);
      run(push);
    }
  });
  setInterval(() => {
    if (state.token && !document.hidden) run(check);
  }, 60000);
  if (state.token) BW.extensions.ready.then(() => run(check));

  BW.sync = {
    status,
    signIn,
    signOut,
    deleteAccount,
    syncNow: () => run(async () => {
      await check();
      if (!dirty) await push();
    }),
    onStatus: (fn) => {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
  };
})();
