import { signal } from "@preact/signals";
import { useState } from "preact/hooks";
import { Modal } from "./Modal.jsx";
import { readCookie, writeCookie } from "../lib/storage.js";
import { navigate } from "../lib/router.js";
import { setSetting } from "../lib/settings.js";

export const consent = signal(null);

export function loadConsent() {
  try {
    const saved = JSON.parse(readCookie("bw_consent") || "null");
    consent.value = saved || null;
  } catch {
    consent.value = null;
  }
}

export function saveConsent(choices) {
  const value = { essential: true, presence: Boolean(choices.presence), suggestions: Boolean(choices.suggestions), at: Date.now() };
  writeCookie("bw_consent", JSON.stringify(value));
  consent.value = value;
  setSetting("suggestions", value.suggestions);
  setSetting("showOnline", value.presence);
}

function Choice({ title, body, checked, locked, onChange }) {
  return (
    <label class={`consent-choice ${locked ? "locked" : ""}`}>
      <span>
        <strong>{title}</strong>
        <span class="muted small">{body}</span>
      </span>
      <button
        type="button"
        class="toggle"
        role="switch"
        aria-checked={checked}
        aria-label={title}
        disabled={locked}
        onClick={() => !locked && onChange(!checked)}
      />
    </label>
  );
}

export function Welcome() {
  const [custom, setCustom] = useState(false);
  const [choices, setChoices] = useState({ presence: true, suggestions: true });
  if (consent.value) return null;

  const legal = (doc) => (event) => {
    event.preventDefault();
    navigate(`/legal/${doc}`);
  };

  return (
    // closing without picking (esc / clicking outside) means essential only, but never
    // overwrite a choice that one of the buttons just saved
    <Modal title="Welcome to blackwaves" onClose={() => !consent.value && saveConsent({ presence: false, suggestions: false })} class="welcome" hideHead>
      {(close) => (
        <div class="welcome-body">
          <img class="logo-img welcome-logo" src="/favicon.ico" alt="" />
          <h1>Welcome to blackwaves</h1>
          <p class="muted">
            Games, movies, music, manga, a proxy browser and a chat, all in one tab. Before you dive in, pick which cookies we can use.
          </p>
          <div class="consent-list">
            <Choice
              title="Essential"
              body="The key that encrypts everything blackwaves saves on your device, and your sign-in. Clearing your cookies resets blackwaves."
              checked
              locked
            />
            {custom && (
              <>
                <Choice
                  title="Online counter"
                  body="Counts you (anonymously) in the online number. Turning it off hides the counter too."
                  checked={choices.presence}
                  onChange={(value) => setChoices({ ...choices, presence: value })}
                />
                <Choice
                  title="Search suggestions"
                  body="Sends what you type in the search bar to our server so it can suggest searches."
                  checked={choices.suggestions}
                  onChange={(value) => setChoices({ ...choices, suggestions: value })}
                />
              </>
            )}
          </div>
          <div class="welcome-actions">
            {custom ? (
              <button class="btn primary" onClick={() => (saveConsent(choices), close())}>
                Save my choices
              </button>
            ) : (
              <>
                <button class="btn primary" onClick={() => (saveConsent({ presence: true, suggestions: true }), close())}>
                  Accept all
                </button>
                <button class="btn" onClick={() => (saveConsent({ presence: false, suggestions: false }), close())}>
                  Essential only
                </button>
                <button class="btn ghost" onClick={() => setCustom(true)}>
                  Customize
                </button>
              </>
            )}
          </div>
          <p class="faint small welcome-legal">
            By using blackwaves you agree to the <a href="/legal/terms" onClick={legal("terms")}>Terms of Service</a>. Read the{" "}
            <a href="/legal/privacy" onClick={legal("privacy")}>Privacy Policy</a>, <a href="/legal/cookies" onClick={legal("cookies")}>Cookie Policy</a> and{" "}
            <a href="/legal/dmca" onClick={legal("dmca")}>DMCA page</a>.
          </p>
        </div>
      )}
    </Modal>
  );
}
