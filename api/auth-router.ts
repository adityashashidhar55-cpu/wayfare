import { createHash } from "node:crypto";
import * as cookie from "cookie";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { Session } from "@contracts/constants";
import { getSessionCookieOptions } from "./lib/cookies";
import { createRouter, authedQuery, publicQuery } from "./middleware";
import { signSessionToken } from "./kimi/session";
import { env } from "./lib/env";
import { hashPassword, verifyPassword } from "./lib/passwords";
import { appUrl, sendPasswordChanged, sendPasswordReset } from "./lib/mailer";
import {
  countReferrals,
  findUserIdByReferralCode,
  mintUniqueReferralCode,
} from "./lib/referral";
import { claimPendingFriendParticipations, claimPendingTripInvites, findUserByEmail, findUserByUnionId, upsertUser } from "./queries/users";
import { seedDemoData } from "./queries/demo";
import { getDb } from "./queries/connection";
import * as schema from "@db/schema";
import { and, eq, isNull, ne } from "drizzle-orm";

/**
 * Naive in-memory rate limiter for password login attempts: max 5 failed
 * attempts per email per 10-minute window (per server process).
 */
const LOGIN_ATTEMPT_WINDOW_MS = 10 * 60 * 1000;
const LOGIN_ATTEMPT_MAX = 5;
const loginAttempts = new Map<string, { count: number; firstAt: number }>();

function isLoginRateLimited(email: string): boolean {
  const entry = loginAttempts.get(email);
  if (!entry) return false;
  if (Date.now() - entry.firstAt > LOGIN_ATTEMPT_WINDOW_MS) {
    loginAttempts.delete(email);
    return false;
  }
  return entry.count >= LOGIN_ATTEMPT_MAX;
}

function recordFailedLoginAttempt(email: string): void {
  const now = Date.now();
  const entry = loginAttempts.get(email);
  if (!entry || now - entry.firstAt > LOGIN_ATTEMPT_WINDOW_MS) {
    loginAttempts.set(email, { count: 1, firstAt: now });
  } else {
    entry.count += 1;
  }
}

/**
 * r27: password-reset request throttle. Separate from the login limiter -
 * this one guards against using the endpoint as a free mail cannon aimed at
 * someone else's inbox, so it counts REQUESTS, not failures.
 */
const PASSWORD_RESET_TTL_MS = 60 * 60 * 1000; // 1 hour
const RESET_WINDOW_MS = 15 * 60 * 1000;
const RESET_MAX = 3;
const resetRequests = new Map<string, { count: number; firstAt: number }>();

function isResetRateLimited(email: string): boolean {
  const entry = resetRequests.get(email);
  if (!entry) return false;
  if (Date.now() - entry.firstAt > RESET_WINDOW_MS) {
    resetRequests.delete(email);
    return false;
  }
  return entry.count >= RESET_MAX;
}

function recordResetRequest(email: string): void {
  const now = Date.now();
  const entry = resetRequests.get(email);
  if (!entry || now - entry.firstAt > RESET_WINDOW_MS) {
    resetRequests.set(email, { count: 1, firstAt: now });
  } else {
    entry.count += 1;
  }
}

function sha256Hex(v: string): string {
  return createHash("sha256").update(v).digest("hex");
}

// Lazily-built hash of a random non-password, used to keep unknown-email
// timing comparable to a real verify (no account-enumeration side channel).
let dummyHashPromise: Promise<string> | null = null;
function getDummyHash(): Promise<string> {
  dummyHashPromise ??= hashPassword(`dummy-${crypto.randomUUID()}`);
  return dummyHashPromise;
}

