/**
 * add-name-local.ts (r19-portal) — one-off schema migration:
 * adds explore_places.nameLocal VARCHAR(255) NULL, holding the original
 * local-script name when `name` has been replaced by its English/Latin form
 * (e.g. name="Al-Masjid an-Nabawi", nameLocal="المسجد النبوي").
 *
 * TiDB/MySQL allows only ONE alter action per statement, so this is a
 * single ADD COLUMN. IDEMPOTENT: a "Duplicate column name" error means
 * the column already exists and is treated as success.
 *
 * Run:  npx tsx db/add-name-local.ts
 */
import { sql } from "drizzle-orm";
import { getDb } from "../api/queries/connection";

async function main() {
  const db = getDb();
  try {
    await db.execute(sql`ALTER TABLE explore_places ADD COLUMN nameLocal VARCHAR(255) NULL`);
    console.log("add-name-local: column added");
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (/duplicate column/i.test(msg)) {
      console.log("add-name-local: column already exists (idempotent no-op)");
    } else {
      throw e;
    }
  }
  process.exit(0);
}

main().catch((e) => {
  console.error("add-name-local: fatal", e);
  process.exit(1);
});
