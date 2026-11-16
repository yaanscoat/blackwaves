/* Shared UI primitives: toasts, custom dropdowns, toggles, segmented controls. */
(function () {
  const esc = (v) =>
    String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  /* ---------------- Toasts ---------------- */
  const ICONS = {
    success: 'fa-circle-check',
    error: 'fa-circle-xmark',
    info: 'fa-circle-info',
    warning: 'fa-triangle-exclamation',
  };
  let stack;
  function toast(message, type = 'info', timeout = 3200) {
    if (!stack) {
      stack = document.createElement('div');
      stack.className = 'toast-stack';
      document.body.appendChild(stack);
    }
    const el = document.createElement('div');
    el.className = `toast ${type}`;
    el.innerHTML = `<i class="fa-solid ${ICONS[type] || ICONS.info}"></i><span>${message}</span><button class="toast-close" aria-label="Dismiss"><i class="fa-solid fa-xmark"></i></button>`;
    const close = () => {
      el.classList.add('hide');
      setTimeout(() => el.remove(), 250);
    };
    el.querySelector('.toast-close').addEventListener('click', close);
    stack.appendChild(el);
    if (timeout) setTimeout(close, timeout);
    return close;
  }

  /* ---------------- Custom dropdown ---------------- */
  let openDropdown = null;
  document.addEventListener('click', (e) => {
    if (openDropdown && !openDropdown.el.contains(e.target)) openDropdown.close();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && openDropdown) {
      openDropdown.close();
      e.stopImmediatePropagation();
    }
  });

  /**
   * dropdown(el, { options: [{value, label, icon?, hint?}], value, onChange, searchable? })
   */
  function dropdown(el, opts) {
    el.classList.add('bw-dropdown');
    el.innerHTML = `<button type="button" class="dd-trigger" aria-haspopup="listbox"><span class="dd-label"></span><i class="fa-solid fa-chevron-down dd-caret"></i></button><div class="dd-menu" role="listbox">${opts.searchable ? '<input class="dd-search" placeholder="Search..." autocomplete="off">' : ''}<div class="dd-list"></div></div>`;
    const trigger = el.querySelector('.dd-trigger');
    const label = el.querySelector('.dd-label');
    const list = el.querySelector('.dd-list');
    const search = el.querySelector('.dd-search');
    let value = opts.value;
    let options = opts.options;

    function optionHtml(o) {
      const icon = o.icon ? (o.icon.startsWith('fa') ? `<i class="${o.icon}"></i>` : `<img src="${esc(o.icon)}" alt="" loading="lazy">`) : '';
      return `<div class="dd-option${o.value === value ? ' selected' : ''}" role="option" data-value="${esc(o.value)}">${icon}<span>${esc(o.label)}</span>${o.hint ? `<small>${esc(o.hint)}</small>` : ''}</div>`;
    }
    function render(filter = '') {
      const f = filter.toLowerCase();
      list.innerHTML = options.filter((o) => !f || o.label.toLowerCase().includes(f)).map(optionHtml).join('');
      const current = options.find((o) => o.value === value);
      label.innerHTML = current ? `${current.icon ? (current.icon.startsWith('fa') ? `<i class="${current.icon}"></i>` : `<img src="${esc(current.icon)}" alt="">`) : ''}<span>${esc(current.label)}</span>` : '<span>Select...</span>';
    }
    const api = {
      el,
      open() {
        if (openDropdown && openDropdown !== api) openDropdown.close();
        el.classList.add('open');
        openDropdown = api;
        if (search) {
          search.value = '';
          render();
          search.focus();
        }
        const sel = list.querySelector('.selected');
        if (sel) sel.scrollIntoView({ block: 'nearest' });
      },
      close() {
        el.classList.remove('open');
        if (openDropdown === api) openDropdown = null;
      },
      get value() {
        return value;
      },
      set(v, silent) {
        value = v;
        render();
        if (!silent && opts.onChange) opts.onChange(v);
      },
      setOptions(next) {
        options = next;
        render();
      },
    };
    trigger.addEventListener('click', (e) => {
      e.stopPropagation();
      el.classList.contains('open') ? api.close() : api.open();
    });
    list.addEventListener('click', (e) => {
      const opt = e.target.closest('.dd-option');
      if (!opt) return;
      e.stopPropagation();
      api.close();
      if (opt.dataset.value !== value) api.set(opt.dataset.value);
    });
    if (search) {
      search.addEventListener('click', (e) => e.stopPropagation());
      search.addEventListener('input', () => render(search.value));
    }
    render();
    return api;
  }

  /* ---------------- Toggle switch ---------------- */
  function toggle(checked, onChange) {
    const label = document.createElement('label');
    label.className = 'bw-toggle';
    label.innerHTML = `<input type="checkbox"${checked ? ' checked' : ''}><span class="track"><span class="thumb"></span></span>`;
    const input = label.querySelector('input');
    input.addEventListener('change', () => onChange(input.checked));
    return label;
  }

  /* ---------------- Segmented control ---------------- */
  function segmented(options, value, onChange) {
    const wrap = document.createElement('div');
    wrap.className = 'bw-segmented';
    wrap.innerHTML = options.map((o) => `<button type="button" data-value="${esc(o.id)}" class="${o.id === value ? 'active' : ''}">${esc(o.name)}</button>`).join('');
    wrap.addEventListener('click', (e) => {
      const b = e.target.closest('button');
      if (!b) return;
      wrap.querySelectorAll('button').forEach((x) => x.classList.toggle('active', x === b));
      onChange(b.dataset.value);
    });
    return wrap;
  }

  function loadScript(src) {
    return new Promise((resolve, reject) => {
      if (document.querySelector(`script[data-bw-src="${src}"]`)) return resolve();
      const s = document.createElement('script');
      s.src = src;
      s.dataset.bwSrc = src;
      s.onload = () => resolve();
      s.onerror = () => reject(new Error(`Failed to load ${src}`));
      document.head.appendChild(s);
    });
  }

  /* ---------------- Lowercase tooltips ---------------- */
  // CSS lowercases the UI text (index.css), but native tooltips aren't styled. Page titles and
  // file names (tabs, downloads) keep their real case.
  const KEEP_CASE = '.tab, .dl-item, .keep-case';
  function lowerTitles(root) {
    const els = root.querySelectorAll ? [root, ...root.querySelectorAll('[title], [aria-label]')] : [];
    for (const el of els) {
      if (!el.closest || el.closest(KEEP_CASE)) continue;
      for (const attr of ['title', 'aria-label']) {
        const v = el.getAttribute(attr);
        if (v && v !== v.toLowerCase()) el.setAttribute(attr, v.toLowerCase());
      }
    }
  }
  new MutationObserver((records) => {
    for (const r of records) {
      if (r.type === 'attributes') lowerTitles(r.target);
      else r.addedNodes.forEach((n) => n.nodeType === 1 && lowerTitles(n));
    }
  }).observe(document.documentElement, { subtree: true, childList: true, attributes: true, attributeFilter: ['title', 'aria-label'] });
  document.addEventListener('DOMContentLoaded', () => lowerTitles(document.body));
  if (document.body) lowerTitles(document.body);

  Object.assign(BW, { esc, toast, dropdown, toggle, segmented, loadScript });
})();
