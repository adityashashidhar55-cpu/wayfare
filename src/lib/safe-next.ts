/**
 * r33 SECURITY: where to send someone after they sign in.
 *
 * The check here used to be `next.startsWith("/") ? next : "/trips"`, which is
 * not a same-origin test. "//evil.example" starts with "/" and is a
 * PROTOCOL-RELATIVE URL, so window.location.href sends the browser straight
 * off-site - one second after the person typed their password, from a link on
 * the real domain. That is a working credential-phishing primitive, and
 * /login?next= is reachable by anyone who can send a URL.
 *
 * Resolving against the real origin and comparing is the check that actually
 * holds: it rejects "//host", "https://host", "javascript:", and backslash
 * variants without needing to enumerate them one by one.
 */
export function safeNextPath(raw: string | null | undefined, origin: string): string {
  if (!raw) return "/trips";
  try {
    const url = new URL(raw, origin);
    if (url.origin !== origin) return "/trips";
    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return "/trips";
  }
}
