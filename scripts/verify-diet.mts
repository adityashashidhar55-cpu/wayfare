/**
 * Dietary-preference verification (r11-diet).
 * Run: npx tsx scripts/verify-diet.mts
 *
 * Uses two synthetic test cities inserted into explore_places:
 *   "Vegtest"  - rich veg corpus (vegan-tagged, pure-veg named, veg-tagged)
 *                plus a steakhouse + neutral cafés.
 *   "Meatville" - thin veg corpus (activities + only meat-only/neutral food).
 *
 * A) dietary='vegan' in Vegtest → food picks are veg-tagged/named majority,
 *    no meat-only pick, no "veg options unverified" notes (corpus is rich).
 * B) dietary='vegan' in Meatville → thin corpus relaxes gracefully: food
 *    picks happen but their notes carry "veg options unverified".
 * C) Control: dietary='non-veg' in Vegtest → no diet filtering, no
 *    unverified notes (baseline behavior unchanged).
 * D) preferences.upsert persists dietary (the quiz/profile save path).
 * E) dietBadge logic for the card badge (veg-named restaurant → badge).
 * F) India prior: country=India + dietary='veg' → a "pure veg" place is
 *    strongly preferred (lowest-rated ideal pick, saved by the +30 bonus).
 *
 * Cleans up created trips, test-city corpus rows, and restores prefs/sub.
 */
import { eq } from "drizzle-orm";
import { appRouter } from "../api/router";
import { getDb } from "../api/queries/connection";
import * as schema from "../db/schema";
import { DIET_UNVERIFIED_NOTE, dietBadge, dietConfirmed, isMeatOnly } from "../contracts/diet";

const db = getDb();
let failures = 0;
const ok = (cond: boolean, label: string, extra?: string) => {
  console.log(`  ${cond ? "PASS" : "FAIL"}  ${label}${extra ? `, ${extra}` : ""}`);
  if (!cond) failures++;
};

const [user] = await db.select().from(schema.users).limit(1);
if (!user) throw new Error("No users in DB to impersonate");
console.log(`Acting as user #${user.id} (${user.name ?? user.email ?? "?"})`);

// Voyager tier (generation is paywalled) - restored afterwards.
const [existingSub] = await db
  .select()
  .from(schema.subscriptions)
  .where(eq(schema.subscriptions.userId, user.id))
  .limit(1);
const createdSub = !existingSub;
const prevTier = existingSub?.tier ?? null;
if (createdSub) {
  await db.insert(schema.subscriptions).values({ userId: user.id, tier: "voyager", status: "active" });
} else if (prevTier !== "voyager") {
  await db.update(schema.subscriptions).set({ tier: "voyager" }).where(eq(schema.subscriptions.userId, user.id));
}

// Preferences row + saved dietary - restored afterwards.
await db.insert(schema.preferences).values({ userId: user.id, styles: [], interests: [], cuisines: [] }).onDuplicateKeyUpdate({ set: { userId: user.id } });
const [prefsBefore] = await db.select().from(schema.preferences).where(eq(schema.preferences.userId, user.id)).limit(1);
const prevDietary = prefsBefore?.dietary ?? null;

const caller = appRouter.createCaller({
  req: new Request("http://verify.local"),
  resHeaders: new Headers(),
  user,
});

