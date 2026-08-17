import { useMemo, useState } from 'react';
import { Link, Navigate, useParams } from 'react-router';
import { AnimatePresence, motion } from 'framer-motion';
import { ArrowLeft, Crown, Plus, X } from 'lucide-react';
import { formatMoney } from '@contracts/fx';
import { trpc } from '@/providers/trpc';
import { isForbiddenError, shareTokenFromError } from '@/lib/trip-access';
import { useAuth } from '@/hooks/useAuth';
import { Skeleton } from '@/components/ui/skeleton';
import { Button } from '@/components/ui/button';
import { SummaryHeader } from '@/components/expenses/SummaryHeader';
import { CategoryDonut } from '@/components/expenses/CategoryDonut';
import { DailySpendChart } from '@/components/expenses/DailySpendChart';
import { BalancesCard } from '@/components/expenses/BalancesCard';
import { ExpenseLedger } from '@/components/expenses/ExpenseLedger';
import { ExpenseModal } from '@/components/expenses/ExpenseModal';
import { toast } from '@/components/expenses/toast';
import { ToastHost } from '@/components/expenses/ToastHost';
import {
  categoryMeta,
  categoryTotals,
  dateRange,
  groupByDate,
  useMediaQuery,
  type ExpenseWithSplits,
} from '@/components/expenses/utils';
import { format } from 'date-fns';
import { parseDay } from '@/components/expenses/utils';

/** Summary numerals count up only once per session (expenses.md §S1). */
let summaryCountPlayed = false;

function ExpensesSkeleton() {
  return (
    <div className="space-y-6">
      <div className="grid gap-6 min-[900px]:grid-cols-12">
        <Skeleton className="h-56 rounded-lg min-[900px]:col-span-5" />
        <Skeleton className="h-56 rounded-lg min-[900px]:col-span-4" />
        <Skeleton className="h-56 rounded-lg min-[900px]:col-span-3" />
      </div>
      <div className="grid gap-6 min-[900px]:grid-cols-12">
        <Skeleton className="h-72 rounded-lg min-[900px]:col-span-7" />
        <Skeleton className="h-72 rounded-lg min-[900px]:col-span-5" />
      </div>
      <Skeleton className="h-44 rounded-lg" />
      <Skeleton className="h-64 rounded-lg" />
    </div>
  );
}

