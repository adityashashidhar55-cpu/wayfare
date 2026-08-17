import { describe, expect, it } from "vitest";
import {
  FAME_MAX_PER_CITY,
  fameQuota,
  pickFamousEateries,
  pickFamousEatsFallback,
  type FameCandidate,
} from "./famous-eats";

/** N candidates, rating 4.3, ids 1..N. */
function uniform(n: number, rating = 4.3): FameCandidate[] {
  return Array.from({ length: n }, (_, i) => ({ id: i + 1, rating, verdict: "worth-it" }));
}

describe("fameQuota", () => {
  it("is ~8% of the city's food places, at least 1, capped at 15", () => {
    expect(fameQuota(0)).toBe(0);
    expect(fameQuota(1)).toBe(1);
    expect(fameQuota(100)).toBe(8);
    expect(fameQuota(421)).toBe(FAME_MAX_PER_CITY); // Bengaluru-sized city hits the cap
    expect(fameQuota(1000)).toBe(FAME_MAX_PER_CITY);
  });
});

describe("pickFamousEateries, fame rule thresholds", () => {
  it("caps the rating-based picks at 15 per city, ties break by id", () => {
    const famous = pickFamousEateries(uniform(421));
    expect(famous.size).toBe(15);
    // deterministic: lowest ids win the tie at equal rating
    expect([...famous].sort((a, b) => a - b)).toEqual(Array.from({ length: 15 }, (_, i) => i + 1));
  });

  it("takes the top ~8% by rating when under the cap", () => {
    // 100 places, ratings 4.30 + i*0.001 → top 8 are the highest ids
    const candidates: FameCandidate[] = Array.from({ length: 100 }, (_, i) => ({
      id: i + 1,
      rating: 4.3 + i * 0.001,
      verdict: "worth-it",
    }));
    const famous = pickFamousEateries(candidates);
    expect(famous.size).toBe(8);
    expect([...famous].sort((a, b) => a - b)).toEqual([93, 94, 95, 96, 97, 98, 99, 100]);
  });

  it("enforces the 4.3 minimum rating", () => {
    const candidates: FameCandidate[] = [
      { id: 1, rating: 4.29, verdict: "worth-it" },
      { id: 2, rating: 4.2, verdict: "worth-it" },
      { id: 3, rating: null, verdict: "worth-it" },
    ];
    expect(pickFamousEateries(candidates).size).toBe(0);
  });

  // r25: the old filter was `(p.rating ?? 0) >= 4.3` and the OSM importer wrote
  // exactly 4.3 onto every row, so a NULL rating must now be excluded outright
  // rather than treated as "just below the line".
  it("excludes places with no rating from the rating-based picks", () => {
    const candidates: FameCandidate[] = Array.from({ length: 100 }, (_, i) => ({
      id: i + 1,
      rating: null,
      verdict: "worth-it",
    }));
    expect(pickFamousEateries(candidates).size).toBe(0);
  });

  it("falls back to photo+description quality when nothing is genuinely rated", () => {
    const candidates: FameCandidate[] = [
      { id: 1, rating: null, verdict: "worth-it", photoSource: "wikipedia", descriptionSource: "dbpedia" },
      { id: 2, rating: null, verdict: "worth-it", photoSource: "osm", descriptionSource: "curated" },
      // composed description + no real photo = an untouched import, not famous
      { id: 3, rating: null, verdict: "worth-it", photoSource: null, descriptionSource: "composed" },
      { id: 4, rating: null, verdict: "worth-it", photoSource: "osm", descriptionSource: "composed" },
    ];
    const famous = pickFamousEateries(candidates);
    // The fallback respects the same quota as the rating path: with only 4
    // candidates fameQuota is 1, so exactly the first quality row qualifies.
    // What matters is that a real photo + researched description wins, and
    // that an untouched import (composed description, no photo) never does.
    expect(famous.has(1)).toBe(true);
    expect(famous.has(3)).toBe(false);
    expect(famous.has(4)).toBe(false);
  });

  it("respects the quota when several candidates pass the quality fallback", () => {
    // 25 candidates -> fameQuota = ceil(25 * 0.08) = 2
    const candidates: FameCandidate[] = Array.from({ length: 25 }, (_, i) => ({
      id: i + 1,
      rating: null,
      verdict: "worth-it",
      photoSource: "wikipedia",
      descriptionSource: "dbpedia",
    }));
    expect(pickFamousEateries(candidates).size).toBe(2);
  });

  it("does not use the quality fallback when real ratings exist", () => {
    const candidates: FameCandidate[] = [
      { id: 1, rating: 4.8, verdict: "worth-it" },
      { id: 2, rating: null, verdict: "worth-it", photoSource: "wikipedia", descriptionSource: "dbpedia" },
    ];
    const famous = pickFamousEateries(candidates);
    expect(famous.has(1)).toBe(true);
    expect(famous.has(2)).toBe(false);
  });

  it("verdict='must-see' overrides both the minimum rating and the cap", () => {
    const candidates: FameCandidate[] = [
      ...uniform(421),
      { id: 999, rating: 3.9, verdict: "must-see" }, // low-rated but editorially famous
    ];
    const famous = pickFamousEateries(candidates);
    expect(famous.size).toBe(16); // 15 quota + the must-see override
    expect(famous.has(999)).toBe(true);
  });

  it("honours the ≥3-comments fame signal when comment counts are provided", () => {
    const candidates: FameCandidate[] = [
      { id: 1, rating: 4.0, verdict: "worth-it" },
      { id: 2, rating: 4.0, verdict: "worth-it" },
    ];
    const famous = pickFamousEateries(candidates, {
      commentCounts: new Map([
        [1, 3], // exactly at the threshold
        [2, 2],
      ]),
    });
    expect(famous.has(1)).toBe(true);
    expect(famous.has(2)).toBe(false);
  });
});

describe("pickFamousEatsFallback, nearest big corpus city", () => {
  const cities = [
    { city: "Big Near", country: "X", lat: 10.1, lng: 20.1, food: 200, famous: 15 },
    { city: "Big Far", country: "X", lat: 40, lng: 70, food: 500, famous: 15 },
    { city: "Tiny Near", country: "X", lat: 10.01, lng: 20.01, food: 3, famous: 1 },
    { city: "No Fame", country: "X", lat: 10.02, lng: 20.02, food: 300, famous: 0 },
  ];

  it("prefers the nearest BIG city with famous eateries, not the tiny close one", () => {
    const pick = pickFamousEatsFallback(cities, "Smalltown", { lat: 10, lng: 20 });
    expect(pick?.city).toBe("Big Near");
  });

  it("never picks the requested city itself or a city without famous eateries", () => {
    const pick = pickFamousEatsFallback(
      [
        { city: "Smalltown", country: "X", lat: 10, lng: 20, food: 100, famous: 5 },
        ...cities.filter((c) => c.city === "No Fame"),
      ],
      "Smalltown",
      { lat: 10, lng: 20 },
    );
    expect(pick).toBeNull();
  });

  it("falls back to the biggest food city when the origin is unknown", () => {
    const pick = pickFamousEatsFallback(cities, "Nowhere", null);
    expect(pick?.city).toBe("Big Far");
  });

  it("uses the whole pool when no city is 'big'", () => {
    const pick = pickFamousEatsFallback(
      [
        { city: "A", country: "X", lat: 10.2, lng: 20.2, food: 5, famous: 1 },
        { city: "B", country: "X", lat: 10.4, lng: 20.4, food: 5, famous: 1 },
      ],
      "Smalltown",
      { lat: 10, lng: 20 },
    );
    expect(pick?.city).toBe("A");
  });
});
