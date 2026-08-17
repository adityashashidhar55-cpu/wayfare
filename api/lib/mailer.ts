/**
 * mailer.ts (r27) - transactional email.
 *
 * Before this file there was NO outbound mail anywhere in the codebase. That
 * single gap broke three separate features:
 *   1. Trip invites. `trips.addMember` wrote a pending trip_members row with
 *      userId: null and told the invitee nothing. The only way anyone learned
 *      they had been invited was if the organiser messaged them by hand.
 *   2. Password reset. There was no reset flow at all, so a forgotten password
 *      meant a dead account.
 *   3. Any future digest / notification email.
 *
 * Provider: Resend, over plain HTTPS. Deliberately NOT the `resend` npm
 * package - the API is one POST, and this repo's build already suffers from a
 * corrupt lockfile inherited from the Kimi export. Zero new dependencies.
 *
 * Fail-open contract, same as api/lib/cache.ts: sending mail must NEVER fail
 * the action that triggered it. Every function here resolves; none reject. If
 * RESEND_API_KEY is unset the mailer reports `disabled` and the app keeps
 * working exactly as it does today, which is what makes this safe to deploy
 * before the key exists.
 */
import { env } from "./env";

export type MailResult =
  | { ok: true; id: string }
  | { ok: false; reason: "disabled" | "invalid" | "error"; detail?: string };

const RESEND_ENDPOINT = "https://api.resend.com/emails";
const SEND_TIMEOUT_MS = 10_000;

/** True when a provider key and a From address are both configured. */
export function mailerEnabled(): boolean {
  return Boolean(env.resendApiKey && env.mailFrom);
}

export interface SendMailInput {
  to: string;
  subject: string;
  /** Full HTML body. Wrap with `layout()` for the standard Wayfare shell. */
  html: string;
  /** Plain-text alternative. Generated from the HTML when omitted. */
  text?: string;
  replyTo?: string;
}

/**
 * Send one email. Never throws.
 *
 * Returns a discriminated result rather than a boolean so callers can tell
 * "the operator has not set this up yet" (disabled) from "we tried and the
 * provider refused" (error) - the first is expected in dev, the second is
 * worth logging loudly.
 */
