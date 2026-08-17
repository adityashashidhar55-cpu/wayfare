/**
 * r11-quality verification script.
 * Run: npx tsx scripts/verify-quality.mts
 *
 * 1. isGenericName unit cases (Park→generic, Central Market→generic,
 *    Central Park→keep, Meenakshi Temple→keep, Temple→generic, Sightseeing→generic).
 * 2. famousInCity('Jaipur') ranks Amber Fort / Hawa Mahal-class picks top.
 * 3. famousInCity('Kyoto') ranks Fushimi Inari / Kiyomizu top.
 * 4. explore.list city suggestion query no longer surfaces generic-named rows.
 */
import { like } from "drizzle-orm";
import { getDb } from "../api/queries/connection";
import * as schema from "../db/schema";
import { isGenericName } from "../api/lib/place-quality";
import { appRouter } from "../api/router";
import { eq } from "drizzle-orm";

let failures = 0;
const check = (label: string, ok: boolean, extra = "") => {
  console.log(`${ok ? "✅" : "❌"} ${label}${extra ? `, ${extra}` : ""}`);
  if (!ok) failures++;
};

// ── 1. isGenericName cases ──────────────────────────────────────────────────
console.log("── isGenericName ──");
const cases: [string, boolean][] = [
  ["Park", true],
  ["Central Market", true],
  ["Central Park", false],
  ["Meenakshi Temple", false],
  ["Temple", true],
  ["Sightseeing", true],
  ["View Point", true],
  ["City Center", true],
  ["Parking", true],
  ["Park Güell", false],
  ["Golden Temple", false],
  ["Hawa Mahal", false],
  ["Fushimi Inari Shrine", false],
  ["CENTRAL MARKET", true],
  ["Plaza", true],
  ["Jardin", true],
  ["Mirador", true],
  ["Bondi Beach", false],
];
for (const [name, want] of cases) check(`isGenericName(${JSON.stringify(name)}) = ${want}`, isGenericName(name) === want, `got ${isGenericName(name)}`);

// ── router caller (any user) ────────────────────────────────────────────────
const db = getDb();
const [user] = await db.select().from(schema.users).where(eq(schema.users.role, "user")).limit(1);
const caller = appRouter.createCaller({ req: new Request("http://verify.local"), resHeaders: new Headers(), user } as never);

// ── 2/3. famousInCity ───────────────────────────────────────────────────────
for (const [city, wanted] of [
  ["Jaipur", ["amer", "amber", "hawa"]],
  ["Kyoto", ["fushimi", "kiyomizu"]],
] as const) {
  console.log(`── famousInCity(${city}) ──`);
  const res = await caller.explore.famousInCity({ city, limit: 10 });
  res.places.forEach((p, i) => console.log(`  ${i + 1}. ${p.name} (score ${p.fameScore}, v=${p.verdict ?? "-"}), ${p.blurb}`));
  const top5 = res.places.slice(0, 5).map((p) => p.name.toLowerCase()).join(" | ");
  check(`top-5 for ${city} mentions ${[...wanted].join("/")}`, wanted.some((w) => top5.includes(w)), top5);
  check(`${city} returns no generic names`, res.places.every((p) => !isGenericName(p.name)));
}

// ── 4. suggestion query no longer surfaces generic rows ─────────────────────
console.log("── explore.list suggestion filter ──");
const genericRows = await db
  .select({ city: schema.explorePlaces.city, name: schema.explorePlaces.name })
  .from(schema.explorePlaces)
  .where(like(schema.explorePlaces.name, "%Central Market%"))
  .limit(3);
console.log("  generic 'Central Market' rows in DB:", genericRows.length, genericRows.map((r) => `${r.name}@${r.city}`));
const targetCity = genericRows[0]?.city ?? "Jaipur";
const feed = await caller.explore.list({ city: targetCity });
const genericInFeed = feed.places.filter((p) => isGenericName(p.name));
check(`explore.list(${targetCity}) hides generic-named rows`, genericInFeed.length === 0, genericInFeed.map((p) => p.name).join(",") || "none present");

console.log("─".repeat(70));
if (failures) {
  console.error(`❌ ${failures} check(s) failed`);
  process.exit(1);
}
console.log("✅ all quality checks passed");
process.exit(0);
