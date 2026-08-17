import { describe, expect, it } from "vitest";
import {
  budgetStatus,
  convertCents,
  costBreakdown,
  dayCostBreakdowns,
} from "./day-cost";

const prices = [
  { stopId: 1, category: "activity", feeCents: 1800, mealCents: null, feeCurrency: "EUR" },
  { stopId: 2, category: "food", feeCents: null, mealCents: 1200, feeCurrency: "EUR" },
  { stopId: 3, category: "activity", feeCents: 0, mealCents: null, feeCurrency: "EUR" },
];

const stops = [
  { id: 1, dayId: 10, category: "activity", transportCents: null },
  { id: 2, dayId: 10, category: "food", transportCents: 450 },
  { id: 3, dayId: 11, category: "activity", transportCents: null },
  { id: 4, dayId: 11, category: "activity", transportCents: 900 }, // no price data
];

describe("convertCents", () => {
  it("converts EUR cents to USD cents via the static FX table", () => {
    // FX: EUR 0.92 per USD, so 92 EUR cents = 100 USD cents
    expect(convertCents(9200, "EUR", "USD")).toBe(10000);
  });

  it("is identity for same currency and passes through unknown currencies", () => {
    expect(convertCents(500, "USD", "USD")).toBe(500);
    expect(convertCents(500, "XXX", "USD")).toBe(500);
  });
});

describe("costBreakdown", () => {
  it("sums tickets, meals and transport legs per category", () => {
    const day10 = stops.filter((s) => s.dayId === 10);
    const b = costBreakdown(day10, prices, "EUR");
    expect(b.ticketsCents).toBe(1800);
    expect(b.foodCents).toBe(1200);
    expect(b.transportCents).toBe(450);
    expect(b.totalCents).toBe(3450);
    expect(b.known).toBe(2);
    expect(b.total).toBe(2);
  });

  it("converts local prices into the display currency", () => {
    const day10 = stops.filter((s) => s.dayId === 10);
    const eur = costBreakdown(day10, prices, "EUR");
    const usd = costBreakdown(day10, prices, "USD");
    // USD amounts should be larger (EUR < USD in the FX table)
    expect(usd.ticketsCents).toBeGreaterThan(eur.ticketsCents);
    // transport legs are already home-currency: unchanged
    expect(usd.transportCents).toBe(eur.transportCents);
  });

  it("treats a free stop as known but zero-cost", () => {
    const b = costBreakdown(stops.filter((s) => s.dayId === 11), prices, "EUR");
    expect(b.ticketsCents).toBe(0);
    expect(b.known).toBe(1);
    expect(b.transportCents).toBe(900);
  });
});

describe("dayCostBreakdowns", () => {
  it("groups stops by day and skips unscheduled ones", () => {
    const map = dayCostBreakdowns(
      [...stops, { id: 9, dayId: null, category: "activity" }],
      prices,
      "EUR",
    );
    expect([...map.keys()].sort()).toEqual([10, 11]);
    expect(map.get(10)!.totalCents).toBe(3450);
  });
});

describe("budgetStatus", () => {
  it("is none without a budget", () => {
    expect(budgetStatus(1000, null)).toBe("none");
    expect(budgetStatus(1000, 0)).toBe("none");
  });

  it("flags under / near / over with an 85% near band", () => {
    expect(budgetStatus(5000, 10000)).toBe("under");
    expect(budgetStatus(9000, 10000)).toBe("near");
    expect(budgetStatus(11000, 10000)).toBe("over");
  });
});
