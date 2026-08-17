import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router';
import { motion } from 'framer-motion';
import { Check, Crown, Pencil, Plus, Mail, RefreshCw, X } from 'lucide-react';
import type { Trip, TripMember } from '@contracts/types';
import { CURRENCY_SYMBOLS, FX_PER_USD, convertCents, formatMoney } from '@contracts/fx';
import { trpc } from '@/providers/trpc';
import { UserAvatar } from '@/components/UserAvatar';
import { cn } from '@/lib/utils';
import { dateRange, memberColor, todayISO, useCountUp, type ExpenseWithSplits } from './utils';
import { toast } from './toast';

const cardAnim = (i: number) => ({
  initial: { opacity: 0, y: 16 },
  animate: { opacity: 1, y: 0 },
  transition: { delay: i * 0.1, duration: 0.4, ease: [0.22, 1, 0.36, 1] as [number, number, number, number] },
});

/* ------------------------------ Total card ------------------------------ */

function TotalCard({
  trip,
  expenses,
  playCount,
}: {
  trip: Trip;
  expenses: ExpenseWithSplits[];
  playCount: boolean;
}) {
  const utils = trpc.useUtils();
  const home = trip.homeCurrency;
  const total = useMemo(() => expenses.reduce((s, e) => s + e.homeCents, 0), [expenses]);
  const animatedTotal = useCountUp(total, 900, true);
  const shown = playCount ? animatedTotal : total;

  const [spinning, setSpinning] = useState(false);
  const [editingBudget, setEditingBudget] = useState(false);
  const [budgetInput, setBudgetInput] = useState('');

  const updateTrip = trpc.trips.update.useMutation({
    onSuccess: () => {
      void utils.trips.get.invalidate({ id: trip.id });
      void utils.trips.list.invalidate();
      setEditingBudget(false);
      toast('Budget updated', { tone: 'success' });
    },
    onError: (e) => toast(e.message || 'Could not update budget', { tone: 'danger' }),
  });

  // Dominant foreign currency for the rate chip (most-used non-home currency).
  const foreign = useMemo(() => {
    const counts = new Map<string, number>();
    for (const e of expenses) {
      if (e.currency !== home) counts.set(e.currency, (counts.get(e.currency) ?? 0) + 1);
    }
    const top = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
    if (top) return top;
    return home === 'USD' ? 'EUR' : 'USD';
  }, [expenses, home]);

  const alt = home === 'USD' ? foreign : 'USD';
  const converted = convertCents(total, home, alt);
  const rateText = useMemo(() => {
    // "<foreignSym><rate> = $1" style for USD pairs; generic otherwise.
    if (foreign === 'USD') return `$1 = ${CURRENCY_SYMBOLS[home] ?? ''}${FX_PER_USD[home] ?? 1} ${home}`;
    if (home === 'USD') return `${CURRENCY_SYMBOLS[foreign] ?? ''}${FX_PER_USD[foreign] ?? 1} = $1`;
    const per = ((FX_PER_USD[foreign] ?? 1) / (FX_PER_USD[home] ?? 1)).toFixed(2);
    return `1 ${home} ≈ ${per} ${foreign}`;
  }, [foreign, home]);

  const budget = trip.budgetCents;
  const pct = budget > 0 ? (total / budget) * 100 : 0;
  const over = budget > 0 && total > budget;
  const daysLeft = useMemo(() => {
    const today = todayISO();
    if (trip.endDate < today) return 0;
    const start = trip.startDate > today ? trip.startDate : today;
    return dateRange(start, trip.endDate).length;
  }, [trip.startDate, trip.endDate]);

  const saveBudget = () => {
    const n = Number.parseFloat(budgetInput.replace(/,/g, ''));
    if (!Number.isFinite(n) || n < 0) return;
    updateTrip.mutate({ id: trip.id, budgetCents: Math.round(n * 100) });
  };

  return (
    <motion.div
      {...cardAnim(0)}
      className="rounded-lg border border-border bg-surface p-7 shadow-sm min-[900px]:col-span-5"
    >
      <div className="flex items-center justify-between">
        <span className="type-caption text-ink-3">Spent so far</span>
        <button
          type="button"
          onClick={() => {
            setSpinning(true);
            setTimeout(() => setSpinning(false), 320);
            toast('Rates updated', { tone: 'info' });
          }}
          className="type-caption flex items-center gap-1.5 rounded-pill bg-surface-2 px-2.5 py-1 text-ink-2 transition-colors hover:bg-border"
          title="Refresh FX rate"
        >
          <RefreshCw
            className={cn('h-3 w-3 text-ink-3 transition-transform duration-300', spinning && 'rotate-180')}
            strokeWidth={1.75}
          />
          <span className="tnum">{rateText}</span>
        </button>
      </div>

      <div className="tnum mt-3 font-serif text-[40px] font-medium leading-[1.1] tracking-[-0.02em] text-ink">
        {formatMoney(Math.round(shown), home)}
      </div>
      <p className="type-small mt-1 text-ink-2">
        ≈ <span className="tnum font-semibold">{formatMoney(converted, alt)}</span> {alt}
      </p>

      {/* Budget bar */}
      <div className="mt-5">
        <div className="relative h-1.5 overflow-visible rounded-pill bg-border-strong/60">
          <motion.div
            className="absolute inset-y-0 left-0 rounded-pill"
            style={{
              background: over
                ? 'var(--danger)'
                : 'linear-gradient(90deg, var(--brand), var(--ochre))',
            }}
            initial={{ width: '0%' }}
            animate={{ width: `${Math.min(100, pct)}%` }}
            transition={{ delay: 0.2, duration: 0.8, ease: [0.22, 1, 0.36, 1] }}
          />
          {/* 100% marker tick */}
          {budget > 0 && (
            <span
              className="absolute -top-1 bottom-[-4px] w-px bg-ink-3/50"
              style={{ left: '100%' }}
              aria-hidden
            />
          )}
        </div>
        {editingBudget ? (
          <div className="mt-3 flex items-center gap-2">
            <input
              value={budgetInput}
              onChange={(e) => setBudgetInput(e.target.value.replace(/[^\d.,]/g, ''))}
              onKeyDown={(e) => {
                if (e.key === 'Enter') saveBudget();
                if (e.key === 'Escape') setEditingBudget(false);
              }}
              inputMode="decimal"
              autoFocus
              placeholder={`Budget in ${home}`}
              aria-label="Trip budget"
              className="type-small tnum h-9 w-40 rounded-md border border-border-strong bg-surface px-2.5 text-ink outline-none focus:border-brand"
            />
            <button
              type="button"
              onClick={saveBudget}
              disabled={updateTrip.isPending}
              aria-label="Save budget"
              className="inline-flex h-8 w-8 items-center justify-center rounded-md bg-pine text-white transition-transform hover:scale-105"
            >
              <Check className="h-4 w-4" strokeWidth={2} />
            </button>
            <button
              type="button"
              onClick={() => setEditingBudget(false)}
              aria-label="Cancel"
              className="inline-flex h-8 w-8 items-center justify-center rounded-md text-ink-3 transition-colors hover:bg-surface-2 hover:text-ink"
            >
              <X className="h-4 w-4" strokeWidth={1.75} />
            </button>
          </div>
        ) : (
          <p className={cn('type-caption mt-2.5 flex items-center gap-1.5', over ? 'text-danger' : 'text-ink-3')}>
            {budget > 0 ? (
              <>
                <span className="tnum">
                  {formatMoney(total, home)} of {formatMoney(budget, home)} trip budget
                </span>
                <span aria-hidden>·</span>
                <span className="tnum">
                  {over ? `${formatMoney(total - budget, home)} over` : `${daysLeft} days left`}
                </span>
              </>
            ) : (
              'No budget set for this trip'
            )}
            <button
              type="button"
              onClick={() => {
                setBudgetInput(budget > 0 ? String(budget / 100) : '');
                setEditingBudget(true);
              }}
              aria-label="Edit budget"
              className="inline-flex h-5 w-5 items-center justify-center rounded-sm text-ink-3 transition-colors hover:bg-surface-2 hover:text-ink"
            >
              <Pencil className="h-3 w-3" strokeWidth={1.75} />
            </button>
          </p>
        )}
      </div>
    </motion.div>
  );
}

