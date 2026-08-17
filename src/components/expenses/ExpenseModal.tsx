import { useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Check, ChevronDown, ChevronUp, Search } from 'lucide-react';
import type { TripMember } from '@contracts/types';
import { CURRENCY_SYMBOLS, FX_PER_USD, convertCents, formatMoney } from '@contracts/fx';
import { EXPENSE_CATEGORIES } from '@contracts/premium';
import { trpc } from '@/providers/trpc';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { UserAvatar } from '@/components/UserAvatar';
import { cn } from '@/lib/utils';
import { categoryMeta, todayISO, type ExpenseWithSplits } from './utils';
import { toast } from './toast';

const CURRENCIES = Object.keys(FX_PER_USD);

function CurrencyPicker({
  value,
  onChange,
}: {
  value: string;
  onChange: (c: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const list = useMemo(
    () => CURRENCIES.filter((c) => c.toLowerCase().includes(q.toLowerCase())),
    [q],
  );
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="type-small flex h-11 shrink-0 items-center gap-1.5 rounded-md border border-border-strong bg-surface px-3 font-semibold text-ink shadow-sm transition-colors hover:bg-surface-2"
          aria-label={`Currency: ${value}`}
        >
          {value} {CURRENCY_SYMBOLS[value] ?? ''}
          <ChevronDown className="h-3.5 w-3.5 text-ink-3" strokeWidth={1.75} />
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-56 border-border bg-surface p-2 shadow-lg">
        <div className="mb-1 flex items-center gap-2 rounded-sm border border-border bg-surface-2/60 px-2">
          <Search className="h-3.5 w-3.5 text-ink-3" strokeWidth={1.75} />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search currency"
            className="type-small h-8 w-full bg-transparent text-ink outline-none placeholder:text-ink-3"
          />
        </div>
        <ul className="max-h-48 overflow-y-auto">
          {list.map((c) => (
            <li key={c}>
              <button
                type="button"
                onClick={() => {
                  onChange(c);
                  setOpen(false);
                  setQ('');
                }}
                className={cn(
                  'type-small flex w-full items-center justify-between rounded-sm px-2 py-1.5 text-left transition-colors hover:bg-surface-2',
                  c === value ? 'font-semibold text-brand' : 'text-ink',
                )}
              >
                <span>{c}</span>
                <span className="text-ink-3">{CURRENCY_SYMBOLS[c]}</span>
              </button>
            </li>
          ))}
          {list.length === 0 && <li className="type-small px-2 py-2 text-ink-3">No matches</li>}
        </ul>
      </PopoverContent>
    </Popover>
  );
}

export interface ExpenseModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  tripId: number;
  members: TripMember[];
  homeCurrency: string;
  /** Preferred currency for new expenses (e.g. last used or home). */
  defaultCurrency?: string;
  /** Past expense titles + stop names for the autocomplete. */
  suggestions?: string[];
  /** When set, the modal edits this expense; otherwise it adds a new one. */
  editing?: ExpenseWithSplits | null;
  /** Member representing the signed-in user (default payer). */
  currentMemberId?: number | null;
}

/** Add / Edit expense modal (expenses.md §S5). */
export function ExpenseModal(props: ExpenseModalProps) {
  const { open, onOpenChange, editing } = props;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[min(520px,calc(100vw-2rem))] gap-0 rounded-xl border-border bg-surface p-6 shadow-lg sm:p-7 max-sm:bottom-0 max-sm:left-0 max-sm:top-auto max-sm:w-full max-sm:max-w-none max-sm:translate-x-0 max-sm:translate-y-0 max-sm:rounded-b-none">
        <DialogHeader>
          <DialogTitle className="type-h3 text-ink">
            {editing ? 'Edit expense' : 'Add expense'}
          </DialogTitle>
        </DialogHeader>
        {/* Remounts fresh on every open (radix unmounts closed content), no reset effect. */}
        <ExpenseForm key={editing ? `edit-${editing.id}` : 'new'} {...props} />
      </DialogContent>
    </Dialog>
  );
}

