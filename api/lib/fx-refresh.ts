/**
 * fx-refresh.ts (r27) - live exchange rates.
 *
 * contracts/fx.ts ships a hardcoded FX_PER_USD table with no refresh path,
 * and it converts real money: shared trip expenses, budgets and per-person
 * balances all run through convertCents(). Rates that were roughly right when
 * the table was typed drift, and the drift shows up as a wrong number in
 * somebody's settle-up.
 *
 * Design:
 *   - The static table STAYS as the offline fallback. Nothing here can make
 *     the app worse than it is today; a failed fetch just leaves the old
 *     numbers in place.
 *   - Rates land in the `fx_rates` table and are served from there, so every
 *     process and the client agree on one set of numbers for the day.
 *   - Source is exchangerate.host's open endpoint: no API key, USD base,
 *     daily granularity, which is the right resolution for expense splitting.
 *     A second source is tried if the first fails.
 *
 * Sanity guard: a rate is only accepted if it is finite, positive, and within
 * 10x of the static baseline for currencies we already know. A malformed or
 * hijacked upstream response should not be able to multiply somebody's hotel
 * bill by a thousand.
 */
import { sql } from "drizzle-orm";
import * as schema from "@db/schema";
import { FX_PER_USD } from "@contracts/fx";
import { getDb } from "../queries/connection";

/** How long a stored rate is considered fresh. */
export const FX_TTL_MS = 12 * 60 * 60 * 1000;

const SOURCES = [
  "https://api.exchangerate.host/latest?base=USD",
  "https://open.er-api.com/v6/latest/USD",
];

/** Currencies we care about - everything the app can display. */
const WANTED = Object.keys(FX_PER_USD);

let inFlight: Promise<Record<string, number>> | null = null;
let lastRefreshAt = 0;

/**
 * Current rates: DB if fresh, otherwise refresh, otherwise the static table.
 * Never throws.
 */
export async function getRates(): Promise<{ rates: Record<string, number>; source: "live" | "static" }> {
  try {
    const rows = await getDb().select().from(schema.fxRates);
    const fresh = rows.filter((r) => Date.now() - r.fetchedAt.getTime() < FX_TTL_MS);
    if (fresh.length >= 5) {
      const rates = { ...FX_PER_USD };
      for (const r of fresh) rates[r.code] = r.perUsd;
      // Kick off a background refresh when we're past half the TTL, so a user
      // request never waits on the network.
      if (Date.now() - lastRefreshAt > FX_TTL_MS / 2) void refreshRates();
      return { rates, source: "live" };
    }
    const refreshed = await refreshRates();
    if (Object.keys(refreshed).length) {
      return { rates: { ...FX_PER_USD, ...refreshed }, source: "live" };
    }
  } catch (e) {
    console.warn("fx: falling back to the static table", e);
  }
  return { rates: { ...FX_PER_USD }, source: "static" };
}

/**
 * Fetch and persist. Coalesced - concurrent callers share one request rather
 * than each hitting the upstream.
 */
export async function refreshRates(): Promise<Record<string, number>> {
  if (inFlight) return inFlight;
  inFlight = doRefresh().finally(() => {
    inFlight = null;
  });
  return inFlight;
}

async function doRefresh(): Promise<Record<string, number>> {
  for (const url of SOURCES) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
      if (!res.ok) continue;
      const body = (await res.json()) as { rates?: Record<string, unknown> };
      const raw = body.rates;
      if (!raw || typeof raw !== "object") continue;

      const accepted: Record<string, number> = {};
      for (const code of WANTED) {
        const v = Number(raw[code]);
        if (!isSaneRate(code, v)) continue;
        accepted[code] = v;
      }
      // A response missing most of what we asked for is a broken response.
      if (Object.keys(accepted).length < 5) continue;
      accepted.USD = 1;

      await persist(accepted);
      lastRefreshAt = Date.now();
      return accepted;
    } catch (e) {
      console.warn(`fx: source failed ${url}`, e);
    }
  }
  return {};
}

/**
 * Reject anything that would corrupt a conversion. The 10x band is wide
 * enough for years of genuine drift and narrow enough to catch a units change
 * or a garbage payload.
 */
function isSaneRate(code: string, v: number): boolean {
  if (!Number.isFinite(v) || v <= 0) return false;
  const baseline = FX_PER_USD[code];
  if (baseline == null) return true;
  return v >= baseline / 10 && v <= baseline * 10;
}

async function persist(rates: Record<string, number>): Promise<void> {
  const db = getDb();
  const values = Object.entries(rates).map(([code, perUsd]) => ({
    code,
    perUsd,
    fetchedAt: new Date(),
  }));
  if (!values.length) return;
  await db
    .insert(schema.fxRates)
    .values(values)
    .onDuplicateKeyUpdate({
      set: {
        perUsd: sql`values(perUsd)`,
        fetchedAt: sql`values(fetchedAt)`,
      },
    });
}

export const __test = { isSaneRate };
