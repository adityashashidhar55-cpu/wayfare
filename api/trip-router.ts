import { and, asc, eq, inArray, like, ne, or } from "drizzle-orm";
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import * as schema from "@db/schema";
import { getDb } from "./queries/connection";
import { authedQuery, createRouter } from "./middleware";
import { getTier } from "./queries/subscriptions";
import { findUserByEmail } from "./queries/users";
import { geocodeCity, searchPhoton } from "./queries/overpass";
import { isGenericName, isParkingLikeName } from "./lib/place-quality";
import { profileStyles } from "./lib/style-map";
import { guessTimeZone, resolveTz, todayIn } from "./lib/tz";
import { notify } from "./lib/notify";
import { appUrl, sendTripInvite } from "./lib/mailer";
import { convertCents } from "@contracts/fx";
import { getRates } from "./lib/fx-refresh";
import { TIERS } from "@contracts/premium";
import { isKidRecharge, kidClass, kidScore } from "@contracts/kids";
import {
  DIET_UNVERIFIED_NOTE,
  dietClass,
  dietConfirmed,
  dietFit,
  isMeatOnly,
  isVegDiet,
  parseDietary,
} from "@contracts/diet";
import type { Dietary } from "@contracts/diet";

const PRESENCE_COLORS = ["#BC5934", "#44604F", "#6E7FA3", "#A86B8C", "#B98A2E", "#6E9A8B"];

/**
 * "12-19 Mar 2027" for an invite subject line. Pure string formatting on the
 * stored YYYY-MM-DD values, so no timezone is involved and nothing can shift
 * the dates the way a Date round-trip would.
 */
function formatTripDates(startDate: string, endDate: string): string | null {
  const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const parse = (s: string) => {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
    if (!m) return null;
    return { y: m[1]!, mo: Number(m[2]) - 1, d: Number(m[3]) };
  };
  const a = parse(startDate);
  const b = parse(endDate);
  if (!a || !b || !MONTHS[a.mo] || !MONTHS[b.mo]) return null;
  if (a.y === b.y && a.mo === b.mo) return `${a.d}-${b.d} ${MONTHS[a.mo]} ${a.y}`;
  if (a.y === b.y) return `${a.d} ${MONTHS[a.mo]} - ${b.d} ${MONTHS[b.mo]} ${a.y}`;
  return `${a.d} ${MONTHS[a.mo]} ${a.y} - ${b.d} ${MONTHS[b.mo]} ${b.y}`;
}

export async function requireMembership(tripId: number, userId: number) {
  const db = getDb();
  const rows = await db
    .select()
    .from(schema.tripMembers)
    .where(
      and(
        eq(schema.tripMembers.tripId, tripId),
        eq(schema.tripMembers.userId, userId),
      ),
    )
    .limit(1);
  if (!rows[0]) {
    throw new TRPCError({ code: "FORBIDDEN", message: "Not a member of this trip" });
  }
  return rows[0];
}

async function requireOwner(tripId: number, userId: number) {
  const member = await requireMembership(tripId, userId);
  if (member.role !== "owner") {
    throw new TRPCError({ code: "FORBIDDEN", message: "Owner only" });
  }
  return member;
}

/**
 * Caller-supplied day ids must belong to the trip the caller is authorized for.
 * Without this a client can point a stop at another trip's day (auto-increment
 * ids are enumerable), corrupting the stop -> day relationship.
 */
async function assertDayInTrip(dayId: number, tripId: number) {
  const [day] = await getDb()
    .select({ id: schema.tripDays.id })
    .from(schema.tripDays)
    .where(and(eq(schema.tripDays.id, dayId), eq(schema.tripDays.tripId, tripId)))
    .limit(1);
  if (!day) throw new TRPCError({ code: "NOT_FOUND", message: "Day not found on this trip" });
}

/** Membership + write access - viewers are read-only members. */
export async function requireEditor(tripId: number, userId: number) {
  const member = await requireMembership(tripId, userId);
  if (member.role === "viewer") {
    throw new TRPCError({ code: "FORBIDDEN", message: "Viewers cannot edit this trip" });
  }
  return member;
}

// Exported for the social-import router (multi-day stop chunking).
export function dateRange(start: string, end: string): string[] {
  const out: string[] = [];
  const d = new Date(start + "T00:00:00Z");
  const last = new Date(end + "T00:00:00Z");
  let i = 0;
  while (d <= last && i < 60) {
    out.push(d.toISOString().slice(0, 10));
    d.setUTCDate(d.getUTCDate() + 1);
    i++;
  }
  return out;
}

