/**
 * r27 migration - the four tables the new features need.
 *
 * Run:  npx tsx db/migrate-r27.ts            (dry run, reports only)
 *       npx tsx db/migrate-r27.ts --apply    (writes)
 *
 * WHAT THIS CREATES
 *
 * 1. password_resets - one-time reset tokens (SHA-256 of the token only, so a
 *    database leak yields nothing usable). Needed by auth.requestPasswordReset
 *    / auth.resetPassword, which did not exist before r27: a forgotten
 *    password meant a dead account with no recovery path at all.
 *
 * 2. payments - the Razorpay audit trail. The subscriptions table records the
 *    CURRENT entitlement; this records how it was paid for, which is what you
 *    need when a customer disputes a charge. The old mock checkout recorded
 *    nothing because no money ever moved.
 *
 * 3. fx_rates - daily exchange-rate cache. contracts/fx.ts shipped a hardcoded
 *    table with no refresh path and it converts real money on every shared
 *    expense.
 *
 * 4. notifications.kind gains "invite" - no schema change needed (the column
 *    is a varchar), noted here only so the enum drift is documented.
 *
 * SAFETY
 * - Dry run by default. Nothing is written without --apply.
 * - Every statement is CREATE TABLE IF NOT EXISTS, so re-running is a no-op.
 * - No existing table is altered and no existing row is touched. This
 *   migration cannot lose data.
 */
import "dotenv/config";
import { sql } from "drizzle-orm";
import { getDb } from "../api/queries/connection";

const APPLY = process.argv.includes("--apply");

function log(...args: unknown[]) {
  console.log("[r27]", ...args);
}

/**
 * getDb() is drizzle-orm/mysql2 (the `mode: "planetscale"` flag in
 * queries/connection.ts is a dialect-compat setting, NOT the PlanetScale HTTP
 * driver). db.execute() therefore resolves to the raw mysql2 tuple
 * [rows | ResultSetHeader, FieldPacket[]] - results live at [0]. Matches the
 * unwrap in db/audit-france-locations.ts:126.
 */
function head(raw: unknown): unknown {
  return Array.isArray(raw) ? raw[0] : raw;
}

const STATEMENTS: { name: string; ddl: string }[] = [
  {
    name: "password_resets",
    ddl: `
      CREATE TABLE IF NOT EXISTS password_resets (
        id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
        userId BIGINT UNSIGNED NOT NULL,
        tokenHash VARCHAR(64) NOT NULL,
        expiresAt TIMESTAMP NOT NULL,
        usedAt TIMESTAMP NULL,
        createdAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (id),
        UNIQUE KEY uq_password_reset_token (tokenHash),
        KEY idx_password_reset_user (userId, id)
      )`,
  },
  {
    name: "payments",
    ddl: `
      CREATE TABLE IF NOT EXISTS payments (
        id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
        userId BIGINT UNSIGNED NOT NULL,
        provider VARCHAR(24) NOT NULL DEFAULT 'razorpay',
        orderId VARCHAR(64) NOT NULL,
        paymentId VARCHAR(64) NULL,
        amount INT NOT NULL,
        currency VARCHAR(8) NOT NULL,
        billingInterval ENUM('monthly','yearly') NOT NULL,
        status ENUM('created','paid','failed','refunded') NOT NULL DEFAULT 'created',
        raw TEXT NULL,
        createdAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updatedAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        PRIMARY KEY (id),
        UNIQUE KEY uq_payment_order (orderId),
        KEY idx_payment_user (userId, id)
      )`,
  },
  {
    name: "fx_rates",
    ddl: `
      CREATE TABLE IF NOT EXISTS fx_rates (
        code VARCHAR(8) NOT NULL,
        perUsd DOUBLE NOT NULL,
        fetchedAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (code)
      )`,
  },
];

async function main() {
  const db = getDb();
  log(APPLY ? "APPLYING" : "DRY RUN (pass --apply to write)");

  for (const { name, ddl } of STATEMENTS) {
    const existing = head(
      await db.execute(
        sql`SELECT COUNT(*) AS n FROM information_schema.tables
            WHERE table_schema = DATABASE() AND table_name = ${name}`,
      ),
    ) as { n: number }[] | undefined;
    const present = Number(existing?.[0]?.n ?? 0) > 0;

    if (present) {
      log(`${name}: already exists, nothing to do`);
      continue;
    }
    if (!APPLY) {
      log(`${name}: WOULD CREATE`);
      continue;
    }
    await db.execute(sql.raw(ddl));
    log(`${name}: created`);
  }

  log("done.");
  process.exit(0);
}

main().catch((e) => {
  console.error("[r27] migration failed", e);
  process.exit(1);
});
