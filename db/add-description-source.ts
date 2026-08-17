/**
 * add-description-source.ts (r18-stories) - one-off schema migration:
 * adds explore_places.descriptionSource VARCHAR(16) NULL, the provenance
 * column for place descriptions (curated | dbpedia | composed | user).
 *
 * TiDB/MySQL allows only ONE alter action per statement, so this is a
 * single ADD COLUMN. IDEMPOTENT: a "Duplicate column name" error means
 * the column already exists and is treated as success.
 *
 * Run:  npx tsx db/add-description-source.ts
 */
import { sql } from "drizzle-orm";
import { getDb } from "../api/queries/connection";

async function main() {
  const db = getDb();
  try {
    await db.execute(sql`ALTER TABLE explore_places ADD COLUMN descriptionSource VARCHAR(16) NULL`);
    console.log("add-description-source: column added");
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (/duplicate column/i.test(msg)) {
      console.log("add-description-source: column already exists (idempotent no-op)");
    } else {
      throw e;
    }
  }
  process.exit(0);
}

main().catch((e) => {
  console.error("add-description-source: fatal", e);
  process.exit(1);
});