function ExpenseForm({
  onOpenChange,
  tripId,
  members,
  homeCurrency,
  defaultCurrency,
  suggestions = [],
  editing = null,
  currentMemberId = null,
}: ExpenseModalProps) {
  const utils = trpc.useUtils();
  const [title, setTitle] = useState(editing?.title ?? '');
  const [amount, setAmount] = useState(editing ? String(editing.amountCents / 100) : '');
  const [currency, setCurrency] = useState(editing?.currency ?? defaultCurrency ?? homeCurrency);
  const [category, setCategory] = useState<string>(editing?.category ?? 'food');
  const [paidById, setPaidById] = useState<number | null>(
    editing?.paidById ?? currentMemberId ?? members[0]?.id ?? null,
  );
  const [splitIds, setSplitIds] = useState<number[]>(
    editing ? editing.splits.map((s) => s.memberId) : members.map((m) => m.id),
  );
  const [method, setMethod] = useState<'equal' | 'exact' | 'percent'>('equal');
  const [date, setDate] = useState(editing?.date ?? todayISO());
  const [moreOpen, setMoreOpen] = useState(false);
  const [shake, setShake] = useState(0);
  const [amountError, setAmountError] = useState(false);
  const titleRef = useRef<HTMLInputElement>(null);

  const amountCents = useMemo(() => {
    const n = Number.parseFloat(amount.replace(/,/g, ''));
    return Number.isFinite(n) && n > 0 ? Math.round(n * 100) : 0;
  }, [amount]);

  const homePreview = amountCents > 0 ? convertCents(amountCents, currency, homeCurrency) : 0;
  const perPerson = splitIds.length > 0 ? Math.round(homePreview / splitIds.length) : 0;
  const rateCaption = useMemo(() => {
    if (currency === homeCurrency) return null;
    const fromRate = FX_PER_USD[currency] ?? 1;
    const toRate = FX_PER_USD[homeCurrency] ?? 1;
    const per = fromRate / toRate; // units of `currency` per 1 home
    const pretty = per >= 100 ? Math.round(per).toLocaleString() : per.toFixed(per >= 10 ? 1 : 2);
    return `rate 1 ${homeCurrency} ≈ ${pretty} ${currency}`;
  }, [currency, homeCurrency]);

  const invalidate = () => {
    void utils.trips.get.invalidate({ id: tripId });
    void utils.trips.list.invalidate();
  };

  const addMutation = trpc.trips.addExpense.useMutation({
    onSuccess: () => {
      invalidate();
      onOpenChange(false);
      toast('Expense added', { tone: 'success' });
    },
    onError: (e) => toast(e.message || 'Could not add expense', { tone: 'danger' }),
  });
  const updateMutation = trpc.trips.updateExpense.useMutation({
    onSuccess: () => {
      invalidate();
      onOpenChange(false);
      toast('Expense updated', { tone: 'success' });
    },
    onError: (e) => toast(e.message || 'Could not update expense', { tone: 'danger' }),
  });
  const saving = addMutation.isPending || updateMutation.isPending;

  const submit = () => {
    if (amountCents <= 0) {
      setAmountError(true);
      setShake((s) => s + 1);
      return;
    }
    if (!title.trim()) {
      titleRef.current?.focus();
      return;
    }
    const payload = {
      title: title.trim(),
      category,
      amountCents,
      currency,
      date,
      paidById: paidById ?? members[0]?.id ?? 0,
      splitMemberIds: splitIds.length ? splitIds : members.map((m) => m.id),
    };
    if (editing) {
      updateMutation.mutate({ id: editing.id, tripId, ...payload });
    } else {
      addMutation.mutate({ tripId, ...payload });
    }
  };

  return (
    <>
        <div className="mt-5 space-y-4">
          {/* Amount hero row */}
          <motion.div
            key={shake}
            animate={shake ? { x: [0, -2, 2, -2, 2, 0] } : undefined}
            transition={{ duration: 0.3 }}
          >
            <div
              className={cn(
                'flex items-center gap-3 rounded-lg border bg-surface-2/50 px-4 py-3 transition-colors',
                amountError ? 'border-danger' : 'border-border-strong focus-within:border-brand',
              )}
            >
              <input
                value={amount}
                onChange={(e) => {
                  setAmount(e.target.value.replace(/[^\d.,]/g, ''));
                  setAmountError(false);
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') submit();
                }}
                inputMode="decimal"
                placeholder="0.00"
                aria-label="Amount"
                autoFocus
                className="tnum w-full min-w-0 bg-transparent font-serif text-[34px] font-medium leading-10 tracking-[-0.02em] text-ink caret-brand outline-none placeholder:text-ink-3/50"
              />
              <CurrencyPicker value={currency} onChange={setCurrency} />
            </div>
            <p className="type-caption mt-1.5 px-1 text-ink-3">
              {amountCents > 0
                ? currency === homeCurrency
                  ? formatMoney(homePreview, homeCurrency)
                  : `= ${formatMoney(homePreview, homeCurrency)} ${homeCurrency}${rateCaption ? ` · ${rateCaption}` : ''}`
                : 'Enter an amount'}
            </p>
          </motion.div>

          {/* Title */}
          <div>
            <label className="type-caption mb-1.5 block text-ink-3" htmlFor="exp-title">
              What was it?
            </label>
            <input
              id="exp-title"
              ref={titleRef}
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') submit();
              }}
              placeholder="Ramen at Ichiran"
              list="expense-title-suggestions"
              className="type-body h-11 w-full rounded-md border border-border-strong bg-surface px-3 text-ink outline-none transition-colors placeholder:text-ink-3 focus:border-brand"
            />
            <datalist id="expense-title-suggestions">
              {suggestions.slice(0, 12).map((s) => (
                <option key={s} value={s} />
              ))}
            </datalist>
          </div>

          {/* Category tiles */}
          <div>
            <span className="type-caption mb-1.5 block text-ink-3">Category</span>
            <div className="grid grid-cols-3 gap-2">
              {EXPENSE_CATEGORIES.map((c) => {
                const meta = categoryMeta(c);
                const Icon = meta.icon;
                const active = category === c;
                return (
                  <motion.button
                    key={c}
                    type="button"
                    onClick={() => setCategory(c)}
                    whileTap={{ scale: 0.94 }}
                    animate={active ? { scale: [0.94, 1.04, 1] } : { scale: 1 }}
                    transition={{ type: 'spring', stiffness: 500, damping: 28 }}
                    className={cn(
                      'relative flex flex-col items-center gap-1.5 rounded-md border px-2 py-3 transition-colors duration-fast',
                      active ? 'border-transparent' : 'border-border hover:bg-surface-2',
                    )}
                    style={
                      active
                        ? {
                            background: `color-mix(in srgb, ${meta.color} 14%, transparent)`,
                            borderColor: meta.color,
                            color: meta.color,
                          }
                        : { color: 'var(--ink-2)' }
                    }
                    aria-pressed={active}
                  >
                    <Icon className="h-5 w-5" strokeWidth={1.75} />
                    <span className="text-[12px] font-medium">{meta.label}</span>
                    {active && (
                      <motion.span
                        initial={{ scale: 0 }}
                        animate={{ scale: 1 }}
                        transition={{ type: 'spring', stiffness: 500, damping: 28 }}
                        className="absolute right-1.5 top-1.5 flex h-4 w-4 items-center justify-center rounded-full"
                        style={{ background: meta.color, color: '#fff' }}
                      >
                        <Check className="h-2.5 w-2.5" strokeWidth={3} />
                      </motion.span>
                    )}
                  </motion.button>
                );
              })}
            </div>
          </div>

          {/* Paid by */}
          <div>
            <span className="type-caption mb-1.5 block text-ink-3">Paid by</span>
            <div className="flex flex-wrap gap-2">
              {members.map((m) => {
                const active = paidById === m.id;
                return (
                  <button
                    key={m.id}
                    type="button"
                    onClick={() => setPaidById(m.id)}
                    className={cn(
                      'flex items-center gap-1.5 rounded-pill border py-1 pl-1 pr-3 transition-all duration-fast',
                      active
                        ? 'border-transparent bg-brand-soft text-brand'
                        : 'border-border text-ink-2 hover:bg-surface-2',
                    )}
                    aria-pressed={active}
                  >
                    <UserAvatar name={m.name} className="h-6 w-6 text-[9px] ring-0" />
                    <span className="text-[13px] font-medium">{m.name}</span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Split among */}
          <div>
            <div className="mb-1.5 flex items-center justify-between">
              <span className="type-caption text-ink-3">Split among</span>
              {/* Method segmented (equal split is what the API persists) */}
              <div className="flex rounded-pill bg-surface-2 p-0.5">
                {(['equal', 'exact', 'percent'] as const).map((m) => (
                  <button
                    key={m}
                    type="button"
                    onClick={() => {
                      if (m === 'equal') setMethod('equal');
                      else {
                        setMethod('equal');
                        toast('This demo applies equal splits, exact & percent are on the way', {
                          tone: 'info',
                        });
                      }
                    }}
                    className={cn(
                      'rounded-pill px-2.5 py-1 text-[12px] font-semibold capitalize transition-colors duration-fast',
                      method === m ? 'bg-surface text-ink shadow-sm' : 'text-ink-3 hover:text-ink',
                    )}
                  >
                    {m === 'equal' ? 'Equally' : m}
                  </button>
                ))}
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              {members.map((m) => {
                const on = splitIds.includes(m.id);
                return (
                  <button
                    key={m.id}
                    type="button"
                    onClick={() =>
                      setSplitIds((prev) =>
                        on ? prev.filter((id) => id !== m.id) : [...prev, m.id],
                      )
                    }
                    className={cn(
                      'flex items-center gap-1.5 rounded-pill border py-1 pl-1 pr-3 transition-all duration-fast',
                      on
                        ? 'border-transparent bg-pine-soft text-pine'
                        : 'border-border text-ink-3 opacity-70 hover:opacity-100',
                    )}
                    aria-pressed={on}
                  >
                    <UserAvatar name={m.name} className="h-6 w-6 text-[9px] ring-0" />
                    <span className="text-[13px] font-medium">{m.name}</span>
                    {on && <Check className="h-3 w-3" strokeWidth={2.5} />}
                  </button>
                );
              })}
            </div>
            <AnimatePresence mode="wait">
              {amountCents > 0 && splitIds.length > 0 && (
                <motion.p
                  key={`${perPerson}-${splitIds.length}`}
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -6 }}
                  transition={{ duration: 0.25, ease: [0.22, 1, 0.36, 1] }}
                  className="type-caption mt-2 tnum text-ink-2"
                >
                  {formatMoney(perPerson, homeCurrency)} each · split {splitIds.length}{' '}
                  {splitIds.length === 1 ? 'way' : 'ways'}
                </motion.p>
              )}
            </AnimatePresence>
          </div>

          {/* More (date) */}
          <div className="rounded-md border border-border">
            <button
              type="button"
              onClick={() => setMoreOpen((v) => !v)}
              className="type-small flex w-full items-center justify-between px-3 py-2.5 text-ink-2 transition-colors hover:bg-surface-2"
              aria-expanded={moreOpen}
            >
              More options
              {moreOpen ? (
                <ChevronUp className="h-4 w-4 text-ink-3" strokeWidth={1.75} />
              ) : (
                <ChevronDown className="h-4 w-4 text-ink-3" strokeWidth={1.75} />
              )}
            </button>
            <AnimatePresence initial={false}>
              {moreOpen && (
                <motion.div
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: 'auto', opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  transition={{ duration: 0.25, ease: [0.22, 1, 0.36, 1] }}
                  className="overflow-hidden"
                >
                  <div className="border-t border-border px-3 py-3">
                    <label className="type-caption mb-1.5 block text-ink-3" htmlFor="exp-date">
                      Date
                    </label>
                    <input
                      id="exp-date"
                      type="date"
                      value={date}
                      onChange={(e) => setDate(e.target.value || todayISO())}
                      className="type-small tnum h-10 w-full rounded-md border border-border-strong bg-surface px-3 text-ink outline-none transition-colors focus:border-brand"
                    />
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </div>

        {/* Footer */}
        <div className="mt-6 flex items-center justify-end gap-2">
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={saving} className="min-w-[132px]">
            {saving ? (
              <span className="h-4 w-4 animate-spin rounded-full border-2 border-brand-ink/40 border-t-brand-ink" />
            ) : editing ? (
              'Save changes'
            ) : (
              'Save expense'
            )}
          </Button>
        </div>
    </>
  );
}
