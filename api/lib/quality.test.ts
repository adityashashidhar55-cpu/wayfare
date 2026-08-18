import { describe, expect, it } from "vitest";
import { computeQuality, tierOf, isJunkName, isChainName, QUALITY } from "./quality";

describe("computeQuality", () => {
  it("gives a bare OSM node nothing", () => {
    expect(computeQuality({ description: null, image: null })).toBe(0);
  });

  it("scores a curated, photographed landmark near the top", () => {
    const s = computeQuality({
      description: "x".repeat(700), descriptionSource: "curated", image: "/a.jpg",
      photoAttribution: "CC-BY-SA", verdict: "must-see", feeCents: 0,
    });
    expect(s).toBeGreaterThanOrEqual(QUALITY.SHOWCASE);
  });

  it("never exceeds 100", () => {
    expect(computeQuality({
      description: "x".repeat(5000), descriptionSource: "curated", image: "/a.jpg",
      photoAttribution: "c", verdict: "must-see", famousEatery: true,
      feeCents: 100, mealCents: 100, nameLocal: "x", hidden: true,
    })).toBe(100);
  });

  it("weights a photo above a short description", () => {
    const photo = computeQuality({ image: "/a.jpg" });
    const shortDesc = computeQuality({ description: "x".repeat(100) });
    expect(photo).toBeGreaterThan(shortDesc);
  });

  it("ignores rating entirely - 99.9% of ours were fabricated", () => {
    const withRating = computeQuality({ description: "x".repeat(300), ...( { rating: 4.3 } as object) });
    const without = computeQuality({ description: "x".repeat(300) });
    expect(withRating).toBe(without);
  });
});

describe("tierOf", () => {
  it("maps scores to tiers", () => {
    expect(tierOf(0)).toBe("bare");
    expect(tierOf(5)).toBe("thin");
    expect(tierOf(25)).toBe("decent");
    expect(tierOf(45)).toBe("good");
    expect(tierOf(80)).toBe("showcase");
  });
  it("treats null as bare rather than throwing", () => {
    expect(tierOf(null)).toBe("bare");
    expect(tierOf(undefined)).toBe("bare");
  });
});

describe("name classifiers", () => {
  it("catches infrastructure", () => {
    for (const n of ["Parking", "Toilets", "ATM", "Bus Stop", "bench"]) expect(isJunkName(n)).toBe(true);
  });
  it("catches the chains actually present in the corpus", () => {
    for (const n of ["HEMA", "TK Maxx", "McDonald's", "Lidl", "Starbucks Koramangala"]) expect(isChainName(n)).toBe(true);
  });
  it("does not flag real destinations", () => {
    for (const n of ["Lalbagh Botanical Garden", "Fushimi Inari Shrine", "Bangalore Palace", "Belém Tower"]) {
      expect(isJunkName(n)).toBe(false);
      expect(isChainName(n)).toBe(false);
    }
  });
  it("does not flag a real place that merely contains a chain word", () => {
    // These are the false positives a naive prefix match produces. Each one
    // would have quietly buried a genuine destination in the feed.
    expect(isChainName("Target Practice Brewery")).toBe(false);
    expect(isChainName("The Subway Museum")).toBe(false);
    expect(isChainName("Costa Verde Beach")).toBe(false);
    expect(isChainName("Action Park")).toBe(false);
    expect(isChainName("Spar Hotel Gardermoen")).toBe(false);
  });

  it("still catches a branch of a real chain", () => {
    expect(isChainName("Starbucks Koramangala")).toBe(true);
    expect(isChainName("McDonald's Indiranagar")).toBe(true);
    expect(isChainName("Cafe Coffee Day MG Road")).toBe(true);
  });
});
