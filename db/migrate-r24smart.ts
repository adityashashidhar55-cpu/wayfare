/**
 * migrate-r24smart.ts (r24-smart) - idempotent migration for the smart wave.
 *
 * Tables (information_schema.tables checked first, same pattern as
 * db/migrate-r24s.ts):
 *   api_usage, notifications, wishlist_trips, token_events, rewards_redeemed
 *
 * Run:  npx tsx db/migrate-r24smart.ts
 */
import { sql } from "drizzle-orm";
import { getDb } from "../api/queries/connection";

const COLUMNS: { table: string; name: string; ddl: string }[] = [
  // r24-smart K: "mark flexible" weather adaptation
  { table: "trip_days", name: "flexible", ddl: "TINYINT(1) NOT NULL DEFAULT 0" },
];

const TABLES: { name: string; ddl: string }[] = [
  {
    name: "api_usage",
    ddl: `CREATE TABLE api_usage (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
      userId BIGINT UNSIGNED NOT NULL,
      kind VARCHAR(32) NOT NULL,
      createdAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_apiusage_user_kind (userId, kind, createdAt)
    )`,
  },
  {
    name: "notifications",
    ddl: `CREATE TABLE notifications (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
      userId BIGINT UNSIGNED NOT NULL,
      kind VARCHAR(32) NOT NULL,
      title VARCHAR(255) NOT NULL,
      body TEXT NULL,
      tripId BIGINT UNSIGNED NULL,
      readAt TIMESTAMP NULL,
      createdAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_notif_user (userId, id)
    )`,
  },
  {
    name: "wishlist_trips",
    ddl: `CREATE TABLE wishlist_trips (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
      userId BIGINT UNSIGNED NOT NULL,
      title VARCHAR(255) NOT NULL,
      destination VARCHAR(255) NOT NULL,
      notes TEXT NULL,
      createdAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_wishlist_user (userId, id)
    )`,
  },
  {
    name: "token_events",
    ddl: `CREATE TABLE token_events (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
      userId BIGINT UNSIGNED NOT NULL,
      kind VARCHAR(32) NOT NULL,
      amount INT NOT NULL,
      eventKey VARCHAR(128) NOT NULL,
      meta TEXT NULL,
      createdAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE KEY uq_token_event_key (userId, eventKey),
      INDEX idx_token_user (userId, id)
    )`,
  },
  {
    name: "rewards_redeemed",
    ddl: `CREATE TABLE rewards_redeemed (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
      userId BIGINT UNSIGNED NOT NULL,
      rewardId VARCHAR(64) NOT NULL,
      cost INT NOT NULL,
      createdAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_rewards_user (userId, id)
    )`,
  },
];

async function columnExists(db: ReturnType<typeof getDb>, table: string, name: string): Promise<boolean> {
  const [rows] = await db.execute(
    sql`SELECT COUNT(*) AS c FROM information_schema.columns
        WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ${table} AND COLUMN_NAME = ${name}`,
  );
  return Number((rows as unknown as { c: number }[])[0]?.c ?? 0) > 0;
}

async function tableExists(db: ReturnType<typeof getDb>, name: string): Promise<boolean> {
  const [rows] = await db.execute(
    sql`SELECT COUNT(*) AS c FROM information_schema.tables
        WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ${name}`,
  );
  return Number((rows as unknown as { c: number }[])[0]?.c ?? 0) > 0;
}

async function main() {
  const db = getDb();
  let added = 0;
  for (const col of COLUMNS) {
    if (await columnExists(db, col.table, col.name)) {
      console.log(`migrate-r24smart: ${col.table}.${col.name} already exists, skipping`);
      continue;
    }
    try {
      await db.execute(
        sql.raw(`ALTER TABLE ${col.table} ADD COLUMN ${col.name} ${col.ddl}, ALGORITHM=INPLACE, LOCK=NONE`),
      );
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (/Duplicate column name/i.test(msg)) {
        console.log(`migrate-r24smart: ${col.table}.${col.name} already exists (idempotent no-op)`);
        continue;
      }
      console.log(`migrate-r24smart: INPLACE/LOCK clauses rejected (${msg}); retrying plain ADD COLUMN`);
      await db.execute(sql.raw(`ALTER TABLE ${col.table} ADD COLUMN ${col.name} ${col.ddl}`));
    }
    added++;
    console.log(`migrate-r24smart: ${col.table}.${col.name} added`);
  }

  for (const t of TABLES) {
    if (await tableExists(db, t.name)) {
      console.log(`migrate-r24smart: table ${t.name} already exists, skipping`);
      continue;
    }
    await db.execute(sql.raw(t.ddl));
    added++;
    console.log(`migrate-r24smart: table ${t.name} created`);
  }

  console.log("migrate-r24smart: verifying...");
  let missing = 0;
  for (const col of COLUMNS) {
    if (!(await columnExists(db, col.table, col.name))) {
      missing++;
      console.error(`migrate-r24smart: MISSING ${col.table}.${col.name}`);
    }
  }
  for (const t of TABLES) {
    if (!(await tableExists(db, t.name))) {
      missing++;
      console.error(`migrate-r24smart: MISSING table ${t.name}`);
    }
  }
  if (missing) {
    console.error(`migrate-r24smart: FAILED, ${missing} table(s) missing`);
    process.exit(1);
  }
  console.log(`migrate-r24smart: done, ${added} table(s) added, all verified present`);
  process.exit(0);
}

main().catch((e) => {
  console.error("migrate-r24smart failed:", e);
  process.exit(1);
});
