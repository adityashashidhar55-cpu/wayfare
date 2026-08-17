/**
 * migrate-r24s.ts (r24-social) - idempotent migration for the social wave.
 *
 * Columns (information_schema.columns checked first, same pattern as
 * db/migrate-r24.ts):
 *   friend_sessions: budgetCents, budgetCurrency
 *
 * Tables (information_schema.tables checked first, CREATE TABLE IF NOT
 * EXISTS semantics via the check):
 *   friend_messages, published_trips, trip_join_requests, trip_updates
 *
 * Run:  npx tsx db/migrate-r24s.ts
 */
import { sql } from "drizzle-orm";
import { getDb } from "../api/queries/connection";

const COLUMNS: { table: string; name: string; ddl: string }[] = [
  { table: "friend_sessions", name: "budgetCents", ddl: "INT NULL" },
  { table: "friend_sessions", name: "budgetCurrency", ddl: "VARCHAR(3) NULL DEFAULT 'USD'" },
];

const TABLES: { name: string; ddl: string }[] = [
  {
    name: "friend_messages",
    ddl: `CREATE TABLE friend_messages (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
      sessionId BIGINT UNSIGNED NOT NULL,
      userId BIGINT UNSIGNED NULL,
      name VARCHAR(255) NOT NULL,
      body TEXT NOT NULL,
      createdAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_fm_session (sessionId, id)
    )`,
  },
  {
    name: "published_trips",
    ddl: `CREATE TABLE published_trips (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
      tripId BIGINT UNSIGNED NOT NULL,
      ownerId BIGINT UNSIGNED NOT NULL,
      slug VARCHAR(80) NOT NULL,
      title VARCHAR(255) NOT NULL,
      summary TEXT NULL,
      isOpen TINYINT(1) NOT NULL DEFAULT 1,
      createdAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE KEY uq_pt_trip (tripId),
      UNIQUE KEY uq_pt_slug (slug)
    )`,
  },
  {
    name: "trip_join_requests",
    ddl: `CREATE TABLE trip_join_requests (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
      publishedId BIGINT UNSIGNED NOT NULL,
      userId BIGINT UNSIGNED NOT NULL,
      message VARCHAR(500) NULL,
      status VARCHAR(16) NOT NULL DEFAULT 'pending',
      createdAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE KEY uq_tjr_pub_user (publishedId, userId),
      INDEX idx_tjr_pub (publishedId)
    )`,
  },
  {
    name: "trip_updates",
    ddl: `CREATE TABLE trip_updates (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
      publishedId BIGINT UNSIGNED NOT NULL,
      authorId BIGINT UNSIGNED NULL,
      body TEXT NOT NULL,
      kind VARCHAR(16) NOT NULL DEFAULT 'note',
      createdAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_tu_pub (publishedId, id)
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
      console.log(`migrate-r24s: ${col.table}.${col.name} already exists, skipping`);
      continue;
    }
    try {
      await db.execute(
        sql.raw(`ALTER TABLE ${col.table} ADD COLUMN ${col.name} ${col.ddl}, ALGORITHM=INPLACE, LOCK=NONE`),
      );
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (/Duplicate column name/i.test(msg)) {
        console.log(`migrate-r24s: ${col.table}.${col.name} already exists (idempotent no-op)`);
        continue;
      }
      console.log(`migrate-r24s: INPLACE/LOCK clauses rejected (${msg}); retrying plain ADD COLUMN`);
      await db.execute(sql.raw(`ALTER TABLE ${col.table} ADD COLUMN ${col.name} ${col.ddl}`));
    }
    added++;
    console.log(`migrate-r24s: ${col.table}.${col.name} added`);
  }

  for (const t of TABLES) {
    if (await tableExists(db, t.name)) {
      console.log(`migrate-r24s: table ${t.name} already exists, skipping`);
      continue;
    }
    await db.execute(sql.raw(t.ddl));
    added++;
    console.log(`migrate-r24s: table ${t.name} created`);
  }

  // Verification pass.
  console.log("migrate-r24s: verifying...");
  let missing = 0;
  for (const col of COLUMNS) {
    if (!(await columnExists(db, col.table, col.name))) {
      missing++;
      console.error(`migrate-r24s: MISSING ${col.table}.${col.name}`);
    }
  }
  for (const t of TABLES) {
    if (!(await tableExists(db, t.name))) {
      missing++;
      console.error(`migrate-r24s: MISSING table ${t.name}`);
    }
  }
  if (missing) {
    console.error(`migrate-r24s: FAILED, ${missing} item(s) missing`);
    process.exit(1);
  }
  console.log(`migrate-r24s: done, ${added} item(s) added, all verified present`);
  process.exit(0);
}

main().catch((e) => {
  console.error("migrate-r24s failed:", e);
  process.exit(1);
});
