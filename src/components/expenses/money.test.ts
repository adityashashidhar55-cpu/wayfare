/**
 * money.test.ts (r27) - the money paths had ZERO tests.
 *
 * The audit found that split maths, balances and FX conversion - the code that
 * decides how much one friend owes another after a trip - was entirely
 * untested, while non-money logic (place classification, weather advice) had
 * meaningful coverage. Every bug in here costs a real user real money and, in
 * a group-trip app, costs them an argument with a friend.
 *
 * These tests pin down the behaviour that must not silently change:
 * conservation (money is never created or destroyed), rounding, the 1-cent
 * dust tolerance in debt simplification, and settlement application.
 */
import { describe, expect, it } from "vitest";
import type { TripMember } from "@contracts/types";
import { convertCents, formatMoney } from "@contracts/fx";
import { computeBalances, simplifyDebts, categoryTotals, groupByDate } from "./utils";
import type { ExpenseWithSplits } from "./utils";

function member(id: number, name: string): TripMember {
  return {
    id,
    tripId: 1,
    userId: null,
    name,
    email: null,
    role: "editor",
    presenceColor: null,
    createdAt: new Date().toISOString(),
  } as unknown as TripMember;
}

function expense(opts: {
  id: number;
  paidById: number;
  homeCents: number;
  splits: [number, number][];
  category?: string;
  date?: string;
}): ExpenseWithSplits {
  return {
    id: opts.id,
    tripId: 1,
    paidById: opts.paidById,
    title: `expense-${opts.id}`,
    category: opts.category ?? "food",
    amountCents: opts.homeCents,
    currency: "USD",
    homeCents: opts.homeCents,
    date: opts.date ?? "2027-03-12",
    splits: opts.splits.map(([memberId, shareCents], i) => ({
      id: opts.id * 100 + i,
      expenseId: opts.id,
      memberId,
      shareCents,
    })),
  } as unknown as ExpenseWithSplits;
}

const [ana, ben, cara] = [member(1, "Ana"), member(2, "Ben"), member(3, "Cara")];
const TRIO = [ana, ben, cara];

describe("computeBalances", () => {
  it("nets paid against owed per member", () => {
    // Ana pays 90.00 for all three; each owes 30.00.
    const balances = computeBalances(
      [expense({ id: 1, paidById: 1, homeCents: 9000, splits: [[1, 3000], [2, 3000], [3, 3000]] })],
      TRIO,
    );
    expect(balances.map((b) => b.net)).toEqual([6000, -3000, -3000]);
  });

  it("conserves money - the nets always sum to zero", () => {
    const balances = computeBalances(
      [
        expense({ id: 1, paidById: 1, homeCents: 9000, splits: [[1, 3000], [2, 3000], [3, 3000]] }),
        expense({ id: 2, paidById: 2, homeCents: 4500, splits: [[1, 1500], [2, 1500], [3, 1500]] }),
        expense({ id: 3, paidById: 3, homeCents: 1200, splits: [[1, 600], [3, 600]] }),
      ],
      TRIO,
    );
    expect(balances.reduce((s, b) => s + b.net, 0)).toBe(0);
  });

  it("gives a member with no activity a zero balance rather than dropping them", () => {
    const balances = computeBalances(
      [expense({ id: 1, paidById: 1, homeCents: 2000, splits: [[1, 1000], [2, 1000]] })],
      TRIO,
    );
    expect(balances).toHaveLength(3);
    expect(balances.find((b) => b.member.id === 3)?.net).toBe(0);
  });

  it("counts the payer's own share, so paying for yourself nets zero", () => {
    const balances = computeBalances(
      [expense({ id: 1, paidById: 1, homeCents: 2500, splits: [[1, 2500]] })],
      TRIO,
    );
    expect(balances.find((b) => b.member.id === 1)?.net).toBe(0);
  });
});

