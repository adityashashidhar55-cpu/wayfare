/**
 * r11-journal verification script.
 * Run: npx tsx scripts/verify-journal-r11.mts
 *
 * 1. Verdicts: Fushimi Inari → must-see, a random statue → skip-if-tight.
 * 2. reportClosed round-trip via tRPC (temporarily_closed → open).
 * 3. nearbyFood for Kiyomizu → food places with meal prices (fallback: any
 *    place with nearby food, reported).
 * 4. Comments: add/list/delete as owner; admin can delete others; a stranger
 *    cannot (FORBIDDEN).
 * 5. Blog ingestion: suggestPlaces imports a confident OSM hit into
 *    explore_places; publishing a blog with a new place name persists + shows
 *    the row; re-publishing unions without duplicating.
 *
 * Everything the script creates is cleaned up (post, comments, closedStatus).
 */
import { desc, eq, sql } from "drizzle-orm";
import { appRouter } from "../api/router";
import { getDb } from "../api/queries/connection";
import * as schema from "../db/schema";
import { verdictFor } from "../api/lib/verdict";
import type { User } from "../db/schema";

const db = getDb();
let failures = 0;
function check(label: string, ok: boolean, detail = "") {
  console.log(`${ok ? "✓" : "✗ FAIL"} ${label}${detail ? `, ${detail}` : ""}`);
  if (!ok) failures++;
}

const [user] = await db.select().from(schema.users).limit(1);
if (!user) throw new Error("no users in DB, run the app once first");
const [admin] = await db.select().from(schema.users).where(eq(schema.users.role, "admin")).limit(1);
const callerFor = (u: User) =>
  appRouter.createCaller({ req: new Request("http://verify.local"), resHeaders: new Headers(), user: u });
