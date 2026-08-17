/**
 * Referral-code backfill (r14-linkfix).
 * Run: npx tsx db/seed-referral-codes.ts
 *
 * Every existing user gets a random 10-char url-safe referralCode. Users that
 * already have one are skipped, so the script is IDEMPOTENT - safe to re-run
 * after a partial failure; it only fills rows where referralCode IS NULL.
 */
import { eq, isNull } from "drizzle-orm";
import * as schema from "./schema";
import { getDb } from "../api/queries/connection";
import { generateReferralCode, countUsersMissingReferralCode } from "../api/lib/referral";

const BATCH = 200;

async function main() {
  const db = getDb();
  const before = await countUsersMissingReferralCode();
  console.log(`users missing a referral code: ${before}`);

  let filled = 0;
  for (;;) {
    const rows = await db
      .select({ id: schema.users.id, referralCode: schema.users.referralCode })
      .from(schema.users)
      .where(isNull(schema.users.referralCode))
      .limit(BATCH);
    if (rows.length === 0) break;

    for (const row of rows) {
      // Retry on the (astronomically rare) unique-index collision.
      for (let attempt = 0; attempt < 5; attempt++) {
        try {
          await db
            .update(schema.users)
            .set({ referralCode: generateReferralCode() })
            .where(eq(schema.users.id, row.id));
          filled++;
          break;
        } catch (err) {
          const code = (err as { code?: string }).code;
          if (code === "ER_DUP_ENTRY" && attempt < 4) continue;
          throw err;
        }
      }
    }
  }

  const after = await countUsersMissingReferralCode();
  console.log(`backfilled ${filled} user(s); still missing: ${after}`);
  if (after !== 0) {
    throw new Error(`backfill incomplete, ${after} user(s) still lack a code`);
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
