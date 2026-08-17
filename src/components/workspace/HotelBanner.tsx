import { useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  BedDouble,
  ChevronDown,
  Copy,
  Crown,
  Hotel,
  Info,
  Loader2,
  Lock,
  Mail,
  MapPin,
  Route,
  Search,
  X,
} from "lucide-react";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { trpc } from "@/providers/trpc";
import { searchPlaces } from "@/lib/geocode";
import type { PlaceSearchHit } from "@/lib/geocode";
import { VoyagerUpsellDialog } from "@/components/trips/AiTripBuilder";
import EmailHotelImport from "./EmailHotelImport";
import HotelThumb from "./HotelThumb";
import { catalogForDestination } from "./SuggestedPlaces";
import { cn } from "@/lib/utils";
import { isUpgradeRequired, shortDate } from "./utils";
import type { TripData, WsDay } from "./utils";
import { useToast } from "./Toasts";

type LodgingMode = "same" | "perday" | "none";

/**
 * Compact lodging banner - ONE slim row at the top of the itinerary panel.
 * Collapsed: home icon + "Lodging: <hotel> · same every night" (or
 * "Add lodging for smarter routes ▾" / a Voyager lock). Expands in place as
 * a dropdown panel:
 *  (a) mode question - "Same hotel every night?" [Same hotel] [Changes daily]
 *  (b) Same → Photon search / email-import home-base flow
 *  (c) Changes daily → per-night rows with compact autocomplete + copy-prev
 *  (d) "Plan my days from lodging" - routes start at each night's hotel and
 *      end at the next night's (per-day) or loop back home (same)
 *  (e) change/remove affordances on every set hotel.
 */
