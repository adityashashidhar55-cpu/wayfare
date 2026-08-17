/**
 * explore.cityTastes - response shape (integration, runs only with
 * DATABASE_URL; skipped in DB-less CI). Covers: empty array for cities with
 * no curated dishes, and the {dish, blurb, places[]} shape for Bengaluru
 * (imported from db/data/signature-dishes-india.json), with corpus-joined
 * rating / famousEatery / placeId on linked places.
 */
import "dotenv/config";
import { describe, expect, it } from "vitest";
import { exploreRouter } from "./explore-router";

const hasDb = !!process.env.DATABASE_URL;
const caller = exploreRouter.createCaller({} as never);

describe.skipIf(!hasDb)("explore.cityTastes (integration)", () => {
  it("returns an empty array for a city with no curated dishes", async () => {
    const res = await caller.cityTastes({ city: "Zzxqville Nowhere" });
    expect(res).toEqual([]);
  }, 20000);

  it("returns Bengaluru's signature dishes in the expected shape", async () => {
    const res = await caller.cityTastes({ city: "Bengaluru", country: "India" });
    expect(res.length).toBeGreaterThanOrEqual(3); // filter coffee, masala dosa, idli-vada
    const names = res.map((d) => d.dish);
    expect(names).toContain("Filter coffee");
    expect(names).toContain("Masala dosa");
    for (const d of res) {
      expect(d.city).toBe("Bengaluru");
      expect(typeof d.dish).toBe("string");
      expect(d.blurb === null || typeof d.blurb === "string").toBe(true);
      expect(d.places.length).toBeGreaterThan(0);
      for (const p of d.places) {
        expect(typeof p.name).toBe("string");
        expect(p.why === null || typeof p.why === "string").toBe(true);
        expect(p.rating === null || typeof p.rating === "number").toBe(true);
        expect(typeof p.famousEatery).toBe("boolean");
        expect(p.image === null || typeof p.image === "string").toBe(true);
      }
    }
    // the filter-coffee card maps to MTR, linked into the corpus by the importer
    const coffee = res.find((d) => d.dish === "Filter coffee")!;
    const mtr = coffee.places.find((p) => p.name.includes("MTR"));
    expect(mtr).toBeDefined();
    expect(mtr!.placeId).not.toBeNull();
    expect(mtr!.famousEatery).toBe(true);
  }, 20000);
});
