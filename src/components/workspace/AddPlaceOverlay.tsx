import { useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Check, Compass, Globe, Loader2, Plus, Search, Star, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { trpc } from "@/providers/trpc";
import { cn } from "@/lib/utils";
import { useExploreDiscover } from "@/lib/exploreLive";
import { dietBadge } from "@/lib/diet";
import { searchPlaces, type PlaceSearchHit } from "@/lib/geocode";
import { catalogForDestination, suggestionImage } from "./SuggestedPlaces";
import { categoryMeta, dayLabel, formatKm, haversineKm, imageForCategory } from "./utils";
import { useToast } from "./Toasts";

/* ── category browsing ────────────────────────────────────────────────
   The corpus stores a coarse `category` (activity/food/shopping) plus fine
   OSM `tags` (coffee, museum, nightlife…). Each browse chip maps to a tag
   family; a place lands in the FIRST family it matches so chips partition
   the list instead of overlapping. */
const BROWSE_CHIPS = [
  { key: "all", label: "All" },
  { key: "sights", label: "Sights" },
  { key: "food", label: "Food" },
  { key: "cafes", label: "Cafés" },
  { key: "nature", label: "Nature" },
  { key: "museums", label: "Museums" },
  { key: "nightlife", label: "Nightlife" },
  { key: "shopping", label: "Shopping" },
] as const;
type BrowseKey = (typeof BROWSE_CHIPS)[number]["key"];

const CAFE_TAGS = new Set(["coffee", "kissaten", "tea", "bakery"]);
const NIGHT_TAGS = new Set([
  "nightlife", "night", "late-night", "cocktails", "drinks", "izakaya",
  "wine-bar", "whisky", "mezcal", "neon", "rooftop", "evening",
]);
const MUSEUM_TAGS = new Set(["museum", "art", "design", "history", "culture"]);
const NATURE_TAGS = new Set([
  "nature", "park", "garden", "gardens", "hike", "beach", "beachfront",
  "lake", "waterfall", "river", "riverfront", "glacier", "geothermal",
  "hot-spring", "pools", "picnic", "easy-walk", "deer", "puffins", "basalt",
]);
const SHOP_TAGS = new Set(["market", "markets", "souk", "bookshops", "haggling", "spices"]);

function browseBucket(category: string, tags: string[]): Exclude<BrowseKey, "all"> {
  const has = (set: Set<string>) => tags.some(t => set.has(t.toLowerCase()));
  if (has(CAFE_TAGS)) return "cafes";
  if (has(NIGHT_TAGS)) return "nightlife";
  if (has(MUSEUM_TAGS)) return "museums";
  if (has(NATURE_TAGS)) return "nature";
  if (category === "shopping" || has(SHOP_TAGS)) return "shopping";
  if (category === "food") return "food";
  return "sights";
}

/** Unified row for the browse list - corpus place or built-in suggestion. */
interface BrowsePlace {
  key: string;
  name: string;
  category: string;
  tags: string[];
  lat?: number;
  lng?: number;
  address?: string;
  rating?: number;
  durationMin?: number;
  image: string;
  /* r24-core (A): affordability signals for budget-first ranking */
  priceLevel?: number;
  feeCents?: number | null;
  mealCents?: number | null;
}

/** "Day 3" stays, "Unscheduled" shortens for tight card pills. */
function shortDay(dayName: string): string {
  return dayName === "Unscheduled" ? "List" : dayName;
}

export interface AddPlaceOverlayProps {
  open: boolean;
  onClose: () => void;
  tripId: number;
  dayId: number | null;
  dayName: string;
  destination: string;
  /** [lat, lng] of current day's stops, for “distance from day” captions */
  centroid: [number, number] | null;
}

/**
 * Add-Place overlay (§1.5): glass panel over the map side on desktop,
 * bottom sheet on mobile. MANUAL-first: category chips (Sights, Food,
 * Cafés, Nature, Museums, Nightlife, Shopping) browse corpus places near
 * the trip destination (with photos), one tap adds to the target day and
 * the card flips to a "✓ Added · Day N" state. A "My picks" strip lists
 * this session's adds with remove. Search + freeform form stay below.
 */
export default function AddPlaceOverlay({
  open,
  onClose,
  tripId,
  dayId,
  dayName,
  destination,
  centroid,
}: AddPlaceOverlayProps) {
  const utils = trpc.useUtils();
  const { push } = useToast();
  /* Kids mode (trip.withChildren): suggestion lists prefer kid-friendly
     spots - trips.get is already cached by the workspace page. */
  const tripQ = trpc.trips.get.useQuery({ id: tripId }, { staleTime: 60_000 });
  const kidsMode = tripQ.data?.trip.withChildren ?? false;
  const catalog = useMemo(
    () => catalogForDestination(destination, kidsMode),
    [destination, kidsMode]
  );
  /* Corpus places for the destination city (photos, tags, ratings) - the
     browse list's primary source; the built-in catalog fills the gaps. */
  const corpusCity = destination.split(",")[0]?.trim() || catalog.city;
  const corpusQ = trpc.explore.list.useQuery(
    { city: corpusCity },
    { staleTime: 120_000 }
  );
  const [query, setQuery] = useState("");
  const [chip, setChip] = useState<BrowseKey>("all");
  /* name(lower) → day label, for adds made this overlay session (the trips
     query catches up after invalidate, so badges survive reopening) */
  const [sessionAdded, setSessionAdded] = useState<Map<string, string>>(
    new Map()
  );
  /* "My picks" - this session's manual adds, with one-tap remove */
  const [picks, setPicks] = useState<
    { stopId: number; name: string; dayName: string }[]
  >([]);
  const [name, setName] = useState("");
  const [category, setCategory] = useState("activity");
  const [startTime, setStartTime] = useState("");
  const [durationMin, setDurationMin] = useState("");
  const [notes, setNotes] = useState("");
  const searchRef = useRef<HTMLInputElement>(null);
  const deleteStop = trpc.trips.deleteStop.useMutation({
    onSuccess: () => utils.trips.get.invalidate({ id: tripId }),
  });

  /* reset form fields when the overlay (re)opens or targets another day -
     state adjusted during render (react.dev: “adjusting state from props”) */
  const [session, setSession] = useState({ open, dayId });
  if (session.open !== open || session.dayId !== dayId) {
    setSession({ open, dayId });
    if (open) {
      setQuery("");
      setChip("all");
      setSessionAdded(new Map());
      setPicks([]);
      setName("");
      setCategory("activity");
      setStartTime("");
      setDurationMin("");
      setNotes("");
    }
  }

  useEffect(() => {
    if (open) {
      const t = window.setTimeout(() => searchRef.current?.focus(), 180);
      return () => window.clearTimeout(t);
    }
  }, [open, dayId]);

  const removeStopId = (stopId: number) => {
    setPicks(prev => prev.filter(p => p.stopId !== stopId));
    deleteStop.mutate({ id: stopId, tripId });
  };

  const addStop = trpc.trips.addStop.useMutation({
    onSuccess: (res, vars) => {
      utils.trips.get.invalidate({ id: tripId });
      setPicks(prev =>
        prev.some(p => p.stopId === res.id)
          ? prev
          : [...prev, { stopId: res.id, name: vars.name, dayName }]
      );
      push({
        title: `Added ${vars.name}`,
        description: dayName,
        kind: "success",
        actionLabel: "Undo",
        onAction: () => removeStopId(res.id),
      });
    },
    onError: e =>
      push({
        title: "Could not add stop",
        description: e.message,
        kind: "danger",
      }),
  });

  /* Discover fresh places via OpenStreetMap, then they show up in browse */
  const discover = useExploreDiscover({
    onSuccess: (res, vars) => {
      utils.explore.invalidate();
      if (res.inserted > 0) {
        push({
          title: `Added ${res.inserted} new places`,
          description: `${res.total} total in ${vars.city}`,
          kind: "success",
        });
      } else {
        push({
          title: "No new places found",
          description: `${res.total} total in ${vars.city}`,
          kind: "info",
        });
      }
    },
    onError: e =>
      push({
        title: "Could not discover places",
        description: e.message,
        kind: "danger",
      }),
  });

  /* r24-core (A): amount-based budget → budget-friendlier places first. */
  const budgetSet = (tripQ.data?.trip.budgetCents ?? 0) > 0;

  /* ── merged browse list: corpus places first (rated, photographed), then
     built-in suggestions the corpus doesn't know yet ── */
  const browseAll = useMemo<BrowsePlace[]>(() => {
    const out: BrowsePlace[] = [];
    const seen = new Set<string>();
    const corpus = (corpusQ.data?.places ?? [])
      .slice()
      .sort((a, b) => (b.rating ?? 0) - (a.rating ?? 0));
    for (const p of corpus) {
      const key = p.name.trim().toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({
        key: `p-${p.id}`,
        name: p.name,
        category: p.category,
        tags: p.tags ?? [],
        lat: p.lat ?? undefined,
        lng: p.lng ?? undefined,
        rating: p.rating ?? undefined,
        image: p.image ?? imageForCategory(p.category),
        priceLevel: (p as { priceLevel?: number }).priceLevel,
        feeCents: (p as { feeCents?: number | null }).feeCents,
        mealCents: (p as { mealCents?: number | null }).mealCents,
      });
    }
    for (const s of catalog.suggestions) {
      const key = s.name.trim().toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({
        key: `s-${s.name}`,
        name: s.name,
        category: s.category,
        tags: [],
        lat: s.lat,
        lng: s.lng,
        address: s.address,
        rating: s.rating,
        durationMin: s.durationMin,
        image: suggestionImage(s),
      });
    }
    /* Budget set: re-sort so free/cheap options lead, rating breaks ties.
       Unknown prices sort as mid (level 2) rather than floating to the top. */
    if (budgetSet) {
      const centsOf = (p: BrowsePlace) =>
        p.feeCents ?? p.mealCents ?? (p.priceLevel ?? 2) * 1500;
      out.sort((a, b) => centsOf(a) - centsOf(b) || (b.rating ?? 0) - (a.rating ?? 0));
    }
    return out;
  }, [corpusQ.data, catalog, budgetSet]);

  /* place name (lower) → day label, for stops already in the trip - the
     "✓ Added · Day N" state is truthful across sessions, not just per-open */
  const stopDayByName = useMemo(() => {
    const map = new Map<string, string>();
    const t = tripQ.data;
    if (!t) return map;
    const ordered = [...t.days].sort((a, b) => a.position - b.position);
    const idx = new Map(ordered.map((d, i) => [d.id, i]));
    for (const s of t.stops) {
      const label =
        s.dayId != null && idx.has(s.dayId)
          ? dayLabel(idx.get(s.dayId)!)
          : "List";
      map.set(s.name.trim().toLowerCase(), label);
    }
    return map;
  }, [tripQ.data]);

  const addedDayFor = (placeName: string): string | null => {
    const key = placeName.trim().toLowerCase();
    return sessionAdded.get(key) ?? stopDayByName.get(key) ?? null;
  };

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return browseAll.filter(s => {
      if (chip !== "all" && browseBucket(s.category, s.tags) !== chip)
        return false;
      if (
        q &&
        !s.name.toLowerCase().includes(q) &&
        !s.tags.some(t => t.toLowerCase().includes(q))
      )
        return false;
      return true;
    });
  }, [browseAll, query, chip]);

  /* r24-core (E): global place search - when the local corpus runs dry,
     Photon searches worldwide (biased toward the day's centroid) so stops in
     ANY country can be added to the trip. */
  const [globalHits, setGlobalHits] = useState<PlaceSearchHit[]>([]);
  useEffect(() => {
    const q = query.trim();
    if (q.length < 3) {
      setGlobalHits([]);
      return;
    }
    const t = window.setTimeout(() => {
      searchPlaces(
        q,
        centroid ? { lat: centroid[0], lng: centroid[1] } : undefined,
        5
      ).then(setGlobalHits);
    }, 300);
    return () => window.clearTimeout(t);
  }, [query, centroid]);

  const addGlobal = (h: PlaceSearchHit) => {
    setSessionAdded(prev => new Map(prev).set(h.name.trim().toLowerCase(), shortDay(dayName)));
    addStop.mutate({
      tripId,
      dayId,
      name: h.name,
      category: "activity",
      address: h.address,
      lat: h.lat,
      lng: h.lng,
      durationMin: 60,
      image: imageForCategory("activity"),
    });
  };

  const addSuggestion = (s: BrowsePlace) => {
    if (addedDayFor(s.name)) return;
    setSessionAdded(prev => new Map(prev).set(s.name.trim().toLowerCase(), shortDay(dayName)));
    addStop.mutate({
      tripId,
      dayId,
      name: s.name,
      category: s.category,
      address: s.address,
      lat: s.lat,
      lng: s.lng,
      durationMin: s.durationMin ?? 60,
      image: s.image,
    });
  };

  const addCustom = () => {
    const trimmed = name.trim();
    if (!trimmed) return;
    addStop.mutate(
      {
        tripId,
        dayId,
        name: trimmed,
        category,
        startTime: startTime || null,
        durationMin: durationMin ? Number(durationMin) : null,
        notes: notes.trim() || undefined,
        image: imageForCategory(category),
      },
      { onSuccess: () => onClose() }
    );
  };

  const mobile = typeof window !== "undefined" && window.innerWidth < 1024;

  return (
    <AnimatePresence>
      {open ? (
        <>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            onClick={onClose}
            className="fixed inset-0 z-40 bg-ink/30 backdrop-blur-[2px]"
            aria-hidden
          />
          <motion.aside
            role="dialog"
            aria-label={`Add a place to ${dayName}`}
            initial={mobile ? { y: "100%" } : { x: 48, opacity: 0 }}
            animate={mobile ? { y: 0 } : { x: 0, opacity: 1 }}
            exit={mobile ? { y: "100%" } : { x: 48, opacity: 0 }}
            transition={{ type: "spring", stiffness: 260, damping: 26 }}
            className={cn(
              "glass fixed z-50 flex flex-col overflow-hidden border border-border shadow-lg",
              "inset-x-3 bottom-3 max-h-[84dvh] rounded-xl",
              "lg:inset-y-4 lg:right-4 lg:left-auto lg:max-h-none lg:w-[400px]"
            )}
          >
            <div className="flex items-center justify-between border-b border-border px-4 py-3">
              <p className="type-h4 text-ink">
                Add to <span className="text-brand">{dayName}</span>
              </p>
              <button
                type="button"
                aria-label="Close"
                onClick={onClose}
                className="rounded-md p-1.5 text-ink-3 transition-colors duration-fast hover:bg-surface-2 hover:text-ink"
              >
                <X className="h-4 w-4" strokeWidth={1.75} />
              </button>
            </div>

            <div className="space-y-2.5 border-b border-border px-4 py-3">
              <div className="relative">
                <Search
                  className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-3"
                  strokeWidth={1.75}
                />
                <input
                  ref={searchRef}
                  value={query}
                  onChange={e => setQuery(e.target.value)}
                  placeholder={`Search ${catalog.city} places…`}
                  className="type-small h-10 w-full rounded-md border border-border-strong bg-surface pl-9 pr-3 text-ink placeholder:text-ink-3 focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/40"
                />
              </div>
              <div className="flex snap-x gap-1.5 overflow-x-auto pb-0.5 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                {BROWSE_CHIPS.map(c => (
                  <button
                    key={c.key}
                    type="button"
                    aria-pressed={chip === c.key}
                    onClick={() => setChip(c.key)}
                    className={cn(
                      "type-caption shrink-0 snap-start rounded-pill px-2.5 py-1 transition-all duration-fast",
                      chip === c.key
                        ? "bg-brand-soft font-semibold text-brand"
                        : "bg-surface-2 text-ink-3 hover:text-ink-2"
                    )}
                  >
                    {c.label}
                  </button>
                ))}
              </div>
            </div>

            {/* My picks, everything added this session, with remove */}
            {picks.length > 0 ? (
              <div className="border-b border-border bg-pine-soft/50 px-4 py-2">
                <p className="type-eyebrow text-pine">
                  My picks · {picks.length}
                </p>
                <ul className="mt-1.5 flex snap-x gap-1.5 overflow-x-auto pb-0.5 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                  {picks.map(p => (
                    <li
                      key={p.stopId}
                      className="type-caption inline-flex shrink-0 snap-start items-center gap-1 rounded-pill border border-pine/30 bg-surface py-1 pl-2.5 pr-1 font-semibold text-ink"
                    >
                      <Check
                        className="h-3 w-3 shrink-0 text-pine"
                        strokeWidth={2.5}
                      />
                      <span className="max-w-[140px] truncate">{p.name}</span>
                      <span className="shrink-0 font-normal text-ink-3">
                        · {shortDay(p.dayName)}
                      </span>
                      <button
                        type="button"
                        aria-label={`Remove ${p.name}`}
                        title="Remove from day"
                        onClick={() => removeStopId(p.stopId)}
                        className="ml-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-ink-3 transition-colors duration-fast hover:bg-danger/10 hover:text-danger"
                      >
                        <X className="h-3 w-3" strokeWidth={2} />
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}

            <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-2 py-2">
              <p className="type-eyebrow px-2 pb-1.5 text-ink-3">
                Browse · {catalog.city}
                {kidsMode ? " · kid-friendly first" : ""}
                {budgetSet ? " · budget-friendly first" : ""}
              </p>
              <ul className="space-y-1">
                {filtered.map(s => {
                  const meta = categoryMeta(s.category);
                  const bucketLabel =
                    BROWSE_CHIPS.find(
                      c => c.key === browseBucket(s.category, s.tags)
                    )?.label ?? meta.label;
                  const addedDay = addedDayFor(s.name);
                  const isAdded = addedDay != null;
                  const diet = dietBadge({ name: s.name, category: s.category });
                  const dist =
                    centroid && s.lat != null && s.lng != null
                      ? formatKm(
                          haversineKm(centroid[0], centroid[1], s.lat, s.lng)
                        )
                      : null;
                  return (
                    <li key={s.key}>
                      <div
                        className={cn(
                          "flex items-center gap-3 rounded-md p-2 transition-colors duration-fast",
                          isAdded ? "bg-pine-soft" : "hover:bg-surface-2"
                        )}
                      >
                        <img
                          src={s.image}
                          alt=""
                          loading="lazy"
                          className="photo h-11 w-11 shrink-0 rounded-sm object-cover"
                        />
                        <span className="min-w-0 flex-1">
                          <span className="type-small block truncate font-semibold text-ink">
                            {s.name}
                          </span>
                          <span className="type-caption mt-0.5 flex items-center gap-1.5 text-ink-3">
                            <meta.icon
                              className="h-3 w-3 shrink-0"
                              strokeWidth={1.75}
                              style={{ color: meta.color }}
                            />
                            <span className="truncate">{bucketLabel}</span>
                            {diet ? (
                              <span role="img" aria-label={diet.label} title={diet.label}>
                                🌱
                              </span>
                            ) : null}
                            {s.rating ? (
                              <>
                                <Star
                                  className="h-3 w-3 shrink-0 fill-ochre text-ochre"
                                  strokeWidth={1.75}
                                />
                                <span className="tnum">
                                  {s.rating.toFixed(1)}
                                </span>
                              </>
                            ) : null}
                            {dist ? (
                              <span className="shrink-0">· {dist} away</span>
                            ) : null}
                          </span>
                        </span>
                        {isAdded ? (
                          <motion.span
                            initial={{ scale: 0.85, opacity: 0.4 }}
                            animate={{ scale: 1, opacity: 1 }}
                            transition={{
                              type: "spring",
                              stiffness: 500,
                              damping: 28,
                            }}
                            className="type-caption inline-flex shrink-0 items-center gap-1 rounded-pill bg-pine px-2.5 py-1 font-semibold text-white"
                          >
                            <Check className="h-3 w-3" strokeWidth={2.5} />
                            {addedDay}
                          </motion.span>
                        ) : (
                          <button
                            type="button"
                            aria-label={`Add ${s.name} to ${dayName}`}
                            title={`Add to ${dayName}`}
                            disabled={addStop.isPending}
                            onClick={() => addSuggestion(s)}
                            className="type-caption inline-flex h-8 shrink-0 items-center gap-1 rounded-pill bg-brand px-2.5 font-semibold text-brand-ink shadow-sm transition-all duration-fast hover:-translate-y-px hover:bg-brand-strong active:scale-95 disabled:opacity-60"
                          >
                            <Plus className="h-3.5 w-3.5" strokeWidth={2.25} />
                            {shortDay(dayName)}
                          </button>
                        )}
                      </div>
                    </li>
                  );
                })}
                {filtered.length === 0 ? (
                  <li className="type-small px-2 py-4 text-center text-ink-3">
                    No matches, add “{query}” below instead.
                  </li>
                ) : null}
              </ul>

              {/* r24-core (E): worldwide hits for multi-country trips */}
              {globalHits.length > 0 ? (
                <div className="mt-3">
                  <p className="type-eyebrow flex items-center gap-1.5 px-2 pb-1.5 text-ink-3">
                    <Globe className="h-3.5 w-3.5" strokeWidth={1.75} />
                    Worldwide results
                  </p>
                  <ul className="space-y-1">
                    {globalHits.map(h => {
                      const addedDay = addedDayFor(h.name);
                      return (
                        <li
                          key={`${h.name}|${h.lat},${h.lng}`}
                          className="flex items-center gap-3 rounded-md p-2 transition-colors duration-fast hover:bg-surface-2"
                        >
                          <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-sm bg-surface-2 text-ink-3">
                            <Globe className="h-4 w-4" strokeWidth={1.75} />
                          </span>
                          <span className="min-w-0 flex-1">
                            <span className="type-small block truncate font-semibold text-ink">
                              {h.name}
                            </span>
                            <span className="type-caption block truncate text-ink-3">
                              {h.address}
                            </span>
                          </span>
                          {addedDay ? (
                            <span className="type-caption inline-flex shrink-0 items-center gap-1 rounded-pill bg-pine px-2.5 py-1 font-semibold text-white">
                              <Check className="h-3 w-3" strokeWidth={2.5} />
                              {addedDay}
                            </span>
                          ) : (
                            <button
                              type="button"
                              aria-label={`Add ${h.name} to ${dayName}`}
                              disabled={addStop.isPending}
                              onClick={() => addGlobal(h)}
                              className="type-caption inline-flex h-8 shrink-0 items-center gap-1 rounded-pill bg-brand px-2.5 font-semibold text-brand-ink shadow-sm transition-all duration-fast hover:-translate-y-px hover:bg-brand-strong active:scale-95 disabled:opacity-60"
                            >
                              <Plus className="h-3.5 w-3.5" strokeWidth={2.25} />
                              {shortDay(dayName)}
                            </button>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                </div>
              ) : null}

              {/* pull fresh places from OpenStreetMap into the corpus */}
              <button
                type="button"
                onClick={() => discover.mutate({ city: corpusCity })}
                disabled={discover.isPending}
                className="type-small mt-2 flex h-10 w-full items-center justify-center gap-2 rounded-md border border-dashed border-border-strong font-semibold text-ink-3 transition-all duration-fast hover:border-pine hover:text-pine disabled:cursor-not-allowed disabled:opacity-60"
              >
                {discover.isPending ? (
                  <Loader2 className="h-4 w-4 animate-spin" strokeWidth={1.75} />
                ) : (
                  <Compass className="h-4 w-4" strokeWidth={1.75} />
                )}
                {discover.isPending
                  ? `Discovering ${corpusCity} places…`
                  : `Find more places in ${corpusCity}`}
              </button>

              <div className="mt-3 rounded-lg border border-border bg-surface p-3">
                <p className="type-eyebrow mb-2.5 text-ink-3">Your own place</p>
                <div className="space-y-2">
                  <input
                    value={name}
                    onChange={e => setName(e.target.value)}
                    placeholder="Place name"
                    aria-label="Place name"
                    className="type-small h-9 w-full rounded-md border border-border-strong bg-surface px-3 text-ink placeholder:text-ink-3 focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/40"
                  />
                  <div className="flex gap-2">
                    <select
                      value={category}
                      onChange={e => setCategory(e.target.value)}
                      aria-label="Category"
                      className="type-small h-9 flex-1 rounded-md border border-border-strong bg-surface px-2 text-ink focus:border-brand focus:outline-none"
                    >
                      <option value="activity">Activity</option>
                      <option value="food">Food</option>
                      <option value="lodging">Lodging</option>
                      <option value="transport">Transport</option>
                      <option value="shopping">Shopping</option>
                      <option value="other">Other</option>
                    </select>
                    <input
                      type="time"
                      value={startTime}
                      onChange={e => setStartTime(e.target.value)}
                      aria-label="Start time"
                      className="type-small h-9 w-[104px] rounded-md border border-border-strong bg-surface px-2 text-ink focus:border-brand focus:outline-none"
                    />
                    <input
                      type="number"
                      min={5}
                      step={5}
                      value={durationMin}
                      onChange={e => setDurationMin(e.target.value)}
                      placeholder="Min"
                      aria-label="Duration in minutes"
                      className="type-small h-9 w-[72px] rounded-md border border-border-strong bg-surface px-2 text-ink placeholder:text-ink-3 focus:border-brand focus:outline-none"
                    />
                  </div>
                  <textarea
                    value={notes}
                    onChange={e => setNotes(e.target.value)}
                    placeholder="Notes (optional)"
                    rows={2}
                    aria-label="Notes"
                    className="type-small w-full resize-none rounded-md border border-border-strong bg-surface px-3 py-2 text-ink placeholder:text-ink-3 focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/40"
                  />
                  <Button
                    onClick={addCustom}
                    disabled={!name.trim() || addStop.isPending}
                    className="w-full"
                    size="sm"
                  >
                    <Plus className="h-4 w-4" />
                    {addStop.isPending ? "Adding…" : `Add to ${dayName}`}
                  </Button>
                </div>
              </div>
            </div>
          </motion.aside>
        </>
      ) : null}
    </AnimatePresence>
  );
}