// ─── Route optimization (nearest neighbor + 2-opt over haversine) ───────────
// Exported for the social-import router (api/social-router.ts) and its tests.
export function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number) {
  const R = 6371;
  const toRad = (v: number) => (v * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

type Pt = { id: number; lat: number; lng: number };

// ─── OSRM (open routing) - real road-network durations, haversine fallback ──
async function osrmTable(
  points: { lat: number; lng: number }[],
  profile: "driving" | "foot" | "bike",
  annotations: "duration" | "duration,distance",
): Promise<{ durations: number[][] | null; distances: number[][] | null } | null> {
  try {
    const coords = points.map((p) => `${p.lng},${p.lat}`).join(";");
    const url = `https://router.project-osrm.org/table/v1/${profile}/${coords}?annotations=${annotations}`;
    const resp = await fetch(url, {
      headers: { "user-agent": "wayfare/1.0" },
      signal: AbortSignal.timeout(4500),
    });
    const data = (await resp.json()) as {
      code?: string;
      durations?: number[][];
      distances?: number[][];
    };
    if (data.code === "Ok") {
      return { durations: data.durations ?? null, distances: data.distances ?? null };
    }
  } catch {
    // offline / rate-limited - caller falls back to haversine
  }
  return null;
}

async function osrmDurationMatrix(
  points: { lat: number; lng: number }[],
  profile: "driving" | "foot" | "bike",
): Promise<number[][] | null> {
  return (await osrmTable(points, profile, "duration"))?.durations ?? null;
}

function matrixCost(matrix: number[][] | null, a: Pt, b: Pt, i: number, j: number): number {
  if (matrix) {
    const c = matrix[i]?.[j];
    if (typeof c === "number" && isFinite(c)) return c; // seconds
  }
  return haversineKm(a.lat, a.lng, b.lat, b.lng) * 1000; // meters-ish scale
}

/** NN + 2-opt on a cost matrix (keeps the first stop anchored). Exported for social-import. */
export function optimizeWithMatrix(points: Pt[], matrix: number[][] | null): Pt[] {
  if (points.length <= 2) return points;
  const remaining = points.map((p, i) => ({ p, i })).slice(1);
  const order: { p: Pt; i: number }[] = [{ p: points[0], i: 0 }];
  while (remaining.length) {
    const last = order[order.length - 1];
    let best = 0;
    let bestC = Infinity;
    for (let k = 0; k < remaining.length; k++) {
      const c = matrixCost(matrix, last.p, remaining[k].p, last.i, remaining[k].i);
      if (c < bestC) {
        bestC = c;
        best = k;
      }
    }
    order.push(remaining.splice(best, 1)[0]);
  }
  const cost = (ord: { p: Pt; i: number }[]) => {
    let s = 0;
    for (let k = 1; k < ord.length; k++) s += matrixCost(matrix, ord[k - 1].p, ord[k].p, ord[k - 1].i, ord[k].i);
    return s;
  };
  let improved = true;
  let guard = 0;
  while (improved && guard < 40) {
    improved = false;
    guard++;
    for (let i = 1; i < order.length - 1; i++) {
      for (let j = i + 1; j < order.length; j++) {
        const candidate = [...order.slice(0, i), ...order.slice(i, j + 1).reverse(), ...order.slice(j + 1)];
        if (cost(candidate) < cost(order) - 1e-6) {
          order.splice(0, order.length, ...candidate);
          improved = true;
        }
      }
    }
  }
  return order.map((o) => o.p);
}

function routeDistance(order: Pt[]): number {
  let d = 0;
  for (let i = 1; i < order.length; i++) {
    d += haversineKm(order[i - 1].lat, order[i - 1].lng, order[i].lat, order[i].lng);
  }
  return d;
}

// ─── Transport modes - per-day mode drives leg time/distance estimates ──────
export type TransportMode = "walk" | "car" | "transit" | "train";
export const TRANSPORT_MODES: TransportMode[] = ["walk", "car", "transit", "train"];

// Mode math (mirrored client-side in src/components/workspace/utils.ts):
//   walk    → OSRM foot-network distance at 5 km/h (the public OSRM demo
//             server aliases the foot profile to car durations, so walking
//             time is derived from distance, not the foot duration matrix)
//   car     → OSRM driving durations         (fallback: 42 km/h)
//   transit → driving time × 1.35 + 8 min/leg overhead (walking + waiting);
//             legs ≥ 40 km behave like rail instead
//   train   → driving distance at ~90 km/h + 15 min/leg station overhead;
//             legs < 15 km fall back to transit math (no 2 km train hops)
const WALK_SPEED_KMH = 5;
const TRANSIT_SLOWDOWN = 1.35;
const TRANSIT_OVERHEAD_MIN = 8;
const TRAIN_SPEED_KMH = 90;
const TRAIN_OVERHEAD_MIN = 15;
const RAIL_MIN_KM = 40; // transit legs this long switch to rail math
const TRAIN_MIN_KM = 15; // train legs shorter than this use transit math
// Haversine fallbacks when OSRM is unreachable (client uses the same speeds).
const FALLBACK_SPEED_KMH: Record<TransportMode, number> = { walk: WALK_SPEED_KMH, car: 42, transit: 24, train: TRAIN_SPEED_KMH };

/** OSRM profile used to build the TSP/leg matrix for a day's mode. */
function osrmProfileForMode(mode: TransportMode): "driving" | "foot" {
  return mode === "walk" ? "foot" : "driving";
}

function railMinutes(km: number): number {
  return (km / TRAIN_SPEED_KMH) * 60 + TRAIN_OVERHEAD_MIN;
}

function transitMinutes(driveMin: number, km: number): number {
  if (km >= RAIL_MIN_KM) return railMinutes(km);
  return driveMin * TRANSIT_SLOWDOWN + TRANSIT_OVERHEAD_MIN;
}

/**
 * Per-leg minutes for a mode, given the OSRM driving seconds (null when OSRM
 * failed or the profile carries no useful durations) and the leg distance in
 * km (road/walk-network distance when the OSRM distance matrix is available,
 * else haversine).
 */
export function legMinutesForMode(mode: TransportMode, driveSec: number | null, km: number): number {
  const driveMin = driveSec != null ? driveSec / 60 : (km / FALLBACK_SPEED_KMH.car) * 60;
  switch (mode) {
    case "walk":
      return (km / WALK_SPEED_KMH) * 60;
    case "car":
      return driveMin;
    case "transit":
      return transitMinutes(driveMin, km);
    case "train":
      return km < TRAIN_MIN_KM ? transitMinutes(driveMin, km) : railMinutes(km);
  }
}

export type DayLeg = { fromId: number; toId: number; minutes: number; km: number };

/**
 * Recompute the travel legs between consecutive (position-ordered) stops of a
 * day under the given transport mode. One OSRM table call per day (duration +
 * distance annotations on the mode's profile); haversine/speed fallback when
 * OSRM is unreachable. Pairs missing coordinates are skipped.
 */
async function computeDayLegs(
  stops: { id: number; lat: number | null; lng: number | null }[],
  mode: TransportMode,
): Promise<DayLeg[]> {
  const geo = stops.filter((s): s is { id: number; lat: number; lng: number } => s.lat != null && s.lng != null);
  if (geo.length < 2) return [];
  const table = await osrmTable(geo, osrmProfileForMode(mode), "duration,distance");
  const idxOf = new Map(geo.map((s, i) => [s.id, i]));
  const legs: DayLeg[] = [];
  for (let k = 1; k < stops.length; k++) {
    const a = stops[k - 1];
    const b = stops[k];
    if (a.lat == null || a.lng == null || b.lat == null || b.lng == null) continue;
    const i = idxOf.get(a.id)!;
    const j = idxOf.get(b.id)!;
    const sec = table?.durations?.[i]?.[j];
    const distM = table?.distances?.[i]?.[j];
    const osrmSec = typeof sec === "number" && isFinite(sec) ? sec : null;
    const km =
      typeof distM === "number" && isFinite(distM) && distM > 0
        ? distM / 1000
        : haversineKm(a.lat, a.lng, b.lat, b.lng);
    const minutes = Math.max(1, Math.round(legMinutesForMode(mode, osrmSec, km)));
    legs.push({ fromId: a.id, toId: b.id, minutes, km: Math.round(km * 10) / 10 });
  }
  return legs;
}

/** Position-ordered stops of one day (shared by optimize + mode switching). */
async function dayStopsOrdered(tripId: number, dayId: number) {
  const rows = await getDb()
    .select()
    .from(schema.stops)
    .where(eq(schema.stops.tripId, tripId))
    .orderBy(asc(schema.stops.position));
  return rows.filter((s) => s.dayId === dayId);
}

async function dayTransportMode(tripId: number, dayId: number): Promise<TransportMode> {
  const [day] = await getDb()
    .select()
    .from(schema.tripDays)
    .where(and(eq(schema.tripDays.id, dayId), eq(schema.tripDays.tripId, tripId)))
    .limit(1);
  const mode = day?.transportMode;
  return TRANSPORT_MODES.includes(mode as TransportMode) ? (mode as TransportMode) : "car";
}

// ─── AI generator shared machinery (generateItinerary + generateDay) ────────
type PlaceRow = typeof schema.explorePlaces.$inferSelect;
type BudgetBand = "shoestring" | "mid" | "comfort" | "luxury";

const SLOT_TIMES = ["09:00", "12:30", "15:00", "19:00", "21:15"];
const SLOT_DURATIONS = [150, 90, 120, 100, 90];
/* User-set 6–8 stops/day (stopsPerDay override) need a denser, still
   chronological schedule; the classic five slots stay untouched for
   pace-derived days. */
const DENSE_SLOT_TIMES = ["08:30", "10:15", "12:00", "13:45", "15:30", "17:15", "19:00", "20:45"];
const DENSE_SLOT_DURATIONS = [90, 90, 75, 75, 90, 90, 100, 90];
/* Family pace (withChildren): shorter, earlier days - nothing starts after
   18:30, dinner lands 17:30–18:00, and durations shrink (museum attention
   spans). Max 4 stops/day regardless of pace. */
const KID_SLOT_TIMES = ["09:00", "12:00", "15:00", "17:30"];
const KID_SLOT_DURATIONS = [120, 90, 75, 90];
const KID_MAX_SLOTS = 4;
const BUDGET_CAPS: Record<BudgetBand, number> = { shoestring: 1, mid: 2, comfort: 3, luxury: 4 };
/* r15-eats fame boost in the meal-pick scorer: ~2 km of distance penalty /
   a mid diet tiebreak - nudges famous eateries ahead, never overrides diet. */
const FAMOUS_EATERY_BOOST = 20;

/** Slot → clock time/duration for a day with `slots` planned stops. */
// Exported for the social-import router (stop time/duration assignment).
export function slotSchedule(slots: number, kids = false): { times: string[]; durations: number[] } {
  if (kids) return { times: KID_SLOT_TIMES, durations: KID_SLOT_DURATIONS };
  return slots <= SLOT_TIMES.length
    ? { times: SLOT_TIMES, durations: SLOT_DURATIONS }
    : { times: DENSE_SLOT_TIMES, durations: DENSE_SLOT_DURATIONS };
}

/** Family trips: drop kid-avoid places (bars/nightlife/adult) from the pool. */
function kidFilterPool(candidates: PlaceRow[]): PlaceRow[] {
  return candidates.filter((p) => kidClass(p) !== "kid-avoid");
}

/** Museums get 1h on family days (vs the generic slot duration). */
const isMuseumPlace = (p: PlaceRow) =>
  (p.tags ?? []).includes("museum") || /museum|gallery/i.test(p.name);

/** Food-ish categories - excluded when the user asks for sights only. */
const FOOD_CATEGORIES = new Set(["food", "restaurant", "cafe", "bar"]);
const isFoodCategory = (cat: string) => FOOD_CATEGORIES.has(cat.toLowerCase());

/**
 * r15-places: a MEAL slot pick must be an actual eatery. The category filter
 * alone let misfiled produce/wholesale markets (category food, market tag,
 * no food tag) into lunch/dinner slots; those are shopping, not meals. This
 * guards corpora not yet repaired by db/fix-classification.ts.
 */
const isMealPlace = (p: PlaceRow) => {
  if (!isFoodCategory(p.category)) return false;
  if (isParkingLikeName(p.name)) return false;
  const tags = (p.tags ?? []).map((t) => t.toLowerCase());
  if (tags.includes("market") && !tags.includes("food")) return false;
  return true;
};

const tag0 = (p: PlaceRow) => (p.tags ?? [])[0] ?? p.category;

/** Below this, a destination is too thin to plan from and we import live. */
const MIN_CANDIDATES_FOR_PLAN = 12;

/**
 * Recommendation corpus for a destination (city or country match).
 *
 * r26: `autoImport` closes the biggest hole in the product. The corpus is
 * populated only by hand-run seed scripts in db/, so on any fresh deployment
 * this returned [] for every destination on earth, and generateItinerary threw
 * DESTINATION_UNKNOWN every single time. The app already knows how to import a
 * city live from OSM/Overpass (that is exactly what CityBuilder and
 * explore.discover do, free and keyless) - the planner just never called it.
 * Now a thin destination imports itself on first use and the second query
 * finds real places.
 */
async function fetchDestinationCandidates(dest: string, autoImport = false): Promise<PlaceRow[]> {
  let rows = await queryDestinationRows(dest);

  if (autoImport && rows.length < MIN_CANDIDATES_FOR_PLAN) {
    try {
      const { importCityPlaces } = await import("./queries/overpass");
      await importCityPlaces(dest);
      rows = await queryDestinationRows(dest);
    } catch (e) {
      // Overpass down, unknown city, rate limited: fall through with whatever
      // we already had. The caller still reports DESTINATION_UNKNOWN, so the
      // user sees a real message instead of a 500.
      console.warn(`[plan] live import failed for ${dest}:`, e instanceof Error ? e.message : e);
    }
  }
  return scopeAndClean(rows);
}

async function queryDestinationRows(dest: string): Promise<PlaceRow[]> {
  return getDb()
    .select()
    .from(schema.explorePlaces)
    .where(
      or(
        like(schema.explorePlaces.city, `%${dest}%`),
        like(schema.explorePlaces.country, `%${dest}%`),
      ),
    );
}

function scopeAndClean(rows: PlaceRow[]): PlaceRow[] {
  // Same-name cities abroad: "Goa" matches both Goa, India and Goa,
  // Philippines corpus rows. Keep the plurality country's rows so a
  // single-city plan never mixes places from two countries.
  let scoped = rows;
  if (rows.length > 0) {
    const byCountry = new Map<string, number>();
    for (const r of rows) byCountry.set(r.country, (byCountry.get(r.country) ?? 0) + 1);
    if (byCountry.size > 1) {
      const top = [...byCountry.entries()].sort((a, b) => b[1] - a[1])[0]![0];
      scoped = rows.filter((r) => r.country === top);
    }
  }
  // r11: generated itineraries honor the same quality bar as suggestion
  // surfaces - no OSM placeholder names ("Park", "Central Market") and no
  // places the community reported permanently closed.
  return scoped.filter(
    (r) =>
      !isGenericName(r.name) &&
      !isParkingLikeName(r.name) && // r15-places: no parking/rest-area stops
      r.closedStatus !== "permanently_closed",
  );
}

/**
 * Budget honoring: cap the candidate pool by priceLevel. If the cap leaves
 * too few candidates, relax one band up (those places are marked and ranked
 * BELOW all affordable ones, so they only surface once the affordable pool
 * is exhausted).
 */
function budgetCapPool(candidates: PlaceRow[], budgetBand?: BudgetBand) {
  let pool = candidates;
  const relaxedIds = new Set<number>();
  if (budgetBand) {
    const cap = BUDGET_CAPS[budgetBand];
    const level = (p: PlaceRow) => p.priceLevel ?? 2;
    const affordable = candidates.filter((p) => level(p) <= cap);
    if (affordable.length >= 4) {
      pool = affordable;
    } else {
      const relaxed = candidates.filter((p) => level(p) <= cap + 1);
      pool = relaxed.length >= 4 ? relaxed : affordable.concat(relaxed.filter((p) => level(p) > cap));
      for (const p of pool) if (level(p) > cap) relaxedIds.add(p.id);
    }
  }
  return { pool, relaxedIds };
}

/** Personalize ranking: style overlap + rating + hidden-gem/free-gem bonuses.
 *  Family trips add a strong kidScore boost so kid-friendly places lead. */
function rankPlaces(
  pool: PlaceRow[],
  userStyles: Set<string>,
  budgetBand: BudgetBand | undefined,
  relaxedIds: Set<number>,
  kids = false,
): PlaceRow[] {
  const freeGemBonus = budgetBand === "shoestring" || budgetBand === "mid";
  return pool
    .map((p) => {
      const overlap = (p.styles ?? []).filter((s) => userStyles.has(s)).length;
      let score = overlap * 10 + (p.rating ?? 4) * 2 + (p.hidden ? 1.5 : 0);
      if (freeGemBonus && p.feeCents === 0) score += 8; // free gems first
      if (kids) score += kidScore(p) * 0.6; // kid-friendly ≈ +53, partial +36, neutral +27
      if (relaxedIds.has(p.id)) score -= 1000; // above-cap only when affordable exhausted
      return { p, score };
    })
    .sort((a, b) => b.score - a.score)
    .map((r) => r.p);
}

/**
 * Fill ONE day: seed the day's neighborhood from an anchor (its highest-ranked
 * remaining activity), alternate activity/food slots with a variety guard
 * (≤2 places per first-tag when alternatives exist), distance-penalize picks
 * from the running stop so the day walks ONE neighborhood, then order the
 * activity stops by real walking routes (OSRM foot, NN+2-opt). Mutates `used`
 * and `reservedAnchors`. Returns picks sorted by slot.
 * With `excludeFood`, every slot is filled with a non-food place and the
 * fallbacks never relax the food ban (the day simply ends early if the
 * non-food corpus runs dry).
 */
// Exported for unit tests (dietary-priority-over-fame, fame nudge).
export async function buildDayPicks(opts: {
  ranked: PlaceRow[];
  used: Set<number>;
  slots: number;
  anchor?: PlaceRow | null;
  reservedAnchors?: Set<number>;
  excludeFood?: boolean;
  /** Family mode: casual-food preference + one guaranteed recharge stop. */
  kids?: boolean;
  /** Out-param: ids of picks serving as the day's kids' downtime break. */
  rechargeIds?: Set<number>;
  /** Dietary preference - veg diets hard-prefer confirmed veg food picks. */
  dietary?: Dietary;
  /** Out-param: food picks whose diet fit is unconfirmed (thin corpus relax)
   *  - insertDayStops tags their notes "veg options unverified". */
  dietUnverifiedIds?: Set<number>;
}): Promise<{ place: PlaceRow; slot: number }[]> {
  const { ranked, used, slots, excludeFood = false, kids = false } = opts;
  const dietary = opts.dietary ?? "non-veg";
  const vegDiet = isVegDiet(dietary);
  const reservedAnchors = opts.reservedAnchors ?? new Set<number>();
  const scoreOf = new Map(ranked.map((p, i) => [p.id, ranked.length - i])); // higher = better

  // Day anchor: preassigned iconic headliner, else the highest-ranked
  // remaining activity. The anchor seeds the day's neighborhood.
  let anchor = opts.anchor && !used.has(opts.anchor.id) ? opts.anchor : null;
  if (slots > 0 && !anchor) {
    anchor = ranked.find((p) => !used.has(p.id) && !reservedAnchors.has(p.id) && !isFoodCategory(p.category)) ?? null;
  }
  if (anchor) reservedAnchors.delete(anchor.id);
  let lastPicked: { lat: number | null; lng: number | null } | null = anchor; // fresh neighborhood per day

  const pickFor = (kind: "act" | "food", dayTagCount: Map<string, number>) => {
    // r15-places: meal slots use eatery-only picks (isMealPlace) - produce
    // markets misfiled as food never fill lunch/dinner.
    const accepts = (p: PlaceRow) => (kind === "food" ? isMealPlace(p) : !isFoodCategory(p.category));
    const available = ranked.filter((p) => !used.has(p.id) && !reservedAnchors.has(p.id));
    const typed = available.filter(accepts);
    let choices = typed.length ? typed : excludeFood ? [] : available.filter((p) => kind === "food" ? isMealPlace(p) : true);
    if (!choices.length) {
      // Relax the anchor reservation - but never the food ban (nor, for meal
      // slots, the eatery-only rule).
      choices = excludeFood
        ? ranked.filter((p) => !used.has(p.id) && !isFoodCategory(p.category))
        : kind === "food"
          ? ranked.filter((p) => !used.has(p.id) && isMealPlace(p))
          : ranked.filter((p) => !used.has(p.id));
    }
    if (!choices.length) return null;
    // Dietary tuning (veg/vegan/jain/eggetarian): hard-prefer confirmed diet
    // fits and drop obvious meat-only kitchens - both only while alternatives
    // exist, so a thin corpus relaxes gracefully (those picks get tagged
    // "veg options unverified" in their notes).
    if (kind === "food" && vegDiet) {
      const noMeat = choices.filter((c) => !isMeatOnly(c));
      if (noMeat.length) choices = noMeat;
      const confirmed = choices.filter((c) => dietFit(c, dietary) >= 2);
      if (confirmed.length) choices = confirmed;
      const ideal = choices.filter((c) => dietFit(c, dietary) >= 3);
      if (ideal.length) choices = ideal;
    }
    // Variety guard: at most 2 places per day sharing the same first tag,
    // when alternatives exist.
    const varied = choices.filter((c) => (dayTagCount.get(tag0(c)) ?? 0) < 2);
    if (varied.length) choices = varied;
    let best = choices[0];
    let bestScore = -Infinity;
    for (const c of choices) {
      let s = scoreOf.get(c.id) ?? 0;
      if (lastPicked?.lat != null && lastPicked?.lng != null && c.lat != null && c.lng != null) {
        // penalize distance from the anchor/previous stop: ~0.9 rank-points
        // per km nearby, ~1.2/km once beyond the ~3km neighborhood radius
        const km = haversineKm(lastPicked.lat, lastPicked.lng, c.lat, c.lng);
        s -= km * (km > 3 ? 1.2 : 0.9);
      }
      // Family mode: food picks prefer casual/family-friendly spots
      // (priceLevel ≤ 2) - easy with kids, easy on the wallet.
      if (kids && kind === "food" && (c.priceLevel ?? 2) <= 2) s += 40;
      // Diet tiebreak within the surviving pool; India + vegetarian strongly
      // prefers "pure veg" signals (the local gold standard).
      if (kind === "food" && vegDiet) {
        s += dietFit(c, dietary) * 5;
        if (dietary === "veg" && (c.country ?? "").toLowerCase() === "india" && dietClass(c) === "pure-veg") {
          s += 30;
        }
      }
      // r15-eats: "★ Famous pick" eateries get a small boost so itineraries
      // surface the places people talk about. Deliberately AFTER the dietary
      // filter above - dietary suitability outranks fame; the boost only
      // breaks ties inside the diet-suitable pool, never forces a pick.
      if (kind === "food" && c.famousEatery) s += FAMOUS_EATERY_BOOST;
      if (s > bestScore) {
        bestScore = s;
        best = c;
      }
    }
    // Veg diets: a food pick without a confirmed diet fit means the corpus
    // ran thin - relax it in, but flag the stop so notes say so.
    if (kind === "food" && vegDiet && !dietConfirmed(best, dietary)) {
      opts.dietUnverifiedIds?.add(best.id);
    }
    used.add(best.id);
    lastPicked = best;
    return best;
  };

  const picks: { place: PlaceRow; slot: number }[] = [];
  const dayTagCount = new Map<string, number>();
  for (let s = 0; s < slots; s++) {
    let place: PlaceRow | null;
    if (s === 0 && anchor) {
      place = anchor;
      used.add(place.id);
    } else {
      const kind = excludeFood ? ("act" as const) : s % 2 === 1 ? ("food" as const) : ("act" as const);
      place = pickFor(kind, dayTagCount);
    }
    if (!place) break;
    dayTagCount.set(tag0(place), (dayTagCount.get(tag0(place)) ?? 0) + 1);
    picks.push({ place, slot: s });
  }
  // Family mode: guarantee ONE "recharge" stop per day (park/playground/
  // garden) when the corpus offers one - swap out the weakest non-anchor
  // activity pick. Marked via rechargeIds so the stop notes say so.
  if (kids && picks.length) {
    const existing = picks.find((pk) => isKidRecharge(pk.place));
    if (existing) {
      opts.rechargeIds?.add(existing.place.id);
    } else {
      const candidate = ranked.find(
        (p) =>
          !used.has(p.id) &&
          !reservedAnchors.has(p.id) &&
          !isFoodCategory(p.category) &&
          isKidRecharge(p),
      );
      if (candidate) {
        const swappable = picks.filter(
          (pk) => pk.place.id !== anchor?.id && !isFoodCategory(pk.place.category),
        );
        const victim = swappable[swappable.length - 1];
        if (victim) {
          used.delete(victim.place.id);
          used.add(candidate.id);
          victim.place = candidate;
          opts.rechargeIds?.add(candidate.id);
        }
      }
    }
  }
  // Order the activity stops by real walking routes (OSRM foot, NN+2-opt).
  // Sights-only days are all activities, so every stop joins the reorder.
  const actIdx = picks.map((p, i) => ({ ...p, i })).filter((p) => excludeFood || p.slot % 2 === 0);
  if (actIdx.length > 2 && actIdx.every((p) => p.place.lat != null && p.place.lng != null)) {
    const pts = actIdx.map((p) => ({ id: p.i, lat: p.place.lat!, lng: p.place.lng! }));
    const matrix = await osrmDurationMatrix(pts, "foot");
    const ordered = optimizeWithMatrix(pts, matrix);
    const actSlots = actIdx.map((p) => p.slot);
    ordered.forEach((pt, k) => {
      picks[pt.id].slot = actSlots[k];
    });
  }
  picks.sort((a, b) => a.slot - b.slot);
  return picks;
}

/** Insert a day's picks as stops (slot → fixed time/duration). Returns count. */
async function insertDayStops(opts: {
  tripId: number;
  dayId: number;
  picks: { place: PlaceRow; slot: number }[];
  positionOffset?: number;
  /** Planned slot count for the day - picks the classic vs dense schedule. */
  slots?: number;
  /** Family mode: kid slot times, 1h museums, recharge-stop notes. */
  kids?: boolean;
  rechargeIds?: Set<number>;
  /** Food picks whose veg-diet fit is unconfirmed - notes get flagged. */
  dietUnverifiedIds?: Set<number>;
}): Promise<number> {
  const db = getDb();
  const base = opts.positionOffset ?? 0;
  const kids = opts.kids ?? false;
  const { times, durations } = slotSchedule(opts.slots ?? opts.picks.length, kids);
  for (let pos = 0; pos < opts.picks.length; pos++) {
    const { place, slot } = opts.picks[pos];
    const recharge = kids && opts.rechargeIds?.has(place.id);
    const baseNotes = recharge
      ? `Downtime break for the kids${place.description ? `, ${place.description}` : "."}`
      : place.description;
    // Veg-diet relax: the corpus had no confirmed fit for this food stop.
    const dietUnverified = opts.dietUnverifiedIds?.has(place.id);
    await db.insert(schema.stops).values({
      tripId: opts.tripId,
      dayId: opts.dayId,
      name: place.name,
      category: place.category,
      address: `${place.city}, ${place.country}`,
      lat: place.lat,
      lng: place.lng,
      startTime: times[slot] ?? null,
      durationMin: kids && isMuseumPlace(place) ? 60 : (durations[slot] ?? null),
      notes: dietUnverified
        ? baseNotes
          ? `${baseNotes} · ${DIET_UNVERIFIED_NOTE}`
          : DIET_UNVERIFIED_NOTE
        : baseNotes,
      image: place.image,
      famousEatery: place.famousEatery, // ★ Famous pick rides along to the itinerary chip
      position: base + pos,
    });
  }
  return opts.picks.length;
}


// ─── Confirmation-email parser (flights, hotels, cars, activities) ─────────
const AIRLINES = [
  "United", "Delta", "American Airlines", "ANA", "JAL", "Japan Airlines", "British Airways",
  "Lufthansa", "Emirates", "Qatar Airways", "Air France", "KLM", "Singapore Airlines",
  "Qantas", "Cathay Pacific", "Turkish Airlines", "Iberia", "Air Canada", "JetBlue", "Southwest",
];
const HOTEL_HINTS = [
  "hotel", "check-in", "check in", "check-out", "check out", "marriott", "hilton", "hyatt",
  "booking.com", "airbnb", "ryokan", "resort", "hostel", "inn", "suites", "ihg", "accor",
];
const MONTHS: Record<string, string> = {
  jan: "01", feb: "02", mar: "03", apr: "04", may: "05", jun: "06",
  jul: "07", aug: "08", sep: "09", oct: "10", nov: "11", dec: "12",
};

function parseDateFrom(text: string): string | null {
  // ISO: 2026-08-14
  const iso = text.match(/\b(20\d{2})-(\d{2})-(\d{2})\b/);
  if (iso) return iso[0];
  // 14 Aug 2026 / Aug 14, 2026 / August 14 2026
  const m1 = text.match(/\b(\d{1,2})\s*(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*[\s,]+(20\d{2})\b/i);
  if (m1) return `${m1[3]}-${MONTHS[m1[2].slice(0, 3).toLowerCase()]}-${m1[1].padStart(2, "0")}`;
  const m2 = text.match(/\b(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s+(\d{1,2})[\s,]+(20\d{2})\b/i);
  if (m2) return `${m2[3]}-${MONTHS[m2[1].slice(0, 3).toLowerCase()]}-${m2[2].padStart(2, "0")}`;
  // 08/14/2026 or 14/08/2026 - assume US order when first > 12 fails
  const m3 = text.match(/\b(\d{1,2})\/(\d{1,2})\/(20\d{2})\b/);
  if (m3) {
    const [a, b] = [Number(m3[1]), Number(m3[2])];
    const [mm, dd] = a > 12 ? [b, a] : [a, b];
    return `${m3[3]}-${String(mm).padStart(2, "0")}-${String(dd).padStart(2, "0")}`;
  }
  return null;
}

function parseConfirmationEmail(raw: string): {
  type: string; title: string; provider: string | null; confirmationCode: string | null;
  startDate: string | null; endDate: string | null; details: string | null;
  amountCents: number | null; currency: string | null;
} {
  const text = raw.replace(/\r/g, " ").replace(/\n+/g, " ").replace(/\s{2,}/g, " ");
  const lower = text.toLowerCase();

  // Confirmation / booking reference code
  const codeMatch =
    text.match(/(?:confirmation|booking|record locator|pnr|reservation|itinerary|reference)\s*(?:code|number|#|no\.?)?\s*[:#]?\s*\b((?=[A-Z0-9]*\d)[A-Z0-9]{5,10})\b/i) ??
    text.match(/\b([A-Z]{2}[A-Z0-9]{4,6})\b(?=.*(?:flight|airline))/i);
  const confirmationCode = codeMatch?.[1]?.toUpperCase() ?? null;

  // Amount + currency
  const amtMatch =
    text.match(/\b(USD|EUR|GBP|JPY|CAD|AUD)\b\s*[$€£¥]?\s*([\d,]+(?:\.\d{2})?)/) ??
    text.match(/([$€£¥])\s*([\d,]+(?:\.\d{2})?)/);
  let amountCents: number | null = null;
  let currency: string | null = null;
  if (amtMatch) {
    const symMap: Record<string, string> = { $: "USD", "€": "EUR", "£": "GBP", "¥": "JPY" };
    currency = /^[A-Z]{3}$/.test(amtMatch[1]) ? amtMatch[1] : symMap[amtMatch[1]] ?? "USD";
    amountCents = Math.round(parseFloat(amtMatch[2].replace(/,/g, "")) * 100);
  }

  // Dates - first two distinct dates become start/end
  const isoDates = [...raw.matchAll(/\b20\d{2}-\d{2}-\d{2}\b/g)].map((m) => m[0]);
  let startDate: string | null = isoDates[0] ?? null;
  const endDate: string | null = isoDates.find((d) => d !== startDate) ?? null;
  if (!startDate) {
    startDate = parseDateFrom(raw);
  }

  // Flight?
  const flightNo = text.match(/\b([A-Z]{2})\s?(\d{1,4})\b(?=.*(?:flight|depart|arriv|airline))/i);
  const airline = AIRLINES.find((a) => lower.includes(a.toLowerCase())) ?? null;
  const route = text.match(/\b([A-Z]{3})\s*(?:→|->|to|-)\s*([A-Z]{3})\b/);
  if (airline ?? (flightNo && /flight|depart/i.test(lower))) {
    const title = `${route ? `${route[1]} → ${route[2]} · ` : ""}${airline ?? flightNo?.[1]?.toUpperCase() ?? "Flight"}${flightNo ? ` ${flightNo[2]}` : ""}`.trim();
    const times = text.match(/\b(\d{1,2}:\d{2})\b.*?\b(\d{1,2}:\d{2})\b/);
    return {
      type: "flight",
      title,
      provider: airline,
      confirmationCode,
      startDate,
      endDate,
      details: times ? `Depart ${times[1]} · Arrive ${times[2]}` : null,
      amountCents,
      currency,
    };
  }

  // Hotel / lodging?
  if (HOTEL_HINTS.some((h) => lower.includes(h))) {
    const nameMatch =
      text.match(/(?:hotel|property|ryokan|inn|stay)\s*[:\-]\s*([A-Z][A-Za-z0-9 '&.-]{2,48})/i) ??
      text.match(/\b((?:[A-Z][A-Za-z0-9'&.-]*\s+){0,4}[A-Z][A-Za-z0-9'&.-]*\s+(?:Hotel|Ryokan|Resort|Hostel|Suites|Inn))\b/);
    const ci = lower.match(/check[- ]in[:\s]*([a-z0-9, ./-]{4,30})/i);
    const co = lower.match(/check[- ]out[:\s]*([a-z0-9, ./-]{4,30})/i);
    const ciDate = ci ? parseDateFrom(ci[1]) : null;
    const coDate = co ? parseDateFrom(co[1]) : null;
    return {
      type: "lodging",
      title: nameMatch?.[1]?.trim() ?? "Hotel reservation",
      provider: lower.includes("booking.com") ? "Booking.com" : lower.includes("airbnb") ? "Airbnb" : null,
      confirmationCode,
      startDate: ciDate ?? startDate,
      endDate: coDate ?? endDate,
      details: null,
      amountCents,
      currency,
    };
  }

  // Rental car?
  if (/rental car|car rental|hertz|avis|enterprise|europcar/i.test(lower)) {
    return { type: "car", title: "Rental car", provider: null, confirmationCode, startDate, endDate, details: null, amountCents, currency };
  }

  // Fallback: generic activity/other ticket
  const subj = raw.match(/subject:\s*(.+)/i)?.[1]?.slice(0, 80);
  return {
    type: "other",
    title: subj ?? "Imported booking",
    provider: null,
    confirmationCode,
    startDate,
    endDate,
    details: null,
    amountCents,
    currency,
  };
}

/**
 * Cover image: a stock/remote URL (short) or a client-downscaled
 * data:image/(jpeg|png|webp);base64 upload (CreateTripModal caps it well
 * under this ceiling at ~450KB).
 */
const COVER_DATA_URL_RE = /^data:image\/(jpeg|png|webp);base64,/;
const coverImageInput = z
  .string()
  .max(600_000)
  .refine((v) => v.length <= 512 || COVER_DATA_URL_RE.test(v), {
    message: "coverImage must be a URL or a data:image/(jpeg|png|webp);base64 upload",
  });

const stopInput = z.object({
  tripId: z.number(),
  dayId: z.number().nullable(),
  name: z.string().min(1).max(255),
  category: z.string().default("activity"),
  address: z.string().max(512).optional(),
  lat: z.number().optional(),
  lng: z.number().optional(),
  startTime: z.string().max(5).nullable().optional(),
  durationMin: z.number().nullable().optional(),
  notes: z.string().optional(),
  image: z.string().max(512).optional(),
});

export const tripRouter = createRouter({
  // ── Trip CRUD ────────────────────────────────────────────────────────────
  list: authedQuery.query(async ({ ctx }) => {
    const db = getDb();
    const memberships = await db
      .select()
      .from(schema.tripMembers)
      .where(eq(schema.tripMembers.userId, ctx.user.id));
    const tripIds = memberships.map((m) => m.tripId);
    if (!tripIds.length) return { trips: [], tier: await getTier(ctx.user.id) };
    const rows = await db
      .select()
      .from(schema.trips)
      .where(inArray(schema.trips.id, tripIds));
    const members = await db
      .select()
      .from(schema.tripMembers)
      .where(inArray(schema.tripMembers.tripId, tripIds));
    // r25: each trip's status is judged in ITS OWN destination timezone.
    // A trip ending today in Coorg shouldn't read "past" because the server
    // in UTC has already rolled over.
    const trips = rows
      .map((t) => ({
        ...t,
        members: members.filter((m) => m.tripId === t.id),
        status: t.endDate < todayIn(resolveTz(t.timezone, ctx.user.timezone)) ? "past" : "upcoming",
      }))
      .sort((a, b) => (a.startDate < b.startDate ? 1 : -1));
    return { trips, tier: await getTier(ctx.user.id) };
  }),

  get: authedQuery.input(z.object({ id: z.number() })).query(async ({ ctx, input }) => {
    try {
      await requireMembership(input.id, ctx.user.id);
    } catch (err) {
      // r15-access: a non-member opening a copied workspace URL gets a 403.
      // When the trip has an ACTIVE public share link (shareToken set -
      // NULL means sharing is off, see share-router), attach the token to
      // the error cause so the client can redirect to the read-only
      // /shared/:token view instead of a dead error page. The token is
      // public by design, so this leaks nothing new. The 403 itself stays.
      if (err instanceof TRPCError && err.code === "FORBIDDEN") {
        const [t] = await getDb()
          .select({ shareToken: schema.trips.shareToken })
          .from(schema.trips)
          .where(eq(schema.trips.id, input.id))
          .limit(1);
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "Not a member of this trip",
          cause: t?.shareToken ? { shareToken: t.shareToken } : undefined,
        });
      }
      throw err;
    }
    const db = getDb();
    const [trip] = await db.select().from(schema.trips).where(eq(schema.trips.id, input.id)).limit(1);
    if (!trip) throw new TRPCError({ code: "NOT_FOUND" });
    const [members, days, stopRows, expenseRows, reservationRows, checklistRows, noteRows] =
      await Promise.all([
        db.select().from(schema.tripMembers).where(eq(schema.tripMembers.tripId, input.id)),
        db.select().from(schema.tripDays).where(eq(schema.tripDays.tripId, input.id)).orderBy(asc(schema.tripDays.position)),
        db.select().from(schema.stops).where(eq(schema.stops.tripId, input.id)).orderBy(asc(schema.stops.position)),
        db.select().from(schema.expenses).where(eq(schema.expenses.tripId, input.id)),
        db.select().from(schema.reservations).where(eq(schema.reservations.tripId, input.id)),
        db.select().from(schema.checklistItems).where(eq(schema.checklistItems.tripId, input.id)).orderBy(asc(schema.checklistItems.position)),
        db.select().from(schema.tripNotes).where(eq(schema.tripNotes.tripId, input.id)).limit(1),
      ]);
    const expenseIds = expenseRows.map((e) => e.id);
    const splits = expenseIds.length
      ? await db.select().from(schema.expenseSplits).where(inArray(schema.expenseSplits.expenseId, expenseIds))
      : [];
    return {
      trip,
      members,
      days,
      stops: stopRows,
      expenses: expenseRows.map((e) => ({ ...e, splits: splits.filter((s) => s.expenseId === e.id) })),
      reservations: reservationRows,
      checklist: checklistRows,
      note: noteRows[0] ?? null,
      tier: await getTier(ctx.user.id),
    };
  }),

  create: authedQuery
    .input(
      z.object({
        title: z.string().min(1).max(255),
        destination: z.string().min(1).max(255),
        startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        coverImage: coverImageInput.optional(),
        homeCurrency: z.string().length(3).default("USD"),
        budgetCents: z.number().int().min(0).default(0),
        // r24-core wizard fields (all optional - quick create stays valid).
        // Multi-country trips: `destination` is a free-text "City, Country"
        // list joined with ", " - no country constraint server-side.
        budgetCurrency: z.string().length(3).optional(),
        originCity: z.string().max(255).optional(),
        adults: z.number().int().min(1).max(20).optional(),
        children: z.number().int().min(0).max(12).optional(),
        intent: z.string().max(2000).optional(), // JSON array of intent keys
        flexibility: z.enum(["planned", "flexible"]).optional(),
        foodPrefs: z.string().max(2000).optional(), // JSON { diets, note }
        mustSee: z.string().max(5000).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const db = getDb();
      const tier = await getTier(ctx.user.id);
      const owned = await db.select().from(schema.trips).where(eq(schema.trips.ownerId, ctx.user.id));
      const activeCount = owned.filter(
        (t) => t.endDate >= todayIn(resolveTz(t.timezone, ctx.user.timezone)),
      ).length;
      if (activeCount >= TIERS[tier].maxTrips) {
        throw new TRPCError({ code: "FORBIDDEN", message: "UPGRADE_REQUIRED" });
      }
      const result = await db.insert(schema.trips).values({
        ownerId: ctx.user.id,
        title: input.title,
        destination: input.destination,
        startDate: input.startDate,
        endDate: input.endDate,
        coverImage: input.coverImage ?? null,
        homeCurrency: input.homeCurrency,
        budgetCents: input.budgetCents,
        budgetCurrency: input.budgetCurrency ?? input.homeCurrency,
        originCity: input.originCity ?? null,
        adults: input.adults ?? 2,
        children: input.children ?? 0,
        intent: input.intent ?? null,
        flexibility: input.flexibility ?? null,
        foodPrefs: input.foodPrefs ?? null,
        mustSee: input.mustSee ?? null,
        // r25: stamp the destination's timezone at create so every later
        // "is today inside this trip" question is answered in the traveller's
        // local zone. Falls back to the user's own zone when the destination
        // isn't confidently recognised (see guessTimeZone).
        timezone: guessTimeZone(input.destination) ?? ctx.user.timezone ?? null,
      });
      const tripId = Number(result[0].insertId);
      await db.insert(schema.tripMembers).values({
        tripId,
        userId: ctx.user.id,
        name: ctx.user.name ?? "You",
        email: ctx.user.email ?? null,
        role: "owner",
        presenceColor: PRESENCE_COLORS[0],
      });
      const dates = dateRange(input.startDate, input.endDate);
      if (dates.length) {
        await db.insert(schema.tripDays).values(dates.map((date, i) => ({ tripId, date, position: i })));
      }
      // r24-smart Q: tokens for creating a trip (idempotent per trip id).
      {
        const { awardTokens } = await import("./lib/tokens");
        await awardTokens(ctx.user.id, "trip_created", `trip:${tripId}`, { destination: input.destination });
      }
      return { id: tripId };
    }),

  update: authedQuery
    .input(
      z.object({
        id: z.number(),
        title: z.string().min(1).max(255).optional(),
        destination: z.string().max(255).optional(),
        coverImage: coverImageInput.nullable().optional(),
        startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
        endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
        budgetCents: z.number().int().min(0).optional(),
        homeCurrency: z.string().length(3).optional(),
        // r24-core wizard fields
        budgetCurrency: z.string().length(3).optional(),
        originCity: z.string().max(255).nullable().optional(),
        adults: z.number().int().min(1).max(20).optional(),
        children: z.number().int().min(0).max(12).optional(),
        intent: z.string().max(2000).nullable().optional(),
        flexibility: z.enum(["planned", "flexible"]).nullable().optional(),
        foodPrefs: z.string().max(2000).nullable().optional(),
        mustSee: z.string().max(5000).nullable().optional(),
        // Family travel flags (kids-mode toggle in the workspace header)
        withChildren: z.boolean().optional(),
        childAges: z.string().max(64).nullable().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const { id, ...patch } = input;
      await requireEditor(id, ctx.user.id);
      await getDb().update(schema.trips).set(patch).where(eq(schema.trips.id, id));
      return { ok: true };
    }),

  remove: authedQuery.input(z.object({ id: z.number() })).mutation(async ({ ctx, input }) => {
    await requireOwner(input.id, ctx.user.id);
    const db = getDb();
    const expenseRows = await db.select().from(schema.expenses).where(eq(schema.expenses.tripId, input.id));
    const expenseIds = expenseRows.map((e) => e.id);
    if (expenseIds.length) {
      await db.delete(schema.expenseSplits).where(inArray(schema.expenseSplits.expenseId, expenseIds));
    }
    await db.delete(schema.expenses).where(eq(schema.expenses.tripId, input.id));
    await db.delete(schema.stops).where(eq(schema.stops.tripId, input.id));
    await db.delete(schema.tripDays).where(eq(schema.tripDays.tripId, input.id));
    await db.delete(schema.reservations).where(eq(schema.reservations.tripId, input.id));
    await db.delete(schema.checklistItems).where(eq(schema.checklistItems.tripId, input.id));
    await db.delete(schema.tripNotes).where(eq(schema.tripNotes.tripId, input.id));
    await db.delete(schema.tripMembers).where(eq(schema.tripMembers.tripId, input.id));
    await db.delete(schema.trips).where(eq(schema.trips.id, input.id));
    return { ok: true };
  }),

  // ── AI itinerary generation ──────────────────────────────────────────────
  generateItinerary: authedQuery
    .input(
      z.object({
        destination: z.string().min(1).max(255),
        startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        pace: z.enum(["relaxed", "balanced", "packed"]).default("balanced"),
        stopsPerDay: z.number().int().min(2).max(8).optional(), // overrides pace-derived slots
        excludeFood: z.boolean().default(false), // sights only - no restaurant/café stops
        styles: z.array(z.string()).optional(),
        budgetBand: z.enum(["shoestring", "mid", "comfort", "luxury"]).optional(),
        title: z.string().max(255).optional(),
        homeCurrency: z.string().length(3).default("USD"),
        // Family travel: kid-aware ranking + pacing (≤4 stops/day, nothing
        // after 18:30, a daily recharge stop). childAges e.g. "4,7".
        withChildren: z.boolean().optional(),
        childAges: z.string().max(64).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const db = getDb();
      // AI itinerary generation is a Voyager-only feature - hard paywall.
      const tier = await getTier(ctx.user.id);
      if (tier !== "voyager") {
        throw new TRPCError({ code: "FORBIDDEN", message: "UPGRADE_REQUIRED" });
      }
      const kids = input.withChildren ?? false;

      // Find candidate places from the recommendation corpus
      const dest = input.destination.split(",")[0].trim();
      // autoImport: a fresh corpus must not mean 'this destination does not exist'.
      let candidates = await fetchDestinationCandidates(dest, true);
      if (candidates.length < 4) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "DESTINATION_UNKNOWN" });
      }
      // Family trips: bars/nightlife/adult venues leave the pool entirely.
      if (kids) candidates = kidFilterPool(candidates);

      const { pool, relaxedIds } = budgetCapPool(candidates, input.budgetBand);

      // Personalize ranking: style overlap (input styles or saved taste
      // profile); dietary always comes from the saved preferences.
      const prefRows = await db.select().from(schema.preferences).where(eq(schema.preferences.userId, ctx.user.id)).limit(1);
      const userStyles = input.styles?.length ? new Set(input.styles) : profileStyles(prefRows[0]);
      const dietary = parseDietary(prefRows[0]?.dietary);
      const ranked = rankPlaces(pool, userStyles, input.budgetBand, relaxedIds, kids);

      // Day plan: explicit stopsPerDay override, else pace → slots/day;
      // alternate activity-ish and food slots (all sights when excludeFood).
      // Per-day neighborhood clustering: each day is seeded by an ANCHOR place
      // (its highest-ranked remaining activity), and subsequent picks are
      // distance-penalized from the running pick - steeply (~1.2/km) once a
      // candidate lies beyond ~3km, so a day walks ONE neighborhood.
      const rawSlots =
        input.stopsPerDay ?? (input.pace === "relaxed" ? 3 : input.pace === "packed" ? 5 : 4);
      // Family pace: never more than 4 stops a day - kids melt down, not up.
      const slotsPerDay = kids ? Math.min(KID_MAX_SLOTS, rawSlots) : rawSlots;
      const dates = dateRange(input.startDate, input.endDate).slice(0, 10);
      const used = new Set<number>();
      const rechargeIds = new Set<number>();
      const dietUnverifiedIds = new Set<number>();

      // Iconic spread: the top-3 highest-rated iconic activities each anchor a
      // DIFFERENT day (trips of ≥3 days), so headliners don't cluster on day 1.
      const iconicAnchors =
        dates.length >= 3
          ? ranked
              .filter((p) => !isFoodCategory(p.category) && (p.tags ?? []).includes("iconic"))
              .sort((a, b) => (b.rating ?? 4) - (a.rating ?? 4))
              .slice(0, 3)
          : [];
      const dayAnchors: (PlaceRow | null)[] = dates.map((_, d) => iconicAnchors[d] ?? null);
      const reservedAnchors = new Set(dayAnchors.filter(Boolean).map((p) => p!.id));

      const CITY_COVERS: Record<string, string> = {
        Kyoto: "/hero-kyoto.jpg",
        Osaka: "/explore-street.jpg",
        Nara: "/place-temple.jpg",
        Lisbon: "/cover-lisbon.jpg",
        Positano: "/cover-amalfi.jpg",
        Marrakech: "/cover-marrakech.jpg",
        "El Chaltén": "/cover-patagonia.jpg",
        Reykjavik: "/cover-reykjavik.jpg",
        Vík: "/cover-reykjavik.jpg",
        Copenhagen: "/cover-copenhagen.jpg",
        Oaxaca: "/cover-oaxaca.jpg",
      };
      const cover = CITY_COVERS[candidates[0].city] ?? candidates[0].image ?? "/hero-kyoto.jpg";
      const cityName = candidates[0].city;
      const title = input.title ?? `${dates.length} days in ${cityName}`;

      const tripRes = await db.insert(schema.trips).values({
        ownerId: ctx.user.id,
        title,
        destination: input.destination,
        coverImage: cover,
        startDate: input.startDate,
        endDate: input.endDate,
        homeCurrency: input.homeCurrency,
        withChildren: kids,
        childAges: kids ? (input.childAges ?? null) : null,
      });
      const tripId = Number(tripRes[0].insertId);
      await db.insert(schema.tripMembers).values({
        tripId,
        userId: ctx.user.id,
        name: ctx.user.name ?? "You",
        email: ctx.user.email ?? null,
        role: "owner",
        presenceColor: PRESENCE_COLORS[0],
      });

      // Distribute places evenly across days so small-corpus cities don't
      // front-load day 1 and leave later days empty. Sights-only days draw
      // from the non-food corpus, so plan against its size.
      const plannable = input.excludeFood
        ? ranked.filter((p) => !isFoodCategory(p.category)).length
        : ranked.length;
      const totalPlanned = Math.min(plannable, slotsPerDay * dates.length);
      const basePerDay = Math.floor(totalPlanned / dates.length);
      const extraDays = totalPlanned % dates.length;

      let stopsCreated = 0;
      const dayEstimates: { date: string; feesKnown: number; totalCents: number; currencies: string[] }[] = [];
      for (let d = 0; d < dates.length; d++) {
        const dayRes = await db.insert(schema.tripDays).values({ tripId, date: dates[d], position: d });
        const dayId = Number(dayRes[0].insertId);
        // 1) pick + walking-order the day's stops (activity/food slots)
        const todaySlots = Math.min(slotsPerDay, basePerDay + (d < extraDays ? 1 : 0));
        const picks = await buildDayPicks({
          ranked,
          used,
          slots: todaySlots,
          anchor: dayAnchors[d] ?? null,
          reservedAnchors,
          excludeFood: input.excludeFood,
          kids,
          rechargeIds,
          dietary,
          dietUnverifiedIds,
        });
        // 2) insert ordered by slot (slot → fixed time)
        stopsCreated += await insertDayStops({ tripId, dayId, picks, slots: todaySlots, kids, rechargeIds, dietUnverifiedIds });
        // 3) per-day cost estimate: sum only KNOWN admission fees (null = unknown,
        // skipped); 0-entry fees still count as known. Currencies are listed so
        // mixed-currency totals aren't mistaken for a single one.
        const feePlaces = picks.map((pk) => pk.place).filter((p) => p.feeCents != null);
        dayEstimates.push({
          date: dates[d],
          feesKnown: feePlaces.length,
          totalCents: feePlaces.reduce((sum, p) => sum + (p.feeCents ?? 0), 0),
          currencies: [...new Set(feePlaces.map((p) => p.feeCurrency).filter((c): c is string => !!c))],
        });
      }
      return { id: tripId, stopsCreated, days: dates.length, city: cityName, dayEstimates };
    }),

  /**
   * AI day-fill (Voyager): fill ONE day of an existing trip with the same
   * generator machinery as generateItinerary - destination corpus minus places
   * already in the trip, anchor clustering, variety guard, OSRM foot ordering.
   * With no dayId, appends a NEW day after the last and fills that.
   * stopsPerDay overrides the pace-derived slot count; excludeFood plans a
   * sights-only day (no restaurant/café stops).
   */
  generateDay: authedQuery
    .input(
      z.object({
        tripId: z.number(),
        dayId: z.number().optional(),
        styles: z.array(z.string()).optional(),
        budgetBand: z.enum(["shoestring", "mid", "comfort", "luxury"]).optional(),
        pace: z.enum(["relaxed", "balanced", "packed"]).default("balanced"),
        stopsPerDay: z.number().int().min(2).max(8).optional(), // overrides pace-derived slots
        excludeFood: z.boolean().default(false), // sights only - no restaurant/café stops
        // Family override: defaults to the trip's saved withChildren flag, so
        // kids-mode trips plan family days even without re-sending the flag.
        withChildren: z.boolean().optional(),
        childAges: z.string().max(64).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const db = getDb();
      const tier = await getTier(ctx.user.id);
      if (tier !== "voyager") {
        throw new TRPCError({ code: "FORBIDDEN", message: "UPGRADE_REQUIRED" });
      }
      await requireEditor(input.tripId, ctx.user.id);
      const [trip] = await db.select().from(schema.trips).where(eq(schema.trips.id, input.tripId)).limit(1);
      if (!trip) throw new TRPCError({ code: "NOT_FOUND" });
      // Family mode: explicit input wins, else the trip's saved flag (set at
      // generation time or toggled later from the workspace header).
      const kids = input.withChildren ?? trip.withChildren ?? false;
      // Keep the trip row coherent with an explicit override.
      const tripPatch: { withChildren?: boolean; childAges?: string | null } = {};
      if (input.withChildren != null && input.withChildren !== (trip.withChildren ?? false)) {
        tripPatch.withChildren = input.withChildren;
      }
      if (input.childAges != null && input.childAges !== (trip.childAges ?? null)) {
        tripPatch.childAges = input.childAges;
      }
      if (Object.keys(tripPatch).length) {
        await db.update(schema.trips).set(tripPatch).where(eq(schema.trips.id, input.tripId));
      }

      // Target day: the explicit one, else a NEW day appended after the last.
      const days = await db
        .select()
        .from(schema.tripDays)
        .where(eq(schema.tripDays.tripId, input.tripId))
        .orderBy(asc(schema.tripDays.position));
      let dayId: number;
      let date: string;
      if (input.dayId != null) {
        const day = days.find((d) => d.id === input.dayId);
        if (!day) throw new TRPCError({ code: "NOT_FOUND", message: "Day not in this trip" });
        dayId = day.id;
        date = day.date;
      } else {
        const last = days[days.length - 1];
        if (last) {
          const d = new Date(last.date + "T00:00:00Z");
          d.setUTCDate(d.getUTCDate() + 1);
          date = d.toISOString().slice(0, 10);
        } else {
          date = trip.startDate;
        }
        const dayRes = await db.insert(schema.tripDays).values({
          tripId: input.tripId,
          date,
          position: last ? Math.max(...days.map((d) => d.position)) + 1 : 0,
        });
        dayId = Number(dayRes[0].insertId);
        // Keep the trip window coherent with the appended day.
        if (date > trip.endDate) {
          await db.update(schema.trips).set({ endDate: date }).where(eq(schema.trips.id, input.tripId));
        }
      }

      // Candidate corpus for the trip's destination, minus places already planned.
      const dest = trip.destination.split(",")[0].trim();
      const candidates = await fetchDestinationCandidates(dest, true);
      if (candidates.length < 4) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "DESTINATION_UNKNOWN" });
      }
      const existingStops = await db.select().from(schema.stops).where(eq(schema.stops.tripId, input.tripId));
      const takenNames = new Set(existingStops.map((s) => s.name.trim().toLowerCase()));
      let fresh = candidates.filter((p) => !takenNames.has(p.name.trim().toLowerCase()));
      // Family trips: bars/nightlife/adult venues leave the pool entirely.
      if (kids) fresh = kidFilterPool(fresh);
      if (!fresh.length) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "NO_NEW_PLACES" });
      }

      // Style inheritance: explicit styles, else the saved taste profile;
      // dietary always comes from the saved preferences.
      const prefRows = await db.select().from(schema.preferences).where(eq(schema.preferences.userId, ctx.user.id)).limit(1);
      const userStyles = input.styles?.length ? new Set(input.styles) : profileStyles(prefRows[0]);
      const dietary = parseDietary(prefRows[0]?.dietary);
      const { pool, relaxedIds } = budgetCapPool(fresh, input.budgetBand);
      const ranked = rankPlaces(pool, userStyles, input.budgetBand, relaxedIds, kids);

      const rawSlots =
        input.stopsPerDay ?? (input.pace === "relaxed" ? 3 : input.pace === "packed" ? 5 : 4);
      // Family pace: never more than 4 stops a day.
      const slotsPerDay = kids ? Math.min(KID_MAX_SLOTS, rawSlots) : rawSlots;
      const rechargeIds = new Set<number>();
      const dietUnverifiedIds = new Set<number>();
      const picks = await buildDayPicks({
        ranked,
        used: new Set(),
        slots: slotsPerDay,
        excludeFood: input.excludeFood,
        kids,
        rechargeIds,
        dietary,
        dietUnverifiedIds,
      });
      const dayStops = existingStops.filter((s) => s.dayId === dayId);
      const positionOffset = dayStops.length ? Math.max(...dayStops.map((s) => s.position)) + 1 : 0;
      const stopsCreated = await insertDayStops({
        tripId: input.tripId,
        dayId,
        picks,
        positionOffset,
        slots: slotsPerDay,
        kids,
        rechargeIds,
        dietUnverifiedIds,
      });
      return { dayId, stopsCreated, date };
    }),

  // ── Members / collaboration ──────────────────────────────────────────────
  addMember: authedQuery
    .input(
      z.object({
        tripId: z.number(),
        name: z.string().min(1).max(255),
        email: z.string().email().optional(),
        role: z.enum(["editor", "viewer"]).default("editor"),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await requireEditor(input.tripId, ctx.user.id);
      const db = getDb();
      const [trip] = await db.select().from(schema.trips).where(eq(schema.trips.id, input.tripId)).limit(1);
      const ownerTier = await getTier(trip.ownerId);
      const members = await db.select().from(schema.tripMembers).where(eq(schema.tripMembers.tripId, input.tripId));
      const email = input.email?.trim().toLowerCase() ?? null;
      // Re-inviting an email that's already on the trip just updates the role.
      const dupe = email ? members.find((m) => m.email?.toLowerCase() === email) : undefined;
      if (dupe) {
        if (dupe.role !== "owner" && dupe.role !== input.role) {
          await db.update(schema.tripMembers).set({ role: input.role }).where(eq(schema.tripMembers.id, dupe.id));
        }
        return { id: dupe.id, linked: dupe.userId != null };
      }
      const collaborators = members.filter((m) => m.role !== "owner").length;
      if (collaborators >= TIERS[ownerTier].maxCollaborators) {
        throw new TRPCError({ code: "FORBIDDEN", message: "UPGRADE_REQUIRED" });
      }
      // If a users row already exists for that email the membership is live
      // immediately (it shows on their Trips page); otherwise the row is a
      // pending invite that claimPendingTripInvites() attaches at sign-up.
      const invitedUser = email ? await findUserByEmail(email) : undefined;
      const result = await db.insert(schema.tripMembers).values({
        tripId: input.tripId,
        userId: invitedUser?.id ?? null,
        name: input.name,
        email,
        role: input.role,
        presenceColor: PRESENCE_COLORS[members.length % PRESENCE_COLORS.length],
      });

      // r27: actually TELL the person. Until now this procedure created a
      // pending row and stopped, so an invite reached the invitee only if the
      // organiser messaged them separately. Two channels, both best-effort:
      // the in-app bell when they already have an account, and email when we
      // have an address. Neither may fail the invite itself.
      let notified: "email" | "app" | "both" | "none" = "none";
      if (invitedUser) {
        await notify(invitedUser.id, {
          kind: "invite",
          title: `${ctx.user.name ?? "Someone"} added you to ${trip.title}`,
          body: input.role === "editor"
            ? "You can edit the plan and split expenses together."
            : "You can follow the plan as it comes together.",
          tripId: input.tripId,
        });
        notified = "app";
      }
      if (email) {
        // A known user goes straight to the trip; a stranger lands on sign-up
        // with the email prefilled, and claimPendingTripInvites() attaches the
        // membership the moment they register.
        const href = invitedUser
          ? appUrl(`/trips/${input.tripId}`)
          : appUrl(`/login?invite=${encodeURIComponent(email)}`);
        const mail = await sendTripInvite({
          to: email,
          inviteeName: input.name,
          inviterName: ctx.user.name ?? "A fellow traveller",
          tripTitle: trip.title,
          tripDates: formatTripDates(trip.startDate, trip.endDate),
          role: input.role,
          href,
        });
        if (mail.ok) notified = notified === "app" ? "both" : "email";
      }

      return { id: Number(result[0].insertId), linked: invitedUser != null, notified };
    }),

  /**
   * r27: resend an invite that never landed (spam folder, typo'd then fixed,
   * or sent while the mailer was unconfigured). Rate-limited by the provider,
   * not here; the row already exists so this is idempotent.
   */
  resendInvite: authedQuery
    .input(z.object({ tripId: z.number(), memberId: z.number() }))
    .mutation(async ({ ctx, input }) => {
      await requireEditor(input.tripId, ctx.user.id);
      const db = getDb();
      const [member] = await db
        .select()
        .from(schema.tripMembers)
        .where(
          and(
            eq(schema.tripMembers.id, input.memberId),
            // Scope to the trip, or a member id from someone else's trip works.
            eq(schema.tripMembers.tripId, input.tripId),
          ),
        )
        .limit(1);
      if (!member?.email) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "That member has no email on file" });
      }
      const [trip] = await db.select().from(schema.trips).where(eq(schema.trips.id, input.tripId)).limit(1);
      const href = member.userId
        ? appUrl(`/trips/${input.tripId}`)
        : appUrl(`/login?invite=${encodeURIComponent(member.email)}`);
      const mail = await sendTripInvite({
        to: member.email,
        inviteeName: member.name,
        inviterName: ctx.user.name ?? "A fellow traveller",
        tripTitle: trip.title,
        tripDates: formatTripDates(trip.startDate, trip.endDate),
        role: member.role === "viewer" ? "viewer" : "editor",
        href,
      });
      if (!mail.ok && mail.reason === "disabled") {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: "Email isn't configured on this deployment yet.",
        });
      }
      return { ok: mail.ok };
    }),

  removeMember: authedQuery
    .input(z.object({ tripId: z.number(), memberId: z.number() }))
    .mutation(async ({ ctx, input }) => {
      await requireOwner(input.tripId, ctx.user.id);
      const db = getDb();
      await db
        .delete(schema.tripMembers)
        .where(
          and(
            eq(schema.tripMembers.id, input.memberId),
            // Without this, a trip owner could remove a member of a trip they
            // have never seen just by guessing a tripMembers row id.
            eq(schema.tripMembers.tripId, input.tripId),
            ne(schema.tripMembers.role, "owner"),
          ),
        );
      return { ok: true };
    }),

  // ── Itinerary stops ──────────────────────────────────────────────────────
  addStop: authedQuery.input(stopInput).mutation(async ({ ctx, input }) => {
    await requireEditor(input.tripId, ctx.user.id);
    const db = getDb();
    // dayId is caller-supplied: make sure it belongs to this trip, or the stop
    // ends up tagged with a day from someone else's itinerary.
    if (input.dayId != null) await assertDayInTrip(input.dayId, input.tripId);
    const siblings = await db.select().from(schema.stops).where(eq(schema.stops.tripId, input.tripId));
    const inDay = siblings.filter((s) => s.dayId === input.dayId);
    const position = inDay.length ? Math.max(...inDay.map((s) => s.position)) + 1 : 0;
    const result = await db.insert(schema.stops).values({
      tripId: input.tripId,
      dayId: input.dayId,
      name: input.name,
      category: input.category,
      address: input.address ?? null,
      lat: input.lat ?? null,
      lng: input.lng ?? null,
      startTime: input.startTime ?? null,
      durationMin: input.durationMin ?? null,
      notes: input.notes ?? null,
      image: input.image ?? null,
      position,
    });
    return { id: Number(result[0].insertId), position };
  }),

  updateStop: authedQuery
    .input(
      z.object({
        id: z.number(),
        tripId: z.number(),
        dayId: z.number().nullable().optional(),
        name: z.string().min(1).max(255).optional(),
        category: z.string().optional(),
        address: z.string().max(512).nullable().optional(),
        lat: z.number().nullable().optional(),
        lng: z.number().nullable().optional(),
        startTime: z.string().max(5).nullable().optional(),
        durationMin: z.number().nullable().optional(),
        notes: z.string().nullable().optional(),
        // r24-core: booking tracking + per-leg transport (leg LEADING here)
        bookingUrl: z.string().max(2000).nullable().optional(),
        bookedAt: z.date().nullable().optional(),
        transportMode: z.enum(["walk", "transit", "train", "flight", "car"]).nullable().optional(),
        transportCents: z.number().int().min(0).nullable().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const { id, tripId, ...patch } = input;
      await requireEditor(tripId, ctx.user.id);
      // dayId is caller-supplied here too - same check as addStop, or a stop
      // can be re-pointed at another trip's day.
      if (patch.dayId != null) await assertDayInTrip(patch.dayId, tripId);
      // SCOPE THE WRITE TO THE AUTHORIZED TRIP. requireEditor only proves the
      // caller may edit `tripId` -- which the caller supplies. Without the
      // tripId predicate below, a user could pass their own tripId (passing the
      // check) plus a stranger's stop id (auto-increment, trivially enumerable)
      // and edit it. Same pattern applies to every by-id write in this router.
      await getDb()
        .update(schema.stops)
        .set(patch)
        .where(and(eq(schema.stops.id, id), eq(schema.stops.tripId, tripId)));
      return { ok: true };
    }),

  /**
   * r24-core: toggle a stop's booked state (paste the confirmation URL).
   * Convenience wrapper over updateStop so the client sends one intent.
   */
  markStopBooked: authedQuery
    .input(
      z.object({
        id: z.number(),
        tripId: z.number(),
        booked: z.boolean(),
        bookingUrl: z.string().max(2000).nullable().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await requireEditor(input.tripId, ctx.user.id);
      await getDb()
        .update(schema.stops)
        .set({
          bookedAt: input.booked ? new Date() : null,
          bookingUrl: input.booked ? (input.bookingUrl ?? null) : null,
        })
        .where(and(eq(schema.stops.id, input.id), eq(schema.stops.tripId, input.tripId)));
      // r24-social: booking progress shows up on the published trip's feed.
      if (input.booked) {
        const [stop] = await getDb()
          .select({ name: schema.stops.name })
          .from(schema.stops)
          .where(and(eq(schema.stops.id, input.id), eq(schema.stops.tripId, input.tripId)))
          .limit(1);
        if (stop) {
          const { autoPostBookingUpdate } = await import("./publish-router");
          await autoPostBookingUpdate(input.tripId, ctx.user.name ?? "A tripmate", stop.name, true);
          // r24-smart Q: +5 tokens per stop marked booked (once per stop).
          const { awardTokens } = await import("./lib/tokens");
          await awardTokens(ctx.user.id, "stop_booked", `booked:${input.id}`, { tripId: input.tripId });
        }
      }
      return { ok: true };
    }),

  deleteStop: authedQuery
    .input(z.object({ id: z.number(), tripId: z.number() }))
    .mutation(async ({ ctx, input }) => {
      await requireEditor(input.tripId, ctx.user.id);
      await getDb()
        .delete(schema.stops)
        .where(and(eq(schema.stops.id, input.id), eq(schema.stops.tripId, input.tripId)));
      return { ok: true };
    }),

  reorderStops: authedQuery
    .input(
      z.object({
        tripId: z.number(),
        moves: z.array(z.object({ id: z.number(), dayId: z.number().nullable(), position: z.number() })),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await requireEditor(input.tripId, ctx.user.id);
      const db = getDb();
      for (const m of input.moves) {
        if (m.dayId != null) await assertDayInTrip(m.dayId, input.tripId);
      }
      for (const m of input.moves) {
        await db
          .update(schema.stops)
          .set({ dayId: m.dayId, position: m.position })
          .where(and(eq(schema.stops.id, m.id), eq(schema.stops.tripId, input.tripId)));
      }
      return { ok: true };
    }),

  /**
   * Set how the traveler moves between a day's stops (walk | car | transit |
   * train). Persists trip_days.transportMode, then recomputes the day's leg
   * times/distances between consecutive stops with the mode's math and returns
   * them (leg times are derived values - the stops table has no leg columns,
   * so the client re-derives badges from transportMode + stop coordinates).
   */
  setDayTransportMode: authedQuery
    .input(
      z.object({
        tripId: z.number(),
        dayId: z.number(),
        mode: z.enum(["walk", "car", "transit", "train"]),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await requireEditor(input.tripId, ctx.user.id);
      const db = getDb();
      const [day] = await db.select().from(schema.tripDays).where(eq(schema.tripDays.id, input.dayId)).limit(1);
      if (!day || day.tripId !== input.tripId) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Day not in this trip" });
      }
      await db.update(schema.tripDays).set({ transportMode: input.mode }).where(eq(schema.tripDays.id, input.dayId));
      const dayStops = await dayStopsOrdered(input.tripId, input.dayId);
      const legs = await computeDayLegs(dayStops, input.mode);
      return { ok: true, dayId: input.dayId, mode: input.mode, legs };
    }),

  optimizeRoute: authedQuery
    .input(z.object({ tripId: z.number(), dayId: z.number() }))
    .mutation(async ({ ctx, input }) => {
      await requireEditor(input.tripId, ctx.user.id);
      const db = getDb();
      const [trip] = await db.select().from(schema.trips).where(eq(schema.trips.id, input.tripId)).limit(1);
      const ownerTier = await getTier(trip.ownerId);
      if (!TIERS[ownerTier].optimizeRoute) {
        throw new TRPCError({ code: "FORBIDDEN", message: "UPGRADE_REQUIRED" });
      }
      const dayStops = (
        await db.select().from(schema.stops).where(eq(schema.stops.tripId, input.tripId)).orderBy(asc(schema.stops.position))
      ).filter((s) => s.dayId === input.dayId && s.lat != null && s.lng != null);
      const mode = await dayTransportMode(input.tripId, input.dayId);
      if (dayStops.length < 3) {
        return { orderedIds: dayStops.map((s) => s.id), distanceKm: 0, savedKm: 0, changed: false, transportMode: mode, legs: [] as DayLeg[] };
      }
      const pts: Pt[] = dayStops.map((s) => ({ id: s.id, lat: s.lat!, lng: s.lng! }));
      const before = routeDistance(pts);
      // Real road-network routing on the day's transport profile, haversine fallback
      const matrix = await osrmDurationMatrix(pts, osrmProfileForMode(mode));
      const order = optimizeWithMatrix(pts, matrix);
      const distKm = routeDistance(order);
      const changed = order.some((p, i) => p.id !== pts[i].id);
      if (changed) {
        for (let i = 0; i < order.length; i++) {
          await db.update(schema.stops).set({ position: i }).where(eq(schema.stops.id, order[i].id));
        }
      }
      // Leg estimates for the new order, computed with the day's mode math.
      const legs = await computeDayLegs(order, mode);
      return {
        orderedIds: order.map((p) => p.id),
        distanceKm: Math.round(distKm * 10) / 10,
        savedKm: Math.max(0, Math.round((before - distKm) * 10) / 10),
        changed,
        transportMode: mode,
        legs,
      };
    }),

  /**
   * Per-day route optimization (Voyager): reorder ONE day's stops with the
   * OSRM TSP machinery (foot profile - in-day walking), then rewrite positions
   * AND start times on the day cadence, keeping food slots sensible
   * (lunch ~12:30, dinner ~19:00).
   */
  optimizeDay: authedQuery
    .input(z.object({ tripId: z.number(), dayId: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const tier = await getTier(ctx.user.id);
      if (tier !== "voyager") {
        throw new TRPCError({ code: "FORBIDDEN", message: "UPGRADE_REQUIRED" });
      }
      await requireEditor(input.tripId, ctx.user.id);
      const db = getDb();
      const dayStops = (
        await db.select().from(schema.stops).where(eq(schema.stops.tripId, input.tripId)).orderBy(asc(schema.stops.position))
      ).filter((s) => s.dayId === input.dayId);
      const mode = await dayTransportMode(input.tripId, input.dayId);
      if (dayStops.length < 2) {
        return { stops: dayStops.map((s, i) => ({ id: s.id, position: i, startTime: s.startTime })), transportMode: mode, legs: [] as DayLeg[] };
      }
      const geo = dayStops.filter((s) => s.lat != null && s.lng != null);
      const unlocated = dayStops.filter((s) => s.lat == null || s.lng == null);
      let ordered = geo;
      if (geo.length >= 3) {
        const pts: Pt[] = geo.map((s) => ({ id: s.id, lat: s.lat!, lng: s.lng! }));
        // TSP on the day's transport profile (walk→foot, car/transit/train→driving)
        const matrix = await osrmDurationMatrix(pts, osrmProfileForMode(mode));
        const byId = new Map(geo.map((s) => [s.id, s]));
        ordered = optimizeWithMatrix(pts, matrix).map((p) => byId.get(p.id)!);
      }
      // Slot times: food stops hold the food slots (lunch 12:30, dinner 19:00,
      // late 21:15) in TSP order; everything else fills the remaining cadence.
      const FOOD_SLOTS = ["12:30", "19:00", "21:15"];
      const timeOf = new Map<number, string>();
      const taken = new Set<string>();
      const foods = ordered.filter((s) => s.category === "food");
      const others = ordered.filter((s) => s.category !== "food");
      foods.forEach((s, i) => {
        const t = FOOD_SLOTS[i] ?? SLOT_TIMES.find((x) => !taken.has(x)) ?? "21:15";
        timeOf.set(s.id, t);
        taken.add(t);
      });
      const freeSlots = SLOT_TIMES.filter((t) => !taken.has(t));
      others.forEach((s, i) => {
        timeOf.set(s.id, freeSlots[i] ?? freeSlots[freeSlots.length - 1] ?? "21:15");
      });
      const timed = [...ordered].sort((a, b) => timeOf.get(a.id)!.localeCompare(timeOf.get(b.id)!));
      const finalStops = [...timed, ...unlocated];
      const result = finalStops.map((s, i) => ({
        id: s.id,
        position: i,
        startTime: timeOf.get(s.id) ?? s.startTime,
      }));
      for (const r of result) {
        await db.update(schema.stops).set({ position: r.position, startTime: r.startTime }).where(eq(schema.stops.id, r.id));
      }
      // Leg estimates for the rewritten order, computed with the day's mode math.
      const legs = await computeDayLegs(finalStops, mode);
      // r24-smart Q: optimizing a day finalizes its route plan (+10, once per day).
      {
        const { awardTokens } = await import("./lib/tokens");
        await awardTokens(ctx.user.id, "day_finalized", `dayfinal:${input.dayId}`, { tripId: input.tripId });
      }
      return { stops: result, transportMode: mode, legs };
    }),

  // ── Expenses ─────────────────────────────────────────────────────────────
  // ── Settlements (r25) ────────────────────────────────────────────────────
  /**
   * "X paid Y back." Previously this lived in component state, so it vanished
   * on refresh and nobody else on the trip ever saw it. For a group-expense
   * feature this is the one record that has to be durable - it's the moment
   * real money moved.
   */
  settlements: authedQuery
    .input(z.object({ tripId: z.number() }))
    .query(async ({ ctx, input }) => {
      await requireMembership(input.tripId, ctx.user.id);
      return getDb()
        .select()
        .from(schema.settlements)
        .where(eq(schema.settlements.tripId, input.tripId))
        .orderBy(asc(schema.settlements.id));
    }),

  addSettlement: authedQuery
    .input(
      z.object({
        tripId: z.number(),
        fromMemberId: z.number(),
        toMemberId: z.number(),
        amountCents: z.number().int().positive(),
        note: z.string().max(255).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await requireEditor(input.tripId, ctx.user.id);
      if (input.fromMemberId === input.toMemberId) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "A member cannot settle with themselves" });
      }
      const db = getDb();
      // Both members must belong to THIS trip - ids are enumerable, and a
      // settlement pointing at a stranger's member row would corrupt the
      // balance maths for two different trips at once.
      const members = await db
        .select({ id: schema.tripMembers.id })
        .from(schema.tripMembers)
        .where(
          and(
            eq(schema.tripMembers.tripId, input.tripId),
            inArray(schema.tripMembers.id, [input.fromMemberId, input.toMemberId]),
          ),
        );
      if (members.length !== 2) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Both members must belong to this trip" });
      }
      const [trip] = await db.select().from(schema.trips).where(eq(schema.trips.id, input.tripId)).limit(1);
      if (!trip) throw new TRPCError({ code: "NOT_FOUND", message: "Trip not found" });

      const result = await db.insert(schema.settlements).values({
        tripId: input.tripId,
        fromMemberId: input.fromMemberId,
        toMemberId: input.toMemberId,
        amountCents: input.amountCents,
        currency: trip.homeCurrency,
        note: input.note ?? null,
        recordedById: ctx.user.id,
      });
      return { id: Number(result[0].insertId) };
    }),

  deleteSettlement: authedQuery
    .input(z.object({ id: z.number(), tripId: z.number() }))
    .mutation(async ({ ctx, input }) => {
      await requireEditor(input.tripId, ctx.user.id);
      await getDb()
        .delete(schema.settlements)
        .where(and(eq(schema.settlements.id, input.id), eq(schema.settlements.tripId, input.tripId)));
      return { ok: true };
    }),

  addExpense: authedQuery
    .input(
      z.object({
        tripId: z.number(),
        title: z.string().min(1).max(255),
        category: z.string().default("other"),
        amountCents: z.number().int().positive(),
        currency: z.string().length(3),
        date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        paidById: z.number(),
        splitMemberIds: z.array(z.number()).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await requireEditor(input.tripId, ctx.user.id);
      const db = getDb();
      const [trip] = await db.select().from(schema.trips).where(eq(schema.trips.id, input.tripId)).limit(1);
      // r27: live rates. homeCents is PERSISTED and drives every balance and
      // settle-up figure on the trip, so converting it with a stale hardcoded
      // table baked the error permanently into the ledger.
      const { rates } = await getRates();
      const homeCents = convertCents(input.amountCents, input.currency, trip.homeCurrency, rates);
      const result = await db.insert(schema.expenses).values({
        tripId: input.tripId,
        paidById: input.paidById,
        title: input.title,
        category: input.category,
        amountCents: input.amountCents,
        currency: input.currency,
        homeCents,
        date: input.date,
      });
      const expenseId = Number(result[0].insertId);
      let memberIds = input.splitMemberIds;
      if (!memberIds?.length) {
        const members = await db.select().from(schema.tripMembers).where(eq(schema.tripMembers.tripId, input.tripId));
        memberIds = members.map((m) => m.id);
      }
      if (memberIds.length) {
        const base = Math.floor(homeCents / memberIds.length);
        let remainder = homeCents - base * memberIds.length;
        await db.insert(schema.expenseSplits).values(
          memberIds.map((memberId) => ({
            expenseId,
            memberId,
            shareCents: base + (remainder-- > 0 ? 1 : 0),
          })),
        );
      }
      return { id: expenseId, homeCents };
    }),

  updateExpense: authedQuery
    .input(
      z.object({
        id: z.number(),
        tripId: z.number(),
        title: z.string().min(1).max(255).optional(),
        category: z.string().optional(),
        amountCents: z.number().int().positive().optional(),
        currency: z.string().length(3).optional(),
        date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
        paidById: z.number().optional(),
        splitMemberIds: z.array(z.number()).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const { id, tripId, splitMemberIds, ...patch } = input;
      await requireEditor(tripId, ctx.user.id);
      const db = getDb();
      if (patch.amountCents || patch.currency) {
        const [trip] = await db.select().from(schema.trips).where(eq(schema.trips.id, tripId)).limit(1);
        const [existing] = await db
          .select()
          .from(schema.expenses)
          .where(and(eq(schema.expenses.id, id), eq(schema.expenses.tripId, tripId)))
          .limit(1);
        if (!existing) throw new TRPCError({ code: "NOT_FOUND", message: "Expense not found on this trip" });
        const amount = patch.amountCents ?? existing.amountCents;
        const currency = patch.currency ?? existing.currency;
        const { rates } = await getRates();
        (patch as Record<string, unknown>).homeCents = convertCents(amount, currency, trip.homeCurrency, rates);
      }
      await db
        .update(schema.expenses)
        .set(patch)
        .where(and(eq(schema.expenses.id, id), eq(schema.expenses.tripId, tripId)));
      if (splitMemberIds) {
        const [expense] = await db
          .select()
          .from(schema.expenses)
          .where(and(eq(schema.expenses.id, id), eq(schema.expenses.tripId, tripId)))
          .limit(1);
        if (!expense) throw new TRPCError({ code: "NOT_FOUND", message: "Expense not found on this trip" });
        await db.delete(schema.expenseSplits).where(eq(schema.expenseSplits.expenseId, id));
        if (splitMemberIds.length) {
          const base = Math.floor(expense.homeCents / splitMemberIds.length);
          let remainder = expense.homeCents - base * splitMemberIds.length;
          await db.insert(schema.expenseSplits).values(
            splitMemberIds.map((memberId) => ({
              expenseId: id,
              memberId,
              shareCents: base + (remainder-- > 0 ? 1 : 0),
            })),
          );
        }
      }
      return { ok: true };
    }),

  deleteExpense: authedQuery
    .input(z.object({ id: z.number(), tripId: z.number() }))
    .mutation(async ({ ctx, input }) => {
      await requireEditor(input.tripId, ctx.user.id);
      const db = getDb();
      // Confirm the expense belongs to the authorized trip BEFORE touching its
      // splits -- otherwise the splits of a stranger's expense get deleted even
      // though the expense row itself survives the scoped delete below.
      const [owned] = await db
        .select({ id: schema.expenses.id })
        .from(schema.expenses)
        .where(and(eq(schema.expenses.id, input.id), eq(schema.expenses.tripId, input.tripId)))
        .limit(1);
      if (!owned) throw new TRPCError({ code: "NOT_FOUND", message: "Expense not found on this trip" });
      await db.delete(schema.expenseSplits).where(eq(schema.expenseSplits.expenseId, input.id));
      await db
        .delete(schema.expenses)
        .where(and(eq(schema.expenses.id, input.id), eq(schema.expenses.tripId, input.tripId)));
      return { ok: true };
    }),

  // ── Reservations ─────────────────────────────────────────────────────────
  addReservation: authedQuery
    .input(
      z.object({
        tripId: z.number(),
        type: z.string().max(24),
        title: z.string().min(1).max(255),
        provider: z.string().max(255).optional(),
        confirmationCode: z.string().max(64).optional(),
        startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
        endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
        details: z.string().optional(),
        amountCents: z.number().int().optional(),
        currency: z.string().length(3).optional(),
        paidById: z.number().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await requireEditor(input.tripId, ctx.user.id);
      const result = await getDb().insert(schema.reservations).values({
        tripId: input.tripId,
        type: input.type,
        title: input.title,
        provider: input.provider ?? null,
        confirmationCode: input.confirmationCode ?? null,
        startDate: input.startDate ?? null,
        endDate: input.endDate ?? null,
        details: input.details ?? null,
        amountCents: input.amountCents ?? null,
        currency: input.currency ?? null,
        paidById: input.paidById ?? null,
      });
      return { id: Number(result[0].insertId) };
    }),

  /**
   * Email-import (Voyager): parse a forwarded booking confirmation email and
   * create a reservation with extracted fields. Real Gmail sync needs Google
   * OAuth credentials; this is the functional forward/paste pipeline.
   */
  importEmail: authedQuery
    .input(z.object({ tripId: z.number(), text: z.string().min(20).max(20000), paidById: z.number().optional() }))
    .mutation(async ({ ctx, input }) => {
      await requireEditor(input.tripId, ctx.user.id);
      const db = getDb();
      const [trip] = await db.select().from(schema.trips).where(eq(schema.trips.id, input.tripId)).limit(1);
      const ownerTier = await getTier(trip.ownerId);
      if (!TIERS[ownerTier].emailImport) {
        throw new TRPCError({ code: "FORBIDDEN", message: "UPGRADE_REQUIRED" });
      }
      const parsed = parseConfirmationEmail(input.text);
      const result = await db.insert(schema.reservations).values({
        tripId: input.tripId,
        type: parsed.type,
        title: parsed.title,
        provider: parsed.provider,
        confirmationCode: parsed.confirmationCode,
        startDate: parsed.startDate,
        endDate: parsed.endDate,
        details: parsed.details,
        amountCents: parsed.amountCents,
        currency: parsed.currency,
        paidById: input.paidById ?? null,
        source: "email-import",
      });
      return { id: Number(result[0].insertId), parsed };
    }),

  deleteReservation: authedQuery
    .input(z.object({ id: z.number(), tripId: z.number() }))
    .mutation(async ({ ctx, input }) => {
      await requireEditor(input.tripId, ctx.user.id);
      await getDb()
        .delete(schema.reservations)
        .where(and(eq(schema.reservations.id, input.id), eq(schema.reservations.tripId, input.tripId)));
      return { ok: true };
    }),

  // ── Checklist ────────────────────────────────────────────────────────────
  addChecklistItem: authedQuery
    .input(z.object({ tripId: z.number(), list: z.string().max(24), label: z.string().min(1).max(255) }))
    .mutation(async ({ ctx, input }) => {
      await requireEditor(input.tripId, ctx.user.id);
      const result = await getDb().insert(schema.checklistItems).values({
        tripId: input.tripId,
        list: input.list,
        label: input.label,
      });
      return { id: Number(result[0].insertId) };
    }),

  toggleChecklistItem: authedQuery
    .input(z.object({ id: z.number(), tripId: z.number(), done: z.boolean() }))
    .mutation(async ({ ctx, input }) => {
      await requireEditor(input.tripId, ctx.user.id);
      await getDb()
        .update(schema.checklistItems)
        .set({ done: input.done })
        .where(and(eq(schema.checklistItems.id, input.id), eq(schema.checklistItems.tripId, input.tripId)));
      return { ok: true };
    }),

  deleteChecklistItem: authedQuery
    .input(z.object({ id: z.number(), tripId: z.number() }))
    .mutation(async ({ ctx, input }) => {
      await requireEditor(input.tripId, ctx.user.id);
      await getDb()
        .delete(schema.checklistItems)
        .where(and(eq(schema.checklistItems.id, input.id), eq(schema.checklistItems.tripId, input.tripId)));
      return { ok: true };
    }),

  // ── Notes ────────────────────────────────────────────────────────────────
  saveNote: authedQuery
    .input(z.object({ tripId: z.number(), title: z.string().max(255).optional(), content: z.string() }))
    .mutation(async ({ ctx, input }) => {
      await requireEditor(input.tripId, ctx.user.id);
      const db = getDb();
      const existing = await db.select().from(schema.tripNotes).where(eq(schema.tripNotes.tripId, input.tripId)).limit(1);
      if (existing[0]) {
        await db
          .update(schema.tripNotes)
          .set({ title: input.title ?? existing[0].title, content: input.content })
          .where(eq(schema.tripNotes.id, existing[0].id));
      } else {
        await db.insert(schema.tripNotes).values({ tripId: input.tripId, title: input.title ?? "Notes", content: input.content });
      }
      return { ok: true };
    }),

  // ── Hotel home base (Voyager) ────────────────────────────────────────────
  /**
   * Set/replace the trip's hotel - the "home base" day routes anchor to.
   * Voyager-only; trip owner or editor (viewers are read-only).
   */
  setHotel: authedQuery
    .input(
      z.object({
        tripId: z.number(),
        name: z.string().min(1).max(255),
        address: z.string().max(512).optional(),
        lat: z.number().min(-90).max(90),
        lng: z.number().min(-180).max(180),
        source: z.enum(["manual", "email"]),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const tier = await getTier(ctx.user.id);
      if (tier !== "voyager") {
        throw new TRPCError({ code: "FORBIDDEN", message: "UPGRADE_REQUIRED" });
      }
      const member = await requireMembership(input.tripId, ctx.user.id);
      if (member.role === "viewer") {
        throw new TRPCError({ code: "FORBIDDEN", message: "Viewers cannot edit this trip" });
      }
      await getDb()
        .update(schema.trips)
        .set({
          hotelName: input.name,
          hotelAddress: input.address ?? null,
          hotelLat: input.lat,
          hotelLng: input.lng,
          hotelSource: input.source,
        })
        .where(eq(schema.trips.id, input.tripId));
      return { ok: true };
    }),

  /** Remove the trip's hotel home base. Voyager-only; owner or editor. */
  clearHotel: authedQuery
    .input(z.object({ tripId: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const tier = await getTier(ctx.user.id);
      if (tier !== "voyager") {
        throw new TRPCError({ code: "FORBIDDEN", message: "UPGRADE_REQUIRED" });
      }
      const member = await requireMembership(input.tripId, ctx.user.id);
      if (member.role === "viewer") {
        throw new TRPCError({ code: "FORBIDDEN", message: "Viewers cannot edit this trip" });
      }
      await getDb()
        .update(schema.trips)
        .set({ hotelName: null, hotelAddress: null, hotelLat: null, hotelLng: null, hotelSource: null })
        .where(eq(schema.trips.id, input.tripId));
      return { ok: true };
    }),

  /**
   * Parse a pasted hotel booking-confirmation email (Booking.com, Agoda,
   * Expedia, Airbnb, Hotels.com, …) into a candidate property name + city,
   * then geocode candidates with Photon, biased toward the trip destination.
   * Defensive: unparseable input returns empty candidates, never an error.
   * The user confirms a candidate, then the client calls setHotel('email').
   */
  parseHotelEmail: authedQuery
    .input(z.object({ tripId: z.number(), text: z.string().min(20).max(20000) }))
    .mutation(async ({ ctx, input }) => {
      const tier = await getTier(ctx.user.id);
      if (tier !== "voyager") {
        throw new TRPCError({ code: "FORBIDDEN", message: "UPGRADE_REQUIRED" });
      }
      await requireMembership(input.tripId, ctx.user.id);
      const db = getDb();
      const [trip] = await db.select().from(schema.trips).where(eq(schema.trips.id, input.tripId)).limit(1);
      if (!trip) throw new TRPCError({ code: "NOT_FOUND" });

      const parsed = extractHotelFromEmail(input.text);
      if (!parsed.rawName) return { candidates: [], parsed };

      // Geocode the parsed name, biased to the trip's destination city.
      const dest = trip.destination.split(",")[0].trim();
      const near = await geocodeCity(dest).catch(() => null);
      const queries = [
        parsed.rawCity ? `${parsed.rawName} ${parsed.rawCity}` : `${parsed.rawName} ${dest}`,
        `${parsed.rawName} ${dest}`,
        parsed.rawName,
      ];
      let hits: Awaited<ReturnType<typeof searchPhoton>> = [];
      for (const q of [...new Set(queries)]) {
        try {
          hits = await searchPhoton(q, near ?? undefined, 6);
        } catch {
          hits = []; // Photon down/rate-limited → try the next phrasing
        }
        if (hits.length) break;
      }
      const seen = new Set<string>();
      const candidates = hits
        .filter((h) => {
          const key = `${h.name.trim().toLowerCase()}|${h.lat.toFixed(3)}|${h.lng.toFixed(3)}`;
          if (seen.has(key)) return false;
          seen.add(key);
          return true;
        })
        .slice(0, 5)
        .map((h) => ({
          name: h.name,
          address: [h.address, h.city, h.country].filter(Boolean).join(", ").slice(0, 512),
          lat: h.lat,
          lng: h.lng,
        }));
      return { candidates, parsed };
    }),

  /**
   * Plan ONE day anchored at the hotel (Voyager). Empty days are filled from
   * the explore corpus near the hotel city (same machinery as generateDay);
   * the day's stops are then ordered as a nearest-neighbor + 2-opt loop that
   * STARTS at the hotel and ENDS back at the hotel (OSRM driving matrix),
   * and re-timed on the SLOT_TIMES cadence like optimizeDay. Requires the
   * hotel to be set (HOTEL_REQUIRED otherwise).
   */
  planDayFromHotel: authedQuery
    .input(z.object({ tripId: z.number(), dayId: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const db = getDb();
      const tier = await getTier(ctx.user.id);
      if (tier !== "voyager") {
        throw new TRPCError({ code: "FORBIDDEN", message: "UPGRADE_REQUIRED" });
      }
      await requireEditor(input.tripId, ctx.user.id);
      const [trip] = await db.select().from(schema.trips).where(eq(schema.trips.id, input.tripId)).limit(1);
      if (!trip) throw new TRPCError({ code: "NOT_FOUND" });
      const [day] = await db.select().from(schema.tripDays).where(eq(schema.tripDays.id, input.dayId)).limit(1);
      if (!day || day.tripId !== input.tripId) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Day not in this trip" });
      }

      // ── Lodging anchors: the day's own hotel wins; otherwise the trip's
      // home base. The route STARTS at this day's lodging and ENDS at the
      // NEXT day's lodging when that day has its own hotel set (per-day
      // mode) - otherwise it loops back to the start anchor (same-hotel).
      const tripHotelSet = !!trip.hotelName && trip.hotelLat != null && trip.hotelLng != null;
      const dayHotelSet = !!day.hotelName && day.hotelLat != null && day.hotelLng != null;
      if (!tripHotelSet && !dayHotelSet) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "HOTEL_REQUIRED" });
      }
      const startAnchor: Pt = dayHotelSet
        ? { id: -2, lat: day.hotelLat!, lng: day.hotelLng! }
        : { id: -1, lat: trip.hotelLat!, lng: trip.hotelLng! };
      const startHotelName = dayHotelSet ? day.hotelName! : trip.hotelName!;
      let endAnchor = startAnchor;
      let endHotelName = startHotelName;
      if (dayHotelSet) {
        const allDays = await db
          .select()
          .from(schema.tripDays)
          .where(eq(schema.tripDays.tripId, input.tripId))
          .orderBy(asc(schema.tripDays.position));
        const nextDay = allDays.find((d) => d.position > day.position);
        if (nextDay?.hotelName && nextDay.hotelLat != null && nextDay.hotelLng != null) {
          endAnchor = { id: -3, lat: nextDay.hotelLat, lng: nextDay.hotelLng };
          endHotelName = nextDay.hotelName;
        }
      }
      const hotel = startAnchor; // fill/empty-day proximity + summary anchor below

      const stopsOfDay = async () =>
        (
          await db.select().from(schema.stops).where(eq(schema.stops.tripId, input.tripId)).orderBy(asc(schema.stops.position))
        ).filter((s) => s.dayId === day.id);
      let dayStops = await stopsOfDay();

      // Empty day → suggest stops from the explore corpus near the hotel city.
      let stopsPlanned = 0;
      if (!dayStops.length) {
        const dest = trip.destination.split(",")[0].trim();
        const candidates = await fetchDestinationCandidates(dest, true);
        const allStops = await db.select().from(schema.stops).where(eq(schema.stops.tripId, input.tripId));
        const takenNames = new Set(allStops.map((s) => s.name.trim().toLowerCase()));
        const fresh = candidates.filter((p) => !takenNames.has(p.name.trim().toLowerCase()));
        if (!fresh.length) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "NO_NEW_PLACES" });
        }
        // Prefer places within ~25km of the hotel when that keeps a healthy pool.
        const nearHotel = fresh.filter(
          (p) => p.lat != null && p.lng != null && haversineKm(hotel.lat, hotel.lng, p.lat, p.lng) <= 25,
        );
        const nearPool = nearHotel.length >= 4 ? nearHotel : fresh;
        const prefRows = await db
          .select()
          .from(schema.preferences)
          .where(eq(schema.preferences.userId, ctx.user.id))
          .limit(1);
        const userStyles = profileStyles(prefRows[0]);
        const dietary = parseDietary(prefRows[0]?.dietary);
        const { pool, relaxedIds } = budgetCapPool(nearPool, undefined);
        const ranked = rankPlaces(pool, userStyles, undefined, relaxedIds);
        const dietUnverifiedIds = new Set<number>();
        const picks = await buildDayPicks({ ranked, used: new Set(), slots: 4, dietary, dietUnverifiedIds });
        stopsPlanned = await insertDayStops({ tripId: input.tripId, dayId: day.id, picks, dietUnverifiedIds });
        dayStops = await stopsOfDay();
      }

      const geo = dayStops.filter((s) => s.lat != null && s.lng != null);
      const unlocated = dayStops.filter((s) => s.lat == null || s.lng == null);
      if (!geo.length) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "NO_LOCATED_STOPS" });
      }

      // Order: NN + 2-opt path from the start anchor to the end anchor
      // (OSRM driving, haversine fallback). Same anchor both ends → loop.
      const pts: Pt[] = geo.map((s) => ({ id: s.id, lat: s.lat!, lng: s.lng! }));
      const anchorPts = endAnchor.id === startAnchor.id ? [startAnchor] : [startAnchor, endAnchor];
      const matrix = await osrmDurationMatrix([...anchorPts, ...pts], "driving");
      const byId = new Map(geo.map((s) => [s.id, s]));
      const ordered = chainBetweenAnchors(startAnchor, endAnchor, pts, matrix).map((p) => byId.get(p.id)!);

      // Times on the SLOT_TIMES cadence (optimizeDay pattern): food stops hold
      // the meal slots in chain order; everything else fills the remaining cadence.
      const FOOD_SLOTS = ["12:30", "19:00", "21:15"];
      const timeOf = new Map<number, string>();
      const taken = new Set<string>();
      const foods = ordered.filter((s) => s.category === "food");
      const others = ordered.filter((s) => s.category !== "food");
      foods.forEach((s, i) => {
        const t = FOOD_SLOTS[i] ?? SLOT_TIMES.find((x) => !taken.has(x)) ?? "21:15";
        timeOf.set(s.id, t);
        taken.add(t);
      });
      const freeSlots = SLOT_TIMES.filter((t) => !taken.has(t));
      others.forEach((s, i) => {
        timeOf.set(s.id, freeSlots[i] ?? freeSlots[freeSlots.length - 1] ?? "21:15");
      });
      const timed = [...ordered].sort((a, b) => timeOf.get(a.id)!.localeCompare(timeOf.get(b.id)!));
      const finalStops = [...timed, ...unlocated];
      for (let i = 0; i < finalStops.length; i++) {
        await db
          .update(schema.stops)
          .set({ position: i, startTime: timeOf.get(finalStops[i].id) ?? finalStops[i].startTime })
          .where(eq(schema.stops.id, finalStops[i].id));
      }

      // Summary: km from start anchor through the stops to the end anchor +
      // the driving legs from the lodging to stop #1 and on to the end anchor.
      const first = timed[0];
      const last = timed[timed.length - 1]!;
      const matrixIdx = new Map([...anchorPts, ...pts].map((p, i) => [p.id, i]));
      const legSec = matrix?.[matrixIdx.get(startAnchor.id)!]?.[matrixIdx.get(first.id)!];
      const legsFromHotel =
        typeof legSec === "number" && isFinite(legSec)
          ? Math.max(1, Math.round(legSec / 60))
          : Math.max(1, Math.round((haversineKm(startAnchor.lat, startAnchor.lng, first.lat!, first.lng!) / 30) * 60));
      const endSec = matrix?.[matrixIdx.get(last.id)!]?.[matrixIdx.get(endAnchor.id)!];
      const legsToEnd =
        typeof endSec === "number" && isFinite(endSec)
          ? Math.max(1, Math.round(endSec / 60))
          : Math.max(1, Math.round((haversineKm(last.lat!, last.lng!, endAnchor.lat, endAnchor.lng) / 30) * 60));
      let totalKm = 0;
      let prev = startAnchor;
      for (const s of timed) {
        totalKm += haversineKm(prev.lat, prev.lng, s.lat!, s.lng!);
        prev = { id: s.id, lat: s.lat!, lng: s.lng! };
      }
      totalKm += haversineKm(prev.lat, prev.lng, endAnchor.lat, endAnchor.lng);
      return {
        dayId: day.id,
        stopsPlanned,
        totalKm: Math.round(totalKm * 10) / 10,
        firstStop: first.name,
        legsFromHotel,
        startHotelName,
        endHotelName,
        legsToEnd,
      };
    }),

  // ── Per-day lodging (Voyager) ────────────────────────────────────────────
  /**
   * Set/replace ONE night's hotel on a specific trip day (per-day lodging
   * mode - when the traveler changes hotels during the trip). Voyager-only;
   * trip owner or editor.
   */
  setDayHotel: authedQuery
    .input(
      z.object({
        tripId: z.number(),
        dayId: z.number(),
        name: z.string().min(1).max(255),
        address: z.string().max(512).optional(),
        lat: z.number().min(-90).max(90),
        lng: z.number().min(-180).max(180),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const tier = await getTier(ctx.user.id);
      if (tier !== "voyager") {
        throw new TRPCError({ code: "FORBIDDEN", message: "UPGRADE_REQUIRED" });
      }
      await requireEditor(input.tripId, ctx.user.id);
      const db = getDb();
      const [day] = await db.select().from(schema.tripDays).where(eq(schema.tripDays.id, input.dayId)).limit(1);
      if (!day || day.tripId !== input.tripId) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Day not in this trip" });
      }
      await db
        .update(schema.tripDays)
        .set({
          hotelName: input.name,
          hotelAddress: input.address ?? null,
          hotelLat: input.lat,
          hotelLng: input.lng,
        })
        .where(eq(schema.tripDays.id, input.dayId));
      return { ok: true };
    }),

  /** Remove one night's hotel from a trip day. Voyager-only; owner or editor. */
  clearDayHotel: authedQuery
    .input(z.object({ tripId: z.number(), dayId: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const tier = await getTier(ctx.user.id);
      if (tier !== "voyager") {
        throw new TRPCError({ code: "FORBIDDEN", message: "UPGRADE_REQUIRED" });
      }
      await requireEditor(input.tripId, ctx.user.id);
      const db = getDb();
      const [day] = await db.select().from(schema.tripDays).where(eq(schema.tripDays.id, input.dayId)).limit(1);
      if (!day || day.tripId !== input.tripId) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Day not in this trip" });
      }
      await db
        .update(schema.tripDays)
        .set({ hotelName: null, hotelAddress: null, hotelLat: null, hotelLng: null })
        .where(eq(schema.tripDays.id, input.dayId));
      return { ok: true };
    }),

  /**
   * Derived lodging plan for the trip (member-readable): 'perday' as soon as
   * any night has its own hotel, 'same' when only the trip home base is set,
   * 'none' otherwise. Drives the collapsed lodging pill + route anchors.
   */
  lodgingPlan: authedQuery
    .input(z.object({ tripId: z.number() }))
    .query(async ({ ctx, input }) => {
      await requireMembership(input.tripId, ctx.user.id);
      const db = getDb();
      const [trip] = await db.select().from(schema.trips).where(eq(schema.trips.id, input.tripId)).limit(1);
      if (!trip) throw new TRPCError({ code: "NOT_FOUND" });
      const days = await db
        .select()
        .from(schema.tripDays)
        .where(eq(schema.tripDays.tripId, input.tripId))
        .orderBy(asc(schema.tripDays.position));
      const tripHotel =
        trip.hotelName && trip.hotelLat != null && trip.hotelLng != null
          ? { name: trip.hotelName, address: trip.hotelAddress, lat: trip.hotelLat, lng: trip.hotelLng }
          : null;
      const dayHotels = days
        .filter((d) => !!d.hotelName)
        .map((d) => ({ dayId: d.id, date: d.date, hotelName: d.hotelName! }));
      const mode = dayHotels.length ? ("perday" as const) : tripHotel ? ("same" as const) : ("none" as const);
      return { mode, tripHotel, dayHotels };
    }),
});

