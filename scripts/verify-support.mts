/**
 * Support system verification (r10-support). Run: npx tsx scripts/verify-support.mts
 *
 * Exercises the full ticket lifecycle through the real tRPC router:
 *   1. Voyager user submits 2 tickets in different categories → myTickets lists them.
 *   2. Validation rejects a too-short message (BAD_REQUEST).
 *   3. Wanderer submit → FORBIDDEN / UPGRADE_REQUIRED.
 *   4. admin.ticketStats reflects the new tickets; supportTickets({status}) filters.
 *   5. closeTicket flips status → reopenTicket flips it back.
 *
 * Creates three fixture users (test:r10-*) and leaves the two tickets in place
 * so the Admin → Support tab has something to show in the browser check.
 */
import { eq } from "drizzle-orm";
import { appRouter } from "../api/router";
import { getDb } from "../api/queries/connection";
import * as schema from "../db/schema";

let failures = 0;
function check(label: string, ok: boolean, detail = "") {
  console.log(`${ok ? "✓" : "✗ FAIL"} ${label}${detail ? `, ${detail}` : ""}`);
  if (!ok) failures += 1;
}

const db = getDb();

async function ensureUser(unionId: string, name: string, role: "user" | "admin", tier: "wanderer" | "voyager") {
  const existing = await db.select().from(schema.users).where(eq(schema.users.unionId, unionId)).limit(1);
  let user = existing[0];
  if (!user) {
    const res = await db.insert(schema.users).values({
      unionId,
      name,
      email: `${unionId.replace(":", ".")}@example.com`,
      role,
      lastSignInAt: new Date(),
    });
    const id = Number(res[0].insertId);
    user = (await db.select().from(schema.users).where(eq(schema.users.id, id)).limit(1))[0]!;
  } else if (user.role !== role) {
    await db.update(schema.users).set({ role }).where(eq(schema.users.id, user.id));
    user = { ...user, role };
  }
  await db
    .insert(schema.subscriptions)
    .values({ userId: user.id, tier, status: "active" })
    .onDuplicateKeyUpdate({ set: { tier, status: "active" } });
  return user;
}

const voyager = await ensureUser("test:r10-voyager", "Vera Voyager", "user", "voyager");
const wanderer = await ensureUser("test:r10-wanderer", "Wally Wanderer", "user", "wanderer");
const admin = await ensureUser("test:r10-admin", "Ada Admin", "admin", "wanderer");

const callerFor = (user: typeof voyager) =>
  appRouter.createCaller({ req: new Request("http://verify.local"), resHeaders: new Headers(), user });

const voyagerCaller = callerFor(voyager);
const wandererCaller = callerFor(wanderer);
const adminCaller = callerFor(admin);

// Baseline stats so counts can be asserted exactly.
const before = await adminCaller.admin.ticketStats();

// ── 1. Voyager submits two tickets in different categories ──────────────────
console.log("── Voyager submits 2 tickets ──");
const t1 = await voyagerCaller.support.submitTicket({
  category: "booking",
  message: "My hotel confirmation email never imported into my Lisbon trip, even after two forwards.",
});
check("ticket 1 (booking) created", t1.ok && t1.ticket?.category === "booking", `id=${t1.ticket?.id}`);
const t2 = await voyagerCaller.support.submitTicket({
  category: "weather",
  message: "The weather strip shows a tilde for next month, is that a forecast or an average?",
  email: "vera.alt@example.com",
});
check("ticket 2 (weather) created with alt email", t2.ok && t2.ticket?.email === "vera.alt@example.com", `id=${t2.ticket?.id}`);

const mine = await voyagerCaller.support.myTickets();
const mineIds = mine.tickets.map((t) => t.id);
check(
  "myTickets lists both new tickets",
  mineIds.includes(t1.ticket!.id) && mineIds.includes(t2.ticket!.id),
  `count=${mine.tickets.length}`,
);
check("myTickets rows carry status", mine.tickets.every((t) => t.status === "open" || t.status === "closed"));

