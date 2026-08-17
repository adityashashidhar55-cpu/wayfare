import { useState } from "react";
import { ChevronDown, Wallet } from "lucide-react";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { trpc } from "@/providers/trpc";
import { formatMoneyCompact } from "@contracts/fx";
import { cn } from "@/lib/utils";
import TripWeatherStrip from "./TripWeatherStrip";
import SafetyCard from "./SafetyCard";

/* ── Cost estimate (activities + food, avg local prices) ───────────────────
   Shared by the compact pill and the expanded breakdown. Same matching rule
   as the old header TripCostLine: food stops use mealCents, everything else
   feeCents, grouped by feeCurrency. */
function useTripCosts(tripId: number) {
  const q = trpc.explore.stopPrices.useQuery(
    { tripId },
    { staleTime: 60_000 }
  );
  const prices = q.data?.prices;
  if (!prices?.length) return null;
  type Bucket = { activities: number; food: number };
  const byCurrency: Record<string, Bucket> = {};
  let pricedStops = 0;
  for (const p of prices) {
    const isFood = p.category === "food";
    const amt = isFood ? p.mealCents : p.feeCents;
    if (amt == null || !p.feeCurrency) continue;
    const bucket = (byCurrency[p.feeCurrency] ??= { activities: 0, food: 0 });
    bucket[isFood ? "food" : "activities"] += amt;
    pricedStops++;
  }
  const entries = Object.entries(byCurrency).filter(
    ([, b]) => b.activities + b.food > 0
  );
  if (entries.length === 0) return null;
  return { entries, pricedStops };
}

/** Mini-pill: "≈¥10,200 est." (one per currency, joined). */
function CostPill({ tripId }: { tripId: number }) {
  const costs = useTripCosts(tripId);
  if (!costs) return null;
  const text = costs.entries
    .map(([currency, b]) =>
      `≈${formatMoneyCompact(b.activities + b.food, currency)}`
    )
    .join(" + ");
  return (
    <span
      className="type-caption tnum inline-flex shrink-0 items-center gap-1 rounded-pill bg-surface-2 px-2 py-0.5 text-ink-3"
      title="Estimated activity + food cost for this trip (avg local prices)"
    >
      <Wallet className="h-3 w-3" strokeWidth={1.75} aria-hidden />
      {text} est.
    </span>
  );
}

/** Expanded cost breakdown for the disclosure panel. */
function CostBreakdown({ tripId }: { tripId: number }) {
  const costs = useTripCosts(tripId);
  return (
    <section>
      <div className="flex items-baseline justify-between gap-2">
        <p className="type-small flex items-center gap-1.5 font-semibold text-ink">
          <Wallet className="h-3.5 w-3.5 text-ink-3" strokeWidth={1.75} />
          Estimated trip costs
        </p>
        <span className="type-caption shrink-0 text-ink-3">
          avg local prices
        </span>
      </div>
      {costs ? (
        <>
          <ul className="mt-2 space-y-1.5">
            {costs.entries.map(([currency, b]) => (
              <li
                key={currency}
                className="type-caption flex flex-wrap items-center gap-x-3 gap-y-0.5 rounded-md bg-surface-2 px-2.5 py-1.5 text-ink-2"
              >
                <span className="tnum font-semibold text-ink">
                  ≈{formatMoneyCompact(b.activities + b.food, currency)}{" "}
                  {currency}
                </span>
                <span className="tnum">
                  Activities ≈{formatMoneyCompact(b.activities, currency)}
                </span>
                <span className="tnum">
                  Food ≈{formatMoneyCompact(b.food, currency)}
                </span>
              </li>
            ))}
          </ul>
          <p className="type-caption mt-2 leading-relaxed text-ink-3">
            Tickets and typical meal costs for {costs.pricedStops} priced
            stop{costs.pricedStops === 1 ? "" : "s"} on this trip, before
            transport and lodging.
          </p>
        </>
      ) : (
        <p className="type-caption mt-1.5 text-ink-3">
          No price estimates available for this trip yet.
        </p>
      )}
    </section>
  );
}

/**
 * Consolidated header insights - one calm row of mini-pills (weather summary,
 * safety level, cost estimate) plus a "Details" disclosure that opens the
 * full breakdowns (day-by-day weather, travel-guidance card, cost split).
 * Replaces the old stack of separate weather / safety / cost lines in the
 * workspace header. Each pill hides itself when its data is unavailable.
 */
export default function TripInsights({ tripId }: { tripId: number }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="flex flex-wrap items-center gap-1.5 px-1.5">
      <TripWeatherStrip tripId={tripId} variant="compact" />
      <SafetyCard tripId={tripId} variant="compact" />
      <CostPill tripId={tripId} />
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <button
            type="button"
            className="type-caption inline-flex shrink-0 items-center gap-1 rounded-pill px-2 py-0.5 font-semibold text-ink-3 transition-colors duration-fast hover:bg-surface-2 hover:text-ink"
          >
            Details
            <ChevronDown
              className={cn(
                "h-3 w-3 transition-transform duration-fast",
                open && "rotate-180"
              )}
              strokeWidth={2}
              aria-hidden
            />
          </button>
        </PopoverTrigger>
        <PopoverContent
          align="start"
          className="w-[min(92vw,480px)] rounded-xl p-0"
        >
          <div className="border-b border-border px-4 py-3">
            <p className="type-h4 text-ink">Trip insights</p>
            <p className="type-caption mt-0.5 text-ink-3">
              Weather, guidance and cost estimates across your dates
            </p>
          </div>
          <div className="max-h-[60vh] space-y-5 overflow-y-auto px-4 py-4">
            <TripWeatherStrip tripId={tripId} variant="full" />
            <SafetyCard tripId={tripId} variant="full" />
            <CostBreakdown tripId={tripId} />
          </div>
        </PopoverContent>
      </Popover>
    </div>
  );
}