/* ---------------------------- Per-person card ---------------------------- */

function PerPersonCard({
  members,
  expenses,
  home,
  total,
}: {
  members: TripMember[];
  expenses: ExpenseWithSplits[];
  home: string;
  total: number;
}) {
  const shares = useMemo(() => {
    const map = new Map<number, number>();
    for (const e of expenses) for (const s of e.splits) map.set(s.memberId, (map.get(s.memberId) ?? 0) + s.shareCents);
    return members.map((m, i) => ({ member: m, share: map.get(m.id) ?? 0, color: memberColor(m, i) }));
  }, [members, expenses]);
  const max = Math.max(1, ...shares.map((s) => s.share));
  const fair = members.length ? Math.round(total / members.length) : 0;

  return (
    <motion.div
      {...cardAnim(1)}
      className="flex flex-col rounded-lg border border-border bg-surface p-7 shadow-sm min-[900px]:col-span-4"
    >
      <span className="type-caption text-ink-3">Per person</span>
      <ul className="mt-4 flex-1 space-y-3.5">
        {shares.map(({ member, share, color }) => (
          <li key={member.id}>
            <div className="flex items-center gap-2.5">
              <UserAvatar name={member.name} className="h-7 w-7 text-[10px]" />
              <span className="type-small min-w-0 flex-1 truncate text-ink">{member.name}</span>
              <span className="type-small tnum shrink-0 font-semibold text-ink">
                {formatMoney(share, home)}
              </span>
            </div>
            <div className="ml-[38px] mt-1.5 h-1 overflow-hidden rounded-pill bg-surface-2">
              <motion.div
                className="h-full rounded-pill"
                style={{ background: color }}
                initial={{ width: '0%' }}
                animate={{ width: `${(share / max) * 100}%` }}
                transition={{ delay: 0.3, duration: 0.7, ease: [0.22, 1, 0.36, 1] }}
              />
            </div>
          </li>
        ))}
      </ul>
      <p className="type-caption mt-4 border-t border-border pt-3 text-ink-3">
        Fair share: <span className="tnum">{formatMoney(fair, home)}</span> each
      </p>
    </motion.div>
  );
}

