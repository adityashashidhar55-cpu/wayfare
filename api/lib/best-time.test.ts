import { describe, expect, it } from "vitest";
import { bestTimeFor, monthName, seasonalityFor } from "./best-time";

describe("seasonalityFor", () => {
  it("matches curated destinations by substring, case-insensitive", () => {
    expect(seasonalityFor("Paris, France").matched).toBe("paris");
    expect(seasonalityFor("TOKYO").matched).toBe("tokyo");
    expect(seasonalityFor("Rio de Janeiro, Brazil").matched).toBe("rio de janeiro");
  });

  it("falls back to defaults for unknown destinations", () => {
    const r = seasonalityFor("Nowhere Special");
    expect(r.matched).toBeNull();
    expect(r.lat).toBe(40);
  });
});

describe("bestTimeFor", () => {
  it("returns exactly 3 top months with reasons", () => {
    const r = bestTimeFor("Paris, France");
    expect(r.top).toHaveLength(3);
    for (const m of r.top) {
      expect(m.score).toBeGreaterThan(0);
      expect(m.reasons.length).toBeGreaterThan(0);
      expect(m.name).toBe(monthName(m.month));
    }
  });

  it("scores all 12 months", () => {
    expect(bestTimeFor("Tokyo, Japan").all).toHaveLength(12);
  });

  it("favors mild shoulder months over peak summer for Paris", () => {
    const r = bestTimeFor("Paris, France");
    const topMonths = r.top.map((m) => m.month);
    // Peak July should not beat the top pick.
    const july = r.all.find((m) => m.month === 7)!;
    const best = r.top[0]!;
    expect(best.score).toBeGreaterThan(july.score);
    expect(july.reasons.join(" ")).toContain("Peak-season");
    expect(topMonths.every((m) => m >= 1 && m <= 12)).toBe(true);
  });

  it("respects southern-hemisphere seasons (Sydney summer is Dec-Feb)", () => {
    const r = bestTimeFor("Sydney, Australia");
    const jan = r.all.find((m) => m.month === 1)!;
    const jul = r.all.find((m) => m.month === 7)!;
    expect(jan.typical.tmaxC).toBeGreaterThan(jul.typical.tmaxC);
  });

  it("penalizes monsoon months in Bangkok", () => {
    const r = bestTimeFor("Bangkok, Thailand");
    const aug = r.all.find((m) => m.month === 8)!;
    expect(aug.reasons.join(" ")).toMatch(/Rainy season|Some rain/);
    const best = r.top[0]!;
    expect(best.score).toBeGreaterThan(aug.score);
  });

  it("is deterministic", () => {
    expect(bestTimeFor("Lisbon")).toEqual(bestTimeFor("Lisbon"));
  });
});
