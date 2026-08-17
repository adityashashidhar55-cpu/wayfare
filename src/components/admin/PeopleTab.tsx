import { format, formatDistanceToNow } from 'date-fns';
import { ShieldCheck } from 'lucide-react';
import { trpc } from '@/providers/trpc';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { UserAvatar } from '@/components/UserAvatar';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { cn } from '@/lib/utils';

/** People tab: non-guest users with trip/story counts and last sign-in. */
export function PeopleTab() {
  const usersQ = trpc.admin.users.useInfiniteQuery(
    { limit: 50 },
    { getNextPageParam: (last) => last.nextCursor },
  );

  const rows = usersQ.data?.pages.flatMap((p) => p.users) ?? [];

  return (
    <div className="overflow-hidden rounded-xl border border-border bg-surface shadow-sm">
      <div className="overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow className="border-border hover:bg-transparent">
              <TableHead className="type-caption text-ink-3">Name</TableHead>
              <TableHead className="type-caption text-ink-3">Email</TableHead>
              <TableHead className="type-caption text-ink-3">Role</TableHead>
              <TableHead className="type-caption text-right text-ink-3">Trips</TableHead>
              <TableHead className="type-caption text-right text-ink-3">Stories</TableHead>
              <TableHead className="type-caption text-right text-ink-3">Last sign-in</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((u) => {
              const lastSignIn = new Date(u.lastSignInAt);
              return (
                <TableRow key={u.id} className="border-border transition-colors duration-fast hover:bg-surface-2">
                  <TableCell className="max-w-[240px]">
                    <span className="flex items-center gap-2.5">
                      <UserAvatar name={u.name} avatar={u.avatar} />
                      <span className="type-small truncate font-semibold text-ink">{u.name ?? 'Traveler'}</span>
                    </span>
                  </TableCell>
                  <TableCell className="type-small max-w-[220px] truncate text-ink-2">{u.email ?? '-'}</TableCell>
                  <TableCell>
                    <Badge
                      variant="secondary"
                      className={cn(
                        'type-caption border-transparent',
                        u.role === 'admin' ? 'bg-brand-soft text-brand' : 'bg-surface-2 text-ink-2',
                      )}
                    >
                      {u.role === 'admin' && <ShieldCheck className="h-3 w-3" strokeWidth={1.75} />}
                      {u.role}
                    </Badge>
                  </TableCell>
                  <TableCell className="type-small tnum text-right text-ink">{u.trips.toLocaleString()}</TableCell>
                  <TableCell className="type-small tnum text-right text-ink">{u.posts.toLocaleString()}</TableCell>
                  <TableCell className="type-small whitespace-nowrap text-right text-ink-2">
                    <span title={format(lastSignIn, 'MMM d, yyyy · HH:mm')}>
                      {formatDistanceToNow(lastSignIn, { addSuffix: true })}
                    </span>
                  </TableCell>
                </TableRow>
              );
            })}
            {!usersQ.isLoading && rows.length === 0 && (
              <TableRow className="border-border hover:bg-transparent">
                <TableCell colSpan={6} className="py-12 text-center">
                  <p className="type-small text-ink-2">No signed-in travelers yet.</p>
                  <p className="type-caption mt-1 text-ink-3">Guest sessions are excluded from this list.</p>
                </TableCell>
              </TableRow>
            )}
            {usersQ.isLoading && (
              <TableRow className="border-border hover:bg-transparent">
                <TableCell colSpan={6} className="py-12 text-center">
                  <p className="type-small text-ink-3">Loading people…</p>
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>
      {usersQ.hasNextPage && (
        <div className="flex items-center justify-end border-t border-border px-4 py-3">
          <Button
            type="button"
            variant="secondary"
            onClick={() => usersQ.fetchNextPage()}
            disabled={usersQ.isFetchingNextPage}
            className="h-9 rounded-md"
          >
            {usersQ.isFetchingNextPage ? 'Loading…' : 'Load more'}
          </Button>
        </div>
      )}
    </div>
  );
}
