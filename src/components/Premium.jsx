import { useState } from "preact/hooks";
import { Modal } from "./Modal.jsx";
import { Icon } from "./Icon.jsx";
import { me, refreshMe } from "../lib/account.js";
import { openAuth } from "../lib/ui.js";
import { toast } from "../lib/notify.js";
import { PERKS, awaitingPayment, premiumOpen, startCheckout } from "../lib/premium.js";

const FOREVER = 253402300799000;

export function PremiumModal() {
  const [busy, setBusy] = useState(false);
  if (!premiumOpen.value) return null;
  const user = me.value;
  const premium = Boolean(user?.premium);

  const buy = async () => {
    setBusy(true);
    try {
      await startCheckout();
    } catch (error) {
      toast(error.message, { kind: "error" });
    } finally {
      setBusy(false);
    }
  };

  const checkAgain = async () => {
    setBusy(true);
    await refreshMe();
    setBusy(false);
    if (!me.value?.premium) toast("no payment yet. it usually shows up within a few seconds of paying.");
  };

  return (
    <Modal title="blackwaves Premium" onClose={() => (premiumOpen.value = false)} class="premium-modal">
      {(close) => (
        <div class="premium">
          <div class="premium-hero">
            <span class="premium-crown">
              <Icon name="crown" size={26} />
            </span>
            <div>
              <h3>{premium ? "You're Premium" : "Get more out of blackwaves"}</h3>
              <p class="muted small">
                {premium
                  ? user.premiumUntil >= FOREVER
                    ? "Thank you for supporting blackwaves. Everything below is unlocked on your account."
                    : `Thank you for supporting blackwaves. Your Premium lasts until ${new Date(user.premiumUntil).toLocaleDateString()}.`
                  : "Premium unlocks extra AI features and priority search, and it helps keep blackwaves running."}
              </p>
            </div>
          </div>

          <ul class="premium-perks">
            {PERKS.map((perk) => (
              <li key={perk.title}>
                <Icon name={perk.icon} size={16} />
                <span>
                  <strong>{perk.title}</strong>
                  <span class="muted small">{perk.body}</span>
                </span>
              </li>
            ))}
          </ul>

          {!user && (
            <div class="premium-cta">
              <p class="small">Premium belongs to a CloudSync account, so it follows you to every device you sign in on. Sign in or make a free account first.</p>
              <div class="btn-row">
                <button class="btn primary" onClick={() => (close(), openAuth("register"))}>
                  Create account
                </button>
                <button class="btn" onClick={() => (close(), openAuth("login"))}>
                  Sign in
                </button>
              </div>
            </div>
          )}

          {user && !premium && (
            <div class="premium-cta">
              {awaitingPayment.value ? (
                <>
                  <p class="small">
                    <span class="premium-wait" /> Finish paying in the Stripe tab. Premium turns on by itself a few seconds after you pay, on{" "}
                    <strong>@{user.username}</strong>.
                  </p>
                  <div class="btn-row">
                    <button class="btn" onClick={checkAgain} disabled={busy}>
                      <Icon name="refresh" size={15} /> I've paid, check again
                    </button>
                    <button class="btn ghost" onClick={buy} disabled={busy}>
                      Open checkout again
                    </button>
                  </div>
                </>
              ) : (
                <>
                  <button class="btn primary premium-buy" onClick={buy} disabled={busy}>
                    <Icon name="crown" size={16} /> Get Premium
                  </button>
                  <p class="faint small">
                    Premium goes to <strong>@{user.username}</strong>. Checkout is handled by Stripe in a new tab, and blackwaves never sees your card details.
                  </p>
                </>
              )}
            </div>
          )}
        </div>
      )}
    </Modal>
  );
}
