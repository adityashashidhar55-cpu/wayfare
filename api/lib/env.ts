import "dotenv/config";

function required(name: string): string {
  const value = process.env[name];
  if (!value && process.env.NODE_ENV === "production") {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value ?? "";
}

export const env = {
  appId: required("APP_ID"),
  appSecret: required("APP_SECRET"),
  // Dedicated session-signing key. Falls back to APP_SECRET so existing
  // sessions keep verifying, but set SESSION_SECRET in production: APP_SECRET
  // is also sent over the wire as an OAuth client_secret, and reusing it means
  // a leak there lets an attacker forge a session JWT for any unionId
  // (including OWNER_UNION_ID -> instant admin).
  sessionSecret: process.env.SESSION_SECRET || required("APP_SECRET"),
  isProduction: process.env.NODE_ENV === "production",
  databaseUrl: required("DATABASE_URL"),
  // Kimi OAuth is OPTIONAL. When these are unset the "Continue with Kimi"
  // provider is simply not offered; guest / email+password / Google / Apple
  // sign-in all work without it. Previously these were required() and the
  // JWKS URL was built at module load, so an empty value crashed the whole
  // server at boot -- not just Kimi login.
  kimiAuthUrl: process.env.KIMI_AUTH_URL ?? "",
  kimiOpenUrl: process.env.KIMI_OPEN_URL ?? "",
  ownerUnionId: process.env.OWNER_UNION_ID ?? "",
  // Optional social OAuth providers (enabled when credentials are provided)
  googleClientId: process.env.GOOGLE_CLIENT_ID ?? "",
  googleClientSecret: process.env.GOOGLE_CLIENT_SECRET ?? "",
  appleClientId: process.env.APPLE_CLIENT_ID ?? "",
  appleTeamId: process.env.APPLE_TEAM_ID ?? "",
  appleKeyId: process.env.APPLE_KEY_ID ?? "",
  applePrivateKey: process.env.APPLE_PRIVATE_KEY ?? "", // PEM contents (base64 ok)
  // Optional Google Maps Platform browser key (Maps JS / Places) - when set,
  // the frontend upgrades map search + offers Google tile layers.
  googleMapsKey: process.env.GOOGLE_MAPS_API_KEY ?? "",
};

/** True only when both Kimi OAuth endpoints are configured with valid URLs. */
export function kimiAuthEnabled(): boolean {
  if (!env.kimiAuthUrl || !env.kimiOpenUrl) return false;
  try {
    new URL(env.kimiAuthUrl);
    return true;
  } catch {
    return false;
  }
}
