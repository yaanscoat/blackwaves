// blackwaves ai: a chat with free models from openrouter, plus a paraphraser and
// a humanizer. conversations stay on this device (encrypted like everything
// else); the server only relays them.
import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import { Icon } from "../components/Icon.jsx";
import { Dropdown } from "../components/Dropdown.jsx";
import { Modal } from "../components/Modal.jsx";
import { Markdown } from "../lib/md.jsx";
import { get } from "../lib/api.js";
import { streamAi } from "../lib/aistream.js";
import { storage } from "../lib/storage.js";
import { me } from "../lib/account.js";
import { toast } from "../lib/notify.js";
import { navigate, route, segments } from "../lib/router.js";
import { AITool, TOOL_INFO } from "./AITools.jsx";
import "../styles/ai.css";

const MAX_CHATS = 40;
// attached files live inside the chat, so only the newest few chats keep the
// file text on this device; older ones keep the name and drop the contents
const CHATS_WITH_FILES = 5;
const FILE_CHARS = 40_000;
const MAX_FILES = 3;
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

/** what the model actually reads for a message: your text plus any attached files */
function forModel(message) {
  const files = (message.files || []).filter((file) => file.text);
  if (!files.length) return message.content;
  const attached = files.map((file) => `Attached file "${file.name}":\n\`\`\`\n${file.text}\n\`\`\``).join("\n\n");
  return `${message.content}\n\n${attached}`;
}

function persist(list) {
  const newest = new Set([...list].sort((a, b) => (b.at || 0) - (a.at || 0)).slice(0, CHATS_WITH_FILES).map((chat) => chat.id));
  const slim = list.slice(0, MAX_CHATS).map((chat) =>
    newest.has(chat.id) || !chat.messages.some((message) => message.files?.some((file) => file.text))
      ? chat
      : { ...chat, messages: chat.messages.map((message) => (message.files ? { ...message, files: message.files.map(({ name }) => ({ name })) } : message)) },
  );
  storage.set("aiChats", slim);
}

