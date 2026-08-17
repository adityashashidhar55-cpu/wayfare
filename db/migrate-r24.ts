/**
 * migrate-r24.ts (r24-core) - idempotent column migration for trips + stops.
 *
 * trips:  originCity, adults, children, intent, budgetCurrency, flexibility,
 *         foodPrefs, mustSee   (budgetCents already exists, NOT NULL DEFAULT 0)
 * stops:  bookingUrl, bookedAt, transportMode, transportCents
 *
 * IDEMPOTENT: checks information_schema.columns first, same pattern as
 * db/add-indexes-r22.ts.
 *
 * Run:  npx tsx db/migrate-r24.ts
 */
import { sql } from "drizzle-orm";
import { getDb } from "../api/queries/connection";

const COLUMNS: { table: string; name: string; ddl: string }[] = [
  { table: "trips", name: "originCity", ddl: "VARCHAR(255) NULL" },
  { table: "trips", name: "adults", ddl: "INT NOT NULL DEFAULT 2" },
  { table: "trips", name: "children", ddl: "INT NOT NULL DEFAULT 0" },
  { table: "trips", name: "intent", ddl: "TEXT NULL" },
  { table: "trips", name: "budgetCurrency", ddl: "VARCHAR(3) NOT NULL DEFAULT 'USD'" },
  { table: "trips", name: "flexibility", ddl: "VARCHAR(16) NULL" },
  { table: "trips", name: "foodPrefs", ddl: "TEXT NULL" },
  { table: "trips", name: "mustSee", ddl: "TEXT NULL" },
  { table: "stops", name: "bookingUrl", ddl: "TEXT NULL" },
  { table: "stops", name: "bookedAt", ddl: "TIMESTAMP NULL" },
  { table: "stops", name: "transportMode", ddl: "VARCHAR(16) NULL" },
  { table: "stops", name: "transportCents", ddl: "INT NULL" },
];

async function columnExists(
  db: ReturnType<typeof getDb>,
  table: string,
  name: string,
): Promise<boolean> {
  const [rows] = await db.execute(
    sql`SELECT COUNT(*) AS c FROM information_schema.columns
        WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ${table} AND COLUMN_NAME = ${name}`,
  );
  const c = Number((rows as unknown as { c: number }[])[0]?.c ?? 0);
  return c > 0;
}

async function main() {
  const db = getDb();
  let added = 0;
  for (const col of COLUMNS) {
    if (await columnExists(db, col.table, col.name)) {
      console.log(`migrate-r24: ${col.table}.${col.name} already exists, skipping`);
      continue;
    }
    const t0 = Date.now();
    try {
      await db.execute(
        sql.raw(`ALTER TABLE ${col.table} ADD COLUMN ${col.name} ${col.ddl}, ALGORITHM=INPLACE, LOCK=NONE`),
      );
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (/Duplicate column name/i.test(msg)) {
        console.log(`migrate-r24: ${col.table}.${col.name} already exists (idempotent no-op)`);
        continue;
      }
      console.log(`migrate-r24: INPLACE/LOCK clauses rejected (${msg}); retrying plain ADD COLUMN`);
      await db.execute(sql.raw(`ALTER TABLE ${col.table} ADD COLUMN ${col.name} ${col.ddl}`));
    }
    added++;
    console.log(`migrate-r24: ${col.table}.${col.name} added in ${Date.now() - t0}ms`);
  }

  // Verification pass: re-read information_schema and print what landed.
  console.log("migrate-r24: verifying...");
  let missing = 0;
  for (const col of COLUMNS) {
    const ok = await columnExists(db, col.table, col.name);
    if (!ok) {
      missing++;
      console.error(`migrate-r24: MISSING ${col.table}.${col.name}`);
    }
  }
  if (missing) {
    console.error(`migrate-r24: FAILED, ${missing} column(s) missing`);
    process.exit(1);
  }
  console.log(`migrate-r24: done, ${added} column(s) added, all ${COLUMNS.length} verified present`);
  process.exit(0);
}

main().catch((e) => {
  console.error("migrate-r24 failed:", e);
  process.exit(1);
});
