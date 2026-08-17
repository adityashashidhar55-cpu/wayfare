import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { motion } from 'framer-motion';
import { ArrowRight, Wallet } from 'lucide-react';
import type { Trip, TripMember } from '@contracts/types';
import { convertCents, formatMoney } from '@contracts/fx';
import { trpc } from '@/providers/trpc';
import { useAuth } from '@/hooks/useAuth';
import { Skeleton } from '@/components/ui/skeleton';
import { Button } from '@/components/ui/button';
import { CategoryDonut } from '@/components/expenses/CategoryDonut';
import { ExpenseLedger } from '@/components/expenses/ExpenseLedger';
import { ToastHost } from '@/components/expenses/ToastHost';
import {
  categoryMeta,
  computeBalances,
  groupByDate,
  parseDay,
  useCountUp,
  useMediaQuery,
  type ExpenseWithSplits,
} from '@/components/expenses/utils';
import { format } from 'date-fns';
import { cn } from '@/lib/utils';

interface TripBundle {
  trip: Trip & { status: 'upcoming' | 'past' };
  members: TripMember[];
  expenses: ExpenseWithSplits[];
}

/** All spending normalized into the display currency. */
function bundleTotal(b: TripBundle, display: string): number {
  const home = b.expenses.reduce((s, e) => s + e.homeCents, 0);
  return convertCents(home, b.trip.homeCurrency, display);
}