export default function TripExpenses() {
  const { id } = useParams();
  const tripId = Number(id);
  const utils = trpc.useUtils();
  const { user } = useAuth();
  const isNarrow = useMediaQuery('(max-width: 899px)');

  const { data, isLoading, error } = trpc.trips.get.useQuery(
    { id: tripId },
    { enabled: Number.isFinite(tripId) && tripId > 0, retry: false },
  );

  const [categoryFilter, setCategoryFilter] = useState<string | null>(null);
  const [dateFilter, setDateFilter] = useState<string | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<ExpenseWithSplits | null>(null);
  const [playCount] = useState(() => {
    const v = !summaryCountPlayed;
    summaryCountPlayed = true;
    return v;
  });

  const invalidate = () => {
    void utils.trips.get.invalidate({ id: tripId });
    void utils.trips.list.invalidate();
  };

  const undoAdd = trpc.trips.addExpense.useMutation({
    onSuccess: () => {
      invalidate();
      toast('Expense restored', { tone: 'success' });
    },
  });
  const deleteMutation = trpc.trips.deleteExpense.useMutation({
    onError: (e) => toast(e.message || 'Could not delete expense', { tone: 'danger' }),
  });

  const trip = data?.trip;
  const members = useMemo(() => data?.members ?? [], [data?.members]);
  const expenses = useMemo(() => (data?.expenses ?? []) as ExpenseWithSplits[], [data?.expenses]);
  const home = trip?.homeCurrency ?? 'USD';

  const membersById = useMemo(() => new Map(members.map((m) => [m.id, m])), [members]);
  const currentMember = useMemo(
    () =>
      members.find((m) => m.userId != null && m.userId === user?.id) ??
      members.find((m) => m.role === 'owner') ??
      null,
    [members, user?.id],
  );

  const dayNumberByDate = useMemo(() => {
    const map = new Map<string, number>();
    if (data?.days?.length) {
      data.days.forEach((d, i) => map.set(d.date, i + 1));
    } else if (trip) {
      dateRange(trip.startDate, trip.endDate).forEach((d, i) => map.set(d, i + 1));
    }
    return map;
  }, [data, trip]);

  // Charts data (unfiltered)
  const donutData = useMemo(() => categoryTotals(expenses), [expenses]);
  const dailyData = useMemo(() => {
    if (!trip) return [];
    const byDate = new Map<string, number>();
    for (const e of expenses) byDate.set(e.date, (byDate.get(e.date) ?? 0) + e.homeCents);
    return dateRange(trip.startDate, trip.endDate).map((date, i) => ({
      date,
      dayIndex: i + 1,
      cents: byDate.get(date) ?? 0,
    }));
  }, [trip, expenses]);

  const dailyBudget = useMemo(() => {
    if (!trip || trip.budgetCents <= 0) return null;
    const days = Math.max(1, dateRange(trip.startDate, trip.endDate).length);
    return Math.round(trip.budgetCents / days);
  }, [trip]);

  // Ledger (filtered)
  const filtered = useMemo(
    () =>
      expenses.filter(
        (e) =>
          (!categoryFilter || e.category === categoryFilter) &&
          (!dateFilter || e.date === dateFilter),
      ),
    [expenses, categoryFilter, dateFilter],
  );
  const groups = useMemo(() => groupByDate(filtered), [filtered]);

  const suggestions = useMemo(() => {
    const titles = expenses.map((e) => e.title);
    const stopNames = (data?.stops ?? []).map((s) => s.name);
    return [...new Set([...titles, ...stopNames])];
  }, [expenses, data?.stops]);

  const handleDelete = (e: ExpenseWithSplits) => {
    deleteMutation.mutate(
      { id: e.id, tripId },
      {
        onSuccess: () => {
          invalidate();
          toast('Expense deleted', {
            tone: 'info',
            action: {
              label: 'Undo',
              onClick: () =>
                undoAdd.mutate({
                  tripId,
                  title: e.title,
                  category: e.category,
                  amountCents: e.amountCents,
                  currency: e.currency,
                  date: e.date,
                  paidById: e.paidById,
                  splitMemberIds: e.splits.map((s) => s.memberId),
                }),
            },
          });
        },
      },
    );
  };

  const openAdd = () => {
    setEditing(null);
    setModalOpen(true);
  };

  if (isLoading) {
    return (
      <div className="mx-auto w-full max-w-[1120px] px-4 py-8 sm:px-6">
        <ExpensesSkeleton />
        <ToastHost />
      </div>
    );
  }

  if (!trip) {
    // r15-access: a 403 on a share-enabled trip redirects to the public
    // read-only view; without a share link, explain instead of "not found".
    if (isForbiddenError(error)) {
      const shareToken = shareTokenFromError(error);
      if (shareToken) return <Navigate to={`/shared/${shareToken}`} replace />;
      return (
        <div className="mx-auto flex min-h-[60dvh] w-full max-w-[1120px] flex-col items-center justify-center gap-4 px-6 text-center">
          <h1 className="type-h2 text-ink">You don’t have access to this trip</h1>
          <p className="type-body text-ink-2">
            Ask the owner to share the trip’s public link or invite you as a member.
          </p>
          <Button asChild variant="secondary">
            <Link to="/trips">Back to your trips</Link>
          </Button>
          <ToastHost />
        </div>
      );
    }
    return (
      <div className="mx-auto flex min-h-[60dvh] w-full max-w-[1120px] flex-col items-center justify-center gap-4 px-6 text-center">
        <h1 className="type-h2 text-ink">Trip not found</h1>
        <p className="type-body text-ink-2">This trip may have been removed, or the link is wrong.</p>
        <Button asChild variant="secondary">
          <Link to="/trips">Back to your trips</Link>
        </Button>
        <ToastHost />
      </div>
    );
  }

  const filterLabel = categoryFilter
    ? categoryMeta(categoryFilter).label
    : dateFilter
      ? format(parseDay(dateFilter), 'MMM d')
      : null;

  return (
    <div className="mx-auto w-full max-w-[1120px] px-4 py-6 sm:px-6 sm:py-8">
      {/* Trip context row */}
      <div className="mb-6 flex items-center justify-between gap-3">
        <Link
          to={`/trips/${trip.id}`}
          className="type-small inline-flex items-center gap-1.5 text-ink-2 transition-colors hover:text-ink"
        >
          <ArrowLeft className="h-4 w-4" strokeWidth={1.75} />
          <span className="truncate font-semibold text-ink">{trip.title}</span>
          <span className="hidden text-ink-3 sm:inline">· {trip.destination}</span>
        </Link>
        {data?.tier === 'voyager' && (
          <span className="type-caption inline-flex shrink-0 items-center gap-1 rounded-pill bg-ochre-soft px-2.5 py-1 text-ochre">
            <Crown className="h-3 w-3" strokeWidth={1.75} />
            Voyager
          </span>
        )}
      </div>

      {expenses.length === 0 ? (
        /* ------------------------- Empty state (§S6) ------------------------- */
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
          className="flex flex-col items-center gap-4 rounded-lg border border-border bg-surface px-6 py-16 text-center shadow-sm"
        >
          <motion.img
            src="/empty-wallet.svg"
            alt=""
            className="h-[140px] w-auto"
            initial={{ opacity: 0, scale: 0.94 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ delay: 0.1, duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
          />
          <h2 className="type-h3 text-ink">No expenses yet</h2>
          <p className="type-body max-w-[44ch] text-ink-2">
            Log the first coffee of the trip, splitting is automatic from there.
          </p>
          <Button onClick={openAdd} size="lg" pill className="mt-2">
            <Plus className="h-4 w-4" strokeWidth={2} />
            Add first expense
          </Button>
        </motion.div>
      ) : (
        <div className="space-y-6">
          {/* S1 · Summary header */}
          <SummaryHeader
            trip={trip}
            members={members}
            expenses={expenses}
            playCount={playCount}
            onAdd={openAdd}
          />

          {/* S2 · Charts (hidden until ≥3 expenses; shimmer instead) */}
          {expenses.length < 3 ? (
            <div className="grid gap-6 min-[900px]:grid-cols-12">
              <div className="flex h-64 items-center justify-center rounded-lg border border-border bg-surface shadow-sm min-[900px]:col-span-7">
                <div className="w-full max-w-[420px] space-y-3 px-8">
                  <Skeleton className="h-4 w-2/5" />
                  <Skeleton className="h-28 w-full" />
                  <Skeleton className="h-4 w-3/5" />
                </div>
              </div>
              <div className="flex h-64 flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-border bg-surface/60 px-6 text-center min-[900px]:col-span-5">
                <p className="type-small text-ink-3">
                  Charts appear once you've logged at least 3 expenses.
                </p>
              </div>
            </div>
          ) : (
            <div className="grid gap-6 min-[900px]:grid-cols-12">
              <motion.section
                initial={{ opacity: 0, y: 16 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.15, duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
                className="rounded-lg border border-border bg-surface p-6 shadow-sm min-[900px]:col-span-7"
              >
                <h3 className="type-h3 mb-5 text-ink">Where it went</h3>
                <CategoryDonut
                  data={donutData}
                  currency={home}
                  expenseCount={expenses.length}
                  size={isNarrow ? 180 : 220}
                  selected={categoryFilter}
                  onSelect={(c) => {
                    setCategoryFilter(c);
                    if (c) setDateFilter(null);
                  }}
                />
              </motion.section>
              <motion.section
                initial={{ opacity: 0, y: 16 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.25, duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
                className="rounded-lg border border-border bg-surface p-6 shadow-sm min-[900px]:col-span-5"
              >
                <div className="mb-4 flex items-baseline justify-between">
                  <h3 className="type-h3 text-ink">Pace</h3>
                  {dailyBudget != null && (
                    <span className="type-caption text-ink-3">
                      <span className="tnum">{formatMoney(dailyBudget, home)}</span>/day budget
                    </span>
                  )}
                </div>
                <DailySpendChart
                  data={dailyData}
                  currency={home}
                  dailyBudgetCents={dailyBudget}
                  selectedDate={dateFilter}
                  onSelect={(d) => {
                    setDateFilter(d);
                    if (d) setCategoryFilter(null);
                  }}
                />
              </motion.section>
            </div>
          )}

          {/* S3 · Balances */}
          <motion.div
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.3, duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
          >
            <BalancesCard tripId={tripId} expenses={expenses} members={members} homeCurrency={home} />
          </motion.div>

          {/* S4 · Ledger */}
          <section>
            <div className="mb-3 flex items-center justify-between gap-3">
              <h3 className="type-h3 text-ink">Ledger</h3>
              <AnimatePresence>
                {filterLabel && (
                  <motion.button
                    key={filterLabel}
                    initial={{ opacity: 0, scale: 0.9 }}
                    animate={{ opacity: 1, scale: 1 }}
                    exit={{ opacity: 0, scale: 0.9 }}
                    transition={{ duration: 0.25 }}
                    type="button"
                    onClick={() => {
                      setCategoryFilter(null);
                      setDateFilter(null);
                    }}
                    className="type-small inline-flex items-center gap-1.5 rounded-pill bg-brand-soft px-3 py-1.5 font-semibold text-brand transition-colors hover:bg-brand-soft/70"
                  >
                    Filtering: {filterLabel}
                    <X className="h-3.5 w-3.5" strokeWidth={2} />
                  </motion.button>
                )}
              </AnimatePresence>
            </div>
            <AnimatePresence mode="wait">
              <motion.div
                key={`${categoryFilter ?? ''}-${dateFilter ?? ''}`}
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.25 }}
              >
                {groups.length === 0 ? (
                  <p className="type-body rounded-lg border border-dashed border-border px-6 py-10 text-center text-ink-3">
                    No expenses match this filter.
                  </p>
                ) : (
                  <ExpenseLedger
                    groups={groups}
                    membersById={membersById}
                    homeCurrency={home}
                    dayNumberByDate={dayNumberByDate}
                    currentMemberId={currentMember?.id ?? null}
                    onEdit={(e) => {
                      setEditing(e);
                      setModalOpen(true);
                    }}
                    onDelete={handleDelete}
                  />
                )}
              </motion.div>
            </AnimatePresence>
          </section>
        </div>
      )}

      {/* Mobile FAB */}
      <button
        type="button"
        onClick={openAdd}
        aria-label="Add expense"
        className="fixed bottom-[84px] right-4 z-40 flex h-14 w-14 items-center justify-center rounded-full bg-brand text-brand-ink shadow-lg transition-transform duration-fast hover:scale-105 active:scale-95 md:hidden"
      >
        <Plus className="h-6 w-6" strokeWidth={2} />
      </button>

      <ExpenseModal
        open={modalOpen}
        onOpenChange={setModalOpen}
        tripId={trip.id}
        members={members}
        homeCurrency={home}
        defaultCurrency={[...expenses].sort((a, b) => b.id - a.id)[0]?.currency ?? home}
        suggestions={suggestions}
        editing={editing}
        currentMemberId={currentMember?.id ?? null}
      />
      <ToastHost />
    </div>
  );
}