export const authRouter = createRouter({
  me: authedQuery.query((opts) => {
    // Never hand the password hash to the client (keep the User shape intact).
    return { ...opts.ctx.user, passwordHash: null };
  }),
  /**
   * Referral (r14-linkfix): the signed-in user's invite link code + how many
   * friends joined through it. Lazily mints a code for accounts created
   * before referral codes existed (defensive - the backfill covers them).
   */
  referralInfo: authedQuery.query(async ({ ctx }) => {
    let code = ctx.user.referralCode;
    if (!code) {
      code = await mintUniqueReferralCode();
      await getDb()
        .update(schema.users)
        .set({ referralCode: code })
        .where(eq(schema.users.id, ctx.user.id));
    }
    const joined = await countReferrals(ctx.user.id);
    return { code, joined };
  }),

  /**
   * Attach a referral after sign-up. The client stashes ?ref=<code> in
   * sessionStorage at /login and calls this once authenticated. Idempotent:
   * only fills referredById when it is still NULL, never self-referrals.
   */
  claimReferral: authedQuery
    .input(z.object({ code: z.string().min(1).max(32) }))
    .mutation(async ({ ctx, input }) => {
      const referrerId = await findUserIdByReferralCode(input.code);
      if (referrerId == null || referrerId === ctx.user.id) {
        return { claimed: false as const };
      }
      const res = await getDb()
        .update(schema.users)
        .set({ referredById: referrerId })
        .where(and(eq(schema.users.id, ctx.user.id), isNull(schema.users.referredById), ne(schema.users.id, referrerId)));
      const claimed = Number((res[0] as { affectedRows?: number })?.affectedRows ?? 0) > 0;
      return { claimed };
    }),

  logout: authedQuery.mutation(async ({ ctx }) => {
    const opts = getSessionCookieOptions(ctx.req.headers);
    ctx.resHeaders.append(
      "set-cookie",
      cookie.serialize(Session.cookieName, "", {
        httpOnly: opts.httpOnly,
        path: opts.path,
        sameSite: opts.sameSite?.toLowerCase() as "lax" | "none",
        secure: opts.secure,
        maxAge: 0,
      }),
    );
    return { success: true };
  }),

  /**
   * Guest/demo sign-in - creates a BRAND-NEW, empty guest account on every
   * call, so each demo starts completely fresh (no prior trips, no leftover
   * data from earlier sessions). Guest accounts are ephemeral by design;
   * logging out discards the session and the next demo is a clean slate.
   */
  guestLogin: publicQuery.mutation(async ({ ctx }) => {
    const unionId = `guest-${crypto.randomUUID()}`;
    await upsertUser({
      unionId,
      name: "Guest Explorer",
      lastSignInAt: new Date(),
    });
    const user = await findUserByUnionId(unionId);
    if (!user) {
      throw new Error("Failed to provision guest user");
    }
    // r31: give the guest something to look at. seedDemoData is idempotent
    // (it returns early if the user already owns a trip) and a fresh guest
    // owns none, so this always seeds exactly once per guest. It is
    // deliberately fail-open: a seeding problem must never block sign-in,
    // because an empty demo account is still a usable one.
    try {
      await seedDemoData(user.id);
    } catch (err) {
      console.error("[guestLogin] demo seed failed", err);
    }
    const token = await signSessionToken({
      unionId,
      clientId: env.appId,
    });
    const opts = getSessionCookieOptions(ctx.req.headers);
    ctx.resHeaders.append(
      "set-cookie",
      cookie.serialize(Session.cookieName, token, {
        httpOnly: opts.httpOnly,
        path: opts.path,
        sameSite: opts.sameSite?.toLowerCase() as "lax" | "none",
        secure: opts.secure,
        maxAge: Session.maxAgeMs / 1000,
      }),
    );
    return { ok: true };
  }),

  /**
   * Credentials sign-in (email + password) - used by the seeded admin
   * account. Verifies the scrypt hash stored on the user row, then mints the
   * exact same session cookie as the OAuth callback / guest login.
   */
  loginWithPassword: publicQuery
    .input(z.object({ email: z.string().email(), password: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      const email = input.email.trim().toLowerCase();

      if (isLoginRateLimited(email)) {
        throw new TRPCError({
          code: "TOO_MANY_REQUESTS",
          message: "Too many attempts. Try again in a few minutes.",
        });
      }

      const user = await findUserByEmail(email);
      // Always run a real scrypt verify (against a dummy hash when the email
      // is unknown) so timing stays comparable; the error never reveals
      // which half failed.
      const ok = await verifyPassword(
        input.password,
        user?.passwordHash ?? (await getDummyHash()),
      );

      if (!ok || !user) {
        recordFailedLoginAttempt(email);
        throw new TRPCError({
          code: "UNAUTHORIZED",
          message: "Invalid email or password",
        });
      }

      loginAttempts.delete(email);
      await upsertUser({ unionId: user.unionId, lastSignInAt: new Date() });
      // Attach any trip invites that were sent to this email before sign-in,
      // and link friend-session participations (claim-on-login, r15-access).
      await claimPendingTripInvites(user.id, email);
      await claimPendingFriendParticipations(user.id, email);

      const token = await signSessionToken({
        unionId: user.unionId,
        clientId: env.appId,
      });
      const opts = getSessionCookieOptions(ctx.req.headers);
      ctx.resHeaders.append(
        "set-cookie",
        cookie.serialize(Session.cookieName, token, {
          httpOnly: opts.httpOnly,
          path: opts.path,
          sameSite: opts.sameSite?.toLowerCase() as "lax" | "none",
          secure: opts.secure,
          maxAge: Session.maxAgeMs / 1000,
        }),
      );

      const fresh = await findUserByUnionId(user.unionId);
      const { passwordHash: _omit, ...payload } = fresh ?? user;
      return payload;
    }),

  /**
   * r26: EMAIL SIGN-UP. This did not exist.
   *
   * `loginWithPassword` above only ever authenticated a pre-existing row, and
   * the only thing that ever wrote a passwordHash was `db/seed-admin.ts`, run
   * by hand. So on a fresh deployment there was no way for a real person to
   * create a durable account at all: Google/Apple need credentials the
   * operator may not have set, and the guest button mints a throwaway.
   *
   * When the caller is currently signed in as a GUEST, this UPGRADES that
   * guest row in place rather than creating a second account - so the trips
   * they just built in the demo survive. That was the other half of the gap:
   * the UI promised "sign in to keep it" and nothing implemented "keep it".
   */
  register: publicQuery
    .input(
      z.object({
        email: z.string().email().max(320),
        // 10 chars minimum. Length beats composition rules for scrypt-hashed
        // secrets, and we deliberately do not impose symbol/case requirements.
        password: z.string().min(10).max(200),
        name: z.string().trim().min(1).max(120).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const email = input.email.trim().toLowerCase();
      const db = getDb();

      const existing = await findUserByEmail(email);
      if (existing) {
        /**
         * r33 SECURITY: this used to be `if (existing?.passwordHash)`, so a row
         * that existed WITHOUT a hash fell through to the branch below and had
         * the caller's password attached to it - then a session was signed for
         * `existing.unionId`. That is an account takeover, and it applied to
         * exactly the rows least able to defend themselves:
         *
         *  - every Google/Apple user, who has no passwordHash by definition;
         *  - every pending-invite row, created from an email address by
         *    claimPendingTripInvites BEFORE that person has ever signed in.
         *
         * Invite a colleague, and anyone who knows their address could claim
         * their row before they got to it - inheriting their trips, expense
         * ledger, co-travellers' emails and subscription.
         *
         * The old comment argued the person "demonstrably controls the address
         * they signed up with". They demonstrate nothing by typing it. Proving
         * control of an address requires sending mail to it, which is what the
         * password-reset flow already does.
         */
        throw new TRPCError({
          code: "CONFLICT",
          message: "An account with that email already exists. Sign in, or use the password reset link.",
        });
      }

      const passwordHash = await hashPassword(input.password);
      const caller = ctx.user;
      const isGuestCaller = caller != null && caller.unionId.startsWith("guest-");

      let unionId: string;

      // NOTE: there is deliberately no "attach a password to the existing row"
      // branch here any more. It was the takeover path described above, and
      // with the CONFLICT throw in place `existing` is always null by now.
      if (isGuestCaller) {
        // Upgrade the guest in place: same row, same id, so every trip,
        // expense and membership they created in the demo carries over.
        unionId = caller.unionId;
        await db
          .update(schema.users)
          .set({ email, passwordHash, name: input.name ?? caller.name ?? null })
          .where(eq(schema.users.id, caller.id));
      } else {
        unionId = `email-${crypto.randomUUID()}`;
        await upsertUser({
          unionId,
          email,
          passwordHash,
          name: input.name ?? email.split("@")[0]!,
          lastSignInAt: new Date(),
        });
      }

      const user = await findUserByUnionId(unionId);
      if (!user) {
        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Could not create the account" });
      }

      // Same claim-on-login behaviour as the password path, so an invite sent
      // to this address before signup attaches immediately.
      await claimPendingTripInvites(user.id, email);
      await claimPendingFriendParticipations(user.id, email);

      const token = await signSessionToken({ unionId, clientId: env.appId });
      const opts = getSessionCookieOptions(ctx.req.headers);
      ctx.resHeaders.append(
        "set-cookie",
        cookie.serialize(Session.cookieName, token, {
          httpOnly: opts.httpOnly,
          path: opts.path,
          sameSite: opts.sameSite?.toLowerCase() as "lax" | "none",
          secure: opts.secure,
          maxAge: Session.maxAgeMs / 1000,
        }),
      );

      return {
        ...user,
        passwordHash: null,
        // `existing` is provably null past the CONFLICT above, so the guest
        // flag alone is the answer now.
        upgradedFromGuest: isGuestCaller,
      };
    }),

  /**
   * r27: PASSWORD RESET, step 1 - request a link.
   *
   * ALWAYS returns { ok: true }, whether or not the email exists. Reporting
   * "no such account" here would turn this into an account-enumeration oracle,
   * which is exactly what loginWithPassword goes out of its way to avoid with
   * its dummy-hash timing defence.
   *
   * Only the SHA-256 of the token is persisted, so a leak of password_resets
   * yields nothing usable.
   */
  requestPasswordReset: publicQuery
    .input(z.object({ email: z.string().email().max(320) }))
    .mutation(async ({ input }) => {
      const email = input.email.trim().toLowerCase();
      const generic = { ok: true as const };

      if (isResetRateLimited(email)) return generic;
      recordResetRequest(email);

      const user = await findUserByEmail(email);
      // A guest row or an OAuth-only account has no password to reset, but we
      // still answer identically.
      if (!user?.email) return generic;

      const db = getDb();
      const token = crypto.randomUUID().replace(/-/g, "") + crypto.randomUUID().replace(/-/g, "");
      const expiresAt = new Date(Date.now() + PASSWORD_RESET_TTL_MS);

      // Invalidate any outstanding link for this user, so requesting a second
      // one silently retires the first.
      await db
        .update(schema.passwordResets)
        .set({ usedAt: new Date() })
        .where(
          and(
            eq(schema.passwordResets.userId, user.id),
            isNull(schema.passwordResets.usedAt),
          ),
        );
      await db.insert(schema.passwordResets).values({
        userId: user.id,
        tokenHash: sha256Hex(token),
        expiresAt,
      });

      await sendPasswordReset({
        to: user.email,
        name: user.name,
        href: appUrl(`/login?reset=${token}`),
        expiresMinutes: Math.round(PASSWORD_RESET_TTL_MS / 60000),
      });
      return generic;
    }),

  /**
   * r27: PASSWORD RESET, step 2 - redeem the link and set a new password.
   *
   * The token row is claimed with a conditional UPDATE that matches only rows
   * still unused, and the affected-row count decides whether we proceed. A
   * read-then-write would let two concurrent redemptions of the same link both
   * pass, which is the same TOCTOU shape the token ledger was fixed for.
   */
  resetPassword: publicQuery
    .input(
      z.object({
        token: z.string().min(32).max(128),
        password: z.string().min(10).max(200),
      }),
    )
    .mutation(async ({ input }) => {
      const db = getDb();
      const tokenHash = sha256Hex(input.token);
      const [row] = await db
        .select()
        .from(schema.passwordResets)
        .where(eq(schema.passwordResets.tokenHash, tokenHash))
        .limit(1);

      const invalid = new TRPCError({
        code: "BAD_REQUEST",
        message: "That reset link is invalid or has expired. Request a new one.",
      });
      if (!row || row.usedAt || row.expiresAt.getTime() < Date.now()) throw invalid;

      // Claim it. `affectedRows` (mysql2), not `rowsAffected` - getDb() is
      // drizzle-orm/mysql2 and "planetscale" is only a dialect flag.
      const claim = await db
        .update(schema.passwordResets)
        .set({ usedAt: new Date() })
        .where(
          and(
            eq(schema.passwordResets.id, row.id),
            isNull(schema.passwordResets.usedAt),
          ),
        );
      const claimed = Number((claim as unknown as [{ affectedRows?: number }])[0]?.affectedRows ?? 0);
      if (claimed < 1) throw invalid;

      const passwordHash = await hashPassword(input.password);
      await db
        .update(schema.users)
        .set({ passwordHash })
        .where(eq(schema.users.id, row.userId));

      const [user] = await db
        .select()
        .from(schema.users)
        .where(eq(schema.users.id, row.userId))
        .limit(1);
      // Clear the failed-login counter so a locked-out user can sign in at once.
      if (user?.email) {
        loginAttempts.delete(user.email.toLowerCase());
        await sendPasswordChanged({ to: user.email, name: user.name });
      }
      return { ok: true };
    }),

  /** Is this session a throwaway guest? Drives the "save your trips" nudge. */
  isGuest: publicQuery.query(({ ctx }) => ({
    isGuest: ctx.user != null && ctx.user.unionId.startsWith("guest-"),
    signedIn: ctx.user != null,
  })),
});
