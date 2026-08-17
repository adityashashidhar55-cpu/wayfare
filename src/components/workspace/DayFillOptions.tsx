import { useMemo, useState } from "react";
import { useParams } from "react-router";
import { Baby, Minus, Plus, Sparkles, UtensilsCrossed } from "lucide-react";
import {
  Popover,
  PopoverAnchor,
  PopoverContent,
} from "@/components/ui/popover";
import { Switch } from "@/components/ui/switch";
import { trpc } from "@/providers/trpc";

/** Traveler's day-fill tuning - mirrors the generateDay API inputs. */
export interface DayFillChoice {
  /** Only set once the traveler moves off the 4/day default. */
  stopsPerDay?: number;
  excludeFood: boolean;
  /** Family pace for this fill; server persists it on the trip. */
  withChildren?: boolean;
}

interface DayFillOptionsProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Clicked button's bounding rect - the popover's virtual anchor. */
  anchorRect: DOMRect | null;
  onConfirm: (choice: DayFillChoice) => void;
}

const STOPS_MIN = 2;
const STOPS_MAX = 8;
const DEFAULT_STOPS = 4; // matches generateDay's balanced-pace default

/**
 * Small popover behind the in-trip "Fill this day with AI" / "Add AI day"
 * actions: how many places (2–8, default 4 like balanced pace) and whether
 * restaurant/café stops are welcome. One instance serves every entry point -
 * the parent re-anchors it to whichever button was clicked.
 */
