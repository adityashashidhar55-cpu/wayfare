/**
 * r15-access: helpers for the trips.get FORBIDDEN flow.
 *
 * When a signed-in non-member opens a copied workspace URL, the server keeps
 * the 403 but attaches the trip's ACTIVE public shareToken to the error's
 * serialized cause (error.data.cause.shareToken). The client then redirects
 * to the public read-only /shared/<token> view instead of a dead error page.
 */

/** Pull `cause.shareToken` out of a trips.get error, if the server sent one. */
export function shareTokenFromError(error: unknown): string | null {
  const cause = (error as { data?: { cause?: unknown } } | null | undefined)
    ?.data?.cause;
  if (cause && typeof cause === "object") {
    const token = (cause as { shareToken?: unknown }).shareToken;
    if (typeof token === "string" && token.length > 0) return token;
  }
  return null;
}

/** True when a trips.get failure is specifically a membership 403. */
export function isForbiddenError(error: unknown): boolean {
  return (
    (error as { data?: { code?: string } } | null | undefined)?.data?.code ===
    "FORBIDDEN"
  );
}
