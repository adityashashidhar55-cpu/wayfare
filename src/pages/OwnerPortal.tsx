/**
 * r17-portal - private owner console at /portal/:pathSecret.
 *
 * PUBLIC route (not inside AppShell, never linked anywhere - the URL is the
 * first credential). State A: minimal login card (portal ID + password; the
 * path secret comes from the URL). A wrong path secret renders a plain
 * "404 - page not found", indistinguishable from a missing route. State B
 * (wf_portal cookie verified): the console - Places / Images / Dishes tabs
 * backed by portal.* procedures. Warm low-saturation brand/ochre/pine palette.
 */
import { useEffect, useState } from 'react';
import { useParams } from 'react-router';
import type { inferRouterOutputs } from '@trpc/server';
import {
  ChevronLeft,
  ChevronRight,
  Database,
  Globe,
  Image as ImageIcon,
  Loader2,
  Lock,
  LogOut,
  MapPin,
  Plus,
  Search,
  Trash2,
  TriangleAlert,
  UtensilsCrossed,
  Wand2,
} from 'lucide-react';
import { toast } from 'sonner';
import type { AppRouter } from '../../api/router';
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
import { Textarea } from '@/components/ui/textarea';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Toaster } from '@/components/ui/sonner';
import { cn } from '@/lib/utils';
import { searchWebImagesClient, type WebImageHit } from '@/lib/web-image-search';

type RouterOutputs = inferRouterOutputs<AppRouter>;
type PlaceFull = RouterOutputs['portal']['places']['get'];
type DishWithPlaces = RouterOutputs['portal']['dishes']['list'][number];

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

/** tRPC error.data.cause payloads the login resolver deliberately exposes. */
type LoginCause = { attemptsLeft?: number; lockedMinutes?: number };
function loginCauseOf(e: unknown): LoginCause | undefined {
  const data = (e as { data?: { cause?: unknown } })?.data;
  return data?.cause && typeof data.cause === 'object' ? (data.cause as LoginCause) : undefined;
}

// ─── State A: login gate ─────────────────────────────────────────────────────

/** Wrong path secret → plain 404, indistinguishable from a missing route. */
function PortalNotFound() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-bg px-4">
      <p className="type-h1 tnum text-ink-3">404</p>
      <p className="type-body mt-2 text-ink-2">page not found</p>
    </div>
  );
}

function LoginGate({ pathSecret, onSuccess }: { pathSecret: string; onSuccess: () => void }) {
  const [portalId, setPortalId] = useState('');
  const [password, setPassword] = useState('');
  const [notFound, setNotFound] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const [hint, setHint] = useState('');

  const login = trpc.portal.login.useMutation({
    onSuccess: () => onSuccess(),
    onError: (e) => {
      if (e.data?.code === 'NOT_FOUND') {
        setNotFound(true);
        return;
      }
      const cause = loginCauseOf(e);
      setErrorMsg(e.message || 'Invalid credentials');
      setHint(
        cause?.lockedMinutes != null
          ? `Locked, try again in about ${cause.lockedMinutes} min.`
          : cause?.attemptsLeft != null
            ? `${cause.attemptsLeft} attempt${cause.attemptsLeft === 1 ? '' : 's'} left before a 15-minute lockout.`
            : '',
      );
    },
  });

  if (notFound) return <PortalNotFound />;

  return (
    <div className="flex min-h-screen items-center justify-center bg-bg px-4">
      <div className="w-full max-w-[360px] rounded-xl border border-border bg-surface p-6 shadow-sm">
        <div className="flex items-center gap-2">
          <span className="flex size-9 items-center justify-center rounded-full bg-brand-soft text-brand">
            <Lock className="h-4 w-4" strokeWidth={1.75} />
          </span>
          <h1 className="type-h3 text-ink">Owner sign-in</h1>
        </div>
        <form
          className="mt-5 space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            setErrorMsg('');
            setHint('');
            login.mutate({ pathSecret, portalId: portalId.trim(), password });
          }}
        >
          <div className="space-y-1.5">
            <Label htmlFor="portal-id" className="type-small text-ink-2">
              Portal ID
            </Label>
            <Input
              id="portal-id"
              autoComplete="off"
              value={portalId}
              onChange={(e) => setPortalId(e.target.value)}
              className="h-10 rounded-md border-border-strong bg-surface"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="portal-password" className="type-small text-ink-2">
              Password
            </Label>
            <Input
              id="portal-password"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="h-10 rounded-md border-border-strong bg-surface"
            />
          </div>
          {errorMsg && (
            <p className="type-small text-danger" role="alert">
              {errorMsg}
              {hint && <span className="mt-0.5 block text-ink-3">{hint}</span>}
            </p>
          )}
          <Button
            type="submit"
            disabled={login.isPending || !portalId.trim() || !password}
            className="btn-sheen h-10 w-full rounded-md bg-brand font-semibold text-brand-ink hover:bg-brand-strong"
          >
            {login.isPending ? 'Signing in…' : 'Sign in'}
          </Button>
        </form>
      </div>
    </div>
  );
}