export default function HotelBanner({
  data,
  tripId,
  activeDayId,
}: {
  data: TripData;
  tripId: number;
  activeDayId: number | null;
}) {
  const utils = trpc.useUtils();
  const { push } = useToast();
  const trip = data.trip;
  const isVoyager = data.tier === "voyager";
  const city = trip.destination.split(",")[0]?.trim() ?? "";

  const days = useMemo(
    () => [...data.days].sort((a, b) => a.position - b.position),
    [data.days]
  );
  const dayHotels = days.filter(d => !!d.hotelName);
  const hasTripHotel =
    !!trip.hotelName && trip.hotelLat != null && trip.hotelLng != null;

  const [open, setOpen] = useState(false);
  /** The traveler's answer to "same hotel every night?" - null = derive. */
  const [modeSel, setModeSel] = useState<"same" | "perday" | null>(null);
  const [upsellOpen, setUpsellOpen] = useState(false);
  const [emailOpen, setEmailOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const [planning, setPlanning] = useState(false);

  const mode: LodgingMode =
    modeSel ?? (dayHotels.length ? "perday" : hasTripHotel ? "same" : "none");

  const catalog = useMemo(
    () => catalogForDestination(trip.destination),
    [trip.destination]
  );
  const near = catalog.center
    ? { lat: catalog.center[1], lng: catalog.center[0] }
    : undefined;

  const invalidate = () => utils.trips.get.invalidate({ id: tripId });
  const onErr = (e: unknown, title: string) => {
    if (isUpgradeRequired(e)) {
      setUpsellOpen(true);
    } else {
      push({
        title,
        description: e instanceof Error ? e.message : String(e),
        kind: "danger",
      });
    }
  };

  const setHotel = trpc.trips.setHotel.useMutation({
    onSuccess: () => {
      invalidate();
      setEditing(false);
      push({ title: "Hotel saved as home base", kind: "success" });
    },
    onError: e => onErr(e, "Could not save hotel"),
  });
  const clearHotel = trpc.trips.clearHotel.useMutation({
    onSuccess: () => {
      invalidate();
      push({ title: "Hotel removed", kind: "info" });
    },
    onError: e => onErr(e, "Could not remove hotel"),
  });
  const setDayHotel = trpc.trips.setDayHotel.useMutation({
    onSuccess: () => invalidate(),
    onError: e => onErr(e, "Could not save that night's hotel"),
  });
  const clearDayHotel = trpc.trips.clearDayHotel.useMutation({
    onSuccess: () => invalidate(),
    onError: e => onErr(e, "Could not clear that night's hotel"),
  });
  const planDay = trpc.trips.planDayFromHotel.useMutation();

  /* ── mode question ── */
  const chooseMode = async (m: "same" | "perday") => {
    if (!isVoyager) {
      setUpsellOpen(true);
      return;
    }
    setModeSel(m);
    if (m === "same" && dayHotels.length) {
      // "Same hotel every night" retracts the per-night hotels.
      try {
        await Promise.all(
          dayHotels.map(d =>
            clearDayHotel.mutateAsync({ tripId, dayId: d.id })
          )
        );
        push({ title: "Per-night hotels cleared", kind: "info" });
      } catch (e) {
        onErr(e, "Could not clear per-night hotels");
      }
    }
  };

  /* ── plan every day from its lodging anchors ── */
  const runPlanFromLodging = async () => {
    if (!isVoyager) {
      setUpsellOpen(true);
      return;
    }
    if (!days.length) return;
    const first =
      activeDayId != null ? days.find(d => d.id === activeDayId) : null;
    const ordered = first
      ? [first, ...days.filter(d => d.id !== first.id)]
      : days;
    setPlanning(true);
    let planned = 0;
    let filled = 0;
    let km = 0;
    let skipped = 0;
    try {
      for (const d of ordered) {
        try {
          const res = await planDay.mutateAsync({ tripId, dayId: d.id });
          planned++;
          filled += res.stopsPlanned;
          km += res.totalKm;
        } catch (e) {
          if (isUpgradeRequired(e)) {
            setUpsellOpen(true);
            break;
          }
          skipped++; // day has no located stops / corpus exhausted / no lodging
        }
      }
      await invalidate();
      if (planned > 0) {
        push({
          title: `Planned ${planned} ${planned === 1 ? "day" : "days"} from your lodging`,
          description: `${filled ? `${filled} new stops · ` : ""}~${Math.round(km)} km total, ${
            mode === "perday"
              ? "each day runs from that night's hotel to the next one."
              : "every day starts and ends at your hotel."
          }${skipped ? ` ${skipped} skipped.` : ""}`,
          kind: "success",
        });
      } else {
        push({
          title: "Nothing to plan",
          description:
            "Set a hotel first, then days need stops with locations (or new places in Explore).",
          kind: "info",
        });
      }
    } finally {
      setPlanning(false);
    }
  };

  /* ── collapsed pill label ── */
  const summary =
    mode === "same" && trip.hotelName
      ? `Lodging: ${trip.hotelName} · same every night`
      : mode === "perday"
        ? `Lodging: changes nightly · ${dayHotels.length} of ${days.length} set`
        : null;

  return (
    <div className="px-4 pt-3">
      <div className="rounded-lg border border-border bg-surface">
        {/* ── the ONE slim row ── */}
        {!isVoyager ? (
          <div className="flex items-center gap-2.5 px-3 py-2">
            <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-ochre-soft text-ochre">
              <Lock className="h-3.5 w-3.5" strokeWidth={1.75} />
            </span>
            <span className="type-small min-w-0 flex-1 truncate font-semibold text-ink">
              Hotel-anchored routes
              <span className="type-caption ml-1.5 font-normal text-ink-3">
                Voyager
              </span>
            </span>
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  aria-label="What are hotel-anchored routes?"
                  className="flex h-5 w-5 shrink-0 cursor-help items-center justify-center rounded-full text-ink-3 transition-colors duration-fast hover:text-brand"
                >
                  <Info className="h-3.5 w-3.5" strokeWidth={1.75} />
                </button>
              </TooltipTrigger>
              <TooltipContent side="top" className="max-w-[240px]">
                Each day is routed as a loop from your stay: stops start at your hotel and end back there each night. When the next night has a different hotel set, the day ends there instead.
              </TooltipContent>
            </Tooltip>
            <button
              type="button"
              onClick={() => setUpsellOpen(true)}
              className="type-caption flex shrink-0 items-center gap-1 rounded-pill bg-ochre-soft px-2.5 py-1 font-semibold text-ochre transition-all duration-fast hover:-translate-y-px hover:shadow-md"
            >
              <Crown className="h-3 w-3" strokeWidth={1.75} />
              Upgrade
            </button>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setOpen(o => !o)}
            aria-expanded={open}
            className="flex w-full items-center gap-2.5 px-3 py-2 text-left transition-colors duration-fast hover:bg-surface-2"
          >
            <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-pine-soft text-pine">
              <Hotel className="h-3.5 w-3.5" strokeWidth={1.75} />
            </span>
            <span
              className={cn(
                "type-small min-w-0 flex-1 truncate font-semibold",
                summary ? "text-ink" : "text-ink-2"
              )}
            >
              {summary ?? "Add lodging for smarter routes"}
            </span>
            <ChevronDown
              className={cn(
                "h-4 w-4 shrink-0 text-ink-3 transition-transform duration-fast",
                open && "rotate-180"
              )}
              strokeWidth={1.75}
            />
          </button>
        )}

        {/* ── dropdown panel ── */}
        <AnimatePresence initial={false}>
          {isVoyager && open ? (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: "auto", opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
              className="overflow-hidden"
            >
              <div className="border-t border-border px-3 py-3">
                {/* (a) the mode question */}
                <div className="flex flex-wrap items-center gap-2">
                  <p className="type-small font-semibold text-ink">
                    Same hotel every night?
                  </p>
                  <div
                    role="group"
                    aria-label="Same hotel every night?"
                    className="flex overflow-hidden rounded-md border border-border-strong"
                  >
                    {(
                      [
                        { key: "same", label: "Same hotel" },
                        { key: "perday", label: "Changes daily" },
                      ] as const
                    ).map(opt => (
                      <button
                        key={opt.key}
                        type="button"
                        onClick={() => chooseMode(opt.key)}
                        className={cn(
                          "type-caption px-2.5 py-1 font-semibold transition-colors duration-fast",
                          mode === opt.key
                            ? "bg-pine text-white"
                            : "bg-surface text-ink-2 hover:bg-surface-2"
                        )}
                      >
                        {opt.label}
                      </button>
                    ))}
                  </div>
                </div>

                {/* (b) same-hotel mode (also the default empty state) */}
                {mode !== "perday" ? (
                  <div className="mt-3">
                    {hasTripHotel && !editing ? (
                      <LodgingSummary
                        name={trip.hotelName!}
                        address={trip.hotelAddress}
                        city={city}
                        chip="home base"
                        onChange={() => setEditing(true)}
                        onRemove={() => clearHotel.mutate({ tripId })}
                        removing={clearHotel.isPending}
                      />
                    ) : (
                      <div>
                        <HotelSearchInput
                          near={near}
                          cityHint={catalog.city}
                          pending={setHotel.isPending}
                          placeholder="Search your hotel…"
                          onPick={h =>
                            setHotel.mutate({
                              tripId,
                              name: h.name,
                              address: h.address || undefined,
                              lat: h.lat,
                              lng: h.lng,
                              source: "manual",
                            })
                          }
                        />
                        <div className="mt-2 flex items-center gap-2">
                          <button
                            type="button"
                            onClick={() => setEmailOpen(true)}
                            className="type-caption flex items-center gap-1.5 rounded-md border border-border-strong bg-surface px-2.5 py-1.5 font-semibold text-ink-2 transition-all duration-fast hover:bg-surface-2 hover:text-ink"
                          >
                            <Mail className="h-3.5 w-3.5" strokeWidth={1.75} />
                            Import from email
                          </button>
                          {hasTripHotel ? (
                            <button
                              type="button"
                              onClick={() => setEditing(false)}
                              className="type-caption rounded-md px-2 py-1.5 font-semibold text-ink-3 transition-colors duration-fast hover:text-ink"
                            >
                              Cancel
                            </button>
                          ) : null}
                        </div>
                      </div>
                    )}
                  </div>
                ) : null}

                {/* (c) per-day mode */}
                {mode === "perday" ? (
                  <div className="mt-3">
                    <ul className="space-y-1.5">
                      {days.map((d, i) => (
                        <DayHotelRow
                          key={d.id}
                          day={d}
                          index={i}
                          city={city}
                          near={near}
                          cityHint={catalog.city}
                          prevHotel={prevHotelBefore(days, i)}
                          pending={
                            setDayHotel.isPending || clearDayHotel.isPending
                          }
                          onPick={(dayId, h) =>
                            setDayHotel.mutate({
                              tripId,
                              dayId,
                              name: h.name,
                              address: h.address || undefined,
                              lat: h.lat,
                              lng: h.lng,
                            })
                          }
                          onClear={dayId =>
                            clearDayHotel.mutate({ tripId, dayId })
                          }
                        />
                      ))}
                    </ul>
                    {!hasTripHotel ? (
                      <p className="type-caption mt-2 text-ink-3">
                        Nights without a hotel fall back to the trip home base,
                        set one under “Same hotel” for full coverage.
                      </p>
                    ) : null}
                  </div>
                ) : null}

                {/* (d) plan action */}
                {mode !== "none" ? (
                  <div className="mt-3">
                    <button
                      type="button"
                      onClick={runPlanFromLodging}
                      disabled={planning}
                      className="type-small flex items-center gap-1.5 rounded-md bg-pine px-3 py-1.5 font-semibold text-white shadow-sm transition-all duration-fast hover:-translate-y-px hover:shadow-md hover:brightness-110 disabled:opacity-60"
                    >
                      {planning ? (
                        <Loader2
                          className="h-3.5 w-3.5 animate-spin"
                          strokeWidth={2}
                        />
                      ) : (
                        <Route className="h-3.5 w-3.5" strokeWidth={1.75} />
                      )}
                      {planning ? "Planning…" : "Plan my days from lodging"}
                    </button>
                  </div>
                ) : null}
              </div>
            </motion.div>
          ) : null}
        </AnimatePresence>
      </div>

      <EmailHotelImport
        tripId={tripId}
        open={emailOpen}
        onOpenChange={setEmailOpen}
        onUpgradeRequired={() => setUpsellOpen(true)}
        onImported={() => setEditing(false)}
      />
      <VoyagerUpsellDialog open={upsellOpen} onOpenChange={setUpsellOpen} />
    </div>
  );
}

