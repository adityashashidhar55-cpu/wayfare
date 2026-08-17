/**
 * Smart-packing verification script (r9-packing).
 * Run: npx tsx scripts/verify-packing.mts
 *
 *   A) Voyager + roadtrip to a rainy-cold destination dated NEXT WEEK
 *      (destination chosen adaptively from the live forecast) → list must
 *      contain rain gear + warm layers + plug adapter + documents + road-trip
 *      tech (+ a style rule). Run twice → second run replaces, no duplicates.
 *   B) Family trip (withChildren, ages "2,8") to Bali → infant + kid sections,
 *      tropical + beach rules; clearGenerated empties generated rows.
 *   C) Wanderer tier → UPGRADE_REQUIRED.
 *
 * Cleans up both trips and restores subscription tier / taste styles.
 */
import { eq } from "drizzle-orm";
import { appRouter } from "../api/router";
import { getDb } from "../api/queries/connection";
import { getDayWeather } from "../api/lib/weather";
import { geocodeCity } from "../api/queries/overpass";
import * as schema from "../db/schema";

const db = getDb();

const [user] = await db.select().from(schema.users).limit(1);
if (!user) throw new Error("No users in DB to impersonate");
console.log(`Acting as user #${user.id} (${user.name ?? user.email ?? "?"})`);

// ── preserve + set voyager tier & taste styles (restored in finally) ──────
const [existingSub] = await db
  .select()
  .from(schema.subscriptions)
  .where(eq(schema.subscriptions.userId, user.id))
  .limit(1);
const createdSub = !existingSub;
const prevTier = existingSub?.tier ?? null;
if (createdSub) {
  await db.insert(schema.subscriptions).values({ userId: user.id, tier: "voyager", status: "active" });
  console.log("Temp voyager subscription created");
} else if (prevTier !== "voyager") {
  await db.update(schema.subscriptions).set({ tier: "voyager" }).where(eq(schema.subscriptions.userId, user.id));
  console.log(`Temp tier bump ${prevTier} → voyager`);
}
const [existingPrefs] = await db
  .select()
  .from(schema.preferences)
  .where(eq(schema.preferences.userId, user.id))
  .limit(1);
const prevStyles = existingPrefs?.styles ?? null;
const hadPrefs = !!existingPrefs;
if (hadPrefs) {
  await db.update(schema.preferences).set({ styles: ["historical"] }).where(eq(schema.preferences.userId, user.id));
} else {
  await db.insert(schema.preferences).values({ userId: user.id, styles: ["historical"] });
}

const caller = appRouter.createCaller({
  req: new Request("http://verify.local"),
  resHeaders: new Headers(),
  user,
});

const iso = (d: Date) => d.toISOString().slice(0, 10);
const plusDays = (n: number) => {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + n);
  return d;
};

let failures = 0;
function check(name: string, cond: boolean, detail = "") {
  console.log(`  ${cond ? "✓" : "✗ FAIL"} ${name}${detail ? `, ${detail}` : ""}`);
  if (!cond) failures++;
}
const flatLabels = (groups: { group: string; items: { label: string; why?: string }[] }[]) =>
  groups.flatMap(g => g.items.map(i => i.label));
const hasLabel = (groups: any[], re: RegExp) => flatLabels(groups).some(l => re.test(l));

// ── pick a rainy-cold destination for next week from the live forecast ────
async function pickRainyCold(startISO: string, endISO: string) {
  const CANDIDATES = [
    "Queenstown, New Zealand",
    "Ushuaia, Argentina",
    "Reykjavik",
    "Bergen, Norway",
    "Inverness, Scotland",
    "Juneau, Alaska",
  ];
  const dates: string[] = [];
  for (let d = new Date(startISO + "T00:00:00Z"); d <= new Date(endISO + "T00:00:00Z"); d.setUTCDate(d.getUTCDate() + 1))
    dates.push(d.toISOString().slice(0, 10));
  for (const dest of CANDIDATES) {
    const geo = await geocodeCity(dest.split(",")[0]);
    if (!geo) continue;
    const wx = await Promise.all(dates.map(d => getDayWeather(geo.lat, geo.lng, d)));
    const days = wx.filter(w => !!w);
    const rain = days.filter(d => d.precipMm >= 3).length;
    const minT = days.length ? Math.min(...days.map(d => d.tminC)) : 99;
    console.log(`  forecast ${dest}: ${days.length}d, rainy=${rain}, minT=${minT}°C (${geo.country})`);
    if (rain >= 1 && minT <= 5) return { dest, country: geo.country, rain, minT };
  }
  return null;
}

