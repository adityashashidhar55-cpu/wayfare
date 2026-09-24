import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * r34: db/schema.sql is what a fresh deploy runs at boot (db/bootstrap.ts).
 * MariaDB silently promotes a NULL primary-key column to NOT NULL; MySQL 8 and
 * TiDB refuse the whole CREATE TABLE. That exact bug (api_cache.k, fx_rates.code)
 * left every production-shaped database half-built. Guard it.
 */
const sql = readFileSync(resolve(__dirname, "../../db/schema.sql"), "utf8");
const tables = [...sql.matchAll(/CREATE TABLE IF NOT EXISTS `(\w+)` \(([\s\S]*?)\n\)/g)];

describe("db/schema.sql", () => {
  it("declares all 40 app tables", () => {
    expect(tables.length).toBeGreaterThanOrEqual(40);
  });

  it("never declares a primary-key column as NULL", () => {
    const bad: string[] = [];
    for (const [, table, body] of tables) {
      const pk = /PRIMARY KEY \(([^)]*)\)/.exec(body);
      if (!pk) continue;
      for (const [, col] of pk[1].matchAll(/`(\w+)`/g)) {
        const line = new RegExp("\\n  `" + col + "` ([^\\n]*)").exec(body)?.[1] ?? "";
        if (!/NOT NULL/.test(line)) bad.push(`${table}.${col}`);
      }
    }
    expect(bad).toEqual([]);
  });
});
