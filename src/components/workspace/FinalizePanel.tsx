import { useMemo } from "react";
import { Check, CircleCheckBig } from "lucide-react";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import type { TripData } from "./utils";

/**
 * r24-core (M-lite): trip finalization checklist. Items are auto-derived
 * from trip data (no manual ticking) and the ring shows overall readiness.
 * Hotel/flight booking stays out of scope - these are readiness signals.
 */

interface FinalizeItem {
  key: string;
  label: string;
  hint: string;
  done: boolean;
}

function deriveItems(data: TripData): FinalizeItem[] {
  const { trip, days, stops } = data;
  const dayHasStops = new Map<number, number>();
  for (const s of stops) {
    if (s.dayId != null) dayHasStops.set(s.dayId, (dayHasStops.get(s.dayId) ?? 0) + 1);
  }
  const allDaysFilled = days.length > 0 && days.every(d => (dayHasStops.get(d.id) ?? 0) > 0);

  /* transport legs: every non-first stop in a geo'd multi-stop day should
     carry a chosen leg mode */
  const stopsByDay = new Map<number, typeof stops>();
  for (const s of stops) {
    if (s.dayId == null) continue;
    const arr = stopsByDay.get(s.dayId) ?? [];
    arr.push(s);
    stopsByDay.set(s.dayId, arr);
  }
  let legsNeeded = 0;
  let legsChosen = 0;
  for (const list of stopsByDay.values()) {
    const sorted = [...list].sort((a, b) => a.position - b.position);
    for (let i = 1; i < sorted.length; i++) {
      if (sorted[i].lat != null && sorted[i - 1].lat != null) {
        legsNeeded++;
        if (sorted[i].transportMode) legsChosen++;
      }
    }
  }

  const hasLodging =
    !!trip.hotelName ||
    days.some(d => !!d.hotelName) ||
    stops.some(s => s.category === "lodging");

  const bookedCount = stops.filter(s => s.bookedAt != null).length;

  return [
    {
      key: "dates",
      label: "Dates set",
      hint: `${trip.startDate} → ${trip.endDate}`,
      done: !!trip.startDate && !!trip.endDate,
    },
    {
      key: "days",
      label: "Every day has stops",
      hint: allDaysFilled ? "All days planned" : "Some days are still empty",
      done: allDaysFilled,
    },
    {
      key: "legs",
      label: "Transport legs chosen",
      hint:
        legsNeeded === 0
          ? "No intercity legs yet"
          : `${legsChosen} of ${legsNeeded} legs chosen`,
      done: legsNeeded > 0 && legsChosen === legsNeeded,
    },
    {
      key: "lodging",
      label: "Accommodation noted",
      hint: hasLodging ? "Home base or lodging stop on the trip" : "Set a home base or add a lodging stop",
      done: hasLodging,
    },
    {
      key: "bookings",
      label: "Bookings marked",
      hint:
        stops.length === 0
          ? "Add stops first"
          : `${bookedCount} of ${stops.length} stops booked`,
      done: stops.length > 0 && bookedCount > 0,
    },
  ];
}

function ProgressRing({ done, total }: { done: number; total: number }) {
  const pct = total ? done / total : 0;
  const R = 26;
  const C = 2 * Math.PI * R;
  return (
    <span className="relative inline-flex h-16 w-16 items-center justify-center">
      <svg viewBox="0 0 64 64" className="h-16 w-16 -rotate-90">
        <circle
          cx="32" cy="32" r={R} fill="none"
          stroke="var(--surface-2, #e5e0d8)" strokeWidth="6"
        />
        <circle
          cx="32" cy="32" r={R} fill="none"
          stroke="var(--brand)" strokeWidth="6" strokeLinecap="round"
          strokeDasharray={C}
          strokeDashoffset={C * (1 - pct)}
          className="transition-all duration-500"
        />
      </svg>
      <span className="type-caption tnum absolute font-semibold text-ink">
        {done}/{total}
      </span>
    </span>
  );
}

export default function FinalizePanel({ data }: { data: TripData }) {
  const items = useMemo(() => deriveItems(data), [data]);
  const done = items.filter(i => i.done).length;

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          title="Trip readiness checklist"
          className={cn(
            "type-caption inline-flex shrink-0 items-center gap-1.5 rounded-pill px-2.5 py-1 font-semibold transition-all duration-fast active:scale-[0.97]",
            done === items.length
              ? "bg-pine-soft text-pine"
              : "bg-surface-2 text-ink-2 hover:bg-border hover:text-ink",
          )}
        >
          <CircleCheckBig className="h-3.5 w-3.5" strokeWidth={1.75} />
          Finalize {done}/{items.length}
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-72 rounded-lg p-4">
        <div className="flex items-center gap-3">
          <ProgressRing done={done} total={items.length} />
          <div>
            <p className="type-small font-semibold text-ink">Ready to go?</p>
            <p className="type-caption text-ink-3">
              {done === items.length
                ? "Everything below checks out. Have a great trip."
                : "Tick these off and the trip is travel-ready."}
            </p>
          </div>
        </div>
        <ul className="mt-3 space-y-2">
          {items.map(i => (
            <li key={i.key} className="flex items-start gap-2.5">
              <span
                className={cn(
                  "mt-0.5 flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-full border",
                  i.done
                    ? "border-transparent bg-pine text-white"
                    : "border-border-strong text-transparent",
                )}
              >
                <Check className="h-3 w-3" strokeWidth={3} />
              </span>
              <span className="min-w-0">
                <span
                  className={cn(
                    "type-small block font-semibold",
                    i.done ? "text-ink" : "text-ink-2",
                  )}
                >
                  {i.label}
                </span>
                <span className="type-caption block text-ink-3">{i.hint}</span>
              </span>
            </li>
          ))}
        </ul>
      </PopoverContent>
    </Popover>
  );
}
