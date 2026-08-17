/**
 * Signature-dish place matching (r16-culinary) - the pure logic the importer
 * (db/import-signature-dishes.ts) uses to link JSON places to explore_places:
 * normalized-name match + haversine <1 km, café-ish tag heuristic.
 */
import { describe, expect, it } from "vitest";
import {
  haversineKm,
  isCafeIsh,
  matchDishPlace,
  namesMatch,
  normalizePlaceName,
} from "./signature-dishes";

describe("normalizePlaceName", () => {
  it("lowercases, strips accents and punctuation", () => {
    expect(normalizePlaceName("Mavalli Tiffin Room (MTR)")).toBe("mavalli tiffin room mtr");
    expect(normalizePlaceName("Brahmin's Coffee Bar")).toBe("brahmin s coffee bar");
    expect(normalizePlaceName("Café  São-Bento")).toBe("cafe sao bento");
  });
});

describe("haversineKm", () => {
  it("computes plausible distances", () => {
    // MTR → Vidyarthi Bhavan ≈ 1.9 km
    const d = haversineKm(
      { lat: 12.9550389, lng: 77.5854279 },
      { lat: 12.9450065, lng: 77.5714721 },
    );
    expect(d).toBeGreaterThan(1.5);
    expect(d).toBeLessThan(2.5);
    expect(haversineKm({ lat: 1, lng: 1 }, { lat: 1, lng: 1 })).toBe(0);
  });
});

describe("namesMatch", () => {
  it("matches containment and shared distinctive tokens", () => {
    expect(namesMatch("Mavalli Tiffin Room (MTR)", "Mavalli Tiffin Rooms")).toBe(true);
    expect(namesMatch("CTR (Central Tiffin Room)", "Shree Sagar CTR")).toBe(true);
    expect(namesMatch("Brahmin's Coffee Bar", "Brahmins Coffee Bar")).toBe(true); // stem match
  });
  it("rejects different establishments", () => {
    expect(namesMatch("Vidyarthi Bhavan", "Mavalli Tiffin Rooms")).toBe(false);
    expect(namesMatch("Veena Stores", "CTR")).toBe(false);
  });
});

describe("matchDishPlace", () => {
  const corpus = [
    { id: 1, name: "Mavalli Tiffin Rooms", lat: 12.95504, lng: 77.58543 },
    { id: 2, name: "Shree Sagar CTR", lat: 12.9982568, lng: 77.5694946 },
    // same name, 8 km away - must NOT win
    { id: 3, name: "Mavalli Tiffin Rooms", lat: 12.88, lng: 77.5 },
  ];

  it("matches by name within 1 km and picks the nearest", () => {
    const hit = matchDishPlace(corpus, {
      name: "Mavalli Tiffin Room (MTR)",
      lat: 12.9550389,
      lng: 77.5854279,
    });
    expect(hit?.place.id).toBe(1);
    expect(hit?.distanceKm).toBeLessThan(0.1);
  });

  it("matches abbreviation-token names within radius", () => {
    const hit = matchDishPlace(corpus, {
      name: "CTR (Central Tiffin Room)",
      lat: 12.9982568,
      lng: 77.5694946,
    });
    expect(hit?.place.id).toBe(2);
  });

  it("rejects name matches beyond the 1 km radius", () => {
    // closest corpus point to (12.88, 77.5) with that name is #3, but the
    // target sits next to #1 → #3 is >1km away, so no match at all.
    const hit = matchDishPlace(corpus, {
      name: "Mavalli Tiffin Rooms",
      lat: 12.87,
      lng: 77.49,
    });
    expect(hit).toBeNull();
  });

  it("rejects when the name does not match even at zero distance", () => {
    const hit = matchDishPlace(corpus, {
      name: "Veena Stores",
      lat: 12.95504,
      lng: 77.58543,
    });
    expect(hit).toBeNull();
  });

  it("falls back to exact-name match when coordinates are missing", () => {
    const hit = matchDishPlace(
      [{ id: 9, name: "Veena Stores", lat: null, lng: null }],
      { name: "Veena Stores" },
    );
    expect(hit?.place.id).toBe(9);
    expect(hit?.distanceKm).toBeNull();
  });
});

describe("isCafeIsh", () => {
  it("flags coffee/tea/bakery names or dishes as café-ish", () => {
    expect(isCafeIsh("Brahmin's Coffee Bar", "Filter coffee")).toBe(true);
    expect(isCafeIsh("Vidyarthi Bhavan", "Filter coffee")).toBe(true);
    expect(isCafeIsh("Blue Tokai Roasters", "Espresso")).toBe(true);
    expect(isCafeIsh("CTR (Central Tiffin Room)", "Masala dosa")).toBe(false);
    expect(isCafeIsh("Veena Stores", "Idli-vada")).toBe(false);
  });
});