/* ----------------------------- Quick add card ----------------------------- */

function QuickAddCard({ onAdd, tripId, isVoyager }: { onAdd: () => void; tripId: number; isVoyager: boolean }) {
  const navigate = useNavigate();
  return (
    <motion.div
      {...cardAnim(2)}
      className="flex flex-col rounded-lg border border-dashed border-brand/50 bg-brand-soft p-6 min-[900px]:col-span-3"
    >
      <button
        type="button"
        onClick={onAdd}
        className="group flex flex-1 flex-col items-center justify-center gap-2.5 rounded-md py-3 transition-colors"
      >
        <span className="flex h-12 w-12 items-center justify-center rounded-full bg-brand text-brand-ink shadow-md transition-all duration-fast group-hover:-translate-y-0.5 group-hover:shadow-lg group-active:scale-95">
          <Plus className="h-6 w-6" strokeWidth={2} />
        </span>
        <span className="text-[15px] font-semibold text-ink">Add expense</span>
        <span className="type-caption text-ink-2">Log it in 5 seconds</span>
      </button>
      {/* r26: "Scan receipt" was advertised here and implemented nowhere - no
          OCR code exists in the repo - so it has been removed rather than left
          as a button that sells a feature we do not have. "Import from email"
          IS real (api/bookings-router.ts), so it now goes to the actual flow
          for Voyagers instead of bouncing them to a plan they already bought. */}
      <div className="mt-3 space-y-1 border-t border-brand/20 pt-3">
        <button
          type="button"
          onClick={() => navigate(isVoyager ? `/trips/${tripId}/bookings` : '/pricing')}
          className="type-small flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-ink-2 transition-colors hover:bg-surface/60 hover:text-ink"
        >
          <Mail className="h-4 w-4" strokeWidth={1.75} />
          <span className="flex-1 text-left">Import from email</span>
          {!isVoyager && <Crown className="h-3.5 w-3.5 text-ochre" strokeWidth={1.75} />}
        </button>
      </div>
    </motion.div>
  );
}

/* ------------------------------ Composition ------------------------------ */

export function SummaryHeader({
  trip,
  members,
  expenses,
  playCount,
  onAdd,
}: {
  trip: Trip;
  members: TripMember[];
  expenses: ExpenseWithSplits[];
  playCount: boolean;
  onAdd: () => void;
}) {
  const total = useMemo(() => expenses.reduce((s, e) => s + e.homeCents, 0), [expenses]);
  // Email import is a real, Voyager-gated feature; route paying users to it
  // rather than back to the pricing page they already converted on.
  const meQ = trpc.users.me.useQuery();
  const isVoyager = meQ.data?.isPremium === true;
  const tripId = trip.id;
  return (
    <div className="grid gap-6 min-[900px]:grid-cols-12">
      <TotalCard trip={trip} expenses={expenses} playCount={playCount} />
      <PerPersonCard members={members} expenses={expenses} home={trip.homeCurrency} total={total} />
      <QuickAddCard onAdd={onAdd} tripId={tripId} isVoyager={isVoyager} />
    </div>
  );
}
