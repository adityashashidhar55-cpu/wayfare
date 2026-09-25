import * as cookie from "cookie";
import * as jose from "jose";
import type { Context } from "hono";
import { Session } from "@contracts/constants";
import { getSessionCookieOptions } from "./lib/cookies";
import { signSessionToken } from "./kimi/session";
import { env, kimiAuthEnabled } from "./lib/env";
import { claimPendingFriendParticipations, claimPendingTripInvites, findUserByUnionId, upsertUser } from "./queries/users";

/**
 * Social OAuth providers (Google, Apple) - full OAuth 2.0 / OIDC flows.
 * A provider is enabled when its credentials exist in the environment:
 *   Google: GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET
 *   Apple:  APPLE_CLIENT_ID (Services ID), APPLE_TEAM_ID, APPLE_KEY_ID,
 *           APPLE_PRIVATE_KEY (ES256 PEM, base64 or raw)
 * The /api/oauth/providers endpoint lets the client enable buttons dynamically.
 */

export function providerAvailability(origin?: string) {
  const base = origin ?? "";
  return {
    // r35: a client ID alone is enough - without a secret, Google runs the
    // id_token flow (see googleStart), which needs nothing secret stored.
    google: Boolean(env.googleClientId),
    microsoft: Boolean(env.microsoftClientId),
    apple: Boolean(env.appleClientId && env.appleTeamId && env.appleKeyId && env.applePrivateKey),
    // Kimi is now reported like any other provider so the client can hide the
    // button on deployments that aren't hosted by Kimi, instead of rendering a
    // button that builds a broken redirect URL.
    kimi: kimiAuthEnabled(),
    googleMaps: Boolean(env.googleMapsKey),
    // Hints shown so the app owner can register the right redirect URIs
    // in the Google/Apple developer consoles.
    redirectUris: base
      ? {
          google: `${base}/api/oauth/google/callback`,
          apple: `${base}/api/oauth/apple/callback`,
          microsoft: `${base}/api/oauth/microsoft/callback`,
          googleIdToken: `${base}/api/oauth/google/idtoken`,
        }
      : undefined,
  };
}

async function establishSession(
  c: Context,
  profile: { unionId: string; name?: string | null; email?: string | null; avatar?: string | null },
) {
  await upsertUser({ ...profile, lastSignInAt: new Date() });
  // Attach any pending trip invites addressed to this email (best-effort -
  // a claim hiccup must never break the OAuth redirect).
  if (profile.email) {
    try {
      const user = await findUserByUnionId(profile.unionId);
      if (user) {
        await claimPendingTripInvites(user.id, profile.email);
        await claimPendingFriendParticipations(user.id, profile.email);
      }
    } catch (err) {
      console.warn("[oauth] claiming pending trip invites failed", err);
    }
  }
  const token = await signSessionToken({ unionId: profile.unionId, clientId: env.appId });
  const opts = getSessionCookieOptions(c.req.raw.headers);
  c.header(
    "set-cookie",
    cookie.serialize(Session.cookieName, token, {
      httpOnly: opts.httpOnly,
      path: opts.path,
      sameSite: opts.sameSite?.toLowerCase() as "lax" | "none",
      secure: opts.secure,
      maxAge: Session.maxAgeMs / 1000,
    }),
  );
  return c.redirect("/");
}

function originOf(c: Context): string {
  const url = new URL(c.req.url);
  const proto = c.req.header("x-forwarded-proto") ?? url.protocol.replace(":", "");
  const host = c.req.header("x-forwarded-host") ?? url.host;
  return `${proto}://${host}`;
}

// ─── Google ──────────────────────────────────────────────────────────────────
export function googleStart(c: Context) {
  if (!providerAvailability().google) {
    return c.json({ error: "google_not_configured" }, 400);
  }
  // r35: no client secret -> OIDC id_token flow. Google posts a signed ID
  // token straight back to us; we verify its signature against Google's
  // published keys, so nothing secret has to live on the server.
  if (!env.googleClientSecret) {
    return idTokenStart(c, {
      authorize: "https://accounts.google.com/o/oauth2/v2/auth",
      clientId: env.googleClientId,
      redirectUri: `${originOf(c)}/api/oauth/google/idtoken`,
      extra: { prompt: "select_account" },
    });
  }
  const redirectUri = `${originOf(c)}/api/oauth/google/callback`;
  const state = crypto.randomUUID();
  const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  url.searchParams.set("client_id", env.googleClientId);
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", "openid email profile");
  url.searchParams.set("state", state);
  url.searchParams.set("prompt", "select_account");
  return c.redirect(url.toString());
}

