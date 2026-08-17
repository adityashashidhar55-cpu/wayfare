import { useEffect, useState } from 'react';
import { Gem, Pencil, Search, Star, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import type { inferRouterOutputs } from '@trpc/server';
import type { AppRouter } from '../../../api/router';
import { trpc } from '@/providers/trpc';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
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
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { cn } from '@/lib/utils';

type RouterOutputs = inferRouterOutputs<AppRouter>;
export type AdminPlace = RouterOutputs['admin']['places']['search']['places'][number];

type SourceFilter = 'all' | 'curated' | 'osm' | 'user';

const SOURCE_CHIPS: { value: SourceFilter; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'curated', label: 'Curated' },
  { value: 'osm', label: 'OpenStreetMap' },
  { value: 'user', label: 'Traveler-added' },
];

const SOURCE_BADGE: Record<string, { label: string; className: string }> = {
  curated: { label: 'Curated', className: 'border-transparent bg-brand-soft text-brand' },
  osm: { label: 'OSM', className: 'border-transparent bg-pine-soft text-pine' },
  user: { label: 'Traveler', className: 'border-transparent bg-ochre-soft text-ochre' },
};

function formatFee(cents: number | null, currency: string | null): string {
  if (cents == null) return '-';
  if (cents === 0) return 'Free';
  const amount = cents / 100;
  if (currency) {
    try {
      return new Intl.NumberFormat('en-US', {
        style: 'currency',
        currency,
        maximumFractionDigits: amount % 1 === 0 ? 0 : 2,
      }).format(amount);
    } catch {
      // unknown currency code, fall through to plain number
    }
  }
  return currency ? `${amount.toFixed(2)} ${currency}` : amount.toFixed(2);
}