// ─── Places tab (r15 PlacesDbTab pattern → portal.places.*) ──────────────────

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
  const [description, setDescription] = useState(initial?.description ?? '');
  const [imgOk, setImgOk] = useState(true);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const invalidate = () => {
    void utils.portal.places.invalidate();
    void utils.portal.stats.invalidate();
  };

  const update = trpc.portal.places.update.useMutation({
    onSuccess: () => {
      invalidate();
      onClose();
      toast.success('Place updated');
    },
    onError: (e) => toast.error(e.message),
  });
  const create = trpc.portal.places.create.useMutation({
    onSuccess: () => {
      invalidate();
      onClose();
      toast.success('Place added to the atlas');
    },
    onError: (e) => toast.error(e.message),
  });
  const remove = trpc.portal.places.delete.useMutation({
    onSuccess: () => {
      invalidate();
      onClose();
      toast.success('Place deleted');
    },
    onError: (e) => toast.error(e.message),
  });
  // r19-portal (6C): description suggest: fills the textarea; the owner
  // still edits and saves explicitly (never auto-saved).
  const suggestDesc = trpc.portal.places.suggestDescription.useMutation({
    onSuccess: (res) => {
      setDescription(res.description);
      toast.success(
        res.source === 'dbpedia' ? 'Description suggested from Wikipedia/DBpedia' : 'Description composed from the place fields',
      );
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
      description: description.trim() || null,
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
        patch: { ...fields, lat: parsedLat ?? null, lng: parsedLng ?? null, rating: parsedRating },
      });
    } else {
      if (parsedLat === undefined || parsedLng === undefined) {
        toast.error('Latitude and longitude are required for a new place');
        return;
      }
      create.mutate({ ...fields, lat: parsedLat, lng: parsedLng, rating: parsedRating });
    }
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto rounded-xl sm:max-w-[560px]">
        <DialogHeader>
          <DialogTitle className="type-h3">{initial ? `Edit “${initial.name}”` : 'Add a place'}</DialogTitle>
          <DialogDescription className="type-small text-ink-2">
            {initial ? `#${initial.id} · ${initial.city}, ${initial.country}, core atlas fields.` : 'A new curated entry in the Wayfare atlas.'}
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
            <Label htmlFor="pp-name" className="type-small text-ink-2">Name</Label>
            <Input id="pp-name" maxLength={255} value={name} onChange={(e) => setName(e.target.value)} className="h-10 rounded-md border-border-strong bg-surface" />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label htmlFor="pp-category" className="type-small text-ink-2">Category</Label>
              <Input id="pp-category" maxLength={32} placeholder="landmark, museum, cafe…" value={category} onChange={(e) => setCategory(e.target.value)} className="h-10 rounded-md border-border-strong bg-surface" />
            </div>
            <div className="space-y-1.5">
              <Label className="type-small text-ink-2">Verdict</Label>
              <Select value={verdict} onValueChange={(v) => setVerdict(v as Verdict | 'none')}>
                <SelectTrigger className="h-10 w-full rounded-md border-border-strong bg-surface"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">No verdict</SelectItem>
                  {VERDICTS.map((v) => (
                    <SelectItem key={v} value={v}>{v}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label htmlFor="pp-city" className="type-small text-ink-2">City</Label>
              <Input id="pp-city" maxLength={255} value={city} onChange={(e) => setCity(e.target.value)} className="h-10 rounded-md border-border-strong bg-surface" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="pp-country" className="type-small text-ink-2">Country</Label>
              <Input id="pp-country" maxLength={255} value={country} onChange={(e) => setCountry(e.target.value)} className="h-10 rounded-md border-border-strong bg-surface" />
            </div>
          </div>
          <div className="grid grid-cols-3 gap-4">
            <div className="space-y-1.5">
              <Label htmlFor="pp-lat" className="type-small text-ink-2">Latitude</Label>
              <Input id="pp-lat" inputMode="decimal" placeholder="35.0116" value={lat} onChange={(e) => setLat(e.target.value)} className="h-10 rounded-md border-border-strong bg-surface" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="pp-lng" className="type-small text-ink-2">Longitude</Label>
              <Input id="pp-lng" inputMode="decimal" placeholder="135.7681" value={lng} onChange={(e) => setLng(e.target.value)} className="h-10 rounded-md border-border-strong bg-surface" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="pp-rating" className="type-small text-ink-2">Rating (0–5)</Label>
              <Input id="pp-rating" inputMode="decimal" placeholder="4.5" value={rating} onChange={(e) => setRating(e.target.value)} className="h-10 rounded-md border-border-strong bg-surface" />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label htmlFor="pp-tags" className="type-small text-ink-2">Tags (comma separated)</Label>
              <Input id="pp-tags" placeholder="temple, gardens, quiet" value={tags} onChange={(e) => setTags(e.target.value)} className="h-10 rounded-md border-border-strong bg-surface" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="pp-styles" className="type-small text-ink-2">Styles (comma separated)</Label>
              <Input id="pp-styles" placeholder="culture, slow" value={styles} onChange={(e) => setStyles(e.target.value)} className="h-10 rounded-md border-border-strong bg-surface" />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="pp-image" className="type-small text-ink-2">Image URL</Label>
            <Input
              id="pp-image"
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
            <Label htmlFor="pp-attribution" className="type-small text-ink-2">Photo attribution</Label>
            <Input id="pp-attribution" maxLength={255} placeholder="© Jane Doe, CC BY-SA 4.0" value={photoAttribution} onChange={(e) => setPhotoAttribution(e.target.value)} className="h-10 rounded-md border-border-strong bg-surface" />
          </div>
          <div className="space-y-1.5">
            <div className="flex items-center justify-between gap-2">
              <Label htmlFor="pp-description" className="type-small text-ink-2">Description</Label>
              <Button
                type="button"
                variant="ghost"
                disabled={suggestDesc.isPending || !name.trim() || !city.trim()}
                title={!name.trim() || !city.trim() ? 'Fill in name and city first' : 'Suggest a description (Wikipedia/DBpedia, else composed)'}
                onClick={() =>
                  suggestDesc.mutate({
                    name: name.trim(),
                    city: city.trim(),
                    country: country.trim() || undefined,
                    category: category.trim() || undefined,
                    tags: parseList(tags),
                  })
                }
                className="h-7 gap-1.5 px-2 text-brand hover:bg-brand-soft hover:text-brand"
              >
                {suggestDesc.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" strokeWidth={1.75} /> : <Wand2 className="h-3.5 w-3.5" strokeWidth={1.75} />}
                {suggestDesc.isPending ? 'Suggesting…' : 'Suggest'}
              </Button>
            </div>
            <Textarea
              id="pp-description"
              rows={4}
              maxLength={10000}
              placeholder="History, story, what makes this place special…"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className="rounded-md border-border-strong bg-surface"
            />
          </div>
          <DialogFooter className="gap-2">
            {initial && (
              <Button type="button" variant="ghost" onClick={() => setConfirmDelete(true)} className="mr-auto text-danger hover:bg-danger/10 hover:text-danger">
                <Trash2 className="h-4 w-4" strokeWidth={1.75} />
                Delete
              </Button>
            )}
            <Button type="button" variant="ghost" onClick={onClose}>Cancel</Button>
            <Button type="submit" disabled={busy}>{busy ? 'Saving…' : initial ? 'Save changes' : 'Add place'}</Button>
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
              <AlertDialogAction onClick={() => initial && remove.mutate({ id: initial.id })} className="bg-danger text-white hover:brightness-110">
                {remove.isPending ? 'Deleting…' : 'Delete place'}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </DialogContent>
    </Dialog>
  );
}

function EditPlaceDialog({ id, onClose }: { id: number; onClose: () => void }) {
  const placeQ = trpc.portal.places.get.useQuery({ id });
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

function PlacesDangerZone() {
  const utils = trpc.useUtils();
  const [city, setCity] = useState('');
  const [country, setCountry] = useState('');
  const [nameLike, setNameLike] = useState('');
  const [category, setCategory] = useState('');
  const [typed, setTyped] = useState('');

  const bulkByFilter = trpc.portal.places.bulkDeleteByFilter.useMutation({
    onSuccess: (res) => {
      void utils.portal.places.invalidate();
      void utils.portal.stats.invalidate();
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
        Removes every row matching ALL of the filters below (ANDed). This cannot be undone.
      </p>
      <div className="mt-3 grid grid-cols-2 gap-3 md:grid-cols-4">
        <Input aria-label="Filter city" placeholder="City (exact)" value={city} onChange={(e) => setCity(e.target.value)} className="h-9 rounded-md border-border-strong bg-surface" />
        <Input aria-label="Filter country" placeholder="Country (exact)" value={country} onChange={(e) => setCountry(e.target.value)} className="h-9 rounded-md border-border-strong bg-surface" />
        <Input aria-label="Filter name pattern" placeholder="Name LIKE pattern" value={nameLike} onChange={(e) => setNameLike(e.target.value)} className="h-9 rounded-md border-border-strong bg-surface" />
        <Input aria-label="Filter category" placeholder="Category (exact)" value={category} onChange={(e) => setCategory(e.target.value)} className="h-9 rounded-md border-border-strong bg-surface" />
      </div>
      <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-center">
        <Input aria-label="Type DELETE to confirm" placeholder='Type "DELETE" to arm' value={typed} onChange={(e) => setTyped(e.target.value)} className="h-9 rounded-md border-border-strong bg-surface sm:max-w-[200px]" />
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

function PlacesTab() {
  const utils = trpc.useUtils();
  // r19-portal (6D): ONE smart search box (name/city/country, 350ms live
  // debounce, Enter submits immediately) + category/verdict dropdowns.
  const [q, setQ] = useState('');
  const [debouncedQ, setDebouncedQ] = useState('');
  const [category, setCategory] = useState('all');
  const [verdict, setVerdict] = useState<'all' | Verdict>('all');
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [editingId, setEditingId] = useState<number | null>(null);
  const [adding, setAdding] = useState(false);
  const [confirmBulk, setConfirmBulk] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => setDebouncedQ(q.trim()), 350);
    return () => clearTimeout(t);
  }, [q]);

  const filters = {
    q: debouncedQ || undefined,
    category: category === 'all' ? undefined : category,
    verdict: verdict === 'all' ? undefined : verdict,
  };
  const filterKey = JSON.stringify(filters);
  useEffect(() => {
    setPage(1);
    setSelected(new Set());
  }, [filterKey]);

  const statsQ = trpc.portal.places.stats.useQuery();
  const searchQ = trpc.portal.places.search.useQuery({ ...filters, page, pageSize: PAGE_SIZE });

  const bulkDelete = trpc.portal.places.bulkDelete.useMutation({
    onSuccess: (res) => {
      void utils.portal.places.invalidate();
      void utils.portal.stats.invalidate();
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
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
        <span className="type-small inline-flex items-center gap-1.5 font-semibold text-ink">
          <Database className="h-4 w-4 text-brand" strokeWidth={1.75} />
          {(statsQ.data?.total ?? 0).toLocaleString()} places
        </span>
        {statsQ.data && (
          <span className="type-caption text-ink-3">
            Top categories:{' '}
            {statsQ.data.byCategory.slice(0, 5).map((c) => `${c.category} ${c.count.toLocaleString()}`).join(' · ')}
          </span>
        )}
      </div>

      <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
        <div className="relative w-full lg:max-w-[360px]">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-3" strokeWidth={1.75} />
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') setDebouncedQ(q.trim()); // Enter submits immediately
            }}
            placeholder="Search name, city or country…"
            aria-label="Search places"
            className="h-10 rounded-md border-border-strong bg-surface pl-9"
          />
        </div>
        <div className="grid flex-1 grid-cols-2 gap-2">
          <Select value={category} onValueChange={setCategory}>
            <SelectTrigger aria-label="Filter by category" className="h-10 w-full rounded-md border-border-strong bg-surface"><SelectValue placeholder="Category" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All categories</SelectItem>
              {(statsQ.data?.byCategory ?? []).map((c) => (
                <SelectItem key={c.category} value={c.category}>{c.category} ({c.count.toLocaleString()})</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={verdict} onValueChange={(v) => setVerdict(v as 'all' | Verdict)}>
            <SelectTrigger aria-label="Filter by verdict" className="h-10 w-full rounded-md border-border-strong bg-surface"><SelectValue placeholder="Verdict" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Any verdict</SelectItem>
              {VERDICTS.map((v) => (
                <SelectItem key={v} value={v}>{v}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <Button type="button" onClick={() => setAdding(true)} className="btn-sheen h-10 flex-none gap-1.5 rounded-md bg-brand font-semibold text-brand-ink hover:bg-brand-strong">
          <Plus className="h-4 w-4" strokeWidth={1.75} />
          Add place
        </Button>
      </div>

      {(debouncedQ || category !== 'all' || verdict !== 'all') && (
        <p className="type-caption tnum text-ink-3" aria-live="polite">
          {searchQ.isFetching ? 'Searching…' : `${total.toLocaleString()} match${total === 1 ? '' : 'es'}`}
          {debouncedQ ? ` for “${debouncedQ}”` : ''}
        </p>
      )}

      {selected.size > 0 && (
        <div className="flex items-center justify-between rounded-xl border border-ochre/40 bg-ochre-soft px-4 py-2.5">
          <span className="type-small font-semibold text-ochre">{selected.size.toLocaleString()} selected</span>
          <div className="flex gap-2">
            <Button type="button" variant="ghost" onClick={() => setSelected(new Set())} className="h-8">Clear</Button>
            <Button type="button" onClick={() => setConfirmBulk(true)} className="h-8 gap-1.5 rounded-md bg-danger text-white hover:brightness-110">
              <Trash2 className="h-4 w-4" strokeWidth={1.75} />
              Delete selected
            </Button>
          </div>
        </div>
      )}

      <div className="overflow-hidden rounded-xl border border-border bg-surface shadow-sm">
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow className="border-border hover:bg-transparent">
                <TableHead className="w-[40px]">
                  <Checkbox aria-label="Select all on this page" checked={allChecked} onCheckedChange={toggleAll} className="border-border-strong data-[state=checked]:border-brand data-[state=checked]:bg-brand data-[state=checked]:text-brand-ink" />
                </TableHead>
                <TableHead className="type-caption text-ink-3">Name</TableHead>
                <TableHead className="type-caption text-ink-3">Category</TableHead>
                <TableHead className="type-caption text-ink-3">City</TableHead>
                <TableHead className="type-caption text-ink-3">Country</TableHead>
                <TableHead className="type-caption text-right text-ink-3">Rating</TableHead>
                <TableHead className="type-caption text-ink-3">Verdict</TableHead>
                <TableHead className="type-caption w-[40px] text-center text-ink-3" title="Has image">Img</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((p) => (
                <TableRow key={p.id} onClick={() => setEditingId(p.id)} className="cursor-pointer border-border transition-colors duration-fast hover:bg-surface-2">
                  <TableCell onClick={(e) => e.stopPropagation()}>
                    <Checkbox aria-label={`Select ${p.name}`} checked={selected.has(p.id)} onCheckedChange={() => toggleOne(p.id)} className="border-border-strong data-[state=checked]:border-brand data-[state=checked]:bg-brand data-[state=checked]:text-brand-ink" />
                  </TableCell>
                  <TableCell className="max-w-[240px]">
                    <span className="type-small block truncate font-semibold text-ink">{p.name}</span>
                    <span className="type-caption tnum text-ink-3">#{p.id}</span>
                  </TableCell>
                  <TableCell className="type-small whitespace-nowrap text-ink-2">{p.category}</TableCell>
                  <TableCell className="type-small max-w-[140px] truncate text-ink-2">{p.city}</TableCell>
                  <TableCell className="type-small max-w-[140px] truncate text-ink-2">{p.country}</TableCell>
                  <TableCell className="type-small tnum whitespace-nowrap text-right text-ink">{p.rating != null ? p.rating.toFixed(1) : '-'}</TableCell>
                  <TableCell>
                    {p.verdict ? (
                      <Badge variant="secondary" className={cn('type-caption', VERDICT_BADGE[p.verdict as Verdict] ?? 'border-transparent bg-surface-2 text-ink-2')}>{p.verdict}</Badge>
                    ) : (
                      <span className="type-caption text-ink-3">-</span>
                    )}
                  </TableCell>
                  <TableCell className="text-center">
                    <span title={p.image ? 'Has image' : 'No image'} className={cn('inline-block h-2 w-2 rounded-full', p.image ? 'bg-pine' : 'bg-border-strong')} />
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
            <Button type="button" variant="secondary" onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page <= 1 || searchQ.isFetching} aria-label="Previous page" className="h-9 rounded-md">
              <ChevronLeft className="h-4 w-4" strokeWidth={1.75} />
            </Button>
            <Button type="button" variant="secondary" onClick={() => setPage((p) => Math.min(totalPages, p + 1))} disabled={page >= totalPages || searchQ.isFetching} aria-label="Next page" className="h-9 rounded-md">
              <ChevronRight className="h-4 w-4" strokeWidth={1.75} />
            </Button>
          </div>
        </div>
      </div>

      <PlacesDangerZone />

      {editingId != null && <EditPlaceDialog id={editingId} onClose={() => setEditingId(null)} />}
      {adding && <PlaceFormDialog initial={null} onClose={() => setAdding(false)} />}

      <AlertDialog open={confirmBulk} onOpenChange={setConfirmBulk}>
        <AlertDialogContent className="rounded-xl">
          <AlertDialogHeader>
            <AlertDialogTitle className="type-h3">Delete {selected.size.toLocaleString()} selected places?</AlertDialogTitle>
            <AlertDialogDescription className="type-small text-ink-2">
              They’re removed from the atlas and from Explore for everyone. There’s no undo.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep places</AlertDialogCancel>
            <AlertDialogAction onClick={() => bulkDelete.mutate({ ids: [...selected] })} className="bg-danger text-white hover:brightness-110">
              {bulkDelete.isPending ? 'Deleting…' : 'Delete all selected'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

// ─── Images tab ──────────────────────────────────────────────────────────────

type SuggestCandidate = NonNullable<RouterOutputs['portal']['images']['suggest']['candidate']>;
type ServerWebCandidate = RouterOutputs['portal']['images']['webSearch']['candidates'][number];
type WebCandidate = WebImageHit;

/** Server-side fallback candidates arrive without creator/landingUrl; map them. */
function mapServerCandidate(c: ServerWebCandidate): WebImageHit {
  return {
    url: c.url,
    thumb: c.thumb,
    title: c.title,
    source: c.source,
    sourceLabel: c.source === 'openverse' ? 'Openverse' : 'DuckDuckGo',
    license: c.license,
    creator: null,
    landingUrl: null,
    attribution: c.attribution,
  };
}

function ImagesTab() {
  const utils = trpc.useUtils();
  const [q, setQ] = useState('');
  const [debouncedQ, setDebouncedQ] = useState('');
  const [placeId, setPlaceId] = useState<number | null>(null);
  const [url, setUrl] = useState('');
  const [attribution, setAttribution] = useState('');
  const [urlImgOk, setUrlImgOk] = useState(true);
  const [candidate, setCandidate] = useState<SuggestCandidate | null>(null);
  const [webCandidates, setWebCandidates] = useState<WebCandidate[] | null>(null);
  const [webUnavailable, setWebUnavailable] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => setDebouncedQ(q.trim()), 300);
    return () => clearTimeout(t);
  }, [q]);

  const searchQ = trpc.portal.places.search.useQuery(
    { q: debouncedQ || undefined, page: 1, pageSize: 10 },
    { enabled: debouncedQ.length > 0 },
  );
  const placeQ = trpc.portal.places.get.useQuery({ id: placeId! }, { enabled: placeId != null });
  const place = placeQ.data;

  useEffect(() => {
    setCandidate(null);
    setWebCandidates(null);
    setWebUnavailable(false);
    setUrl(place?.image ?? '');
    setAttribution(place?.photoAttribution ?? '');
    setUrlImgOk(true);
  }, [place?.id, place?.image, place?.photoAttribution]);

  const invalidate = () => {
    void utils.portal.places.invalidate();
    void utils.portal.stats.invalidate();
  };

  const setImage = trpc.portal.images.set.useMutation({
    onSuccess: () => {
      invalidate();
      setCandidate(null);
      toast.success('Image saved');
    },
    onError: (e) => toast.error(e.message),
  });
  const removeImage = trpc.portal.images.remove.useMutation({
    onSuccess: () => {
      invalidate();
      toast.success('Image removed, pool fallback restored');
    },
    onError: (e) => toast.error(e.message),
  });
  const suggest = trpc.portal.images.suggest.useMutation({
    onSuccess: (res) => {
      if (!res.candidate) toast.info('No Wikipedia photo found for this place');
      setCandidate(res.candidate ?? null);
    },
    onError: (e) => toast.error(e.message),
  });
  // r20-links: the browser searches Openverse + Wikimedia Commons directly
  // (both CORS-open; the server can't always reach them). The server endpoint
  // (Openverse -> DuckDuckGo) is the fallback when both client sources fail.
  // Clicking a candidate only fills the URL + attribution inputs; Save applies.
  const [webSearching, setWebSearching] = useState(false);
  const webSearch = trpc.portal.images.webSearch.useMutation();
  const runWebSearch = async (query: string) => {
    if (webSearching) return;
    setWebSearching(true);
    setWebUnavailable(false);
    setWebCandidates(null);
    try {
      const client = await searchWebImagesClient(query, 12);
      if (!client.unavailable) {
        setWebCandidates(client.candidates);
        if (client.candidates.length === 0) toast.info('No online images found for this place');
        return;
      }
      // Both browser-side sources blocked: try the server endpoint.
      const srv = await webSearch.mutateAsync({ query, count: 9 });
      setWebUnavailable(srv.unavailable);
      setWebCandidates(srv.candidates.map(mapServerCandidate));
      if (srv.unavailable) toast.info('Image search unavailable from this server');
      else if (srv.candidates.length === 0) toast.info('No online images found for this place');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Image search failed');
    } finally {
      setWebSearching(false);
    }
  };

  return (
    <div className="grid gap-6 lg:grid-cols-[320px_1fr]">
      {/* Place picker */}
      <div className="space-y-3">
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-3" strokeWidth={1.75} />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search a place…" aria-label="Search a place" className="h-10 rounded-md border-border-strong bg-surface pl-9" />
        </div>
        <div className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-surface shadow-sm">
          {(searchQ.data?.places ?? []).map((p) => (
            <button
              key={p.id}
              type="button"
              onClick={() => setPlaceId(p.id)}
              className={cn(
                'flex w-full items-center justify-between gap-2 px-3 py-2.5 text-left transition-colors duration-fast hover:bg-surface-2',
                placeId === p.id && 'bg-brand-soft',
              )}
            >
              <span className="min-w-0">
                <span className="type-small block truncate font-semibold text-ink">{p.name}</span>
                <span className="type-caption block truncate text-ink-3">{p.city}, {p.country}</span>
              </span>
              <span className={cn('inline-block h-2 w-2 flex-none rounded-full', p.image ? 'bg-pine' : 'bg-border-strong')} title={p.image ? 'Has image' : 'No image'} />
            </button>
          ))}
          {debouncedQ.length > 0 && !searchQ.isLoading && (searchQ.data?.places.length ?? 0) === 0 && (
            <p className="type-small px-3 py-4 text-ink-3">No matches.</p>
          )}
          {debouncedQ.length === 0 && <p className="type-small px-3 py-4 text-ink-3">Type to search the atlas.</p>}
        </div>
      </div>

      {/* Editor */}
      <div className="space-y-4">
        {!place && <p className="type-small rounded-xl border border-dashed border-border bg-surface px-4 py-8 text-center text-ink-3">Pick a place on the left to manage its photo.</p>}
        {place && (
          <>
            <section className="rounded-xl border border-border bg-surface p-4 shadow-sm">
              <h3 className="type-small font-semibold text-ink">
                {place.name} <span className="type-caption font-normal text-ink-3">#{place.id} · {place.city}, {place.country}</span>
              </h3>
              <p className="type-caption mt-0.5 text-ink-3">
                Current source: {place.photoSource ?? 'none (stock pool fallback)'}
                {place.photoAttribution ? ` · ${place.photoAttribution}` : ''}
              </p>
              {place.image ? (
                <img src={place.image} alt={place.name} className="mt-3 h-44 w-full rounded-md border border-border object-cover" />
              ) : (
                <div className="mt-3 flex h-24 items-center justify-center rounded-md border border-dashed border-border bg-surface-2">
                  <span className="type-caption text-ink-3">No photo, visitors see a stock image</span>
                </div>
              )}

              <div className="mt-4 space-y-3">
                <div className="space-y-1.5">
                  <Label htmlFor="img-url" className="type-small text-ink-2">Set image URL</Label>
                  <Input
                    id="img-url"
                    maxLength={500}
                    placeholder="https://…"
                    value={url}
                    onChange={(e) => {
                      setUrl(e.target.value);
                      setUrlImgOk(true);
                    }}
                    className="h-10 rounded-md border-border-strong bg-surface"
                  />
                </div>
                {url.trim() && urlImgOk && (
                  <img key={url.trim()} src={url.trim()} alt="Preview" onError={() => setUrlImgOk(false)} className="h-36 w-full rounded-md border border-border object-cover" />
                )}
                <div className="space-y-1.5">
                  <Label htmlFor="img-attribution" className="type-small text-ink-2">Attribution (optional)</Label>
                  <Input id="img-attribution" maxLength={255} placeholder="© Jane Doe, CC BY-SA 4.0" value={attribution} onChange={(e) => setAttribution(e.target.value)} className="h-10 rounded-md border-border-strong bg-surface" />
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button
                    type="button"
                    disabled={!url.trim() || setImage.isPending}
                    onClick={() => placeId != null && setImage.mutate({ placeId, url: url.trim(), attribution: attribution.trim() || undefined })}
                    className="btn-sheen h-9 rounded-md bg-brand font-semibold text-brand-ink hover:bg-brand-strong"
                  >
                    {setImage.isPending ? 'Saving…' : 'Save image'}
                  </Button>
                  <Button
                    type="button"
                    variant="secondary"
                    disabled={suggest.isPending}
                    onClick={() => placeId != null && suggest.mutate({ placeId })}
                    className="h-9 gap-1.5 rounded-md"
                  >
                    {suggest.isPending ? <Loader2 className="h-4 w-4 animate-spin" strokeWidth={1.75} /> : <Search className="h-4 w-4" strokeWidth={1.75} />}
                    Find on Wikipedia
                  </Button>
                  <Button
                    type="button"
                    variant="secondary"
                    disabled={webSearching}
                    onClick={() => place && void runWebSearch(`${place.name} ${place.city}`.trim())}
                    className="h-9 gap-1.5 rounded-md"
                  >
                    {webSearching ? <Loader2 className="h-4 w-4 animate-spin" strokeWidth={1.75} /> : <Globe className="h-4 w-4" strokeWidth={1.75} />}
                    Find online
                  </Button>
                  {place.image && (
                    <Button
                      type="button"
                      variant="ghost"
                      disabled={removeImage.isPending}
                      onClick={() => placeId != null && removeImage.mutate({ placeId })}
                      className="h-9 gap-1.5 text-danger hover:bg-danger/10 hover:text-danger"
                    >
                      <Trash2 className="h-4 w-4" strokeWidth={1.75} />
                      Remove image
                    </Button>
                  )}
                </div>
              </div>
            </section>

            {candidate && (
              <section className="rounded-xl border border-ochre/40 bg-ochre-soft p-4 shadow-sm">
                <h4 className="type-small font-semibold text-ochre">Wikipedia suggestion, “{candidate.title}”</h4>
                <p className="type-caption mt-0.5 text-ink-3">{candidate.attribution} · via {candidate.source}</p>
                <img src={candidate.image} alt={candidate.title} className="mt-3 h-44 w-full rounded-md border border-border object-cover" />
                <div className="mt-3 flex gap-2">
                  <Button
                    type="button"
                    disabled={setImage.isPending}
                    onClick={() => placeId != null && setImage.mutate({ placeId, url: candidate.image, attribution: candidate.attribution })}
                    className="btn-sheen h-9 rounded-md bg-brand font-semibold text-brand-ink hover:bg-brand-strong"
                  >
                    Use this photo
                  </Button>
                  <Button type="button" variant="ghost" onClick={() => setCandidate(null)} className="h-9">Dismiss</Button>
                </div>
              </section>
            )}

            {(webSearching || webUnavailable || webCandidates !== null) && (
              <section className="rounded-xl border border-border bg-surface p-4 shadow-sm">
                <h4 className="type-small font-semibold text-ink">Online image search</h4>
                {webSearching && (
                  <p className="type-small mt-3 inline-flex items-center gap-2 text-ink-3">
                    <Loader2 className="h-4 w-4 animate-spin" strokeWidth={1.75} />
                    Searching Openverse and Wikimedia Commons…
                  </p>
                )}
                {!webSearching && webUnavailable && (
                  <p className="type-small mt-3 text-ink-3">
                    Image search unavailable right now. Try “Find on Wikipedia” or paste an image URL directly.
                  </p>
                )}
                {!webSearching && !webUnavailable && webCandidates !== null && webCandidates.length === 0 && (
                  <p className="type-small mt-3 text-ink-3">No online images found. Try “Find on Wikipedia” instead.</p>
                )}
                {!webSearching && !webUnavailable && webCandidates !== null && webCandidates.length > 0 && (
                  <>
                    <p className="type-caption mt-0.5 text-ink-3">Click a photo to fill the URL + attribution above, then Save.</p>
                    <div className="mt-3 grid grid-cols-3 gap-2">
                      {webCandidates.map((c) => (
                        <button
                          key={c.url}
                          type="button"
                          title={`${c.title || c.url} · ${c.attribution}${c.landingUrl ? ` · ${c.landingUrl}` : ''}`}
                          onClick={() => {
                            setUrl(c.url);
                            setAttribution(c.attribution);
                            setUrlImgOk(true);
                            toast.info('Image URL filled, press Save image to apply');
                          }}
                          className="group relative aspect-[4/3] overflow-hidden rounded-md border border-border bg-surface-2 transition-colors duration-fast hover:border-brand"
                        >
                          <img src={c.thumb} alt={c.title || 'Candidate'} loading="lazy" className="h-full w-full object-cover" />
                          <span className="absolute bottom-1 left-1 right-1 flex flex-col items-start gap-0.5">
                            <span
                              className={cn(
                                'type-caption rounded px-1.5 py-0.5 text-white',
                                c.source === 'openverse' ? 'bg-pine/90' : c.source === 'wikimedia' ? 'bg-ochre/90' : 'bg-ink/80',
                              )}
                            >
                              {c.sourceLabel}
                              {c.license ? ` · ${c.license}` : ''}
                            </span>
                            {c.creator ? (
                              <span className="type-caption max-w-full truncate rounded bg-ink/70 px-1.5 py-0.5 text-white">
                                {c.creator}
                              </span>
                            ) : null}
                          </span>
                        </button>
                      ))}
                    </div>
                  </>
                )}
              </section>
            )}
          </>
        )}
      </div>
    </div>
  );
}

// ─── Dishes tab ──────────────────────────────────────────────────────────────

function DishEditor({ dish, onClose }: { dish: DishWithPlaces; onClose: () => void }) {
  const utils = trpc.useUtils();
  const [name, setName] = useState(dish.dish);
  const [blurb, setBlurb] = useState(dish.blurb ?? '');
  const [position, setPosition] = useState(String(dish.position));
  const [confirmDelete, setConfirmDelete] = useState(false);

  const invalidate = () => void utils.portal.dishes.invalidate();

  const update = trpc.portal.dishes.updateDish.useMutation({
    onSuccess: () => {
      invalidate();
      toast.success('Dish updated');
      onClose();
    },
    onError: (e) => toast.error(e.message),
  });
  const remove = trpc.portal.dishes.deleteDish.useMutation({
    onSuccess: () => {
      invalidate();
      toast.success('Dish deleted');
      onClose();
    },
    onError: (e) => toast.error(e.message),
  });

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="rounded-xl sm:max-w-[480px]">
        <DialogHeader>
          <DialogTitle className="type-h3">Edit “{dish.dish}”</DialogTitle>
          <DialogDescription className="type-small text-ink-2">{dish.city}, {dish.country}</DialogDescription>
        </DialogHeader>
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            const pos = parseNumber(position);
            if (pos !== undefined && (Number.isNaN(pos) || pos < 0)) {
              toast.error('Position must be a non-negative number');
              return;
            }
            update.mutate({ id: dish.id, dish: name.trim() || undefined, blurb: blurb.trim() || null, position: pos });
          }}
        >
          <div className="space-y-1.5">
            <Label htmlFor="dish-name" className="type-small text-ink-2">Dish name</Label>
            <Input id="dish-name" maxLength={128} value={name} onChange={(e) => setName(e.target.value)} className="h-10 rounded-md border-border-strong bg-surface" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="dish-blurb" className="type-small text-ink-2">Blurb</Label>
            <textarea
              id="dish-blurb"
              rows={4}
              value={blurb}
              onChange={(e) => setBlurb(e.target.value)}
              className="type-small w-full rounded-md border border-border-strong bg-surface px-3 py-2 text-ink outline-none focus:border-brand"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="dish-position" className="type-small text-ink-2">Position</Label>
            <Input id="dish-position" inputMode="numeric" value={position} onChange={(e) => setPosition(e.target.value)} className="h-10 w-28 rounded-md border-border-strong bg-surface" />
          </div>
          <DialogFooter className="gap-2">
            <Button type="button" variant="ghost" onClick={() => setConfirmDelete(true)} className="mr-auto text-danger hover:bg-danger/10 hover:text-danger">
              <Trash2 className="h-4 w-4" strokeWidth={1.75} />
              Delete
            </Button>
            <Button type="button" variant="ghost" onClick={onClose}>Cancel</Button>
            <Button type="submit" disabled={update.isPending}>{update.isPending ? 'Saving…' : 'Save changes'}</Button>
          </DialogFooter>
        </form>
        <AlertDialog open={confirmDelete} onOpenChange={setConfirmDelete}>
          <AlertDialogContent className="rounded-xl">
            <AlertDialogHeader>
              <AlertDialogTitle className="type-h3">Delete “{dish.dish}”?</AlertDialogTitle>
              <AlertDialogDescription className="type-small text-ink-2">
                The dish and its {dish.places.length} mapped place{dish.places.length === 1 ? '' : 's'} are removed. There’s no undo.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Keep dish</AlertDialogCancel>
              <AlertDialogAction onClick={() => remove.mutate({ id: dish.id })} className="bg-danger text-white hover:brightness-110">
                {remove.isPending ? 'Deleting…' : 'Delete dish'}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </DialogContent>
    </Dialog>
  );
}

function DishPlaceRow({ place }: { place: DishWithPlaces['places'][number] }) {
  const utils = trpc.useUtils();
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(place.name);
  const [why, setWhy] = useState(place.why ?? '');
  const [position, setPosition] = useState(String(place.position));

  const invalidate = () => void utils.portal.dishes.invalidate();
  const update = trpc.portal.dishes.updateDishPlace.useMutation({
    onSuccess: () => {
      invalidate();
      setEditing(false);
      toast.success('Place updated');
    },
    onError: (e) => toast.error(e.message),
  });
  const remove = trpc.portal.dishes.deleteDishPlace.useMutation({
    onSuccess: () => {
      invalidate();
      toast.success('Place removed from dish');
    },
    onError: (e) => toast.error(e.message),
  });

  if (!editing) {
    return (
      <li className="flex items-start justify-between gap-2 px-3 py-2">
        <span className="min-w-0">
          <span className="type-small block truncate font-semibold text-ink">{place.name}</span>
          {place.why && <span className="type-caption block truncate text-ink-3">{place.why}</span>}
        </span>
        <span className="flex flex-none items-center gap-1">
          <span className="type-caption tnum text-ink-3">#{place.position}</span>
          <Button type="button" variant="ghost" onClick={() => setEditing(true)} className="h-7 px-2 type-caption">Edit</Button>
          <Button type="button" variant="ghost" onClick={() => remove.mutate({ id: place.id })} disabled={remove.isPending} aria-label={`Remove ${place.name}`} className="h-7 px-2 text-danger hover:bg-danger/10 hover:text-danger">
            <Trash2 className="h-3.5 w-3.5" strokeWidth={1.75} />
          </Button>
        </span>
      </li>
    );
  }
  return (
    <li className="space-y-2 bg-surface-2 px-3 py-2">
      <Input aria-label="Place name" maxLength={191} value={name} onChange={(e) => setName(e.target.value)} className="h-9 rounded-md border-border-strong bg-surface" />
      <Input aria-label="Why this place" maxLength={255} placeholder="Why this place (optional)" value={why} onChange={(e) => setWhy(e.target.value)} className="h-9 rounded-md border-border-strong bg-surface" />
      <div className="flex items-center gap-2">
        <Input aria-label="Position" inputMode="numeric" value={position} onChange={(e) => setPosition(e.target.value)} className="h-9 w-24 rounded-md border-border-strong bg-surface" />
        <Button
          type="button"
          disabled={update.isPending}
          onClick={() => {
            const pos = parseNumber(position);
            if (pos !== undefined && (Number.isNaN(pos) || pos < 0)) {
              toast.error('Position must be a non-negative number');
              return;
            }
            update.mutate({ id: place.id, name: name.trim() || undefined, why: why.trim() || null, position: pos });
          }}
          className="h-9 rounded-md bg-brand font-semibold text-brand-ink hover:bg-brand-strong"
        >
          Save
        </Button>
        <Button type="button" variant="ghost" onClick={() => setEditing(false)} className="h-9">Cancel</Button>
      </div>
    </li>
  );
}

function DishesTab() {
  const citiesQ = trpc.portal.dishes.cities.useQuery();
  const [selected, setSelected] = useState<{ city: string; country: string } | null>(null);
  const [editingDish, setEditingDish] = useState<DishWithPlaces | null>(null);

  const listQ = trpc.portal.dishes.list.useQuery(
    { city: selected?.city ?? '', country: selected?.country },
    { enabled: selected != null },
  );

  const selectValue = selected ? `${selected.country}::${selected.city}` : '';
  const dishes = listQ.data ?? [];

  return (
    <div className="space-y-4">
      <div className="max-w-[360px]">
        <Select
          value={selectValue}
          onValueChange={(v) => {
            const [country, city] = v.split('::');
            setSelected(city ? { city, country: country ?? '' } : null);
          }}
        >
          <SelectTrigger aria-label="Pick a city" className="h-10 w-full rounded-md border-border-strong bg-surface">
            <SelectValue placeholder="Pick a city…" />
          </SelectTrigger>
          <SelectContent>
            {(citiesQ.data ?? []).map((c) => (
              <SelectItem key={`${c.country}::${c.city}`} value={`${c.country}::${c.city}`}>
                {c.city}, {c.country}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {!selected && <p className="type-small rounded-xl border border-dashed border-border bg-surface px-4 py-8 text-center text-ink-3">Choose a city to edit its signature dishes.</p>}
      {selected && listQ.isLoading && <p className="type-small text-ink-3">Loading dishes…</p>}
      {selected && !listQ.isLoading && dishes.length === 0 && (
        <p className="type-small text-ink-3">No signature dishes for {selected.city}.</p>
      )}
      <div className="grid gap-4 md:grid-cols-2">
        {dishes.map((d) => (
          <section key={d.id} className="rounded-xl border border-border bg-surface p-4 shadow-sm">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <h3 className="type-small font-semibold text-ink">
                  <span className="type-caption tnum mr-1.5 text-ink-3">{d.position}.</span>
                  {d.dish}
                </h3>
                {d.blurb && <p className="type-caption mt-1 line-clamp-3 text-ink-2">{d.blurb}</p>}
              </div>
              <Button type="button" variant="ghost" onClick={() => setEditingDish(d)} className="h-8 flex-none px-2 type-caption">Edit</Button>
            </div>
            <ul className="mt-3 divide-y divide-border rounded-md border border-border">
              {d.places.map((p) => (
                <DishPlaceRow key={p.id} place={p} />
              ))}
              {d.places.length === 0 && <li className="type-caption px-3 py-2 text-ink-3">No mapped places.</li>}
            </ul>
          </section>
        ))}
      </div>

      {editingDish && <DishEditor dish={editingDish} onClose={() => setEditingDish(null)} />}
    </div>
  );
}

// ─── State B: the console ────────────────────────────────────────────────────

function PortalConsole({ onLogout }: { onLogout: () => void }) {
  const statsQ = trpc.portal.stats.useQuery();
  const logout = trpc.portal.logout.useMutation({ onSuccess: onLogout });

  const stats = statsQ.data;
  const chips: { label: string; value: number | undefined }[] = [
    { label: 'places', value: stats?.places },
    { label: 'with photo', value: stats?.placesWithImage },
    { label: 'famous eateries', value: stats?.famousEateries },
    { label: 'signature dishes', value: stats?.signatureDishes },
    { label: 'countries', value: stats?.countries },
    { label: 'cities', value: stats?.cities },
  ];

  return (
    <div className="min-h-screen bg-bg">
      <div className="mx-auto w-full max-w-[1120px] px-4 py-8 md:px-6 md:py-10">
        <header className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="type-caption uppercase tracking-wide text-ink-3">Wayfare</p>
            <h1 className="type-h2 text-ink">Owner console</h1>
          </div>
          <Button
            type="button"
            variant="secondary"
            onClick={() => logout.mutate()}
            disabled={logout.isPending}
            className="h-9 gap-1.5 rounded-md"
          >
            <LogOut className="h-4 w-4" strokeWidth={1.75} />
            Log out
          </Button>
        </header>

        <div className="mt-4 flex flex-wrap gap-x-4 gap-y-1">
          {chips.map((c) => (
            <span key={c.label} className="type-caption text-ink-3">
              <span className="type-small tnum font-semibold text-ink">{(c.value ?? 0).toLocaleString()}</span> {c.label}
            </span>
          ))}
        </div>

        <Tabs defaultValue="places" className="mt-6">
          <TabsList className="rounded-pill">
            <TabsTrigger value="places" className="gap-1.5 rounded-pill">
              <MapPin className="h-4 w-4" strokeWidth={1.75} />
              Places
            </TabsTrigger>
            <TabsTrigger value="images" className="gap-1.5 rounded-pill">
              <ImageIcon className="h-4 w-4" strokeWidth={1.75} />
              Images
            </TabsTrigger>
            <TabsTrigger value="dishes" className="gap-1.5 rounded-pill">
              <UtensilsCrossed className="h-4 w-4" strokeWidth={1.75} />
              Dishes
            </TabsTrigger>
          </TabsList>
          <TabsContent value="places" className="mt-4"><PlacesTab /></TabsContent>
          <TabsContent value="images" className="mt-4"><ImagesTab /></TabsContent>
          <TabsContent value="dishes" className="mt-4"><DishesTab /></TabsContent>
        </Tabs>
      </div>
      <Toaster />
    </div>
  );
}

// ─── page ────────────────────────────────────────────────────────────────────

export default function OwnerPortal() {
  const { pathSecret = '' } = useParams();
  const [loggedIn, setLoggedIn] = useState(false);
  // Validate the URL secret BEFORE rendering anything portal-shaped: a wrong
  // path shows the plain 404, indistinguishable from a missing route.
  const pathQ = trpc.portal.checkPath.useQuery({ pathSecret }, { retry: false });
  const pathOk = pathQ.data?.ok === true;
  const sessionQ = trpc.portal.session.useQuery(undefined, {
    retry: false,
    enabled: pathOk,
  });

  const authed = loggedIn || sessionQ.data?.ok === true;

  if (pathQ.isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-bg">
        <Loader2 className="h-5 w-5 animate-spin text-ink-3" strokeWidth={1.75} />
      </div>
    );
  }
  if (!pathOk) {
    return <PortalNotFound />;
  }
  if (sessionQ.isLoading && !loggedIn) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-bg">
        <Loader2 className="h-5 w-5 animate-spin text-ink-3" strokeWidth={1.75} />
      </div>
    );
  }
  if (!authed) {
    return (
      <>
        <LoginGate pathSecret={pathSecret} onSuccess={() => setLoggedIn(true)} />
        <Toaster />
      </>
    );
  }
  return (
    <PortalConsole
      onLogout={() => {
        setLoggedIn(false);
        void sessionQ.refetch();
      }}
    />
  );
}
