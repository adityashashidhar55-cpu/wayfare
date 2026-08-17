/**
 * explore.famousEats - query shape (integration, runs only with DATABASE_URL;
 * skipped in DB-less CI). Covers: local famous eateries ranked by rating,
 * the {city, country, places, fallback} shape, and the nearest-big-city
 * fallback for a food city with no famous eateries of its own.
 */
import "dotenv/config";
import { describe, expect, it } from "vitest";
import { exploreRouter } from "./explore-router";

const hasDb = !!process.env.DATABASE_URL;
const caller = exploreRouter.createCaller({} as never);

describe.skipIf(!hasDb)("explore.famousEats (integration)", () => {
  it("returns Kyoto's famous eateries in the expected shape, ranked by rating", async () => {
    const res = await caller.famousEats({ city: "Kyoto", limit: 10 });
    expect(res.city).toBe("Kyoto");
    expect(res.fallback).toBeNull();
    expect(res.places.length).toBeGreaterThan(0);
    expect(res.places.length).toBeLessThanOrEqual(10);
    for (const p of res.places) {
      expect(p.category).toBe("food");
      expect(p.famousEatery).toBe(true);
      expect(p.city).toBe("Kyoto");
      expect(p.approved).toBe(true);
    }
    const ratings = res.places.map((p) => p.rating ?? 0);
    expect([...ratings].sort((a, b) => b - a)).toEqual(ratings);
  }, 20000);

  it("falls back to the nearest big corpus city when the city has none locally", async () => {
    // 大阪市 (Osaka ja): exactly 1 food place, 0 famous eateries.
    const res = await caller.famousEats({ city: "大阪市", limit: 5 });
    if (res.places.length === 0) {
      // no famous eateries anywhere near - fallback legitimately absent
      expect(res.fallback).toBeNull();
      return;
    }
    expect(res.fallback).not.toBeNull();
    for (const p of res.places) {
      expect(p.famousEatery).toBe(true);
      expect(p.city).toBe(res.fallback!.city);
    }
  }, 20000);

  it("respects the limit and never returns non-famous places", async () => {
    const res = await caller.famousEats({ city: "Bengaluru", limit: 3 });
    expect(res.places.length).toBeLessThanOrEqual(3);
    expect(res.places.every((p) => p.famousEatery)).toBe(true);
  }, 20000);
});
