import { useEffect, useRef, useState } from 'react';
import {
  BedDouble,
  CircleDot,
  ShoppingBag,
  Ticket,
  TrainFront,
  Utensils,
  type LucideIcon,
} from 'lucide-react';
import type { Expense, ExpenseSplit, TripMember } from '@contracts/types';
import { EXPENSE_CATEGORY_COLORS } from '@/lib/map';

export type ExpenseWithSplits = Expense & { splits: ExpenseSplit[] };

/** Category metadata (design.md §3.2 + §6). */
export const CATEGORY_META: Record<string, { label: string; icon: LucideIcon; color: string }> = {
  food: { label: 'Food', icon: Utensils, color: EXPENSE_CATEGORY_COLORS.food },
  lodging: { label: 'Lodging', icon: BedDouble, color: EXPENSE_CATEGORY_COLORS.lodging },
  transport: { label: 'Transport', icon: TrainFront, color: EXPENSE_CATEGORY_COLORS.transport },
  activities: { label: 'Activities', icon: Ticket, color: EXPENSE_CATEGORY_COLORS.activities },
  shopping: { label: 'Shopping', icon: ShoppingBag, color: EXPENSE_CATEGORY_COLORS.shopping },
  other: { label: 'Other', icon: CircleDot, color: EXPENSE_CATEGORY_COLORS.other },
};

export function categoryMeta(category: string) {
  return CATEGORY_META[category] ?? CATEGORY_META.other!;
}

/** Person hue for mini bars - presence color first, day-color cycle fallback. */
const PERSON_FALLBACK = ['#BC5934', '#44604F', '#6E7FA3', '#A86B8C', '#B98A2E', '#6E9A8B'];
export function memberColor(member: TripMember, index: number): string {
  return member.presenceColor ?? PERSON_FALLBACK[index % PERSON_FALLBACK.length]!;
}

export interface MemberBalance {
  member: TripMember;
  paid: number; // home cents
  owed: number; // share of splits, home cents
  net: number; // paid - owed (positive = is owed money)
}

/** Per-member paid vs owed from expenses + splits (all in trip home currency). */
export function computeBalances(
  expenses: ExpenseWithSplits[],
  members: TripMember[],
): MemberBalance[] {
  const paid = new Map<number, number>();
  const owed = new Map<number, number>();
  for (const e of expenses) {
    paid.set(e.paidById, (paid.get(e.paidById) ?? 0) + e.homeCents);
    for (const s of e.splits) {
      owed.set(s.memberId, (owed.get(s.memberId) ?? 0) + s.shareCents);
    }
  }
  return members.map((m) => {
    const p = paid.get(m.id) ?? 0;
    const o = owed.get(m.id) ?? 0;
    return { member: m, paid: p, owed: o, net: p - o };
  });
}

export interface Debt {
  fromId: number;
  toId: number;
  cents: number;
}

/** Greedy debt simplification: match biggest debtor with biggest creditor. */
export function simplifyDebts(balances: MemberBalance[]): Debt[] {
  const debtors = balances
    .filter((b) => b.net < -1)
    .map((b) => ({ id: b.member.id, cents: -b.net }))
    .sort((a, b) => b.cents - a.cents);
  const creditors = balances
    .filter((b) => b.net > 1)
    .map((b) => ({ id: b.member.id, cents: b.net }))
    .sort((a, b) => b.cents - a.cents);
  const debts: Debt[] = [];
  let i = 0;
  let j = 0;
  while (i < debtors.length && j < creditors.length) {
    const d = debtors[i]!;
    const c = creditors[j]!;
    const amount = Math.min(d.cents, c.cents);
    if (amount > 1) debts.push({ fromId: d.id, toId: c.id, cents: amount });
    d.cents -= amount;
    c.cents -= amount;
    if (d.cents <= 1) i++;
    if (c.cents <= 1) j++;
  }
  return debts;
}

