/**
 * r29 - trip chat, stop voting, and checklist ownership, for an EXISTING db.
 *
 * Run:  npx tsx db/migrate-r29-collab.ts            (dry run)
 *       npx tsx db/migrate-r29-collab.ts --apply    (writes)
 *
 * Safe by construction: two CREATE TABLE IF NOT EXISTS and three additive
 * ALTERs with defaults that reproduce the current behaviour exactly. Every
 * existing checklist row becomes ownerId NULL / visibility 'shared', which is
 * what it already effectively was.
 */
import "dotenv/config";
import { sql } from "drizzle-orm";
import { getDb } from "../api/queries/connection";

const APPLY = process.argv.includes("--apply");
const log = (...a: unknown[]) => console.log("[r29]", ...a);

/** mysql2 tuple unwrap - results at [0]. See db/audit-france-locations.ts:126. */
function head(raw: unknown): unknown {
  return Array.isArray(raw) ? raw[0] : raw;
}

async function tableExists(name: string): Promise<boolean> {
  const rows = head(await getDb().execute(
    sql`SELECT COUNT(*) AS n FROM information_schema.tables
        WHERE table_schema = DATABASE() AND table_name = ${name}`,
  )) as { n: number }[] | undefined;
  return Number(rows?.[0]?.n ?? 0) > 0;
}

async function columnExists(table: string, col: string): Promise<boolean> {
  const rows = head(await getDb().execute(
    sql`SELECT COUNT(*) AS n FROM information_schema.columns
        WHERE table_schema = DATABASE() AND table_name = ${table} AND column_name = ${col}`,
  )) as { n: number }[] | undefined;
  return Number(rows?.[0]?.n ?? 0) > 0;
}

const TABLES: { name: string; ddl: string }[] = [
  {
    name: "trip_messages",
    ddl: `CREATE TABLE IF NOT EXISTS trip_messages (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
      tripId BIGINT UNSIGNED NOT NULL,
      userId BIGINT UNSIGNED NOT NULL,
      authorName VARCHAR(255) NOT NULL,
      body VARCHAR(2000) NOT NULL,
      stopId BIGINT UNSIGNED NULL,
      createdAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      KEY idx_trip_messages (tripId, id)
    )`,
  },
  {
    name: "stop_votes",
    ddl: `CREATE TABLE IF NOT EXISTS stop_votes (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
      tripId BIGINT UNSIGNED NOT NULL,
      stopId BIGINT UNSIGNED NOT NULL,
      userId BIGINT UNSIGNED NOT NULL,
      vote ENUM('up','down') NOT NULL,
      createdAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updatedAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      UNIQUE KEY uq_stop_vote (stopId, userId),
      KEY idx_stop_votes_trip (tripId, stopId)
    )`,
  },
];

const COLUMNS: { table: string; col: string; ddl: string }[] = [
  { table: "checklist_items", col: "ownerId",
    ddl: "ADD COLUMN ownerId BIGINT UNSIGNED NULL" },
  { table: "checklist_items", col: "visibility",
    ddl: "ADD COLUMN visibility ENUM('shared','private') NOT NULL DEFAULT 'shared'" },
  { table: "checklist_items", col: "assignedMemberId",
    ddl: "ADD COLUMN assignedMemberId BIGINT UNSIGNED NULL" },
  { table: "checklist_items", col: "createdAt",
    ddl: "ADD COLUMN createdAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP" },
];

async function main() {
  const db = getDb();
  log(APPLY ? "APPLYING" : "DRY RUN (pass --apply to write)");

  for (const { name, ddl } of TABLES) {
    if (await tableExists(name)) { log(`${name}: exists`); continue; }
    if (!APPLY) { log(`${name}: WOULD CREATE`); continue; }
    await db.execute(sql.raw(ddl));
    log(`${name}: created`);
  }

  for (const { table, col, ddl } of COLUMNS) {
    if (await columnExists(table, col)) { log(`${table}.${col}: exists`); continue; }
    if (!APPLY) { log(`${table}.${col}: WOULD ADD`); continue; }
    await db.execute(sql.raw(`ALTER TABLE ${table} ${ddl}`));
    log(`${table}.${col}: added`);
  }

  if (APPLY) {
    try {
      await db.execute(sql.raw("CREATE INDEX idx_checklist_owner ON checklist_items (tripId, ownerId)"));
      log("idx_checklist_owner created");
    } catch { log("idx_checklist_owner already present"); }
  }

  log("done.");
  process.exit(0);
}

main().catch((e) => { console.error("[r29] failed", e); process.exit(1); });
