import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router";
import type { inferRouterOutputs } from "@trpc/server";
import type { AppRouter } from "../../api/router";
import { trpc } from "@/providers/trpc";
import { useAuth } from "@/hooks/useAuth";
import { geolocationSupported, haversineMeters } from "@/lib/geolocate";

type TodayStop = inferRouterOutputs<AppRouter>["geo"]["todayStops"][number];

export interface Arrival extends TodayStop {
  /** measured distance to the stop when the arrival fired */
  distanceM: number;
}

/** Prompt when the user is within this many meters of a stop. */
export const ARRIVAL_RADIUS_M = 150;
const REFETCH_INTERVAL_MS = 5 * 60 * 1000;
const SNOOZE_KEY = "wayfare-arrival-snooze"; // localStorage: { [stopId]: isoUntil }
const PROMPTED_KEY = "wayfare-arrival-prompted"; // sessionStorage: stopId[]

// ─── Snooze persistence (localStorage - survives reloads, expires on its own) ─
function readSnoozeMap(): Record<string, string> {
  try {
    const raw = localStorage.getItem(SNOOZE_KEY);
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, string>;
    }
  } catch {
    /* storage unavailable / corrupt */
  }
  return {};
}

function isSnoozed(stopId: number, now = Date.now()): boolean {
  const until = readSnoozeMap()[String(stopId)];
  if (!until) return false;
  const t = Date.parse(until);
  return Number.isFinite(t) && t > now;
}

function writeSnooze(stopId: number, minutes: number) {
  try {
    const map = readSnoozeMap();
    const now = Date.now();
    // prune expired entries while we're writing anyway
    for (const [key, value] of Object.entries(map)) {
      const t = Date.parse(value);
      if (!Number.isFinite(t) || t <= now) delete map[key];
    }
    map[String(stopId)] = new Date(now + minutes * 60_000).toISOString();
    localStorage.setItem(SNOOZE_KEY, JSON.stringify(map));
  } catch {
    /* storage unavailable\u2014 snooze degrades to this mount only */
  }
}

// ─── Session dedupe (sessionStorage - one prompt per stop per tab session) ───
function readPrompted(): Set<number> {
  try {
    const raw = sessionStorage.getItem(PROMPTED_KEY);
    if (!raw) return new Set();
    const parsed: unknown = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      return new Set(parsed.filter((v): v is number => typeof v === "number"));
    }
  } catch {
    /* storage unavailable / corrupt */
  }
  return new Set();
}

function persistPrompted(set: Set<number>) {
  try {
    sessionStorage.setItem(PROMPTED_KEY, JSON.stringify([...set]));
  } catch {
    /* storage unavailable\u2014 dedupe degrades to this mount only */
  }
}

export interface ArrivalWatch {
  arrival: Arrival | null;
  /** "Add expense" - consume the prompt and deep-link to the trip's expenses. */
  logExpense: () => void;
  /** "Snooze 30m" - hide for `minutes`, then this stop may prompt again. */
  snooze: (minutes?: number) => void;
  /** "Not now" - dismiss for the rest of this session. */
  dismiss: () => void;
}

/**
 * Arrival watcher: polls geo.todayStops (5 min) and, only while there ARE
 * stops today, runs a geolocation watch. When the user gets within
 * ARRIVAL_RADIUS_M of an un-prompted, un-snoozed stop, it fires one arrival
 * prompt. Works for guests too - any authenticated session with trips.
 */
export function useArrivalWatch(): ArrivalWatch {
  const { isAuthenticated } = useAuth();
  const navigate = useNavigate();

  const [arrival, setArrival] = useState<Arrival | null>(null);
  const arrivalRef = useRef<Arrival | null>(null);
  useEffect(() => {
    arrivalRef.current = arrival;
  }, [arrival]);
  // Stable session-scoped dedupe set (mutated in place; never rendered).
  const [promptedSet] = useState<Set<number>>(() => readPrompted());

  const todayStops = trpc.geo.todayStops.useQuery(undefined, {
    enabled: isAuthenticated,
    refetchInterval: REFETCH_INTERVAL_MS,
    staleTime: 60_000,
    retry: false,
  });
  const stops = useMemo(() => todayStops.data ?? [], [todayStops.data]);
  const stopsRef = useRef<TodayStop[]>(stops);
  useEffect(() => {
    stopsRef.current = stops;
  }, [stops]);

  const markPrompted = useCallback(
    (stopId: number) => {
      promptedSet.add(stopId);
      persistPrompted(promptedSet);
    },
    [promptedSet],
  );

  /* ── position watch - only while there are stops scheduled today ── */
  useEffect(() => {
    if (!isAuthenticated || stops.length === 0) return;
    if (!geolocationSupported()) return;

    const onFix = (pos: GeolocationPosition) => {
      if (arrivalRef.current) return; // one prompt at a time
      const { latitude, longitude } = pos.coords;
      let best: { stop: TodayStop; distanceM: number } | null = null;
      for (const stop of stopsRef.current) {
        if (promptedSet.has(stop.stopId)) continue;
        if (isSnoozed(stop.stopId)) continue;
        const distanceM = haversineMeters(latitude, longitude, stop.lat, stop.lng);
        if (distanceM <= ARRIVAL_RADIUS_M && (best === null || distanceM < best.distanceM)) {
          best = { stop, distanceM };
        }
      }
      if (best !== null) {
        const { stop, distanceM } = best;
        markPrompted(stop.stopId); // fire once per session (snooze re-arms it)
        setArrival({ ...stop, distanceM: Math.round(distanceM) });
      }
    };

    const watchId = navigator.geolocation.watchPosition(onFix, undefined, {
      maximumAge: 60_000,
      timeout: 20_000,
      enableHighAccuracy: false,
    });
    return () => navigator.geolocation.clearWatch(watchId);
  }, [isAuthenticated, stops.length, promptedSet, markPrompted]);

  const dismiss = useCallback(() => setArrival(null), []);

  const snooze = useCallback(
    (minutes = 30) => {
      const current = arrivalRef.current;
      if (!current) return;
      writeSnooze(current.stopId, minutes);
      // Re-arm: once the snooze expires the stop may prompt again this session.
      if (promptedSet.delete(current.stopId)) persistPrompted(promptedSet);
      setArrival(null);
    },
    [promptedSet],
  );

  const logExpense = useCallback(() => {
    const current = arrivalRef.current;
    if (!current) return;
    setArrival(null);
    navigate(`/trips/${current.tripId}/expenses`);
  }, [navigate]);

  return { arrival, logExpense, snooze, dismiss };
}
