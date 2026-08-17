import { useCallback, useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Check, Loader2, MapPin, Plus, Search, X } from "lucide-react";
import maplibregl from "maplibre-gl";
import { trpc } from "@/providers/trpc";
import { cn } from "@/lib/utils";
import { useExploreSearch } from "@/lib/exploreLive";
import type { ExplorePlaceResult } from "@/lib/exploreLive";
import { geoPlaceFor } from "@/lib/geocode";
import { placeKey, useSaveToLibrary } from "../places/useSaveToLibrary";
import { categoryMeta, dayLabel } from "./utils";
import type { WsDay } from "./utils";
import { useToast } from "./Toasts";

export interface MapSearchOverlayProps {
  /** Live MapLibre instance (null until the map is created) */
  map: maplibregl.Map | null;
  tripId: number;
  /** Ordered trip days for the "Add to day" picker */
  days: WsDay[];
  /** Preselected day in the picker */
  activeDayId: number | null;
  /** Trip destination - fallback city/country when saving OSM results */
  destination: string;
}

/** Small "OpenStreetMap" provenance badge for live (non-corpus) results. */
function OsmBadge() {
  return (
    <span
      className="type-caption inline-flex shrink-0 items-center rounded-sm bg-surface-2 px-1.5 py-0.5 font-semibold uppercase tracking-[0.06em] text-ink-3"
      title="Found via OpenStreetMap"
    >
      OSM
    </span>
  );
}

/** Temporary search-result pin - brand dot, distinct from numbered day pins. */
function createSearchMarkerEl(): HTMLDivElement {
  const el = document.createElement("div");
  el.style.cssText =
    "width:30px;height:30px;border-radius:9999px;background:var(--brand);" +
    "box-shadow:0 0 0 2px var(--surface), var(--shadow-md);" +
    "display:flex;align-items:center;justify-content:center;cursor:pointer;";
  const dot = document.createElement("div");
  dot.style.cssText =
    "width:8px;height:8px;border-radius:9999px;background:#FFFFFF;";
  el.appendChild(dot);
  return el;
}

/**
 * Live place search over the workspace map (§9 map chrome, top-left).
 * Debounced explore.search as you type (300ms, min 2 chars, biased to the
 * current map center); picking a result flies to it, drops a temporary
 * marker, and offers "Add to day" via trips.addStop.
 */
