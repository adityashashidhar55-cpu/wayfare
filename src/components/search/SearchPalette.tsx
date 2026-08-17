/**
 * Global search palette (⌘K) - one debounced backend round-trip
 * (explore.globalSearch) renders four sections: Your trips, Cities (corpus
 * + any geocodable city worldwide via Photon), Places (corpus, opens the
 * shared PlaceDetailDialog), and - on an empty query - Recent searches +
 * Actions (road trip / AI builder / world directory / get the app).
 *
 * Keyboard: ↑↓/enter come from cmdk, esc comes from the Dialog. Selection
 * closes the palette before navigating; recents live in localStorage (6 max).
 */
import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import { Command as CommandPrimitive } from 'cmdk';
import type { inferRouterOutputs } from '@trpc/server';
import {
  ArrowRight,
  Building2,
  CalendarRange,
  Clock,
  Compass,
  Globe2,
  Import,
  LayoutGrid,
  Loader2,
  MapPin,
  Route,
  Search,
  Sparkles,
  Star,
  Smartphone,
  UtensilsCrossed,
  X,
} from 'lucide-react';
import type { AppRouter } from '../../../api/router';
import { trpc } from '@/providers/trpc';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Skeleton } from '@/components/ui/skeleton';
// r21-perf: lazy so the detail dialog (and its maplibre CSS chain via
// PlaceCard -> lib/map) stays out of the eager AppShell/entry chunk.
const PlaceDetailDialog = lazy(() => import('@/components/explore/PlaceDetailDialog'));
import { AiTripBuilderModal } from '@/components/trips/AiTripBuilder';
import { RoadtripBuilderModal } from '@/components/trips/RoadtripBuilder';
// r19-social; r21-perf: lazy so maplibre stays out of the AppShell chunk
const SocialImportModal = lazy(() =>
  import('@/components/trips/SocialImportModal').then((m) => ({ default: m.SocialImportModal })),
);
import { ToastHost, toast } from '@/components/explore/toast';
import type { ExplorePlaceItem } from '@/components/explore/explore-utils';
import { cn } from '@/lib/utils';

type RouterOutputs = inferRouterOutputs<AppRouter>;
type GlobalSearchData = RouterOutputs['explore']['globalSearch'];
type GlobalTrip = GlobalSearchData['trips'][number];
type GlobalCity = GlobalSearchData['cities'][number];
type GlobalPhotonCity = GlobalSearchData['photonCities'][number];
type GlobalPlace = GlobalSearchData['places'][number];

// ── recent searches (localStorage, 6 max) ───────────────────────────────────
const RECENTS_KEY = 'wayfare.search.recents.v1';
const MAX_RECENTS = 6;

interface RecentEntry {
  kind: 'trip' | 'city' | 'place' | 'action';
  label: string;
  sub?: string;
  /** direct navigation target; absent → re-run the search for `label` */
  to?: string;
}

