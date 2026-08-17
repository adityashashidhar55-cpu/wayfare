import { eq, isNull, sql } from "drizzle-orm";
import * as schema from "@db/schema";
import { getDb } from "../queries/connection";

/**
 * Referral codes (r14-linkfix): every user owns a short, url-safe code used
 * in their personal invite link (/login?ref=<code>). A sign-up that arrives
 * through such a link gets `referredById` pointing at the code's owner.
 *
 * Codes are 10 chars from an unambiguous url-safe alphabet (no 0/O/1/l/I to
 * keep them readable when spoken or hand-copied).
 */

const ALPHABET = "abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789";
export const REFERRAL_CODE_LENGTH = 10;
/** Client-side shape check before persisting a ?ref= param. */
export const REFERRAL_CODE_RE = /^[A-Za-z0-9]{10}$/;

/** Random 10-char url-safe code (crypto-strong, no ambiguous glyphs). */
export function generateReferralCode(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(REFERRAL_CODE_LENGTH));
  let out = "";
  for (const b of bytes) out += ALPHABET[b % ALPHABET.length];
  return out;
}

/** Does any user already hold this code? */
export async function referralCodeTaken(code: string): Promise<boolean> {
  const rows = await getDb()
    .select({ id: schema.users.id })
    .from(schema.users)
    .where(eq(schema.users.referralCode, code))
    .limit(1);
  return rows.length > 0;
}

/** Mint a code that is not currently taken (retry on the rare collision). */
export async function mintUniqueReferralCode(maxAttempts = 5): Promise<string> {
  for (let i = 0; i < maxAttempts; i++) {
    const code = generateReferralCode();
    if (!(await referralCodeTaken(code))) return code;
  }
  throw new Error("could not mint a unique referral code");
}

/** Resolve a referral code to its owner's user id (null = unknown code). */
export async function findUserIdByReferralCode(code: string): Promise<number | null> {
  const trimmed = code.trim();
  if (!REFERRAL_CODE_RE.test(trimmed)) return null;
  const rows = await getDb()
    .select({ id: schema.users.id })
    .from(schema.users)
    .where(eq(schema.users.referralCode, trimmed))
    .limit(1);
  return rows.at(0)?.id ?? null;
}

/** Count of users who joined through this user's referral link. */
export async function countReferrals(userId: number): Promise<number> {
  const rows = await getDb()
    .select({ n: sql<number>`count(*)` })
    .from(schema.users)
    .where(eq(schema.users.referredById, userId));
  return Number(rows.at(0)?.n ?? 0);
}

/** How many users still lack a referral code (backfill progress). */
export async function countUsersMissingReferralCode(): Promise<number> {
  const rows = await getDb()
    .select({ n: sql<number>`count(*)` })
    .from(schema.users)
    .where(isNull(schema.users.referralCode));
  return Number(rows.at(0)?.n ?? 0);
}
