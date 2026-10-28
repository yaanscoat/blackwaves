// blackwaves premium. people pay through a stripe payment link; we add
// ?client_reference_id=bw-<user id> to it, and when the checkout finishes stripe
// calls our webhook with that id. the webhook is the only thing that can turn
// premium on, and it has to carry stripe's signature, so a page (or someone with
// curl) can't fake a payment. premium belongs to a cloudsync account, never a device.
import crypto from "node:crypto";
import { config } from "../config.js";
import { sql, transaction } from "../lib/db.js";
import { HttpError, readBody } from "../lib/http.js";
import { getUserById, isPremium } from "./accounts.js";

// "for good", as a date sqlite and javascript both handle
export const FOREVER = 253402300799000;
const DAY = 24 * 60 * 60 * 1000;
const REFERENCE = /^bw-(\d{1,12})$/;
// stripe signs every webhook with a timestamp; older than this is a replay
const TOLERANCE_S = 5 * 60;

/** what the premium page needs to know about you */
export function premiumStatus(user) {
  if (!user) return { signedIn: false, premium: false, until: 0, checkout: null };
  const url = new URL(config.premiumLink);
  url.searchParams.set("client_reference_id", `bw-${user.id}`);
  return {
    signedIn: true,
    premium: isPremium(user),
    until: user.premium_until || 0,
    forever: user.premium_until >= FOREVER,
    checkout: url.toString(),
    // false until the server is set up to hear about payments
    ready: Boolean(config.stripeWebhookSecret),
  };
}

/** sets users.premium_until from their active payments */
function recompute(userId) {
  if (!userId) return;
  const row = sql("SELECT MAX(until) AS until FROM payments WHERE user_id = ? AND status = 'active'").get(userId);
  sql("UPDATE users SET premium_until = ? WHERE id = ?").run(row?.until || 0, userId);
}

function untilFrom(userId, kind) {
  if (kind === "subscription" || config.premiumDays <= 0) return FOREVER;
  // time-limited passes stack: buying again before it runs out adds to the end
  const current = getUserById(userId)?.premium_until || 0;
  return Math.max(Date.now(), current) + config.premiumDays * DAY;
}

// ---- stripe webhook ----------------------------------------------------------------

function signatureOk(raw, header, secret) {
  const parts = String(header || "").split(",").map((part) => part.trim().split("="));
  const timestamp = Number(parts.find(([key]) => key === "t")?.[1]);
  const signatures = parts.filter(([key]) => key === "v1").map(([, value]) => value || "");
  if (!timestamp || !signatures.length || Math.abs(Date.now() / 1000 - timestamp) > TOLERANCE_S) return false;
  const expected = crypto.createHmac("sha256", secret).update(Buffer.concat([Buffer.from(`${timestamp}.`), raw])).digest("hex");
  return signatures.some((signature) => signature.length === expected.length && crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected)));
}

function grantFromCheckout(session) {
  const match = REFERENCE.exec(String(session.client_reference_id || ""));
  if (!match) return null;
  // bank transfers and the like finish later; stripe sends async_payment_succeeded then
  if (session.payment_status !== "paid" && session.payment_status !== "no_payment_required") return null;
  const userId = Number(match[1]);
  if (!getUserById(userId)) return null;
  const kind = session.mode === "subscription" ? "subscription" : "payment";
  return transaction(() => {
    // stripe retries webhooks, so the same checkout can arrive twice; count it once
    const inserted = sql(
      `INSERT OR IGNORE INTO payments (id, user_id, kind, status, until, subscription, payment_intent, amount, currency, created_at)
       VALUES (?, ?, ?, 'active', ?, ?, ?, ?, ?, ?)`,
    ).run(
      String(session.id),
      userId,
      kind,
      untilFrom(userId, kind),
      session.subscription ? String(session.subscription) : null,
      session.payment_intent ? String(session.payment_intent) : null,
      Number(session.amount_total) || 0,
      String(session.currency || ""),
      Date.now(),
    );
    if (!inserted.changes) return null;
    recompute(userId);
    return userId;
  });
}

/** marks matching payments with a new status and returns the users that changed */
function setStatus(column, value, status) {
  if (!value) return [];
  const rows = sql(`SELECT DISTINCT user_id FROM payments WHERE ${column} = ?`).all(String(value));
  // refunds are final; a later subscription update can't undo them
  sql(`UPDATE payments SET status = ? WHERE ${column} = ? AND status NOT IN ('refunded', 'revoked')`).run(status, String(value));
  for (const row of rows) recompute(row.user_id);
  return rows.map((row) => row.user_id);
}

const SUBSCRIPTION_ENDED = new Set(["canceled", "unpaid", "incomplete_expired", "paused"]);

/** applies one stripe event and returns the ids of users whose premium changed */
function applyEvent(event) {
  const object = event?.data?.object || {};
  switch (event?.type) {
    case "checkout.session.completed":
    case "checkout.session.async_payment_succeeded": {
      const userId = grantFromCheckout(object);
      return userId ? [userId] : [];
    }
    case "customer.subscription.deleted":
      return setStatus("subscription", object.id, "ended");
    case "customer.subscription.updated":
      return setStatus("subscription", object.id, SUBSCRIPTION_ENDED.has(object.status) ? "ended" : "active");
    case "charge.refunded":
      // a partial refund keeps premium; only a full one takes it away
      return object.refunded ? setStatus("payment_intent", object.payment_intent, "refunded") : [];
    case "charge.dispute.created":
      return setStatus("payment_intent", object.payment_intent, "refunded");
    default:
      return [];
  }
}

/**
 * POST /api/premium/webhook. stripe needs the exact bytes it sent to check the
 * signature, so this reads the raw body itself. returns the users that changed.
 */
export async function stripeWebhook(req) {
  if (!config.stripeWebhookSecret) throw new HttpError(503, "premium payments aren't set up on this server (STRIPE_WEBHOOK_SECRET)");
  const raw = await readBody(req, 512 * 1024);
  if (!signatureOk(raw, req.headers["stripe-signature"], config.stripeWebhookSecret)) throw new HttpError(400, "bad signature");
  let event;
  try {
    event = JSON.parse(raw.toString("utf8"));
  } catch {
    throw new HttpError(400, "that wasn't valid json");
  }
  const changed = applyEvent(event);
  if (changed.length) console.log(`premium: ${event.type} updated user ${changed.join(", ")}`);
  return changed;
}
