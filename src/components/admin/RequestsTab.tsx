import { AnimatePresence, motion } from 'framer-motion';
import { Check, Hourglass, Inbox } from 'lucide-react';
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

type RouterOutputs = inferRouterOutputs<AppRouter>;
export type CityRequestRow = RouterOutputs['admin']['cityRequests']['requests'][number];

/**
 * Requests tab: the "bring AI itineraries to my city" queue. Travelers file
 * these from the City Builder page (citybuild.requestCityAI); an admin marks
 * them done once the region is handled. Pending rows sort first.
 */
export function RequestsTab() {
  const utils = trpc.useUtils();
  const requestsQ = trpc.admin.cityRequests.useQuery();

  const markDone = trpc.admin.markCityRequestDone.useMutation({
    onSuccess: (row) => {
      void utils.admin.cityRequests.invalidate();
      toast.success(`${row.city} marked done`);
    },
    onError: (e) => toast.error(e.message),
  });

  const rows = requestsQ.data?.requests ?? [];
  const pendingCount = requestsQ.data?.pendingCount ?? 0;

  if (requestsQ.isLoading) {
    return (
      <div className="space-y-2" aria-label="Loading city requests">
        {[0, 1, 2].map((i) => (
          <div key={i} className="h-14 animate-pulse rounded-lg border border-border bg-surface" />
        ))}
      </div>
    );
  }

  if (rows.length === 0) {
    return (
      <Empty className="rounded-xl border border-dashed border-border bg-surface shadow-sm">
        <EmptyHeader>
          <EmptyMedia variant="icon" className="size-12 rounded-full bg-pine-soft text-pine">
            <Inbox strokeWidth={1.75} />
          </EmptyMedia>
          <EmptyTitle className="type-h3 text-ink">No city requests yet.</EmptyTitle>
          <EmptyDescription className="type-small text-ink-2">
            When travelers ask for AI itineraries in cities we don’t cover yet, their requests queue up here.
          </EmptyDescription>
        </EmptyHeader>
      </Empty>
    );
  }

  return (
    <div className="space-y-4">
      <p className="type-small flex items-center gap-1.5 text-ink-2">
        <Hourglass className="h-4 w-4 text-ochre" strokeWidth={1.75} />
        <span className="tnum font-semibold text-ink">{pendingCount}</span>
        {pendingCount === 1 ? 'request needs' : 'requests need'} attention, marking done clears them from the queue.
      </p>

      <div className="overflow-hidden rounded-xl border border-border bg-surface shadow-sm">
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow className="border-border hover:bg-transparent">
                <TableHead className="type-caption text-ink-3">City</TableHead>
                <TableHead className="type-caption text-ink-3">Country</TableHead>
                <TableHead className="type-caption text-ink-3">Requested by</TableHead>
                <TableHead className="type-caption text-ink-3">Message</TableHead>
                <TableHead className="type-caption text-ink-3">Date</TableHead>
                <TableHead className="type-caption text-ink-3">Status</TableHead>
                <TableHead className="type-caption w-[128px] text-right text-ink-3">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              <AnimatePresence initial={false}>
                {rows.map((r) => (
                  <motion.tr
                    key={r.id}
                    layout="position"
                    exit={{ opacity: 0, x: -24, transition: { duration: 0.28, ease: EASE_EXPO } }}
                    className="border-b border-border transition-colors duration-fast hover:bg-surface-2"
                  >
                    <TableCell className="max-w-[180px]">
                      <span className="type-small block truncate font-semibold text-ink">{r.city}</span>
                    </TableCell>
                    <TableCell className="type-small whitespace-nowrap text-ink-2">{r.country ?? '-'}</TableCell>
                    <TableCell className="type-small whitespace-nowrap text-ink-2">{r.userName}</TableCell>
                    <TableCell className="max-w-[240px]">
                      <span className="type-small block truncate text-ink-2">{r.message ?? '-'}</span>
                    </TableCell>
                    <TableCell className="type-small tnum whitespace-nowrap text-ink-2">
                      {format(new Date(r.createdAt), 'MMM d, yyyy')}
                    </TableCell>
                    <TableCell>
                      <Badge
                        variant="secondary"
                        className={
                          r.status === 'pending'
                            ? 'type-caption border-transparent bg-ochre-soft text-ochre'
                            : 'type-caption border-transparent bg-pine-soft text-pine'
                        }
                      >
                        {r.status === 'pending' ? 'Pending' : 'Done'}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right">
                      {r.status === 'pending' && (
                        <Button
                          type="button"
                          variant="pine"
                          size="sm"
                          disabled={markDone.isPending}
                          onClick={() => markDone.mutate({ id: r.id })}
                          aria-label={`Mark ${r.city} done`}
                        >
                          <Check className="h-3.5 w-3.5" strokeWidth={2} />
                          Mark done
                        </Button>
                      )}
                    </TableCell>
                  </motion.tr>
                ))}
              </AnimatePresence>
            </TableBody>
          </Table>
        </div>
      </div>
    </div>
  );
}
