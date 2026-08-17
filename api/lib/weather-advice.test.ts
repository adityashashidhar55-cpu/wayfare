import { describe, expect, it } from "vitest";
import { analyzeForecast, flagsFor, COLD_C, HOT_C, RAINY_PCT, type ForecastDay } from "./weather-advice";

const day = (over: Partial<ForecastDay>): ForecastDay => ({
  dayId: 1,
  date: "2026-03-10",
  tmaxC: 22,
  precipProbPct: 10,
  approximate: false,
  outdoorCount: 2,
  ...over,
});

describe("flagsFor thresholds", () => {
  it("flags hot above 33C, rainy above 60%, cold below 5C", () => {
    expect(flagsFor(day({ tmaxC: HOT_C + 0.5 }))).toEqual(["hot"]);
    expect(flagsFor(day({ tmaxC: HOT_C }))).toEqual([]); // boundary not flagged
    expect(flagsFor(day({ precipProbPct: RAINY_PCT + 1 }))).toEqual(["rainy"]);
    expect(flagsFor(day({ precipProbPct: RAINY_PCT }))).toEqual([]);
    expect(flagsFor(day({ tmaxC: COLD_C - 0.5 }))).toEqual(["cold"]);
    expect(flagsFor(day({ tmaxC: COLD_C }))).toEqual([]);
  });

  it("combines flags and ignores missing data", () => {
    expect(flagsFor(day({ tmaxC: 36, precipProbPct: 80 }))).toEqual(["hot", "rainy"]);
    expect(flagsFor(day({ tmaxC: null, precipProbPct: null }))).toEqual([]);
  });
});

describe("analyzeForecast", () => {
  it("returns no flags for a calm trip", () => {
    const r = analyzeForecast([day({ dayId: 1 }), day({ dayId: 2, date: "2026-03-11" })]);
    expect(r.flagged).toEqual([]);
    expect(r.adaptations).toEqual([]);
    expect(r.approximateAll).toBe(false);
  });

  it("suggests indoor alternatives for rainy days with outdoor stops", () => {
    const r = analyzeForecast([day({ precipProbPct: 85, outdoorCount: 3 })]);
    expect(r.flagged[0]?.flags).toContain("rainy");
    const indoor = r.adaptations.find((a) => a.kind === "indoor");
    expect(indoor?.text).toContain("85%");
    expect(indoor?.text).toContain("indoor");
  });

  it("skips the indoor suggestion when the day has no outdoor stops", () => {
    const r = analyzeForecast([day({ precipProbPct: 85, outdoorCount: 0 })]);
    expect(r.adaptations.find((a) => a.kind === "indoor")).toBeUndefined();
    expect(r.adaptations.find((a) => a.kind === "flexible")).toBeDefined();
  });

  it("suggests a lighter day for heat", () => {
    const r = analyzeForecast([day({ tmaxC: 38 })]);
    const lighter = r.adaptations.find((a) => a.kind === "lighter");
    expect(lighter?.text).toContain("38°C");
    expect(lighter?.text.toLowerCase()).toContain("walking");
  });

  it("suggests swapping with a clearly drier day", () => {
    const r = analyzeForecast([
      day({ dayId: 1, date: "2026-03-10", precipProbPct: 80 }),
      day({ dayId: 2, date: "2026-03-11", precipProbPct: 15 }),
      day({ dayId: 3, date: "2026-03-12", precipProbPct: 45 }), // only 35pt drop is fine but 15 wins
    ]);
    const swap = r.adaptations.find((a) => a.kind === "swap");
    expect(swap).toBeDefined();
    expect(swap && "withDayId" in swap && swap.withDayId).toBe(2);
    expect(swap?.text).toContain("2026-03-11");
  });

  it("does not suggest a swap when no day is clearly better", () => {
    const r = analyzeForecast([
      day({ dayId: 1, precipProbPct: 80 }),
      day({ dayId: 2, date: "2026-03-11", precipProbPct: 60 }),
    ]);
    expect(r.adaptations.find((a) => a.kind === "swap")).toBeUndefined();
  });

  it("labels typical-climate rows and marks approximateAll", () => {
    const r = analyzeForecast([
      day({ approximate: true, precipProbPct: 80 }),
      day({ dayId: 2, date: "2026-03-11", approximate: true }),
    ]);
    expect(r.approximateAll).toBe(true);
    expect(r.adaptations.find((a) => a.kind === "indoor")?.text).toContain("typically");
  });

  it("approximateAll is false when a real forecast row is mixed in", () => {
    const r = analyzeForecast([
      day({ approximate: true }),
      day({ dayId: 2, date: "2026-03-11", approximate: false }),
    ]);
    expect(r.approximateAll).toBe(false);
  });
});