// Wanderer sees only their own (empty) history - no cross-user leakage.
const wandererMine = await wandererCaller.support.myTickets();
check(
  "wanderer myTickets has none of the voyager tickets",
  !wandererMine.tickets.some((t) => mineIds.includes(t.id)),
);

// ── 2. Validation ────────────────────────────────────────────────────────────
console.log("── Validation ──");
try {
  await voyagerCaller.support.submitTicket({ category: "bug", message: "too short" });
  check("short message rejected", false, "mutation succeeded unexpectedly");
} catch (e) {
  const code = (e as { code?: string })?.code;
  check("short message rejected", code === "BAD_REQUEST", `code=${code}`);
}
try {
  await voyagerCaller.support.submitTicket({ category: "nope" as never, message: "this message is long enough" });
  check("bad category rejected", false, "mutation succeeded unexpectedly");
} catch (e) {
  const code = (e as { code?: string })?.code;
  check("bad category rejected", code === "BAD_REQUEST", `code=${code}`);
}

// ── 3. Wanderer gate ─────────────────────────────────────────────────────────
console.log("── Wanderer gate ──");
try {
  await wandererCaller.support.submitTicket({
    category: "other",
    message: "I am a free-tier traveler trying to file a support ticket.",
  });
  check("wanderer submit blocked", false, "mutation succeeded unexpectedly");
} catch (e) {
  const err = e as { code?: string; message?: string };
  check("wanderer submit blocked", err.code === "FORBIDDEN" && err.message === "UPGRADE_REQUIRED", `${err.code}/${err.message}`);
}

// Non-admin cannot read the admin queue.
try {
  await voyagerCaller.admin.ticketStats();
  check("non-admin blocked from ticketStats", false, "query succeeded unexpectedly");
} catch (e) {
  const code = (e as { code?: string })?.code;
  check("non-admin blocked from ticketStats", code === "FORBIDDEN", `code=${code}`);
}

// ── 4. Admin stats + filters ─────────────────────────────────────────────────
console.log("── Admin stats ──");
const after = await adminCaller.admin.ticketStats();
check("open count +2", after.open === before.open + 2, `${before.open} → ${after.open}`);
check("total +2", after.total === before.total + 2, `${before.total} → ${after.total}`);
check(
  "booking category +1",
  (after.byCategory.booking ?? 0) === (before.byCategory.booking ?? 0) + 1,
  `booking=${after.byCategory.booking}`,
);
check(
  "weather category +1",
  (after.byCategory.weather ?? 0) === (before.byCategory.weather ?? 0) + 1,
  `weather=${after.byCategory.weather}`,
);

const openOnly = await adminCaller.admin.supportTickets({ status: "open" });
check(
  "supportTickets({status:'open'}) contains both, open-first ordering",
  openOnly.tickets.some((t) => t.id === t1.ticket!.id) && openOnly.tickets.some((t) => t.id === t2.ticket!.id),
);
const joined = openOnly.tickets.find((t) => t.id === t1.ticket!.id);
check("user name joined onto ticket", joined?.userName === "Vera Voyager", `userName=${joined?.userName}`);

// ── 5. Close / reopen ────────────────────────────────────────────────────────
console.log("── Close / reopen ──");
const closed = await adminCaller.admin.closeTicket({ id: t1.ticket!.id });
check("closeTicket flips status", closed.status === "closed");
const statsAfterClose = await adminCaller.admin.ticketStats();
check("stats reflect close", statsAfterClose.open === after.open - 1 && statsAfterClose.closed === after.closed + 1);
const reopened = await adminCaller.admin.reopenTicket({ id: t1.ticket!.id });
check("reopenTicket flips status back", reopened.status === "open");
// Leave ticket 1 closed so the admin tab shows both states.
await adminCaller.admin.closeTicket({ id: t1.ticket!.id });
const final = await adminCaller.admin.ticketStats();
check(
  "final state: 1 open + 1 closed of the two new tickets",
  final.open === before.open + 1 && final.closed === before.closed + 1,
  `open=${final.open} closed=${final.closed}`,
);

console.log(failures === 0 ? "\nALL CHECKS PASSED" : `\n${failures} CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