export default function Expenses() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const isNarrow = useMediaQuery('(max-width: 899px)');
  const listQuery = trpc.trips.list.useQuery(undefined, { retry: false });
  const prefQuery = trpc.preferences.get.useQuery(undefined, { retry: false });
  const displayCurrency = prefQuery.data?.homeCurrency ?? 'USD';

  const trips = useMemo(() => listQuery.data?.trips ?? [], [listQuery.data?.trips]);
  const tripIds = useMemo(() => trips.map((t) => t.id), [trips]);

  const detailQueries = trpc.useQueries((t) =>
    tripIds.map((id) => t.trips.get({ id }, { retry: false })),
  );

  const isLoading =
    listQuery.isLoading || detailQueries.some((q) => q.isLoading) || prefQuery.isLoading;

  const bundles = useMemo<TripBundle[]>(() => {
    const out: TripBundle[] = [];
    detailQueries.forEach((q, i) => {
      const d = q.data;
      const stub = trips[i];
      if (!d || !stub) return;
      out.push({
        trip: { ...d.trip, status: stub.status as 'upcoming' | 'past' },
        members: d.members,
        expenses: d.expenses as ExpenseWithSplits[],
      });
    });
    return out;
  }, [detailQueries, trips]);

  const withExpenses = useMemo(() => bundles.filter((b) => b.expenses.length > 0), [bundles]);

  const [selectedTrip, setSelectedTrip] = useState<number | 'all'>('all');
  const scoped = useMemo(
    () =>
      selectedTrip === 'all' ? withExpenses : withExpenses.filter((b) => b.trip.id === selectedTrip),
    [withExpenses, selectedTrip],
  );

  const totalSpent = useMemo(
    () => scoped.reduce((s, b) => s + bundleTotal(b, displayCurrency), 0),
    [scoped, displayCurrency],
  );
  const expenseCount = useMemo(
    () => scoped.reduce((s, b) => s + b.expenses.length, 0),
    [scoped],
  );
  const animatedTotal = useCountUp(totalSpent, 800);
  const animatedCount = useCountUp(expenseCount, 800);

  // Cross-trip category donut (normalized to display currency)
  const donutData = useMemo(() => {
    const map = new Map<string, number>();
    for (const b of scoped) {
      for (const e of b.expenses) {
        const cents = convertCents(e.homeCents, b.trip.homeCurrency, displayCurrency);
        map.set(e.category, (map.get(e.category) ?? 0) + cents);
      }
    }
    return [...map.entries()]
      .map(([category, cents]) => ({ category, cents }))
      .sort((a, b) => b.cents - a.cents);
  }, [scoped, displayCurrency]);

  // Merged ledger for the scoped trips - homeCents normalized to the display
  // currency so cross-trip day totals are meaningful.
  const ledgerGroups = useMemo(
    () =>
      groupByDate(
        scoped.flatMap((b) =>
          b.expenses.map((e) => ({
            ...e,
            homeCents: convertCents(e.homeCents, b.trip.homeCurrency, displayCurrency),
          })),
        ),
      ),
    [scoped, displayCurrency],
  );
  const membersById = useMemo(() => {
    const map = new Map<number, TripMember>();
    for (const b of scoped) for (const m of b.members) map.set(m.id, m);
    return map;
  }, [scoped]);
  const tripTitleById = useMemo(
    () => new Map(scoped.map((b) => [b.trip.id, b.trip.title] as const)),
    [scoped],
  );

  // Per-trip balance summary for the signed-in user (aggregate hides settle).
  const balanceRows = useMemo(() => {
    return withExpenses
      .map((b) => {
        const me =
          b.members.find((m) => m.userId != null && m.userId === user?.id) ??
          b.members.find((m) => m.role === 'owner') ??
          null;
        if (!me) return null;
        const bal = computeBalances(b.expenses, b.members).find((x) => x.member.id === me.id);
        if (!bal) return null;
        return { trip: b.trip, net: bal.net, currency: b.trip.homeCurrency };
      })
      .filter((r): r is NonNullable<typeof r> => r != null && Math.abs(r.net) > 1);
  }, [withExpenses, user?.id]);

  if (isLoading) {
    return (
      <div className="mx-auto w-full max-w-[1120px] space-y-6 px-4 py-8 sm:px-6">
        <Skeleton className="h-10 w-64" />
        <div className="grid gap-6 min-[900px]:grid-cols-12">
          <Skeleton className="h-40 rounded-lg min-[900px]:col-span-7" />
          <Skeleton className="h-40 rounded-lg min-[900px]:col-span-5" />
        </div>
        <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          <Skeleton className="h-52 rounded-lg" />
          <Skeleton className="h-52 rounded-lg" />
          <Skeleton className="h-52 rounded-lg" />
        </div>
        <ToastHost />
      </div>
    );
  }

  if (withExpenses.length === 0) {
    return (
      <div className="mx-auto flex min-h-[60dvh] w-full max-w-[1120px] flex-col items-center justify-center gap-4 px-6 text-center">
        <motion.img
          src="/empty-wallet.svg"
          alt=""
          className="h-[140px] w-auto"
          initial={{ opacity: 0, scale: 0.94 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
        />
        <h1 className="type-h3 text-ink">No expenses yet</h1>
        <p className="type-body max-w-[46ch] text-ink-2">
          Once your trips start logging spending, the cross-trip overview lands here.
        </p>
        <Button asChild size="lg" pill className="mt-2">
          <Link to="/trips">Go to your trips</Link>
        </Button>
        <ToastHost />
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-[1120px] px-4 py-6 sm:px-6 sm:py-8">
      {/* Header + trip switcher */}
      <div className="mb-6 flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="type-h2 text-ink">Expenses</h1>
          <p className="type-small mt-1 text-ink-2">Every trip's spending, in one calm place.</p>
        </div>
        <div className="flex max-w-full gap-0.5 overflow-x-auto rounded-pill bg-surface-2 p-1">
          <button
            type="button"
            onClick={() => setSelectedTrip('all')}
            className={cn(
              'relative shrink-0 rounded-pill px-3.5 py-1.5 text-[13px] font-semibold transition-colors duration-fast',
              selectedTrip === 'all' ? 'text-ink' : 'text-ink-3 hover:text-ink',
            )}
          >
            {selectedTrip === 'all' && (
              <motion.span
                layoutId="exp-trip-pill"
                className="absolute inset-0 rounded-pill bg-surface shadow-sm"
                transition={{ type: 'spring', stiffness: 380, damping: 30 }}
              />
            )}
            <span className="relative">All trips</span>
          </button>
          {withExpenses.map((b) => (
            <button
              key={b.trip.id}
              type="button"
              onClick={() => setSelectedTrip(b.trip.id)}
              className={cn(
                'relative shrink-0 rounded-pill px-3.5 py-1.5 text-[13px] font-semibold transition-colors duration-fast',
                selectedTrip === b.trip.id ? 'text-ink' : 'text-ink-3 hover:text-ink',
              )}
            >
              {selectedTrip === b.trip.id && (
                <motion.span
                  layoutId="exp-trip-pill"
                  className="absolute inset-0 rounded-pill bg-surface shadow-sm"
                  transition={{ type: 'spring', stiffness: 380, damping: 30 }}
                />
              )}
              <span className="relative max-w-[140px] truncate">{b.trip.title}</span>
            </button>
          ))}
        </div>
      </div>

      {/* Totals + donut */}
      <div className="grid gap-6 min-[900px]:grid-cols-12">
        <motion.section
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
          className="flex flex-col justify-between rounded-lg border border-border bg-surface p-7 shadow-sm min-[900px]:col-span-5"
        >
          <span className="type-caption text-ink-3">
            Total spent {selectedTrip === 'all' ? 'across trips' : 'on this trip'}
          </span>
          <div className="tnum mt-3 font-serif text-[40px] font-medium leading-[1.1] tracking-[-0.02em] text-ink">
            {formatMoney(Math.round(animatedTotal), displayCurrency)}
          </div>
          <div className="mt-4 grid grid-cols-2 gap-4 border-t border-border pt-4">
            <div>
              <div className="tnum text-[22px] font-semibold leading-7 text-ink">
                {Math.round(animatedCount)}
              </div>
              <div className="type-caption text-ink-3">expenses</div>
            </div>
            <div>
              <div className="tnum text-[22px] font-semibold leading-7 text-ink">{scoped.length}</div>
              <div className="type-caption text-ink-3">
                {selectedTrip === 'all' ? 'trips' : 'trip'}
              </div>
            </div>
          </div>
        </motion.section>

        <motion.section
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1, duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
          className="rounded-lg border border-border bg-surface p-6 shadow-sm min-[900px]:col-span-7"
        >
          <h3 className="type-h3 mb-5 text-ink">Where it went</h3>
          <CategoryDonut
            data={donutData}
            currency={displayCurrency}
            expenseCount={expenseCount}
            size={isNarrow ? 180 : 220}
            selected={null}
          />
        </motion.section>
      </div>

      {/* Per-trip breakdown cards */}
      <h3 className="type-h3 mb-4 mt-10 text-ink">By trip</h3>
      <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
        {scoped.map((b, i) => {
          const total = b.expenses.reduce((s, e) => s + e.homeCents, 0);
          const budget = b.trip.budgetCents;
          const pct = budget > 0 ? Math.min(100, (total / budget) * 100) : 0;
          const cats = new Set(b.expenses.map((e) => e.category));
          return (
            <motion.div
              key={b.trip.id}
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: Math.min(i, 6) * 0.08, duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
            >
              <Link
                to={`/trips/${b.trip.id}/expenses`}
                className="group block overflow-hidden rounded-lg border border-border bg-surface shadow-sm transition-all duration-fast hover:-translate-y-1 hover:shadow-md"
              >
                {b.trip.coverImage && (
                  <div className="relative h-28 overflow-hidden">
                    <img
                      src={b.trip.coverImage}
                      alt=""
                      className="photo h-full w-full object-cover transition-transform duration-[600ms] ease-expo group-hover:scale-[1.045]"
                    />
                    <span className="type-caption absolute left-3 top-3 rounded-pill bg-black/35 px-2 py-0.5 text-white backdrop-blur-sm">
                      {b.trip.status === 'past' ? 'Past trip' : 'Upcoming'}
                    </span>
                  </div>
                )}
                <div className="p-5">
                  <div className="flex items-baseline justify-between gap-2">
                    <h4 className="type-h4 truncate text-ink">{b.trip.title}</h4>
                    <ArrowRight
                      className="h-4 w-4 shrink-0 text-ink-3 transition-transform duration-fast group-hover:translate-x-0.5 group-hover:text-brand"
                      strokeWidth={1.75}
                    />
                  </div>
                  <p className="type-caption mt-1 text-ink-3">
                    {format(parseDay(b.trip.startDate), 'MMM d')} –{' '}
                    {format(parseDay(b.trip.endDate), 'MMM d, yyyy')} · {b.expenses.length} expense
                    {b.expenses.length === 1 ? '' : 's'} · {b.members.length}{' '}
                    {b.members.length === 1 ? 'traveler' : 'travelers'}
                  </p>
                  <div className="mt-3 flex items-baseline justify-between">
                    <span className="tnum text-[20px] font-semibold text-ink">
                      {formatMoney(total, b.trip.homeCurrency)}
                    </span>
                    {b.trip.homeCurrency !== displayCurrency && (
                      <span className="type-caption tnum text-ink-3">
                        ≈ {formatMoney(bundleTotal(b, displayCurrency), displayCurrency)}
                      </span>
                    )}
                  </div>
                  {budget > 0 && (
                    <div className="mt-2.5 h-1 overflow-hidden rounded-pill bg-surface-2">
                      <motion.div
                        className="h-full rounded-pill"
                        style={{
                          background:
                            total > budget
                              ? 'var(--danger)'
                              : 'linear-gradient(90deg, var(--brand), var(--ochre))',
                        }}
                        initial={{ width: '0%' }}
                        animate={{ width: `${pct}%` }}
                        transition={{ delay: 0.25 + Math.min(i, 6) * 0.08, duration: 0.7, ease: [0.22, 1, 0.36, 1] }}
                      />
                    </div>
                  )}
                  <div className="mt-3 flex items-center gap-1.5">
                    {[...cats].slice(0, 6).map((c) => (
                      <span
                        key={c}
                        className="h-2 w-2 rounded-full"
                        style={{ background: categoryMeta(c).color }}
                        title={categoryMeta(c).label}
                      />
                    ))}
                  </div>
                </div>
              </Link>
            </motion.div>
          );
        })}
      </div>

      {/* Per-trip balance summary (aggregate hides settle) */}
      {selectedTrip === 'all' && balanceRows.length > 0 && (
        <>
          <h3 className="type-h3 mb-4 mt-10 text-ink">Your balances by trip</h3>
          <div className="overflow-hidden rounded-lg border border-border bg-surface shadow-sm">
            {balanceRows.map((r, i) => (
              <button
                key={r.trip.id}
                type="button"
                onClick={() => navigate(`/trips/${r.trip.id}/expenses`)}
                className={cn(
                  'flex w-full items-center gap-3 px-5 py-3.5 text-left transition-colors hover:bg-surface-2',
                  i > 0 && 'border-t border-border',
                )}
              >
                <Wallet className="h-4 w-4 shrink-0 text-ink-3" strokeWidth={1.75} />
                <span className="type-small min-w-0 flex-1 truncate font-semibold text-ink">
                  {r.trip.title}
                </span>
                {r.net > 1 ? (
                  <span className="type-small tnum shrink-0 font-semibold text-pine">
                    you're owed {formatMoney(r.net, r.currency)}
                  </span>
                ) : (
                  <span className="type-small tnum shrink-0 text-ink-2">
                    you owe {formatMoney(-r.net, r.currency)}
                  </span>
                )}
                <ArrowRight className="h-4 w-4 shrink-0 text-ink-3" strokeWidth={1.75} />
              </button>
            ))}
          </div>
        </>
      )}

      {/* Cross-trip ledger */}
      <h3 className="type-h3 mb-4 mt-10 text-ink">Ledger</h3>
      <ExpenseLedger
        groups={ledgerGroups}
        membersById={membersById}
        homeCurrency={displayCurrency}
        tripTitleById={selectedTrip === 'all' ? tripTitleById : undefined}
        readOnly
      />

      <ToastHost />
    </div>
  );
}