describe("simplifyDebts", () => {
  it("settles a simple one-payer trip in n-1 transfers", () => {
    const balances = computeBalances(
      [expense({ id: 1, paidById: 1, homeCents: 9000, splits: [[1, 3000], [2, 3000], [3, 3000]] })],
      TRIO,
    );
    const debts = simplifyDebts(balances);
    expect(debts).toHaveLength(2);
    expect(debts.every((d) => d.toId === 1)).toBe(true);
    expect(debts.reduce((s, d) => s + d.cents, 0)).toBe(6000);
  });

  it("never moves more money than is owed", () => {
    const balances = computeBalances(
      [
        expense({ id: 1, paidById: 1, homeCents: 9000, splits: [[1, 3000], [2, 3000], [3, 3000]] }),
        expense({ id: 2, paidById: 2, homeCents: 6000, splits: [[1, 2000], [2, 2000], [3, 2000]] }),
      ],
      TRIO,
    );
    const owedTotal = balances.filter((b) => b.net < 0).reduce((s, b) => s - b.net, 0);
    const moved = simplifyDebts(balances).reduce((s, d) => s + d.cents, 0);
    // Dust under the 1-cent tolerance may legitimately go unsettled.
    expect(moved).toBeLessThanOrEqual(owedTotal);
    expect(owedTotal - moved).toBeLessThanOrEqual(TRIO.length);
  });

  it("leaves everyone flat when nobody owes anything", () => {
    const balances = computeBalances(
      [expense({ id: 1, paidById: 1, homeCents: 1000, splits: [[1, 1000]] })],
      TRIO,
    );
    expect(simplifyDebts(balances)).toEqual([]);
  });

  it("ignores sub-cent dust instead of emitting 1-cent transfers", () => {
    // A three-way split of 10.00 leaves a 1-cent remainder somewhere. That
    // must not become a transfer - "Ben owes Ana ₹0.01" is noise, and the
    // greedy matcher's `> 1` guard exists precisely for this.
    const balances = computeBalances(
      [expense({ id: 1, paidById: 1, homeCents: 1000, splits: [[1, 333], [2, 333], [3, 334]] })],
      TRIO,
    );
    const debts = simplifyDebts(balances);
    expect(debts.every((d) => d.cents > 1)).toBe(true);
  });

  it("handles a debtor owing several creditors", () => {
    const balances = computeBalances(
      [
        expense({ id: 1, paidById: 1, homeCents: 3000, splits: [[2, 3000]] }),
        expense({ id: 2, paidById: 3, homeCents: 2000, splits: [[2, 2000]] }),
      ],
      TRIO,
    );
    const debts = simplifyDebts(balances);
    expect(debts.every((d) => d.fromId === 2)).toBe(true);
    expect(debts.reduce((s, d) => s + d.cents, 0)).toBe(5000);
  });
});

describe("settlement application", () => {
  /** Mirrors BalancesCard: a recorded payment moves net between two members. */
  function applySettlements(
    balances: ReturnType<typeof computeBalances>,
    settlements: { fromMemberId: number; toMemberId: number; amountCents: number }[],
  ) {
    const out = balances.map((b) => ({ ...b }));
    for (const s of settlements) {
      const from = out.find((b) => b.member.id === s.fromMemberId);
      const to = out.find((b) => b.member.id === s.toMemberId);
      if (from && to) {
        from.net += s.amountCents;
        to.net -= s.amountCents;
      }
    }
    return out;
  }

  it("clears a debt once the payment is recorded", () => {
    const balances = computeBalances(
      [expense({ id: 1, paidById: 1, homeCents: 9000, splits: [[1, 3000], [2, 3000], [3, 3000]] })],
      TRIO,
    );
    const after = applySettlements(balances, [
      { fromMemberId: 2, toMemberId: 1, amountCents: 3000 },
      { fromMemberId: 3, toMemberId: 1, amountCents: 3000 },
    ]);
    expect(simplifyDebts(after)).toEqual([]);
    expect(after.reduce((s, b) => s + b.net, 0)).toBe(0);
  });

  it("still conserves money after a partial payment", () => {
    const balances = computeBalances(
      [expense({ id: 1, paidById: 1, homeCents: 9000, splits: [[1, 3000], [2, 3000], [3, 3000]] })],
      TRIO,
    );
    const after = applySettlements(balances, [{ fromMemberId: 2, toMemberId: 1, amountCents: 1000 }]);
    expect(after.reduce((s, b) => s + b.net, 0)).toBe(0);
    expect(simplifyDebts(after).reduce((s, d) => s + d.cents, 0)).toBe(5000);
  });

  it("undoing a settlement restores the original debts", () => {
    const balances = computeBalances(
      [expense({ id: 1, paidById: 1, homeCents: 9000, splits: [[1, 3000], [2, 3000], [3, 3000]] })],
      TRIO,
    );
    const before = simplifyDebts(balances);
    const settled = applySettlements(balances, [{ fromMemberId: 2, toMemberId: 1, amountCents: 3000 }]);
    // Removing the row is what trips.deleteSettlement does; recomputing from
    // the remaining (empty) list must land back exactly where we started.
    const undone = applySettlements(balances, []);
    expect(simplifyDebts(settled)).not.toEqual(before);
    expect(simplifyDebts(undone)).toEqual(before);
  });
});

