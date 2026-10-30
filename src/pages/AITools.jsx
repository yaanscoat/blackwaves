// the paraphraser and the humanizer: paste text on the left, get the rewrite on
// the right. same free models as the chat, with a writing prompt of their own.
import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import { Icon } from "../components/Icon.jsx";
import { get } from "../lib/api.js";
import { streamAi } from "../lib/aistream.js";
import { storage } from "../lib/storage.js";

export const TOOL_INFO = {
  paraphrase: {
    title: "Paraphraser",
    icon: "paraphrase",
    verb: "Paraphrase",
    busy: "Rewording",
    placeholder: "Paste or type the text you want reworded.",
    blurb: "Rewords your text with new phrasing while keeping what it says.",
  },
  humanize: {
    title: "Humanizer",
    icon: "humanize",
    verb: "Humanize",
    busy: "Rewriting",
    placeholder: "Paste text that sounds stiff or robotic, and it comes back sounding like a person wrote it.",
    blurb: "Makes stiff or robotic text sound like a person wrote it.",
  },
};

const MODE_NAMES = {
  standard: "Standard",
  fluent: "Fluent",
  simple: "Simple",
  formal: "Formal",
  academic: "Academic",
  creative: "Creative",
  shorter: "Shorter",
  longer: "Longer",
  natural: "Natural",
  casual: "Casual",
  professional: "Professional",
  student: "Student",
};

// drafts survive switching between chat and the tools while the tab is open
const drafts = new Map();

