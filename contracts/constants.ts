export const Session = {
  cookieName: "kimi_sid",
  // Cookie lifetime and JWT lifetime must agree, otherwise the browser keeps
  // sending a token the server already rejects (or vice versa).
  maxAgeMs: 30 * 24 * 60 * 60 * 1000,
  /** jose-parsable TTL string; keep in sync with maxAgeMs above. */
  jwtTtl: "30d",
} as const;

export const ErrorMessages = {
  unauthenticated: "Authentication required",
  insufficientRole: "Insufficient permissions",
} as const;

export const Paths = {
  login: "/login",
  oauthCallback: "/api/oauth/callback",
} as const;
