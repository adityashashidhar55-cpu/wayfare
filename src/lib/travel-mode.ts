/**
 * travel-mode.ts (r24-smart, feature N) - pure logic for the in-trip
 * "travel mode": behind-schedule detection and mood/health check-in
 * suggestions. No I/O; fully tested. Geolocation watching and the actual
 * reroute mutation live in the workspace UI; this file is the brain.
 */

import { haversineMeters } from "./geolocate";

export interface PlannedStop {
  id: number;
  name: string;
  category: string;
  /** HH:MM or null */
  startTime: string | null;
  durationMin: number | null;
  lat?: number | null;
  lng?: number | null;
}

/** Planned end in minutes-since-midnight; null when unplanned. */
export function plannedEndMinutes(stop: PlannedStop): number | null {
  if (!stop.startTime) return null;
  const [h, m] = stop.startTime.split(":").map(Number);
  if (!Number.isFinite(h) || !Number.isFinite(m)) return null;
  return h * 60 + m + (stop.durationMin ?? 60);
}

export const LATE_GRACE_MIN = 30;
export const FAR_FROM_NEXT_M = 500;

export interface BehindResult {
  behind: boolean;
  /** the stop whose planned end has passed */
  lateStop: PlannedStop | null;
  /** the next stop the traveler should be heading to */
  nextStop: PlannedStop | null;
  minutesLate: number;
  distanceToNextM: number | null;
}

/**
 * "Running late" detection: the current stop's planned end passed more than
 * LATE_GRACE_MIN ago AND the traveler is still more than FAR_FROM_NEXT_M from
 * the next stop. Timezone-safe: callers pass minutes-since-midnight local.
 */
export function detectBehind(
  stopsToday: PlannedStop[],
  nowMinutes: number,
  position: { lat: number; lng: number } | null,
): BehindResult {
  const none: BehindResult = { behind: false, lateStop: null, nextStop: null, minutesLate: 0, distanceToNextM: null };
  const timed = stopsToday
    .map((s, i) => ({ s, i, end: plannedEndMinutes(s) }))
    .filter((x): x is { s: PlannedStop; i: number; end: number } => x.end != null);

  for (const { s, i, end } of timed) {
    if (nowMinutes <= end + LATE_GRACE_MIN) continue;
    const next = stopsToday.slice(i + 1).find((x) => x.lat != null && x.lng != null) ?? null;
    if (!next) continue;
    const dist = position
      ? haversineMeters(position.lat, position.lng, next.lat!, next.lng!)
      : null;
    // Without a position we cannot confirm the traveler is away from the next
    // stop, so we stay quiet (no false alarms when location is denied).
    if (dist == null || dist <= FAR_FROM_NEXT_M) continue;
    return { behind: true, lateStop: s, nextStop: next, minutesLate: nowMinutes - end, distanceToNextM: Math.round(dist) };
  }
  return none;
}

// ─── Mood / health check-in ─────────────────────────────────────────────────

export type Energy = "low" | "normal" | "high";
export type CheckInTag = "tired" | "hungry" | "unwell" | "fine";

export interface CheckInInput {
  energy: Energy;
  tags: CheckInTag[];
}

export interface CheckInContext {
  /** stops still ahead today, in order */
  remaining: PlannedStop[];
  /** nearest cafe/food place name (any source), when known */
  nearestCafe?: string | null;
  /** nearest famous eatery name (famous-eats corpus), when known */
  nearestFamousEatery?: string | null;
}

export type SuggestionKind = "drop_stops" | "rest" | "eat" | "care" | "keep_going";

export interface TravelSuggestion {
  kind: SuggestionKind;
  /** ids the suggestion acts on (e.g. stops to drop) */
  stopIds: number[];
  text: string;
}

/**
 * Adapt the rest of the day to how the traveler feels. Ordering encodes
 * priority: unwell first, then rest/food, then pacing.
 */
export function suggestForCheckIn(input: CheckInInput, ctx: CheckInContext): TravelSuggestion[] {
  const out: TravelSuggestion[] = [];
  const tags = new Set(input.tags);
  const remaining = ctx.remaining;

  if (tags.has("unwell")) {
    out.push({
      kind: "care",
      stopIds: remaining.map((s) => s.id),
      text: "Take care first. Consider pausing the plan for today; your stops will still be here tomorrow. Pharmacies and clinics are marked on the map.",
    });
  }

  if (input.energy === "low" || tags.has("tired")) {
    if (remaining.length > 2) {
      out.push({
        kind: "drop_stops",
        stopIds: remaining.slice(2).map((s) => s.id),
        text: `Low energy: keep the next two stops and drop ${remaining.length - 2} later one${remaining.length - 2 === 1 ? "" : "s"}, you can always re-add them.`,
      });
    }
    out.push({
      kind: "rest",
      stopIds: [],
      text: ctx.nearestCafe
        ? `Rest stop: ${ctx.nearestCafe} is the nearest cafe, grab a seat and recharge.`
        : "Find a nearby cafe or park bench and take 20 minutes, the plan can wait.",
    });
  }

  if (tags.has("hungry")) {
    out.push({
      kind: "eat",
      stopIds: [],
      text: ctx.nearestFamousEatery
        ? `Hungry? ${ctx.nearestFamousEatery} is a famous local pick nearby.`
        : ctx.nearestCafe
          ? `Hungry? ${ctx.nearestCafe} is close by.`
          : "Hungry? Check the map for food near you, the area's famous eats are starred.",
    });
  }

  if (out.length === 0) {
    out.push(
      input.energy === "high"
        ? {
            kind: "keep_going",
            stopIds: [],
            text: "Great energy, the rest of the day is yours. Want to add a spontaneous stop nearby?",
          }
        : {
            kind: "keep_going",
            stopIds: [],
            text: "Sounds like a good day, enjoy the next stop.",
          },
    );
  }

  return out;
}