// ── Synthetic corpus ────────────────────────────────────────────────────────
type PlaceInsert = typeof schema.explorePlaces.$inferInsert;
const place = (p: Partial<PlaceInsert> & Pick<PlaceInsert, "name" | "city" | "category">): PlaceInsert => ({
  country: "Testland",
  lat: 10 + Math.random(),
  lng: 10 + Math.random(),
  rating: 4.5,
  priceLevel: 2,
  hidden: false,
  source: "curated",
  ...p,
});
const CORPUS: PlaceInsert[] = [
  // Vegtest activities
  place({ name: "Vegtest Old Fort", city: "Vegtest", category: "activity", tags: ["historic"], rating: 4.7 }),
  place({ name: "Vegtest City Museum", city: "Vegtest", category: "activity", tags: ["museum"], rating: 4.6 }),
  place({ name: "Vegtest River Walk", city: "Vegtest", category: "activity", tags: ["nature"], rating: 4.4 }),
  place({ name: "Vegtest Central Market", city: "Vegtest", category: "activity", tags: ["market"], rating: 4.3 }),
  place({ name: "Vegtest Hill Viewpoint", city: "Vegtest", category: "activity", tags: ["views"], rating: 4.5 }),
  place({ name: "Vegtest Botanic Garden", city: "Vegtest", category: "activity", tags: ["garden"], rating: 4.4 }),
  // Vegtest food - veg-signalled (6 = exactly the 3-day × 2 food-slot demand)
  place({ name: "Sprout & Root", city: "Vegtest", category: "food", tags: ["food", "diet:vegan=yes"], rating: 4.8 }),
  place({ name: "The Kind Kitchen", city: "Vegtest", category: "food", tags: ["food", "diet:vegan=only"], rating: 4.6 }),
  place({ name: "Sattva Vegan Cafe", city: "Vegtest", category: "food", tags: ["food"], rating: 4.5 }),
  place({ name: "Millet & Meadow", city: "Vegtest", category: "food", tags: ["food", "diet:vegan=yes"], rating: 4.3 }),
  /* 4.0 on purpose: the lowest-rated "ideal" veg pick - scenario F proves the
     India pure-veg bonus lifts it into the day plan anyway. */
  place({ name: "Annapurna Pure Veg", city: "Vegtest", category: "food", tags: ["food"], rating: 4.0 }),
  place({ name: "Green Leaf Thali", city: "Vegtest", category: "food", tags: ["food", "diet:vegetarian=yes"], rating: 4.4 }),
  // Vegtest food - meat-only + neutral
  place({ name: "Big Tex Steakhouse", city: "Vegtest", category: "food", tags: ["food"], rating: 4.9 }),
  place({ name: "Cafe Mocha", city: "Vegtest", category: "food", tags: ["food"], rating: 4.3 }),
  place({ name: "Noodle House", city: "Vegtest", category: "food", tags: ["food"], rating: 4.2 }),
  // Meatville - thin veg corpus: activities + only meat/neutral food
  place({ name: "Meatville Castle", city: "Meatville", category: "activity", tags: ["historic"], rating: 4.6 }),
  place({ name: "Meatville Gallery", city: "Meatville", category: "activity", tags: ["art", "museum"], rating: 4.4 }),
  place({ name: "Meatville Harbour", city: "Meatville", category: "activity", tags: ["views"], rating: 4.3 }),
  place({ name: "Meatville Clock Tower", city: "Meatville", category: "activity", tags: ["landmark"], rating: 4.2 }),
  place({ name: "Smokehouse BBQ", city: "Meatville", category: "food", tags: ["food"], rating: 4.7 }),
  place({ name: "Neptune Seafood", city: "Meatville", category: "food", tags: ["food"], rating: 4.5 }),
  place({ name: "Meatville Cafe", city: "Meatville", category: "food", tags: ["food"], rating: 4.1 }),
];

