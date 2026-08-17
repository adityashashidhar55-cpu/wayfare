import { formatMoneyCompact } from "@contracts/fx";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { trpc } from "@/providers/trpc";
import { budgetStatus, convertCents, costBreakdown } from "@/lib/day-cost";
import { cn } from "@/lib/utils";
import type { TripData } from "./utils";

/**
 * r24-core (A + J): trip-level "planned vs budget" chip in the workspace
 * header. Planned = stop tickets + meals + transport legs (approx, converted
 * to home currency). A gentle tint shift flags near/over budget - advisory,
 * never blocking.
 */
export default function TripCostChip({
  data,
  tripId,
}: {
  data: TripData;
  tripId: number;
}) {
  const q = trpc.explore.stopPrices.useQuery({ tripId }, { staleTime: 60_000 });
  const currency = data.trip.homeCurrency || "USD";
  const b = costBreakdown(data.stops, q.data?.prices ?? [], currency);
  const budgetHome = data.trip.budgetCents
    ? convertCents(
        data.trip.budgetCents,
        data.trip.budgetCurrency || currency,
        currency,
      )
    : 0;
  const status = budgetStatus(b.totalCents, budgetHome || null);

  if (b.totalCents === 0 && status === "none") return null;

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          title="Planned spend vs budget (approx), tap for details"
          className={cn(
            "type-caption tnum inline-flex shrink-0 items-center gap-1.5 rounded-pill px-2.5 py-1 font-semibold transition-colors duration-fast",
            status === "over"
              ? "bg-danger/10 text-danger"
              : status === "near"
                ? "bg-ochre-soft text-ochre"
                : "bg-surface-2 text-ink-2 hover:bg-border hover:text-ink",
          )}
        >
          ≈ {formatMoneyCompact(b.totalCents, currency)} planned
          {budgetHome > 0 ? (
            <span className="font-normal opacity-80">
              / {formatMoneyCompact(budgetHome, currency)}
            </span>
          ) : null}
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-64 rounded-lg p-3">
        <p className="type-eyebrow text-ink-3">Trip total · approx</p>
        <ul className="mt-2 space-y-1.5">
          <li className="flex items-center justify-between">
            <span className="type-small text-ink-2">Tickets & entry</span>
            <span className="type-small tnum font-semibold text-ink">
              {formatMoneyCompact(b.ticketsCents, currency)}
            </span>
          </li>
          <li className="flex items-center justify-between">
            <span className="type-small text-ink-2">Food</span>
            <span className="type-small tnum font-semibold text-ink">
              {formatMoneyCompact(b.foodCents, currency)}
            </span>
          </li>
          <li className="flex items-center justify-between">
            <span className="type-small text-ink-2">Transport legs</span>
            <span className="type-small tnum font-semibold text-ink">
              {formatMoneyCompact(b.transportCents, currency)}
            </span>
          </li>
          <li className="flex items-center justify-between border-t border-border pt-1.5">
            <span className="type-small font-semibold text-ink">Planned</span>
            <span className="type-small tnum font-semibold text-ink">
              {formatMoneyCompact(b.totalCents, currency)}
            </span>
          </li>
          {budgetHome > 0 ? (
            <li className="flex items-center justify-between">
              <span className="type-small text-ink-2">Budget</span>
              <span
                className={cn(
                  "type-small tnum font-semibold",
                  status === "over" ? "text-danger" : "text-ink",
                )}
              >
                {formatMoneyCompact(budgetHome, currency)}
              </span>
            </li>
          ) : null}
        </ul>
        {status === "over" ? (
          <p className="type-caption mt-2 text-danger">
            About {formatMoneyCompact(b.totalCents - budgetHome, currency)} over
            budget. Swap in free sights or cheaper legs to pull it back.
          </p>
        ) : status === "near" ? (
          <p className="type-caption mt-2 text-ochre">
            Close to the budget already, the pricey picks are the lever.
          </p>
        ) : (
          <p className="type-caption mt-2 text-ink-3">
            Estimates from avg local prices, {b.known} of {b.total} stops priced.
          </p>
        )}
      </PopoverContent>
    </Popover>
  );
}
