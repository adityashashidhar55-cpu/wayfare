/**
 * r14-nearby - unit tests for the getaways/around-me shared logic:
 * 30-day cache keys + hit/miss behavior, preference → category/tag mapping,
 * dedupe, and the <12 km city-sight exclusion band. Pure-function level -
 * no database.
 */
import { describe, expect, it } from "vitest";
import {
  AROUND_ME_CACHE_TTL_MS,
  aroundMeCacheKeyFor,
  aroundMeScore,
  cacheThrough,
  CITY_SIGHT_KM,
  classifyGetaway,
  dedupePlaces,
  matchesStyle,
  NEAR_CACHE_TTL_MS,
  nearCacheKeyFor,
  roundQuarter,
  styleMatchersFor,
  stylesHash,
  withinGetawayBand,
  type CacheLike,
} from "./lib/getaways-shared";

const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

// ─── cache keys + TTL ────────────────────────────────────────────────────────

describe("cache keys", () => {
  it("TTLs are 30 days", () => {
    expect(NEAR_CACHE_TTL_MS).toBe(THIRTY_DAYS_MS);
    expect(AROUND_ME_CACHE_TTL_MS).toBe(THIRTY_DAYS_MS);
  });

  it("near key uses the normalized city name and radius", () => {
    expect(nearCacheKeyFor({ city: "  New   Delhi ", radiusKm: 150 })).toBe(
      "getaways:v2:near:new delhi:150",
    );
  });

  it("near key falls back to 2dp-rounded coordinates", () => {
    expect(nearCacheKeyFor({ lat: 12.9716, lng: 77.5946, radiusKm: 150 })).toBe(
      "getaways:v2:near:12.97,77.59:150",
    );
  });

  it("roundQuarter snaps to the 0.25° grid", () => {
    expect(roundQuarter(12.97)).toBe(13);
    expect(roundQuarter(12.10)).toBe(12);
    expect(roundQuarter(-33.87)).toBe(-33.75);
    expect(roundQuarter(0.13)).toBe(0.25);
    expect(roundQuarter(0.124)).toBe(0);
  });

  it("stylesHash is order-insensitive and dedupes", () => {
    expect(stylesHash(["food", "adventure"])).toBe(stylesHash(["adventure", "food"]));
    expect(stylesHash(["Food", " food "])).toBe(stylesHash(["food"]));
    expect(stylesHash([])).not.toBe(stylesHash(["food"]));
  });

  it("aroundMe key snaps coords to 0.25° and hashes sorted styles", () => {
    const a = aroundMeCacheKeyFor({ lat: 12.97, lng: 77.59, styles: ["food", "nature"] });
    const b = aroundMeCacheKeyFor({ lat: 13.01, lng: 77.61, styles: ["nature", "food"] });
    expect(a).toBe(b);
    expect(a).toMatch(/^getaways:v2:aroundme:13,77\.5:[0-9a-f]{16}$/);
    const c = aroundMeCacheKeyFor({ lat: 13.2, lng: 77.59, styles: ["nature", "food"] });
    expect(c).not.toBe(a);
  });
});

// ─── cacheThrough hit/miss behavior ──────────────────────────────────────────

function fakeCache(initial: Record<string, unknown> = {}) {
  const store = new Map<string, { v: unknown; ttlMs: number }>(
    Object.entries(initial).map(([k, v]) => [k, { v, ttlMs: 0 }]),
  );
  const cache: CacheLike = {
    get: async <T>(k: string) => (store.has(k) ? (store.get(k)!.v as T) : null),
    set: async (k: string, v: unknown, ttlMs: number) => {
      store.set(k, { v, ttlMs });
    },
  };
  return { cache, store };
}