const countWords = (text) => (text.trim() ? text.trim().split(/\s+/).length : 0);
const plain = (word) => word.toLowerCase().replace(/[^\p{L}\p{N}']/gu, "");

/**
 * which words of the rewrite are new: a longest-common-subsequence over words,
 * skipped for very long texts where it would cost too much memory
 */
function changedWords(before, after) {
  const a = before.split(/\s+/).filter(Boolean).map(plain);
  const parts = after.split(/(\s+)/);
  const b = parts.filter((_, index) => index % 2 === 0 && parts[index]).map(plain);
  if (!a.length || !b.length || a.length * b.length > 4_000_000) return null;
  const width = b.length + 1;
  const table = new Uint16Array((a.length + 1) * width);
  for (let i = a.length - 1; i >= 0; i--) {
    for (let j = b.length - 1; j >= 0; j--) {
      table[i * width + j] = a[i] === b[j] ? table[(i + 1) * width + j + 1] + 1 : Math.max(table[(i + 1) * width + j], table[i * width + j + 1]);
    }
  }
  const kept = new Set();
  for (let i = 0, j = 0; i < a.length && j < b.length; ) {
    if (a[i] === b[j]) kept.add(j++), i++;
    else if (table[(i + 1) * width + j] >= table[i * width + j + 1]) i++;
    else j++;
  }
  return { parts, kept };
}

function Highlighted({ before, after }) {
  const diff = useMemo(() => changedWords(before, after), [before, after]);
  if (!diff) return after;
  let word = -1;
  return diff.parts.map((part, index) => {
    if (index % 2 === 1 || !part) return part;
    word++;
    return diff.kept.has(word) ? part : <mark key={index}>{part}</mark>;
  });
}

export function AITool({ tool, model, onBusy }) {
  const info = TOOL_INFO[tool];
  const [limits, setLimits] = useState(null);
  const [mode, setMode] = useState(() => storage.get(`aiMode:${tool}`, null));
  const [text, setText] = useState(() => drafts.get(tool) || "");
  const [output, setOutput] = useState("");
  const [source, setSource] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [highlight, setHighlight] = useState(() => storage.get("aiHighlight", true));
  const abort = useRef(null);

  // the styles and the length limit come from the server
  useEffect(() => {
    get("/api/ai/tools")
      .then(setLimits)
      .catch(() => setLimits(null));
  }, []);

  useEffect(() => () => abort.current?.abort(), []);
  useEffect(() => onBusy?.(busy), [busy]);
  useEffect(() => drafts.set(tool, text), [text]);
  useEffect(() => storage.set("aiHighlight", highlight), [highlight]);

  const modes = limits?.tools?.[tool] || [];
  const current = modes.find((entry) => entry.id === mode) || modes[0];
  const limit = limits?.rewriteChars || 5000;
  const over = text.length > limit;

  function pickMode(entry) {
    setMode(entry.id);
    storage.set(`aiMode:${tool}`, entry.id);
  }

  async function run() {
    const input = text.trim();
    if (!input || busy || over) return;
    setBusy(true);
    setError("");
    setOutput("");
    setSource(input);
    const controller = new AbortController();
    abort.current = controller;
    let result = "";
    let pending = null;
    const flush = () => {
      pending = null;
      setOutput(result);
    };
    try {
      await streamAi(
        "/api/ai/rewrite",
        { tool, mode: current?.id, text: input, model },
        {
          signal: controller.signal,
          onEvent: (event) => {
            if (event.t) result += event.t;
            if (event.e) setError(event.e);
            pending ||= requestAnimationFrame(flush);
          },
        },
      );
      if (!result.trim()) setError((previous) => previous || "the model sent back nothing. try again or pick another model.");
    } catch (err) {
      if (err.name !== "AbortError") setError(err.message);
    } finally {
      if (pending) cancelAnimationFrame(pending);
      setOutput(result.trim());
      abort.current = null;
      setBusy(false);
    }
  }

  const copy = () =>
    navigator.clipboard?.writeText(output).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1400);
    });

  return (
    <div class="ai-tool">
      <div class="ai-tool-head">
        <div>
          <h1>
            <Icon name={info.icon} size={20} /> {info.title}
          </h1>
          <p>{info.blurb}</p>
        </div>
        <div class="ai-modes chips" role="radiogroup" aria-label="Style">
          {modes.map((entry) => (
            <button key={entry.id} class="chip" role="radio" aria-checked={current?.id === entry.id} onClick={() => pickMode(entry)}>
              {MODE_NAMES[entry.id] || entry.id}
            </button>
          ))}
        </div>
      </div>

      <div class="ai-panes">
        <div class={`ai-pane ${over ? "over" : ""}`}>
          <textarea
            value={text}
            placeholder={info.placeholder}
            aria-label="Text to rewrite"
            spellcheck
            onInput={(event) => setText(event.currentTarget.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
                event.preventDefault();
                run();
              } else if (event.key === "Escape" && busy) abort.current?.abort();
            }}
          />
          <div class="ai-pane-foot">
            <span class={over ? "ai-over" : ""}>
              {countWords(text).toLocaleString()} words · {text.length.toLocaleString()} / {limit.toLocaleString()}
            </span>
            {text && !busy && (
              <button class="btn ghost sm" onClick={() => setText("")}>
                Clear
              </button>
            )}
            {busy ? (
              <button class="btn sm" onClick={() => abort.current?.abort()}>
                <Icon name="stop" size={12} /> Stop
              </button>
            ) : (
              <button class="btn primary sm" disabled={!text.trim() || over} onClick={run} data-tip="Ctrl + Enter">
                <Icon name={info.icon} size={14} /> {info.verb}
              </button>
            )}
          </div>
        </div>

        <div class="ai-pane result" aria-live="polite">
          <div class="ai-output">
            {busy && !output && (
              <div class="ai-thinking live">
                <span class="ai-dots">
                  <i />
                  <i />
                  <i />
                </span>
                {info.busy}
              </div>
            )}
            {!busy && !output && !error && <p class="ai-output-empty">Your rewrite shows up here.</p>}
            {output && (highlight && !busy ? <Highlighted before={source} after={output} /> : output)}
            {busy && output && <span class="ai-caret" aria-hidden="true" />}
            {error && (
              <p class="ai-error">
                <Icon name="info" size={15} /> {error}
              </p>
            )}
          </div>
          {output && !busy && (
            <div class="ai-pane-foot">
              <span>{countWords(output).toLocaleString()} words</span>
              <label class="ai-switch">
                <input type="checkbox" checked={highlight} onChange={(event) => setHighlight(event.currentTarget.checked)} />
                Show changes
              </label>
              <button class="btn ghost sm icon-only" aria-label="Use as the new input" data-tip="Rewrite this again" onClick={() => setText(output)}>
                <Icon name="swap" size={14} />
              </button>
              <button class="btn ghost sm icon-only" aria-label="Try again" data-tip="Try again" onClick={run} disabled={over}>
                <Icon name="retry" size={14} />
              </button>
              <button class="btn sm" onClick={copy}>
                <Icon name={copied ? "check" : "copy"} size={14} /> {copied ? "Copied" : "Copy"}
              </button>
            </div>
          )}
        </div>
      </div>
      <p class="ai-note">Rewrites can change meaning, so read them over before you use them.</p>
    </div>
  );
}
