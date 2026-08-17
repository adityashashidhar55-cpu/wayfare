import { describe, expect, it } from "vitest";
import { buildSharedFinances } from "./shared-finances";

const members = [
  { id: 11, name: "Priya" },
  { id: 22, name: "Arjun" },
];

const expenses = [
  { id: 5, title: "Hotel", category: "lodging", homeCents: 12000, date: "2026-04-04", paidById: 11 },
  { id: 3, title: "Dosa breakfast", category: "food", homeCents: 1800, date: "2026-04-05", paidById: 22 },
  { id: 9, title: "Metro cards", category: "transport", homeCents: 600, date: "2026-04-05", paidById: 11 },
];

const splits = [
  { expenseId: 5, memberId: 11, shareCents: 6000 },
  { expenseId: 5, memberId: 22, shareCents: 6000 },
  { expenseId: 3, memberId: 11, shareCents: 900 },
  { expenseId: 3, memberId: 22, shareCents: 900 },
  { expenseId: 9, memberId: 11, shareCents: 300 },
  { expenseId: 9, memberId: 22, shareCents: 300 },
];

describe("buildSharedFinances", () => {
  const out = buildSharedFinances({
    budgetCents: 20000,
    homeCurrency: "INR",
    expenses,
    splits,
    members,
  });

  it("sums spent and keeps the budget/currency", () => {
    expect(out.totalSpentCents).toBe(14400);
    expect(out.budgetCents).toBe(20000);
    expect(out.homeCurrency).toBe("INR");
  });

  it("computes per-person paid vs fair share", () => {
    const priya = out.perPerson.find((p) => p.name === "Priya")!;
    const arjun = out.perPerson.find((p) => p.name === "Arjun")!;
    expect(priya.paidCents).toBe(12600);
    expect(priya.shareCents).toBe(7200);
    expect(priya.netCents).toBe(5400);
    expect(arjun.paidCents).toBe(1800);
    expect(arjun.shareCents).toBe(7200);
    expect(arjun.netCents).toBe(-5400);
    // shares conserve the total
    expect(priya.shareCents + arjun.shareCents).toBe(out.totalSpentCents);
  });

  it("aggregates category totals, highest first", () => {
    expect(out.byCategory).toEqual([
      { category: "lodging", amountCents: 12000 },
      { category: "food", amountCents: 1800 },
      { category: "transport", amountCents: 600 },
    ]);
  });

  it("lists expenses newest-first with payer display names", () => {
    expect(out.expenses[0]).toMatchObject({ label: "Dosa breakfast", paidByName: "Arjun" });
    expect(out.expenses[2]).toMatchObject({ label: "Hotel", paidByName: "Priya" });
  });

  it("is fully redacted, no member/user ids or emails anywhere", () => {
    const text = JSON.stringify(out);
    expect(text).not.toContain("@");
    expect(text).not.toMatch(/"(paidById|memberId|userId|expenseId|email)"/);
    expect(text).not.toContain('"11"');
    expect(text).not.toContain('"22"');
    for (const e of out.expenses) {
      expect(Object.keys(e).sort()).toEqual(["amountCents", "category", "date", "label", "paidByName"]);
    }
  });

  it("falls back to a generic payer label for unknown member ids", () => {
    const orphan = buildSharedFinances({
      budgetCents: 0,
      homeCurrency: "USD",
      expenses: [{ id: 1, title: "Taxi", category: "transport", homeCents: 500, date: "2026-01-01", paidById: 999 }],
      splits: [],
      members: [],
    });
    expect(orphan.expenses[0]!.paidByName).toBe("A tripmate");
    expect(orphan.perPerson[0]!.name).toBe("A tripmate");
  });

  it("handles a trip with zero expenses", () => {
    const empty = buildSharedFinances({
      budgetCents: 5000,
      homeCurrency: "EUR",
      expenses: [],
      splits: [],
      members,
    });
    expect(empty.totalSpentCents).toBe(0);
    expect(empty.expenses).toEqual([]);
    expect(empty.byCategory).toEqual([]);
    expect(empty.perPerson).toEqual([]);
    expect(empty.budgetCents).toBe(5000);
  });
});
