import { describe, expect, it } from "vitest";
import {
  countryFromDestination,
  countryTier,
  estimateLeg,
  estimateMidCents,
  haversineKm,
  knownCountry,
  suggestMode,
} from "./transport-estimate";

describe("haversineKm", () => {
  it("computes Paris-Lyon within 5% of the known ~392 km", () => {
    const km = haversineKm(48.8566, 2.3522, 45.764, 4.8357);
    expect(km).toBeGreaterThan(372);
    expect(km).toBeLessThan(412);
  });

  it("is zero for identical points", () => {
    expect(haversineKm(35.68, 139.69, 35.68, 139.69)).toBe(0);
  });
});

describe("countryTier", () => {
  it("classifies high/mid/low countries case-insensitively", () => {
    expect(countryTier("Japan")).toBe("high");
    expect(countryTier("india")).toBe("low");
    expect(countryTier("Spain")).toBe("mid");
  });

  it("defaults unknown/blank countries to mid", () => {
    expect(countryTier("Atlantis")).toBe("mid");
    expect(countryTier(null)).toBe("mid");
    expect(countryTier("")).toBe("mid");
  });
});

describe("estimateLeg", () => {
  it("walk is free and available only under 1.5 km", () => {
    const near = estimateLeg(0.8, "France");
    const walk = near.find((e) => e.mode === "walk")!;
    expect(walk.available).toBe(true);
    expect(walk.centsLow).toBe(0);
    expect(walk.centsHigh).toBe(0);

    const far = estimateLeg(3, "France").find((e) => e.mode === "walk")!;
    expect(far.available).toBe(false);
  });

  it("transit stays within the $0.30-0.60/km heuristic band at mid tier", () => {
    const km = 10;
    const e = estimateLeg(km, "Spain").find((x) => x.mode === "transit")!;
    expect(e.available).toBe(true);
    // low end: 150 base + 30/km; high end: 250 base + 60/km
    expect(e.centsLow).toBe(150 + km * 30);
    expect(e.centsHigh).toBe(250 + km * 60);
  });

  it("flight is only available past 400 km and includes the $40 base", () => {
    const short = estimateLeg(200, "Japan").find((e) => e.mode === "flight")!;
    expect(short.available).toBe(false);

    const km = 900;
    const long = estimateLeg(km, "Japan").find((e) => e.mode === "flight")!;
    expect(long.available).toBe(true);
    expect(long.centsLow).toBe(4000 + km * 8);
    expect(long.centsHigh).toBe(4000 + km * 18);
  });

  it("low-tier countries are cheaper than high-tier for transit", () => {
    const hi = estimateLeg(10, "Switzerland").find((e) => e.mode === "transit")!;
    const lo = estimateLeg(10, "India").find((e) => e.mode === "transit")!;
    expect(lo.centsHigh).toBeLessThan(hi.centsLow);
  });

  it("car includes a rental day share plus fuel per km", () => {
    const km = 120;
    const e = estimateLeg(km, "Spain").find((x) => x.mode === "car")!;
    expect(e.available).toBe(true);
    expect(e.centsLow).toBe(5000 + km * 10);
    expect(e.centsHigh).toBe(9000 + km * 10);
  });

  it("every estimate carries a note and non-negative km", () => {
    for (const e of estimateLeg(-5, null)) {
      expect(e.km).toBe(0);
      expect(e.note.length).toBeGreaterThan(0);
    }
  });
});

describe("suggestMode / estimateMidCents", () => {
  it("picks walk / transit / train / flight by distance gates", () => {
    expect(suggestMode(0.4)).toBe("walk");
    expect(suggestMode(12)).toBe("transit");
    expect(suggestMode(120)).toBe("train");
    expect(suggestMode(800)).toBe("flight");
  });

  it("midpoint rounds the range", () => {
    const e = estimateLeg(10, "Spain").find((x) => x.mode === "train")!;
    expect(estimateMidCents(e)).toBe(Math.round((e.centsLow + e.centsHigh) / 2));
  });
});

describe("knownCountry / countryFromDestination", () => {
  it("detects countries from free-text segments", () => {
    expect(knownCountry(" Japan ")).toBe("japan");
    expect(knownCountry("Tokyo")).toBeNull();
    expect(knownCountry(null)).toBeNull();
  });

  it("finds the first country in a multi-country destination string", () => {
    expect(countryFromDestination("Tokyo, Japan, Paris, France")).toBe("japan");
    expect(countryFromDestination("Lisbon, Barcelona, Spain")).toBe("spain");
    expect(countryFromDestination("")).toBeNull();
  });
});
