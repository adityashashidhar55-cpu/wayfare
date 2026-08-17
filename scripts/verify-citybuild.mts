/**
 * City Builder E2E verification (r9-osmbuilder).
 * Run: npx tsx scripts/verify-citybuild.mts
 *
 * 1. cityProfile("Thoothukudi") - geocodes via Photon, imports OSM places
 *    (thin corpus), returns non-empty groups (must include temples + food).
 * 2. Second call - fast, idempotent (imported=0, same total).
 * 3. requestCityAI - inserts; duplicate → already:true.
 * 4. admin.cityRequests lists it; admin.markCityRequestDone works;
 *    non-admin caller is rejected (FORBIDDEN).
 */
import { appRouter } from "../api/router";
import { getDb } from "../api/queries/connection";
import * as schema from "../db/schema";
import { eq } from "drizzle-orm";

const db = getDb();
const [admin] = await db.select().from(schema.users).where(eq(schema.users.role, "admin")).limit(1);
const [user] = await db.select().from(schema.users).where(eq(schema.users.id, 2000001)).limit(1);
if (!admin || !user) throw new Error("Need an admin and user #2000001 in the DB");

const ctx = (u: typeof user) => ({ req: new Request("http://verify.local"), resHeaders: new Headers(), user: u });
const userCaller = appRouter.createCaller(ctx(user));
const adminCaller = appRouter.createCaller(ctx(admin));

console.log(`User: #${user.id} ${user.name} (${user.role}) · Admin: #${admin.id} ${admin.name}`);
console.log("─".repeat(70));

// ── 1. First cityProfile - triggers the OSM import ─────────────────────────
let t0 = Date.now();
const p1 = await userCaller.citybuild.cityProfile({ city: "Thoothukudi" });
const d1 = Date.now() - t0;
console.log(`\n[1] cityProfile("Thoothukudi"), first call: ${d1}ms`);
console.log(`    city=${p1.city} country=${p1.country} lat=${p1.lat} lng=${p1.lng}`);
console.log(`    total=${p1.total} importedThisCall=${p1.imported}`);
console.log(`    groups (${p1.groups.length}):`);
for (const g of p1.groups) {
  const sample = g.places
    .slice(0, 3)
    .map((p) => p.name)
    .join(" | ");
  console.log(`      ${g.emoji}  ${g.key.padEnd(11)} count=${String(g.count).padStart(3)}  e.g. ${sample}`);
}
const keys = p1.groups.map((g) => g.key);
if (!keys.includes("temples")) throw new Error("FAIL: temples group missing");
if (!keys.includes("food")) throw new Error("FAIL: food group missing");
if (p1.total < 12) throw new Error(`FAIL: total ${p1.total} < 12 after import`);

// ── 2. Second call - idempotent, fast ──────────────────────────────────────
t0 = Date.now();
const p2 = await userCaller.citybuild.cityProfile({ city: "Thoothukudi" });
const d2 = Date.now() - t0;
console.log(`\n[2] second call: ${d2}ms · total=${p2.total} importedThisCall=${p2.imported}`);
if (p2.imported !== 0) throw new Error(`FAIL: second call imported ${p2.imported} (not idempotent)`);
if (p2.total !== p1.total) throw new Error(`FAIL: total drifted ${p1.total} → ${p2.total} (dupes?)`);
if (d2 > 5000) console.log(`    WARN: second call took ${d2}ms (>5s)`);

// ── 3. requestCityAI - insert + dedupe ─────────────────────────────────────
const r1 = await userCaller.citybuild.requestCityAI({
  city: "Thoothukudi",
  country: p1.country,
  message: "Temple trail + seafood shacks, 2 days",
});
console.log(`\n[3] requestCityAI #1:`, JSON.stringify(r1));
if (r1.already) throw new Error("FAIL: first request flagged already=true");
const r2 = await userCaller.citybuild.requestCityAI({ city: "thoothukudi" });
console.log(`    requestCityAI #2 (duplicate, different case):`, JSON.stringify(r2));
if (!r2.already) throw new Error("FAIL: duplicate not detected");

// ── 4. admin list + markDone; non-admin blocked ────────────────────────────
const list1 = await adminCaller.admin.cityRequests();
console.log(`\n[4] admin.cityRequests: pendingCount=${list1.pendingCount}`);
const mine = list1.requests.find((r) => r.city === "Thoothukudi" && r.userId === user.id);
if (!mine) throw new Error("FAIL: request not visible to admin");
console.log(`    row: id=${mine.id} city=${mine.city} by=${mine.userName} status=${mine.status} msg=${mine.message}`);
const done = await adminCaller.admin.markCityRequestDone({ id: mine.id });
console.log(`    markCityRequestDone → status=${done.status}`);
if (done.status !== "done") throw new Error("FAIL: markDone did not flip status");
const list2 = await adminCaller.admin.cityRequests();
console.log(`    after: pendingCount=${list2.pendingCount}`);

let blocked = false;
try {
  await userCaller.admin.cityRequests();
} catch (e) {
  blocked = true;
  console.log(`    non-admin blocked from admin.cityRequests ✓ (${(e as Error).message.slice(0, 40)}…)`);
}
if (!blocked) throw new Error("FAIL: non-admin could read admin.cityRequests");
let blocked2 = false;
try {
  await userCaller.admin.markCityRequestDone({ id: mine.id });
} catch {
  blocked2 = true;
  console.log(`    non-admin blocked from admin.markCityRequestDone ✓`);
}
if (!blocked2) throw new Error("FAIL: non-admin could markCityRequestDone");

console.log("\n✅ ALL CITY-BUILDER CHECKS PASSED");
process.exit(0);
