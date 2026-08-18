/**
 * r31: bring an EMPTY database up on its own, at boot.
 *
 * Before this, a fresh deploy needed a human with a MySQL client: create the
 * 40 tables by hand, then load the corpus. On a PaaS with no shell (Render's
 * free tier, Railway without the CLI) that was simply impossible, which meant
 * the app could be deployed and still show nothing. Now the server does it.
 *
 * Three properties matter more than speed here:
 *
 *  1. IDEMPOTENT. Every DDL statement is CREATE TABLE IF NOT EXISTS, and the
 *     corpus only loads when explore_places is empty. Restarting the container
 *     - which a PaaS does freely - must not duplicate half a million rows.
 *  2. NON-BLOCKING. This is fired after the HTTP server is already listening.
 *     Loading the corpus takes minutes; a platform health check that waits on
 *     it would kill the container mid-load, forever.
 *  3. FAIL-OPEN. A bootstrap failure is logged loudly and the server keeps
 *     serving. A database that is already set up must never be put at risk by
 *     the code whose only job is to set one up.
 */
import { createReadStream, existsSync } from "node:fs";
import { createInterface } from "node:readline";
import { resolve } from "node:path";
import { createGunzip } from "node:zlib";
import mysql from "mysql2/promise";
import type { Connection } from "mysql2/promise";
import { normalizeDatabaseUrl } from "../api/lib/db-url";

/** Generated from db/schema.ts - see wf-data/gen-schema.mjs. */
const SCHEMA_FILE = "db/schema.sql";
/** 526,142 places extracted from the original Kimi database. */
const CORPUS_FILE = "db/data/explore_places.mysql.sql.gz";

/**
 * Yield one SQL statement at a time without ever holding the file in memory.
 *
 * Both generated files put every statement's terminating `;` at the end of a
 * line, and escape newlines inside string literals as `\n`, so "a line ending
 * in ;" is an exact statement boundary rather than a heuristic. That matters:
 * the corpus decompresses to ~150 MB, and splitting it with `.split(";")`
 * would need all of it resident at once - more than a small container has.
 */
export async function* sqlStatements(path: string): AsyncGenerator<string> {
  const file = createReadStream(path);
  const input = path.endsWith(".gz") ? file.pipe(createGunzip()) : file;
  const rl = createInterface({ input, crlfDelay: Infinity });
  let buf: string[] = [];
  for await (const line of rl) {
    const trimmed = line.trimEnd();
    // Comments and blank lines only ever appear BETWEEN statements in these
    // files, so this is safe; skipping them mid-statement would corrupt one.
    if (buf.length === 0 && (trimmed === "" || trimmed.startsWith("--"))) continue;
    buf.push(trimmed);
    if (trimmed.endsWith(";")) {
      const stmt = buf.join("\n");
      buf = [];
      yield stmt.slice(0, -1); // drop the ";"
    }
  }
  const tail = buf.join("\n").trim();
  if (tail) yield tail;
}

async function tableExists(conn: Connection, table: string): Promise<boolean> {
  const [rows] = await conn.query(
    "SELECT COUNT(*) AS n FROM information_schema.tables WHERE table_schema = DATABASE() AND table_name = ?",
    [table],
  );
  return Number((rows as unknown as Array<{ n: number }>)[0]?.n ?? 0) > 0;
}

async function rowCount(conn: Connection, table: string): Promise<number> {
  const [rows] = await conn.query(`SELECT COUNT(*) AS n FROM \`${table}\``);
  return Number((rows as unknown as Array<{ n: number }>)[0]?.n ?? 0);
}

/**
 * A one-row-per-completed-step marker table.
 *
 * "Is the corpus loaded?" cannot be answered by `COUNT(*) > 0`: a container
 * killed 300 batches into the load leaves a table that is non-empty and also
 * badly incomplete, and every restart after that would skip the rest forever.
 * The marker is only written once the final batch has been applied, so a crash
 * simply means the next boot loads it again from the top.
 */
const STATE_TABLE = "bootstrap_state";

