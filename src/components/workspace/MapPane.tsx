import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useParams } from "react-router";
import maplibregl from "maplibre-gl";
import type { Feature, LineString } from "geojson";
import { motion } from "framer-motion";
import {
  Plus,
  Minus,
  Maximize2,
  LocateFixed,
  Sun,
  Moon,
  X,
  Trash2,
  ListOrdered,
  Star,
} from "lucide-react";
import type { inferRouterOutputs } from "@trpc/server";
import type { AppRouter } from "../../../api/router";
import {
  BASEMAP_OPTIONS,
  dayColor,
  googleRasterStyle,
  mapStyleForTheme,
} from "@/lib/map";
import type { BasemapMode } from "@/lib/map";
import { usePublicConfig } from "@/lib/publicConfig";
import { createUserMarkerEl, requestUserPosition } from "@/lib/geolocate";
import { UserLocationDot } from "@/components/geo/UserLocationDot";
import { useTheme } from "@/hooks/useTheme";
import { trpc } from "@/providers/trpc";
import { cn } from "@/lib/utils";
import AreaSearchOverlay from "./AreaSearchOverlay";
import { categoryMeta, dayLabel } from "./utils";
import type { WsDay, WsStop } from "./utils";

type MemberLocation =
  inferRouterOutputs<AppRouter>["geo"]["tripMemberLocations"]["locations"][number];

export interface MapPaneProps {
  days: WsDay[];
  stops: WsStop[];
  /** null = “All days” overview */
  activeDayId: number | null;
  selectedStopId: number | null;
  onSelectStop: (id: number | null) => void;
  onOpenInTimeline: (id: number) => void;
  onDeleteStop: (stop: WsStop) => void;
  /** fallback view when no stop has coordinates ([lng, lat]) */
  center: [number, number] | null;
  centerZoom: number;
  /** bump to retrigger pin pop animation (e.g. after optimize) */
  renumberSeed: number;
  className?: string;
  /** called with the live map instance after creation, and null on teardown */
  onMapReady?: (map: maplibregl.Map | null) => void;
  /** right-click (contextmenu) on the basemap - browser menu suppressed */
  onMapContextMenu?: (info: { lat: number; lng: number }) => void;
  /** floating children rendered over the map (optimize pill, summary chip) */
  children?: React.ReactNode;
}

/** Marching-ants dash phases derived from the §9 spec (3px line, dash 1.5 2). */
const DASH_STEPS: number[][] = (() => {
  const dash = 1.5;
  const gap = 2;
  const steps: number[][] = [];
  for (let x = 0; x <= gap; x += 0.5) steps.push([x, dash, gap - x]); // leading gap grows
  for (let x = 0.5; x < dash; x += 0.5) steps.push([0, x, gap, dash - x]); // wrap-around
  return steps;
})();

/** "Ada Byron" → "AB" (first letters of the first two words). */
function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  const letters = parts.slice(0, 2).map(p => p[0]!.toUpperCase());
  return letters.join("") || "?";
}

/**
 * Circular avatar pin for a trip member's live location: presence-colored,
 * soft pulse while the fix is fresh (<2min), greyed when stale (>5min),
 * native tooltip with name + "x min ago".
 */
function createMemberMarkerEl(loc: MemberLocation): HTMLDivElement {
  const el = document.createElement("div");
  el.style.cssText = "position:relative;width:30px;height:30px;cursor:default;";
  const color = loc.presenceColor ?? "var(--brand)";
  const fresh = !loc.stale && loc.ageMs < 120_000;
  if (fresh) {
    const ring = document.createElement("span");
    ring.setAttribute("aria-hidden", "true");
    // Tailwind's animate-ping: scale(2) + fade, 1s infinite - soft pulse
    ring.className = "animate-ping";
    ring.style.cssText =
      "position:absolute;inset:0;border-radius:9999px;opacity:0.4;" +
      `background:${color};`;
    el.appendChild(ring);
  }
  const dot = document.createElement("div");
  dot.style.cssText =
    "position:absolute;inset:0;border-radius:9999px;display:flex;align-items:center;justify-content:center;" +
    "color:#FFFFFF;font-size:11px;font-weight:700;letter-spacing:0.02em;" +
    `box-shadow:0 0 0 2px var(--surface), var(--shadow-md);background:${loc.stale ? "var(--ink-3)" : color};` +
    (loc.stale ? "opacity:0.6;filter:grayscale(0.7);" : "");
  dot.textContent = initials(loc.name);
  el.appendChild(dot);
  const mins = Math.floor(loc.ageMs / 60_000);
  el.title = `${loc.name} · ${mins < 1 ? "just now" : `${mins} min ago`}`;
  return el;
}