/* ── nearest set hotel before day i (for "copy previous") ── */
function prevHotelBefore(days: WsDay[], i: number): WsDay | null {
  for (let k = i - 1; k >= 0; k--) {
    const d = days[k]!;
    if (d.hotelName && d.hotelLat != null && d.hotelLng != null) return d;
  }
  return null;
}

/* ── set-hotel summary row (thumb + name/address + change/remove) ── */
function LodgingSummary({
  name,
  address,
  city,
  chip,
  onChange,
  onRemove,
  removing,
}: {
  name: string;
  address: string | null;
  city?: string;
  chip?: string;
  onChange?: () => void;
  onRemove: () => void;
  removing?: boolean;
}) {
  return (
    <div className="flex items-center gap-2.5">
      <HotelThumb name={name} city={city} className="h-10 w-10 text-base" />
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-1.5">
          <span className="truncate text-[13.5px] font-semibold text-ink">
            {name}
          </span>
          {chip ? (
            <span className="type-caption shrink-0 rounded-pill bg-ochre px-1.5 py-px font-semibold tracking-wide text-white">
              {chip}
            </span>
          ) : null}
        </span>
        {address ? (
          <span className="type-caption mt-px flex items-center gap-1 truncate text-ink-3">
            <MapPin className="h-3 w-3 shrink-0" strokeWidth={1.75} />
            <span className="truncate">{address}</span>
          </span>
        ) : null}
      </span>
      {onChange ? (
        <button
          type="button"
          onClick={onChange}
          className="type-caption shrink-0 rounded-md border border-border-strong bg-surface px-2 py-1 font-semibold text-ink-2 transition-all duration-fast hover:bg-surface-2 hover:text-ink"
        >
          Change
        </button>
      ) : null}
      <button
        type="button"
        onClick={onRemove}
        disabled={removing}
        aria-label={`Remove ${name}`}
        className="shrink-0 rounded-sm p-1 text-ink-3 transition-colors duration-fast hover:bg-danger/10 hover:text-danger disabled:opacity-60"
      >
        <X className="h-3.5 w-3.5" strokeWidth={2} />
      </button>
    </div>
  );
}