async function readTextFile(file) {
  if (file.size > 2 * 1024 * 1024) throw new Error(`${file.name} is too big, files can be up to 2 MB`);
  const text = await file.text();
  // a NUL byte means it's not really text (an image, a pdf, a zip...)
  if (text.includes("\u0000")) throw new Error(`${file.name} isn't a text file. Try a .txt, .md, .csv or code file`);
  return { name: file.name, text: text.length > FILE_CHARS ? `${text.slice(0, FILE_CHARS)}\n[the rest of the file was cut off]` : text };
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

function FileChips({ files, onRemove }) {
  if (!files?.length) return null;
  return (
    <div class="ai-files">
      {files.map((file, index) => (
        <span key={index} class={`ai-file ${file.text ? "" : "gone"}`} data-tip={file.text ? undefined : "No longer attached on this device"}>
          <Icon name="file" size={13} />
          {file.name}
          {onRemove && (
            <button type="button" aria-label={`Remove ${file.name}`} onClick={() => onRemove(index)}>
              <Icon name="x" size={11} />
            </button>
          )}
        </span>
      ))}
    </div>
  );
}

function Message({ message, last, busy, onRetry }) {
  const [copied, setCopied] = useState(false);
  if (message.role === "user") {
    return (
      <div class="ai-msg user">
        <div class="ai-user">
          <FileChips files={message.files} />
          {message.content && <div class="ai-bubble">{message.content}</div>}
        </div>
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

function Instructions({ onClose }) {
  const [value, setValue] = useState(() => storage.get("aiInstructions", ""));
  return (
    <Modal title="Custom instructions" onClose={onClose}>
      {(close) => (
        <form
          class="ai-instructions"
          onSubmit={(event) => {
            event.preventDefault();
            storage.set("aiInstructions", value.trim());
            toast(value.trim() ? "custom instructions saved" : "custom instructions cleared", { kind: "success" });
            close();
          }}
        >
          <p class="muted small">What should blackwaves AI know about you, and how should it answer? This applies to every chat.</p>
          <textarea
            class="input"
            rows={7}
            maxLength={2000}
            value={value}
            placeholder={"I'm in 10th grade and taking AP Biology.\nKeep answers short and use bullet points.\nExplain code line by line."}
            onInput={(event) => setValue(event.currentTarget.value)}
          />
          <div class="ai-instructions-foot">
            <span class="faint small">{value.length} / 2000</span>
            <button type="button" class="btn ghost" onClick={close}>
              Cancel
            </button>
            <button class="btn primary">Save</button>
          </div>
        </form>
      )}
    </Modal>
  );
}

export function AI() {
  const [chats, setChats] = useState(() => storage.get("aiChats", []));
  const [activeId, setActiveId] = useState(() => storage.get("aiChats", [])[0]?.id || null);
  const [models, setModels] = useState([]);
  const [model, setModel] = useState(() => storage.get("aiModel", "auto"));
  const [draft, setDraft] = useState("");
  const [files, setFiles] = useState([]);
  const [busy, setBusy] = useState(false);
  const [toolBusy, setToolBusy] = useState(false);
  const [listOpen, setListOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const abort = useRef(null);
  const scroller = useRef(null);
  const input = useRef(null);
  const picker = useRef(null);
  const pinned = useRef(true);

  const [, sub] = segments(route.value);
  const tool = TOOL_INFO[sub] ? sub : "chat";

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
  }, [messages, tool]);

  const save = (next) => {
    const trimmed = next.slice(0, MAX_CHATS);
    setChats(trimmed);
    persist(trimmed);
  };

  const patchChat = (id, change) => setChats((list) => list.map((chat) => (chat.id === id ? change(chat) : chat)));

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
      const instructions = storage.get("aiInstructions", "");
      await streamAi(
        "/api/ai/chat",
        { model, instructions, messages: history.map((message) => ({ role: message.role, content: message.role === "user" ? forModel(message) : message.content })) },
        {
          signal: controller.signal,
          onEvent: (event) => {
            if (event.t) reply.content += event.t;
            if (event.r) reply.reasoning += event.r;
            if (event.m) reply.model = event.m;
            if (event.e) reply.error = event.e;
            schedule();
          },
        },
      );
      if (!reply.content && !reply.error) reply.error = "the model sent back an empty reply. try again or pick another model.";
    } catch (error) {
      if (error.name !== "AbortError") reply.error = error.message;
    } finally {
      if (pending) cancelAnimationFrame(pending);
      abort.current = null;
      setBusy(false);
      setChats((list) => {
        const next = list.map((chat) => (chat.id === chatId ? { ...chat, at: Date.now(), messages: [...history, { ...reply }] } : chat));
        persist(next);
        return next;
      });
    }
  }

  function send(text = draft) {
    const content = text.trim();
    if ((!content && !files.length) || busy) return;
    const message = { role: "user", content: content || (files.length ? "Take a look at the attached file." : "") };
    if (files.length) message.files = files;
    setDraft("");
    setFiles([]);
    let chatId = activeId;
    let history;
    if (!active) {
      chatId = newId();
      history = [message];
      save([{ id: chatId, title: titleFrom(content || files[0].name), at: Date.now(), messages: history }, ...chats]);
      setActiveId(chatId);
    } else {
      history = [...messages.filter((entry) => !(entry.role === "assistant" && !entry.content)), message];
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
    setFiles([]);
    setListOpen(false);
    if (tool !== "chat") navigate("/ai");
    requestAnimationFrame(() => input.current?.focus());
  }

  function openChat(id) {
    if (busy && id !== activeId) abort.current?.abort();
    setActiveId(id);
    setListOpen(false);
    if (tool !== "chat") navigate("/ai");
  }

  function remove(id) {
    if (id === activeId) {
      abort.current?.abort();
      setActiveId(null);
    }
    save(chats.filter((chat) => chat.id !== id));
  }

  async function attach(list) {
    const room = MAX_FILES - files.length;
    if (room <= 0) return toast(`you can attach up to ${MAX_FILES} files per message`);
    const picked = [...list].slice(0, room);
    for (const file of picked) {
      try {
        const read = await readTextFile(file);
        setFiles((current) => [...current, read].slice(0, MAX_FILES));
      } catch (error) {
        toast(error.message, { kind: "error" });
      }
    }
  }

  const sorted = useMemo(() => [...chats].sort((a, b) => (b.at || 0) - (a.at || 0)), [chats]);
  const name = me.value?.displayName;
  const working = busy || toolBusy;

  return (
    <main class={`ai ${listOpen ? "list-open" : ""}`}>
      <aside class="ai-side glass">
        <nav class="ai-tools" aria-label="AI tools">
          <button class={tool === "chat" ? "active" : ""} onClick={() => (navigate("/ai"), setListOpen(false))}>
            <Icon name="chat" size={15} /> Chat
          </button>
          {Object.entries(TOOL_INFO).map(([id, entry]) => (
            <button key={id} class={tool === id ? "active" : ""} onClick={() => (navigate(`/ai/${id}`), setListOpen(false))}>
              <Icon name={entry.icon} size={15} /> {entry.title}
            </button>
          ))}
        </nav>
        <button class="ai-new" onClick={startNew}>
          <Icon name="newChat" size={17} /> New chat
        </button>
        <div class="ai-chats" role="list">
          {sorted.length === 0 && <p class="ai-side-empty">Your chats show up here. They stay on this device.</p>}
          {sorted.map((chat) => (
            <div key={chat.id} role="listitem" class={`ai-chat ${tool === "chat" && chat.id === activeId ? "active" : ""}`}>
              <button class="ai-chat-open" onClick={() => openChat(chat.id)}>
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
          <button class="btn ghost icon-only sm ai-list-toggle" aria-label="Chats and tools" onClick={() => setListOpen(!listOpen)}>
            <Icon name="list" size={17} />
          </button>
          <Dropdown
            class="ai-model"
            label="Model"
            icon="ai"
            value={model}
            onChange={setModel}
            disabled={working}
            options={models.map((entry) => ({ value: entry.id, label: entry.name, hint: entry.id === "auto" ? undefined : entry.maker }))}
          />
          <div class="ai-head-actions">
            {tool === "chat" && (
              <>
                <button
                  class={`btn ghost icon-only sm ${storage.get("aiInstructions", "") ? "lit" : ""}`}
                  aria-label="Custom instructions"
                  data-tip="Custom instructions"
                  onClick={() => setEditing(true)}
                >
                  <Icon name="sliders" size={16} />
                </button>
                <button class="btn ghost icon-only sm" aria-label="New chat" data-tip="New chat" onClick={startNew}>
                  <Icon name="newChat" size={17} />
                </button>
              </>
            )}
          </div>
        </header>

        {tool !== "chat" ? (
          <div class="ai-scroll">
            <AITool key={tool} tool={tool} model={model} onBusy={setToolBusy} />
          </div>
        ) : (
          <>
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
              onDragOver={(event) => event.preventDefault()}
              onDrop={(event) => {
                if (!event.dataTransfer?.files?.length) return;
                event.preventDefault();
                attach(event.dataTransfer.files);
              }}
            >
              <div class="ai-input">
                <FileChips files={files} onRemove={(index) => setFiles(files.filter((_, i) => i !== index))} />
                <div class="ai-input-row">
                  <button
                    type="button"
                    class="ai-attach"
                    aria-label="Attach a file"
                    data-tip="Attach a text file"
                    onClick={() => picker.current?.click()}
                  >
                    <Icon name="attach" size={16} />
                  </button>
                  <input
                    ref={picker}
                    type="file"
                    multiple
                    hidden
                    accept=".txt,.md,.markdown,.csv,.tsv,.json,.xml,.html,.css,.js,.jsx,.ts,.tsx,.py,.java,.c,.cpp,.h,.cs,.go,.rs,.rb,.php,.swift,.kt,.sql,.yml,.yaml,.ini,.log,.tex,text/*"
                    onChange={(event) => {
                      attach(event.currentTarget.files);
                      event.currentTarget.value = "";
                    }}
                  />
                  <textarea
                    ref={input}
                    rows={1}
                    value={draft}
                    placeholder="Message blackwaves AI"
                    aria-label="Message"
                    maxLength={60000}
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
                    <button type="submit" class="ai-send" aria-label="Send" disabled={!draft.trim() && !files.length}>
                      <Icon name="send" size={15} />
                    </button>
                  )}
                </div>
              </div>
              <p class="ai-note">Free models through OpenRouter. AI gets things wrong, so check anything important.</p>
            </form>
          </>
        )}
      </section>
      {editing && <Instructions onClose={() => setEditing(false)} />}
    </main>
  );
}
