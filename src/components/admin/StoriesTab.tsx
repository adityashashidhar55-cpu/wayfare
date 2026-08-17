import { useState } from 'react';
import { format } from 'date-fns';
import { Heart, Trash2 } from 'lucide-react';
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
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { cn } from '@/lib/utils';

type RouterOutputs = inferRouterOutputs<AppRouter>;
type AdminPost = RouterOutputs['admin']['posts']['posts'][number];

/** Stories tab: every journal post with author, status, likes, and delete. */
export function StoriesTab() {
  const utils = trpc.useUtils();
  const [deleting, setDeleting] = useState<AdminPost | null>(null);

  const postsQ = trpc.admin.posts.useInfiniteQuery(
    { limit: 50 },
    { getNextPageParam: (last) => last.nextCursor },
  );

  const remove = trpc.admin.deletePost.useMutation({
    onSuccess: () => {
      void utils.admin.posts.invalidate();
      void utils.admin.stats.invalidate();
      setDeleting(null);
      toast.success('Story deleted');
    },
    onError: (e) => toast.error(e.message),
  });

  const rows = postsQ.data?.pages.flatMap((p) => p.posts) ?? [];

  return (
    <div className="space-y-4">
      <div className="overflow-hidden rounded-xl border border-border bg-surface shadow-sm">
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow className="border-border hover:bg-transparent">
                <TableHead className="type-caption text-ink-3">Title</TableHead>
                <TableHead className="type-caption text-ink-3">Author</TableHead>
                <TableHead className="type-caption text-ink-3">Status</TableHead>
                <TableHead className="type-caption text-right text-ink-3">Likes</TableHead>
                <TableHead className="type-caption text-right text-ink-3">Posted</TableHead>
                <TableHead className="type-caption w-[64px] text-right text-ink-3">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((p) => (
                <TableRow key={p.id} className="border-border transition-colors duration-fast hover:bg-surface-2">
                  <TableCell className="max-w-[280px]">
                    <span className="type-small block truncate font-semibold text-ink">{p.title}</span>
                  </TableCell>
                  <TableCell className="type-small whitespace-nowrap text-ink-2">{p.authorName}</TableCell>
                  <TableCell>
                    <Badge
                      variant="secondary"
                      className={cn(
                        'type-caption border-transparent capitalize',
                        p.status === 'published' ? 'bg-pine-soft text-pine' : 'bg-surface-2 text-ink-2',
                      )}
                    >
                      {p.status}
                    </Badge>
                  </TableCell>
                  <TableCell className="type-small tnum whitespace-nowrap text-right text-ink">
                    <Heart className="mr-1 inline h-3.5 w-3.5 fill-brand-soft text-brand" strokeWidth={1.75} />
                    {p.likes.toLocaleString()}
                  </TableCell>
                  <TableCell className="type-small tnum whitespace-nowrap text-right text-ink-2">
                    {format(new Date(p.createdAt), 'MMM d, yyyy')}
                  </TableCell>
                  <TableCell className="text-right">
                    <button
                      type="button"
                      aria-label={`Delete ${p.title}`}
                      onClick={() => setDeleting(p)}
                      className="inline-flex h-8 w-8 items-center justify-center rounded-md text-ink-3 transition-colors duration-fast hover:bg-surface hover:text-danger"
                    >
                      <Trash2 className="h-4 w-4" strokeWidth={1.75} />
                    </button>
                  </TableCell>
                </TableRow>
              ))}
              {!postsQ.isLoading && rows.length === 0 && (
                <TableRow className="border-border hover:bg-transparent">
                  <TableCell colSpan={6} className="py-12 text-center">
                    <p className="type-small text-ink-2">No stories yet.</p>
                    <p className="type-caption mt-1 text-ink-3">Traveler journals will show up here.</p>
                  </TableCell>
                </TableRow>
              )}
              {postsQ.isLoading && (
                <TableRow className="border-border hover:bg-transparent">
                  <TableCell colSpan={6} className="py-12 text-center">
                    <p className="type-small text-ink-3">Loading stories…</p>
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>
        {postsQ.hasNextPage && (
          <div className="flex items-center justify-end border-t border-border px-4 py-3">
            <Button
              type="button"
              variant="secondary"
              onClick={() => postsQ.fetchNextPage()}
              disabled={postsQ.isFetchingNextPage}
              className="h-9 rounded-md"
            >
              {postsQ.isFetchingNextPage ? 'Loading…' : 'Load more'}
            </Button>
          </div>
        )}
      </div>

      <AlertDialog open={deleting != null} onOpenChange={(open) => !open && setDeleting(null)}>
        <AlertDialogContent className="rounded-xl">
          <AlertDialogHeader>
            <AlertDialogTitle className="type-h3">Delete “{deleting?.title}”?</AlertDialogTitle>
            <AlertDialogDescription className="type-small text-ink-2">
              This removes the story and its likes for everyone. There’s no undo.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep story</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => deleting && remove.mutate({ id: deleting.id })}
              className="bg-danger text-white hover:brightness-110"
            >
              {remove.isPending ? 'Deleting…' : 'Delete story'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
