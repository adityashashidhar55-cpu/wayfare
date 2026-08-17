import { motion } from 'framer-motion';
import { Pencil, Trash2 } from 'lucide-react';
import { format } from 'date-fns';
import type { TripMember } from '@contracts/types';
import { formatMoney } from '@contracts/fx';
import { UserAvatar } from '@/components/UserAvatar';
import { categoryMeta, parseDay, type ExpenseWithSplits } from './utils';

export interface LedgerGroup {
  date: string;
  items: ExpenseWithSplits[];
  total: number;
}

function LedgerRow({
  expense,
  membersById,
  homeCurrency,
  currentMemberId,
  tripTitle,
  readOnly,
  onEdit,
  onDelete,
}: {
  expense: ExpenseWithSplits;
  membersById: Map<number, TripMember>;
  homeCurrency: string;
  currentMemberId?: number | null;
  tripTitle?: string;
  readOnly?: boolean;
  onEdit?: (e: ExpenseWithSplits) => void;
  onDelete?: (e: ExpenseWithSplits) => void;
}) {
  const meta = categoryMeta(expense.category);
  const Icon = meta.icon;
  const payer = membersById.get(expense.paidById);
  const mySplit = currentMemberId
    ? expense.splits.find((s) => s.memberId === currentMemberId)
    : undefined;
  const iPaid = currentMemberId != null && expense.paidById === currentMemberId;
  // Your-share accent: ochre when you owe on it, pine when it's owed to you (§S4)
  const owesMe = iPaid && expense.splits.some((s) => s.memberId !== currentMemberId);
  const iOwe = !iPaid && !!mySplit;
  const accent = iOwe ? 'var(--ochre)' : owesMe ? 'var(--pine)' : 'transparent';
  const accentTitle = iOwe
    ? `Your share ${formatMoney(mySplit!.shareCents, homeCurrency)}, unpaid`
    : owesMe
      ? 'You covered this, friends owe you'
      : undefined;

  return (
    <div
      className="group relative flex h-16 items-center gap-3 px-4 transition-colors duration-fast hover:bg-surface-2"
      title={accentTitle}
    >
      <span
        className="absolute inset-y-0 left-0 w-[3px]"
        style={{ background: accent }}
        aria-hidden
      />
      {/* Category icon chip */}
      <span
        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md"
        style={{
          background: `color-mix(in srgb, ${meta.color} 15%, transparent)`,
          color: meta.color,
        }}
      >
        <Icon className="h-[18px] w-[18px]" strokeWidth={1.75} />
      </span>

      {/* Title + meta */}
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="truncate text-[14px] font-semibold text-ink">{expense.title}</span>
          {tripTitle && (
            <span className="type-caption hidden shrink-0 rounded-pill bg-surface-2 px-2 py-0.5 text-ink-3 sm:inline">
              {tripTitle}
            </span>
          )}
        </div>
        <div className="mt-0.5 flex items-center gap-1.5 text-[12px] text-ink-3">
          <UserAvatar name={payer?.name} className="h-4 w-4 text-[8px] ring-1" />
          <span className="truncate font-medium">{payer?.name ?? 'Someone'}</span>
          <span aria-hidden>·</span>
          <span className="shrink-0">
            split {expense.splits.length || 1} {expense.splits.length === 1 ? 'way' : 'ways'}
          </span>
        </div>
      </div>

      {/* Row actions (fade in on hover) */}
      {!readOnly && (
        <div className="flex shrink-0 items-center gap-1 opacity-0 transition-opacity duration-fast group-hover:opacity-100">
          <button
            type="button"
            aria-label={`Edit ${expense.title}`}
            onClick={() => onEdit?.(expense)}
            className="inline-flex h-8 w-8 items-center justify-center rounded-sm text-ink-3 transition-colors hover:bg-surface hover:text-ink"
          >
            <Pencil className="h-4 w-4" strokeWidth={1.75} />
          </button>
          <button
            type="button"
            aria-label={`Delete ${expense.title}`}
            onClick={() => onDelete?.(expense)}
            className="inline-flex h-8 w-8 items-center justify-center rounded-sm text-ink-3 transition-colors hover:bg-danger/10 hover:text-danger"
          >
            <Trash2 className="h-4 w-4" strokeWidth={1.75} />
          </button>
        </div>
      )}

      {/* Amount column */}
      <div className="shrink-0 text-right">
        <div className="tnum text-[14px] font-semibold text-ink">
          {formatMoney(expense.amountCents, expense.currency)}
        </div>
        {expense.currency !== homeCurrency && (
          <div className="tnum text-[12px] text-ink-3 max-[899px]:hidden">
            {formatMoney(expense.homeCents, homeCurrency)}
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * Expense ledger (expenses.md §S4) - grouped by day, sticky-ish group headers
 * with day totals; groups stagger 80ms on enter.
 */
export function ExpenseLedger({
  groups,
  membersById,
  homeCurrency,
  dayNumberByDate,
  currentMemberId,
  tripTitleById,
  readOnly,
  onEdit,
  onDelete,
}: {
  groups: LedgerGroup[];
  membersById: Map<number, TripMember>;
  homeCurrency: string;
  dayNumberByDate?: Map<string, number>;
  currentMemberId?: number | null;
  tripTitleById?: Map<number, string>;
  readOnly?: boolean;
  onEdit?: (e: ExpenseWithSplits) => void;
  onDelete?: (e: ExpenseWithSplits) => void;
}) {
  return (
    <div className="space-y-6">
      {groups.map((g, gi) => {
        const dayNum = dayNumberByDate?.get(g.date);
        return (
          <motion.section
            key={g.date}
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: Math.min(gi, 6) * 0.08, duration: 0.32, ease: [0.22, 1, 0.36, 1] }}
          >
            <div className="mb-2 flex items-baseline justify-between px-1">
              <h4 className="type-h4 text-ink">
                {format(parseDay(g.date), 'EEE, MMM d')}
                {dayNum != null && <span className="font-normal text-ink-3"> · Day {dayNum}</span>}
              </h4>
              <span className="type-small tnum text-ink-2">{formatMoney(g.total, homeCurrency)}</span>
            </div>
            <div className="divide-y divide-border overflow-hidden rounded-lg border border-border bg-surface shadow-sm">
              {g.items.map((e) => (
                <LedgerRow
                  key={e.id}
                  expense={e}
                  membersById={membersById}
                  homeCurrency={homeCurrency}
                  currentMemberId={currentMemberId}
                  tripTitle={tripTitleById?.get(e.tripId)}
                  readOnly={readOnly}
                  onEdit={onEdit}
                  onDelete={onDelete}
                />
              ))}
            </div>
          </motion.section>
        );
      })}
    </div>
  );
}
