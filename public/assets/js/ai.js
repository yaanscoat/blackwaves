/* blackwaves AI: chat UI for /api/ai/chat (OpenRouter relay; the API key stays on the server). */
(function () {
  const $ = (id) => document.getElementById(id);
  const view = $('ai-view');
  const list = $('ai-messages');
  const input = $('ai-input');
  const sendBtn = $('ai-send');
  const chatsEl = $('ai-chats');
  const KEY = 'bw:ai-chats';
  const ZOLA_URL = 'https://www.zola.chat/';
  const SUGGESTIONS = [
    { icon: 'fa-solid fa-lightbulb', text: 'Explain black holes like I am 12' },
    { icon: 'fa-solid fa-square-root-variable', text: 'Help me solve 3x + 7 = 22 step by step' },
    { icon: 'fa-solid fa-pen-nib', text: 'Write a short spooky story in 150 words' },
    { icon: 'fa-solid fa-code', text: 'Write a JavaScript function that reverses a string' },
  ];

  /*
   * Chat shape: { id, title, model, updated, messages: [
   *   { role: 'user', content },
   *   { role: 'assistant', idx, variants: [{ content, model, rating: 1 | -1 | 0 }] },
   * ] }
   * Each "generate another answer" adds a variant; idx is the one being shown.
   */
  let chats = migrate(load());
  let activeId = null;
  let models = [];
  let model = null;
  let controller = null;
  let modelDropdown = null;

  function load() {
    try {
      return JSON.parse(localStorage.getItem(KEY)) || [];
    } catch {
      return [];
    }
  }
  function migrate(list) {
    for (const chat of list) {
      for (const m of chat.messages || []) {
        if (m.role === 'assistant' && !m.variants) {
          m.variants = [{ content: m.content || '', model: chat.model || '', rating: 0 }];
          m.idx = 0;
          delete m.content;
        }
      }
    }
    return list;
  }
  function save(silent) {
    chats = chats.sort((a, b) => b.updated - a.updated).slice(0, 50);
    try {
      localStorage.setItem(KEY, JSON.stringify(chats));
    } catch {}
    if (!silent) BW.emitChange('ai');
  }
  const active = () => chats.find((c) => c.id === activeId) || null;
  const textOf = (m) => (m.role === 'assistant' ? (m.variants[m.idx] || m.variants[0] || {}).content || '' : m.content);
  const history = (messages) => messages.map((m) => ({ role: m.role, content: textOf(m) })).filter((m) => m.content);
  const modelName = (id) => (models.find((m) => m.id === id) || {}).name || (id || '').replace(/:free$/, '');

  /* ---------------- Markdown (escaped first, so model output can't inject HTML) ---------------- */
  function inline(text) {
    return text
      .replace(/`([^`\n]+)`/g, '<code>$1</code>')
      .replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>')
      .replace(/(^|[^*\w])\*([^*\n]+)\*/g, '$1<em>$2</em>')
      .replace(/\[([^\]\n]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" data-ai-link>$1</a>')
      .replace(/&lt;(https?:\/\/[^\s&]+)&gt;/g, '<a href="$1" data-ai-link>$1</a>')
      .replace(/(^|[\s(])(https?:\/\/[^\s<)]+)/g, '$1<a href="$2" data-ai-link>$2</a>');
  }

  const isTableRow = (line) => /^\s*\|.*\|\s*$/.test(line);
  const isTableSep = (line) => /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/.test(line);
  const cells = (line) => line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((c) => c.trim());

  function markdown(src) {
    const out = [];
    const parts = BW.esc(src).split(/```/);
    parts.forEach((part, i) => {
      if (i % 2 === 1) {
        const nl = part.indexOf('\n');
        const lang = nl > 0 ? part.slice(0, nl).trim() : '';
        const code = nl >= 0 ? part.slice(nl + 1) : part;
        out.push(`<div class="ai-code"><div class="ai-code-head"><span>${lang || 'code'}</span><button class="ai-copy" data-copy-code><i class="fa-regular fa-copy"></i> Copy</button></div><pre><code>${code.replace(/\n$/, '')}</code></pre></div>`);
        return;
      }
      const lines = part.split('\n');
      let listType = null;
      let para = [];
      const flushPara = () => {
        if (para.length) out.push(`<p>${inline(para.join('<br>'))}</p>`);
        para = [];
      };
      const closeList = () => {
        if (listType) out.push(`</${listType}>`);
        listType = null;
      };
      for (let n = 0; n < lines.length; n++) {
        const line = lines[n];
        let m;
        if (!line.trim()) {
          flushPara();
          closeList();
        } else if (isTableRow(line) && n + 1 < lines.length && isTableSep(lines[n + 1])) {
          flushPara();
          closeList();
          const head = cells(line);
          const rows = [];
          n += 2;
          while (n < lines.length && isTableRow(lines[n])) rows.push(cells(lines[n++]));
          n--;
          out.push(`<div class="ai-table"><table><thead><tr>${head.map((c) => `<th>${inline(c)}</th>`).join('')}</tr></thead><tbody>${rows.map((r) => `<tr>${r.map((c) => `<td>${inline(c)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`);
        } else if (/^\s*([-*_])(\s*\1){2,}\s*$/.test(line)) {
          flushPara();
          closeList();
          out.push('<hr>');
        } else if ((m = line.match(/^(#{1,4})\s+(.*)$/))) {
          flushPara();
          closeList();
          out.push(`<h${m[1].length + 2}>${inline(m[2])}</h${m[1].length + 2}>`);
        } else if ((m = line.match(/^\s*[-*•]\s+(.*)$/))) {
          flushPara();
          if (listType !== 'ul') {
            closeList();
            out.push('<ul>');
            listType = 'ul';
          }
          out.push(`<li>${inline(m[1])}</li>`);
        } else if ((m = line.match(/^\s*(\d+)[.)]\s+(.*)$/))) {
          flushPara();
          if (listType !== 'ol') {
            closeList();
            // keep the model's numbering when a list is split by a code block
            out.push(`<ol start="${+m[1]}">`);
            listType = 'ol';
          }
          out.push(`<li>${inline(m[2])}</li>`);
        } else if ((m = line.match(/^&gt;\s?(.*)$/))) {
          flushPara();
          closeList();
          out.push(`<blockquote>${inline(m[1])}</blockquote>`);
        } else {
          closeList();
          para.push(line);
        }
      }
      flushPara();
      closeList();
    });
    return out.join('');
  }

  /* ---------------- Rendering ---------------- */
  function renderChats() {
    chatsEl.innerHTML = chats.length
      ? chats.map((c) => `<div class="ai-chat-item${c.id === activeId ? ' active' : ''}" data-chat="${c.id}" title="${BW.esc(c.title)}"><i class="fa-regular fa-message"></i><span>${BW.esc(c.title)}</span><button class="tab-close" data-delete="${c.id}" aria-label="Delete chat"><i class="fa-solid fa-xmark"></i></button></div>`).join('')
      : '<p class="ai-empty-list">Your chats will show up here.</p>';
  }

  function actionsHtml(m, i, isLast) {
    const v = m.variants[m.idx] || {};
    const nav =
      m.variants.length > 1
        ? `<span class="ai-variants"><button data-act="prev" data-i="${i}" ${m.idx === 0 ? 'disabled' : ''} aria-label="Previous answer"><i class="fa-solid fa-chevron-left"></i></button>${m.idx + 1}/${m.variants.length}<button data-act="next" data-i="${i}" ${m.idx === m.variants.length - 1 ? 'disabled' : ''} aria-label="Next answer"><i class="fa-solid fa-chevron-right"></i></button></span>`
        : '';
    return `<div class="ai-actions">
      ${nav}
      <button data-act="copy" data-i="${i}" title="Copy"><i class="fa-regular fa-copy"></i></button>
      <button data-act="like" data-i="${i}" class="${v.rating === 1 ? 'on' : ''}" title="Good answer"><i class="fa-${v.rating === 1 ? 'solid' : 'regular'} fa-thumbs-up"></i></button>
      <button data-act="dislike" data-i="${i}" class="${v.rating === -1 ? 'on' : ''}" title="Bad answer"><i class="fa-${v.rating === -1 ? 'solid' : 'regular'} fa-thumbs-down"></i></button>
      ${isLast ? `<button data-act="regenerate" data-i="${i}" title="Generate another answer"><i class="fa-solid fa-rotate-right"></i></button>` : ''}
      ${v.model ? `<span class="ai-model-tag">${BW.esc(modelName(v.model))}</span>` : ''}
    </div>`;
  }

  function messageHtml(m, i, lastAssistant) {
    if (m.role === 'user') return `<div class="ai-msg user"><div class="ai-bubble">${BW.esc(m.content).replace(/\n/g, '<br>')}</div></div>`;
    return `<div class="ai-msg assistant" data-msg="${i}"><div class="ai-avatar"><img src="/favicon.ico" alt=""></div><div class="ai-col"><div class="ai-body">${markdown(textOf(m))}</div>${actionsHtml(m, i, i === lastAssistant)}</div></div>`;
  }

  function renderMessages(keepScroll) {
    const chat = active();
    if (!chat || !chat.messages.length) {
      const name = BW.settings.get('userName');
      list.innerHTML = `<div class="ai-welcome">
        <h2>${name ? `Hey ${BW.esc(name)}, what` : 'What'}'s on your mind?</h2>
        <p>blackwaves AI is free and private to this browser. Pick a model up top or just start typing.</p>
        <div class="ai-suggestions">${SUGGESTIONS.map((s) => `<button class="ai-suggestion" data-suggest="${BW.esc(s.text)}"><i class="${s.icon}"></i><span>${BW.esc(s.text)}</span></button>`).join('')}</div>
      </div>`;
      return;
    }
    const top = list.scrollTop;
    const lastAssistant = chat.messages.map((m) => m.role).lastIndexOf('assistant');
    list.innerHTML = chat.messages.map((m, i) => messageHtml(m, i, lastAssistant)).join('');
    list.scrollTop = keepScroll ? top : list.scrollHeight;
  }

  function setBusy(busy) {
    sendBtn.innerHTML = busy ? '<i class="fa-solid fa-stop"></i>' : '<i class="fa-solid fa-arrow-up"></i>';
    sendBtn.title = busy ? 'Stop' : 'Send';
    sendBtn.classList.toggle('busy', busy);
    list.classList.toggle('busy', busy);
  }

  /* ---------------- Streaming ---------------- */
  // Streams one reply into `bodyEl`. Resolves { answer, model, error }.
  async function stream(messages, bodyEl, regenerate) {
    controller = new AbortController();
    setBusy(true);
    bodyEl.innerHTML = '<span class="ai-typing"><i></i><i></i><i></i></span>';
    let answer = '';
    let used = model;
    let error = '';
    try {
      const res = await fetch('/api/ai/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model, messages, regenerate: !!regenerate }),
        signal: controller.signal,
      });
      if (!res.ok || !res.body) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.error || `Request failed (${res.status})`);
      }
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let pending = false;
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let idx;
        while ((idx = buffer.indexOf('\n\n')) >= 0) {
          const line = buffer.slice(0, idx).trim();
          buffer = buffer.slice(idx + 2);
          if (!line.startsWith('data:')) continue;
          let evt;
          try {
            evt = JSON.parse(line.slice(5));
          } catch {
            continue;
          }
          if (evt.error) error = evt.error;
          if (evt.model) used = evt.model;
          if (evt.delta) {
            answer += evt.delta;
            if (!pending) {
              pending = true;
              requestAnimationFrame(() => {
                pending = false;
                const atBottom = list.scrollHeight - list.scrollTop - list.clientHeight < 80;
                bodyEl.innerHTML = markdown(answer);
                if (atBottom) list.scrollTop = list.scrollHeight;
              });
            }
          }
        }
      }
    } catch (err) {
      if (err.name !== 'AbortError') error = err.message;
    }
    controller = null;
    setBusy(false);
    return { answer, model: used, error };
  }

  function showError(bodyEl, answer, error) {
    const html = `<p class="ai-error"><i class="fa-solid fa-triangle-exclamation"></i> ${BW.esc(error)}</p>`;
    if (answer) bodyEl.insertAdjacentHTML('beforeend', html);
    else bodyEl.innerHTML = html;
  }

  async function send(text) {
    text = text.trim();
    if (!text || controller) return;
    let chat = active();
    if (!chat) {
      chat = { id: Math.random().toString(36).slice(2, 10), title: text.slice(0, 48), model, messages: [], updated: Date.now() };
      chats.unshift(chat);
      activeId = chat.id;
    }
    chat.messages.push({ role: 'user', content: text });
    chat.updated = Date.now();
    input.value = '';
    autosize();
    save();
    renderChats();
    renderMessages();

    const node = document.createElement('div');
    node.className = 'ai-msg assistant';
    node.innerHTML = '<div class="ai-avatar"><img src="/favicon.ico" alt=""></div><div class="ai-col"><div class="ai-body"></div></div>';
    list.appendChild(node);
    list.scrollTop = list.scrollHeight;
    const bodyEl = node.querySelector('.ai-body');

    const { answer, model: used, error } = await stream(history(chat.messages), bodyEl, false);
    if (answer) {
      chat.messages.push({ role: 'assistant', idx: 0, variants: [{ content: answer, model: used, rating: 0 }] });
      chat.model = used;
      chat.updated = Date.now();
      save();
      renderMessages();
      if (error) showError(list.querySelector('.ai-msg.assistant:last-child .ai-body'), answer, error);
    } else if (error) {
      showError(bodyEl, '', error);
    }
    renderChats();
  }

  // Adds a new variant to an assistant message, keeping the earlier answers browsable.
  async function regenerate(i) {
    const chat = active();
    if (!chat || controller) return;
    const msg = chat.messages[i];
    if (!msg || msg.role !== 'assistant') return;
    const node = list.querySelector(`[data-msg="${i}"]`);
    const bodyEl = node.querySelector('.ai-body');
    node.querySelector('.ai-actions').style.visibility = 'hidden';
    const { answer, model: used, error } = await stream(history(chat.messages.slice(0, i)), bodyEl, true);
    if (answer) {
      msg.variants.push({ content: answer, model: used, rating: 0 });
      msg.idx = msg.variants.length - 1;
      chat.updated = Date.now();
      save();
    }
    renderMessages(true);
    if (error) showError(list.querySelector(`[data-msg="${i}"] .ai-body`), answer, error);
  }

  function rate(i, value) {
    const chat = active();
    const msg = chat && chat.messages[i];
    if (!msg) return;
    const v = msg.variants[msg.idx];
    v.rating = v.rating === value ? 0 : value;
    save();
    renderMessages(true);
    if (v.rating === 1) BW.toast('Thanks! Glad that helped.', 'success', 2000);
    if (v.rating === -1) BW.toast('Thanks for the feedback. Try "generate another answer" for a different take.', 'info', 3500);
  }

  function autosize() {
    input.style.height = 'auto';
    input.style.height = `${Math.min(input.scrollHeight, 200)}px`;
  }

  function copyText(text, btn, label) {
    navigator.clipboard.writeText(text).then(
      () => {
        const prev = btn.innerHTML;
        btn.innerHTML = `<i class="fa-solid fa-check"></i>${label ? ' Copied' : ''}`;
        setTimeout(() => (btn.innerHTML = prev), 1500);
      },
      () => BW.toast("Couldn't copy to the clipboard.", 'error')
    );
  }

  /* ---------------- Events ---------------- */
  $('ai-form').addEventListener('submit', (e) => {
    e.preventDefault();
    if (controller) controller.abort();
    else send(input.value);
  });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
      e.preventDefault();
      if (!controller) send(input.value);
    }
  });
  input.addEventListener('input', autosize);

  list.addEventListener('click', (e) => {
    const sug = e.target.closest('[data-suggest]');
    if (sug) return send(sug.dataset.suggest);
    const copyCode = e.target.closest('[data-copy-code]');
    if (copyCode) return copyText(copyCode.closest('.ai-code').querySelector('code').textContent, copyCode, true);
    const act = e.target.closest('[data-act]');
    if (act && !act.disabled) {
      const i = +act.dataset.i;
      const chat = active();
      const msg = chat && chat.messages[i];
      if (!msg) return;
      if (act.dataset.act === 'copy') return copyText(textOf(msg), act, false);
      if (act.dataset.act === 'like') return rate(i, 1);
      if (act.dataset.act === 'dislike') return rate(i, -1);
      if (act.dataset.act === 'regenerate') return regenerate(i);
      if (act.dataset.act === 'prev' || act.dataset.act === 'next') {
        msg.idx = Math.max(0, Math.min(msg.variants.length - 1, msg.idx + (act.dataset.act === 'next' ? 1 : -1)));
        save(true);
        return renderMessages(true);
      }
    }
    const link = e.target.closest('a[data-ai-link]');
    if (link) {
      e.preventDefault();
      BW.ai.close();
      BW.tabs.open(link.href);
    }
  });

  chatsEl.addEventListener('click', (e) => {
    const del = e.target.closest('[data-delete]');
    if (del) {
      e.stopPropagation();
      chats = chats.filter((c) => c.id !== del.dataset.delete);
      if (activeId === del.dataset.delete) activeId = null;
      save();
      renderChats();
      renderMessages();
      return;
    }
    const item = e.target.closest('[data-chat]');
    if (item && !controller) {
      activeId = item.dataset.chat;
      const chat = active();
      if (chat && chat.model && models.some((m) => m.id === chat.model)) {
        model = chat.model;
        modelDropdown && modelDropdown.set(model, true);
      }
      renderChats();
      renderMessages();
    }
  });

  $('ai-new').addEventListener('click', () => {
    if (controller) return;
    activeId = null;
    renderChats();
    renderMessages();
    input.focus();
  });
  $('ai-close').addEventListener('click', () => BW.ai.close());
  $('ai-zola').addEventListener('click', () => {
    BW.ai.close();
    BW.tabs.open(ZOLA_URL);
  });

  async function loadModels() {
    try {
      const res = await fetch('/api/ai/models');
      const data = await res.json();
      if (!data.enabled) {
        list.innerHTML = '<div class="ai-welcome"><h2>AI is turned off</h2><p>This blackwaves server has no OpenRouter key configured. Add OPENROUTER_API_KEY to the server\'s .env file.</p></div>';
        input.disabled = true;
        return;
      }
      models = data.models;
      const saved = BW.settings.get('aiModel');
      model = models.some((m) => m.id === saved) ? saved : data.default;
      modelDropdown = BW.dropdown($('ai-model'), {
        options: models.map((m) => ({ value: m.id, label: m.name, hint: m.id === data.default ? 'default' : '' })),
        value: model,
        onChange: (v) => {
          model = v;
          BW.settings.set('aiModel', v);
        },
      });
      if (!view.hidden) renderMessages(true);
    } catch {
      $('ai-model').textContent = 'Models unavailable';
    }
  }

  BW.ai = {
    open() {
      BW.games.close();
      view.hidden = false;
      document.body.classList.add('ai-open');
      if (!models.length) loadModels();
      renderChats();
      renderMessages();
      setTimeout(() => input.focus(), 50);
    },
    close() {
      view.hidden = true;
      document.body.classList.remove('ai-open');
    },
    // cloud sync
    exportChats: () => chats,
    importChats(next) {
      if (!Array.isArray(next)) return;
      chats = migrate(next);
      save(true);
      if (!view.hidden) {
        renderChats();
        renderMessages();
      }
    },
  };
})();
