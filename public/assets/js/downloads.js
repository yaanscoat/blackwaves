/*
 * Downloads. Everything a proxied site downloads is saved to the user's computer and listed in
 * the Downloads panel (tab sidebar).
 *   - Normal file downloads (attachments, zips, installers...): the browser saves them natively;
 *     the service worker reports name, size and live progress here.
 *   - blob:/data: downloads (converters, editors, "Export" buttons, FileSaver.js): every engine
 *     rewrites those URLs, which breaks them, so they are caught inside the page (see
 *     hookWindow) and saved from blackwaves itself.
 */
(function () {
  const KEY = 'bw:downloads';
  const blobs = new Map(); // id -> Blob, so in-memory files can be saved again this session
  let items = load();
  let unseen = 0;

  function load() {
    try {
      return (JSON.parse(localStorage.getItem(KEY)) || []).map((d) => (d.state === 'progress' || d.state === 'started' ? Object.assign(d, { state: 'interrupted' }) : d));
    } catch {
      return [];
    }
  }
  function save() {
    items = items.slice(0, 100);
    try {
      localStorage.setItem(KEY, JSON.stringify(items));
    } catch {}
  }

  const fmtSize = (n) => (!n ? '' : n < 1024 ? `${n} B` : n < 1048576 ? `${(n / 1024).toFixed(1)} KB` : n < 1073741824 ? `${(n / 1048576).toFixed(1)} MB` : `${(n / 1073741824).toFixed(2)} GB`);
  function iconFor(name, type) {
    const ext = (name.split('.').pop() || '').toLowerCase();
    if (/^(zip|rar|7z|gz|tgz|tar|xz|bz2|zst)$/.test(ext)) return 'fa-file-zipper';
    if (/^(png|jpe?g|gif|webp|svg|bmp|ico|avif)$/.test(ext) || /^image\//.test(type)) return 'fa-file-image';
    if (/^(mp4|webm|mkv|mov|avi)$/.test(ext) || /^video\//.test(type)) return 'fa-file-video';
    if (/^(mp3|wav|ogg|flac|m4a)$/.test(ext) || /^audio\//.test(type)) return 'fa-file-audio';
    if (ext === 'pdf') return 'fa-file-pdf';
    if (/^(docx?|odt|rtf)$/.test(ext)) return 'fa-file-word';
    if (/^(xlsx?|csv|ods)$/.test(ext)) return 'fa-file-excel';
    if (/^(exe|msi|dmg|apk|deb|rpm|appimage)$/.test(ext)) return 'fa-box-archive';
    if (/^(js|ts|py|json|html|css|java|c|cpp|rs|go|sh)$/.test(ext)) return 'fa-file-code';
    if (/^(txt|md|log)$/.test(ext)) return 'fa-file-lines';
    return 'fa-file';
  }

  /* ---------------- Panel ---------------- */
  const panel = document.getElementById('downloads-panel');
  const badge = document.getElementById('downloads-badge');

  function updateBadge() {
    const active = items.filter((d) => d.state === 'started' || d.state === 'progress').length;
    const n = active || unseen;
    badge.hidden = !n;
    badge.textContent = active ? '' : n;
    badge.classList.toggle('active', !!active);
  }

  function render() {
    updateBadge();
    if (panel.hidden) return;
    panel.innerHTML = `<div class="ext-panel-head"><i class="fa-solid fa-download"></i><span>Downloads</span>${items.length ? '<button class="dl-clear" data-dl-act="clear">Clear</button>' : ''}</div>
      <div class="dl-list">${
        items.length
          ? items
              .map((d) => {
                const pct = d.size && d.loaded ? Math.min(100, Math.round((d.loaded / d.size) * 100)) : null;
                const running = d.state === 'started' || d.state === 'progress';
                const status = running
                  ? `${fmtSize(d.loaded || 0)}${d.size ? ` of ${fmtSize(d.size)}` : ''}`
                  : d.state === 'interrupted'
                  ? 'Interrupted'
                  : `${fmtSize(d.size || d.loaded) || 'Saved'} · ${new Date(d.time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
                const again = blobs.has(d.id) || /^https?:/.test(d.url || '');
                return `<div class="dl-item${running ? ' running' : ''}">
                  <i class="fa-solid ${iconFor(d.filename, d.type || '')} dl-icon"></i>
                  <div class="dl-text"><div class="dl-name" title="${BW.esc(d.filename)}">${BW.esc(d.filename)}</div>
                    <div class="dl-status">${status}</div>
                    ${running ? `<div class="dl-bar"><span style="width:${pct == null ? 30 : pct}%" class="${pct == null ? 'indeterminate' : ''}"></span></div>` : ''}</div>
                  ${!running && again ? `<button class="icon-btn small" data-dl-act="again" data-id="${d.id}" title="Download again"><i class="fa-solid fa-rotate-right"></i></button>` : ''}
                  <button class="icon-btn small" data-dl-act="remove" data-id="${d.id}" title="Remove from list"><i class="fa-solid fa-xmark"></i></button>
                </div>`;
              })
              .join('')
          : '<p class="ext-empty">Files you download in blackwaves show up here. They save to your computer too.</p>'
      }</div>`;
  }

  function toggle(force) {
    panel.hidden = force != null ? !force : !panel.hidden;
    if (!panel.hidden) {
      unseen = 0;
      render();
    }
    updateBadge();
  }

  document.getElementById('rail-downloads').addEventListener('click', (e) => {
    e.stopPropagation();
    toggle();
  });
  document.addEventListener('click', (e) => {
    if (!panel.hidden && !panel.contains(e.target) && !e.target.closest('#rail-downloads')) toggle(false);
  });
  panel.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-dl-act]');
    if (!btn) return;
    e.stopPropagation();
    const d = items.find((x) => x.id === btn.dataset.id);
    if (btn.dataset.dlAct === 'clear') {
      items = items.filter((x) => x.state === 'started' || x.state === 'progress');
      blobs.clear();
    } else if (btn.dataset.dlAct === 'remove') {
      items = items.filter((x) => x.id !== btn.dataset.id);
      blobs.delete(btn.dataset.id);
    } else if (btn.dataset.dlAct === 'again' && d) {
      if (blobs.has(d.id)) saveBlob(blobs.get(d.id), d.filename);
      else BW.tabs.open(d.url, { activate: false });
      return;
    }
    save();
    render();
  });

  /* ---------------- Recording ---------------- */
  function upsert(info) {
    let d = items.find((x) => x.id === info.id);
    if (!d) {
      d = { id: info.id, time: Date.now(), loaded: 0 };
      items.unshift(d);
    }
    Object.assign(d, info);
    save();
    render();
    return d;
  }

  if (navigator.serviceWorker) {
    navigator.serviceWorker.addEventListener('message', (e) => {
      const msg = e.data && e.data.bwDownload;
      if (!msg) return;
      const d = upsert(msg);
      if (msg.state === 'started') {
        unseen++;
        BW.tabs && BW.tabs.downloadStarted(d);
        BW.toast(`Downloading <b>${BW.esc(d.filename)}</b>${d.size ? ` (${fmtSize(d.size)})` : ''}. It's saving to your computer.`, 'info', 4000);
      } else if (msg.state === 'done' || msg.state === 'interrupted') {
        if (msg.state === 'done') d.size = d.size || msg.loaded;
        save();
        render();
        BW.tabs && BW.tabs.downloadFinished(d.id);
      }
    });
  }

  /* ---------------- Saving files from blackwaves ---------------- */
  function saveBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename || 'download';
    a.style.display = 'none';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  }

  // Proxies present blob:<site origin>/<uuid> to the page, but the browser knows the blob as
  // blob:<our origin>/<uuid>. Try both, in this page and in the frame that made it.
  async function resolveBlob(win, href) {
    const tries = [href];
    const uuid = (href.match(/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i) || [])[1];
    if (uuid) tries.push(`blob:${location.origin}/${uuid}`);
    for (const fetcher of [window.fetch.bind(window), win && win.fetch && win.fetch.bind(win)]) {
      if (!fetcher) continue;
      for (const u of tries) {
        try {
          const res = await fetcher(u);
          if (res.ok) return await res.blob();
        } catch {}
      }
    }
    throw new Error('The file is no longer available.');
  }

  function guessName(blob, given) {
    if (given && given !== 'true') return given;
    const ext = { 'text/plain': 'txt', 'application/json': 'json', 'image/png': 'png', 'image/jpeg': 'jpg', 'application/pdf': 'pdf', 'text/csv': 'csv', 'application/zip': 'zip', 'text/html': 'html' }[blob.type];
    return `download${ext ? `.${ext}` : ''}`;
  }

  async function savePageFile(win, href, filename) {
    const id = Math.random().toString(36).slice(2, 10);
    try {
      const blob = /^data:/i.test(href) ? await (await fetch(href)).blob() : await resolveBlob(win, href);
      const name = guessName(blob, filename);
      blobs.set(id, blob);
      saveBlob(blob, name);
      unseen++;
      upsert({ id, filename: name, size: blob.size, loaded: blob.size, type: blob.type, url: '', state: 'done' });
      BW.toast(`Saved <b>${BW.esc(name)}</b> to your computer.`, 'success', 3500);
    } catch (err) {
      BW.toast(`Couldn't save the file: ${BW.esc(err.message)}`, 'error', 5000);
    }
  }

  const fileHref = (a) => {
    const raw = a.getAttribute('href') || '';
    const prop = a.href || '';
    if (/^(blob|data):/i.test(raw)) return raw;
    const inner = prop.match(/(blob:.*|data:.*)$/i);
    return inner ? inner[1] : null;
  };

  /** Installed into every proxied document by the extension engine (see extensions.js). */
  function hookWindow(win) {
    if (win.__bwDownloadsHooked) return;
    win.__bwDownloadsHooked = true;
    const handle = (a) => {
      const href = fileHref(a);
      if (!href) return false;
      savePageFile(win, href, a.getAttribute('download'));
      return true;
    };
    // user clicks on download links
    win.document.addEventListener(
      'click',
      (e) => {
        const a = e.target && e.target.closest && e.target.closest('a[href]');
        if (a && !e.defaultPrevented && fileHref(a) && handle(a)) e.preventDefault();
      },
      true
    );
    // programmatic a.click() / a.dispatchEvent(new MouseEvent('click')) on detached links
    const proto = win.HTMLAnchorElement && win.HTMLAnchorElement.prototype;
    if (!proto) return;
    const click = proto.click;
    proto.click = function () {
      if (!this.isConnected && fileHref(this) && handle(this)) return;
      return click.call(this);
    };
    const dispatch = proto.dispatchEvent;
    proto.dispatchEvent = function (event) {
      if (event && event.type === 'click' && !this.isConnected && fileHref(this) && handle(this)) return false;
      return dispatch.call(this, event);
    };
  }

  BW.downloads = { hookWindow, toggle, list: () => items.slice() };
  updateBadge();
})();
