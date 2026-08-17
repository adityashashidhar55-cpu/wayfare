import { useMemo, useState } from 'react';
import { Link } from 'react-router';
import { AnimatePresence, motion } from 'framer-motion';
import { ArrowRight, Check, Crown, Download, Info, Medal } from 'lucide-react';
import type { TripMember } from '@contracts/types';
import { formatMoney } from '@contracts/fx';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { UserAvatar } from '@/components/UserAvatar';
import { computeBalances, simplifyDebts, type Debt, type ExpenseWithSplits } from './utils';
import { toast } from './toast';

const RANK_COLORS = ['var(--ochre)', 'var(--ink-3)', '#B08D57'];

/**
 * "Settle up" (expenses.md §S3): simplified debt rows with per-row Settle,
 * "who paid most" ranking, and export actions. Settlements are presentation-
 * level (the API has no settlement entity) - settling applies the transfer to
 * the in-memory balances and re-simplifies.
 */
export function BalancesCard({
  expenses,
  members,
  homeCurrency,
}: {
  expenses: ExpenseWithSplits[];
  members: TripMember[];
  homeCurrency: string;
}) {
  const [settled, setSettled] = useState<Debt[]>([]);
  const membersById = useMemo(() => new Map(members.map((m) => [m.id, m])), [members]);

  const balances = useMemo(() => {
    const base = computeBalances(expenses, members).map((b) => ({ ...b }));
    // Apply settled transfers: debtor paid, creditor received.
    for (const s of settled) {
      const from = base.find((b) => b.member.id === s.fromId);
      const to = base.find((b) => b.member.id === s.toId);
      if (from && to) {
        from.net += s.cents;
        to.net -= s.cents;
      }
    }
    return base;
  }, [expenses, members, settled]);

  const debts = useMemo(() => simplifyDebts(balances), [balances]);
  const debtorCount = balances.filter((b) => b.net < -1).length;
  const creditorCount = balances.filter((b) => b.net > 1).length;
  const naiveTransfers = Math.max(debts.length, debtorCount * creditorCount);

  const ranking = useMemo(
    () => [...balances].sort((a, b) => b.paid - a.paid).filter((b) => b.paid > 0).slice(0, 3),
    [balances],
  );

  const exportCSV = () => {
    const header = 'Date,Title,Category,Amount,Currency,In ' + homeCurrency + ',Paid by,Split among';
    const rows = expenses.map((e) => {
      const payer = membersById.get(e.paidById)?.name ?? '';
      const splitNames = e.splits
        .map((s) => membersById.get(s.memberId)?.name ?? '')
        .filter(Boolean)
        .join(' + ');
      const cells = [
        e.date,
        `"${e.title.replace(/"/g, '""')}"`,
        e.category,
        (e.amountCents / 100).toFixed(2),
        e.currency,
        (e.homeCents / 100).toFixed(2),
        `"${payer.replace(/"/g, '""')}"`,
        `"${splitNames.replace(/"/g, '""')}"`,
      ];
      return cells.join(',');
    });
    const blob = new Blob([[header, ...rows].join('\n')], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'wayfare-expenses.csv';
    a.click();
    URL.revokeObjectURL(url);
    toast('CSV exported', { tone: 'success' });
  };

  return (
    <section className="rounded-lg border border-border bg-surface p-6 shadow-sm sm:p-7">
      <div className="grid gap-8 min-[900px]:grid-cols-12">
        {/* Debt graph */}
        <div className="min-[900px]:col-span-7">
          <div className="flex items-center gap-2">
            <h3 className="type-h3 text-ink">Settle up</h3>
            <TooltipProvider delayDuration={150}>
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    type="button"
                    aria-label="How debts are simplified"
                    className="inline-flex h-6 w-6 items-center justify-center rounded-full text-ink-3 transition-colors hover:bg-surface-2 hover:text-ink"
                  >
                    <Info className="h-3.5 w-3.5" strokeWidth={1.75} />
                  </button>
                </TooltipTrigger>
                <TooltipContent className="max-w-[260px] border-border bg-surface text-ink shadow-md">
                  <p className="type-small">
                    We net everyone's paid-vs-share balances, then match the biggest debtor with the
                    biggest creditor until nothing is left, the fewest possible transfers.
                  </p>
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          </div>

          {debts.length === 0 ? (
            <div className="mt-6 flex items-center gap-3 rounded-md bg-pine-soft px-4 py-4">
              <span className="flex h-8 w-8 items-center justify-center rounded-full bg-pine text-white">
                <Check className="h-4 w-4" strokeWidth={2.5} />
              </span>
              <p className="type-body text-ink">
                All squared away. <span className="text-ink-2">Nice friends.</span>
              </p>
            </div>
          ) : (
            <>
              <ul className="mt-4 space-y-2">
                <AnimatePresence initial={false}>
                  {debts.map((d) => {
                    const from = membersById.get(d.fromId);
                    const to = membersById.get(d.toId);
                    const key = `${d.fromId}-${d.toId}-${d.cents}`;
                    return (
                      <motion.li
                        key={key}
                        layout="position"
                        exit={{ opacity: 0, height: 0, marginBottom: 0, overflow: 'hidden' }}
                        transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
                        className="flex items-center gap-3 rounded-md border border-border bg-surface-2/40 px-3 py-2.5"
                      >
                        <span className="flex -space-x-2">
                          <UserAvatar name={from?.name} className="h-7 w-7 text-[10px]" />
                          <UserAvatar name={to?.name} className="h-7 w-7 text-[10px]" />
                        </span>
                        <span className="type-small min-w-0 flex-1 text-ink">
                          <span className="font-semibold">{from?.name ?? 'Someone'}</span>
                          <span className="text-ink-2"> owes </span>
                          <span className="font-semibold">{to?.name ?? 'someone'}</span>
                        </span>
                        <ArrowRight className="h-4 w-4 shrink-0 text-ink-3" strokeWidth={1.75} />
                        <span className="tnum shrink-0 text-[15px] font-semibold text-ink">
                          {formatMoney(d.cents, homeCurrency)}
                        </span>
                        <Popover>
                          <PopoverTrigger asChild>
                            <Button variant="ghost" size="sm" className="shrink-0">
                              Settle
                            </Button>
                          </PopoverTrigger>
                          <PopoverContent
                            align="end"
                            className="w-64 border-border bg-surface p-4 shadow-lg"
                          >
                            <p className="type-small text-ink">
                              Mark {from?.name ?? 'this'}'s {formatMoney(d.cents, homeCurrency)}{' '}
                              debt to {to?.name ?? 'you'} as settled?
                            </p>
                            <div className="mt-3 flex justify-end">
                              <Button
                                size="sm"
                                onClick={() => {
                                  setSettled((prev) => [...prev, d]);
                                  toast('Marked as settled', { tone: 'success' });
                                }}
                              >
                                Confirm
                              </Button>
                            </div>
                          </PopoverContent>
                        </Popover>
                      </motion.li>
                    );
                  })}
                </AnimatePresence>
              </ul>
              <p className="type-caption mt-3 text-ink-3">
                Debts simplified, {debts.length} transfer{debts.length === 1 ? '' : 's'}
                {naiveTransfers > debts.length ? ` instead of ${naiveTransfers}` : ''}
              </p>
            </>
          )}
        </div>

        {/* Ranking + export */}
        <div className="min-[900px]:col-span-5 min-[900px]:border-l min-[900px]:border-border min-[900px]:pl-8">
          <h4 className="type-h4 text-ink">Who paid most</h4>
          {ranking.length === 0 ? (
            <p className="type-small mt-3 text-ink-3">No payments yet.</p>
          ) : (
            <ul className="mt-3 space-y-2.5">
              {ranking.map((b, i) => (
                <li key={b.member.id} className="flex items-center gap-2.5">
                  <Medal
                    className="h-4 w-4 shrink-0"
                    strokeWidth={1.75}
                    style={{ color: RANK_COLORS[i] ?? 'var(--ink-3)' }}
                  />
                  <UserAvatar name={b.member.name} className="h-6 w-6 text-[9px]" />
                  <span className="type-small min-w-0 flex-1 truncate text-ink">{b.member.name}</span>
                  <span className="type-small tnum shrink-0 font-semibold text-ink">
                    {formatMoney(b.paid, homeCurrency)}
                  </span>
                </li>
              ))}
            </ul>
          )}

          <div className="mt-6 flex flex-wrap items-center gap-2 border-t border-border pt-5">
            <Button variant="ghost" size="sm" onClick={exportCSV}>
              <Download className="h-4 w-4" strokeWidth={1.75} />
              Export CSV
            </Button>
            <Button variant="premium" size="sm" asChild>
              <Link to="/pricing">
                <Crown className="h-4 w-4" strokeWidth={1.75} />
                PDF report
              </Link>
            </Button>
          </div>
        </div>
      </div>
    </section>
  );
}