export async function googleCallback(c: Context) {
  const code = c.req.query("code");
  if (!code) return c.redirect("/login?error=google");
  const redirectUri = `${originOf(c)}/api/oauth/google/callback`;
  try {
    const tokenResp = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code,
        client_id: env.googleClientId,
        client_secret: env.googleClientSecret,
        redirect_uri: redirectUri,
        grant_type: "authorization_code",
      }),
    });
    const tokens = (await tokenResp.json()) as { access_token?: string };
    if (!tokens.access_token) throw new Error("token exchange failed");
    const profileResp = await fetch("https://openidconnect.googleapis.com/v1/userinfo", {
      headers: { authorization: `Bearer ${tokens.access_token}` },
    });
    const profile = (await profileResp.json()) as {
      sub: string; name?: string; email?: string; picture?: string;
    };
    return establishSession(c, {
      unionId: `google:${profile.sub}`,
      name: profile.name ?? null,
      email: profile.email ?? null,
      avatar: profile.picture ?? null,
    });
  } catch {
    return c.redirect("/login?error=google");
  }
}

// ─── Apple ───────────────────────────────────────────────────────────────────
async function appleClientSecret(): Promise<string> {
  const pemRaw = env.applePrivateKey.includes("BEGIN")
    ? env.applePrivateKey
    : Buffer.from(env.applePrivateKey, "base64").toString("utf8");
  const key = await jose.importPKCS8(pemRaw, "ES256");
  return new jose.SignJWT({})
    .setProtectedHeader({ alg: "ES256", kid: env.appleKeyId, typ: "JWT" })
    .setIssuer(env.appleTeamId)
    .setAudience("https://appleid.apple.com")
    .setSubject(env.appleClientId)
    .setIssuedAt()
    .setExpirationTime("5m")
    .sign(key);
}

export function appleStart(c: Context) {
  if (!providerAvailability().apple) {
    return c.json({ error: "apple_not_configured" }, 400);
  }
  const redirectUri = `${originOf(c)}/api/oauth/apple/callback`;
  const url = new URL("https://appleid.apple.com/auth/authorize");
  url.searchParams.set("client_id", env.appleClientId);
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("response_type", "code id_token");
  url.searchParams.set("scope", "name email");
  url.searchParams.set("response_mode", "form_post");
  url.searchParams.set("state", crypto.randomUUID());
  return c.redirect(url.toString());
}

export async function appleCallback(c: Context) {
  try {
    const body = await c.req.parseBody();
    const code = typeof body.code === "string" ? body.code : null;
    if (!code) return c.redirect("/login?error=apple");
    const redirectUri = `${originOf(c)}/api/oauth/apple/callback`;
    const tokenResp = await fetch("https://appleid.apple.com/auth/token", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code,
        client_id: env.appleClientId,
        client_secret: await appleClientSecret(),
        redirect_uri: redirectUri,
        grant_type: "authorization_code",
      }),
    });
    const tokens = (await tokenResp.json()) as { id_token?: string };
    if (!tokens.id_token) throw new Error("token exchange failed");
    const claims = jose.decodeJwt(tokens.id_token) as { sub: string; email?: string };
    // Apple sends the user's name only on the FIRST authorization, in form_post `user`
    let name: string | null = null;
    if (typeof body.user === "string") {
      try {
        const u = JSON.parse(body.user) as { name?: { firstName?: string; lastName?: string } };
        name = [u.name?.firstName, u.name?.lastName].filter(Boolean).join(" ") || null;
      } catch { /* ignore */ }
    }
    return establishSession(c, {
      unionId: `apple:${claims.sub}`,
      name,
      email: claims.email ?? null,
    });
  } catch {
    return c.redirect("/login?error=apple");
  }
}

// ─── r35: OIDC id_token sign-in (Google without a secret, Microsoft) ─────────
//
// Response type `id_token` with `response_mode=form_post`: the identity
// provider POSTs a signed JWT to our callback. We check its signature against
// the provider's public keys (JWKS), its audience (our client ID), its issuer,
// its expiry, and a one-time nonce we set in a cookie before redirecting, so a
// token minted for another app or replayed from elsewhere is rejected.
// Nothing secret is stored on the server for either provider.

const NONCE_COOKIE = "wf_oidc_nonce";
const MICROSOFT_CONSUMER_TENANT = "9188040d-6c67-4c5b-b112-36a304b66dad";
const GOOGLE_JWKS = jose.createRemoteJWKSet(new URL("https://www.googleapis.com/oauth2/v3/certs"));
const MICROSOFT_JWKS = jose.createRemoteJWKSet(
  new URL("https://login.microsoftonline.com/common/discovery/v2.0/keys"),
);