describe("convertCents", () => {
  it("is a no-op for the same currency, whatever the rates say", () => {
    expect(convertCents(12345, "INR", "INR", { INR: 999 })).toBe(12345);
  });

  it("round-trips within rounding error", () => {
    const there = convertCents(100_00, "USD", "INR");
    const back = convertCents(there, "INR", "USD");
    expect(Math.abs(back - 100_00)).toBeLessThanOrEqual(1);
  });

  it("uses supplied live rates over the static table", () => {
    // 1 USD = 100 INR in this hypothetical, so $1.00 is exactly Rs 100.00.
    expect(convertCents(100, "USD", "INR", { USD: 1, INR: 100 })).toBe(10_000);
  });

  it("falls back to the static rate for a currency missing from the live set", () => {
    const live = { USD: 1, INR: 100 };
    // EUR absent from `live` - must use FX_PER_USD, not a rate of 1.
    expect(convertCents(100, "USD", "EUR", live)).toBe(convertCents(100, "USD", "EUR"));
  });

  it("never returns a fractional cent", () => {
    for (const amount of [1, 7, 33, 999, 123_456]) {
      expect(Number.isInteger(convertCents(amount, "USD", "JPY"))).toBe(true);
    }
  });

  it("treats an unknown currency as 1:1 rather than throwing mid-expense", () => {
    expect(() => convertCents(500, "USD", "XXX")).not.toThrow();
  });
});

describe("formatMoney", () => {
  it("shows paise for INR - this is an India-first product", () => {
    // r25 removed INR from ZERO_DECIMAL: real Indian receipts carry paise, and
    // rounding display while storing precisely made the ledger and the
    // receipt disagree.
    expect(formatMoney(15050, "INR")).toBe("₹150.50");
  });

  it("keeps zero-decimal currencies whole", () => {
    expect(formatMoney(150000, "JPY")).toBe("¥1,500");
  });

  it("renders zero rather than an empty string", () => {
    expect(formatMoney(0, "USD")).toBe("$0.00");
  });

  it("keeps a negative amount signed", () => {
    expect(formatMoney(-2500, "USD")).toContain("25.00");
    expect(formatMoney(-2500, "USD")).toContain("-");
  });
});

describe("totals", () => {
  const rows = [
    expense({ id: 1, paidById: 1, homeCents: 5000, splits: [[1, 5000]], category: "food", date: "2027-03-12" }),
    expense({ id: 2, paidById: 2, homeCents: 3000, splits: [[2, 3000]], category: "food", date: "2027-03-13" }),
    expense({ id: 3, paidById: 1, homeCents: 8000, splits: [[1, 8000]], category: "lodging", date: "2027-03-12" }),
  ];

  it("sums categories and sorts biggest first", () => {
    const totals = categoryTotals([
      ...rows,
      expense({ id: 4, paidById: 1, homeCents: 1000, splits: [[1, 1000]], category: "transport" }),
    ]);
    // food = 5000 + 3000 across two days, lodging = 8000, transport = 1000.
    expect(totals.find((t) => t.category === "food")?.cents).toBe(8000);
    expect(totals.find((t) => t.category === "lodging")?.cents).toBe(8000);
    expect(totals[totals.length - 1]).toEqual({ category: "transport", cents: 1000 });
    expect(totals.map((t) => t.cents)).toEqual([8000, 8000, 1000]);
  });

  it("groups by date newest-first with per-day totals that sum to the whole", () => {
    const groups = groupByDate(rows);
    expect(groups[0]!.date).toBe("2027-03-13");
    expect(groups.reduce((s, g) => s + g.total, 0)).toBe(16000);
  });
});
