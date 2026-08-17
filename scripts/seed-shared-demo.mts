import { eq } from "drizzle-orm";
import { appRouter } from "../api/router";
import { getDb } from "../api/queries/connection";
import * as schema from "../db/schema";
import { hashPassword } from "../api/lib/passwords";

const db = getDb();
const email = "share-demo@verify.local";
let [u] = await db.select().from(schema.users).where(eq(schema.users.email, email)).limit(1);
if (!u) {
  await db.insert(schema.users).values({
    unionId: "verify-share-demo",
    name: "Share Demo",
    email,
    passwordHash: await hashPassword("demo-share-123"),
    lastSignInAt: new Date(),
  });
  [u] = await db.select().from(schema.users).where(eq(schema.users.email, email)).limit(1);
}
const caller = appRouter.createCaller({ req: new Request("http://x"), resHeaders: new Headers(), user: u! });
const { id } = await caller.trips.create({ title: "Kyoto in Bloom", destination: "Kyoto, Japan", startDate: "2026-04-04", endDate: "2026-04-07", coverImage: "/hero-kyoto.jpg" });
const full = await caller.trips.get({ id });
const d = full.days;
await caller.trips.addStop({ tripId: id, dayId: d[0].id, name: "Fushimi Inari Shrine", category: "activity", startTime: "09:00", durationMin: 150, notes: "Go early to beat the crowds at the torii gates." });
await caller.trips.addStop({ tripId: id, dayId: d[0].id, name: "Nishiki Market lunch", category: "food", startTime: "12:30", durationMin: 90 });
await caller.trips.addStop({ tripId: id, dayId: d[1].id, name: "Arashiyama Bamboo Grove", category: "activity", startTime: "08:30", durationMin: 120 });
await caller.trips.addStop({ tripId: id, dayId: d[1].id, name: "Kinkaku-ji (Golden Pavilion)", category: "activity", startTime: "14:00", durationMin: 90 });
await caller.trips.addStop({ tripId: id, dayId: d[2].id, name: "Gion evening walk", category: "other", startTime: "18:00", durationMin: 120, notes: "Lanterns come on around sunset." });
await caller.trips.addStop({ tripId: id, dayId: null, name: "TeamLab Biovortex (if time)", category: "activity" });
const { token } = await caller.share.enableShareLink({ tripId: id });
console.log(`TRIP=${id} TOKEN=${token}`);