/** Group expenses by date (desc), each group carrying its home-currency total. */
export function groupByDate(expenses: ExpenseWithSplits[]) {
  const map = new Map<string, ExpenseWithSplits[]>();
  for (const e of expenses) {
    const list = map.get(e.date) ?? [];
    list.push(e);
    map.set(e.date, list);
  }
  return [...map.entries()]
    .sort((a, b) => (a[0] < b[0] ? 1 : -1))
    .map(([date, items]) => ({
      date,
      items: items.sort((a, b) => b.id - a.id),
      total: items.reduce((sum, e) => sum + e.homeCents, 0),
    }));
}

/** Per-category totals in home cents, sorted desc. */
export function categoryTotals(expenses: ExpenseWithSplits[]) {
  const map = new Map<string, number>();
  for (const e of expenses) {
    map.set(e.category, (map.get(e.category) ?? 0) + e.homeCents);
  }
  return [...map.entries()]
    .map(([category, cents]) => ({ category, cents }))
    .sort((a, b) => b.cents - a.cents);
}

const easeOutQuart = (t: number) => 1 - Math.pow(1 - t, 4);

/**
 * Count-up animation (design.md §7.2): easeOutQuart.
 * Returns the current animated value. Respects prefers-reduced-motion.
 */
export function useCountUp(target: number, duration = 800, start = true): number {
  const [reduceMotion] = useState(
    () =>
      typeof window !== 'undefined' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches,
  );
  const [value, setValue] = useState(0);
  const fromRef = useRef(0);
  const rafRef = useRef<number>(0);

  useEffect(() => {
    if (!start || reduceMotion) {
      fromRef.current = target;
      return;
    }
    const from = fromRef.current;
    const t0 = performance.now();
    const tick = (now: number) => {
      const p = Math.min(1, (now - t0) / duration);
      const v = from + (target - from) * easeOutQuart(p);
      setValue(v);
      if (p < 1) {
        rafRef.current = requestAnimationFrame(tick);
      } else {
        fromRef.current = target;
      }
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafRef.current);
  }, [target, duration, start, reduceMotion]);

  if (!start || reduceMotion) return target;
  return value;
}

/** Fire-once visibility hook for count-up-on-view. */
export function useInViewOnce<T extends HTMLElement>() {
  const ref = useRef<T | null>(null);
  const [seen, setSeen] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el || seen) return;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setSeen(true);
          io.disconnect();
        }
      },
      { threshold: 0.3 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [seen]);
  return { ref, seen };
}

/** Reactive dark-mode flag (`.dark` on <html>). */
export function useIsDark(): boolean {
  const [dark, setDark] = useState(
    () => typeof document !== 'undefined' && document.documentElement.classList.contains('dark'),
  );
  useEffect(() => {
    const el = document.documentElement;
    const obs = new MutationObserver(() => setDark(el.classList.contains('dark')));
    obs.observe(el, { attributes: true, attributeFilter: ['class'] });
    return () => obs.disconnect();
  }, []);
  return dark;
}

/** Reactive media query hook. */
export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(
    () => typeof window !== 'undefined' && window.matchMedia(query).matches,
  );
  useEffect(() => {
    const mq = window.matchMedia(query);
    const onChange = () => setMatches(mq.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, [query]);
  return matches;
}

/** YYYY-MM-DD ↔ Date helpers (local noon to dodge TZ edges). */
export function parseDay(iso: string): Date {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y!, (m ?? 1) - 1, d ?? 1, 12);
}

export function toISODate(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function todayISO(): string {
  return toISODate(new Date());
}

/** Inclusive list of YYYY-MM-DD dates between two ISO dates. */
export function dateRange(startISO: string, endISO: string): string[] {
  const out: string[] = [];
  const cur = parseDay(startISO);
  const end = parseDay(endISO);
  let guard = 0;
  while (cur <= end && guard < 400) {
    out.push(toISODate(cur));
    cur.setDate(cur.getDate() + 1);
    guard++;
  }
  return out;
}
