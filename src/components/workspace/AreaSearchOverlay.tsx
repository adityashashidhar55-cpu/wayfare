import { useCallback, useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  Bookmark,
  Check,
  ChevronRight,
  Loader2,
  ScanSearch,
  X,
} from "lucide-react";
import maplibregl from "maplibre-gl";
import type { inferRouterOutputs } from "@trpc/server";
import type { AppRouter } from "../../../api/router";
import { trpc } from "@/providers/trpc";
import { geoPlaceFor } from "@/lib/geocode";
import { cn } from "@/lib/utils";
import { placeKey, useSaveToLibrary } from "../places/useSaveToLibrary";
import { categoryMeta, dayLabel } from "./utils";
import type { WsDay } from "./utils";
import { useToast } from "./Toasts";

type AreaPlace =
  inferRouterOutputs<AppRouter>["explore"]["discoverArea"]["places"][number];

export interface AreaSearchOverlayProps {
  /** Live MapLibre instance (null until the map is created) */
  map: maplibregl.Map | null;
  tripId: number;
  /** Ordered trip days for the "Add to day" picker */
  days: WsDay[];
  /** Preselected day in the picker */
  activeDayId: number | null;
  /** Trip destination - fallback city/country when saving to the library */
  destination: string;
}

interface AreaBounds {
  south: number;
  west: number;
  north: number;
  east: number;
}

/**
 * Subtle result pin - small ochre dot, visually distinct from the big
 * numbered day pins and the brand search marker.
 */
function createAreaMarkerEl(): HTMLDivElement {
  const el = document.createElement("div");
  el.style.cssText =
    "width:16px;height:16px;border-radius:9999px;background:var(--ochre);" +
    "box-shadow:0 0 0 2px var(--surface), var(--shadow-md);cursor:pointer;";
  return el;
}

/**
 * "Search this area" (Google-Maps style): after the user pans/zooms the map a
 * pill appears top-center; clicking it runs explore.discoverArea (Overpass)
 * over the current bounds - this works for ANY bbox on Earth, so villages
 * get covered too. Results drop onto the map as subtle ochre pins and into a
 * panel with "Add to day" (same trips.addStop flow as the map search) and
 * save-to-library. The button is hidden/disabled while a query is in flight
 * and re-appears only after the map moved enough to leave the last searched
 * box (that drift check is the rate-limit debounce).
 */