export default function DayFillOptions({
  open,
  onOpenChange,
  anchorRect,
  onConfirm,
}: DayFillOptionsProps) {
  const [stops, setStops] = useState(DEFAULT_STOPS);
  const [stopsTouched, setStopsTouched] = useState(false);
  const [includeFood, setIncludeFood] = useState(true);
  const [kids, setKids] = useState(false);
  const [kidsTouched, setKidsTouched] = useState(false);

  /* Inherit the trip's kids-mode flag (the workspace page already fetched
     trips.get, so this is a shared-cache read). */
  const params = useParams();
  const tripId = Number(params.id);
  const tripQ = trpc.trips.get.useQuery(
    { id: tripId },
    { enabled: open && Number.isFinite(tripId), staleTime: 30_000 }
  );
  const tripKids = tripQ.data?.trip.withChildren ?? false;

  /* Fresh defaults each time the popover opens - state adjusted during
     render (react.dev: "adjusting state from props"), the codebase pattern */
  const [prevOpen, setPrevOpen] = useState(open);
  if (open !== prevOpen) {
    setPrevOpen(open);
    if (open) {
      setStops(DEFAULT_STOPS);
      setStopsTouched(false);
      setIncludeFood(true);
      setKids(tripKids);
      setKidsTouched(false);
    }
  }
  /* The trip flag can arrive after open - follow it until the traveler
     touches the toggle. */
  const [prevTripKids, setPrevTripKids] = useState(tripKids);
  if (tripKids !== prevTripKids) {
    setPrevTripKids(tripKids);
    if (!kidsTouched) setKids(tripKids);
  }

  /* Family pace caps the day at 4 stops (mirrors the server rule). */
  const stopsMax = kids ? 4 : STOPS_MAX;
  const [prevStopsMax, setPrevStopsMax] = useState(stopsMax);
  if (stopsMax !== prevStopsMax) {
    setPrevStopsMax(stopsMax);
    if (stops > stopsMax) setStops(stopsMax);
  }

  /* Virtual anchor: Radix positions the popover against the clicked button */
  const virtualRef = useMemo(
    () => ({
      current: {
        getBoundingClientRect: () => anchorRect ?? new DOMRect(0, 0, 0, 0),
      },
    }),
    [anchorRect]
  );

  const move = (delta: number) => {
    setStopsTouched(true);
    setStops(s => Math.min(stopsMax, Math.max(STOPS_MIN, s + delta)));
  };

  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverAnchor virtualRef={virtualRef} />
      <PopoverContent
        align="start"
        side="bottom"
        sideOffset={8}
        className="glass w-[264px] rounded-xl border-border p-3.5 shadow-lg"
        aria-label="AI day options"
      >
        <div className="flex items-center gap-2">
          <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-brand-soft text-brand">
            <Sparkles className="h-3.5 w-3.5" strokeWidth={1.75} />
          </span>
          <p className="flex-1 text-[14px] font-semibold text-ink">
            AI day options
          </p>
        </div>

        {/* places count 2–8 */}
        <div className="mt-3 flex items-center justify-between gap-2">
          <span className="type-small font-semibold text-ink">Places</span>
          <div className="inline-flex items-center gap-1 rounded-pill bg-surface-2 p-1">
            <button
              type="button"
              aria-label="Fewer places"
              disabled={stops <= STOPS_MIN}
              onClick={() => move(-1)}
              className="flex h-7 w-7 items-center justify-center rounded-full text-ink-2 transition-colors duration-fast hover:bg-surface hover:text-ink disabled:opacity-40 disabled:hover:bg-transparent"
            >
              <Minus className="h-3.5 w-3.5" strokeWidth={2} />
            </button>
            <span
              aria-live="polite"
              className="type-small tnum w-5 text-center font-semibold text-ink"
            >
              {stops}
            </span>
            <button
              type="button"
              aria-label="More places"
              disabled={stops >= stopsMax}
              onClick={() => move(1)}
              className="flex h-7 w-7 items-center justify-center rounded-full text-ink-2 transition-colors duration-fast hover:bg-surface hover:text-ink disabled:opacity-40 disabled:hover:bg-transparent"
            >
              <Plus className="h-3.5 w-3.5" strokeWidth={2} />
            </button>
          </div>
        </div>

        {/* kids toggle, family pace for this fill */}
        <label className="mt-2.5 flex cursor-pointer items-center justify-between gap-2">
          <span className="flex items-center gap-2">
            <Baby
              className="h-3.5 w-3.5 shrink-0 text-ink-3"
              strokeWidth={1.75}
            />
            <span className="type-small font-semibold text-ink">
              Travelling with kids
            </span>
          </span>
          <Switch
            checked={kids}
            onCheckedChange={v => {
              setKidsTouched(true);
              setKids(v);
            }}
            aria-label="Travelling with kids"
          />
        </label>
        {kids ? (
          <p className="type-caption mt-1 text-ink-3">
            Family pace: kid-friendly picks, early dinner, a downtime break.
          </p>
        ) : null}

        {/* food toggle */}
        <label className="mt-2.5 flex cursor-pointer items-center justify-between gap-2">
          <span className="flex items-center gap-2">
            <UtensilsCrossed
              className="h-3.5 w-3.5 shrink-0 text-ink-3"
              strokeWidth={1.75}
            />
            <span className="type-small font-semibold text-ink">
              Include restaurants &amp; cafés
            </span>
          </span>
          <Switch
            checked={includeFood}
            onCheckedChange={setIncludeFood}
            aria-label="Include restaurants and cafés"
          />
        </label>
        {!includeFood ? (
          <p className="type-caption mt-1 text-ink-3">
            Attractions &amp; sights only, no food stops.
          </p>
        ) : null}

        <button
          type="button"
          onClick={() =>
            onConfirm({
              stopsPerDay: stopsTouched ? stops : undefined,
              excludeFood: !includeFood,
              withChildren: kids,
            })
          }
          className="btn-sheen type-small mt-3 flex h-9 w-full items-center justify-center gap-1.5 rounded-md bg-brand font-semibold text-brand-ink shadow-sm transition-all duration-fast hover:-translate-y-px hover:bg-brand-strong hover:shadow-md active:scale-[0.97]"
        >
          <Sparkles className="h-4 w-4" strokeWidth={1.75} />
          Plan this day
        </button>
      </PopoverContent>
    </Popover>
  );
}