function Pin({
  stop,
  number,
  color,
  selected,
  dimmed,
  popSeed,
  onClick,
}: {
  stop: WsStop;
  number: number;
  color: string;
  selected: boolean;
  dimmed: boolean;
  popSeed: number;
  onClick: () => void;
}) {
  return (
    <motion.button
      type="button"
      initial={{ scale: 0.5, opacity: 0 }}
      animate={{ scale: 1, opacity: dimmed ? 0.55 : 1 }}
      whileHover={{ y: -2 }}
      transition={{ type: "spring", stiffness: 500, damping: 28 }}
      onClick={e => {
        e.stopPropagation();
        onClick();
      }}
      title={stop.name}
      aria-label={`${stop.name}, stop ${number}`}
      className="relative flex cursor-pointer items-center justify-center rounded-full"
      style={{
        width: selected ? 38 : 32,
        height: selected ? 38 : 32,
        backgroundColor: color,
        color: "#FFFFFF",
        boxShadow: selected
          ? "0 0 0 2px var(--surface), 0 0 0 4px var(--brand), var(--shadow-md)"
          : "0 0 0 2px var(--surface), var(--shadow-md)",
        transition: "box-shadow 180ms",
      }}
    >
      {/* Fraunces numeral, crossfade-pops when the number changes (§7.2) */}
      <motion.span
        key={`${number}-${popSeed}`}
        initial={{ scale: 1.35, opacity: 0.2 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={{
          type: "spring",
          stiffness: 500,
          damping: 28,
          delay: (number - 1) * 0.04,
        }}
        className="font-serif text-[13px] font-semibold leading-none"
      >
        {number}
      </motion.span>
    </motion.button>
  );
}

export default function MapPane({
  days,
  stops,
  activeDayId,
  selectedStopId,
  onSelectStop,
  onOpenInTimeline,
  onDeleteStop,
  center,
  centerZoom,
  renumberSeed,
  className,
  onMapReady,
  onMapContextMenu,
  children,
}: MapPaneProps) {
  const { isDark, toggleTheme } = useTheme();
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const markersRef = useRef<Map<number, maplibregl.Marker>>(new Map());
  const [mapInstance, setMapInstance] = useState<maplibregl.Map | null>(null);
  const [ready, setReady] = useState(false);

  /* ── workspace trip context (this pane only lives under /trips/:id) ── */
  const { id: routeId } = useParams();
  const tripId = Number(routeId);
  const tripIdValid = Number.isFinite(tripId) && tripId > 0;
  const tripQuery = trpc.trips.get.useQuery(
    { id: tripId },
    { enabled: tripIdValid }
  );
  const tripData = tripQuery.data;
  const memberCount = tripData?.members.length ?? 0;

  /* live member locations - polled every 30s while the workspace is open;
     only multi-member trips poll (a solo trip can only ever show "me") */
  const locationsQuery = trpc.geo.tripMemberLocations.useQuery(
    { tripId },
    {
      enabled: tripIdValid && memberCount > 1,
      refetchInterval: 30_000,
    }
  );
  const [basemap, setBasemap] = useState<BasemapMode>("map");
  const { data: publicConfig } = usePublicConfig();
  const googleKey = publicConfig?.googleMapsKey ?? null;
  /* Google layers only exist with a key - fall back to the CARTO style */
  const effectiveBasemap: BasemapMode = googleKey ? basemap : "map";
  const [styleTick, setStyleTick] = useState(0);
  const [markerEls, setMarkerEls] = useState<Map<number, HTMLDivElement>>(
    new Map()
  );
  const [popupStopId, setPopupStopId] = useState<number | null>(null);
  const [popupPos, setPopupPos] = useState<{ x: number; y: number } | null>(
    null
  );
  const isDarkRef = useRef(isDark);
  isDarkRef.current = isDark;
  const onMapContextMenuRef = useRef(onMapContextMenu);
  onMapContextMenuRef.current = onMapContextMenu;

  const geoStops = useMemo(
    () => stops.filter(s => s.lat != null && s.lng != null),
    [stops]
  );
  /* latest-prop refs so map event handlers (load / resize) always fit the
     current view, never a stale mount-time closure */
  const geoStopsRef = useRef(geoStops);
  geoStopsRef.current = geoStops;
  const activeDayIdRef = useRef(activeDayId);
  activeDayIdRef.current = activeDayId;

  /** stop id → 1-based number within its day */
  const stopNumbers = useMemo(() => {
    const map = new Map<number, number>();
    const orderedDays = [...days].sort((a, b) => a.position - b.position);
    for (const d of orderedDays) {
      const inDay = stops
        .filter(s => s.dayId === d.id)
        .sort((a, b) => a.position - b.position);
      inDay.forEach((s, i) => map.set(s.id, i + 1));
    }
    let unscheduled = 1;
    for (const s of stops.filter(s => s.dayId == null)) {
      map.set(s.id, unscheduled++);
    }
    return map;
  }, [days, stops]);

  const dayIndexById = useMemo(() => {
    const map = new Map<number, number>();
    [...days]
      .sort((a, b) => a.position - b.position)
      .forEach((d, i) => map.set(d.id, i));
    return map;
  }, [days]);

  const activeDayStops = useMemo(() => {
    if (activeDayId == null) return [];
    return stops
      .filter(s => s.dayId === activeDayId && s.lat != null && s.lng != null)
      .sort((a, b) => a.position - b.position);
  }, [stops, activeDayId]);
  const activeDayStopsRef = useRef(activeDayStops);
  activeDayStopsRef.current = activeDayStops;

  /* r12-routeui: one-time full-corridor fit on first load for road trips.
     The workspace opens on day 1, so without this the camera frames only the
     first city's stops and the rest of the route sits off-screen. Consumed
     once; afterwards day switching behaves exactly as before. */
  const tripType = tripData?.trip.tripType;
  const [corridorFitPending, setCorridorFitPending] = useState(true);
  const corridorFitRef = useRef(false);
  corridorFitRef.current = corridorFitPending && tripType === "roadtrip";

  /** set when a fit was requested while the container had no layout size
     (mobile: the pane mounts inside `display:none`) - applied on first
     non-zero resize so the camera still lands on the trip */
  const needsVisibleFitRef = useRef(false);

  const fitTo = useCallback(
    (pts: { lat: number; lng: number }[], animate = true) => {
      const map = mapRef.current;
      if (!map) return;
      const el = containerRef.current;
      /* fitBounds against a 0×0 canvas produces a garbage camera - defer to
         the first visible resize instead (mobile itinerary→map toggle) */
      if (!el || el.clientWidth === 0 || el.clientHeight === 0) {
        if (pts.length > 0) needsVisibleFitRef.current = true;
        return;
      }
      if (pts.length === 0) {
        if (center) map.jumpTo({ center, zoom: centerZoom });
        return;
      }
      if (pts.length === 1) {
        map.flyTo({
          center: [pts[0].lng, pts[0].lat],
          zoom: 14,
          duration: animate ? 900 : 0,
          padding: 80,
        });
        return;
      }
      const bounds = new maplibregl.LngLatBounds();
      pts.forEach(p => bounds.extend([p.lng, p.lat]));
      map.fitBounds(bounds, {
        padding: 80,
        maxZoom: 14.5,
        duration: animate ? 900 : 0,
      });
    },
    [center, centerZoom]
  );

  /** Fit the camera to the current view target: the active day's stops, or
     every stop in "All days" overview. Uses refs → always fresh. */
  const fitCurrentView = useCallback(
    (animate = false) => {
      const day =
        activeDayIdRef.current != null ? activeDayStopsRef.current : [];
      const pts = (day.length ? day : geoStopsRef.current).map(s => ({
        lat: s.lat!,
        lng: s.lng!,
      }));
      fitTo(pts, animate);
    },
    [fitTo]
  );
  const fitCurrentViewRef = useRef(fitCurrentView);
  fitCurrentViewRef.current = fitCurrentView;

  /* ── init once ── */
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    /* First-frame camera: construct the map already looking at the trip
       (active day's stops, else all stops, else the destination fallback) -
       waiting for the remote style's "load" event before fitting left the
       map staring at a default city for a beat. */
    const mountPts = (
      /* r12-routeui: road trips frame the whole corridor on first paint */
      corridorFitRef.current
        ? geoStopsRef.current
        : activeDayIdRef.current != null && activeDayStopsRef.current.length
          ? activeDayStopsRef.current
          : geoStopsRef.current
    ).map(s => ({ lat: s.lat!, lng: s.lng! }));
    const view: Pick<
      maplibregl.MapOptions,
      "center" | "zoom" | "bounds" | "fitBoundsOptions"
    > =
      mountPts.length >= 2
        ? (() => {
            const bounds = new maplibregl.LngLatBounds();
            mountPts.forEach(p => bounds.extend([p.lng, p.lat]));
            return {
              bounds,
              fitBoundsOptions: { padding: 80, maxZoom: 14.5 },
            };
          })()
        : mountPts.length === 1
          ? { center: [mountPts[0].lng, mountPts[0].lat] as [number, number], zoom: 14 }
          : {
              center: center ?? ([139.75, 35.68] as [number, number]),
              zoom: center ? centerZoom : 2,
            };
    const map = new maplibregl.Map({
      container: containerRef.current,
      style: mapStyleForTheme(isDarkRef.current),
      ...view,
      attributionControl: false,
      cooperativeGestures: false,
    });
    map.addControl(
      new maplibregl.AttributionControl({
        compact: true,
        customAttribution:
          '© <a href="https://carto.com/" target="_blank" rel="noopener">CARTO</a> © <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a> contributors',
      }),
      "bottom-right"
    );
    map.on("load", () => {
      setReady(true);
      const el = containerRef.current;
      if (!el || el.clientWidth === 0 || el.clientHeight === 0) {
        /* hidden at mount (mobile itinerary view) - the ResizeObserver
           applies the fit the moment the pane becomes visible */
        needsVisibleFitRef.current = true;
        return;
      }
      /* r12-routeui: when a corridor fit is pending, the ready effect below
         does it (animated) - don't frame day 1 first. */
      if (!corridorFitRef.current) fitCurrentViewRef.current(false);
    });
    map.on("styledata", () => setStyleTick(t => t + 1));

    map.on("click", () => setPopupStopId(null));
    /* right-click drops an "add place" intent - suppress the browser menu */
    map.on("contextmenu", e => {
      e.preventDefault();
      onMapContextMenuRef.current?.({ lat: e.lngLat.lat, lng: e.lngLat.lng });
    });
    mapRef.current = map;
    setMapInstance(map);
    onMapReady?.(map);

    const ro = new ResizeObserver(() => {
      map.resize();
      const el = containerRef.current;
      if (
        needsVisibleFitRef.current &&
        el &&
        el.clientWidth > 0 &&
        el.clientHeight > 0
      ) {
        needsVisibleFitRef.current = false;
        fitCurrentViewRef.current(false);
      }
    });
    ro.observe(containerRef.current);

    const markers = markersRef.current;
    const memberMarkers = memberMarkersRef.current;
    return () => {
      ro.disconnect();
      markers.forEach(m => m.remove());
      markers.clear();
      memberMarkers.forEach(m => m.remove());
      memberMarkers.clear();
      hotelMarkerRef.current?.remove();
      hotelMarkerRef.current = null;
      setHotelEl(null);
      userMarkerRef.current?.remove();
      userMarkerRef.current = null;
      onMapReady?.(null);
      map.remove();
      mapRef.current = null;
      setMapInstance(null);
      setReady(false);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* ── basemap swap (§8: style switches, no flash) - theme for the CARTO
     "map" mode, Google raster tiles for streets/satellite. HTML pins are
     style-independent; the route layer re-adds itself on the styledata tick. ── */
  const appliedStyleKey = useRef<string | null>(null);
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    const styleKey =
      effectiveBasemap === "map"
        ? `carto-${isDark ? "dark" : "light"}`
        : `google-${effectiveBasemap}`;
    if (appliedStyleKey.current === null) {
      // The map was constructed with exactly this style - never re-set it on
      // mount. (Any setStyle call right after load blanks the canvas in the
      // bundled maplibre build.)
      appliedStyleKey.current = styleKey;
      return;
    }
    if (appliedStyleKey.current === styleKey) return;
    appliedStyleKey.current = styleKey;
    const style =
      effectiveBasemap === "map"
        ? mapStyleForTheme(isDark)
        : googleRasterStyle(effectiveBasemap, googleKey ?? "");
    // Diff mode (default): identical style = no-op so mount is safe; a real
    // theme/basemap change applies a structural diff without a blank flash.
    // NOTE: { diff: false } fully replaces the style and breaks rendering in
    // the bundled maplibre build - do not use it here.
    map.setStyle(style);
  }, [isDark, ready, effectiveBasemap, googleKey]);

  /* ── sync HTML pin markers with stops ── */
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    const markers = markersRef.current;
    const ids = new Set(geoStops.map(s => s.id));
    for (const [id, marker] of markers) {
      if (!ids.has(id)) {
        marker.remove();
        markers.delete(id);
      }
    }
    for (const s of geoStops) {
      const existing = markers.get(s.id);
      if (existing) {
        existing.setLngLat([s.lng!, s.lat!]);
      } else {
        const el = document.createElement("div");
        el.style.cursor = "pointer";
        const marker = new maplibregl.Marker({ element: el, anchor: "center" })
          .setLngLat([s.lng!, s.lat!])
          .addTo(map);
        markers.set(s.id, marker);
      }
    }
    setMarkerEls(
      new Map(
        [...markers].map(([id, m]) => [id, m.getElement() as HTMLDivElement])
      )
    );
  }, [geoStops, ready]);

  /* ── route polyline for the active day (§9: 3px day color, 70% op, marching ants) ── */
  const routeCoords = useMemo(
    () => activeDayStops.map(s => [s.lng!, s.lat!] as [number, number]),
    [activeDayStops]
  );
  const activeDayColor = useMemo(() => {
    if (activeDayId == null) return null;
    const idx = dayIndexById.get(activeDayId) ?? 0;
    return dayColor(idx + 1, isDark);
  }, [activeDayId, dayIndexById, isDark]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready || !map.isStyleLoaded()) return;
    try {
      const src = map.getSource("wf-route") as
        maplibregl.GeoJSONSource | undefined;
      const hasRoute = routeCoords.length >= 2 && activeDayColor != null;
      const geometry: LineString = hasRoute
        ? { type: "LineString", coordinates: routeCoords }
        : { type: "LineString", coordinates: [] };
      const data: Feature<LineString> = {
        type: "Feature",
        properties: {},
        geometry,
      };
      if (src) {
        src.setData(data);
      } else if (hasRoute) {
        map.addSource("wf-route", { type: "geojson", data });
      }
      if (hasRoute && !map.getLayer("wf-route-line")) {
        map.addLayer({
          id: "wf-route-line",
          type: "line",
          source: "wf-route",
          layout: { "line-cap": "round", "line-join": "round" },
          paint: {
            "line-color": activeDayColor,
            "line-width": 3,
            "line-opacity": 0.7,
            "line-dasharray": DASH_STEPS[0],
          },
        });
      }
      if (map.getLayer("wf-route-line") && activeDayColor) {
        map.setPaintProperty("wf-route-line", "line-color", activeDayColor);
      }
    } catch {
      /* style mid-load; styledata tick retries */
    }
  }, [routeCoords, activeDayColor, ready, styleTick]);

  /* ── marching ants ── */
  useEffect(() => {
    if (!ready || routeCoords.length < 2) return;
    let step = 0;
    const timer = window.setInterval(() => {
      const map = mapRef.current;
      if (!map || !map.getLayer("wf-route-line")) return;
      step = (step + 1) % DASH_STEPS.length;
      try {
        map.setPaintProperty(
          "wf-route-line",
          "line-dasharray",
          DASH_STEPS[step]
        );
      } catch {
        /* layer gone */
      }
    }, 110);
    return () => window.clearInterval(timer);
  }, [ready, routeCoords.length]);

  /* ── fly to day bounds when the active day changes ── */
  const fitAll = useCallback(() => {
    fitTo(
      geoStops.map(s => ({ lat: s.lat!, lng: s.lng! })),
      true
    );
  }, [fitTo, geoStops]);

  useEffect(() => {
    if (!ready) return;
    /* r12-routeui: first load on a road trip frames the whole corridor once,
       then normal day-fit behavior resumes. */
    if (corridorFitPending && tripType === "roadtrip") {
      setCorridorFitPending(false);
      fitAll();
      return;
    }
    if (activeDayId == null) fitAll();
    else if (activeDayStops.length)
      fitTo(
        activeDayStops.map(s => ({ lat: s.lat!, lng: s.lng! })),
        true
      );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeDayId, ready, tripType, corridorFitPending]);

  /* ── stops arriving after mount (0 → N, e.g. a refetch resolving behind
     the skeleton): nothing has fitted yet, so go there immediately ── */
  const prevGeoCountRef = useRef(geoStops.length);
  useEffect(() => {
    const prev = prevGeoCountRef.current;
    prevGeoCountRef.current = geoStops.length;
    if (!ready || prev > 0 || geoStops.length === 0) return;
    fitCurrentView(false);
  }, [geoStops.length, ready, fitCurrentView]);

  /* ── fly to the selected pin (card click ↔ pin click): a real fly with a
     zoom floor, not a bare pan - a pan at overview zoom never feels like
     "take me there" ── */
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready || selectedStopId == null) return;
    const s = stops.find(x => x.id === selectedStopId);
    if (s?.lat != null && s?.lng != null) {
      map.flyTo({
        center: [s.lng, s.lat],
        zoom: Math.max(map.getZoom(), 14.5),
        duration: 700,
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedStopId, ready]);

  /* ── pin popover position tracking ── */
  const popupStop =
    popupStopId != null ? stops.find(s => s.id === popupStopId) : null;
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !popupStop || popupStop.lat == null || popupStop.lng == null) {
      setPopupPos(null);
      return;
    }
    const update = () => {
      const p = map.project([popupStop.lng!, popupStop.lat!]);
      setPopupPos({ x: p.x, y: p.y });
    };
    update();
    map.on("move", update);
    return () => {
      map.off("move", update);
    };
  }, [popupStop]);

  /* ── my-location chrome: center on the user with a pulsing dot ── */
  const userMarkerRef = useRef<maplibregl.Marker | null>(null);
  const [userDotEl, setUserDotEl] = useState<HTMLDivElement | null>(null);

  /* ── live member location pins (avatar initials, presence-colored) ── */
  const memberMarkersRef = useRef<Map<number, maplibregl.Marker>>(new Map());
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    const markers = memberMarkersRef.current;
    const locs = locationsQuery.data?.locations ?? [];
    const ids = new Set(locs.map(l => l.userId));
    for (const [uid, marker] of markers) {
      if (!ids.has(uid)) {
        marker.remove();
        markers.delete(uid);
      }
    }
    for (const loc of locs) {
      // rebuild each poll so color/stale/tooltip stay truthful
      markers.get(loc.userId)?.remove();
      markers.set(
        loc.userId,
        new maplibregl.Marker({
          element: createMemberMarkerEl(loc),
          anchor: "center",
        })
          .setLngLat([loc.lng, loc.lat])
          .addTo(map)
      );
    }
  }, [locationsQuery.data, ready]);

  /* ── gold "home base" hotel pin (rendered only when the trip has one) ── */
  const hotelMarkerRef = useRef<maplibregl.Marker | null>(null);
  const [hotelEl, setHotelEl] = useState<HTMLDivElement | null>(null);
  const hotelLat = tripData?.trip.hotelLat ?? null;
  const hotelLng = tripData?.trip.hotelLng ?? null;
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    if (hotelLat == null || hotelLng == null) {
      hotelMarkerRef.current?.remove();
      hotelMarkerRef.current = null;
      setHotelEl(null);
      return;
    }
    if (hotelMarkerRef.current) {
      hotelMarkerRef.current.setLngLat([hotelLng, hotelLat]);
      return;
    }
    const el = document.createElement("div");
    el.style.cssText = "width:30px;height:30px;";
    hotelMarkerRef.current = new maplibregl.Marker({
      element: el,
      anchor: "center",
    })
      .setLngLat([hotelLng, hotelLat])
      .addTo(map);
    setHotelEl(el);
  }, [hotelLat, hotelLng, ready]);

  const locate = () => {
    const map = mapRef.current;
    if (!map) return;
    // Called synchronously from the chrome button click - the geolocation
    // request must stay inside the user gesture (browser requirement).
    requestUserPosition({ timeout: 10000, maximumAge: 60000 })
      .then(pos => {
        const center: [number, number] = [
          pos.coords.longitude,
          pos.coords.latitude,
        ];
        userMarkerRef.current?.remove();
        const el = createUserMarkerEl();
        userMarkerRef.current = new maplibregl.Marker({
          element: el,
          anchor: "center",
        })
          .setLngLat(center)
          .addTo(map);
        setUserDotEl(el);
        map.flyTo({ center, zoom: 13, duration: 900 });
      })
      .catch(() => {
        /* denied/unavailable states are owned by the Near-me overlay UX */
      });
  };

  const popupDayIdx =
    popupStop?.dayId != null ? (dayIndexById.get(popupStop.dayId) ?? 0) : null;
  const popupMeta = categoryMeta(popupStop?.category);

  return (
    <div className={cn("relative h-full w-full overflow-hidden", className)}>
      {/* NOTE: do not use `absolute inset-0` here, maplibre adds its own
          .maplibregl-map class (position:relative) which overrides Tailwind's
          .absolute (equal specificity, later stylesheet wins) and collapses
          the container to 0 height. h-full w-full fills the relative root. */}
      <div ref={containerRef} className="h-full w-full" />

      {/* pin portals */}
      {geoStops.map(s => {
        const el = markerEls.get(s.id);
        if (!el) return null;
        const dayIdx = s.dayId != null ? (dayIndexById.get(s.dayId) ?? 0) : 0;
        const color = dayColor(dayIdx + 1, isDark);
        const dimmed = activeDayId != null && s.dayId !== activeDayId;
        return createPortal(
          <Pin
            key={`${s.id}-${selectedStopId === s.id}`}
            stop={s}
            number={stopNumbers.get(s.id) ?? 1}
            color={color}
            selected={selectedStopId === s.id}
            dimmed={dimmed}
            popSeed={renumberSeed}
            onClick={() => {
              onSelectStop(s.id);
              setPopupStopId(s.id);
            }}
          />,
          el
        );
      })}

      {/* pulsing user-location dot, portaled into its marker element */}
      {userDotEl ? createPortal(<UserLocationDot />, userDotEl) : null}

      {/* gold home-base hotel pin (star + name tooltip) */}
      {hotelEl
        ? createPortal(
            <div
              title={
                tripData?.trip.hotelName
                  ? `Home base: ${tripData.trip.hotelName}`
                  : "Home base"
              }
              className="flex h-[30px] w-[30px] items-center justify-center rounded-full"
              style={{
                background: "var(--ochre)",
                boxShadow: "0 0 0 2px var(--surface), var(--shadow-md)",
              }}
            >
              <Star
                className="h-4 w-4"
                strokeWidth={1.75}
                fill="currentColor"
                style={{ color: "#FFFFFF" }}
              />
            </div>,
            hotelEl
          )
        : null}

      {/* pin popover (glass, 280px) */}
      {popupStop && popupPos ? (
        <div
          className="pointer-events-none absolute z-20"
          style={{
            left: popupPos.x,
            top: popupPos.y - 22,
            transform: "translate(-50%, -100%)",
          }}
        >
          <motion.div
            initial={{ opacity: 0, y: 8, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            transition={{ type: "spring", stiffness: 260, damping: 26 }}
            className="glass pointer-events-auto w-[280px] rounded-xl border border-border p-3 shadow-lg"
          >
            <div className="flex items-start gap-3">
              {popupStop.image ? (
                <img
                  src={popupStop.image}
                  alt=""
                  className="photo h-12 w-12 rounded-sm object-cover"
                />
              ) : null}
              <div className="min-w-0 flex-1">
                <p className="truncate text-[14px] font-semibold text-ink">
                  {popupStop.name}
                </p>
                <div className="mt-1 flex flex-wrap items-center gap-1.5">
                  <span
                    className="type-caption inline-flex items-center gap-1 rounded-pill px-2 py-0.5 text-white"
                    style={{
                      backgroundColor: dayColor((popupDayIdx ?? 0) + 1, isDark),
                    }}
                  >
                    {popupDayIdx != null
                      ? `${dayLabel(popupDayIdx)} · Stop ${stopNumbers.get(popupStop.id) ?? 1}`
                      : "Unscheduled"}
                  </span>
                  <span className="type-caption inline-flex items-center gap-1 rounded-pill bg-surface-2 px-2 py-0.5 text-ink-2">
                    <popupMeta.icon className="h-3 w-3" strokeWidth={1.75} />
                    {popupMeta.label}
                  </span>
                </div>
              </div>
              <button
                type="button"
                aria-label="Close"
                onClick={() => setPopupStopId(null)}
                className="rounded-sm p-1 text-ink-3 transition-colors duration-fast hover:bg-surface-2 hover:text-ink"
              >
                <X className="h-3.5 w-3.5" strokeWidth={1.75} />
              </button>
            </div>
            <div className="mt-3 flex items-center gap-2">
              <button
                type="button"
                onClick={() => {
                  onOpenInTimeline(popupStop.id);
                  setPopupStopId(null);
                }}
                className="type-small flex h-8 flex-1 items-center justify-center gap-1.5 rounded-md border border-border-strong bg-surface font-semibold text-ink shadow-sm transition-all duration-fast hover:-translate-y-px hover:bg-surface-2"
              >
                <ListOrdered className="h-3.5 w-3.5" strokeWidth={1.75} /> Open
                in timeline
              </button>
              <button
                type="button"
                aria-label="Delete stop"
                onClick={() => {
                  onDeleteStop(popupStop);
                  setPopupStopId(null);
                }}
                className="flex h-8 w-8 items-center justify-center rounded-md text-danger transition-colors duration-fast hover:bg-danger/10"
              >
                <Trash2 className="h-4 w-4" strokeWidth={1.75} />
              </button>
            </div>
          </motion.div>
        </div>
      ) : null}

      {/* map chrome, floating glass stack, top-right (§9). On phones it drops
          below the search box / Near-me row so nothing overlaps or clips. */}
      <div className="absolute right-3 top-3 z-10 flex flex-col gap-0.5 rounded-xl border border-border glass p-1 shadow-md max-lg:top-[104px]">
        <ChromeButton label="Zoom in" onClick={() => mapRef.current?.zoomIn()}>
          <Plus className="h-4 w-4" strokeWidth={1.75} />
        </ChromeButton>
        <ChromeButton
          label="Zoom out"
          onClick={() => mapRef.current?.zoomOut()}
        >
          <Minus className="h-4 w-4" strokeWidth={1.75} />
        </ChromeButton>
        <span className="mx-1 my-0.5 h-px bg-border" aria-hidden />
        <ChromeButton label="Fit all stops" onClick={fitAll}>
          <Maximize2 className="h-4 w-4" strokeWidth={1.75} />
        </ChromeButton>
        <ChromeButton label="My location" onClick={locate}>
          <LocateFixed className="h-4 w-4" strokeWidth={1.75} />
        </ChromeButton>
        <ChromeButton
          label={isDark ? "Paper (light) map" : "Ember (dark) map"}
          onClick={toggleTheme}
        >
          {isDark ? (
            <Sun className="h-4 w-4" strokeWidth={1.75} />
          ) : (
            <Moon className="h-4 w-4" strokeWidth={1.75} />
          )}
        </ChromeButton>
      </div>

      {/* basemap switcher, only when the backend exposes a Google Maps key;
          sits above the attribution control (§9 floating glass chrome) */}
      {googleKey ? (
        <div className="absolute bottom-10 right-3 z-10 flex items-center gap-0.5 rounded-pill border border-border glass p-1 shadow-md">
          {BASEMAP_OPTIONS.map(opt => {
            const active = effectiveBasemap === opt.value;
            return (
              <button
                key={opt.value}
                type="button"
                aria-pressed={active}
                onClick={() => setBasemap(opt.value)}
                className="relative rounded-pill px-2.5 py-1"
              >
                {active ? (
                  <motion.span
                    layoutId="wf-basemap-pill"
                    className="absolute inset-0 rounded-pill bg-surface shadow-sm"
                    transition={{ type: "spring", stiffness: 380, damping: 30 }}
                  />
                ) : null}
                <span
                  className={cn(
                    "type-caption relative font-semibold transition-colors duration-fast",
                    active ? "text-ink" : "text-ink-3 hover:text-ink-2"
                  )}
                >
                  {opt.label}
                </span>
              </button>
            );
          })}
        </div>
      ) : null}

      {/* "Search this area" discovery, attractions anywhere on the planet */}
      {tripIdValid && tripData ? (
        <AreaSearchOverlay
          map={mapInstance}
          tripId={tripId}
          days={days}
          activeDayId={activeDayId}
          destination={tripData.trip.destination}
        />
      ) : null}

      {children}
    </div>
  );
}

function ChromeButton({
  children,
  label,
  onClick,
}: {
  children: React.ReactNode;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      onClick={onClick}
      className="flex h-8 w-8 items-center justify-center rounded-md text-ink-2 transition-colors duration-fast hover:bg-surface-2 hover:text-ink"
    >
      {children}
    </button>
  );
}
