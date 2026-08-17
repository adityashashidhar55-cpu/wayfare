import { Fragment, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Check, ChevronDown, Hourglass, LifeBuoy, RotateCcw } from 'lucide-react';
import { format } from 'date-fns';
import { toast } from 'sonner';
import type { inferRouterOutputs } from '@trpc/server';
import type { AppRouter } from '../../../api/router';
import { trpc } from '@/providers/trpc';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/components/ui/empty';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { EASE_EXPO } from '@/lib/motion';
import { cn } from '@/lib/utils';

type RouterOutputs = inferRouterOutputs<AppRouter>;
export type SupportTicketRow = RouterOutputs['admin']['supportTickets']['tickets'][number];

const CATEGORY_LABEL: Record<string, string> = {
  booking: 'Booking',
  routes: 'Routes',
  weather: 'Weather',
  kids: 'Kids',
  account: 'Account',
  app: 'App',
  bug: 'Bug',
  other: 'Other',
};

type StatusFilter = 'all' | 'open' | 'closed';

/** Stats row: open/closed totals + one chip per category with its count. */
function StatsRow() {
  const statsQ = trpc.admin.ticketStats.useQuery();
  if (statsQ.isLoading) {
    return (
      <div className="flex flex-wrap gap-2" aria-label="Loading ticket stats">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="h-8 w-24 animate-pulse rounded-pill bg-surface-2" />
        ))}
      </div>
    );
  }
  const stats = statsQ.data;
  if (!stats) return null;
  const categories = Object.entries(stats.byCategory).sort((a, b) => b[1] - a[1]);
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="type-small inline-flex items-center gap-1.5 rounded-pill bg-ochre-soft px-3 py-1.5 font-semibold text-ochre">
        <Hourglass className="h-3.5 w-3.5" strokeWidth={1.75} />
        <span className="tnum">{stats.open}</span> open
      </span>
      <span className="type-small inline-flex items-center gap-1.5 rounded-pill bg-pine-soft px-3 py-1.5 font-semibold text-pine">
        <Check className="h-3.5 w-3.5" strokeWidth={2} />
        <span className="tnum">{stats.closed}</span> closed
      </span>
      <span className="type-caption mx-1 text-ink-3">
        <span className="tnum font-semibold text-ink">{stats.total}</span> total
      </span>
      {categories.map(([cat, n]) => (
        <span
          key={cat}
          className="type-caption inline-flex items-center gap-1 rounded-pill border border-border bg-surface px-2.5 py-1 text-ink-2"
        >
          {CATEGORY_LABEL[cat] ?? cat}
          <span className="tnum font-semibold text-ink">{n}</span>
        </span>
      ))}
    </div>
  );
}

/** One ticket row; expands in place to show the full message + reply email. */
function TicketRow({ ticket }: { ticket: SupportTicketRow }) {
  const utils = trpc.useUtils();
  const [expanded, setExpanded] = useState(false);
  const isOpen = ticket.status === 'open';

  const invalidate = () => {
    void utils.admin.supportTickets.invalidate();
    void utils.admin.ticketStats.invalidate();
  };
  const close = trpc.admin.closeTicket.useMutation({
    onSuccess: () => {
      invalidate();
      toast.success('Ticket closed');
    },
    onError: (e) => toast.error(e.message),
  });
  const reopen = trpc.admin.reopenTicket.useMutation({
    onSuccess: () => {
      invalidate();
      toast.success('Ticket reopened');
    },
    onError: (e) => toast.error(e.message),
  });

  return (
    <Fragment>
      <motion.tr
        layout="position"
        onClick={() => setExpanded((v) => !v)}
        className="cursor-pointer border-b border-border transition-colors duration-fast hover:bg-surface-2"
        aria-expanded={expanded}
      >
        <TableCell className="max-w-[160px]">
          <span className="type-small block truncate font-semibold text-ink">{ticket.userName}</span>
        </TableCell>
        <TableCell className="type-small whitespace-nowrap text-ink-2">
          {CATEGORY_LABEL[ticket.category] ?? ticket.category}
        </TableCell>
        <TableCell className="max-w-[260px]">
          <span className="type-small block truncate text-ink-2">{ticket.message}</span>
        </TableCell>
        <TableCell className="type-small tnum whitespace-nowrap text-ink-2">
          {format(new Date(ticket.createdAt), 'MMM d, yyyy')}
        </TableCell>
        <TableCell>
          <Badge
            variant="secondary"
            className={
              isOpen
                ? 'type-caption border-transparent bg-ochre-soft text-ochre'
                : 'type-caption border-transparent bg-pine-soft text-pine'
            }
          >
            {isOpen ? 'Open' : 'Closed'}
          </Badge>
        </TableCell>
        <TableCell className="w-[150px] text-right" onClick={(e) => e.stopPropagation()}>
          <div className="inline-flex items-center gap-1.5">
            {isOpen ? (
              <Button
                type="button"
                variant="pine"
                size="sm"
                disabled={close.isPending}
                onClick={() => close.mutate({ id: ticket.id })}
                aria-label={`Close ticket ${ticket.id}`}
              >
                <Check className="h-3.5 w-3.5" strokeWidth={2} />
                Close
              </Button>
            ) : (
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={reopen.isPending}
                onClick={() => reopen.mutate({ id: ticket.id })}
                aria-label={`Reopen ticket ${ticket.id}`}
              >
                <RotateCcw className="h-3.5 w-3.5" strokeWidth={1.75} />
                Reopen
              </Button>
            )}
            <ChevronDown
              className={cn('h-4 w-4 text-ink-3 transition-transform duration-fast', expanded && 'rotate-180')}
              strokeWidth={1.75}
            />
          </div>
        </TableCell>
      </motion.tr>
      <AnimatePresence initial={false}>
        {expanded && (
          <tr className="border-b border-border bg-surface-2/60">
            <TableCell colSpan={6} className="px-4 py-3">
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.2, ease: EASE_EXPO }}
                className="space-y-1.5"
              >
                <p className="type-small whitespace-pre-wrap text-ink">{ticket.message}</p>
                <p className="type-caption text-ink-3">
                  Reply to: <span className="font-semibold text-ink-2">{ticket.email ?? ticket.userEmail ?? '-'}</span>
                  {' · '}Ticket <span className="tnum">#{ticket.id}</span>
                </p>
              </motion.div>
            </TableCell>
          </tr>
        )}
      </AnimatePresence>
    </Fragment>
  );
}