const tripIds: number[] = [];
try {
  console.log("\nseeding synthetic test cities (Vegtest, Meatville)…");
  await db.delete(schema.explorePlaces).where(eq(schema.explorePlaces.country, "Testland"));
  await db.insert(schema.explorePlaces).values(CORPUS);

  /* Stops carry no tags - classify with the corpus row (tags+name) by name. */
  const byName = new Map(CORPUS.map((p) => [p.name.trim().toLowerCase(), p]));
  const asCorpus = (s: { name: string; category: string }) =>
    byName.get(s.name.trim().toLowerCase()) ?? { name: s.name, category: s.category };

  const foodStopsOf = async (tripId: number) => {
    const trip = await caller.trips.get({ id: tripId });
    return trip.stops.filter((s) => s.category === "food");
  };
  const setDietary = async (d: "veg" | "non-veg" | "vegan" | "jain" | "eggetarian") => {
    await db.update(schema.preferences).set({ dietary: d }).where(eq(schema.preferences.userId, user.id));
  };

  // ── A) vegan in a rich-veg corpus ────────────────────────────────────────
  console.log("\nA) dietary=vegan · Vegtest · 3 days × 4 stops");
  await setDietary("vegan");
  const a = await caller.trips.generateItinerary({
    destination: "Vegtest",
    startDate: "2026-07-06",
    endDate: "2026-07-08",
    pace: "balanced",
  });
  tripIds.push(a.id);
  const aFood = await foodStopsOf(a.id);
  const aConfirmed = aFood.filter((s) => dietConfirmed(asCorpus(s), "vegan"));
  ok(aFood.length >= 3, "A: food stops planned", `${aFood.length}`);
  ok(
    aConfirmed.length / Math.max(1, aFood.length) >= 0.8,
    "A: ≥80% of food picks confirmed-vegan fit",
    `${aConfirmed.length}/${aFood.length}: ${aFood.map((s) => s.name).join(", ")}`,
  );
  ok(
    !aFood.some((s) => isMeatOnly(asCorpus(s))),
    "A: no meat-only pick while veg options exist",
    aFood.filter((s) => isMeatOnly(asCorpus(s))).map((s) => s.name).join(", ") || "none",
  );
  ok(
    !aFood.some((s) => s.name === "Big Tex Steakhouse"),
    "A: highest-rated (4.9) steakhouse loses to vegan picks",
  );
  ok(
    !aFood.some((s) => (s.notes ?? "").includes(DIET_UNVERIFIED_NOTE)),
    "A: rich corpus → no 'veg options unverified' notes",
  );
  ok(a.dayEstimates.length === 3 && typeof a.dayEstimates[0].totalCents === "number", "A: dayEstimates shape stable");

  // ── B) vegan in a thin-veg corpus → graceful relax + note ───────────────
  console.log("\nB) dietary=vegan · Meatville · 2 days × 4 stops (thin veg corpus)");
  const b = await caller.trips.generateItinerary({
    destination: "Meatville",
    startDate: "2026-07-06",
    endDate: "2026-07-07",
    pace: "balanced",
  });
  tripIds.push(b.id);
  const bFood = await foodStopsOf(b.id);
  const bTagged = bFood.filter((s) => (s.notes ?? "").includes(DIET_UNVERIFIED_NOTE));
  ok(bFood.length >= 1, "B: food stops still planned (graceful relax)", `${bFood.length}`);
  ok(
    bTagged.length === bFood.length && bTagged.length > 0,
    "B: every relaxed food pick notes 'veg options unverified'",
    `${bTagged.length}/${bFood.length}`,
  );

  // ── C) control: non-veg unchanged ────────────────────────────────────────
  console.log("\nC) control · dietary=non-veg · Vegtest");
  await setDietary("non-veg");
  const c = await caller.trips.generateItinerary({
    destination: "Vegtest",
    startDate: "2026-08-03",
    endDate: "2026-08-05",
    pace: "balanced",
  });
  tripIds.push(c.id);
  const cFood = await foodStopsOf(c.id);
  ok(
    !cFood.some((s) => (s.notes ?? "").includes(DIET_UNVERIFIED_NOTE)),
    "C: non-veg → no diet notes at all",
  );
  ok(cFood.length >= 3, "C: food stops planned as before", `${cFood.length}`);

  // ── D) preferences.upsert persists dietary (quiz/profile save path) ──────
  console.log("\nD) preferences.upsert saves dietary");
  await caller.preferences.upsert({ dietary: "jain" });
  const [after] = await db.select().from(schema.preferences).where(eq(schema.preferences.userId, user.id)).limit(1);
  ok(after?.dietary === "jain", "D: dietary persisted via upsert", after?.dietary ?? "null");

  // ── E) badge logic on a veg-named restaurant card ────────────────────────
  console.log("\nE) dietBadge on veg-named restaurant (card badge source)");
  const badge = dietBadge({ name: "Annapurna Pure Veg", category: "food", tags: ["food"] });
  ok(badge?.label === "Pure veg", "E: badge label", badge?.label ?? "null");

  // ── F) India prior: 'veg' strongly prefers pure-veg ─────────────────────
  console.log("\nF) dietary=veg · Vegtest (country=India) · 2 days");
  await db.update(schema.explorePlaces).set({ country: "India" }).where(eq(schema.explorePlaces.city, "Vegtest"));
  await setDietary("veg");
  const f = await caller.trips.generateItinerary({
    destination: "Vegtest",
    startDate: "2026-09-07",
    endDate: "2026-09-08",
    pace: "balanced",
  });
  tripIds.push(f.id);
  const fFood = await foodStopsOf(f.id);
  ok(
    fFood.length > 0 && fFood.every((s) => dietConfirmed(asCorpus(s), "veg")),
    "F: all food picks confirmed for 'veg'",
    fFood.map((s) => s.name).join(", "),
  );
  ok(
    fFood.some((s) => s.name === "Annapurna Pure Veg"),
    "F: India pure-veg bonus lifts the 4.0-rated pure-veg place into the plan",
  );
  ok(
    !fFood.some((s) => (s.notes ?? "").includes(DIET_UNVERIFIED_NOTE)),
    "F: no unverified notes",
  );
} finally {
  for (const id of tripIds) {
    await caller.trips.remove({ id }).catch(() => {});
  }
  await db.delete(schema.explorePlaces).where(eq(schema.explorePlaces.country, "Testland")).catch(() => {});
  if (prevDietary != null) {
    await db.update(schema.preferences).set({ dietary: prevDietary }).where(eq(schema.preferences.userId, user.id)).catch(() => {});
  }
  if (createdSub) {
    await db.delete(schema.subscriptions).where(eq(schema.subscriptions.userId, user.id));
  } else if (prevTier && prevTier !== "voyager") {
    await db.update(schema.subscriptions).set({ tier: prevTier }).where(eq(schema.subscriptions.userId, user.id));
  }
  console.log(`\ncleanup done, ${failures === 0 ? "ALL CHECKS PASSED" : `${failures} CHECK(S) FAILED`}`);
  process.exit(failures === 0 ? 0 : 1);
}
