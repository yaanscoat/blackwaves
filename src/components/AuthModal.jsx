import { useState } from "preact/hooks";
import { Modal } from "./Modal.jsx";
import { authOpen } from "../lib/ui.js";
import { login, register } from "../lib/account.js";

export function AuthModal() {
  const mode = authOpen.value;
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  if (!mode) return null;
  const isRegister = mode === "register";

  const submit = async (event, close) => {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      if (isRegister) await register(username, password, displayName || username);
      else await login(username, password);
      close();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal title={isRegister ? "Create your account" : "Sign in to CloudSync"} onClose={() => (authOpen.value = null)}>
      {(close) => (
        <form class="auth-form" onSubmit={(event) => submit(event, close)}>
          <p class="muted">
            {isRegister
              ? "One account keeps your settings, history and favorites synced, and unlocks chat, coins and the shop."
              : "Welcome back. Your settings and favorites sync as soon as you're in."}
          </p>
          <label class="field">
            <span>Username</span>
            <input class="input" autocomplete="username" value={username} onInput={(e) => setUsername(e.currentTarget.value)} required minLength={3} maxLength={20} />
          </label>
          {isRegister && (
            <label class="field">
              <span>Display name (optional)</span>
              <input class="input" value={displayName} onInput={(e) => setDisplayName(e.currentTarget.value)} maxLength={32} />
            </label>
          )}
          <label class="field">
            <span>Password</span>
            <input
              class="input"
              type="password"
              autocomplete={isRegister ? "new-password" : "current-password"}
              value={password}
              onInput={(e) => setPassword(e.currentTarget.value)}
              required
              minLength={6}
            />
          </label>
          {error && <p class="form-error">{error}</p>}
          <button class="btn primary" disabled={busy}>
            {busy ? "One sec..." : isRegister ? "Create account" : "Sign in"}
          </button>
          <button type="button" class="btn ghost" onClick={() => (authOpen.value = isRegister ? "login" : "register")}>
            {isRegister ? "I already have an account" : "I need an account"}
          </button>
        </form>
      )}
    </Modal>
  );
}