const tripIds: number[] = [];
try {
  const start = iso(plusDays(7));
  const end = iso(plusDays(10));

  console.log("\n═══ A) Voyager · rainy-cold roadtrip next week ═══");
  const pick = await pickRainyCold(start, end);
  if (!pick) {
    console.log("  No candidate had rain+cold in the live forecast, falling back to Queenstown (cold-only assertions).");
  }
  const destA = pick?.dest ?? "Queenstown, New Zealand";
  const expectRain = !!pick;

  const tripA = await caller.trips.create({
    title: "packing-verify-A",
    destination: destA,
    startDate: start,
    endDate: end,
    homeCurrency: "USD",
  });
  tripIds.push(tripA.id);
  await db.update(schema.trips).set({ tripType: "roadtrip" }).where(eq(schema.trips.id, tripA.id));

  const gen1 = await caller.packing.generatePackingList({ tripId: tripA.id });
  console.log(`  meta: ${JSON.stringify(gen1.meta)}`);
  console.log(`  inserted=${gen1.inserted} replaced=${gen1.replaced}`);
  for (const g of gen1.groups)
    console.log(`    [${g.group}] ${g.items.map(i => i.label).join(" · ")}`);

  check("rain gear present", !expectRain || hasLabel(gen1.groups, /rain jacket|umbrella/i));
  check("warm layers present", /Thermal base layers|insulated jacket/i.test(flatLabels(gen1.groups).join("|")));
  check("plug adapter present", hasLabel(gen1.groups, /plug adapter/i));
  check("documents present", hasLabel(gen1.groups, /Passport\u2014 valid 6\+ months/));
  check("road-trip tech present", hasLabel(gen1.groups, /Car charger|Offline maps/));
  check("style rule (historical) present", hasLabel(gen1.groups, /Modest layers/));
  check("international detected", gen1.meta.international === true, `country=${gen1.meta.country}`);

  // idempotency: second run replaces exactly the first set - no duplicates
  const gen2 = await caller.packing.generatePackingList({ tripId: tripA.id });
  const rowsAfter = await db
    .select()
    .from(schema.checklistItems)
    .where(eq(schema.checklistItems.tripId, tripA.id));
  const genRows = rowsAfter.filter(r => r.label.startsWith("✦ "));
  check("second run replaced first", gen2.replaced === gen1.inserted, `replaced=${gen2.replaced} inserted1=${gen1.inserted}`);
  check("no duplicate rows after 2 runs", genRows.length === gen2.inserted, `db=${genRows.length} inserted2=${gen2.inserted}`);
  const uniq = new Set(genRows.map(r => r.label));
  check("labels unique in DB", uniq.size === genRows.length);

  console.log("\n═══ B) Voyager · family trip to Bali (ages 2,8) ═══");
  const tripB = await caller.trips.create({
    title: "packing-verify-B",
    destination: "Ubud, Bali",
    startDate: start,
    endDate: iso(plusDays(13)),
    homeCurrency: "USD",
  });
  tripIds.push(tripB.id);
  await db.update(schema.trips).set({ withChildren: true, childAges: "2,8" }).where(eq(schema.trips.id, tripB.id));

  // a hand-written item must survive generation + clearing
  await caller.trips.addChecklistItem({ tripId: tripB.id, list: "packing", label: "My lucky scarf" });

  const genB = await caller.packing.generatePackingList({ tripId: tripB.id });
  console.log(`  meta: ${JSON.stringify(genB.meta)}`);
  for (const g of genB.groups)
    console.log(`    [${g.group}] ${g.items.map(i => i.label).join(" · ")}`);
  check("Kids group present", genB.groups.some(g => g.group === "Kids"));
  check("infant items (0-2)", hasLabel(genB.groups, /Stroller or baby carrier|Nappies ×/));
  check("kid items (7-12)", hasLabel(genB.groups, /Travel games|Kid camera/));
  check("family docs", hasLabel(genB.groups, /Kids' passports|Consent letter/));
  check("tropical health rule", hasLabel(genB.groups, /Mosquito repellent/));
  check("beach rule", hasLabel(genB.groups, /Swimwear ×2/));
  check("hot-weather rule", hasLabel(genB.groups, /Sunscreen SPF 50/));

  const cleared = await caller.packing.clearGenerated({ tripId: tripB.id });
  const rowsB = await db.select().from(schema.checklistItems).where(eq(schema.checklistItems.tripId, tripB.id));
  check("clearGenerated removed generated rows", cleared.deleted === genB.inserted && !rowsB.some(r => r.label.startsWith("✦ ")), `deleted=${cleared.deleted}`);
  check("manual item survived clear", rowsB.some(r => r.label === "My lucky scarf"));

  console.log("\n═══ C) Wanderer gate ═══");
  await db.update(schema.subscriptions).set({ tier: "wanderer" }).where(eq(schema.subscriptions.userId, user.id));
  let gated = false;
  try {
    await caller.packing.generatePackingList({ tripId: tripA.id });
  } catch (e: any) {
    gated = String(e?.message ?? e).includes("UPGRADE_REQUIRED");
  }
  check("wanderer → UPGRADE_REQUIRED", gated);
  await db.update(schema.subscriptions).set({ tier: "voyager" }).where(eq(schema.subscriptions.userId, user.id));
} finally {
  for (const id of tripIds) {
    try {
      await caller.trips.remove({ id });
      console.log(`Cleaned up trip #${id}`);
    } catch (e) {
      console.warn(`Cleanup of trip #${id} failed: ${e}`);
    }
  }
  if (createdSub) {
    await db.delete(schema.subscriptions).where(eq(schema.subscriptions.userId, user.id));
    console.log("Temp voyager subscription removed");
  } else if (prevTier && prevTier !== "voyager") {
    await db.update(schema.subscriptions).set({ tier: prevTier }).where(eq(schema.subscriptions.userId, user.id));
    console.log(`Tier restored to ${prevTier}`);
  }
  if (hadPrefs) {
    await db.update(schema.preferences).set({ styles: prevStyles }).where(eq(schema.preferences.userId, user.id));
  } else {
    await db.delete(schema.preferences).where(eq(schema.preferences.userId, user.id));
  }
  console.log("Taste styles restored");
}

if (failures) {
  console.error(`\n${failures} CHECK(S) FAILED`);
  process.exit(1);
}
console.log("\nAll smart-packing checks passed.");
process.exit(0);
