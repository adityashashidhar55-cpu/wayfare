import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "framer-motion";
import {
  Bookmark,
  Check,
  ChevronRight,
  Loader2,
  LocateOff,
  MapPin,
  Radar,
  X,
} from "lucide-react";
import maplibregl from "maplibre-gl";
import type { inferRouterOutputs } from "@trpc/server";
import type { AppRouter } from "../../../api/router";
import { trpc } from "@/providers/trpc";
import { geoPlaceFor } from "@/lib/geocode";
import {
  GeolocateError,
  createUserMarkerEl,
  requestUserPosition,
} from "@/lib/geolocate";
import type { GeoPermissionState } from "@/lib/geolocate";
import { UserLocationDot } from "@/components/geo/UserLocationDot";
import { cn } from "@/lib/utils";
import { placeKey, useSaveToLibrary } from "../places/useSaveToLibrary";
import { categoryMeta, dayLabel, formatKm } from "./utils";
import type { WsDay } from "./utils";
import { useToast } from "./Toasts";

type NearbyPlace =
  inferRouterOutputs<AppRouter>["explore"]["nearby"]["results"][number];

export interface NearMeOverlayProps {
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

const KIND_CHIPS = [
  { key: "all", label: "All" },
  { key: "food", label: "Food" },
  { key: "activity", label: "Sights" },
] as const;
type KindKey = (typeof KIND_CHIPS)[number]["key"];

/** GeoPermissionState plus a transient-fix failure (timeout / unknown). */
type LocateStatus = GeoPermissionState | "error";

/**
 * "Near me" (§9 map chrome, beside the search box): asks the browser for
 * location (directly from the click - a browser requirement), centers the map
 * on a pulsing user dot, then queries explore.nearby (Overpass) with kind
 * chips and offers per-row "Add to day ▸" (trips.addStop) and "Save to
 * library" (explore.addPlace) for places that aren't in the corpus yet.
 * Permission denial, missing geolocation, and Overpass outages are friendly
 * inline states, never errors.
 */
export default function NearMeOverlay({
  map,
  tripId,
  days,
  activeDayId,
  destination,
}: NearMeOverlayProps) {
  const utils = trpc.useUtils();
  const { push } = useToast();
  const { save, isPending: saving } = useSaveToLibrary();

  const [open, setOpen] = useState(false);
  const [status, setStatus] = useState<LocateStatus>("idle");
  const [geoError, setGeoError] = useState<string | null>(null);
  const [position, setPosition] = useState<{ lat: number; lng: number } | null>(
    null
  );
  const [kind, setKind] = useState<KindKey>("all");
  const [expandedRow, setExpandedRow] = useState<string | null>(null);
  const [savedKeys, setSavedKeys] = useState<Set<string>>(new Set());
  const [addedKeys, setAddedKeys] = useState<Set<string>>(new Set());
  const markerRef = useRef<maplibregl.Marker | null>(null);
  const [dotEl, setDotEl] = useState<HTMLDivElement | null>(null);

  const nearby = trpc.explore.nearby.useQuery(
    {
      lat: position?.lat ?? 0,
      lng: position?.lng ?? 0,
      kind,
      radius: 1500,
    },
    { enabled: position != null && open && status === "granted" }
  );
  const results = nearby.data?.results ?? [];
  const degraded = nearby.data?.degraded ?? false;

  /**
   * Ask the browser for the user's position.
   * IMPORTANT: `requestUserPosition` calls
   * `navigator.geolocation.getCurrentPosition` synchronously - keep every
   * invocation inside a click handler's synchronous call stack (browsers
   * ignore/reject requests that aren't tied to a user gesture).
   */
  const locate = useCallback(() => {
    setStatus("asking");
    setGeoError(null);
    requestUserPosition({ timeout: 10000, maximumAge: 60000 })
      .then(pos => {
        const p = { lat: pos.coords.latitude, lng: pos.coords.longitude };
        setPosition(p);
        setStatus("granted");
        markerRef.current?.remove();
        if (map) {
          const el = createUserMarkerEl();
          markerRef.current = new maplibregl.Marker({
            element: el,
            anchor: "center",
          })
            .setLngLat([p.lng, p.lat])
            .addTo(map);
          setDotEl(el);
          map.flyTo({ center: [p.lng, p.lat], zoom: 14, duration: 900 });
        }
      })
      .catch((err: unknown) => {
        if (err instanceof GeolocateError && err.kind === "unavailable") {
          setStatus("unavailable");
          return;
        }
        if (err instanceof GeolocateError && err.kind === "denied") {
          setStatus("denied");
          return;
        }
        setStatus("error");
        setGeoError("Couldn't pin down your location, try again.");
      });
  }, [map]);

  /* remove the user dot when the overlay unmounts */
  useEffect(() => {
    const marker = markerRef;
    return () => {
      marker.current?.remove();
      marker.current = null;
      setDotEl(null);
    };
  }, []);

  const onButtonClick = () => {
    if (open) {
      setOpen(false);
      return;
    }
    setOpen(true);
    // Geolocation must be requested from this gesture - ask immediately on
    // first open (and after transient failures). Denied/unavailable states
    // show guidance instead of re-prompting pointlessly.
    if (status === "idle" || status === "error") locate();
  };

  const addStop = trpc.trips.addStop.useMutation({
    onError: e =>
      push({
        title: "Could not add stop",
        description: e.message,
        kind: "danger",
      }),
  });

  const addToDay = (r: NearbyPlace, dayId: number | null, dayName: string) => {
    addStop.mutate(
      {
        tripId,
        dayId,
        name: r.name.slice(0, 255),
        category: r.category,
        address: r.address?.slice(0, 512),
        lat: r.lat,
        lng: r.lng,
      },
      {
        onSuccess: () => {
          void utils.trips.get.invalidate({ id: tripId });
          push({ title: `Added ${r.name}`, description: dayName, kind: "success" });
          setAddedKeys(prev => new Set(prev).add(r.osmId));
          setExpandedRow(null);
        },
      }
    );
  };

  const saveRow = async (r: NearbyPlace) => {
    const geo = await geoPlaceFor(r.lat, r.lng, destination);
    if (!geo.city || !geo.country) {
      push({
        title: "Couldn't tell which city that is",
        description: "Right-click the map to add it with a city instead.",
        kind: "danger",
      });
      return;
    }
    save(
      {
        name: r.name.slice(0, 120),
        lat: r.lat,
        lng: r.lng,
        category: r.category,
        city: geo.city,
        country: geo.country,
        address: r.address,
        tags: r.category === "food" ? ["food"] : undefined,
        styles: r.category === "food" ? ["food"] : undefined,
      },
      () => setSavedKeys(prev => new Set(prev).add(placeKey(r)))
    );
  };

  return (
    <>
      {/* trigger, locate-style pill beside the search box */}
      <div className="absolute left-[calc(min(320px,calc(100%-120px))+20px)] top-14 z-20 lg:top-3">
        <button
          type="button"
          onClick={onButtonClick}
          aria-pressed={open}
          aria-label="Find places near me"
          className={cn(
            "type-small glass flex h-10 items-center gap-1.5 whitespace-nowrap rounded-xl border px-3 font-semibold shadow-md transition-colors duration-fast lg:px-3.5",
            open
              ? "border-transparent bg-brand-soft text-brand"
              : "border-border text-ink hover:text-brand"
          )}
        >
          {status === "asking" ? (
            <Loader2 className="h-4 w-4 animate-spin" strokeWidth={1.75} />
          ) : status === "denied" || status === "unavailable" ? (
            <LocateOff className="h-4 w-4" strokeWidth={1.75} />
          ) : (
            <Radar className="h-4 w-4" strokeWidth={1.75} />
          )}
          Near me
        </button>
      </div>

      {/* pulsing user dot, portaled into the MapLibre marker element */}
      {dotEl ? createPortal(<UserLocationDot />, dotEl) : null}

      {/* results panel, under the button (right-aligned on small screens) */}
      <AnimatePresence>
        {open ? (
          <motion.div
            initial={{ opacity: 0, y: 6, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 4, scale: 0.98 }}
            transition={{ duration: 0.18, ease: [0.22, 1, 0.36, 1] }}
            className="glass absolute right-3 top-[104px] z-20 flex max-h-[min(420px,calc(100%-130px))] w-[min(340px,calc(100%-24px))] flex-col rounded-xl border border-border shadow-lg lg:left-[calc(min(320px,calc(100%-120px))+20px)] lg:right-auto lg:top-[60px]"
            role="dialog"
            aria-label="Places near you"
          >
            <div className="flex items-center gap-2 px-3 pb-2 pt-3">
              <p className="min-w-0 flex-1 truncate text-[14px] font-semibold text-ink">
                Around you
              </p>
              {/* kind chips */}
              <div className="flex gap-1" role="radiogroup" aria-label="Place kind">
                {KIND_CHIPS.map(c => {
                  const on = kind === c.key;
                  return (
                    <button
                      key={c.key}
                      type="button"
                      role="radio"
                      aria-checked={on}
                      onClick={() => setKind(c.key)}
                      className={cn(
                        "type-caption rounded-pill px-2.5 py-1 font-semibold transition-all duration-fast",
                        on
                          ? "bg-brand-soft text-brand"
                          : "bg-surface-2 text-ink-3 hover:text-ink-2"
                      )}
                    >
                      {c.label}
                    </button>
                  );
                })}
              </div>
              <button
                type="button"
                aria-label="Close"
                onClick={() => setOpen(false)}
                className="rounded-sm p-1 text-ink-3 transition-colors duration-fast hover:bg-surface-2 hover:text-ink"
              >
                <X className="h-3.5 w-3.5" strokeWidth={1.75} />
              </button>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-1 pb-1">
              {status === "asking" || status === "idle" ? (
                <p className="type-small flex items-center gap-2 px-3 py-3 text-ink-3">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" strokeWidth={2} />
                  Asking for location…
                </p>
              ) : status === "unavailable" ? (
                <div className="px-3 py-2.5">
                  <p className="type-small flex items-start gap-2 text-ink-2">
                    <LocateOff className="mt-0.5 h-3.5 w-3.5 shrink-0 text-ink-3" strokeWidth={1.75} />
                    Location isn't available in this browser, try a different
                    browser or device.
                  </p>
                </div>
              ) : status === "denied" ? (
                <div className="px-3 py-2.5">
                  <p className="type-small flex items-start gap-2 font-semibold text-ink">
                    <MapPin className="mt-0.5 h-3.5 w-3.5 shrink-0 text-brand" strokeWidth={1.75} />
                    Location is blocked
                  </p>
                  <p className="type-small mt-1.5 text-ink-2">
                    Enable it in your browser's site settings, then come back:
                  </p>
                  <ul className="type-caption mt-2 space-y-1.5 text-ink-3">
                    <li className="flex gap-1.5">
                      <span className="text-ink-2">Chrome</span>: padlock/tune
                      icon left of the address bar → Site settings → Location →
                      Allow
                    </li>
                    <li className="flex gap-1.5">
                      <span className="text-ink-2">Safari</span>: Safari menu →
                      Settings for This Website… → Location → Allow
                    </li>
                  </ul>
                  <button
                    type="button"
                    onClick={locate}
                    className="type-small mt-2.5 flex h-8 items-center gap-1.5 rounded-md border border-border-strong bg-surface px-3 font-semibold text-ink transition-all duration-fast hover:bg-surface-2"
                  >
                    <Radar className="h-3.5 w-3.5" strokeWidth={1.75} />
                    Try again
                  </button>
                </div>
              ) : status === "error" ? (
                <div className="px-3 py-2.5">
                  <p className="type-small text-ink-2">{geoError}</p>
                  <button
                    type="button"
                    onClick={locate}
                    className="type-small mt-2 flex h-8 items-center gap-1.5 rounded-md border border-border-strong bg-surface px-3 font-semibold text-ink transition-all duration-fast hover:bg-surface-2"
                  >
                    <Radar className="h-3.5 w-3.5" strokeWidth={1.75} />
                    Try again
                  </button>
                </div>
              ) : nearby.isFetching ? (
                <p className="type-small flex items-center gap-2 px-3 py-3 text-ink-3">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" strokeWidth={2} />
                  Searching nearby…
                </p>
              ) : degraded ? (
                <p className="type-small px-3 py-3 text-ink-3">
                  Live map data is unavailable right now, try again shortly.
                </p>
              ) : results.length === 0 ? (
                <p className="type-small px-3 py-3 text-ink-3">
                  Nothing found within 1.5 km, try another category.
                </p>
              ) : (
                <ul aria-label="Nearby places">
                  {results.map(r => {
                    const meta = categoryMeta(r.category);
                    const inLibrary = r.inCorpus || savedKeys.has(placeKey(r));
                    const added = addedKeys.has(r.osmId);
                    const expanded = expandedRow === r.osmId;
                    return (
                      <li key={r.osmId} className="rounded-md px-2.5 py-2">
                        <div className="flex items-center gap-2.5">
                          <button
                            type="button"
                            aria-label={`Center on ${r.name}`}
                            title="Center on map"
                            onClick={() =>
                              map?.flyTo({
                                center: [r.lng, r.lat],
                                zoom: Math.max(map.getZoom(), 15),
                                duration: 700,
                              })
                            }
                            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-surface-2 transition-colors duration-fast hover:bg-brand-soft"
                            style={{ color: meta.color }}
                          >
                            <meta.icon className="h-3.5 w-3.5" strokeWidth={1.75} />
                          </button>
                          <button
                            type="button"
                            title="Center on map"
                            onClick={() =>
                              map?.flyTo({
                                center: [r.lng, r.lat],
                                zoom: Math.max(map.getZoom(), 15),
                                duration: 700,
                              })
                            }
                            className="min-w-0 flex-1 text-left"
                          >
                            <span className="type-small block truncate font-semibold text-ink">
                              {r.name}
                            </span>
                            <span className="type-caption block truncate text-ink-3">
                              <span className="tnum">{formatKm(r.distanceM / 1000)}</span>
                              {r.address ? ` · ${r.address}` : ""}
                            </span>
                          </button>
                          {inLibrary ? (
                            <span className="type-caption inline-flex shrink-0 items-center gap-1 rounded-pill bg-pine-soft px-2 py-0.5 font-semibold text-pine">
                              <Check className="h-3 w-3" strokeWidth={2} />
                              In library
                            </span>
                          ) : (
                            <button
                              type="button"
                              aria-label={`Save ${r.name} to library`}
                              title="Save to library"
                              disabled={saving}
                              onClick={() => void saveRow(r)}
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
                                setExpandedRow(expanded ? null : r.osmId)
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
                                  onClick={() => addToDay(r, d.id, dayLabel(i))}
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
                                onClick={() => addToDay(r, null, "Unscheduled")}
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
              Live from OpenStreetMap · within 1.5 km
            </p>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </>
  );
}