describe("cacheThrough", () => {
  it("miss: computes, stamps cachedAt, stores with the TTL", async () => {
    const { cache, store } = fakeCache();
    let computed = 0;
    const out = await cacheThrough(cache, "k", NEAR_CACHE_TTL_MS, async () => {
      computed++;
      return { total: 7 };
    });
    expect(computed).toBe(1);
    expect(out.total).toBe(7);
    expect(typeof out.cachedAt).toBe("string");
    expect(store.get("k")!.ttlMs).toBe(THIRTY_DAYS_MS);
    expect(store.get("k")!.v).toEqual(out);
  });

  it("hit: returns cached payload and does NOT recompute", async () => {
    const { cache } = fakeCache({ k: { total: 3, cachedAt: "2024-01-01T00:00:00.000Z" } });
    let computed = 0;
    const out = await cacheThrough(cache, "k", NEAR_CACHE_TTL_MS, async () => {
      computed++;
      return { total: 99 };
    });
    expect(computed).toBe(0);
    expect(out.total).toBe(3);
    expect(out.cachedAt).toBe("2024-01-01T00:00:00.000Z");
  });

  it("compute errors propagate and are NOT cached", async () => {
    const { cache, store } = fakeCache();
    await expect(
      cacheThrough(cache, "k", NEAR_CACHE_TTL_MS, async () => {
        throw new Error("overpass down");
      }),
    ).rejects.toThrow("overpass down");
    expect(store.has("k")).toBe(false);
  });
});

// ─── preference → category/tag mapping ───────────────────────────────────────

describe("styleMatchersFor / matchesStyle", () => {
  const place = (name: string, category: string, tags: string[] = []) => ({ name, category, tags });

  it("nature/adventure → hikes, viewpoints, nature", () => {
    expect(matchesStyle(place("Skandagiri", "adventure", ["hike", "peak"]), ["adventure"])).toBe(true);
    expect(matchesStyle(place("Eagle Viewpoint", "activity", ["viewpoint"]), ["nature"])).toBe(true);
    expect(matchesStyle(place("City Museum", "activity", ["museum"]), ["adventure"])).toBe(false);
  });

  it("historical/culture → heritage + museums", () => {
    expect(matchesStyle(place("Old Fort", "historic", ["fort"]), ["historical"])).toBe(true);
    expect(matchesStyle(place("National Museum", "activity", ["museum"]), ["culture"])).toBe(true);
    expect(matchesStyle(place("Sandy Cove", "natural", ["beach"]), ["historical"])).toBe(false);
  });

  it("food & drink → cafes + restaurants", () => {
    expect(matchesStyle(place("Third Wave Coffee", "food", ["cafe", "coffee"]), ["food"])).toBe(true);
    expect(matchesStyle(place("Trattoria Roma", "food", ["restaurant"]), ["food & drink"])).toBe(true);
    expect(matchesStyle(place("Granite Peak", "adventure", ["peak"]), ["food"])).toBe(false);
  });

  it("relaxing → lakes, parks, beaches", () => {
    expect(matchesStyle(place("Phewa Lake", "natural", ["lake"]), ["relaxing"])).toBe(true);
    expect(matchesStyle(place("Lalbagh Botanical Garden", "activity", ["garden"]), ["relaxing"])).toBe(true);
    expect(matchesStyle(place("Bondi Beach", "natural", ["beach"]), ["relaxing"])).toBe(true);
    expect(matchesStyle(place("Night Market", "activity", ["market"]), ["relaxing"])).toBe(false);
  });

  it("photography → viewpoints + landmarks", () => {
    expect(matchesStyle(place("Sunset Point", "activity", ["viewpoint"]), ["photography"])).toBe(true);
    expect(matchesStyle(place("Harbour Bridge", "activity", ["landmark"]), ["photography"])).toBe(true);
    expect(matchesStyle(place("Noodle House", "food", ["restaurant"]), ["photography"])).toBe(false);
  });

  it("union semantics: any style matches; empty styles match everything", () => {
    const cafe = place("Café Noir", "food", ["cafe"]);
    expect(matchesStyle(cafe, [])).toBe(true);
    expect(matchesStyle(cafe, ["photography", "food"])).toBe(true);
    expect(matchesStyle(cafe, ["photography", "historical"])).toBe(false);
    // unknown styles don't restrict the result
    expect(matchesStyle(cafe, ["underwater-basketweaving"])).toBe(true);
  });

  it("styleMatchersFor dedupes shared matchers (adventure+nature)", () => {
    expect(styleMatchersFor(["adventure", "nature"]).length).toBe(1);
    expect(styleMatchersFor(["adventure", "food"]).length).toBe(2);
  });
});