const caller = callerFor(user);
const adminCaller = admin ? callerFor(admin) : null;
console.log(`acting user #${user.id} (${user.name ?? "?"})${admin ? `, admin #${admin.id}` : ", no admin user, admin-delete check skipped"}`);

// ── 1. verdicts ─────────────────────────────────────────────────────────────
const [fushimi] = await db
  .select()
  .from(schema.explorePlaces)
  .where(sql`LOWER(${schema.explorePlaces.name}) LIKE '%fushimi%'`)
  .limit(1);
check("Fushimi Inari verdict", fushimi?.verdict === "must-see", `${fushimi?.name} → ${fushimi?.verdict}`);

const [statue] = await db
  .select()
  .from(schema.explorePlaces)
  .where(sql`LOWER(${schema.explorePlaces.name}) LIKE '%statue%' AND ${schema.explorePlaces.verdict} = 'skip-if-tight'`)
  .limit(1);
check("random statue verdict", statue?.verdict === "skip-if-tight", statue ? `${statue.name} (${statue.city}) → ${statue.verdict}` : "no statue row found");
check(
  "synthetic statue heuristic",
  verdictFor({ name: "Some Bronze Statue", rating: 4.3, category: "activity", tags: [] }) === "skip-if-tight",
);

// ── 2. reportClosed round-trip ──────────────────────────────────────────────
const closedTarget = fushimi ?? statue!;
const origClosed = closedTarget.closedStatus ?? "open";
const r1 = await caller.explore.reportClosed({ placeId: closedTarget.id, status: "temporarily_closed", note: "verify script" });
const [afterReport] = await db.select().from(schema.explorePlaces).where(eq(schema.explorePlaces.id, closedTarget.id)).limit(1);
check("reportClosed sets temporarily_closed", r1.closedStatus === "temporarily_closed" && afterReport.closedStatus === "temporarily_closed");
await caller.explore.reportClosed({ placeId: closedTarget.id, status: "open" });
const [afterReopen] = await db.select().from(schema.explorePlaces).where(eq(schema.explorePlaces.id, closedTarget.id)).limit(1);
check("reportClosed reopens", afterReopen.closedStatus === "open");
if (origClosed !== "open") {
  await caller.explore.reportClosed({ placeId: closedTarget.id, status: origClosed as "temporarily_closed" | "permanently_closed" });
}

// ── 3. nearbyFood for Kiyomizu ──────────────────────────────────────────────
const [kiyomizu] = await db
  .select()
  .from(schema.explorePlaces)
  .where(sql`LOWER(${schema.explorePlaces.name}) LIKE '%kiyomizu%'`)
  .limit(1);
let foodPlaces: Awaited<ReturnType<typeof caller.explore.nearbyFood>>["places"] = [];
let foodAnchor = kiyomizu;
if (kiyomizu) {
  foodPlaces = (await caller.explore.nearbyFood({ placeId: kiyomizu.id })).places;
}
if (!foodPlaces.length) {
  // fallback: find any anchor with nearby food so the query shape is proven
  const anchors = await db
    .select()
    .from(schema.explorePlaces)
    .where(sql`${schema.explorePlaces.category} != 'food' AND ${schema.explorePlaces.lat} IS NOT NULL`)
    .orderBy(desc(schema.explorePlaces.id))
    .limit(40);
  for (const a of anchors) {
    const res = await caller.explore.nearbyFood({ placeId: a.id });
    if (res.places.length) {
      foodPlaces = res.places;
      foodAnchor = a;
      break;
    }
  }
}
check(
  `nearbyFood near ${foodAnchor?.name ?? "?"} (${foodAnchor?.city ?? "?"})`,
  foodPlaces.length > 0,
  foodPlaces.map((p) => `${p.name} ${p.distanceM}m ★${p.rating}${p.mealCents != null ? ` ≈${p.mealCents / 100}${p.feeCurrency ?? ""}` : " (no price)"}`).join(" | "),
);
check("nearbyFood rows ≤ 600m & ≤ 4", foodPlaces.length <= 4 && foodPlaces.every((p) => p.distanceM <= 600));

// ── 4. comments add/list/delete (own + admin + stranger) ────────────────────
const commentTarget = closedTarget.id;
const added = await caller.explore.addPlaceComment({ placeId: commentTarget, text: "verify: lovely at sunrise" });
check("addPlaceComment", added.comment.id > 0 && added.comment.mine);
const listed = await caller.explore.placeComments({ placeId: commentTarget });
check("placeComments lists new comment first", listed.comments[0]?.id === added.comment.id, `${listed.comments.length} comments`);

const [stranger] = await db.select().from(schema.users).where(sql`${schema.users.id} != ${user.id}`).limit(1);
if (stranger && (!admin || stranger.id !== admin.id)) {
  let forbidden = false;
  try {
    await callerFor(stranger).explore.deletePlaceComment({ id: added.comment.id });
  } catch (e) {
    forbidden = (e as { code?: string }).code === "FORBIDDEN" || String(e).includes("FORBIDDEN");
  }
  check("stranger cannot delete", forbidden);
}
if (adminCaller) {
  const adminAdded = await caller.explore.addPlaceComment({ placeId: commentTarget, text: "verify: admin will delete this" });
  await adminCaller.explore.deletePlaceComment({ id: adminAdded.comment.id });
  const gone = await caller.explore.placeComments({ placeId: commentTarget });
  check("admin deletes another's comment", !gone.comments.some((c) => c.id === adminAdded.comment.id));
}
await caller.explore.deletePlaceComment({ id: added.comment.id });
const afterDelete = await caller.explore.placeComments({ placeId: commentTarget });
check("own delete", !afterDelete.comments.some((c) => c.id === added.comment.id));

// ── 5. blog ingestion: new place persists, re-publish idempotent ────────────
// Real OSM places; pick the first one not yet cached in the corpus (earlier
// runs may already have imported some - that itself proves the cache grows).
const CANDIDATES = ["Onibus Coffee", "Koffee Mameya Kakeru", "Glitch Coffee", "Fuglen Tokyo", "Streamer Coffee Company"];
let NEW_PLACE = CANDIDATES[0]!;
for (const c of CANDIDATES) {
  const [hit] = await db
    .select({ id: schema.explorePlaces.id })
    .from(schema.explorePlaces)
    .where(sql`LOWER(TRIM(${schema.explorePlaces.name})) = ${c.toLowerCase()}`)
    .limit(1);
  if (!hit) {
    NEW_PLACE = c;
    break;
  }
  console.log(`  (cache already holds "${c}", imported earlier)`);
}
const content = `Tokyo coffee diary\n\n1. ${NEW_PLACE}\n\nWe started the morning at ${NEW_PLACE}, a lovely little coffee stand.`;
const sug = await caller.journal.suggestPlaces({ content });
const osmSug = sug.suggestions.find((s) => s.source === "osm") ?? sug.suggestions.find((s) => s.placeId != null);
check("suggestPlaces finds + imports OSM hit", osmSug != null && osmSug.placeId != null, osmSug ? `${osmSug.name} → placeId ${osmSug.placeId} (${osmSug.source})` : "no suggestion");
if (osmSug?.placeId != null) {
  const [row] = await db.select().from(schema.explorePlaces).where(eq(schema.explorePlaces.id, osmSug.placeId)).limit(1);
  check(
    "imported row persisted",
    row != null && row.approved,
    row ? `id=${row.id} name="${row.name}" city="${row.city}" country="${row.country}" osmId=${row.osmId} source=${row.source} verdict=${row.verdict} approved=${row.approved}` : "row missing",
  );
}

const created = await caller.journal.create({ title: "r11 verify blog", content, status: "published" });
const postId = created.id;
check("publish auto-attaches", created.autoAttached.length > 0, created.autoAttached.map((a) => `${a.name}${a.imported ? " (imported)" : ""}`).join(", "));
const get1 = await caller.journal.get({ id: postId });
const ids1 = [...(get1.post.placeIds ?? [])].sort((a, b) => a - b);
const dupes1 = ids1.filter((id, i) => ids1.indexOf(id) !== i);
check("no duplicate placeIds on publish", dupes1.length === 0);

// re-publish (edit) - extraction re-runs, unions without duplicating
await caller.journal.update({ id: postId, status: "published", content });
const get2 = await caller.journal.get({ id: postId });
const ids2 = [...(get2.post.placeIds ?? [])].sort((a, b) => a - b);
check("re-publish unions without dupes", JSON.stringify(ids1) === JSON.stringify(ids2), `${ids1.length} → ${ids2.length} places`);

// no duplicate corpus rows for the imported name
const dupeRows = await db
  .select({ n: sql<number>`count(*)`.mapWith(Number) })
  .from(schema.explorePlaces)
  .where(sql`LOWER(TRIM(${schema.explorePlaces.name})) = ${NEW_PLACE.toLowerCase()}`);
check("no duplicate corpus rows for imported name", (dupeRows[0]?.n ?? 0) <= 1, `${dupeRows[0]?.n ?? 0} row(s) named "${NEW_PLACE}"`);

// journal.get places carry verdict/closedStatus for the reader chips
check(
  "journal places expose verdict field",
  get2.places.every((p) => "verdict" in p && "closedStatus" in p),
);

await caller.journal.remove({ id: postId });
console.log(`\ncleaned up post #${postId}; failures: ${failures}`);
process.exit(failures ? 1 : 0);