// ─── Hotel helpers (email parse + hotel-anchored loop routing) ──────────────

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Heuristic hotel name/city extraction from a pasted booking confirmation.
 * Covers labeled lines ("Hotel:", "Property:", "Stay:", "Accommodation:",
 * "Check-in at") and sender phrasing from Booking.com, Agoda, Expedia,
 * Airbnb and Hotels.com, with a proper-noun fallback ("… Hotel/Ryokan/…").
 * Never throws - null fields when nothing looks like a stay.
 */
function extractHotelFromEmail(raw: string): { rawName: string | null; rawCity: string | null } {
  try {
    const text = raw.replace(/\r/g, "\n").replace(/\t/g, " ");
    const clean = (s: string) =>
      s
        .replace(/\s+/g, " ")
        .split(/\s+[\u2014–]\s+/)[0]! // drop " - Confirmation №…" tails
        .replace(/\s*(?:confirmation|booking|reservation)\s*(?:number|code|#).*$/i, "")
        .replace(/[.,;:]+$/, "")
        .trim()
        .slice(0, 120);

    let rawName: string | null = null;
    let rawCity: string | null = null;

    // 1) Labeled lines - strongest signal (plain-text forwards).
    const labeled =
      text.match(/(?:^|\n)\s*(?:hotel|property|accommodation|lodging|stay)\s*(?:name)?\s*[:\-–]\s*([^\n]{3,120})/i) ??
      text.match(/check[- ]in\s+at\s*[:-]?\s*([^\n]{3,120})/i);
    if (labeled?.[1]) rawName = clean(labeled[1]);

    // 2) Sender phrasing (Booking.com / Agoda / Expedia / Airbnb / Hotels.com).
    if (!rawName) {
      const phrased =
        text.match(/your\s+booking\s+at\s+([^\n,.]{3,120}?)\s+(?:is|has\s+been)\s+confirmed/i) ?? // booking.com
        text.match(/booking\s+confirmation\s*[:\-–]\s*([^\n]{3,120})/i) ?? // agoda subject style
        text.match(/hotel\s+reservation\s+at\s+([^\n,.]{3,120})/i) ?? // expedia
        text.match(/confirmation\s+for\s+([^\n,.]{3,120}?)(?:\s+is\s+here)?\s*[\n,.]/i) ?? // hotels.com
        text.match(/you(?:'|’)re\s+(?:staying|going)\s+(?:at|to)\s+([^\n,.]{3,120})/i) ?? // airbnb
        text.match(/your\s+(?:stay|reservation)\s+at\s+([^\n,.]{3,120})/i);
      if (phrased?.[1]) rawName = clean(phrased[1]);
    }

    // 3) Proper-noun fallback: "<Capitalized words> Hotel/Ryokan/Resort/…".
    if (!rawName) {
      const proper = text.match(
        /\b((?:[A-Z][A-Za-z0-9'&.-]*\s+){0,4}[A-Z][A-Za-z0-9'&.-]*\s+(?:Hotel|Ryokan|Resort|Hostel|Suites|Inn|Lodge))\b/,
      );
      if (proper?.[1]) rawName = clean(proper[1]);
    }

    // City: a "City:"/"Destination:" label, "<name> … in <City>", or ", <City>".
    const cityM =
      text.match(/(?:^|\n)\s*(?:city|destination)\s*[:\-–]\s*([A-Za-zÀ-ÿ' -]{2,60})/i) ??
      (rawName
        ? text.match(new RegExp(`${escapeRegExp(rawName)}[^\\n]{0,40}?\\bin\\s+([A-Z][A-Za-zÀ-ÿ' -]{1,40})`, "i"))
        : null) ??
      text.match(/\bin\s+([A-Z][A-Za-zÀ-ÿ'-]{2,40})\s*[,\n]/);
    if (cityM?.[1]) rawCity = clean(cityM[1]).slice(0, 60);

    // "<Name>, <City>" captured in one blob → split the city off.
    if (rawName) {
      const comma = rawName.match(/^([^,]{3,80}),\s*([A-Za-zÀ-ÿ' -]{2,40})$/);
      if (comma) {
        rawName = clean(comma[1]);
        rawCity = rawCity ?? clean(comma[2]);
      }
    }
    return { rawName: rawName || null, rawCity: rawCity || null };
  } catch {
    return { rawName: null, rawCity: null };
  }
}

/**
 * Nearest-neighbor chain + 2-opt over a cost matrix between two lodging
 * anchors: the chain STARTS at `start` (this night's hotel) and the 2-opt
 * path cost counts the onward leg to `end` (the NEXT night's hotel when the
 * traveler changes lodging - `start` itself otherwise, i.e. the classic
 * hotel→…→hotel loop). `matrix` (when present) is indexed
 * [start, (end when distinct), ...points]; anchors are not in the chain.
 */
function chainBetweenAnchors(start: Pt, end: Pt, points: Pt[], matrix: number[][] | null): Pt[] {
  if (points.length <= 1) return points;
  const anchors = start.id === end.id ? [start] : [start, end];
  const index = new Map([...anchors, ...points].map((p, i) => [p.id, i]));
  const cost = (a: Pt, b: Pt) => matrixCost(matrix, a, b, index.get(a.id)!, index.get(b.id)!);
  // Nearest-neighbor chain starting at the start anchor.
  const remaining = [...points];
  const chain: Pt[] = [];
  let cur = start;
  while (remaining.length) {
    let best = 0;
    let bestC = Infinity;
    for (let k = 0; k < remaining.length; k++) {
      const c = cost(cur, remaining[k]);
      if (c < bestC) {
        bestC = c;
        best = k;
      }
    }
    cur = remaining.splice(best, 1)[0];
    chain.push(cur);
  }
  // 2-opt on the full path (start → chain → end), both anchors fixed. The
  // first stop stays the NN pick: the day begins at the lodging, so the
  // nearest stop must keep the morning slot (with one-way/asymmetric road
  // costs, a full-loop reversal would otherwise flip the far stop to first).
  const pathCost = (ord: Pt[]) => {
    let s = cost(start, ord[0]) + cost(ord[ord.length - 1], end);
    for (let k = 1; k < ord.length; k++) s += cost(ord[k - 1], ord[k]);
    return s;
  };
  let improved = true;
  let guard = 0;
  while (improved && guard < 40) {
    improved = false;
    guard++;
    for (let i = 1; i < chain.length - 1; i++) {
      for (let j = i + 1; j < chain.length; j++) {
        const candidate = [...chain.slice(0, i), ...chain.slice(i, j + 1).reverse(), ...chain.slice(j + 1)];
        if (pathCost(candidate) < pathCost(chain) - 1e-6) {
          chain.splice(0, chain.length, ...candidate);
          improved = true;
        }
      }
    }
  }
  return chain;
}