/* ── one night in the per-day editor ── */
function DayHotelRow({
  day,
  index,
  city,
  near,
  cityHint,
  prevHotel,
  pending,
  onPick,
  onClear,
}: {
  day: WsDay;
  index: number;
  city?: string;
  near?: { lat: number; lng: number };
  cityHint: string;
  prevHotel: WsDay | null;
  pending: boolean;
  onPick: (dayId: number, h: PlaceSearchHit) => void;
  onClear: (dayId: number) => void;
}) {
  const hasHotel = !!day.hotelName && day.hotelLat != null && day.hotelLng != null;
  return (
    <li className="flex items-center gap-2">
      <span className="type-caption w-[72px] shrink-0 font-semibold text-ink-2">
        Day {index + 1}
        <span className="ml-1 font-normal text-ink-3">{shortDate(day.date)}</span>
      </span>
      {hasHotel ? (
        <div className="flex min-w-0 flex-1 items-center gap-2 rounded-md border border-ochre/30 bg-ochre-soft/30 px-2 py-1">
          <HotelThumb
            name={day.hotelName!}
            city={city}
            className="h-6 w-6 text-[11px]"
          />
          <span className="min-w-0 flex-1 truncate text-[13px] font-semibold text-ink">
            {day.hotelName}
          </span>
          <button
            type="button"
            onClick={() => onClear(day.id)}
            disabled={pending}
            aria-label={`Clear hotel for day ${index + 1}`}
            className="shrink-0 rounded-sm p-0.5 text-ink-3 transition-colors duration-fast hover:bg-danger/10 hover:text-danger disabled:opacity-60"
          >
            <X className="h-3 w-3" strokeWidth={2} />
          </button>
        </div>
      ) : (
        <div className="flex min-w-0 flex-1 items-center gap-1.5">
          <HotelSearchInput
            compact
            near={near}
            cityHint={cityHint}
            pending={pending}
            placeholder={`Night ${index + 1} hotel…`}
            onPick={h => onPick(day.id, h)}
          />
          {prevHotel?.hotelName ? (
            <button
              type="button"
              disabled={pending}
              title={`Copy previous night: ${prevHotel.hotelName}`}
              onClick={() =>
                onPick(day.id, {
                  name: prevHotel.hotelName!,
                  address: prevHotel.hotelAddress ?? "",
                  lat: prevHotel.hotelLat!,
                  lng: prevHotel.hotelLng!,
                })
              }
              className="type-caption flex shrink-0 items-center gap-1 rounded-md border border-border-strong bg-surface px-1.5 py-1 font-semibold text-ink-2 transition-all duration-fast hover:bg-surface-2 hover:text-ink disabled:opacity-60"
            >
              <Copy className="h-3 w-3" strokeWidth={1.75} />
              Copy prev
            </button>
          ) : null}
        </div>
      )}
    </li>
  );
}

