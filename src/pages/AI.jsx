// blackwaves ai: a chat with free models from openrouter. conversations stay on
// this device (encrypted like everything else); the server only relays them.
import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import { Icon } from "../components/Icon.jsx";
import { Markdown } from "../lib/md.jsx";
import { get } from "../lib/api.js";
import { storage } from "../lib/storage.js";
import { me } from "../lib/account.js";
import "../styles/ai.css";

const MAX_CHATS = 40;
const SUGGESTIONS = [
  "Explain photosynthesis like I'm 12",
  "Outline an essay about the Industrial Revolution",
  "Recommend games like Celeste",
  "Write a Python script that renames files in a folder",
];

const newId = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
const titleFrom = (text) => {
  const line = text.replace(/\s+/g, " ").trim();
  return line.length > 46 ? `${line.slice(0, 44)}...` : line || "New chat";
};

/** posts the conversation and calls onEvent for every streamed event */
async function streamChat({ model, messages, signal, onEvent }) {
  const response = await fetch("/api/ai/chat", {
    method: "POST",
    signal,
    credentials: "same-origin",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ model, messages }),
  });
  if (!response.ok || !response.body) {
    const data = await response.json().catch(() => null);
    throw new Error(data?.error || `the ai didn't answer (${response.status})`);
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let split;
    while ((split = buffer.indexOf("\n\n")) !== -1) {
      const chunk = buffer.slice(0, split);
      buffer = buffer.slice(split + 2);
      if (chunk.startsWith("data: ")) {
        try {
          onEvent(JSON.parse(chunk.slice(6)));
        } catch {}
      }
    }
  }
}

function Thinking({ text, live }) {
  if (live) {
    return (
      <div class="ai-thinking live">
        <span class="ai-dots">
          <i />
          <i />
          <i />
        </span>
        Thinking
      </div>
    );
  }
  if (!text) return null;
  return (
    <details class="ai-thinking">
      <summary>Show thinking</summary>
      <p>{text}</p>
    </details>
  );
}

function Message({ message, last, busy, onRetry }) {
  const [copied, setCopied] = useState(false);
  if (message.role === "user") {
    return (
      <div class="ai-msg user">
        <div class="ai-bubble">{message.content}</div>
      </div>
    );
  }
  const waiting = busy && last && !message.content;
  const copy = () =>
    navigator.clipboard?.writeText(message.content).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1400);
    });
  return (
    <div class="ai-msg bot">
      <img class="ai-mark logo-img" src="/favicon.ico" alt="" />
      <div class="ai-body">
        <Thinking text={message.reasoning} live={waiting} />
        {message.content && <Markdown text={message.content} />}
        {busy && last && message.content && <span class="ai-caret" aria-hidden="true" />}
        {message.error && (
          <p class="ai-error">
            <Icon name="info" size={15} /> {message.error}
          </p>
        )}
        {!(busy && last) && (message.content || message.error) && (
          <div class="ai-actions">
            {message.content && (
              <button onClick={copy} aria-label="Copy reply" data-tip={copied ? "Copied" : "Copy"}>
                <Icon name={copied ? "check" : "copy"} size={14} />
              </button>
            )}
            {last && (
              <button onClick={onRetry} aria-label="Try again" data-tip="Try again">
                <Icon name="retry" size={14} />
              </button>
            )}
            {message.model && <span class="ai-model-tag">{message.model.replace(/:free$/, "")}</span>}
          </div>
        )}
      </div>
    </div>
  );
}