/** Inline edit dialog: fee, note, rating, price level, hidden-gem flag, description. */
function EditPlaceDialog({
  place,
  onClose,
}: {
  place: AdminPlace;
  onClose: () => void;
}) {
  const utils = trpc.useUtils();
  const [fee, setFee] = useState(place.feeCents != null ? String(place.feeCents / 100) : '');
  const [feeNote, setFeeNote] = useState(place.feeNote ?? '');
  const [rating, setRating] = useState(String(place.rating ?? 4.5));
  const [priceLevel, setPriceLevel] = useState(place.priceLevel ?? 2);
  const [hidden, setHidden] = useState(place.hidden);
  const [description, setDescription] = useState(place.description ?? '');

  const update = trpc.admin.updatePlace.useMutation({
    onSuccess: () => {
      void utils.admin.places.invalidate();
      void utils.admin.stats.invalidate();
      onClose();
      toast.success('Place updated');
    },
    onError: (e) => toast.error(e.message),
  });

  const save = () => {
    let feeCents: number | null = null;
    const trimmedFee = fee.trim();
    if (trimmedFee) {
      const parsed = Number(trimmedFee);
      if (!Number.isFinite(parsed) || parsed < 0) {
        toast.error('Fee must be a positive number (or blank for unknown)');
        return;
      }
      feeCents = Math.round(parsed * 100);
    }
    const parsedRating = Number(rating);
    if (!Number.isFinite(parsedRating) || parsedRating < 0 || parsedRating > 5) {
      toast.error('Rating must be between 0 and 5');
      return;
    }
    update.mutate({
      id: place.id,
      feeCents,
      feeNote: feeNote.trim() || null,
      rating: Math.round(parsedRating * 10) / 10,
      priceLevel,
      hidden,
      description: description.trim() || null,
    });
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="rounded-xl sm:max-w-[520px]">
        <DialogHeader>
          <DialogTitle className="type-h3">Edit “{place.name}”</DialogTitle>
          <DialogDescription className="type-small text-ink-2">
            {place.city}, {place.country} · curation details travelers see in Explore.
          </DialogDescription>
        </DialogHeader>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            save();
          }}
          className="space-y-5"
        >
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label htmlFor="admin-fee" className="type-small text-ink-2">
                Admission fee{place.feeCurrency ? ` (${place.feeCurrency})` : ''}
              </Label>
              <Input
                id="admin-fee"
                inputMode="decimal"
                placeholder="Blank = unknown · 0 = free"
                value={fee}
                onChange={(e) => setFee(e.target.value)}
                className="h-10 rounded-md border-border-strong bg-surface"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="admin-rating" className="type-small text-ink-2">
                Rating (0–5)
              </Label>
              <Input
                id="admin-rating"
                inputMode="decimal"
                value={rating}
                onChange={(e) => setRating(e.target.value)}
                className="h-10 rounded-md border-border-strong bg-surface"
              />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="admin-feenote" className="type-small text-ink-2">
              Fee note
            </Label>
            <Input
              id="admin-feenote"
              maxLength={255}
              placeholder="Adults ¥700 · under 18 free"
              value={feeNote}
              onChange={(e) => setFeeNote(e.target.value)}
              className="h-10 rounded-md border-border-strong bg-surface"
            />
          </div>
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div className="space-y-1.5">
              <span className="type-small text-ink-2">Price level</span>
              <div className="flex gap-1.5">
                {[1, 2, 3, 4].map((level) => (
                  <button
                    key={level}
                    type="button"
                    onClick={() => setPriceLevel(level)}
                    aria-pressed={priceLevel === level}
                    className={cn(
                      'type-small h-9 w-11 rounded-md border transition-all duration-fast',
                      priceLevel === level
                        ? 'border-brand bg-brand-soft font-semibold text-brand'
                        : 'border-border-strong bg-surface text-ink-2 hover:bg-surface-2',
                    )}
                  >
                    {'$'.repeat(level)}
                  </button>
                ))}
              </div>
            </div>
            <label className="flex cursor-pointer items-center gap-2.5">
              <Switch checked={hidden} onCheckedChange={setHidden} aria-label="Hidden gem" />
              <span className="type-small inline-flex items-center gap-1.5 text-ink">
                <Gem className="h-4 w-4 text-ochre" strokeWidth={1.75} />
                Hidden gem
              </span>
            </label>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="admin-desc" className="type-small text-ink-2">
              Description
            </Label>
            <Textarea
              id="admin-desc"
              rows={4}
              maxLength={10000}
              placeholder="Why this place belongs on an itinerary…"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className="rounded-md border-border-strong bg-surface"
            />
          </div>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={update.isPending}>
              {update.isPending ? 'Saving…' : 'Save changes'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** Places tab: searchable corpus table with inline curation + delete. */
export function PlacesTab() {
  const utils = trpc.useUtils();
  const [q, setQ] = useState('');
  const [debouncedQ, setDebouncedQ] = useState('');
  const [source, setSource] = useState<SourceFilter>('all');
  const [editing, setEditing] = useState<AdminPlace | null>(null);
  const [deleting, setDeleting] = useState<AdminPlace | null>(null);

  useEffect(() => {
    const t = setTimeout(() => setDebouncedQ(q.trim()), 300);
    return () => clearTimeout(t);
  }, [q]);

  const placesQ = trpc.admin.places.search.useInfiniteQuery(
    {
      q: debouncedQ || undefined,
      source: source === 'all' ? undefined : source,
      pageSize: 50,
    },
    { getNextPageParam: (last) => last.nextCursor },
  );

  const remove = trpc.admin.deletePlace.useMutation({
    onSuccess: () => {
      void utils.admin.places.invalidate();
      void utils.admin.stats.invalidate();
      setDeleting(null);
      toast.success('Place deleted');
    },
    onError: (e) => toast.error(e.message),
  });

  const rows = placesQ.data?.pages.flatMap((p) => p.places) ?? [];
  const total = placesQ.data?.pages[0]?.total ?? 0;

  return (
    <div className="space-y-4">
      {/* Search + source chips */}
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div className="relative w-full md:max-w-[320px]">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-3" strokeWidth={1.75} />
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search name, city, country…"
            aria-label="Search places"
            className="h-10 rounded-md border-border-strong bg-surface pl-9"
          />
        </div>
        <div className="flex flex-wrap gap-1.5">
          {SOURCE_CHIPS.map((chip) => (
            <button
              key={chip.value}
              type="button"
              onClick={() => setSource(chip.value)}
              aria-pressed={source === chip.value}
              className={cn(
                'type-caption rounded-pill px-3 py-1.5 transition-all duration-fast',
                source === chip.value
                  ? 'bg-brand-soft font-semibold text-brand'
                  : 'bg-surface-2 text-ink-2 hover:text-ink',
              )}
            >
              {chip.label}
            </button>
          ))}
        </div>
      </div>

      {/* Table */}
      <div className="overflow-hidden rounded-xl border border-border bg-surface shadow-sm">
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow className="border-border hover:bg-transparent">
                <TableHead className="type-caption text-ink-3">Name</TableHead>
                <TableHead className="type-caption text-ink-3">City</TableHead>
                <TableHead className="type-caption text-ink-3">Source</TableHead>
                <TableHead className="type-caption text-right text-ink-3">Rating</TableHead>
                <TableHead className="type-caption text-right text-ink-3">Fee</TableHead>
                <TableHead className="type-caption w-[88px] text-right text-ink-3">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((p) => {
                const badge = SOURCE_BADGE[p.source ?? ''] ?? { label: p.source ?? '-', className: 'border-transparent bg-surface-2 text-ink-2' };
                return (
                  <TableRow key={p.id} className="border-border transition-colors duration-fast hover:bg-surface-2">
                    <TableCell className="max-w-[260px]">
                      <span className="type-small block truncate font-semibold text-ink">
                        {p.name}
                        {p.hidden && (
                          <Gem className="ml-1.5 inline h-3.5 w-3.5 text-ochre" aria-label="Hidden gem" strokeWidth={1.75} />
                        )}
                      </span>
                      {p.feeNote && <span className="type-caption block truncate text-ink-3">{p.feeNote}</span>}
                    </TableCell>
                    <TableCell className="type-small whitespace-nowrap text-ink-2">
                      {p.city}, {p.country}
                    </TableCell>
                    <TableCell>
                      <Badge variant="secondary" className={cn('type-caption', badge.className)}>
                        {badge.label}
                      </Badge>
                    </TableCell>
                    <TableCell className="type-small tnum whitespace-nowrap text-right text-ink">
                      <Star className="mr-1 inline h-3.5 w-3.5 fill-ochre text-ochre" strokeWidth={1.75} />
                      {(p.rating ?? 0).toFixed(1)}
                    </TableCell>
                    <TableCell className="type-small tnum whitespace-nowrap text-right text-ink">
                      {formatFee(p.feeCents, p.feeCurrency)}
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-1">
                        <button
                          type="button"
                          aria-label={`Edit ${p.name}`}
                          onClick={() => setEditing(p)}
                          className="inline-flex h-8 w-8 items-center justify-center rounded-md text-ink-3 transition-colors duration-fast hover:bg-surface hover:text-brand"
                        >
                          <Pencil className="h-4 w-4" strokeWidth={1.75} />
                        </button>
                        <button
                          type="button"
                          aria-label={`Delete ${p.name}`}
                          onClick={() => setDeleting(p)}
                          className="inline-flex h-8 w-8 items-center justify-center rounded-md text-ink-3 transition-colors duration-fast hover:bg-surface hover:text-danger"
                        >
                          <Trash2 className="h-4 w-4" strokeWidth={1.75} />
                        </button>
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })}
              {!placesQ.isLoading && rows.length === 0 && (
                <TableRow className="border-border hover:bg-transparent">
                  <TableCell colSpan={6} className="py-12 text-center">
                    <p className="type-small text-ink-2">No places match that search.</p>
                    <p className="type-caption mt-1 text-ink-3">Try a different name, city, or source filter.</p>
                  </TableCell>
                </TableRow>
              )}
              {placesQ.isLoading && (
                <TableRow className="border-border hover:bg-transparent">
                  <TableCell colSpan={6} className="py-12 text-center">
                    <p className="type-small text-ink-3">Loading places…</p>
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>
        <div className="flex items-center justify-between border-t border-border px-4 py-3">
          <span className="type-caption tnum text-ink-3">
            Showing {rows.length.toLocaleString()} of {total.toLocaleString()}
          </span>
          {placesQ.hasNextPage && (
            <Button
              type="button"
              variant="secondary"
              onClick={() => placesQ.fetchNextPage()}
              disabled={placesQ.isFetchingNextPage}
              className="h-9 rounded-md"
            >
              {placesQ.isFetchingNextPage ? 'Loading…' : 'Load more'}
            </Button>
          )}
        </div>
      </div>

      {editing && <EditPlaceDialog key={editing.id} place={editing} onClose={() => setEditing(null)} />}

      <AlertDialog open={deleting != null} onOpenChange={(open) => !open && setDeleting(null)}>
        <AlertDialogContent className="rounded-xl">
          <AlertDialogHeader>
            <AlertDialogTitle className="type-h3">Delete “{deleting?.name}”?</AlertDialogTitle>
            <AlertDialogDescription className="type-small text-ink-2">
              This removes the place from the atlas and from Explore for everyone. There’s no undo.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep place</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => deleting && remove.mutate({ id: deleting.id })}
              className="bg-danger text-white hover:brightness-110"
            >
              {remove.isPending ? 'Deleting…' : 'Delete place'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