/* ── compact debounced Photon autocomplete (shared by both editors) ── */
function HotelSearchInput({
  onPick,
  near,
  cityHint,
  pending,
  placeholder,
  compact,
}: {
  onPick: (h: PlaceSearchHit) => void;
  near?: { lat: number; lng: number };
  cityHint: string;
  pending?: boolean;
  placeholder: string;
  compact?: boolean;
}) {
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<PlaceSearchHit[]>([]);
  const [searching, setSearching] = useState(false);
  const seq = useRef(0);

  useEffect(() => {
    const q = query.trim();
    if (q.length < 3) {
      setHits([]);
      setSearching(false);
      return;
    }
    setSearching(true);
    const mySeq = ++seq.current;
    const timer = window.setTimeout(async () => {
      const res = await searchPlaces(`${q} ${cityHint}`, near, 6);
      if (seq.current !== mySeq) return; // superseded by a newer keystroke
      setHits(res);
      setSearching(false);
    }, 300);
    return () => window.clearTimeout(timer);
  }, [query, near, cityHint]);

  return (
    <div className="relative min-w-0 flex-1">
      <Search
        className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-ink-3"
        strokeWidth={1.75}
      />
      <input
        value={query}
        onChange={e => setQuery(e.target.value)}
        onKeyDown={e => {
          if (e.key === "Escape") {
            setQuery("");
            setHits([]);
          }
        }}
        placeholder={placeholder}
        aria-label={placeholder}
        className={cn(
          "type-small w-full rounded-md border border-border-strong bg-surface pl-7 pr-6 text-ink placeholder:text-ink-3 focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/40",
          compact ? "h-7" : "h-8"
        )}
      />
      {query ? (
        <button
          type="button"
          aria-label="Clear hotel search"
          onClick={() => {
            setQuery("");
            setHits([]);
          }}
          className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded-sm p-0.5 text-ink-3 transition-colors duration-fast hover:text-ink"
        >
          <X className="h-3 w-3" strokeWidth={2} />
        </button>
      ) : null}

      {hits.length > 0 ? (
        <ul
          className="absolute inset-x-0 top-full z-30 mt-1 overflow-hidden rounded-md border border-border bg-surface shadow-lg"
          role="listbox"
          aria-label="Hotel search results"
        >
          {hits.map(h => (
            <li key={`${h.name}-${h.lat.toFixed(4)}-${h.lng.toFixed(4)}`}>
              <button
                type="button"
                role="option"
                aria-selected={false}
                disabled={pending}
                onClick={() => {
                  onPick(h);
                  setQuery("");
                  setHits([]);
                }}
                className="flex w-full items-start gap-2 px-2.5 py-1.5 text-left transition-colors duration-fast hover:bg-surface-2 disabled:opacity-60"
              >
                <BedDouble
                  className="mt-0.5 h-3.5 w-3.5 shrink-0 text-ink-3"
                  strokeWidth={1.75}
                />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13px] font-semibold text-ink">
                    {h.name}
                  </span>
                  {h.address ? (
                    <span className="type-caption block truncate text-ink-3">
                      {h.address}
                    </span>
                  ) : null}
                </span>
              </button>
            </li>
          ))}
        </ul>
      ) : searching ? (
        <p className="type-caption absolute inset-x-0 top-full z-30 mt-1 flex items-center gap-1.5 rounded-md border border-border bg-surface px-2.5 py-1.5 text-ink-3 shadow-lg">
          <Loader2 className="h-3 w-3 animate-spin" strokeWidth={2} />
          Searching…
        </p>
      ) : null}
    </div>
  );
}