export default function AreaSearchOverlay({
  map,
  tripId,
  days,
  activeDayId,
  destination,
}: AreaSearchOverlayProps) {
  const utils = trpc.useUtils();
  const { push } = useToast();
  const { save, isPending: saving } = useSaveToLibrary();

  const [showButton, setShowButton] = useState(false);
  const [panelOpen, setPanelOpen] = useState(false);
  const [places, setPlaces] = useState<AreaPlace[]>([]);
  const [stats, setStats] = useState<{ inserted: number; total: number } | null>(null);
  const [expandedRow, setExpandedRow] = useState<string | null>(null);
  const [savedKeys, setSavedKeys] = useState<Set<string>>(new Set());
  const [addedKeys, setAddedKeys] = useState<Set<string>>(new Set());

  const markersRef = useRef<maplibregl.Marker[]>([]);
  const lastSearchedRef = useRef<AreaBounds | null>(null);
  const userMovedRef = useRef(false);
  const moveTimerRef = useRef<number | undefined>(undefined);

  const clearMarkers = useCallback(() => {
    markersRef.current.forEach(m => m.remove());
    markersRef.current = [];
  }, []);

  const discover = trpc.explore.discoverArea.useMutation({
    onSuccess: res => {
      setPlaces(res.places);
      setStats({ inserted: res.inserted, total: res.total });
      setPanelOpen(true);
      setShowButton(false);
      setExpandedRow(null);
      // drop subtle pins for every found place
      clearMarkers();
      if (map) {
        markersRef.current = res.places.map(p => {
          const el = createAreaMarkerEl();
          el.title = p.name;
          return new maplibregl.Marker({ element: el, anchor: "center" })
            .setLngLat([p.lng, p.lat])
            .addTo(map);
        });
      }
      void utils.explore.invalidate();
      if (res.hint) {
        push({ title: "Searched a smaller area", description: res.hint, kind: "info" });
      } else if (res.places.length === 0) {
        push({
          title: "No attractions found here",
          description: "Try zooming out or panning somewhere else.",
          kind: "info",
        });
      }
    },
    onError: e =>
      push({
        title: "Area search failed",
        description: e.message,
        kind: "danger",
      }),
  });

  /* ── show/hide the pill as the user pans/zooms ──
     The pill only appears after a REAL user gesture on the map canvas
     (mouse/touch/wheel/keyboard) - programmatic fits (initial load fit, day
     changes, "my location") never raise it. After a search, the searched box
     becomes the baseline and the pill stays hidden until the view drifts
     ≥30% of its span (or zooms way out) - that drift check is also the
     rate-limit debounce, and the pill is disabled while a query is in
     flight. */
  useEffect(() => {
    if (!map) return;
    const canvas = map.getCanvasContainer();
    const onGesture = () => {
      userMovedRef.current = true;
    };
    canvas.addEventListener("mousedown", onGesture, true);
    canvas.addEventListener("touchstart", onGesture, true);
    canvas.addEventListener("wheel", onGesture, true);
    canvas.addEventListener("keydown", onGesture, true);

    const evaluate = () => {
      // never interrupt an in-flight query; a click is the only trigger
      if (discover.isPending) return;
      if (!userMovedRef.current) return;
      const b = map.getBounds();
      const last = lastSearchedRef.current;
      if (!last) {
        setShowButton(true);
        return;
      }
      const c = map.getCenter();
      const spanLat = Math.max(last.north - last.south, 1e-6);
      const spanLng = Math.max(last.east - last.west, 1e-6);
      const driftLat = Math.abs(c.lat - (last.south + last.north) / 2) / spanLat;
      const driftLng = Math.abs(c.lng - (last.west + last.east) / 2) / spanLng;
      const zoomedOutFar =
        b.getNorth() - b.getSouth() > spanLat * 2 ||
        b.getEast() - b.getWest() > spanLng * 2;
      setShowButton(driftLat > 0.3 || driftLng > 0.3 || zoomedOutFar);
    };
    const onMoveEnd = () => {
      window.clearTimeout(moveTimerRef.current);
      moveTimerRef.current = window.setTimeout(evaluate, 250);
    };

    map.on("moveend", onMoveEnd);
    return () => {
      map.off("moveend", onMoveEnd);
      window.clearTimeout(moveTimerRef.current);
      canvas.removeEventListener("mousedown", onGesture, true);
      canvas.removeEventListener("touchstart", onGesture, true);
      canvas.removeEventListener("wheel", onGesture, true);
      canvas.removeEventListener("keydown", onGesture, true);
    };
  }, [map, discover.isPending]);

  /* remove pins when the overlay unmounts */
  useEffect(() => clearMarkers, [clearMarkers]);

  const searchArea = () => {
    if (!map || discover.isPending) return;
    const b = map.getBounds();
    let south = b.getSouth();
    let west = b.getWest();
    let north = b.getNorth();
    let east = b.getEast();
    // antimeridian safety - the server expects west < east
    if (west >= east) {
      const c = map.getCenter();
      west = c.lng - 0.25;
      east = c.lng + 0.25;
      south = Math.max(south, c.lat - 0.25);
      north = Math.min(north, c.lat + 0.25);
    }
    lastSearchedRef.current = { south, west, north, east };
    discover.mutate({ south, west, north, east });
  };

  const clearAll = useCallback(() => {
    setPanelOpen(false);
    setPlaces([]);
    setStats(null);
    setExpandedRow(null);
    clearMarkers();
  }, [clearMarkers]);

  const addStop = trpc.trips.addStop.useMutation({
    onError: e =>
      push({
        title: "Could not add stop",
        description: e.message,
        kind: "danger",
      }),
  });

  const addToDay = (p: AreaPlace, dayId: number | null, dayName: string) => {
    addStop.mutate(
      {
        tripId,
        dayId,
        name: p.name.slice(0, 255),
        category: p.category,
        address: p.address?.slice(0, 512),
        lat: p.lat,
        lng: p.lng,
      },
      {
        onSuccess: () => {
          void utils.trips.get.invalidate({ id: tripId });
          push({ title: `Added ${p.name}`, description: dayName, kind: "success" });
          setAddedKeys(prev => new Set(prev).add(p.osmId));
          setExpandedRow(null);
        },
      }
    );
  };

  const saveRow = async (p: AreaPlace) => {
    const geo = await geoPlaceFor(p.lat, p.lng, destination);
    if (!geo.city || !geo.country) {
      push({
        title: "Couldn't tell which city that is",
        description: "Right-click the map to add it with a city instead.",
        kind: "danger",
      });
      return;
    }
    const category = p.category === "food" ? ("food" as const) : ("activity" as const);
    save(
      {
        name: p.name.slice(0, 120),
        lat: p.lat,
        lng: p.lng,
        category,
        city: geo.city,
        country: geo.country,
        address: p.address,
        // stay inside the addPlace tag vocabulary (same as the other overlays)
        tags: category === "food" ? ["food"] : undefined,
        styles: category === "food" ? ["food"] : undefined,
      },
      () => setSavedKeys(prev => new Set(prev).add(placeKey(p)))
    );
  };

  return (
    <>
      {/* trigger · Google-style pill, top-center, below the search row so it
          never covers the search box / Near-me controls */}
      <AnimatePresence>
        {showButton || discover.isPending ? (
          /* positioning wrapper stays transform-free for framer-motion -
             the Tailwind -translate-x-1/2 would be overwritten otherwise */
          <div className="absolute left-1/2 top-[104px] z-20 -translate-x-1/2">
          <motion.div
            initial={{ opacity: 0, y: -6, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -6, scale: 0.96 }}
            transition={{ duration: 0.18, ease: [0.22, 1, 0.36, 1] }}
          >
            <button
              type="button"
              onClick={searchArea}
              disabled={discover.isPending}
              className={cn(
                "type-small glass flex h-9 items-center gap-1.5 rounded-pill border px-4 font-semibold shadow-md transition-colors duration-fast",
                discover.isPending
                  ? "border-transparent bg-brand-soft text-brand"
                  : "border-border text-brand hover:bg-brand-soft"
              )}
            >
              {discover.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" strokeWidth={1.75} />
              ) : (
                <ScanSearch className="h-4 w-4" strokeWidth={1.75} />
              )}
              {discover.isPending ? "Searching…" : "Search this area"}
            </button>
          </motion.div>
          </div>
        ) : null}
      </AnimatePresence>

      {/* results panel, under the pill, centered */}
      <AnimatePresence>
        {panelOpen ? (
          /* see note on the button wrapper - positioning must be motion-free */
          <div className="absolute left-1/2 top-[148px] z-20 w-[min(360px,calc(100%-24px))] -translate-x-1/2">
          <motion.div
            initial={{ opacity: 0, y: 6, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 4, scale: 0.98 }}
            transition={{ duration: 0.18, ease: [0.22, 1, 0.36, 1] }}
            className="glass flex max-h-[min(400px,calc(100%-240px))] w-full flex-col rounded-xl border border-border shadow-lg"
            role="dialog"
            aria-label="Attractions in this area"
          >
            <div className="flex items-center gap-2 px-3 pb-2 pt-3">
              <p className="min-w-0 flex-1 truncate text-[14px] font-semibold text-ink">
                Attractions in this area
              </p>
              <button
                type="button"
                aria-label="Clear area results"
                onClick={clearAll}
                className="rounded-sm p-1 text-ink-3 transition-colors duration-fast hover:bg-surface-2 hover:text-ink"
              >
                <X className="h-3.5 w-3.5" strokeWidth={1.75} />
              </button>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-1 pb-1">
              {places.length === 0 ? (
                <p className="type-small px-3 py-3 text-ink-3">
                  Nothing found in this area, try another spot on the map.
                </p>
              ) : (
                <ul aria-label="Area attractions">
                  {places.map(p => {
                    const meta = categoryMeta(p.category);
                    const inLibrary = p.inCorpus || savedKeys.has(placeKey(p));
                    const added = addedKeys.has(p.osmId);
                    const expanded = expandedRow === p.osmId;
                    return (
                      <li key={p.osmId} className="rounded-md px-2.5 py-2">
                        <div className="flex items-center gap-2.5">
                          <button
                            type="button"
                            aria-label={`Center on ${p.name}`}
                            title="Center on map"
                            onClick={() =>
                              map?.flyTo({
                                center: [p.lng, p.lat],
                                zoom: Math.max(map.getZoom(), 14),
                                duration: 700,
                              })
                            }
                            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-surface-2 transition-colors duration-fast hover:bg-brand-soft"
                            style={{ color: meta.color }}
                          >
                            <meta.icon className="h-3.5 w-3.5" strokeWidth={1.75} />
                          </button>
                          <span className="min-w-0 flex-1">
                            <span className="type-small block truncate font-semibold text-ink">
                              {p.name}
                            </span>
                            <span className="type-caption block truncate text-ink-3">
                              {p.address ??
                                (p.tags.length ? p.tags.join(" · ") : meta.label)}
                            </span>
                          </span>
                          {inLibrary ? (
                            <span className="type-caption inline-flex shrink-0 items-center gap-1 rounded-pill bg-pine-soft px-2 py-0.5 font-semibold text-pine">
                              <Check className="h-3 w-3" strokeWidth={2} />
                              In library
                            </span>
                          ) : (
                            <button
                              type="button"
                              aria-label={`Save ${p.name} to library`}
                              title="Save to library"
                              disabled={saving}
                              onClick={() => void saveRow(p)}
                              className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-ink-3 transition-colors duration-fast hover:bg-brand-soft hover:text-brand disabled:opacity-60"
                            >
                              <Bookmark className="h-3.5 w-3.5" strokeWidth={1.75} />
                            </button>
                          )}
                        </div>

                        {/* actions */}
                        <div className="mt-1.5 pl-[38px]">
                          {added ? (
                            <span className="type-caption inline-flex items-center gap-1 font-semibold text-pine">
                              <Check className="h-3 w-3" strokeWidth={2} />
                              Added to your trip
                            </span>
                          ) : (
                            <button
                              type="button"
                              aria-expanded={expanded}
                              onClick={() =>
                                setExpandedRow(expanded ? null : p.osmId)
                              }
                              className="type-caption inline-flex items-center gap-0.5 font-semibold text-brand transition-colors duration-fast hover:text-brand-strong"
                            >
                              Add to day
                              <ChevronRight
                                className={cn(
                                  "h-3 w-3 transition-transform duration-fast",
                                  expanded && "rotate-90"
                                )}
                                strokeWidth={2}
                              />
                            </button>
                          )}
                          {expanded && !added ? (
                            <div className="mt-1.5 flex snap-x gap-1.5 overflow-x-auto pb-0.5 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                              {days.map((d, i) => (
                                <button
                                  key={d.id}
                                  type="button"
                                  disabled={addStop.isPending}
                                  onClick={() => addToDay(p, d.id, dayLabel(i))}
                                  className={cn(
                                    "type-caption shrink-0 snap-start rounded-pill px-2.5 py-1 font-semibold transition-all duration-fast disabled:opacity-60",
                                    d.id === activeDayId
                                      ? "bg-brand-soft text-brand"
                                      : "bg-surface-2 text-ink-2 hover:bg-brand-soft hover:text-brand"
                                  )}
                                >
                                  {dayLabel(i)}
                                </button>
                              ))}
                              <button
                                type="button"
                                disabled={addStop.isPending}
                                onClick={() => addToDay(p, null, "Unscheduled")}
                                className="type-caption shrink-0 rounded-pill bg-surface-2 px-2.5 py-1 font-semibold text-ink-2 transition-all duration-fast hover:bg-brand-soft hover:text-brand disabled:opacity-60"
                              >
                                Unscheduled
                              </button>
                            </div>
                          ) : null}
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
            <p className="type-caption border-t border-border px-3 py-1.5 text-ink-3">
              Live from OpenStreetMap
              {stats
                ? ` · ${stats.inserted} new · ${stats.total} in library here`
                : ""}
            </p>
          </motion.div>
          </div>
        ) : null}
      </AnimatePresence>
    </>
  );
}
