import { drizzle } from "drizzle-orm/mysql2";
import { env } from "../lib/env";
import { normalizeDatabaseUrl } from "../lib/db-url";
import * as schema from "@db/schema";
import * as relations from "@db/relations";

const fullSchema = { ...schema, ...relations };

let instance: ReturnType<typeof drizzle<typeof fullSchema>>;

export function getDb() {
  if (!instance) {
    // r31: add TLS for managed providers that reject plaintext, so a
    // DATABASE_URL copied straight out of a dashboard connects first try.
    instance = drizzle(normalizeDatabaseUrl(env.databaseUrl, process.env.DB_SSL), {
      mode: "planetscale",
      schema: fullSchema,
    });
  }
  return instance;
}
