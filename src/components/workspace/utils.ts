import type { inferRouterOutputs } from "@trpc/server";
import type { AppRouter } from "../../../api/router";
import {
  Utensils,
  BedDouble,
  TrainFront,
  Ticket,
  ShoppingBag,
  CircleDot,
  type LucideIcon,
} from "lucide-react";

/** Full payload of trpc.trips.get */
export type TripData = inferRouterOutputs<AppRouter>["trips"]["get"];
export type WsTrip = TripData["trip"];
export type WsMember = TripData["members"][number];
export type WsDay = TripData["days"][number];
export type WsStop = TripData["stops"][number];
export type WsReservation = TripData["reservations"][number];
export type WsChecklistItem = TripData["checklist"][number];

/* ── Stop categories (design.md §6 + §3.2 colors) ─────────────────────────── */

export type StopCategory =
  "food" | "lodging" | "transport" | "activity" | "shopping" | "other";

export const STOP_CATEGORY_META: Record<
  StopCategory,
  { label: string; icon: LucideIcon; color: string }
> = {
  food: { label: "Food", icon: Utensils, color: "#C97F45" },
  lodging: { label: "Lodging", icon: BedDouble, color: "#7C8DA6" },
  transport: { label: "Transport", icon: TrainFront, color: "#6E9A8B" },
  activity: { label: "Activity", icon: Ticket, color: "#A86B8C" },
  shopping: { label: "Shopping", icon: ShoppingBag, color: "#C9A63C" },
  other: { label: "Other", icon: CircleDot, color: "#8A8175" },
};

export function categoryMeta(category: string | null | undefined) {
  return (
    STOP_CATEGORY_META[(category as StopCategory) ?? "activity"] ??
    STOP_CATEGORY_META.activity
  );
}

/** Editorial place photo per category (assets manifest §14). */
export function imageForCategory(category: string | null | undefined): string {
  switch (category) {
    case "food":
      return "/place-ramen.jpg";
    case "lodging":
      return "/place-onsen.jpg";
    case "transport":
      return "/place-hike.jpg";
    case "shopping":
      return "/place-market.jpg";
    case "other":
      return "/place-cafe.jpg";
    case "activity":
    default:
      return "/place-temple.jpg";
  }
}

/* ── Geo / formatting helpers ─────────────────────────────────────────────── */

export function haversineKm(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number
): number {
  const R = 6371;
  const toRad = (v: number) => (v * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

export function formatKm(km: number): string {
  return km < 1 ? `${Math.round(km * 1000)} m` : `${km.toFixed(1)} km`;
}

export function formatMinutes(min: number): string {
  if (min < 60) return `${Math.max(1, Math.round(min))} min`;
  const h = Math.floor(min / 60);
  const m = Math.round(min % 60);
  return m ? `~${h}h ${m}m` : `~${h}h`;
}

export function formatDuration(min: number | null | undefined): string | null {
  if (min == null) return null;
  if (min < 60) return `${min}m`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m ? `${h}h ${m}m` : `${h}h`;
}

/** Travel modes for connectors (§1.3) - mode math mirrors api/trip-router.ts. */
export const TRAVEL_MODES = [
  { key: "walking", label: "Walk", speedKmh: 5 },
  { key: "transit", label: "Transit", speedKmh: 24 },
  { key: "driving", label: "Drive", speedKmh: 42 },
  { key: "train", label: "Train", speedKmh: 90 },
] as const;
export type TravelMode = (typeof TRAVEL_MODES)[number]["key"];

/** Server-side day modes (trip_days.transportMode) → connector modes. */
export type DayTransportMode = "walk" | "car" | "transit" | "train";

export function travelModeForDayMode(mode: string | null | undefined): TravelMode {
  switch (mode) {
    case "walk":
      return "walking";
    case "car":
      return "driving";
    case "transit":
      return "transit";
    case "train":
      return "train";
    default:
      return "driving";
  }
}

// Mode math mirrors the server (haversine km here, OSRM durations server-side):
// transit = drive × 1.35 + 8 min/leg; legs ≥ 40 km behave like rail.
// train = ~90 km/h + 15 min/leg station overhead; legs < 15 km use transit math.
const TRANSIT_SLOWDOWN = 1.35;
const TRANSIT_OVERHEAD_MIN = 8;
const TRAIN_SPEED_KMH = 90;
const TRAIN_OVERHEAD_MIN = 15;
const RAIL_MIN_KM = 40;
const TRAIN_MIN_KM = 15;

function railMinutes(km: number): number {
  return (km / TRAIN_SPEED_KMH) * 60 + TRAIN_OVERHEAD_MIN;
}

function transitMinutes(km: number): number {
  if (km >= RAIL_MIN_KM) return railMinutes(km);
  const driveMin = (km / 42) * 60;
  return driveMin * TRANSIT_SLOWDOWN + TRANSIT_OVERHEAD_MIN;
}

export function travelEstimate(
  mode: TravelMode,
  km: number
): { minutes: number; km: number } {
  switch (mode) {
    case "transit":
      return { minutes: transitMinutes(km), km };
    case "train":
      return { minutes: km < TRAIN_MIN_KM ? transitMinutes(km) : railMinutes(km), km };
    default: {
      const m = TRAVEL_MODES.find(t => t.key === mode) ?? TRAVEL_MODES[0];
      return { minutes: (km / m.speedKmh) * 60, km };
    }
  }
}

/** Total route distance for an ordered stop list (skips stops without coords). */
export function routeKm(stops: WsStop[]): number {
  const pts = stops.filter(s => s.lat != null && s.lng != null);
  let d = 0;
  for (let i = 1; i < pts.length; i++) {
    d += haversineKm(
      pts[i - 1].lat!,
      pts[i - 1].lng!,
      pts[i].lat!,
      pts[i].lng!
    );
  }
  return d;
}

/** Total wall-clock span estimate for a day: durations + travel legs. */
export function daySpanMinutes(stops: WsStop[], mode: TravelMode = "walking"): number {
  let total = 0;
  let prev: WsStop | null = null;
  for (const s of stops) {
    total += s.durationMin ?? 60;
    if (prev && prev.lat != null && s.lat != null) {
      total += travelEstimate(
        mode,
        haversineKm(prev.lat!, prev.lng!, s.lat!, s.lng!)
      ).minutes;
    }
    prev = s;
  }
  return total;
}

/** "Day 2 · Fri 4" helpers */
export function dayLabel(index: number): string {
  return `Day ${index + 1}`;
}

export function shortDate(dateStr: string): string {
  const d = new Date(`${dateStr}T00:00:00`);
  return d.toLocaleDateString(undefined, { weekday: "short", day: "numeric" });
}

export function fullDateRange(start: string, end: string): string {
  const s = new Date(`${start}T00:00:00`);
  const e = new Date(`${end}T00:00:00`);
  const sameMonth =
    s.getMonth() === e.getMonth() && s.getFullYear() === e.getFullYear();
  const opts: Intl.DateTimeFormatOptions = { month: "short", day: "numeric" };
  const sStr = s.toLocaleDateString(undefined, opts);
  const eStr = e.toLocaleDateString(
    undefined,
    sameMonth ? { day: "numeric" } : opts
  );
  return `${sStr} – ${eStr}, ${e.getFullYear()}`;
}

export function isUpgradeRequired(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    "message" in err &&
    String((err as { message?: unknown }).message).includes("UPGRADE_REQUIRED")
  );
}
