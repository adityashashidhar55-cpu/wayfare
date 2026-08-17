/**
 * day-cost.ts (r24-core, features A + J) - pure day/trip cost math.
 *
 * Combines the per-stop price matches (explore.stopPrices: admission
 * feeCents / mealCents in LOCAL currency) with the r24 transportCents legs
 * (already stored in the trip's home currency) into per-category totals
 * converted to one display currency. Values stay approximate - UI labels
 * them "Est."/"approx".
 */
import { FX_PER_USD } from "@contracts/fx";

export interface StopPriceLike {
  stopId: number;
  category: string;
  feeCents: number | null;
  mealCents: number | null;
  feeCurrency: string | null;
}

export interface StopCostLike {
  id: number;
  dayId: number | null;
  category: string;
  transportCents?: number | null;
}

export interface CostBreakdown {
  ticketsCents: number;
  foodCents: number;
  transportCents: number;
  totalCents: number;
  /** stops with any ticket/meal price data */
  known: number;
  /** stops considered */
  total: number;
}

/** Convert cents between currencies via the static USD FX table. */
export function convertCents(
  cents: number,
  fromCurrency: string,
  toCurrency: string,
): number {
  if (fromCurrency === toCurrency) return Math.round(cents);
  const from = FX_PER_USD[fromCurrency];
  const to = FX_PER_USD[toCurrency];
  if (!from || !to) return Math.round(cents); // unknown currency: pass through
  return Math.round((cents / from) * to);
}

/**
 * Cost breakdown for one set of stops (one day, or a whole trip).
 * - food-category stops count mealCents, others count feeCents
 * - transportCents legs are assumed to already be in `currency`
 */
export function costBreakdown(
  stops: StopCostLike[],
  prices: StopPriceLike[],
  currency: string,
): CostBreakdown {
  const byStop = new Map(prices.map((p) => [p.stopId, p]));
  let ticketsCents = 0;
  let foodCents = 0;
  let transportCents = 0;
  let known = 0;

  for (const s of stops) {
    transportCents += s.transportCents ?? 0;
    const p = byStop.get(s.id);
    if (!p) continue;
    const cur = p.feeCurrency ?? currency;
    if (p.category === "food" || s.category === "food") {
      if (p.mealCents != null) {
        foodCents += convertCents(p.mealCents, cur, currency);
        known++;
      }
    } else if (p.feeCents != null) {
      ticketsCents += convertCents(p.feeCents, cur, currency);
      known++;
    }
  }

  return {
    ticketsCents,
    foodCents,
    transportCents,
    totalCents: ticketsCents + foodCents + transportCents,
    known,
    total: stops.length,
  };
}

/** Group stops by dayId and compute each day's breakdown (ordered by days). */
export function dayCostBreakdowns(
  stops: StopCostLike[],
  prices: StopPriceLike[],
  currency: string,
): Map<number, CostBreakdown> {
  const byDay = new Map<number, StopCostLike[]>();
  for (const s of stops) {
    if (s.dayId == null) continue;
    const arr = byDay.get(s.dayId) ?? [];
    arr.push(s);
    byDay.set(s.dayId, arr);
  }
  const out = new Map<number, CostBreakdown>();
  for (const [dayId, list] of byDay) {
    out.set(dayId, costBreakdown(list, prices, currency));
  }
  return out;
}

/** Gentle budget status for the planned-vs-budget indicator. */
export function budgetStatus(
  plannedCents: number,
  budgetCents: number | null | undefined,
): "none" | "under" | "near" | "over" {
  if (!budgetCents || budgetCents <= 0) return "none";
  if (plannedCents > budgetCents) return "over";
  if (plannedCents >= budgetCents * 0.85) return "near";
  return "under";
}
