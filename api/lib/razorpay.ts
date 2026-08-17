/**
 * razorpay.ts (r27) - real payments.
 *
 * Replaces the mock in billing-router, which flipped a user's tier to
 * "voyager" on an unauthenticated client call with no money involved. That was
 * not a stub waiting for a provider, it was a free upgrade button.
 *
 * WHY RAZORPAY AND NOT STRIPE: Wayfare is India-first (rupee price points are
 * hardcoded in contracts/premium.ts) and Stripe India does not support UPI,
 * which is how the overwhelming majority of Indian consumers pay. Razorpay
 * covers UPI, cards, netbanking and wallets in one integration.
 *
 * No SDK. Razorpay's REST API is HTTP Basic (key_id:key_secret) plus an
 * HMAC-SHA256 signature check - about forty lines - and this repo cannot
 * afford another npm dependency while the inherited lockfile is still fragile.
 *
 * TRUST MODEL, which is the whole point of this file:
 *   - The browser never states a price. The server reads it from
 *     contracts/premium.ts and sends it to Razorpay when creating the order.
 *   - The browser never states an outcome. Entitlement is granted only after
 *     an HMAC signature computed with a secret the browser has never seen
 *     verifies over (order_id | payment_id).
 *   - The webhook is the authoritative path (it arrives even if the user
 *     closes the tab mid-redirect); the client handoff is an optimisation so
 *     the UI updates instantly. Both funnel through the same activation.
 */
import { createHmac, timingSafeEqual } from "node:crypto";
import { env } from "./env";

const API_BASE = "https://api.razorpay.com/v1";
const TIMEOUT_MS = 15_000;

export interface RazorpayOrder {
  id: string;
  amount: number;
  currency: string;
  status: string;
  receipt?: string;
}

export class PaymentProviderError extends Error {
  constructor(message: string, readonly status?: number) {
    super(message);
    this.name = "PaymentProviderError";
  }
}

function authHeader(): string {
  const raw = `${env.razorpayKeyId}:${env.razorpayKeySecret}`;
  return `Basic ${Buffer.from(raw, "utf8").toString("base64")}`;
}

/**
 * Create an order. `amount` is minor units (paise for INR, cents for USD) and
 * comes from the server-side price table, never from the request body.
 */
export async function createOrder(opts: {
  amountMinor: number;
  currency: string;
  receipt: string;
  notes?: Record<string, string>;
}): Promise<RazorpayOrder> {
  if (!env.razorpayKeyId || !env.razorpayKeySecret) {
    throw new PaymentProviderError("Payments are not configured on this deployment");
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(`${API_BASE}/orders`, {
      method: "POST",
      headers: { authorization: authHeader(), "content-type": "application/json" },
      body: JSON.stringify({
        amount: opts.amountMinor,
        currency: opts.currency,
        // Razorpay caps receipt at 40 chars and rejects longer ones outright.
        receipt: opts.receipt.slice(0, 40),
        payment_capture: 1,
        notes: opts.notes ?? {},
      }),
      signal: controller.signal,
    });
    const body = (await res.json().catch(() => ({}))) as
      | RazorpayOrder
      | { error?: { description?: string } };
    if (!res.ok) {
      const desc = (body as { error?: { description?: string } }).error?.description;
      throw new PaymentProviderError(desc ?? `Razorpay returned ${res.status}`, res.status);
    }
    return body as RazorpayOrder;
  } catch (e) {
    if (e instanceof PaymentProviderError) throw e;
    throw new PaymentProviderError(e instanceof Error ? e.message : String(e));
  } finally {
    clearTimeout(timer);
  }
}

/** Fetch a payment, used by the webhook path to re-read authoritative state. */
export async function fetchPayment(paymentId: string): Promise<Record<string, unknown> | null> {
  if (!env.razorpayKeyId || !env.razorpayKeySecret) return null;
  try {
    const res = await fetch(`${API_BASE}/payments/${encodeURIComponent(paymentId)}`, {
      headers: { authorization: authHeader() },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) return null;
    return (await res.json()) as Record<string, unknown>;
  } catch {
    return null;
  }
}

/**
 * Verify the signature Razorpay Checkout hands back to the browser:
 * HMAC-SHA256(order_id + "|" + payment_id) keyed with the API secret.
 */
export function verifyCheckoutSignature(opts: {
  orderId: string;
  paymentId: string;
  signature: string;
}): boolean {
  if (!env.razorpayKeySecret) return false;
  const expected = createHmac("sha256", env.razorpayKeySecret)
    .update(`${opts.orderId}|${opts.paymentId}`)
    .digest("hex");
  return safeEqualHex(expected, opts.signature);
}

/**
 * Verify a webhook. The HMAC is over the RAW request body with the webhook
 * secret - which is a different secret from the API key, and a common thing to
 * get wrong. Re-serialising the parsed JSON would change the bytes and break
 * the comparison, so callers must pass the exact string they received.
 */
export function verifyWebhookSignature(rawBody: string, signature: string): boolean {
  if (!env.razorpayWebhookSecret) return false;
  const expected = createHmac("sha256", env.razorpayWebhookSecret).update(rawBody).digest("hex");
  return safeEqualHex(expected, signature);
}

/** Constant-time hex compare that tolerates a malformed candidate. */
function safeEqualHex(expected: string, candidate: string): boolean {
  const a = Buffer.from(expected, "utf8");
  const b = Buffer.from((candidate ?? "").trim(), "utf8");
  if (a.length !== b.length) return false;
  try {
    return timingSafeEqual(a, b);
  } catch {
    return false;
  }
}