function idTokenStart(
  c: Context,
  opts: { authorize: string; clientId: string; redirectUri: string; extra?: Record<string, string> },
) {
  const nonce = crypto.randomUUID();
  // SameSite=None: the provider's form_post back to us is a cross-site POST,
  // and a Lax cookie would not be sent with it.
  c.header(
    "set-cookie",
    cookie.serialize(NONCE_COOKIE, nonce, {
      httpOnly: true, secure: true, sameSite: "none", path: "/api/oauth", maxAge: 600,
    }),
  );
  const url = new URL(opts.authorize);
  url.searchParams.set("client_id", opts.clientId);
  url.searchParams.set("redirect_uri", opts.redirectUri);
  url.searchParams.set("response_type", "id_token");
  url.searchParams.set("response_mode", "form_post");
  url.searchParams.set("scope", "openid email profile");
  url.searchParams.set("nonce", nonce);
  for (const [k, v] of Object.entries(opts.extra ?? {})) url.searchParams.set(k, v);
  return c.redirect(url.toString());
}

async function readPostedIdToken(c: Context): Promise<{ token: string; nonce: string } | null> {
  const body = await c.req.parseBody();
  const token = typeof body.id_token === "string" ? body.id_token : null;
  const nonce = cookie.parse(c.req.header("cookie") ?? "")[NONCE_COOKIE];
  if (!token || !nonce) return null;
  return { token, nonce };
}

/** Exported for tests: the issuer rule for Microsoft's multi-tenant endpoint. */
export function microsoftIssuerOk(iss: unknown, tid: unknown): boolean {
  return typeof iss === "string" && typeof tid === "string" &&
    iss === `https://login.microsoftonline.com/${tid}/v2.0`;
}

export async function googleIdTokenCallback(c: Context) {
  try {
    const posted = await readPostedIdToken(c);
    if (!posted) return c.redirect("/login?error=google");
    const { payload } = await jose.jwtVerify(posted.token, GOOGLE_JWKS, {
      audience: env.googleClientId,
      issuer: ["https://accounts.google.com", "accounts.google.com"],
    });
    if (payload.nonce !== posted.nonce) throw new Error("nonce mismatch");
    const p = payload as { sub: string; name?: string; email?: string; email_verified?: boolean; picture?: string };
    return establishSession(c, {
      unionId: `google:${p.sub}`, // same id the code flow uses, so accounts line up
      name: p.name ?? null,
      email: p.email_verified === false ? null : p.email ?? null,
      avatar: p.picture ?? null,
    });
  } catch (err) {
    console.warn("[oauth] google id_token rejected:", (err as Error).message);
    return c.redirect("/login?error=google");
  }
}

export function microsoftStart(c: Context) {
  if (!env.microsoftClientId) return c.json({ error: "microsoft_not_configured" }, 400);
  return idTokenStart(c, {
    // `common` = personal Microsoft accounts (Outlook, Hotmail) AND work/school.
    authorize: "https://login.microsoftonline.com/common/oauth2/v2.0/authorize",
    clientId: env.microsoftClientId,
    redirectUri: `${originOf(c)}/api/oauth/microsoft/callback`,
    extra: { prompt: "select_account" },
  });
}

export async function microsoftCallback(c: Context) {
  try {
    const posted = await readPostedIdToken(c);
    if (!posted) return c.redirect("/login?error=microsoft");
    // Issuer varies by tenant on the `common` endpoint, so it is checked by
    // hand against the token's own tid rather than a fixed string.
    const { payload } = await jose.jwtVerify(posted.token, MICROSOFT_JWKS, {
      audience: env.microsoftClientId,
    });
    if (!microsoftIssuerOk(payload.iss, payload.tid)) throw new Error("bad issuer");
    if (payload.nonce !== posted.nonce) throw new Error("nonce mismatch");
    const p = payload as {
      sub: string; tid?: string; name?: string; email?: string; preferred_username?: string; xms_edov?: boolean;
    };
    // An email is only trusted (it is used to claim pending trip invites) when
    // Microsoft vouches for it: personal accounts, or a tenant whose domain
    // ownership is verified (xms_edov). Any tenant admin can otherwise put any
    // address in a work account's email claim and inherit someone's invites.
    const trusted = p.tid === MICROSOFT_CONSUMER_TENANT || p.xms_edov === true;
    const claimed = p.email ?? (p.preferred_username?.includes("@") ? p.preferred_username : undefined);
    const email = trusted ? claimed : undefined;
    return establishSession(c, {
      unionId: `microsoft:${p.sub}`,
      name: p.name ?? null,
      email: email ?? null,
    });
  } catch (err) {
    console.warn("[oauth] microsoft id_token rejected:", (err as Error).message);
    return c.redirect("/login?error=microsoft");
  }
}
