import { useEffect, useState } from 'react';
import {
  ChevronLeft,
  ChevronRight,
  Database,
  Plus,
  Search,
  Trash2,
  TriangleAlert,
} from 'lucide-react';
import { toast } from 'sonner';
import type { inferRouterOutputs } from '@trpc/server';
import type { AppRouter } from '../../../api/router';
import { trpc } from '@/providers/trpc';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { cn } from '@/lib/utils';

type RouterOutputs = inferRouterOutputs<AppRouter>;
type PlaceFull = RouterOutputs['admin']['places']['get'];

const PAGE_SIZE = 25;
const VERDICTS = ['must-see', 'worth-it', 'skip-if-tight'] as const;
type Verdict = (typeof VERDICTS)[number];

const VERDICT_BADGE: Record<Verdict, string> = {
  'must-see': 'border-transparent bg-pine-soft text-pine',
  'worth-it': 'border-transparent bg-ochre-soft text-ochre',
  'skip-if-tight': 'border-transparent bg-surface-2 text-ink-2',
};

function parseList(value: string): string[] {
  return value
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, 32);
}

function parseNumber(value: string): number | undefined {
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  const n = Number(trimmed);
  return Number.isFinite(n) ? n : Number.NaN;
}

/** Edit / create form. `initial` = null means "Add place". */
function PlaceFormDialog({ initial, onClose }: { initial: PlaceFull | null; onClose: () => void }) {
  const utils = trpc.useUtils();
  const [name, setName] = useState(initial?.name ?? '');
  const [category, setCategory] = useState(initial?.category ?? '');
  const [city, setCity] = useState(initial?.city ?? '');
  const [country, setCountry] = useState(initial?.country ?? '');
  const [lat, setLat] = useState(initial?.lat != null ? String(initial.lat) : '');
  const [lng, setLng] = useState(initial?.lng != null ? String(initial.lng) : '');
  const [rating, setRating] = useState(initial?.rating != null ? String(initial.rating) : '');
  const [verdict, setVerdict] = useState<Verdict | 'none'>(
    VERDICTS.includes(initial?.verdict as Verdict) ? (initial?.verdict as Verdict) : 'none',
  );
  const [tags, setTags] = useState((initial?.tags ?? []).join(', '));
  const [styles, setStyles] = useState((initial?.styles ?? []).join(', '));
  const [image, setImage] = useState(initial?.image ?? '');
  const [photoAttribution, setPhotoAttribution] = useState(initial?.photoAttribution ?? '');
  const [imgOk, setImgOk] = useState(true);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const invalidate = () => {
    void utils.admin.places.invalidate();
    void utils.admin.stats.invalidate();
  };

  const update = trpc.admin.places.update.useMutation({
    onSuccess: () => {
      invalidate();
      onClose();
      toast.success('Place updated');
    },
    onError: (e) => toast.error(e.message),
  });
  const create = trpc.admin.places.create.useMutation({
    onSuccess: () => {
      invalidate();
      onClose();
      toast.success('Place added to the atlas');
    },
    onError: (e) => toast.error(e.message),
  });
  const remove = trpc.admin.places.delete.useMutation({
    onSuccess: () => {
      invalidate();
      onClose();
      toast.success('Place deleted');
    },
    onError: (e) => toast.error(e.message),
  });

  const busy = update.isPending || create.isPending;

  const save = () => {
    const fields = {
      name: name.trim(),
      category: category.trim(),
      city: city.trim(),
      country: country.trim(),
      verdict: verdict === 'none' ? null : verdict,
      tags: parseList(tags),
      styles: parseList(styles),
      image: image.trim() || null,
      photoAttribution: photoAttribution.trim() || null,
    };
    if (!fields.name || !fields.category || !fields.city || !fields.country) {
      toast.error('Name, category, city and country are required');
      return;
    }
    if (fields.category.length > 32) {
      toast.error('Category must be 32 characters or fewer');
      return;
    }
    const parsedLat = parseNumber(lat);
    const parsedLng = parseNumber(lng);
    const parsedRating = parseNumber(rating);
    if (parsedLat !== undefined && (Number.isNaN(parsedLat) || parsedLat < -90 || parsedLat > 90)) {
      toast.error('Latitude must be a number between -90 and 90');
      return;
    }
    if (parsedLng !== undefined && (Number.isNaN(parsedLng) || parsedLng < -180 || parsedLng > 180)) {
      toast.error('Longitude must be a number between -180 and 180');
      return;
    }
    if (parsedRating !== undefined && (Number.isNaN(parsedRating) || parsedRating < 0 || parsedRating > 5)) {
      toast.error('Rating must be between 0 and 5');
      return;
    }
    if (initial) {
      update.mutate({
        id: initial.id,
        patch: {
          ...fields,
          lat: parsedLat ?? null,
          lng: parsedLng ?? null,
          rating: parsedRating,
        },
      });
    } else {
      if (parsedLat === undefined || parsedLng === undefined) {
        toast.error('Latitude and longitude are required for a new place');
        return;
      }
      create.mutate({
        ...fields,
        lat: parsedLat,
        lng: parsedLng,
        rating: parsedRating,
      });
    }
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto rounded-xl sm:max-w-[560px]">
        <DialogHeader>
          <DialogTitle className="type-h3">
            {initial ? `Edit “${initial.name}”` : 'Add a place'}
          </DialogTitle>
          <DialogDescription className="type-small text-ink-2">
            {initial
              ? `#${initial.id} · ${initial.city}, ${initial.country}, core atlas fields.`
              : 'A new curated entry in the Wayfare atlas.'}
          </DialogDescription>
        </DialogHeader>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            save();
          }}
          className="space-y-4"
        >
          {image.trim() && imgOk && (
            <img
              key={image.trim()}
              src={image.trim()}
              alt=""
              onError={() => setImgOk(false)}
              className="h-36 w-full rounded-md border border-border object-cover"
            />
          )}
          <div className="space-y-1.5">
            <Label htmlFor="pdb-name" className="type-small text-ink-2">
              Name
            </Label>
            <Input
              id="pdb-name"
              maxLength={255}
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="h-10 rounded-md border-border-strong bg-surface"
            />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label htmlFor="pdb-category" className="type-small text-ink-2">
                Category
              </Label>
              <Input
                id="pdb-category"
                maxLength={32}
                placeholder="landmark, museum, cafe…"
                value={category}
                onChange={(e) => setCategory(e.target.value)}
                className="h-10 rounded-md border-border-strong bg-surface"
              />
            </div>
            <div className="space-y-1.5">
              <Label className="type-small text-ink-2">Verdict</Label>
              <Select value={verdict} onValueChange={(v) => setVerdict(v as Verdict | 'none')}>
                <SelectTrigger className="h-10 w-full rounded-md border-border-strong bg-surface">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">No verdict</SelectItem>
                  {VERDICTS.map((v) => (
                    <SelectItem key={v} value={v}>
                      {v}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label htmlFor="pdb-city" className="type-small text-ink-2">
                City
              </Label>
              <Input
                id="pdb-city"
                maxLength={255}
                value={city}
                onChange={(e) => setCity(e.target.value)}
                className="h-10 rounded-md border-border-strong bg-surface"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="pdb-country" className="type-small text-ink-2">
                Country
              </Label>
              <Input
                id="pdb-country"
                maxLength={255}
                value={country}
                onChange={(e) => setCountry(e.target.value)}
                className="h-10 rounded-md border-border-strong bg-surface"
              />
            </div>
          </div>
          <div className="grid grid-cols-3 gap-4">
            <div className="space-y-1.5">
              <Label htmlFor="pdb-lat" className="type-small text-ink-2">
                Latitude
              </Label>
              <Input
                id="pdb-lat"
                inputMode="decimal"
                placeholder="35.0116"
                value={lat}
                onChange={(e) => setLat(e.target.value)}
                className="h-10 rounded-md border-border-strong bg-surface"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="pdb-lng" className="type-small text-ink-2">
                Longitude
              </Label>
              <Input
                id="pdb-lng"
                inputMode="decimal"
                placeholder="135.7681"
                value={lng}
                onChange={(e) => setLng(e.target.value)}
                className="h-10 rounded-md border-border-strong bg-surface"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="pdb-rating" className="type-small text-ink-2">
                Rating (0–5)
              </Label>
              <Input
                id="pdb-rating"
                inputMode="decimal"
                placeholder="4.5"
                value={rating}
                onChange={(e) => setRating(e.target.value)}
                className="h-10 rounded-md border-border-strong bg-surface"
              />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label htmlFor="pdb-tags" className="type-small text-ink-2">
                Tags (comma separated)
              </Label>
              <Input
                id="pdb-tags"
                placeholder="temple, gardens, quiet"
                value={tags}
                onChange={(e) => setTags(e.target.value)}
                className="h-10 rounded-md border-border-strong bg-surface"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="pdb-styles" className="type-small text-ink-2">
                Styles (comma separated)
              </Label>
              <Input
                id="pdb-styles"
                placeholder="culture, slow"
                value={styles}
                onChange={(e) => setStyles(e.target.value)}
                className="h-10 rounded-md border-border-strong bg-surface"
              />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="pdb-image" className="type-small text-ink-2">
              Image URL
            </Label>
            <Input
              id="pdb-image"
              maxLength={512}
              placeholder="https://… (blank clears the photo)"
              value={image}
              onChange={(e) => {
                setImage(e.target.value);
                setImgOk(true);
              }}
              className="h-10 rounded-md border-border-strong bg-surface"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="pdb-attribution" className="type-small text-ink-2">
              Photo attribution
            </Label>
            <Input
              id="pdb-attribution"
              maxLength={255}
              placeholder="© Jane Doe, CC BY-SA 4.0"
              value={photoAttribution}
              onChange={(e) => setPhotoAttribution(e.target.value)}
              className="h-10 rounded-md border-border-strong bg-surface"
            />
          </div>
          <DialogFooter className="gap-2">
            {initial && (
              <Button
                type="button"
                variant="ghost"
                onClick={() => setConfirmDelete(true)}
                className="mr-auto text-danger hover:bg-danger/10 hover:text-danger"
              >
                <Trash2 className="h-4 w-4" strokeWidth={1.75} />
                Delete
              </Button>
            )}
            <Button type="button" variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={busy}>
              {busy ? 'Saving…' : initial ? 'Save changes' : 'Add place'}
            </Button>
          </DialogFooter>
        </form>

        <AlertDialog open={confirmDelete} onOpenChange={setConfirmDelete}>
          <AlertDialogContent className="rounded-xl">
            <AlertDialogHeader>
              <AlertDialogTitle className="type-h3">Delete “{initial?.name}”?</AlertDialogTitle>
              <AlertDialogDescription className="type-small text-ink-2">
                This removes the place from the atlas and from Explore for everyone. There’s no undo.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Keep place</AlertDialogCancel>
              <AlertDialogAction
                onClick={() => initial && remove.mutate({ id: initial.id })}
                className="bg-danger text-white hover:brightness-110"
              >
                {remove.isPending ? 'Deleting…' : 'Delete place'}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </DialogContent>
    </Dialog>
  );
}

/** Fetches the full row, then mounts the form (keyed so state resets per place). */
function EditPlaceDialog({ id, onClose }: { id: number; onClose: () => void }) {
  const placeQ = trpc.admin.places.get.useQuery({ id });
  if (!placeQ.data) {
    return (
      <Dialog open onOpenChange={(open) => !open && onClose()}>
        <DialogContent className="rounded-xl sm:max-w-[560px]">
          <DialogHeader>
            <DialogTitle className="type-h3">Loading place…</DialogTitle>
          </DialogHeader>
          <div className="h-40 animate-pulse rounded-md bg-surface-2" />
        </DialogContent>
      </Dialog>
    );
  }
  return <PlaceFormDialog key={placeQ.data.id} initial={placeQ.data} onClose={onClose} />;
}

/** Danger zone: delete every row matching a filter set, with a typed confirm. */
function DangerZone() {
  const utils = trpc.useUtils();
  const [city, setCity] = useState('');
  const [country, setCountry] = useState('');
  const [nameLike, setNameLike] = useState('');
  const [category, setCategory] = useState('');
  const [typed, setTyped] = useState('');

  const bulkByFilter = trpc.admin.places.bulkDeleteByFilter.useMutation({
    onSuccess: (res) => {
      void utils.admin.places.invalidate();
      void utils.admin.stats.invalidate();
      toast.success(`Deleted ${res.deleted.toLocaleString()} matching places`);
      setTyped('');
    },
    onError: (e) => toast.error(e.message),
  });

  const hasFilter = Boolean(city.trim() || country.trim() || nameLike.trim() || category.trim());
  const armed = hasFilter && typed.trim().toUpperCase() === 'DELETE';

  return (
    <section className="rounded-xl border border-danger/40 bg-surface p-4 shadow-sm">
      <div className="flex items-center gap-2">
        <TriangleAlert className="h-4 w-4 text-danger" strokeWidth={1.75} />
        <h3 className="type-small font-semibold text-ink">Danger zone, delete by filter</h3>
      </div>
      <p className="type-caption mt-1 text-ink-3">
        Removes every row matching ALL of the filters below (ANDed). Handy for junk cleanup, e.g.
        name pattern <code className="rounded-sm bg-surface-2 px-1">%駐車場%</code> wipes imported
        parking lots. This cannot be undone.
      </p>
      <div className="mt-3 grid grid-cols-2 gap-3 md:grid-cols-4">
        <Input
          aria-label="Filter city"
          placeholder="City (exact)"
          value={city}
          onChange={(e) => setCity(e.target.value)}
          className="h-9 rounded-md border-border-strong bg-surface"
        />
        <Input
          aria-label="Filter country"
          placeholder="Country (exact)"
          value={country}
          onChange={(e) => setCountry(e.target.value)}
          className="h-9 rounded-md border-border-strong bg-surface"
        />
        <Input
          aria-label="Filter name pattern"
          placeholder="Name LIKE pattern"
          value={nameLike}
          onChange={(e) => setNameLike(e.target.value)}
          className="h-9 rounded-md border-border-strong bg-surface"
        />
        <Input
          aria-label="Filter category"
          placeholder="Category (exact)"
          value={category}
          onChange={(e) => setCategory(e.target.value)}
          className="h-9 rounded-md border-border-strong bg-surface"
        />
      </div>
      <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-center">
        <Input
          aria-label="Type DELETE to confirm"
          placeholder='Type "DELETE" to arm'
          value={typed}
          onChange={(e) => setTyped(e.target.value)}
          className="h-9 rounded-md border-border-strong bg-surface sm:max-w-[200px]"
        />
        <Button
          type="button"
          disabled={!armed || bulkByFilter.isPending}
          onClick={() =>
            bulkByFilter.mutate({
              city: city.trim() || undefined,
              country: country.trim() || undefined,
              nameLike: nameLike.trim() || undefined,
              category: category.trim() || undefined,
              confirm: true,
            })
          }
          className="h-9 rounded-md bg-danger text-white hover:brightness-110"
        >
          {bulkByFilter.isPending ? 'Deleting…' : 'Delete matching rows'}
        </Button>
      </div>
    </section>
  );
}

/** Places database console: filtered, paginated table with edit / add / bulk-delete. */
export function PlacesDbTab() {
  const utils = trpc.useUtils();
  const [q, setQ] = useState('');
  const [debouncedQ, setDebouncedQ] = useState('');
  const [city, setCity] = useState('');
  const [country, setCountry] = useState('');
  const [category, setCategory] = useState('all');
  const [verdict, setVerdict] = useState<'all' | Verdict>('all');
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [editingId, setEditingId] = useState<number | null>(null);
  const [adding, setAdding] = useState(false);
  const [confirmBulk, setConfirmBulk] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => setDebouncedQ(q.trim()), 300);
    return () => clearTimeout(t);
  }, [q]);

  // Reset to page 1 whenever the filter set changes.
  const filters = {
    q: debouncedQ || undefined,
    city: city.trim() || undefined,
    country: country.trim() || undefined,
    category: category === 'all' ? undefined : category,
    verdict: verdict === 'all' ? undefined : verdict,
  };
  const filterKey = JSON.stringify(filters);
  useEffect(() => {
    setPage(1);
    setSelected(new Set());
  }, [filterKey]);

  const statsQ = trpc.admin.places.stats.useQuery();
  const searchQ = trpc.admin.places.search.useQuery({ ...filters, page, pageSize: PAGE_SIZE });

  const bulkDelete = trpc.admin.places.bulkDelete.useMutation({
    onSuccess: (res) => {
      void utils.admin.places.invalidate();
      void utils.admin.stats.invalidate();
      setSelected(new Set());
      setConfirmBulk(false);
      toast.success(`Deleted ${res.deleted.toLocaleString()} places`);
    },
    onError: (e) => toast.error(e.message),
  });

  const rows = searchQ.data?.places ?? [];
  const total = searchQ.data?.total ?? 0;
  const totalPages = searchQ.data?.totalPages ?? 1;
  const allChecked = rows.length > 0 && rows.every((r) => selected.has(r.id));

  const toggleAll = () => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (allChecked) rows.forEach((r) => next.delete(r.id));
      else rows.forEach((r) => next.add(r.id));
      return next;
    });
  };
  const toggleOne = (id: number) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  return (
    <div className="space-y-4">
      {/* Header stats */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
        <span className="type-small inline-flex items-center gap-1.5 font-semibold text-ink">
          <Database className="h-4 w-4 text-brand" strokeWidth={1.75} />
          {(statsQ.data?.total ?? 0).toLocaleString()} places
        </span>
        {statsQ.data && (
          <span className="type-caption text-ink-3">
            Top categories:{' '}
            {statsQ.data.byCategory
              .slice(0, 5)
              .map((c) => `${c.category} ${c.count.toLocaleString()}`)
              .join(' · ')}
          </span>
        )}
      </div>

      {/* Filters */}
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
        <div className="relative w-full lg:max-w-[280px]">
          <Search
            className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-3"
            strokeWidth={1.75}
          />
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search name, city, country…"
            aria-label="Search places"
            className="h-10 rounded-md border-border-strong bg-surface pl-9"
          />
        </div>
        <div className="grid flex-1 grid-cols-2 gap-2 md:grid-cols-4">
          <Input
            value={city}
            onChange={(e) => setCity(e.target.value)}
            placeholder="City (exact)"
            aria-label="Filter by city"
            className="h-10 rounded-md border-border-strong bg-surface"
          />
          <Input
            value={country}
            onChange={(e) => setCountry(e.target.value)}
            placeholder="Country (exact)"
            aria-label="Filter by country"
            className="h-10 rounded-md border-border-strong bg-surface"
          />
          <Select value={category} onValueChange={setCategory}>
            <SelectTrigger aria-label="Filter by category" className="h-10 w-full rounded-md border-border-strong bg-surface">
              <SelectValue placeholder="Category" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All categories</SelectItem>
              {(statsQ.data?.byCategory ?? []).map((c) => (
                <SelectItem key={c.category} value={c.category}>
                  {c.category} ({c.count.toLocaleString()})
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={verdict} onValueChange={(v) => setVerdict(v as 'all' | Verdict)}>
            <SelectTrigger aria-label="Filter by verdict" className="h-10 w-full rounded-md border-border-strong bg-surface">
              <SelectValue placeholder="Verdict" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Any verdict</SelectItem>
              {VERDICTS.map((v) => (
                <SelectItem key={v} value={v}>
                  {v}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <Button
          type="button"
          onClick={() => setAdding(true)}
          className="btn-sheen h-10 flex-none gap-1.5 rounded-md bg-brand font-semibold text-brand-ink hover:bg-brand-strong"
        >
          <Plus className="h-4 w-4" strokeWidth={1.75} />
          Add place
        </Button>
      </div>

      {/* Bulk action bar */}
      {selected.size > 0 && (
        <div className="flex items-center justify-between rounded-xl border border-ochre/40 bg-ochre-soft px-4 py-2.5">
          <span className="type-small font-semibold text-ochre">
            {selected.size.toLocaleString()} selected
          </span>
          <div className="flex gap-2">
            <Button type="button" variant="ghost" onClick={() => setSelected(new Set())} className="h-8">
              Clear
            </Button>
            <Button
              type="button"
              onClick={() => setConfirmBulk(true)}
              className="h-8 gap-1.5 rounded-md bg-danger text-white hover:brightness-110"
            >
              <Trash2 className="h-4 w-4" strokeWidth={1.75} />
              Delete selected
            </Button>
          </div>
        </div>
      )}

      {/* Table */}
      <div className="overflow-hidden rounded-xl border border-border bg-surface shadow-sm">
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow className="border-border hover:bg-transparent">
                <TableHead className="w-[40px]">
                  <Checkbox
                    aria-label="Select all on this page"
                    checked={allChecked}
                    onCheckedChange={toggleAll}
                    className="border-border-strong data-[state=checked]:border-brand data-[state=checked]:bg-brand data-[state=checked]:text-brand-ink"
                  />
                </TableHead>
                <TableHead className="type-caption text-ink-3">Name</TableHead>
                <TableHead className="type-caption text-ink-3">Category</TableHead>
                <TableHead className="type-caption text-ink-3">City</TableHead>
                <TableHead className="type-caption text-ink-3">Country</TableHead>
                <TableHead className="type-caption text-right text-ink-3">Rating</TableHead>
                <TableHead className="type-caption text-ink-3">Verdict</TableHead>
                <TableHead className="type-caption w-[40px] text-center text-ink-3" title="Has image">
                  Img
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((p) => (
                <TableRow
                  key={p.id}
                  onClick={() => setEditingId(p.id)}
                  className="cursor-pointer border-border transition-colors duration-fast hover:bg-surface-2"
                >
                  <TableCell onClick={(e) => e.stopPropagation()}>
                    <Checkbox
                      aria-label={`Select ${p.name}`}
                      checked={selected.has(p.id)}
                      onCheckedChange={() => toggleOne(p.id)}
                      className="border-border-strong data-[state=checked]:border-brand data-[state=checked]:bg-brand data-[state=checked]:text-brand-ink"
                    />
                  </TableCell>
                  <TableCell className="max-w-[240px]">
                    <span className="type-small block truncate font-semibold text-ink">{p.name}</span>
                    <span className="type-caption tnum text-ink-3">#{p.id}</span>
                  </TableCell>
                  <TableCell className="type-small whitespace-nowrap text-ink-2">{p.category}</TableCell>
                  <TableCell className="type-small max-w-[140px] truncate text-ink-2">{p.city}</TableCell>
                  <TableCell className="type-small max-w-[140px] truncate text-ink-2">{p.country}</TableCell>
                  <TableCell className="type-small tnum whitespace-nowrap text-right text-ink">
                    {p.rating != null ? p.rating.toFixed(1) : '-'}
                  </TableCell>
                  <TableCell>
                    {p.verdict ? (
                      <Badge
                        variant="secondary"
                        className={cn(
                          'type-caption',
                          VERDICT_BADGE[p.verdict as Verdict] ?? 'border-transparent bg-surface-2 text-ink-2',
                        )}
                      >
                        {p.verdict}
                      </Badge>
                    ) : (
                      <span className="type-caption text-ink-3">-</span>
                    )}
                  </TableCell>
                  <TableCell className="text-center">
                    <span
                      title={p.image ? 'Has image' : 'No image'}
                      className={cn(
                        'inline-block h-2 w-2 rounded-full',
                        p.image ? 'bg-pine' : 'bg-border-strong',
                      )}
                    />
                  </TableCell>
                </TableRow>
              ))}
              {!searchQ.isLoading && rows.length === 0 && (
                <TableRow className="border-border hover:bg-transparent">
                  <TableCell colSpan={8} className="py-12 text-center">
                    <p className="type-small text-ink-2">No places match those filters.</p>
                    <p className="type-caption mt-1 text-ink-3">Loosen a filter or clear the search.</p>
                  </TableCell>
                </TableRow>
              )}
              {searchQ.isLoading && (
                <TableRow className="border-border hover:bg-transparent">
                  <TableCell colSpan={8} className="py-12 text-center">
                    <p className="type-small text-ink-3">Loading places…</p>
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>
        <div className="flex items-center justify-between border-t border-border px-4 py-3">
          <span className="type-caption tnum text-ink-3">
            Page {page.toLocaleString()} of {totalPages.toLocaleString()} · {total.toLocaleString()} places
          </span>
          <div className="flex gap-1.5">
            <Button
              type="button"
              variant="secondary"
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page <= 1 || searchQ.isFetching}
              aria-label="Previous page"
              className="h-9 rounded-md"
            >
              <ChevronLeft className="h-4 w-4" strokeWidth={1.75} />
            </Button>
            <Button
              type="button"
              variant="secondary"
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              disabled={page >= totalPages || searchQ.isFetching}
              aria-label="Next page"
              className="h-9 rounded-md"
            >
              <ChevronRight className="h-4 w-4" strokeWidth={1.75} />
            </Button>
          </div>
        </div>
      </div>

      <DangerZone />

      {editingId != null && <EditPlaceDialog id={editingId} onClose={() => setEditingId(null)} />}
      {adding && <PlaceFormDialog initial={null} onClose={() => setAdding(false)} />}

      <AlertDialog open={confirmBulk} onOpenChange={setConfirmBulk}>
        <AlertDialogContent className="rounded-xl">
          <AlertDialogHeader>
            <AlertDialogTitle className="type-h3">
              Delete {selected.size.toLocaleString()} selected places?
            </AlertDialogTitle>
            <AlertDialogDescription className="type-small text-ink-2">
              They’re removed from the atlas and from Explore for everyone. There’s no undo.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep places</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => bulkDelete.mutate({ ids: [...selected] })}
              className="bg-danger text-white hover:brightness-110"
            >
              {bulkDelete.isPending ? 'Deleting…' : 'Delete all selected'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
