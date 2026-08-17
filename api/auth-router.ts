import * as cookie from "cookie";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { Session } from "@contracts/constants";
import { getSessionCookieOptions } from "./lib/cookies";
import { createRouter, authedQuery, publicQuery } from "./middleware";
import { signSessionToken } from "./kimi/session";
import { env } from "./lib/env";
import { hashPassword, verifyPassword } from "./lib/passwords";
import {
  countReferrals,
  findUserIdByReferralCode,
  mintUniqueReferralCode,
} from "./lib/referral";
import { claimPendingFriendParticipations, claimPendingTripInvites, findUserByEmail, findUserByUnionId, upsertUser } from "./queries/users";
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
      if (existing?.passwordHash) {
        throw new TRPCError({
          code: "CONFLICT",
          message: "An account with that email already exists. Try signing in.",
        });
      }

      const passwordHash = await hashPassword(input.password);
      const caller = ctx.user;
      const isGuestCaller = caller != null && caller.unionId.startsWith("guest-");

      let unionId: string;

      if (existing) {
        // An OAuth account (or a pending invite row) already holds this email
        // but has no password. Attach one rather than refusing - the person
        // demonstrably controls the address they signed up with.
        unionId = existing.unionId;
        await db
          .update(schema.users)
          .set({ passwordHash, name: existing.name ?? input.name ?? null })
          .where(eq(schema.users.id, existing.id));
      } else if (isGuestCaller) {
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

      const { passwordHash: _hidden, ...payload } = user;
      return { ...payload, upgradedFromGuest: isGuestCaller && !existing };
    }),

  /** Is this session a throwaway guest? Drives the "save your trips" nudge. */
  isGuest: publicQuery.query(({ ctx }) => ({
    isGuest: ctx.user != null && ctx.user.unionId.startsWith("guest-"),
    signedIn: ctx.user != null,
  })),
});
