import { describe, expect, it } from "vitest";
import { gearHints, travelAdvice } from "./travel-advice";

const jp = (extra: Partial<Parameters<typeof travelAdvice>[0]> = {}) => ({
  destinations: [
    { city: "Tokyo", country: "Japan" },
    { city: "Kyoto", country: "Japan" },
    { city: "Osaka", country: "Japan" },
  ],
  days: 10,
  ...extra,
});

describe("travelAdvice", () => {
  it("suggests the JR Pass for Japan with 2+ intercity legs (premium-flagged)", () => {
    const cards = travelAdvice(jp());
    const jr = cards.find((c) => c.id === "jr-pass");
    expect(jr).toBeDefined();
    expect(jr!.premium).toBe(true);
    expect(jr!.title).toMatch(/JR Pass/i);
    expect(jr!.body).toMatch(/Shinkansen/);
  });

  it("does not suggest the JR Pass for a single-city Japan trip", () => {
    const cards = travelAdvice({
      destinations: [{ city: "Tokyo", country: "Japan" }],
      days: 5,
    });
    expect(cards.find((c) => c.id === "jr-pass")).toBeUndefined();
  });

  it("flags multi-country trips with a border sanity card", () => {
    const cards = travelAdvice({
      destinations: [
        { city: "Paris", country: "France" },
        { city: "Rome", country: "Italy" },
      ],
      days: 8,
    });
    const mc = cards.find((c) => c.id === "multi-country");
    expect(mc).toBeDefined();
    expect(mc!.body).toContain("2 countries");
  });

  it("suggests a Eurail pass for 2+ European destinations with 2+ legs", () => {
    const cards = travelAdvice({
      destinations: [
        { city: "Paris", country: "France" },
        { city: "Milan", country: "Italy" },
        { city: "Zurich", country: "Switzerland" },
      ],
      days: 9,
    });
    expect(cards.find((c) => c.id === "eurail-pass")?.premium).toBe(true);
  });

  it("computes a per-day budget card when a budget and dates are set", () => {
    const cards = travelAdvice(
      jp({ budgetCents: 300000, budgetCurrency: "USD", days: 10 }),
    );
    const b = cards.find((c) => c.id === "budget-per-day");
    expect(b).toBeDefined();
    expect(b!.body).toContain("USD 300 per day");
  });

  it("adds kid pacing when children are along", () => {
    const cards = travelAdvice(jp({ children: 2 }));
    expect(cards.find((c) => c.id === "kids-pacing")).toBeDefined();
  });

  it("returns an empty array when nothing applies", () => {
    const cards = travelAdvice({
      destinations: [{ city: "Lisbon", country: "Portugal" }],
      days: 4,
    });
    expect(cards).toEqual([]);
  });
});

describe("gearHints", () => {
  it("recommends carry-on only for short trips", () => {
    const hints = gearHints({ destinations: [], days: 3 });
    expect(hints.find((h) => h.id === "carry-on")).toBeDefined();
  });

  it("recommends laundry planning for long trips", () => {
    const hints = gearHints({ destinations: [], days: 14 });
    expect(hints.find((h) => h.id === "laundry")).toBeDefined();
  });

  it("cold-season cold-country trips get layering advice", () => {
    const hints = gearHints({
      destinations: [{ city: "Sapporo", country: "Japan" }],
      days: 7,
      startMonth: 1,
    });
    expect(hints.find((h) => h.id === "cold-layers")).toBeDefined();
  });

  it("hot-country trips get heat advice regardless of month", () => {
    const hints = gearHints({
      destinations: [{ city: "Bangkok", country: "Thailand" }],
      days: 7,
      startMonth: 12,
    });
    expect(hints.find((h) => h.id === "hot-climate")).toBeDefined();
  });

  it("multi-country trips get an adapter hint", () => {
    const hints = gearHints({
      destinations: [
        { city: "Paris", country: "France" },
        { city: "London", country: "United Kingdom" },
      ],
      days: 6,
    });
    expect(hints.find((h) => h.id === "adapter")).toBeDefined();
  });

  it("always returns at least the essentials fallback", () => {
    const hints = gearHints({ destinations: [], days: 0 });
    expect(hints.length).toBeGreaterThan(0);
    expect(hints[0].id).toBe("essentials");
  });
});
