import { useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Check, ClipboardCheck, Hourglass, X } from 'lucide-react';
import { toast } from 'sonner';
import type { inferRouterOutputs } from '@trpc/server';
import type { AppRouter } from '../../../api/router';
import { trpc } from '@/providers/trpc';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/components/ui/empty';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { EASE_EXPO } from '@/lib/motion';

type RouterOutputs = inferRouterOutputs<AppRouter>;
export type PendingPlace = RouterOutputs['admin']['pendingPlaces'][number];

const CATEGORY_LABEL: Record<string, string> = {
  food: 'Food',
  activity: 'Sights',
};

function categoryLabel(category: string): string {
  return CATEGORY_LABEL[category] ?? category;
}

/**
 * Review tab: the moderation queue. Traveler-submitted places land here
 * (approved = 0) until an admin validates them - approve publishes the place
 * to Explore for everyone, reject deletes it outright.
 */
export function ReviewTab() {
  const utils = trpc.useUtils();
  const pendingQ = trpc.admin.pendingPlaces.useQuery();
  const [rejecting, setRejecting] = useState<PendingPlace | null>(null);

  const refresh = () => {
    void utils.admin.pendingPlaces.invalidate();
    void utils.admin.stats.invalidate();
  };

  const approve = trpc.admin.approvePlace.useMutation({
    onSuccess: (place) => {
      refresh();
      toast.success(`“${place.name}” is live in Explore`);
    },
    onError: (e) => toast.error(e.message),
  });

  const reject = trpc.admin.rejectPlace.useMutation({
    onSuccess: () => {
      refresh();
      setRejecting(null);
      toast.success('Submission rejected');
    },
    onError: (e) => toast.error(e.message),
  });

  const rows = pendingQ.data ?? [];

  if (pendingQ.isLoading) {
    return (
      <div className="space-y-2" aria-label="Loading review queue">
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
            <ClipboardCheck strokeWidth={1.75} />
          </EmptyMedia>
          <EmptyTitle className="type-h3 text-ink">Nothing awaiting review.</EmptyTitle>
          <EmptyDescription className="type-small text-ink-2">
            Places travelers submit will queue up here for validation before they go live.
          </EmptyDescription>
        </EmptyHeader>
      </Empty>
    );
  }

  return (
    <div className="space-y-4">
      <p className="type-small flex items-center gap-1.5 text-ink-2">
        <Hourglass className="h-4 w-4 text-ochre" strokeWidth={1.75} />
        <span className="tnum font-semibold text-ink">{rows.length}</span>
        {rows.length === 1 ? 'place needs' : 'places need'} a decision, approving makes them visible to everyone.
      </p>

      <div className="overflow-hidden rounded-xl border border-border bg-surface shadow-sm">
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow className="border-border hover:bg-transparent">
                <TableHead className="type-caption text-ink-3">Name</TableHead>
                <TableHead className="type-caption text-ink-3">City</TableHead>
                <TableHead className="type-caption text-ink-3">Category</TableHead>
                <TableHead className="type-caption text-ink-3">Submitted by</TableHead>
                <TableHead className="type-caption text-ink-3">Submitted</TableHead>
                <TableHead className="type-caption w-[188px] text-right text-ink-3">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              <AnimatePresence initial={false}>
                {rows.map((p) => (
                  <motion.tr
                    key={p.id}
                    layout="position"
                    exit={{ opacity: 0, x: -24, transition: { duration: 0.28, ease: EASE_EXPO } }}
                    className="border-b border-border transition-colors duration-fast hover:bg-surface-2"
                  >
                    <TableCell className="max-w-[260px]">
                      <span className="type-small block truncate font-semibold text-ink">{p.name}</span>
                      {p.description && (
                        <span className="type-caption block truncate text-ink-3">{p.description}</span>
                      )}
                    </TableCell>
                    <TableCell className="type-small whitespace-nowrap text-ink-2">
                      {p.city}, {p.country}
                    </TableCell>
                    <TableCell>
                      <Badge variant="secondary" className="type-caption border-transparent bg-surface-2 text-ink-2">
                        {categoryLabel(p.category)}
                      </Badge>
                    </TableCell>
                    <TableCell className="type-small whitespace-nowrap text-ink-2">{p.submitterName}</TableCell>
                    <TableCell className="type-small tnum whitespace-nowrap text-ink-2">#{p.id}</TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-1.5">
                        <Button
                          type="button"
                          variant="pine"
                          size="sm"
                          disabled={approve.isPending || reject.isPending}
                          onClick={() => approve.mutate({ id: p.id })}
                          aria-label={`Approve ${p.name}`}
                        >
                          <Check className="h-3.5 w-3.5" strokeWidth={2} />
                          Approve
                        </Button>
                        <Button
                          type="button"
                          variant="danger-ghost"
                          size="sm"
                          disabled={approve.isPending || reject.isPending}
                          onClick={() => setRejecting(p)}
                          aria-label={`Reject ${p.name}`}
                        >
                          <X className="h-3.5 w-3.5" strokeWidth={2} />
                          Reject
                        </Button>
                      </div>
                    </TableCell>
                  </motion.tr>
                ))}
              </AnimatePresence>
            </TableBody>
          </Table>
        </div>
      </div>

      <AlertDialog open={rejecting != null} onOpenChange={(open) => !open && setRejecting(null)}>
        <AlertDialogContent className="rounded-xl">
          <AlertDialogHeader>
            <AlertDialogTitle className="type-h3">Reject “{rejecting?.name}”?</AlertDialogTitle>
            <AlertDialogDescription className="type-small text-ink-2">
              This deletes the submission for everyone, including {rejecting?.submitterName ?? 'the traveler'} who
              added it. There’s no undo.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep submission</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => rejecting && reject.mutate({ id: rejecting.id })}
              className="bg-danger text-white hover:brightness-110"
            >
              {reject.isPending ? 'Rejecting…' : 'Reject place'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
