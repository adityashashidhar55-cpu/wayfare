import { formatMoneyCompact } from "@contracts/fx";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { trpc } from "@/providers/trpc";
import { costBreakdown } from "@/lib/day-cost";
import type { WsStop } from "./utils";

/**
 * r24-core (J): day-wise cost chip in the day header - tickets + meals
 * (matched explore_places prices, converted) + chosen transport legs, with a
 * popover breaking the total down per category. All values are estimates.
 * Renders nothing while there is no price data and no transport chosen.
 */
export default function DayCostChip({
  tripId,
  stops,
  currency,
}: {
  tripId: number;
  stops: WsStop[];
  currency: string;
}) {
  const q = trpc.explore.stopPrices.useQuery({ tripId }, { staleTime: 60_000 });
  const b = costBreakdown(stops, q.data?.prices ?? [], currency);
  if (b.known === 0 && b.transportCents === 0) return null;

  const rows: { label: string; cents: number }[] = [
    { label: "Tickets & entry", cents: b.ticketsCents },
    { label: "Food", cents: b.foodCents },
    { label: "Transport", cents: b.transportCents },
  ];

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          title="Day cost estimate, tap for the breakdown"
          className="type-caption tnum inline-flex shrink-0 items-center rounded-pill bg-surface-2 px-2 py-0.5 font-semibold text-ink-2 transition-colors duration-fast hover:bg-border hover:text-ink"
        >
          ≈ {formatMoneyCompact(b.totalCents, currency)}
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-56 rounded-lg p-3">
        <p className="type-eyebrow text-ink-3">Day cost · approx</p>
        <ul className="mt-2 space-y-1.5">
          {rows.map(r => (
            <li key={r.label} className="flex items-center justify-between">
              <span className="type-small text-ink-2">{r.label}</span>
              <span className="type-small tnum font-semibold text-ink">
                {formatMoneyCompact(r.cents, currency)}
              </span>
            </li>
          ))}
          <li className="flex items-center justify-between border-t border-border pt-1.5">
            <span className="type-small font-semibold text-ink">Total</span>
            <span className="type-small tnum font-semibold text-ink">
              {formatMoneyCompact(b.totalCents, currency)}
            </span>
          </li>
        </ul>
        <p className="type-caption mt-2 text-ink-3">
          Est. from avg local prices · {b.known} of {b.total} stops priced
        </p>
      </PopoverContent>
    </Popover>
  );
}