export async function sendMail(input: SendMailInput): Promise<MailResult> {
  if (!mailerEnabled()) {
    // Not an error. In development this is the normal path, and printing the
    // link to the server log is what lets you complete an invite or a reset
    // locally without a provider account.
    console.info(`[mail:disabled] would send "${input.subject}" to ${input.to}`);
    return { ok: false, reason: "disabled" };
  }
  if (!isEmail(input.to)) return { ok: false, reason: "invalid" };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), SEND_TIMEOUT_MS);
  try {
    const res = await fetch(RESEND_ENDPOINT, {
      method: "POST",
      headers: {
        authorization: `Bearer ${env.resendApiKey}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        from: env.mailFrom,
        to: [input.to],
        subject: input.subject,
        html: input.html,
        text: input.text ?? htmlToText(input.html),
        ...(input.replyTo ? { reply_to: input.replyTo } : {}),
      }),
      signal: controller.signal,
    });
    const body = (await res.json().catch(() => ({}))) as { id?: string; message?: string };
    if (!res.ok) {
      console.warn(`[mail:error] ${res.status} ${body.message ?? "send failed"}`);
      return { ok: false, reason: "error", detail: body.message };
    }
    return { ok: true, id: body.id ?? "" };
  } catch (e) {
    const detail = e instanceof Error ? e.message : String(e);
    console.warn("[mail:error]", detail);
    return { ok: false, reason: "error", detail };
  } finally {
    clearTimeout(timer);
  }
}

// ── Templates ───────────────────────────────────────────────────────────────

/** Absolute URL for a path, using APP_URL (falls back to the prod domain). */
export function appUrl(path: string): string {
  const base = (env.appUrl || "https://wayfare.app").replace(/\/+$/, "");
  return `${base}${path.startsWith("/") ? path : `/${path}`}`;
}

/**
 * Shared HTML shell. Inline styles only, tables avoided - modern clients
 * handle this fine and it keeps the template readable. Kept deliberately
 * plain: a text-forward invite lands in the inbox far more often than a
 * heavily-imaged one lands anywhere but Promotions.
 */
function layout(heading: string, bodyHtml: string, cta?: { label: string; href: string }): string {
  const button = cta
    ? `<p style="margin:28px 0"><a href="${escapeAttr(cta.href)}" style="background:#0f766e;color:#fff;padding:12px 22px;border-radius:8px;text-decoration:none;font-weight:600;display:inline-block">${escapeHtml(cta.label)}</a></p>
       <p style="margin:0 0 8px;color:#6b7280;font-size:13px">Or paste this link into your browser:</p>
       <p style="margin:0;color:#6b7280;font-size:13px;word-break:break-all">${escapeHtml(cta.href)}</p>`
    : "";
  return `<!doctype html><html><body style="margin:0;padding:24px;background:#f8fafc;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#111827">
  <div style="max-width:520px;margin:0 auto;background:#fff;border-radius:12px;padding:32px">
    <p style="margin:0 0 24px;font-size:18px;font-weight:700;color:#0f766e">Wayfare</p>
    <h1 style="margin:0 0 16px;font-size:22px;line-height:1.3">${escapeHtml(heading)}</h1>
    ${bodyHtml}
    ${button}
  </div>
  <p style="max-width:520px;margin:16px auto 0;color:#9ca3af;font-size:12px;text-align:center">
    Sent by Wayfare. If you weren't expecting this you can ignore it safely.
  </p>
</body></html>`;
}

/** "Priya added you to Kerala, 12-19 Mar" - the trip invite. */
export async function sendTripInvite(opts: {
  to: string;
  inviteeName: string;
  inviterName: string;
  tripTitle: string;
  tripDates?: string | null;
  role: "editor" | "viewer";
  /** Deep link. For a known user this is the trip; otherwise sign-up. */
  href: string;
}): Promise<MailResult> {
  const dates = opts.tripDates ? ` <span style="color:#6b7280">(${escapeHtml(opts.tripDates)})</span>` : "";
  const canEdit = opts.role === "editor";
  const html = layout(
    `${opts.inviterName} invited you to a trip`,
    `<p style="margin:0 0 12px;font-size:15px;line-height:1.6">Hi ${escapeHtml(opts.inviteeName)},</p>
     <p style="margin:0 0 12px;font-size:15px;line-height:1.6">
       <strong>${escapeHtml(opts.inviterName)}</strong> added you to
       <strong>${escapeHtml(opts.tripTitle)}</strong>${dates} on Wayfare.
     </p>
     <p style="margin:0;font-size:15px;line-height:1.6">
       ${canEdit
         ? "You can add stops, split expenses and edit the day-by-day plan together."
         : "You can follow the plan and see everything as it comes together."}
     </p>`,
    { label: "Open the trip", href: opts.href },
  );
  return sendMail({ to: opts.to, subject: `${opts.inviterName} invited you to ${opts.tripTitle}`, html });
}

/** One-time password reset link. */
export async function sendPasswordReset(opts: {
  to: string;
  name?: string | null;
  href: string;
  expiresMinutes: number;
}): Promise<MailResult> {
  const html = layout(
    "Reset your password",
    `<p style="margin:0 0 12px;font-size:15px;line-height:1.6">Hi ${escapeHtml(opts.name || "there")},</p>
     <p style="margin:0 0 12px;font-size:15px;line-height:1.6">
       Use the link below to choose a new password. It works once and expires in
       ${opts.expiresMinutes} minutes.
     </p>
     <p style="margin:0;font-size:15px;line-height:1.6;color:#6b7280">
       If you didn't ask for this, nothing has changed on your account and you can ignore this email.
     </p>`,
    { label: "Choose a new password", href: opts.href },
  );
  return sendMail({ to: opts.to, subject: "Reset your Wayfare password", html });
}

/** Sent after a successful reset, so a hijack is visible to the real owner. */
export async function sendPasswordChanged(opts: { to: string; name?: string | null }): Promise<MailResult> {
  const html = layout(
    "Your password was changed",
    `<p style="margin:0 0 12px;font-size:15px;line-height:1.6">Hi ${escapeHtml(opts.name || "there")},</p>
     <p style="margin:0 0 12px;font-size:15px;line-height:1.6">
       The password on your Wayfare account was just changed. If that was you, there's nothing to do.
     </p>
     <p style="margin:0;font-size:15px;line-height:1.6">
       If it wasn't, reset it immediately at ${escapeHtml(appUrl("/login"))}.
     </p>`,
  );
  return sendMail({ to: opts.to, subject: "Your Wayfare password was changed", html });
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function isEmail(v: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.trim());
}

function escapeHtml(v: string): string {
  return v
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function escapeAttr(v: string): string {
  return escapeHtml(v).replace(/'/g, "&#39;");
}

/** Crude but adequate text alternative - strips tags, collapses whitespace. */
function htmlToText(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|h1|h2|div)>/gi, "\n\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}