async function ensureStateTable(conn: Connection): Promise<void> {
  await conn.query(
    `CREATE TABLE IF NOT EXISTS \`${STATE_TABLE}\` (
       \`step\` VARCHAR(64) NOT NULL,
       \`detail\` VARCHAR(255) NULL,
       \`completedAt\` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
       PRIMARY KEY (\`step\`)
     ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
  );
}

async function stepDone(conn: Connection, step: string): Promise<boolean> {
  const [rows] = await conn.query(
    `SELECT COUNT(*) AS n FROM \`${STATE_TABLE}\` WHERE step = ?`, [step],
  );
  return Number((rows as unknown as Array<{ n: number }>)[0]?.n ?? 0) > 0;
}

async function markDone(conn: Connection, step: string, detail: string): Promise<void> {
  await conn.query(
    `INSERT INTO \`${STATE_TABLE}\` (step, detail) VALUES (?, ?)
     ON DUPLICATE KEY UPDATE detail = VALUES(detail), completedAt = CURRENT_TIMESTAMP`,
    [step, detail],
  );
}

/**
 * Make a bulk INSERT safe to replay.
 *
 * The corpus ships explicit primary keys, so re-running a batch that already
 * landed would fail on a duplicate key and abort the whole load. `ON DUPLICATE
 * KEY UPDATE id = id` turns that into a no-op. We use it rather than `INSERT
 * IGNORE`, which would also swallow genuine data errors (a truncated column
 * becomes a warning instead of a failure) and hide real corruption.
 */
export function replayable(stmt: string): string {
  return /^\s*INSERT\s+INTO/i.test(stmt) ? `${stmt} ON DUPLICATE KEY UPDATE id = id` : stmt;
}

export async function bootstrapDatabase(): Promise<void> {
  if (process.env.AUTO_BOOTSTRAP === "0") {
    console.log("[bootstrap] AUTO_BOOTSTRAP=0, skipping");
    return;
  }
  const url = normalizeDatabaseUrl(process.env.DATABASE_URL ?? "", process.env.DB_SSL);
  if (!url) {
    console.warn("[bootstrap] no DATABASE_URL, skipping");
    return;
  }

  const conn = await mysql.createConnection({ uri: url });
  try {
    // ── Schema ───────────────────────────────────────────────────────────
    const schemaPath = resolve(process.cwd(), SCHEMA_FILE);
    if (!existsSync(schemaPath)) {
      console.warn(`[bootstrap] ${SCHEMA_FILE} not found, cannot create tables`);
    } else if (await tableExists(conn, "users")) {
      console.log("[bootstrap] schema already present");
    } else {
      console.log("[bootstrap] empty database - creating schema...");
      let n = 0;
      for await (const stmt of sqlStatements(schemaPath)) {
        await conn.query(stmt);
        n++;
      }
      console.log(`[bootstrap] schema ready (${n} statements)`);
    }

    // ── Corpus ───────────────────────────────────────────────────────────
    if (!(await tableExists(conn, "explore_places"))) {
      console.warn("[bootstrap] explore_places missing, skipping corpus");
      return;
    }
    await ensureStateTable(conn);
    if (await stepDone(conn, "corpus")) {
      console.log("[bootstrap] corpus already loaded");
      return;
    }
    const have = await rowCount(conn, "explore_places");
    if (have > 0) {
      console.log(`[bootstrap] resuming an interrupted corpus load (${have} rows present)`);
    }
    const corpusPath = resolve(process.cwd(), CORPUS_FILE);
    if (!existsSync(corpusPath)) {
      console.warn(
        `[bootstrap] ${CORPUS_FILE} not found - the app will run, but Explore will be empty`,
      );
      return;
    }
    console.log("[bootstrap] loading place corpus (this takes a few minutes)...");
    const started = Date.now();
    let batches = 0;
    for await (const stmt of sqlStatements(corpusPath)) {
      await conn.query(replayable(stmt));
      batches++;
      if (batches % 50 === 0) {
        console.log(`[bootstrap] ...${batches} batches in ${Math.round((Date.now() - started) / 1000)}s`);
      }
    }
    const loaded = await rowCount(conn, "explore_places");
    await markDone(conn, "corpus", `${loaded} places`);
    console.log(
      `[bootstrap] corpus loaded: ${loaded} places in ${Math.round((Date.now() - started) / 1000)}s`,
    );
  } finally {
    await conn.end();
  }
}