/**
 * Support tab (r10-support): the Voyager help queue. Stats row up top (open /
 * closed totals + per-category chips), then the ticket table - open first,
 * expandable rows, Close / Reopen actions. Follows the RequestsTab pattern.
 */
export function SupportTab() {
  const [filter, setFilter] = useState<StatusFilter>('all');
  const ticketsQ = trpc.admin.supportTickets.useQuery(filter === 'all' ? undefined : { status: filter });

  const rows = ticketsQ.data?.tickets ?? [];

  return (
    <div className="space-y-4">
      <StatsRow />

      <div className="flex items-center gap-1 rounded-pill bg-surface-2 p-1" role="tablist" aria-label="Filter tickets by status">
        {(['all', 'open', 'closed'] as const).map((f) => (
          <button
            key={f}
            type="button"
            role="tab"
            aria-selected={filter === f}
            onClick={() => setFilter(f)}
            className={cn(
              'type-caption rounded-pill px-3.5 py-1.5 font-semibold capitalize transition-colors duration-fast',
              filter === f ? 'bg-surface text-ink shadow-sm' : 'text-ink-3 hover:text-ink',
            )}
          >
            {f}
          </button>
        ))}
      </div>

      {ticketsQ.isLoading ? (
        <div className="space-y-2" aria-label="Loading support tickets">
          {[0, 1, 2].map((i) => (
            <div key={i} className="h-14 animate-pulse rounded-lg border border-border bg-surface" />
          ))}
        </div>
      ) : rows.length === 0 ? (
        <Empty className="rounded-xl border border-dashed border-border bg-surface shadow-sm">
          <EmptyHeader>
            <EmptyMedia variant="icon" className="size-12 rounded-full bg-brand-soft text-brand">
              <LifeBuoy strokeWidth={1.75} />
            </EmptyMedia>
            <EmptyTitle className="type-h3 text-ink">No {filter === 'all' ? '' : `${filter} `}tickets.</EmptyTitle>
            <EmptyDescription className="type-small text-ink-2">
              When Voyager members message the team from the help widget, their tickets queue up here.
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <div className="overflow-hidden rounded-xl border border-border bg-surface shadow-sm">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow className="border-border hover:bg-transparent">
                  <TableHead className="type-caption text-ink-3">Member</TableHead>
                  <TableHead className="type-caption text-ink-3">Category</TableHead>
                  <TableHead className="type-caption text-ink-3">Message</TableHead>
                  <TableHead className="type-caption text-ink-3">Date</TableHead>
                  <TableHead className="type-caption text-ink-3">Status</TableHead>
                  <TableHead className="type-caption w-[150px] text-right text-ink-3">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((t) => (
                  <TicketRow key={t.id} ticket={t} />
                ))}
              </TableBody>
            </Table>
          </div>
        </div>
      )}
    </div>
  );
}
