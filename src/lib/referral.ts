/**
 * Referral capture (r14-linkfix): a visitor arriving at /login?ref=<code>
 * gets the code stashed in sessionStorage so it survives the OAuth round
 * trip; once signed in, useAuth claims it via auth.claimReferral.
 */

const REF_STORAGE_KEY = 'wayfare:ref';
/** Server-side minted codes are 10 url-safe chars; be lenient on case mix. */
const REF_CODE_RE = /^[A-Za-z0-9]{8,16}$/;

/** Persist a ?ref= param from the current URL (call on the login page). */
export function captureReferralParam(search: string = window.location.search): void {
  try {
    const code = new URLSearchParams(search).get('ref');
    if (code && REF_CODE_RE.test(code)) {
      sessionStorage.setItem(REF_STORAGE_KEY, code);
    }
  } catch {
    /* sessionStorage unavailable\u2014 referral simply won't be attributed */
  }
}

/** Read the stashed code without clearing it (null when absent/invalid). */
export function peekReferralCode(): string | null {
  try {
    const code = sessionStorage.getItem(REF_STORAGE_KEY);
    return code && REF_CODE_RE.test(code) ? code : null;
  } catch {
    return null;
  }
}

/** Drop the stashed code (after a claim attempt - success or not). */
export function clearReferralCode(): void {
  try {
    sessionStorage.removeItem(REF_STORAGE_KEY);
  } catch {
    /* ignore */
  }
}