// ─── getaway classification (12 km band input) ───────────────────────────────

describe("withinGetawayBand", () => {
  it("excludes <12 km (city sights) and >radius, keeps the band", () => {
    expect(CITY_SIGHT_KM).toBe(12);
    expect(withinGetawayBand(0, 150)).toBe(false);
    expect(withinGetawayBand(11.99, 150)).toBe(false);
    expect(withinGetawayBand(12, 150)).toBe(true);
    expect(withinGetawayBand(60, 150)).toBe(true);
    expect(withinGetawayBand(150, 150)).toBe(true);
    expect(withinGetawayBand(150.1, 150)).toBe(false);
  });
});

describe("classifyGetaway", () => {
  it("buckets getaways into hikes / nature / heritage", () => {
    expect(classifyGetaway("Nandi Hills", ["peak", "viewpoint"])?.group).toBe("hikes");
    expect(classifyGetaway("Shivanasamudra Falls", ["viewpoint"])?.group).toBe("nature");
    expect(classifyGetaway("Golconda Fort", ["fort"])?.group).toBe("heritage");
    expect(classifyGetaway("Random Restaurant", ["restaurant"])).toBeNull();
  });
});

// ─── dedupe ──────────────────────────────────────────────────────────────────

describe("dedupePlaces", () => {
  const row = (id: number, name: string, lat: number, lng: number) => ({ id, name, lat, lng });

  it("drops duplicate ids", () => {
    const out = dedupePlaces([row(1, "A", 10, 10), row(1, "A", 10, 10)]);
    expect(out.length).toBe(1);
  });

  it("drops same-name rows within 5 km (OSM node vs curated row)", () => {
    const out = dedupePlaces([
      row(1, "Nandi Hills", 13.3702, 77.6835),
      row(2, "nandi   hills", 13.371, 77.684), // ~0.1 km away, same name
    ]);
    expect(out.length).toBe(1);
    expect(out[0]!.id).toBe(1);
  });

  it("keeps same-name rows that are far apart", () => {
    const out = dedupePlaces([
      row(1, "Lake View", 13.37, 77.68),
      row(2, "Lake View", 14.0, 78.2),
    ]);
    expect(out.length).toBe(2);
  });

  it("drops generic OSM placeholder names", () => {
    const out = dedupePlaces([
      row(1, "View Point", 13.37, 77.68),
      row(2, "Central Park", 13.38, 77.69), // whitelisted famous name - kept
      row(3, "Eagle Peak", 13.39, 77.7),
    ]);
    expect(out.map((r) => r.name)).toEqual(["Central Park", "Eagle Peak"]);
  });
});

// ─── ranking blend ───────────────────────────────────────────────────────────

describe("aroundMeScore", () => {
  it("higher rating and closer distance score higher", () => {
    const nearGreat = aroundMeScore({ rating: 4.8, distKm: 5 });
    const farGreat = aroundMeScore({ rating: 4.8, distKm: 120 });
    const nearOk = aroundMeScore({ rating: 3.6, distKm: 5 });
    expect(nearGreat).toBeGreaterThan(farGreat);
    expect(nearGreat).toBeGreaterThan(nearOk);
  });

  it("unrated places get the 4.2 default; scores stay within bounds", () => {
    const unrated = aroundMeScore({ rating: null, distKm: 0 });
    const rated42 = aroundMeScore({ rating: 4.2, distKm: 0 });
    expect(unrated).toBe(rated42);
    expect(aroundMeScore({ rating: 5, distKm: 0 })).toBeLessThanOrEqual(100);
    expect(aroundMeScore({ rating: 2, distKm: 300 })).toBeGreaterThan(0);
  });
});