function loadRecents(): RecentEntry[] {
  try {
    const raw = localStorage.getItem(RECENTS_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter(
        (e): e is RecentEntry =>
          typeof e === 'object' &&
          e != null &&
          typeof (e as RecentEntry).label === 'string' &&
          typeof (e as RecentEntry).kind === 'string',
      )
      .slice(0, MAX_RECENTS);
  } catch {
    return [];
  }
}

function persistRecents(list: RecentEntry[]) {
  try {
    localStorage.setItem(RECENTS_KEY, JSON.stringify(list.slice(0, MAX_RECENTS)));
  } catch {
    // storage unavailable (private mode), recents just don't persist
  }
}

/** Fold diacritics/case so corpus and Photon city names dedupe cleanly. */
function foldName(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLowerCase();
}

/** Corpus place row → the scored shape PlaceDetailDialog expects. */
function toExploreItem(p: GlobalPlace): ExplorePlaceItem {
  return { ...p, matchScore: 0, matchStyles: [], aboveBudget: false };
}

/** Small "OpenStreetMap" provenance badge for worldwide (non-corpus) cities. */
function OsmBadge() {
  return (
    <span
      className="type-caption inline-flex shrink-0 items-center rounded-sm bg-surface-2 px-1.5 py-0.5 font-semibold uppercase tracking-[0.06em] text-ink-3"
      title="Found via OpenStreetMap"
    >
      OSM
    </span>
  );
}

function HintKey({ children }: { children: React.ReactNode }) {
  return (
    <kbd className="rounded-sm bg-surface-2 px-1.5 py-0.5 text-[10px] font-semibold text-ink-3">{children}</kbd>
  );
}

interface PaletteItemProps {
  value: string;
  onSelect: () => void;
  children: React.ReactNode;
  className?: string;
}

/** One selectable row - brand-soft highlight, matching the app's hover idiom. */
function PaletteItem({ value, onSelect, children, className }: PaletteItemProps) {
  return (
    <CommandPrimitive.Item
      value={value}
      onSelect={onSelect}
      className={cn(
        'flex w-full cursor-pointer select-none items-center gap-3 rounded-md px-3 py-2.5 text-left outline-none',
        'data-[selected=true]:bg-brand-soft/60 data-[selected=true]:text-ink',
        className,
      )}
    >
      {children}
    </CommandPrimitive.Item>
  );
}

function ItemIcon({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <span
      className={cn(
        'flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-surface-2 text-ink-3',
        className,
      )}
    >
      {children}
    </span>
  );
}

function GroupHeading({ children }: { children: React.ReactNode }) {
  return <p className="type-eyebrow px-3 pb-1 pt-3 text-ink-3">{children}</p>;
}

type ActionId = 'roadtrip' | 'ai' | 'social' | 'directory' | 'getapp';

const ACTIONS: { id: ActionId; label: string; sub: string; icon: typeof Route; to?: string }[] = [
  { id: 'roadtrip', label: 'Plan a road trip', sub: 'Multi-city route, day by day', icon: Route },
  { id: 'ai', label: 'AI trip builder', sub: 'Describe it, get a draft itinerary', icon: Sparkles },
  // r19-social
  { id: 'social', label: 'Import from social', sub: 'TikTok / Instagram caption → places on a map', icon: Import },
  { id: 'directory', label: 'Browse world directory', sub: 'Every city in the corpus', icon: Compass, to: '/explore' },
  { id: 'getapp', label: 'Get the app', sub: 'Wayfare on your phone', icon: Smartphone, to: '/get-app' },
];

export interface SearchPaletteProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export default function SearchPalette({ open, onOpenChange }: SearchPaletteProps) {
  const navigate = useNavigate();
  const utils = trpc.useUtils();
  const [input, setInput] = useState('');
  const [query, setQuery] = useState('');
  const [recents, setRecents] = useState<RecentEntry[]>([]);
  const [detail, setDetail] = useState<ExplorePlaceItem | null>(null);
  const [aiOpen, setAiOpen] = useState(false);
  const [roadtripOpen, setRoadtripOpen] = useState(false);
  const [socialOpen, setSocialOpen] = useState(false); // r19-social
  const debounceRef = useRef<number | undefined>(undefined);

  // Load recents fresh every time the palette opens; reset the search box.
  useEffect(() => {
    if (open) {
      setRecents(loadRecents());
      setInput('');
      setQuery('');
    }
    return () => window.clearTimeout(debounceRef.current);
  }, [open]);

  const pushRecent = useCallback((entry: RecentEntry) => {
    setRecents((prev) => {
      const next = [entry, ...prev.filter((e) => !(e.label === entry.label && e.to === entry.to))].slice(
        0,
        MAX_RECENTS,
      );
      persistRecents(next);
      return next;
    });
  }, []);

  /* ── debounce (250ms) input → query ─────────────────────────────────────── */
  const onInputChange = (v: string) => {
    setInput(v);
    window.clearTimeout(debounceRef.current);
    const q = v.trim();
    if (q.length < 2) {
      setQuery('');
      return;
    }
    debounceRef.current = window.setTimeout(() => setQuery(q), 250);
  };

  // Sections follow the *input* immediately; the fetch follows the debounced
  // query. `awaiting` is the ≤250ms window between the two - never show the
  // recents/actions or the empty state in that gap.
  const trimmedInput = input.trim();
  const activeQuery = query.trim();
  const searching = trimmedInput.length >= 2;
  const awaiting = searching && activeQuery !== trimmedInput;
  const searchQ = trpc.explore.globalSearch.useQuery(
    { query: activeQuery },
    {
      enabled: activeQuery.length >= 2,
      placeholderData: (prev) => prev,
      staleTime: 30_000,
      retry: false,
    },
  );
  const data = searchQ.data;
  const trips = searching ? (data?.trips ?? []) : [];
  const cities = searching ? (data?.cities ?? []) : [];
  const places = searching ? (data?.places ?? []) : [];
  const corpusCityNames = new Set(cities.map((c) => foldName(c.city)));
  const photonCities = searching
    ? (data?.photonCities ?? []).filter((c) => !corpusCityNames.has(foldName(c.name)))
    : [];
  const hasResults = trips.length + cities.length + photonCities.length + places.length > 0;
  // First load (or first keystrokes of a brand-new box) shows a skeleton;
  // with placeholderData, later keystrokes keep old rows on screen instead.
  const showSkeleton = searching && ((awaiting && !data) || searchQ.isLoading);
  const showEmpty = searching && !awaiting && !showSkeleton && !hasResults;

  /* cmdk does not auto-select anything when items arrive asynchronously -
     control the selection so ↵ always lands on the top result, and keep it
     pinned to the first row whenever the visible list changes. */
  const firstValue = searching
    ? showSkeleton
      ? ''
      : trips.length > 0
        ? `trip:${trips[0]!.id}`
        : cities.length > 0
          ? `city:${cities[0]!.city}:${cities[0]!.country}`
          : photonCities.length > 0
            ? `pcity:${photonCities[0]!.name}:${photonCities[0]!.country}`
            : places.length > 0
              ? `place:${places[0]!.id}`
              : showEmpty
                ? `builder:${trimmedInput}`
                : ''
    : recents.length > 0
      ? `recent:${recents[0]!.kind}:${recents[0]!.label}:${recents[0]!.to ?? ''}`
      : 'action:roadtrip';
  const [selectedValue, setSelectedValue] = useState('');
  useEffect(() => {
    if (firstValue) setSelectedValue(firstValue);
  }, [firstValue]);

  const close = useCallback(() => onOpenChange(false), [onOpenChange]);

  // ── selection handlers ────────────────────────────────────────────────────
  const goTrip = (t: GlobalTrip) => {
    pushRecent({ kind: 'trip', label: t.title, sub: t.destination, to: `/trips/${t.id}` });
    close();
    navigate(`/trips/${t.id}`);
  };

  const goCity = (name: string, sub: string) => {
    const to = `/city/${encodeURIComponent(name)}`;
    pushRecent({ kind: 'city', label: name, sub, to });
    close();
    navigate(to);
  };

  const openPlace = (p: GlobalPlace) => {
    pushRecent({ kind: 'place', label: p.name, sub: `${p.city}, ${p.country}` });
    close();
    setDetail(toExploreItem(p));
  };

  const runAction = (id: ActionId) => {
    const action = ACTIONS.find((a) => a.id === id)!;
    pushRecent({ kind: 'action', label: action.label, sub: action.sub, to: action.to });
    close();
    if (id === 'roadtrip') setRoadtripOpen(true);
    else if (id === 'ai') setAiOpen(true);
    else if (id === 'social') setSocialOpen(true);
    else if (action.to) navigate(action.to);
  };

  const runRecent = (r: RecentEntry) => {
    if (r.to) {
      close();
      navigate(r.to);
      return;
    }
    // No direct target - re-run the search that produced it.
    setInput(r.label);
    setQuery(r.label.trim());
  };

  const clearRecents = () => {
    persistRecents([]);
    setRecents([]);
  };

  // ── place detail save-toggle (same bucket-list wiring as Explore) ────────
  const bucketQ = trpc.explore.bucketList.useQuery(undefined, { enabled: open || detail != null });
  const addBucket = trpc.explore.addBucket.useMutation({
    onSuccess: () => void utils.explore.bucketList.invalidate(),
    onError: () => toast('Could not save, please try again.', { kind: 'warn' }),
  });
  const removeBucket = trpc.explore.removeBucket.useMutation({
    onSuccess: () => void utils.explore.bucketList.invalidate(),
    onError: () => toast('Could not remove, please try again.', { kind: 'warn' }),
  });
  const savedItem = (p: ExplorePlaceItem) =>
    (bucketQ.data ?? []).find((b) => b.name === p.name && b.country?.includes(p.country));
  const toggleSave = (place: ExplorePlaceItem) => {
    const existing = savedItem(place);
    if (existing) {
      removeBucket.mutate({ id: existing.id });
      toast('Removed from bucket list', { kind: 'info' });
    } else {
      addBucket.mutate({
        name: place.name,
        country: `${place.city}, ${place.country}`,
        lat: place.lat ?? undefined,
        lng: place.lng ?? undefined,
        image: place.image ?? undefined,
        note: place.description ?? undefined,
      });
      toast('Saved to bucket list', { kind: 'success' });
    }
  };

  const recentIcon = (kind: RecentEntry['kind']) => {
    switch (kind) {
      case 'trip':
        return <LayoutGrid className="h-4 w-4" strokeWidth={1.75} />;
      case 'city':
        return <MapPin className="h-4 w-4" strokeWidth={1.75} />;
      case 'place':
        return <Star className="h-4 w-4" strokeWidth={1.75} />;
      default:
        return <Sparkles className="h-4 w-4" strokeWidth={1.75} />;
    }
  };

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent
          showCloseButton={false}
          className="top-[14%] translate-y-0 gap-0 overflow-hidden rounded-xl border-border bg-surface p-0 shadow-lg sm:max-w-[560px]"
          aria-label="Search Wayfare"
        >
          <DialogHeader className="sr-only">
            <DialogTitle>Search Wayfare</DialogTitle>
            <DialogDescription>
              Search your trips, cities and places, or jump to an action.
            </DialogDescription>
          </DialogHeader>

          <CommandPrimitive
            shouldFilter={false}
            loop
            value={selectedValue}
            onValueChange={setSelectedValue}
            className="flex w-full flex-col"
          >
            {/* input row */}
            <div className="flex h-14 items-center gap-3 border-b border-border px-4">
              {searchQ.isFetching && searching ? (
                <Loader2 className="h-4 w-4 shrink-0 animate-spin text-ink-3" strokeWidth={2} />
              ) : (
                <Search className="h-4 w-4 shrink-0 text-ink-3" strokeWidth={1.75} />
              )}
              <CommandPrimitive.Input
                autoFocus
                value={input}
                onValueChange={onInputChange}
                placeholder="Search trips, cities, places…"
                aria-label="Search trips, cities, places"
                className="h-full w-full bg-transparent text-[15px] font-medium text-ink outline-none placeholder:font-normal placeholder:text-ink-3"
              />
              {input ? (
                <button
                  type="button"
                  aria-label="Clear search"
                  onClick={() => onInputChange('')}
                  className="rounded-sm p-1 text-ink-3 transition-colors duration-fast hover:bg-surface-2 hover:text-ink"
                >
                  <X className="h-3.5 w-3.5" strokeWidth={1.75} />
                </button>
              ) : (
                <HintKey>esc</HintKey>
              )}
            </div>

            <CommandPrimitive.List className="max-h-[min(420px,60vh)] scroll-py-2 overflow-y-auto overflow-x-hidden px-2 pb-2">
              {showSkeleton ? (
                <div className="px-1 py-1" aria-label="Searching">
                  <GroupHeading>Searching…</GroupHeading>
                  {[0, 1, 2].map((i) => (
                    <div key={i} className="flex items-center gap-3 px-3 py-2.5">
                      <Skeleton className="h-8 w-8 rounded-full" />
                      <div className="flex-1 space-y-1.5">
                        <Skeleton className="h-3.5 w-2/5" />
                        <Skeleton className="h-3 w-1/4" />
                      </div>
                    </div>
                  ))}
                </div>
              ) : null}

              {/* ── empty query: recents + actions ─────────────────────────── */}
              {!searching && !showSkeleton ? (
                <>
                  {recents.length > 0 ? (
                    <CommandPrimitive.Group>
                      <GroupHeading>Recent searches</GroupHeading>
                      {recents.map((r) => (
                        <PaletteItem
                          key={`recent:${r.kind}:${r.label}:${r.to ?? ''}`}
                          value={`recent:${r.kind}:${r.label}:${r.to ?? ''}`}
                          onSelect={() => runRecent(r)}
                        >
                          <ItemIcon>
                            <Clock className="h-4 w-4" strokeWidth={1.75} />
                          </ItemIcon>
                          <span className="min-w-0 flex-1">
                            <span className="type-small block truncate font-semibold text-ink">{r.label}</span>
                            {r.sub ? <span className="type-caption block truncate text-ink-3">{r.sub}</span> : null}
                          </span>
                          {r.to ? (
                            <span className="shrink-0 text-ink-3">{recentIcon(r.kind)}</span>
                          ) : null}
                        </PaletteItem>
                      ))}
                      <PaletteItem value="recent:clear" onSelect={clearRecents}>
                        <ItemIcon>
                          <X className="h-4 w-4" strokeWidth={1.75} />
                        </ItemIcon>
                        <span className="type-small flex-1 font-medium text-ink-3">Clear recent searches</span>
                      </PaletteItem>
                    </CommandPrimitive.Group>
                  ) : null}

                  <CommandPrimitive.Group>
                    <GroupHeading>Actions</GroupHeading>
                    {ACTIONS.map((a) => (
                      <PaletteItem key={a.id} value={`action:${a.id}`} onSelect={() => runAction(a.id)}>
                        <ItemIcon className="bg-brand-soft text-brand">
                          <a.icon className="h-4 w-4" strokeWidth={1.75} />
                        </ItemIcon>
                        <span className="min-w-0 flex-1">
                          <span className="type-small block truncate font-semibold text-ink">{a.label}</span>
                          <span className="type-caption block truncate text-ink-3">{a.sub}</span>
                        </span>
                        <ArrowRight className="h-3.5 w-3.5 shrink-0 text-ink-3" strokeWidth={1.75} />
                      </PaletteItem>
                    ))}
                  </CommandPrimitive.Group>
                </>
              ) : null}

              {/* ── results ────────────────────────────────────────────────── */}
              {searching && !showSkeleton && trips.length > 0 ? (
                <CommandPrimitive.Group>
                  <GroupHeading>Your trips</GroupHeading>
                  {trips.map((t) => (
                    <PaletteItem key={t.id} value={`trip:${t.id}`} onSelect={() => goTrip(t)}>
                      <ItemIcon>
                        <LayoutGrid className="h-4 w-4" strokeWidth={1.75} />
                      </ItemIcon>
                      <span className="min-w-0 flex-1">
                        <span className="type-small block truncate font-semibold text-ink">{t.title}</span>
                        <span className="type-caption block truncate text-ink-3">{t.destination}</span>
                      </span>
                      <span
                        className={cn(
                          'type-caption inline-flex shrink-0 items-center gap-1 rounded-pill px-2 py-0.5 font-semibold',
                          t.status === 'upcoming' ? 'bg-brand-soft text-brand' : 'bg-surface-2 text-ink-3',
                        )}
                      >
                        <CalendarRange className="h-3 w-3" strokeWidth={2} />
                        {t.status === 'upcoming' ? 'Upcoming' : 'Past'}
                      </span>
                    </PaletteItem>
                  ))}
                </CommandPrimitive.Group>
              ) : null}

              {searching && !showSkeleton && (cities.length > 0 || photonCities.length > 0) ? (
                <CommandPrimitive.Group>
                  <GroupHeading>Cities</GroupHeading>
                  {cities.map((c: GlobalCity) => (
                    <PaletteItem
                      key={`city:${c.city}:${c.country}`}
                      value={`city:${c.city}:${c.country}`}
                      onSelect={() => goCity(c.city, `${c.country} · ${c.count} places`)}
                    >
                      <ItemIcon>
                        <Building2 className="h-4 w-4" strokeWidth={1.75} />
                      </ItemIcon>
                      <span className="min-w-0 flex-1">
                        <span className="type-small block truncate font-semibold text-ink">{c.city}</span>
                        <span className="type-caption block truncate text-ink-3">{c.country}</span>
                      </span>
                      <span className="type-caption shrink-0 rounded-pill bg-surface-2 px-2 py-0.5 font-semibold text-ink-3">
                        {c.count} {c.count === 1 ? 'place' : 'places'}
                      </span>
                    </PaletteItem>
                  ))}
                  {photonCities.map((c: GlobalPhotonCity) => (
                    <PaletteItem
                      key={`pcity:${c.name}:${c.country}`}
                      value={`pcity:${c.name}:${c.country}`}
                      onSelect={() => goCity(c.name, [c.state, c.country].filter(Boolean).join(', '))}
                    >
                      <ItemIcon className="bg-brand-soft text-brand">
                        <Globe2 className="h-4 w-4" strokeWidth={1.75} />
                      </ItemIcon>
                      <span className="min-w-0 flex-1">
                        <span className="type-small block truncate font-semibold text-ink">{c.name}</span>
                        <span className="type-caption block truncate text-ink-3">
                          {[c.state, c.country].filter(Boolean).join(', ') || 'Anywhere'} · open the city builder
                        </span>
                      </span>
                      <OsmBadge />
                    </PaletteItem>
                  ))}
                </CommandPrimitive.Group>
              ) : null}

              {searching && !showSkeleton && places.length > 0 ? (
                <CommandPrimitive.Group>
                  <GroupHeading>Places</GroupHeading>
                  {places.map((p) => (
                    <PaletteItem key={p.id} value={`place:${p.id}`} onSelect={() => openPlace(p)}>
                      <ItemIcon>
                        {p.category === 'food' ? (
                          <UtensilsCrossed className="h-4 w-4" strokeWidth={1.75} />
                        ) : (
                          <MapPin className="h-4 w-4" strokeWidth={1.75} />
                        )}
                      </ItemIcon>
                      <span className="min-w-0 flex-1">
                        <span className="type-small block truncate font-semibold text-ink">{p.name}</span>
                        <span className="type-caption block truncate text-ink-3">
                          {p.city}, {p.country}
                        </span>
                      </span>
                      {p.rating != null ? (
                        <span className="inline-flex shrink-0 items-center gap-1 rounded-md bg-surface-2 px-1.5 py-0.5">
                          <Star className="h-3 w-3 fill-ochre text-ochre" strokeWidth={1.75} />
                          <span className="type-caption tnum font-semibold text-ink">{p.rating.toFixed(1)}</span>
                        </span>
                      ) : null}
                    </PaletteItem>
                  ))}
                </CommandPrimitive.Group>
              ) : null}

              {/* ── honest empty state ─────────────────────────────────────── */}
              {showEmpty ? (
                <div className="px-1 py-1">
                  <div className="px-3 pb-1 pt-4 text-center">
                    <p className="type-small font-semibold text-ink">No matches for “{trimmedInput}”</p>
                    <p className="type-caption mx-auto mt-1 max-w-[320px] text-ink-3">
                      It isn’t in your trips or our curated places yet, but you can map it live and start
                      planning.
                    </p>
                  </div>
                  <CommandPrimitive.Group>
                    <PaletteItem
                      value={`builder:${trimmedInput}`}
                      onSelect={() => goCity(trimmedInput, 'Via OpenStreetMap')}
                    >
                      <ItemIcon className="bg-brand-soft text-brand">
                        <Globe2 className="h-4 w-4" strokeWidth={1.75} />
                      </ItemIcon>
                      <span className="min-w-0 flex-1">
                        <span className="type-small block truncate font-semibold text-brand">
                          Map “{trimmedInput}” live from OpenStreetMap
                        </span>
                        <span className="type-caption block truncate text-ink-3">
                          Open the city builder, places import as you watch
                        </span>
                      </span>
                      <ArrowRight className="h-3.5 w-3.5 shrink-0 text-brand" strokeWidth={1.75} />
                    </PaletteItem>
                  </CommandPrimitive.Group>
                </div>
              ) : null}
            </CommandPrimitive.List>

            {/* footer hints */}
            <div className="flex items-center gap-4 border-t border-border px-4 py-2.5">
              <span className="type-caption flex items-center gap-1.5 text-ink-3">
                <HintKey>↑</HintKey>
                <HintKey>↓</HintKey>
                navigate
              </span>
              <span className="type-caption flex items-center gap-1.5 text-ink-3">
                <HintKey>↵</HintKey>
                open
              </span>
              <span className="type-caption flex items-center gap-1.5 text-ink-3">
                <HintKey>esc</HintKey>
                close
              </span>
              <span className="type-caption ml-auto hidden text-ink-3 sm:block">
                Cities beyond our corpus build live from OpenStreetMap
              </span>
            </div>
          </CommandPrimitive>
        </DialogContent>
      </Dialog>

      {/* place detail, same dialog Explore uses, opened for corpus places */}
      <Suspense fallback={null}>
        <PlaceDetailDialog
          place={detail}
          saved={detail ? savedItem(detail) != null : false}
          budgetBand={null}
          onClose={() => setDetail(null)}
          onToggleSave={toggleSave}
          onViewOnMap={() => {
            setDetail(null);
            navigate('/explore');
          }}
        />
      </Suspense>

      {/* action modals, self-contained shells reused from the Trips page */}
      <AiTripBuilderModal open={aiOpen} onOpenChange={setAiOpen} />
      <RoadtripBuilderModal open={roadtripOpen} onOpenChange={setRoadtripOpen} />
      <Suspense fallback={null}>
        <SocialImportModal open={socialOpen} onOpenChange={setSocialOpen} /> {/* r19-social */}
      </Suspense>

      {/* toast outlet for detail-dialog + save feedback (singleton-safe) */}
      <ToastHost />
    </>
  );
}