export function AI() {
  const [chats, setChats] = useState(() => storage.get("aiChats", []));
  const [activeId, setActiveId] = useState(() => storage.get("aiChats", [])[0]?.id || null);
  const [models, setModels] = useState([]);
  const [model, setModel] = useState(() => storage.get("aiModel", "auto"));
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [listOpen, setListOpen] = useState(false);
  const abort = useRef(null);
  const scroller = useRef(null);
  const input = useRef(null);
  const pinned = useRef(true);

  const active = chats.find((chat) => chat.id === activeId) || null;
  const messages = active?.messages || [];

  useEffect(() => {
    get("/api/ai/models")
      .then((data) => {
        setModels(data.models || []);
        if (!(data.models || []).some((entry) => entry.id === model)) setModel(data.default || "auto");
      })
      .catch(() => setModels([{ id: "auto", name: "Auto (best free model)", maker: "OpenRouter" }]));
    return () => abort.current?.abort();
  }, []);

  useEffect(() => storage.set("aiModel", model), [model]);

  // stay glued to the bottom while a reply streams in, unless you scrolled up to read
  useEffect(() => {
    const el = scroller.current;
    if (el && pinned.current) el.scrollTop = el.scrollHeight;
  }, [messages]);

  const save = (next) => {
    const trimmed = next.slice(0, MAX_CHATS);
    setChats(trimmed);
    storage.set("aiChats", trimmed);
  };

  const patchChat = (id, change) =>
    setChats((list) => {
      const next = list.map((chat) => (chat.id === id ? change(chat) : chat));
      return next;
    });

  async function run(chatId, history) {
    setBusy(true);
    pinned.current = true;
    const controller = new AbortController();
    abort.current = controller;
    const reply = { role: "assistant", content: "", reasoning: "" };
    let pending = null;
    const flush = () => {
      pending = null;
      const snapshot = { ...reply };
      patchChat(chatId, (chat) => ({ ...chat, messages: [...history, snapshot] }));
    };
    const schedule = () => (pending ||= requestAnimationFrame(flush));
    flush();
    try {
      await streamChat({
        model,
        messages: history.map(({ role, content }) => ({ role, content })),
        signal: controller.signal,
        onEvent: (event) => {
          if (event.t) reply.content += event.t;
          if (event.r) reply.reasoning += event.r;
          if (event.m) reply.model = event.m;
          if (event.e) reply.error = event.e;
          schedule();
        },
      });
      if (!reply.content && !reply.error) reply.error = "the model sent back an empty reply. try again or pick another model.";
    } catch (error) {
      if (error.name !== "AbortError") reply.error = error.message;
    } finally {
      if (pending) cancelAnimationFrame(pending);
      abort.current = null;
      setBusy(false);
      setChats((list) => {
        const next = list.map((chat) => (chat.id === chatId ? { ...chat, at: Date.now(), messages: [...history, { ...reply }] } : chat));
        storage.set("aiChats", next.slice(0, MAX_CHATS));
        return next;
      });
    }
  }

  function send(text = draft) {
    const content = text.trim();
    if (!content || busy) return;
    setDraft("");
    let chatId = activeId;
    let history;
    if (!active) {
      chatId = newId();
      history = [{ role: "user", content }];
      save([{ id: chatId, title: titleFrom(content), at: Date.now(), messages: history }, ...chats]);
      setActiveId(chatId);
    } else {
      history = [...messages.filter((entry) => !(entry.role === "assistant" && !entry.content)), { role: "user", content }];
      save([{ ...active, at: Date.now(), messages: history }, ...chats.filter((chat) => chat.id !== chatId)]);
    }
    run(chatId, history);
  }

  function retry() {
    if (busy || !active) return;
    const lastUser = messages.map((entry) => entry.role).lastIndexOf("user");
    if (lastUser < 0) return;
    run(active.id, messages.slice(0, lastUser + 1));
  }

  function startNew() {
    abort.current?.abort();
    setActiveId(null);
    setDraft("");
    setListOpen(false);
    requestAnimationFrame(() => input.current?.focus());
  }

  function remove(id) {
    if (id === activeId) {
      abort.current?.abort();
      setActiveId(null);
    }
    save(chats.filter((chat) => chat.id !== id));
  }

  const sorted = useMemo(() => [...chats].sort((a, b) => (b.at || 0) - (a.at || 0)), [chats]);
  const name = me.value?.displayName;

  return (
    <main class={`ai ${listOpen ? "list-open" : ""}`}>
      <aside class="ai-side glass">
        <button class="ai-new" onClick={startNew}>
          <Icon name="newChat" size={17} /> New chat
        </button>
        <div class="ai-chats" role="list">
          {sorted.length === 0 && <p class="ai-side-empty">Your chats show up here. They stay on this device.</p>}
          {sorted.map((chat) => (
            <div key={chat.id} role="listitem" class={`ai-chat ${chat.id === activeId ? "active" : ""}`}>
              <button
                class="ai-chat-open"
                onClick={() => {
                  if (busy && chat.id !== activeId) abort.current?.abort();
                  setActiveId(chat.id);
                  setListOpen(false);
                }}
              >
                {chat.title}
              </button>
              <button class="ai-chat-delete" aria-label={`Delete ${chat.title}`} data-tip="Delete" onClick={() => remove(chat.id)}>
                <Icon name="trash" size={13} />
              </button>
            </div>
          ))}
        </div>
      </aside>

      <section class="ai-main glass">
        <header class="ai-head">
          <button class="btn ghost icon-only sm ai-list-toggle" aria-label="Chats" onClick={() => setListOpen(!listOpen)}>
            <Icon name="list" size={17} />
          </button>
          <label class="ai-model">
            <Icon name="ai" size={16} />
            <select value={model} onChange={(event) => setModel(event.currentTarget.value)} aria-label="Model" disabled={busy}>
              {models.map((entry) => (
                <option key={entry.id} value={entry.id}>
                  {entry.id === "auto" ? entry.name : `${entry.name} (${entry.maker})`}
                </option>
              ))}
            </select>
            <Icon name="down" size={13} />
          </label>
          <button class="btn ghost icon-only sm" aria-label="New chat" data-tip="New chat" onClick={startNew}>
            <Icon name="newChat" size={17} />
          </button>
        </header>

        <div
          class="ai-scroll"
          ref={scroller}
          onScroll={(event) => {
            const el = event.currentTarget;
            pinned.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
          }}
        >
          {messages.length === 0 ? (
            <div class="ai-empty">
              <img class="logo-img ai-empty-logo" src="/favicon.ico" alt="" />
              <h1>{name ? `What can I help with, ${name}?` : "What can I help with?"}</h1>
              <div class="ai-suggestions">
                {SUGGESTIONS.map((text) => (
                  <button key={text} onClick={() => send(text)}>
                    {text}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <div class="ai-thread">
              {messages.map((message, index) => (
                <Message key={index} message={message} last={index === messages.length - 1} busy={busy} onRetry={retry} />
              ))}
            </div>
          )}
        </div>

        <form
          class="ai-composer"
          onSubmit={(event) => {
            event.preventDefault();
            send();
          }}
        >
          <div class="ai-input">
            <textarea
              ref={input}
              rows={1}
              value={draft}
              placeholder="Message blackwaves AI"
              aria-label="Message"
              maxLength={12000}
              onInput={(event) => {
                setDraft(event.currentTarget.value);
                event.currentTarget.style.height = "auto";
                event.currentTarget.style.height = `${Math.min(event.currentTarget.scrollHeight, 200)}px`;
              }}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !event.shiftKey && !event.isComposing) {
                  event.preventDefault();
                  send();
                  event.currentTarget.style.height = "auto";
                } else if (event.key === "Escape" && busy) abort.current?.abort();
              }}
            />
            {busy ? (
              <button type="button" class="ai-send stop" aria-label="Stop" data-tip="Stop" onClick={() => abort.current?.abort()}>
                <Icon name="stop" size={14} />
              </button>
            ) : (
              <button type="submit" class="ai-send" aria-label="Send" disabled={!draft.trim()}>
                <Icon name="send" size={15} />
              </button>
            )}
          </div>
          <p class="ai-note">Free models through OpenRouter. AI gets things wrong, so check anything important.</p>
        </form>
      </section>
    </main>
  );
}