export default function MapSearchOverlay({
  map,
  tripId,
  days,
  activeDayId,
  destination,
}: MapSearchOverlayProps) {
  const utils = trpc.useUtils();
  const { push } = useToast();
  const { save, isPending: saving } = useSaveToLibrary();
  const [savedKeys, setSavedKeys] = useState<Set<string>>(new Set());

  const [input, setInput] = useState("");
  const [query, setQuery] = useState("");
  const [near, setNear] = useState<{ lat: number; lng: number } | undefined>(
    undefined
  );
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState<ExplorePlaceResult | null>(null);
  const [dayId, setDayId] = useState<number | null>(null);
  const [popPos, setPopPos] = useState<{ x: number; y: number } | null>(null);
  const markerRef = useRef<maplibregl.Marker | null>(null);
  const debounceRef = useRef<number | undefined>(undefined);

  const clearSelection = useCallback(() => {
    setSelected(null);
    setPopPos(null);
    markerRef.current?.remove();
    markerRef.current = null;
  }, []);

  /* ── debounce (300ms) input → query, capturing the map center as `near`;
     driven from the change handler so state updates stay out of effects ── */
  const onInputChange = (v: string) => {
    setInput(v);
    setOpen(true);
    if (selected) clearSelection();
    window.clearTimeout(debounceRef.current);
    const q = v.trim();
    if (q.length < 2) {
      setQuery("");
      return;
    }
    debounceRef.current = window.setTimeout(() => {
      const c = map?.getCenter();
      setNear(c ? { lat: c.lat, lng: c.lng } : undefined);
      setQuery(q);
    }, 300);
  };

  const resetSearch = useCallback(() => {
    window.clearTimeout(debounceRef.current);
    setQuery("");
    setInput("");
  }, []);

  const search = useExploreSearch(
    { query, near, limit: 8 },
    { enabled: query.length >= 2 }
  );
  const results = search.data?.results ?? [];

  /* remove the temp marker + pending debounce when the overlay unmounts */
  useEffect(() => {
    const marker = markerRef;
    return () => {
      marker.current?.remove();
      marker.current = null;
      window.clearTimeout(debounceRef.current);
    };
  }, []);

  const pick = (r: ExplorePlaceResult) => {
    setSelected(r);
    setDayId(activeDayId ?? days[0]?.id ?? null);
    setOpen(false);
    setInput(r.name);
    markerRef.current?.remove();
    if (map) {
      markerRef.current = new maplibregl.Marker({
        element: createSearchMarkerEl(),
        anchor: "center",
      })
        .setLngLat([r.lng, r.lat])
        .addTo(map);
      map.flyTo({
        center: [r.lng, r.lat],
        zoom: Math.max(map.getZoom(), 15),
        duration: 900,
      });
    }
  };

  /* keep the popover glued to the result while the map moves
     (same projection pattern as the pin popover in MapPane) */
  useEffect(() => {
    if (!map || !selected) return;
    const update = () => {
      const p = map.project([selected.lng, selected.lat]);
      setPopPos({ x: p.x, y: p.y });
    };
    update();
    map.on("move", update);
    return () => {
      map.off("move", update);
    };
  }, [map, selected]);

  const addStop = trpc.trips.addStop.useMutation({
    onError: e =>
      push({
        title: "Could not add stop",
        description: e.message,
        kind: "danger",
      }),
  });

  const targetDayIdx = days.findIndex(d => d.id === dayId);
  const targetDayName =
    targetDayIdx >= 0 ? dayLabel(targetDayIdx) : "Unscheduled";

  const addToDay = () => {
    if (!selected) return;
    const place = selected;
    addStop.mutate(
      {
        tripId,
        dayId,
        // stay inside the backend max-lengths (name 255 / address 512)
        name: place.name.slice(0, 255),
        category: place.category,
        address: (place.address ?? `${place.city}, ${place.country}`).slice(
          0,
          512
        ),
        lat: place.lat,
        lng: place.lng,
      },
      {
        onSuccess: () => {
          utils.trips.get.invalidate({ id: tripId });
          push({
            title: `Added ${place.name}`,
            description: targetDayName,
            kind: "success",
          });
          clearSelection();
          resetSearch();
        },
      }
    );
  };

  /** ＋ Save an OSM result into the shared places library (explore.addPlace). */
  const saveRow = async (r: ExplorePlaceResult) => {
    const geo =
      r.city && r.country
        ? { city: r.city, country: r.country }
        : await geoPlaceFor(r.lat, r.lng, destination);
    if (!geo.city || !geo.country) {
      push({
        title: "Couldn't tell which city that is",
        description: "Right-click the map to add it with a city instead.",
        kind: "danger",
      });
      return;
    }
    const category = r.category === "food" ? ("food" as const) : ("activity" as const);
    save(
      {
        name: r.name.slice(0, 120),
        lat: r.lat,
        lng: r.lng,
        category,
        city: geo.city,
        country: geo.country,
        address: r.address,
        tags: category === "food" ? ["food"] : undefined,
        styles: category === "food" ? ["food"] : undefined,
      },
      () => setSavedKeys(prev => new Set(prev).add(placeKey(r)))
    );
  };

  const selectedMeta = categoryMeta(selected?.category);

  return (
    <>
      {/* search box, floating glass, top-left (below the mobile view toggle) */}
      <div className="absolute left-3 top-14 z-20 w-[min(320px,calc(100%-120px))] lg:top-3">
        <div className="relative">
          <Search
            className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-3"
            strokeWidth={1.75}
          />
          <input
            value={input}
            onChange={e => onInputChange(e.target.value)}
            onFocus={() => setOpen(true)}
            onBlur={() => window.setTimeout(() => setOpen(false), 150)}
            onKeyDown={e => {
              if (e.key === "Escape") {
                clearSelection();
                resetSearch();
                e.currentTarget.blur();
              }
            }}
            placeholder="Search places on the map…"
            aria-label="Search places on the map"
            className="type-small glass h-10 w-full rounded-xl border border-border pl-9 pr-8 font-medium text-ink shadow-md placeholder:text-ink-3 focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/40"
          />
          {input ? (
            <button
              type="button"
              aria-label="Clear search"
              onMouseDown={e => e.preventDefault()}
              onClick={() => {
                resetSearch();
                clearSelection();
              }}
              className="absolute right-2 top-1/2 -translate-y-1/2 rounded-sm p-1 text-ink-3 transition-colors duration-fast hover:bg-surface-2 hover:text-ink"
            >
              <X className="h-3.5 w-3.5" strokeWidth={1.75} />
            </button>
          ) : null}
        </div>

        {/* results dropdown */}
        <AnimatePresence>
          {open && query.length >= 2 ? (
            <motion.div
              initial={{ opacity: 0, y: 6, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 4, scale: 0.98 }}
              transition={{ duration: 0.18, ease: [0.22, 1, 0.36, 1] }}
              className="glass absolute left-0 top-full z-20 mt-2 max-h-[320px] w-full overflow-y-auto overscroll-contain rounded-xl border border-border p-1 shadow-lg"
              role="listbox"
              aria-label="Place search results"
            >
              {search.isFetching ? (
                <p className="type-small flex items-center gap-2 px-3 py-2.5 text-ink-3">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" strokeWidth={2} />
                  Searching…
                </p>
              ) : results.length === 0 ? (
                <p className="type-small px-3 py-2.5 text-ink-3">
                  No places found, try another spelling.
                </p>
              ) : (
                results.map((r, i) => {
                  const meta = categoryMeta(r.category);
                  const saved = savedKeys.has(placeKey(r));
                  return (
                    <div
                      key={`${r.source}-${r.id ?? "osm"}-${i}`}
                      role="option"
                      aria-selected={false}
                      className="flex w-full items-center rounded-md transition-colors duration-fast hover:bg-surface-2"
                    >
                      <button
                        type="button"
                        onMouseDown={e => e.preventDefault()}
                        onClick={() => pick(r)}
                        className="flex min-w-0 flex-1 items-center gap-2.5 py-2 pl-2.5 pr-1 text-left"
                      >
                        <span
                          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-surface-2"
                          style={{ color: meta.color }}
                        >
                          <meta.icon className="h-3.5 w-3.5" strokeWidth={1.75} />
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="type-small block truncate font-semibold text-ink">
                            {r.name}
                          </span>
                          <span className="type-caption block truncate text-ink-3">
                            {[r.city, r.country].filter(Boolean).join(", ")}
                          </span>
                        </span>
                      </button>
                      {r.source === "osm" ? (
                        saved ? (
                          <span
                            className="mr-1.5 flex h-7 w-7 shrink-0 items-center justify-center text-pine"
                            title="In your places"
                            aria-label="In your places"
                          >
                            <Check className="h-3.5 w-3.5" strokeWidth={2} />
                          </span>
                        ) : (
                          <button
                            type="button"
                            aria-label={`Save ${r.name} to library`}
                            title="Save to library"
                            disabled={saving}
                            onMouseDown={e => e.preventDefault()}
                            onClick={e => {
                              e.stopPropagation();
                              void saveRow(r);
                            }}
                            className="mr-1.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-ink-3 transition-colors duration-fast hover:bg-brand-soft hover:text-brand disabled:opacity-60"
                          >
                            <Plus className="h-3.5 w-3.5" strokeWidth={1.75} />
                          </button>
                        )
                      ) : null}
                      {r.source === "osm" ? (
                        <span className="mr-2 shrink-0">
                          <OsmBadge />
                        </span>
                      ) : null}
                    </div>
                  );
                })
              )}
            </motion.div>
          ) : null}
        </AnimatePresence>
      </div>

      {/* result popover, anchored to the temporary marker */}
      <AnimatePresence>
        {selected && popPos ? (
          <div
            className="pointer-events-none absolute z-20"
            style={{
              left: popPos.x,
              top: popPos.y - 18,
              transform: "translate(-50%, -100%)",
            }}
          >
            <motion.div
              initial={{ opacity: 0, y: 8, scale: 0.96 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 6, scale: 0.97 }}
              transition={{ type: "spring", stiffness: 260, damping: 26 }}
              className="glass pointer-events-auto w-[264px] rounded-xl border border-border p-3 shadow-lg"
            >
              <div className="flex items-start gap-2">
                <span
                  className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-surface-2"
                  style={{ color: selectedMeta.color }}
                >
                  <selectedMeta.icon
                    className="h-3.5 w-3.5"
                    strokeWidth={1.75}
                  />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[14px] font-semibold text-ink">
                    {selected.name}
                  </p>
                  <p className="type-caption mt-0.5 flex items-center gap-1 truncate text-ink-3">
                    <MapPin className="h-3 w-3 shrink-0" strokeWidth={1.75} />
                    <span className="truncate">
                      {selected.address ??
                        [selected.city, selected.country]
                          .filter(Boolean)
                          .join(", ")}
                    </span>
                  </p>
                  <div className="mt-1.5 flex items-center gap-1.5">
                    <span className="type-caption inline-flex items-center rounded-pill bg-surface-2 px-2 py-0.5 text-ink-2">
                      {selectedMeta.label}
                    </span>
                    {selected.source === "osm" ? <OsmBadge /> : null}
                  </div>
                </div>
                <button
                  type="button"
                  aria-label="Dismiss place"
                  onClick={clearSelection}
                  className="rounded-sm p-1 text-ink-3 transition-colors duration-fast hover:bg-surface-2 hover:text-ink"
                >
                  <X className="h-3.5 w-3.5" strokeWidth={1.75} />
                </button>
              </div>

              {/* day picker */}
              <div className="mt-3 flex snap-x gap-1.5 overflow-x-auto pb-0.5 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                {days.map((d, i) => {
                  const on = dayId === d.id;
                  return (
                    <button
                      key={d.id}
                      type="button"
                      aria-pressed={on}
                      onClick={() => setDayId(d.id)}
                      className={cn(
                        "type-caption shrink-0 snap-start rounded-pill px-2.5 py-1 font-semibold transition-all duration-fast",
                        on
                          ? "bg-brand-soft text-brand"
                          : "bg-surface-2 text-ink-3 hover:text-ink-2"
                      )}
                    >
                      {dayLabel(i)}
                    </button>
                  );
                })}
                <button
                  type="button"
                  aria-pressed={dayId === null}
                  onClick={() => setDayId(null)}
                  className={cn(
                    "type-caption shrink-0 rounded-pill px-2.5 py-1 font-semibold transition-all duration-fast",
                    dayId === null
                      ? "bg-brand-soft text-brand"
                      : "bg-surface-2 text-ink-3 hover:text-ink-2"
                  )}
                >
                  Unscheduled
                </button>
              </div>

              <button
                type="button"
                onClick={addToDay}
                disabled={addStop.isPending}
                className="btn-sheen type-small mt-2.5 flex h-9 w-full items-center justify-center gap-1.5 rounded-md bg-brand font-semibold text-brand-ink shadow-sm transition-all duration-fast hover:-translate-y-px hover:bg-brand-strong hover:shadow-md active:scale-[0.97] disabled:opacity-60"
              >
                {addStop.isPending ? (
                  <Loader2 className="h-4 w-4 animate-spin" strokeWidth={2} />
                ) : null}
                {addStop.isPending ? "Adding…" : `Add to ${targetDayName}`}
              </button>
            </motion.div>
          </div>
        ) : null}
      </AnimatePresence>
    </>
  );
}
