import { randomBytes } from "node:crypto";
import { eq } from "drizzle-orm";
import { getDb } from "../api/queries/connection";
import * as schema from "./schema";
import { hashPassword } from "../api/lib/passwords";

/**
 * Seed THE credentials admin account (email + password login).
 *
 *  - Password comes from env ADMIN_PASSWORD when set.
 *  - Otherwise, on FIRST seed a strong password is generated and printed ONCE
 *    to the console (never stored in plaintext). Re-running the seed without
 *    ADMIN_PASSWORD keeps the existing hash, so the printed password stays
 *    the only copy.
 *
 * Run: npx tsx db/seed-admin.ts
 */
const ADMIN_UNION_ID = "local:admin";
const ADMIN_EMAIL = "admin@wayfare.app";
const ADMIN_NAME = "Wayfare Admin";

// 4 groups of 4 chars, no visually ambiguous characters (0/o, 1/l).
function generatePassword(): string {
  const alphabet = "abcdefghjkmnpqrstuvwxyz23456789";
  const bytes = randomBytes(16);
  const chars = Array.from(bytes, (b) => alphabet[b % alphabet.length]);
  return [0, 1, 2, 3].map((g) => chars.slice(g * 4, g * 4 + 4).join("")).join("-");
}

async function main() {
  const db = getDb();

  const existing = await db
    .select()
    .from(schema.users)
    .where(eq(schema.users.unionId, ADMIN_UNION_ID))
    .limit(1);
  const current = existing.at(0);

  let generatedPassword: string | null = null;
  let passwordHash: string;
  if (process.env.ADMIN_PASSWORD) {
    passwordHash = await hashPassword(process.env.ADMIN_PASSWORD);
  } else if (current?.passwordHash) {
    passwordHash = current.passwordHash; // keep - password was already shown once
  } else {
    generatedPassword = generatePassword();
    passwordHash = await hashPassword(generatedPassword);
  }

  await db
    .insert(schema.users)
    .values({
      unionId: ADMIN_UNION_ID,
      name: ADMIN_NAME,
      email: ADMIN_EMAIL,
      role: "admin",
      passwordHash,
      lastSignInAt: new Date(),
    })
    .onDuplicateKeyUpdate({
      set: {
        name: ADMIN_NAME,
        email: ADMIN_EMAIL,
        role: "admin",
        passwordHash,
      },
    });

  const admin = (
    await db
      .select()
      .from(schema.users)
      .where(eq(schema.users.unionId, ADMIN_UNION_ID))
      .limit(1)
  ).at(0);
  if (!admin) throw new Error("Failed to seed admin user");

  await db
    .insert(schema.subscriptions)
    .values({ userId: admin.id, tier: "voyager", status: "active" })
    .onDuplicateKeyUpdate({ set: { tier: "voyager", status: "active" } });

  console.log(
    `[seed-admin] ok: id=${admin.id} email=${ADMIN_EMAIL} role=${admin.role} tier=voyager`,
  );
  if (generatedPassword) {
    console.log(`[seed-admin] ADMIN PASSWORD (shown once, store it now): ${generatedPassword}`);
  } else if (process.env.ADMIN_PASSWORD) {
    console.log("[seed-admin] password set from ADMIN_PASSWORD env var.");
  } else {
    console.log("[seed-admin] existing password kept (no ADMIN_PASSWORD provided).");
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("[seed-admin] failed:", err);
    process.exit(1);
  });
