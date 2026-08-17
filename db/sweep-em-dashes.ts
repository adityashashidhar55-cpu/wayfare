/**
 * sweep-em-dashes.ts - one-off data cleanup: removes every U+2014 em dash from
 * user-facing text columns. Idempotent (rows without an em dash are untouched,
 * so re-running is a no-op).
 *
 * NOTE: the em dash is written as CHAR(8212) / escape sequences ONLY - never as
 * a literal character - so repo-wide punctuation codemods cannot mangle this
 * script again.
 *
 * Pipeline: ' EM ' -> ', ' ; remaining EM -> '-' ; then collapse artifacts
 * (',,' -> ',', ' ,' -> ',', ' .' -> '.', double spaces).
 *
 * Tables/columns:
 *   explore_places.description
 *   signature_dishes.blurb
 *   signature_dish_places.why
 *
 * Run:  npx tsx db/sweep-em-dashes.ts
 */
import { sql } from "drizzle-orm";
import { getDb } from "../api/queries/connection";

// Byte-exact match on the UTF-8 encoding of U+2014. NOTE: a collation-based
// LIKE on CHAR(8212) is NOT reliable here - it matched zero-width format
// characters (U+200C-200F) yet missed rows containing literal em dashes.
const EM_LIKE = "CONCAT('%', 'E28094', '%')";
const EM_COL = (column: string) => `HEX(${column})`;

const EM_SQL = "CONVERT(UNHEX('E28094') USING utf8mb4)";
const PIPELINE = (column: string) =>
  `TRIM(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(${column}, CONCAT(' ', ${EM_SQL}, ' '), ', '), ${EM_SQL}, '-'), ',,', ','), ' ,', ','), ' .', '.'), '  ', ' '))`;

const TARGETS: Array<{ table: string; column: string }> = [
  { table: "explore_places", column: "description" },
  { table: "signature_dishes", column: "blurb" },
  { table: "signature_dish_places", column: "why" },
];

async function main() {
  const db = getDb();
  for (const { table, column } of TARGETS) {
    const before = await db.execute(
      sql.raw(`SELECT COUNT(*) AS n FROM ${table} WHERE ${EM_COL(column)} LIKE ${EM_LIKE}`),
    );
    const hitRows = Number((before[0] as unknown as Array<{ n: number | string }>)[0]?.n ?? 0);
    if (hitRows === 0) {
      console.log(`${table}.${column}: 0 rows contain an em dash (no-op)`);
      continue;
    }
    await db.execute(
      sql.raw(`UPDATE ${table} SET ${column} = ${PIPELINE(column)} WHERE ${EM_COL(column)} LIKE ${EM_LIKE}`),
    );
    const after = await db.execute(
      sql.raw(`SELECT COUNT(*) AS n FROM ${table} WHERE ${EM_COL(column)} LIKE ${EM_LIKE}`),
    );
    const leftRows = Number((after[0] as unknown as Array<{ n: number | string }>)[0]?.n ?? 0);
    console.log(`${table}.${column}: swept ${hitRows} rows (${leftRows} still contain an em dash)`);
  }
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
