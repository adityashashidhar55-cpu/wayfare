import { eq, inArray } from "drizzle-orm";
import * as schema from "@db/schema";
import { getDb } from "./connection";
import { convertCents } from "@contracts/fx";

export const DEMO_UNION_ID = "wayfare-demo-user";

function datePlus(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

/**
 * Idempotently seed a rich demo account so first-time visitors can explore
 * every feature (Voyager tier, trips, stops, expenses, reservations…).
 */
export async function seedDemoData(userId: number) {
  const db = getDb();
  const existing = await db
    .select()
    .from(schema.trips)
    .where(eq(schema.trips.ownerId, userId))
    .limit(1);
  if (existing.length) return; // already seeded

  // Taste profile - onboarding complete
  await db.insert(schema.preferences).values({
    userId,
    styles: ["food", "historical", "relaxing"],
    budgetBand: "comfort",
    pace: "balanced",
    // These MUST be STYLE_TO_TAGS keys (hyphenated). "street food" with a
    // space matches nothing and is silently discarded by profileStyles.
    interests: ["temples", "street-food", "coffee", "photography"],
    cuisines: ["japanese", "italian"],
    companions: "friends",
    homeCurrency: "USD",
    archetype: "The Flavor Cartographer",
    onboardingDone: true,
  });

  // Voyager subscription - showcase every premium feature
  await db.insert(schema.subscriptions).values({
    userId,
    tier: "voyager",
    status: "active",
    currentPeriodEnd: datePlus(365),
  });

  // ── Hero trip: Japan in Bloom ────────────────────────────────────────────
  /**
   * r31: fetch ONLY the places this demo references.
   *
   * This used to be `db.select().from(explorePlaces)` with no WHERE - it
   * pulled all 526,142 rows over the wire and built a Map of every one, to
   * look up seventeen names. On a real database that is hundreds of megabytes
   * and several seconds on the first guest login of every cold start.
   */
  const KYOTO_PLACE_NAMES = [
    "Fushimi Inari Shrine", "Ichiran Ramen", "Kyoto National Museum", "Gion Tanto",
    "Arashiyama Bamboo Grove", "Kissa Master", "Camellia Tea Ceremony", "Bar K6",
    "Nara Deer Park", "Dotonbori Street Food Crawl",
  ];
  const LISBON_PLACE_NAMES = ["Alfama Sunrise Walk", "Time Out Market"];
  const BUCKET_PLACE_NAMES = [
    "Path of the Gods", "Sky Lagoon", "Hierve el Agua",
    "Da Adolfo Beach Shack", "Medina Spice Souk",
  ];
  // Every name the seed looks up, in one WHERE. If you add a P("...") call
  // below, its name MUST appear in one of these three lists or the lookup
  // silently returns undefined and the stop is skipped.
  const DEMO_PLACE_NAMES = [
    ...KYOTO_PLACE_NAMES, ...LISBON_PLACE_NAMES, ...BUCKET_PLACE_NAMES,
  ];
  const places = await db
    .select()
    .from(schema.explorePlaces)
    .where(inArray(schema.explorePlaces.name, DEMO_PLACE_NAMES));
  const byName = new Map(places.map((p) => [p.name, p]));
  const P = (name: string) => byName.get(name);

  const start = datePlus(21);
  const end = datePlus(26);
  const tripRes = await db.insert(schema.trips).values({
    ownerId: userId,
    title: "Japan in Bloom",
    destination: "Kyoto, Japan",
    coverImage: "/hero-kyoto.jpg",
    startDate: start,
    endDate: end,
    homeCurrency: "USD",
    budgetCents: 240000,
  });
  const tripId = Number(tripRes[0].insertId);

  await db.insert(schema.tripMembers).values([
    { tripId, userId, name: "Alex Rivers", role: "owner", presenceColor: "#BC5934" },
    { tripId, userId: null, name: "Daniel Kim", role: "editor", presenceColor: "#44604F" },
    { tripId, userId: null, name: "Priya Shah", role: "editor", presenceColor: "#6E7FA3" },
  ]);
  /**
   * Read the ids back instead of assuming insertId, insertId+1, insertId+2.
   * That assumption holds on single-node InnoDB but NOT on TiDB, which hands
   * out auto-increment ranges per node - the three rows can land far apart,
   * and every expense split would then point at member ids that do not exist.
   */
  const members = await db
    .select({ id: schema.tripMembers.id, name: schema.tripMembers.name })
    .from(schema.tripMembers)
    .where(eq(schema.tripMembers.tripId, tripId));
  const memberIdByName = new Map(members.map((m) => [m.name, m.id]));
  const ownerMemberId = memberIdByName.get("Alex Rivers")!;
  const danielId = memberIdByName.get("Daniel Kim")!;
  const priyaId = memberIdByName.get("Priya Shah")!;

  const dayCount = 6;
  const dayIds: number[] = [];
  for (let i = 0; i < dayCount; i++) {
    const r = await db
      .insert(schema.tripDays)
      .values({ tripId, date: datePlus(21 + i), position: i });
    dayIds.push(Number(r[0].insertId));
  }

  const plan: { day: number; name: string; time: string; dur: number; cat?: string }[][] = [
    [
      { day: 0, name: "Fushimi Inari Shrine", time: "08:30", dur: 150 },
      { day: 0, name: "Ichiran Ramen", time: "12:30", dur: 75 },
      { day: 0, name: "Kyoto National Museum", time: "15:00", dur: 120 },
      { day: 0, name: "Gion Tanto", time: "19:00", dur: 90 },
    ],
    [
      { day: 1, name: "Arashiyama Bamboo Grove", time: "09:00", dur: 150 },
      { day: 1, name: "Kissa Master", time: "13:00", dur: 60 },
      { day: 1, name: "Camellia Tea Ceremony", time: "15:30", dur: 75 },
      { day: 1, name: "Bar K6", time: "20:00", dur: 90 },
    ],
    [
      { day: 2, name: "Nara Deer Park", time: "09:30", dur: 180 },
      { day: 2, name: "Ichiran Ramen", time: "19:00", dur: 75 },
    ],
    [
      { day: 3, name: "Dotonbori Street Food Crawl", time: "17:00", dur: 150 },
    ],
    [],
    [],
  ];
  let inserted = 0;
  for (const dayStops of plan) {
    for (let i = 0; i < dayStops.length; i++) {
      const s = dayStops[i];
      const place = P(s.name);
      if (!place) continue;
      await db.insert(schema.stops).values({
        tripId,
        dayId: dayIds[s.day],
        name: place.name,
        category: s.cat ?? place.category,
        address: `${place.city}, ${place.country}`,
        lat: place.lat,
        lng: place.lng,
        startTime: s.time,
        durationMin: s.dur,
        notes: place.description,
        image: place.image,
        position: i,
      });
      inserted++;
    }
  }

  // Expenses (~10, mixed currencies, split among 3)
  const expenseDefs: {
    title: string; cat: string; cents: number; cur: string; day: number; paidBy: number;
  }[] = [
    { title: "Ryokan Yachiyo: 3 nights", cat: "lodging", cents: 54000, cur: "JPY", day: 0, paidBy: ownerMemberId },
    { title: "Haruka airport express ×3", cat: "transport", cents: 10920, cur: "JPY", day: 0, paidBy: danielId },
    { title: "Ichiran Ramen ×3", cat: "food", cents: 4470, cur: "JPY", day: 0, paidBy: priyaId },
    { title: "Fushimi Inari omamori", cat: "shopping", cents: 2400, cur: "JPY", day: 0, paidBy: ownerMemberId },
    { title: "Museum tickets ×3", cat: "activities", cents: 5400, cur: "JPY", day: 1, paidBy: danielId },
    { title: "Tea ceremony ×3", cat: "activities", cents: 9000, cur: "JPY", day: 1, paidBy: ownerMemberId },
    { title: "Bar K6 whiskies", cat: "food", cents: 12600, cur: "JPY", day: 1, paidBy: priyaId },
    { title: "Nara day pass ×3", cat: "transport", cents: 4560, cur: "JPY", day: 2, paidBy: danielId },
    { title: "Dotonbori takoyaki run", cat: "food", cents: 3800, cur: "JPY", day: 3, paidBy: ownerMemberId },
    { title: "Suica top-ups", cat: "transport", cents: 9000, cur: "JPY", day: 3, paidBy: priyaId },
  ];
  const memberIds = [ownerMemberId, danielId, priyaId];
  for (const e of expenseDefs) {
    const homeCents = convertCents(e.cents, e.cur, "USD");
    const r = await db.insert(schema.expenses).values({
      tripId,
      paidById: e.paidBy,
      title: e.title,
      category: e.cat,
      amountCents: e.cents,
      currency: e.cur,
      homeCents,
      date: datePlus(21 + e.day),
    });
    const expenseId = Number(r[0].insertId);
    const base = Math.floor(homeCents / 3);
    await db.insert(schema.expenseSplits).values(
      memberIds.map((memberId, i) => ({
        expenseId,
        memberId,
        shareCents: base + (i === 0 ? homeCents - base * 3 : 0),
      })),
    );
  }

  await db.insert(schema.reservations).values([
    { tripId, type: "flight", title: "SFO → KIX · UA 875", provider: "United", confirmationCode: "X7KQP2", startDate: start, details: "Depart 11:40 · Arrive 15:05+1 · Premium economy" },
    { tripId, type: "lodging", title: "Ryokan Yachiyo, Gion", provider: "Booking.com", confirmationCode: "4821567390", startDate: start, endDate: datePlus(24), details: "Garden-view tatami room · Breakfast included" },
  ]);

  await db.insert(schema.checklistItems).values([
    { tripId, list: "packing", label: "Passport + JR Pass voucher", done: true, position: 0 },
    { tripId, list: "packing", label: "Pocket wifi reservation", done: true, position: 1 },
    { tripId, list: "packing", label: "Comfortable walking shoes", done: false, position: 2 },
    { tripId, list: "packing", label: "Light layers for temple mornings", done: false, position: 3 },
    { tripId, list: "todo", label: "Book teamLab tickets", done: false, position: 0 },
    { tripId, list: "todo", label: "Reserve Gion Karyo dinner", done: false, position: 1 },
  ]);

  await db.insert(schema.tripNotes).values({
    tripId,
    title: "Japan notes",
    content: "Cash is still king outside big stations. Tipping is not expected. Konbini onigiri = best budget breakfast. Book the Camellia tea ceremony for the first week, it fills up.",
  });

  // ── Second upcoming trip: Lisbon ─────────────────────────────────────────
  const lRes = await db.insert(schema.trips).values({
    ownerId: userId,
    title: "Lisbon Long Weekend",
    destination: "Lisbon, Portugal",
    coverImage: "/cover-lisbon.jpg",
    startDate: datePlus(48),
    endDate: datePlus(51),
    homeCurrency: "USD",
    budgetCents: 120000,
  });
  const lisbonId = Number(lRes[0].insertId);
  await db.insert(schema.tripMembers).values([
    { tripId: lisbonId, userId, name: "Alex Rivers", role: "owner", presenceColor: "#BC5934" },
    { tripId: lisbonId, userId: null, name: "Daniel Kim", role: "editor", presenceColor: "#44604F" },
  ]);
  for (let i = 0; i < 4; i++) {
    const r = await db.insert(schema.tripDays).values({ tripId: lisbonId, date: datePlus(48 + i), position: i });
    if (i === 0) {
      const dayId = Number(r[0].insertId);
      const walk = P("Alfama Sunrise Walk");
      const market = P("Time Out Market");
      if (walk) {
        await db.insert(schema.stops).values({ tripId: lisbonId, dayId, name: walk.name, category: walk.category, address: `${walk.city}, ${walk.country}`, lat: walk.lat, lng: walk.lng, startTime: "08:00", durationMin: 120, notes: walk.description, image: walk.image, position: 0 });
      }
      if (market) {
        await db.insert(schema.stops).values({ tripId: lisbonId, dayId, name: market.name, category: market.category, address: `${market.city}, ${market.country}`, lat: market.lat, lng: market.lng, startTime: "12:30", durationMin: 90, notes: market.description, image: market.image, position: 1 });
      }
    }
  }

  // ── Past trip: Copenhagen ────────────────────────────────────────────────
  const cRes = await db.insert(schema.trips).values({
    ownerId: userId,
    title: "Copenhagen in Autumn",
    destination: "Copenhagen, Denmark",
    coverImage: "/cover-copenhagen.jpg",
    startDate: datePlus(-68),
    endDate: datePlus(-63),
    homeCurrency: "USD",
    budgetCents: 160000,
  });
  const cphId = Number(cRes[0].insertId);
  await db.insert(schema.tripMembers).values({ tripId: cphId, userId, name: "Alex Rivers", role: "owner", presenceColor: "#BC5934" });

  // ── Bucket list ──────────────────────────────────────────────────────────
  for (const n of BUCKET_PLACE_NAMES) {
    const p = P(n);
    if (!p) continue;
    await db.insert(schema.bucketList).values({
      userId,
      name: p.name,
      country: p.country,
      lat: p.lat,
      lng: p.lng,
      image: p.image,
      note: p.description,
    });
  }

  console.log(`[demo] seeded demo account (user ${userId}, ${inserted} stops)`);
}
