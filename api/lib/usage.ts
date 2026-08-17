/**
 * usage.ts (r24-smart) - monthly external-API usage metering against the
 * api_usage table. Used to cap premium features like the Google Maps embed
 * (100 embed views per user per calendar month, UTC).
 */
import { and, eq, gte, sql } from "drizzle-orm";
import * as schema from "@db/schema";
import { getDb } from "../queries/connection";

export const MAPS_EMBED_KIND = "maps_embed";
export const MAPS_EMBED_MONTHLY_CAP = 100;

/** Start of the current UTC calendar month. */
export function monthStart(now: Date = new Date()): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
}

/** How many `kind` calls the user has made this calendar month. */
export async function countMonthlyUsage(userId: number, kind: string, now: Date = new Date()): Promise<number> {
  const db = getDb();
  const [row] = await db
    .select({ c: sql<number>`COUNT(*)` })
    .from(schema.apiUsage)
    .where(
      and(
        eq(schema.apiUsage.userId, userId),
        eq(schema.apiUsage.kind, kind),
        gte(schema.apiUsage.createdAt, monthStart(now)),
      ),
    );
  return Number(row?.c ?? 0);
}

/** Record one usage event. Callers check the cap first. */
export async function recordUsage(userId: number, kind: string): Promise<void> {
  await getDb().insert(schema.apiUsage).values({ userId, kind });
}
