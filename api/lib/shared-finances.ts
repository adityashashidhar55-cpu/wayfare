/**
 * Redacted, read-only finances for the public shared-trip view (r14-linkfix).
 *
 * Pure functions over plain rows so the math is unit-testable without a DB.
 * The output NEVER contains member ids, user ids or emails - people are
 * identified by display name only.
 */

export interface SharedExpenseRow {
  id: number;
  title: string;
  category: string;
  /** amount converted to the trip's home currency */
  homeCents: number;
  date: string;
  /** trip_members.id of whoever paid */
  paidById: number;
}

export interface SharedSplitRow {
  expenseId: number;
  /** trip_members.id this share belongs to */
  memberId: number;
  shareCents: number;
}

export interface SharedMemberRow {
  id: number;
  name: string;
}

export interface SharedExpenseItem {
  label: string;
  category: string;
  amountCents: number;
  date: string;
  paidByName: string;
}

export interface SharedCategoryTotal {
  category: string;
  amountCents: number;
}

export interface SharedPersonShare {
  name: string;
  /** how much this person actually paid (home currency cents) */
  paidCents: number;
  /** their fair share across all splits */
  shareCents: number;
  /** paid − share: positive = fronted more than their share */
  netCents: number;
}

export interface SharedFinances {
  budgetCents: number;
  homeCurrency: string;
  totalSpentCents: number;
  expenses: SharedExpenseItem[];
  byCategory: SharedCategoryTotal[];
  perPerson: SharedPersonShare[];
}

const FALLBACK_NAME = "A tripmate";

/**
 * Build the redacted finances payload. `members` must cover every memberId
 * appearing in expenses/splits; unknown ids fall back to a generic label so
 * no identifier ever leaks.
 */
export function buildSharedFinances(input: {
  budgetCents: number;
  homeCurrency: string;
  expenses: SharedExpenseRow[];
  splits: SharedSplitRow[];
  members: SharedMemberRow[];
}): SharedFinances {
  const nameOf = new Map<number, string>();
  for (const m of input.members) nameOf.set(m.id, m.name);
  const label = (memberId: number) => nameOf.get(memberId)?.trim() || FALLBACK_NAME;

  const expenses: SharedExpenseItem[] = [...input.expenses]
    .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : a.id - b.id))
    .map((e) => ({
      label: e.title,
      category: e.category || "other",
      amountCents: e.homeCents,
      date: e.date,
      paidByName: label(e.paidById),
    }));

  const totalSpentCents = input.expenses.reduce((sum, e) => sum + e.homeCents, 0);

  const catTotals = new Map<string, number>();
  for (const e of input.expenses) {
    const cat = e.category || "other";
    catTotals.set(cat, (catTotals.get(cat) ?? 0) + e.homeCents);
  }
  const byCategory = [...catTotals.entries()]
    .map(([category, amountCents]) => ({ category, amountCents }))
    .sort((a, b) => b.amountCents - a.amountCents);

  // Per-person paid vs fair share. Everyone who paid or has a split appears.
  const paid = new Map<number, number>();
  for (const e of input.expenses) paid.set(e.paidById, (paid.get(e.paidById) ?? 0) + e.homeCents);
  const owed = new Map<number, number>();
  for (const s of input.splits) owed.set(s.memberId, (owed.get(s.memberId) ?? 0) + s.shareCents);

  const ids = new Set<number>([...paid.keys(), ...owed.keys()]);
  const perPerson: SharedPersonShare[] = [...ids]
    .map((id) => {
      const paidCents = paid.get(id) ?? 0;
      const shareCents = owed.get(id) ?? 0;
      return { name: label(id), paidCents, shareCents, netCents: paidCents - shareCents };
    })
    .sort((a, b) => b.paidCents - a.paidCents || a.name.localeCompare(b.name));

  return {
    budgetCents: input.budgetCents,
    homeCurrency: input.homeCurrency,
    totalSpentCents,
    expenses,
    byCategory,
    perPerson,
  };
}
