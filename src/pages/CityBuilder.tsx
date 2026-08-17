/**
 * City Builder (/city/:name) - OSM-classified place groups for ANY city on
 * Earth. The backend geocodes the city, lazily imports its OpenStreetMap
 * places when the corpus is thin, and returns them bucketed by OSM class
 * (temples, food, cafés, parks, beaches, viewpoints, shopping, nightlife,
 * family…). Travelers hand-pick places into their bucket list or straight
 * into a new trip ("Explore {City}") as unscheduled stops.
 *
 * The "AI itineraries" card is the coming-soon hook: requests land in the
 * admin Requests tab (city_requests).
 */
import { useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { AnimatePresence, motion } from 'framer-motion';
import type { DateRange } from 'react-day-picker';
import { addDays, format } from 'date-fns';
import {
  ArrowLeft,
  CarFront,
  Check,
  ChevronDown,
  Compass,
  Loader2,
  MapPin,
  Mountain,
  Sparkles,
  Star,
  Trophy,
  UtensilsCrossed,
} from 'lucide-react'; // r13-getaways: CarFront + Mountain for the getaways section
import type { inferRouterOutputs } from '@trpc/server';
import type { AppRouter } from '../../api/router';
import { formatMoneyCompact } from '@contracts/fx';
import { trpc } from '@/providers/trpc';
import { Button } from '@/components/ui/button';
import { Calendar } from '@/components/ui/calendar';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Skeleton } from '@/components/ui/skeleton';
import { Textarea } from '@/components/ui/textarea';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/components/ui/empty';
import { EASE_EXPO } from '@/lib/motion';
import { placeImageFor, poolImageFor } from '@/lib/place-images';
import { cn } from '@/lib/utils';
import { ToastHost, toast } from '@/components/explore/toast';
import FamousPickBadge from '@/components/explore/FamousPickBadge';

type RouterOutputs = inferRouterOutputs<AppRouter>;
type CityProfile = RouterOutputs['citybuild']['cityProfile'];
type CityGroup = CityProfile['groups'][number];
type CityPlace = CityGroup['places'][number];
type FamousPlace = RouterOutputs['explore']['famousInCity']['places'][number];
// r15-eats
type FamousEatPlace = RouterOutputs['explore']['famousEats']['places'][number];
// r16-culinary - "Taste {city}" signature dishes
type TasteDish = RouterOutputs['explore']['cityTastes'][number];
type TastePlace = TasteDish['places'][number];
// r13-getaways
type GetawayPlace = RouterOutputs['getaways']['near']['groups']['hikes'][number];

function feeChip(p: CityPlace): string | null {
  if (p.feeCents == null) return null;
  return p.feeCents > 0 ? formatMoneyCompact(p.feeCents, p.feeCurrency ?? 'USD') : 'Free';
}

/** One selectable place card - photo, name, rating, fee chip, round check. */
function PlaceCard({
  place,
  selected,
  onToggle,
}: {
  place: CityPlace;
  selected: boolean;
  onToggle: () => void;
}) {
  const img = placeImageFor(place);
  const fee = feeChip(place);
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-pressed={selected}
      className={cn(
        'group relative overflow-hidden rounded-lg border bg-surface text-left shadow-sm transition-all duration-fast',
        selected
          ? 'border-brand ring-2 ring-brand/50'
          : 'border-border hover:-translate-y-0.5 hover:shadow-md',
      )}
    >
      <div className="relative aspect-[4/3] w-full overflow-hidden bg-surface-2">
        {img ? (
          <img src={img} alt="" loading="lazy" className="photo h-full w-full object-cover" onError={e => { const fb = poolImageFor(place); const el = e.currentTarget; if (fb && el.src !== fb) el.src = fb; else el.style.display = 'none'; }} />
        ) : (
          <span className="flex h-full w-full items-center justify-center bg-surface-2">
            <MapPin className="h-6 w-6 text-ink-3" strokeWidth={1.75} />
          </span>
        )}
        <span
          className={cn(
            'absolute right-2 top-2 flex h-7 w-7 items-center justify-center rounded-full border-2 shadow-sm transition-all duration-fast',
            selected
              ? 'border-brand bg-brand text-brand-ink'
              : 'border-white/70 bg-black/40 text-transparent backdrop-blur-sm group-hover:border-white group-hover:text-white/60',
          )}
          aria-hidden
        >
          <Check className="h-4 w-4" strokeWidth={2.5} />
        </span>
        {selected && (
          <span className="absolute left-2 top-2 rounded-pill bg-brand px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-brand-ink shadow-sm">
            Selected
          </span>
        )}
        {fee && (
          <span className="type-caption absolute bottom-2 left-2 rounded-pill bg-surface/90 px-2 py-0.5 font-semibold text-ink shadow-sm backdrop-blur-sm">
            {fee}
          </span>
        )}
        {place.famousEatery && (
          <FamousPickBadge className="absolute bottom-2 right-2 px-2 py-0.5 shadow-sm" />
        )}
      </div>
      <div className="p-3">
        <p className="type-small truncate font-semibold text-ink">{place.name}</p>
        <p className="type-caption mt-0.5 flex items-center gap-1 text-ink-3">
          {place.rating != null && (
            <>
              <Star className="h-3 w-3 fill-ochre text-ochre" strokeWidth={0} />
              <span className="tnum">{place.rating.toFixed(1)}</span>
            </>
          )}
          {(place.tags ?? []).length > 0 && <span className="truncate">· {(place.tags ?? []).slice(0, 2).join(' · ')}</span>}
        </p>
      </div>
    </button>
  );
}

/**
 * One numbered row of the "Most famous in {city}" listicle - rank, photo,
 * name, blog blurb, must-see ribbon, and the same select-check pattern as
 * PlaceCard (bigger, clearer, with a "Selected" pill).
 */
function FamousRow({
  item,
  selected,
  onToggle,
}: {
  item: FamousPlace;
  selected: boolean;
  onToggle: () => void;
}) {
  const img = placeImageFor(item);
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-pressed={selected}
      className={cn(
        'group relative flex w-full items-center gap-3 rounded-xl border bg-surface p-2.5 pr-3 text-left shadow-sm transition-all duration-fast sm:gap-4',
        selected ? 'border-brand ring-2 ring-brand/50' : 'border-border hover:-translate-y-0.5 hover:shadow-md',
      )}
    >
      <span className="type-h3 tnum w-7 shrink-0 text-center text-ink-3 sm:w-9" aria-hidden>
        {item.rank}
      </span>
      <span className="relative h-16 w-16 shrink-0 overflow-hidden rounded-lg bg-surface-2 sm:h-20 sm:w-24">
        {img ? (
          <img src={img} alt="" loading="lazy" className="photo h-full w-full object-cover" onError={e => { const fb = poolImageFor(item); const el = e.currentTarget; if (fb && el.src !== fb) el.src = fb; else el.style.display = 'none'; }} />
        ) : (
          <span className="flex h-full w-full items-center justify-center">
            <MapPin className="h-5 w-5 text-ink-3" strokeWidth={1.75} />
          </span>
        )}
        {item.verdict === 'must-see' && (
          <span className="absolute left-1 top-1 rounded-pill bg-brand px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-brand-ink shadow-sm">
            Must-see
          </span>
        )}
      </span>
      <span className="min-w-0 flex-1">
        <span className="type-small block truncate font-semibold text-ink">{item.name}</span>
        <span className="type-caption mt-0.5 block text-ink-3 line-clamp-2">{item.blurb}</span>
      </span>
      <span className="flex shrink-0 flex-col items-center gap-1">
        <span
          className={cn(
            'flex h-7 w-7 items-center justify-center rounded-full border-2 shadow-sm transition-all duration-fast',
            selected
              ? 'border-brand bg-brand text-brand-ink'
              : 'border-border-strong bg-surface text-transparent group-hover:border-brand/60 group-hover:text-brand/30',
          )}
          aria-hidden
        >
          <Check className="h-4 w-4" strokeWidth={2.5} />
        </span>
        {selected && (
          <span className="rounded-pill bg-brand-soft px-1.5 py-px text-[9px] font-bold uppercase tracking-wide text-brand">
            Selected
          </span>
        )}
      </span>
    </button>
  );
}

// r13-getaways - "Getaways - within ~2 hours" cards + section ─────────────

/** "1h 45m" drive label; estimates get the ≈ prefix and an "est." suffix. */
function driveChip(p: GetawayPlace): string {
  const h = Math.floor(p.driveMin / 60);
  const m = p.driveMin % 60;
  const label = h > 0 ? (m > 0 ? `${h}h ${m}m` : `${h}h`) : `${m}m`;
  return p.estimated ? `≈${label} est.` : label;
}

/** One horizontal getaways card - photo, name, kind + drive chips, rating. */
function GetawayCard({
  place,
  selected,
  onToggle,
}: {
  place: GetawayPlace;
  selected: boolean;
  onToggle: () => void;
}) {
  const img = placeImageFor(place);
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-pressed={selected}
      className={cn(
        'group relative w-40 shrink-0 snap-start overflow-hidden rounded-lg border bg-surface text-left shadow-sm transition-all duration-fast sm:w-44',
        selected
          ? 'border-brand ring-2 ring-brand/50'
          : 'border-border hover:-translate-y-0.5 hover:shadow-md',
      )}
    >
      <div className="relative aspect-[4/3] w-full overflow-hidden bg-surface-2">
        {img ? (
          <img src={img} alt="" loading="lazy" className="photo h-full w-full object-cover" onError={e => { const fb = poolImageFor(place); const el = e.currentTarget; if (fb && el.src !== fb) el.src = fb; else el.style.display = 'none'; }} />
        ) : (
          <span className="flex h-full w-full items-center justify-center bg-surface-2">
            <Mountain className="h-6 w-6 text-ink-3" strokeWidth={1.75} />
          </span>
        )}
        <span
          className={cn(
            'absolute right-2 top-2 flex h-6 w-6 items-center justify-center rounded-full border-2 shadow-sm transition-all duration-fast',
            selected
              ? 'border-brand bg-brand text-brand-ink'
              : 'border-white/70 bg-black/40 text-transparent backdrop-blur-sm group-hover:border-white group-hover:text-white/60',
          )}
          aria-hidden
        >
          <Check className="h-3.5 w-3.5" strokeWidth={2.5} />
        </span>
        <span className="type-caption absolute bottom-2 left-2 flex items-center gap-1 rounded-pill bg-surface/90 px-2 py-0.5 font-semibold text-ink shadow-sm backdrop-blur-sm">
          <CarFront className="h-3 w-3 text-pine" strokeWidth={2} />
          <span className="tnum">{driveChip(place)}</span>
        </span>
      </div>
      <div className="p-2.5">
        <p className="type-small truncate font-semibold text-ink">{place.name}</p>
        <p className="type-caption mt-1 flex items-center gap-1.5 text-ink-3">
          <span className="rounded-pill bg-surface-2 px-1.5 py-px text-[10px] font-semibold capitalize text-ink-2">
            {place.kind}
          </span>
          {place.rating != null && (
            <>
              <Star className="h-3 w-3 fill-ochre text-ochre" strokeWidth={0} />
              <span className="tnum">{place.rating.toFixed(1)}</span>
            </>
          )}
        </p>
      </div>
    </button>
  );
}

/** One titled row of getaway cards ("Hikes & viewpoints", …). */
function GetawayRow({
  title,
  places,
  selected,
  onToggle,
}: {
  title: string;
  places: GetawayPlace[];
  selected: Set<number>;
  onToggle: (id: number) => void;
}) {
  if (places.length === 0) return null;
  return (
    <div className="mt-4 first:mt-0">
      <h3 className="type-small font-semibold text-ink">
        {title}
        <span className="tnum ml-2 font-normal text-ink-3">· {places.length}</span>
      </h3>
      <div className="-mx-1 mt-2 flex snap-x gap-3 overflow-x-auto px-1 pb-1">
        {places.map((p) => (
          <GetawayCard key={p.id} place={p} selected={selected.has(p.id)} onToggle={() => onToggle(p.id)} />
        ))}
      </div>
    </div>
  );
}

// r15-eats - "★ Famous eats" rail ─────────────────────────────────────────

/**
 * One horizontal famous-eats card - photo, ★ Famous pick badge, name,
 * rating; same select-check pattern as GetawayCard so famous eateries join
 * the select → bucket/trip flow.
 */
function FamousEatCard({
  place,
  selected,
  onToggle,
}: {
  place: FamousEatPlace;
  selected: boolean;
  onToggle: () => void;
}) {
  const img = placeImageFor(place);
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-pressed={selected}
      className={cn(
        'group relative w-40 shrink-0 snap-start overflow-hidden rounded-lg border bg-surface text-left shadow-sm transition-all duration-fast sm:w-44',
        selected
          ? 'border-brand ring-2 ring-brand/50'
          : 'border-border hover:-translate-y-0.5 hover:shadow-md',
      )}
    >
      <div className="relative aspect-[4/3] w-full overflow-hidden bg-surface-2">
        {img ? (
          <img src={img} alt="" loading="lazy" className="photo h-full w-full object-cover" onError={e => { const fb = poolImageFor(place); const el = e.currentTarget; if (fb && el.src !== fb) el.src = fb; else el.style.display = 'none'; }} />
        ) : (
          <span className="flex h-full w-full items-center justify-center bg-surface-2">
            <MapPin className="h-6 w-6 text-ink-3" strokeWidth={1.75} />
          </span>
        )}
        <FamousPickBadge className="absolute bottom-2 left-2 px-2 py-0.5 shadow-sm" />
        <span
          className={cn(
            'absolute right-2 top-2 flex h-6 w-6 items-center justify-center rounded-full border-2 shadow-sm transition-all duration-fast',
            selected
              ? 'border-brand bg-brand text-brand-ink'
              : 'border-white/70 bg-black/40 text-transparent backdrop-blur-sm group-hover:border-white group-hover:text-white/60',
          )}
          aria-hidden
        >
          <Check className="h-3.5 w-3.5" strokeWidth={2.5} />
        </span>
      </div>
      <div className="p-2.5">
        <p className="type-small truncate font-semibold text-ink">{place.name}</p>
        <p className="type-caption mt-1 flex items-center gap-1 text-ink-3">
          {place.rating != null && (
            <>
              <Star className="h-3 w-3 fill-ochre text-ochre" strokeWidth={0} />
              <span className="tnum">{place.rating.toFixed(1)}</span>
            </>
          )}
          {(place.tags ?? []).length > 0 && <span className="truncate">· {(place.tags ?? []).slice(0, 2).join(' · ')}</span>}
        </p>
      </div>
    </button>
  );
}

// r16-culinary - "Taste {city}" signature dishes ─────────────────────────

/** Image input for a dish place: corpus row when linked, else a synthetic
 *  food place so the pool fallback still serves a food/region image. */
function tastePlaceImageInput(p: TastePlace, country: string) {
  return {
    id: p.placeId ?? undefined,
    name: p.name,
    category: 'food',
    tags: [] as string[],
    country,
    lat: p.lat,
    lng: p.lng,
    image: p.image,
  };
}

/**
 * One signature-dish card - dish name + blurb up top, then the famous places
 * for it as photo rows (★ Famous pick when the corpus flags the eatery,
 * rating, and the "why this place" line). Warm ochre language, matches the
 * Famous eats rail.
 */
function TasteDishCard({ dish, country }: { dish: TasteDish; country: string }) {
  return (
    <div className="overflow-hidden rounded-xl border border-border bg-surface shadow-sm">
      <div className="border-b border-border bg-ochre-soft/60 px-4 py-3">
        <p className="type-caption font-semibold uppercase tracking-wide text-ochre">Signature dish</p>
        <h3 className="type-h4 mt-0.5 text-ink">{dish.dish}</h3>
        {dish.blurb && <p className="type-small mt-1 text-ink-2">{dish.blurb}</p>}
      </div>
      <ul className="divide-y divide-border">
        {dish.places.map((p) => {
          const input = tastePlaceImageInput(p, country);
          const img = placeImageFor(input);
          return (
            <li key={p.id} className="flex gap-3 px-4 py-3">
              <span className="relative h-16 w-16 shrink-0 overflow-hidden rounded-md bg-surface-2">
                {img ? (
                  <img
                    src={img}
                    alt=""
                    loading="lazy"
                    className="photo h-full w-full object-cover"
                    onError={e => { const fb = poolImageFor(input); const el = e.currentTarget; if (fb && el.src !== fb) el.src = fb; else el.style.display = 'none'; }}
                  />
                ) : (
                  <span className="flex h-full w-full items-center justify-center bg-surface-2">
                    <MapPin className="h-5 w-5 text-ink-3" strokeWidth={1.75} />
                  </span>
                )}
              </span>
              <span className="min-w-0 flex-1">
                <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
                  <span className="type-small truncate font-semibold text-ink">{p.name}</span>
                  {p.famousEatery && <FamousPickBadge className="px-1.5 py-0.5 text-[10px]" />}
                  {p.rating != null && (
                    <span className="type-caption inline-flex items-center gap-1 text-ink-3">
                      <Star className="h-3 w-3 fill-ochre text-ochre" strokeWidth={0} />
                      <span className="tnum">{p.rating.toFixed(1)}</span>
                    </span>
                  )}
                </span>
                {p.why && <span className="type-caption mt-1 block text-ink-3">{p.why}</span>}
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/** Collapsible OSM group section, e.g. "🛕 Temples & shrines · 14". */
function GroupSection({
  group,
  open,
  onOpenChange,
  selected,
  onToggle,
}: {
  group: CityGroup;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  selected: Set<number>;
  onToggle: (id: number) => void;
}) {
  return (
    <Collapsible open={open} onOpenChange={onOpenChange}>
      <CollapsibleTrigger className="flex w-full items-center justify-between gap-3 rounded-lg border border-border bg-surface px-4 py-3 text-left shadow-sm transition-colors duration-fast hover:bg-surface-2">
        <span className="type-small font-semibold text-ink">
          <span className="mr-2" aria-hidden>
            {group.emoji}
          </span>
          {group.label}
          <span className="tnum ml-2 font-normal text-ink-3">· {group.count}</span>
        </span>
        <ChevronDown
          className={cn('h-4 w-4 shrink-0 text-ink-3 transition-transform duration-fast', open && 'rotate-180')}
          strokeWidth={1.75}
        />
      </CollapsibleTrigger>
      <CollapsibleContent className="overflow-hidden">
        <div className="grid grid-cols-2 gap-3 pt-3 sm:grid-cols-3 lg:grid-cols-4">
          {group.places.map((p) => (
            <PlaceCard key={p.id} place={p} selected={selected.has(p.id)} onToggle={() => onToggle(p.id)} />
          ))}
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}

export default function CityBuilder() {
  const { name = '' } = useParams();
  const cityName = decodeURIComponent(name);
  const navigate = useNavigate();
  const utils = trpc.useUtils();

  const profileQ = trpc.citybuild.cityProfile.useQuery({ city: cityName });
  const profile = profileQ.data;
  // "Most famous in {city}" top-10 - loads once the profile resolves so the
  // canonical (title-cased) city name is used.
  const famousQ = trpc.explore.famousInCity.useQuery(
    { city: profile?.city ?? cityName, limit: 10 },
    { enabled: !!profile },
  );
  const famous = famousQ.data?.places ?? [];

  // r15-eats - "★ Famous eats" rail: the famous eateries of the city
  // (deterministic famousEatery flag; falls back to the nearest big corpus
  // city when none are mapped locally). Hidden entirely when there are none.
  const famousEatsQ = trpc.explore.famousEats.useQuery(
    { city: profile?.city ?? cityName, country: profile?.country || undefined, limit: 10 },
    { enabled: !!profile },
  );
  const famousEats = famousEatsQ.data?.places ?? [];
  const famousEatsFallback = famousEatsQ.data?.fallback ?? null;

  // r16-culinary - "Taste {city}": signature dishes mapped to the famous
  // places that serve them. Empty array → the section hides itself.
  const cityTastesQ = trpc.explore.cityTastes.useQuery(
    { city: profile?.city ?? cityName, country: profile?.country || undefined },
    { enabled: !!profile },
  );
  const tastes = cityTastesQ.data ?? [];

  // r13-getaways - hikes / falls / heritage drives within ~2 h of the city.
  const getawaysQ = trpc.getaways.near.useQuery(
    { city: profile?.city ?? cityName },
    { enabled: !!profile, staleTime: 10 * 60 * 1000 },
  );
  const getaways = getawaysQ.data?.groups ?? null;
  const getawaysTotal = getawaysQ.data?.total ?? 0;

  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>({});
  const [tripDialogOpen, setTripDialogOpen] = useState(false);
  const [range, setRange] = useState<DateRange | undefined>(() => {
    const start = addDays(new Date(), 21);
    return { from: start, to: addDays(start, 2) };
  });
  const [startingTrip, setStartingTrip] = useState(false);
  const [addingBucket, setAddingBucket] = useState(false);

  const [aiMessage, setAiMessage] = useState('');
  const [aiState, setAiState] = useState<'idle' | 'sending' | 'done' | 'already'>('idle');

  const placeById = useMemo(() => {
    const map = new Map<number, CityPlace>();
    for (const g of profile?.groups ?? []) for (const p of g.places) map.set(p.id, p);
    // famous picks that fell outside the group top-24s are selectable too
    for (const f of famous) if (!map.has(f.id)) map.set(f.id, f);
    // r15-eats - famous eateries (they may sit outside the food group's top-24)
    for (const f of famousEats) if (!map.has(f.id)) map.set(f.id, f);
    // r13-getaways - getaway cards join the same select → bucket/trip flow
    if (getaways) {
      for (const list of Object.values(getaways)) {
        for (const p of list) if (!map.has(p.id)) map.set(p.id, p);
      }
    }
    return map;
  }, [profile, famous, famousEats, getaways]);

  const createTrip = trpc.trips.create.useMutation();
  const addToTrip = trpc.explore.addToTrip.useMutation();
  const addBucket = trpc.explore.addBucket.useMutation();
  const requestAI = trpc.citybuild.requestCityAI.useMutation({
    onSuccess: (r) => setAiState(r.already ? 'already' : 'done'),
    onError: (e) => {
      setAiState('idle');
      toast(e.message || 'Could not send the request, please try again.', { kind: 'warn' });
    },
  });

  function togglePlace(id: number) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function addSelectedToBucket() {
    if (addingBucket || selected.size === 0 || !profile) return;
    setAddingBucket(true);
    let saved = 0;
    try {
      for (const id of selected) {
        const p = placeById.get(id);
        if (!p) continue;
        try {
          await addBucket.mutateAsync({
            name: p.name,
            country: `${p.city}, ${p.country}`,
            lat: p.lat ?? undefined,
            lng: p.lng ?? undefined,
            image: p.image ?? undefined,
            note: p.description ?? undefined,
          });
          saved++;
        } catch {
          /* keep going, partial save is fine */
        }
      }
      void utils.explore.bucketList.invalidate();
      toast(
        saved === selected.size
          ? `${saved} ${saved === 1 ? 'place' : 'places'} saved to your bucket list`
          : `Saved ${saved} of ${selected.size} places`,
        { kind: saved ? 'success' : 'warn' },
      );
      if (saved) setSelected(new Set());
    } finally {
      setAddingBucket(false);
    }
  }

  async function startTrip() {
    if (startingTrip || !profile || !range?.from || !range.to || selected.size === 0) return;
    setStartingTrip(true);
    try {
      const cover = [...selected].map((id) => placeById.get(id)).find((p) => p?.image)?.image ?? undefined;
      const { id } = await createTrip.mutateAsync({
        title: `Explore ${profile.city}`,
        destination: profile.country ? `${profile.city}, ${profile.country}` : profile.city,
        startDate: format(range.from, 'yyyy-MM-dd'),
        endDate: format(range.to, 'yyyy-MM-dd'),
        coverImage: cover,
      });
      for (const placeId of selected) {
        try {
          await addToTrip.mutateAsync({ placeId, tripId: id, dayId: null });
        } catch {
          /* a missed stop shouldn't block the workspace */
        }
      }
      void utils.trips.list.invalidate();
      void utils.trips.get.invalidate({ id });
      setTripDialogOpen(false);
      toast('Trip created, drag your picks into days', { kind: 'success' });
      navigate(`/trips/${id}`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : '';
      if (msg.includes('UPGRADE_REQUIRED')) {
        toast('The free Wanderer tier allows 3 active trips', {
          kind: 'warn',
          action: { label: 'Upgrade', onClick: () => navigate('/pricing') },
        });
      } else {
        toast('Could not create that trip, please try again.', { kind: 'warn' });
      }
    } finally {
      setStartingTrip(false);
    }
  }

  function sendAIRequest() {
    if (!profile || aiState === 'sending' || aiState === 'done') return;
    setAiState('sending');
    requestAI.mutate({
      city: profile.city,
      country: profile.country || undefined,
      message: aiMessage.trim() || undefined,
    });
  }

  // ── loading / error states ─────────────────────────────────────────────
  if (profileQ.isLoading) {
    return (
      <div className="mx-auto max-w-[1200px] px-4 pb-24 pt-8 sm:px-6 md:pt-10 lg:px-10">
        <Skeleton className="h-3 w-28" />
        <Skeleton className="mt-3 h-10 w-full max-w-[420px]" />
        <Skeleton className="mt-2 h-4 w-64" />
        <div className="mt-8 space-y-3">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-14 w-full rounded-lg" />
          ))}
        </div>
        <p className="type-small mt-8 flex items-center gap-2 text-ink-2">
          <Loader2 className="h-4 w-4 animate-spin text-brand" strokeWidth={1.75} />
          Mapping {cityName} live from OpenStreetMap, the first visit can take ~30 seconds.
        </p>
      </div>
    );
  }

  if (profileQ.isError || !profile) {
    return (
      <div className="mx-auto flex max-w-[1200px] px-4 py-16 sm:px-6 lg:px-10">
        <Empty className="w-full rounded-xl border border-dashed border-border bg-surface shadow-sm">
          <EmptyHeader>
            <EmptyMedia variant="icon" className="size-12 rounded-full bg-brand-soft text-brand">
              <Compass strokeWidth={1.75} />
            </EmptyMedia>
            <EmptyTitle className="type-h3 text-ink">Can’t map “{cityName}”</EmptyTitle>
            <EmptyDescription className="type-small text-ink-2">
              {profileQ.error?.message ?? 'Something went wrong loading this city.'}
            </EmptyDescription>
          </EmptyHeader>
          <EmptyContent>
            <Link
              to="/explore"
              className="btn-sheen type-small inline-flex h-10 items-center gap-2 rounded-md bg-brand px-5 font-semibold text-brand-ink shadow-sm transition-all duration-fast hover:-translate-y-px hover:bg-brand-strong hover:shadow-md active:scale-[0.97]"
            >
              Back to Explore
            </Link>
          </EmptyContent>
        </Empty>
      </div>
    );
  }

  const selectedPlaces = [...selected].map((id) => placeById.get(id)).filter((p): p is CityPlace => p != null);

  return (
    <div className="pb-24">
      {/* ── header ─────────────────────────────────────────────────────── */}
      <div className="mx-auto max-w-[1200px] px-4 pt-8 sm:px-6 md:pt-10 lg:px-10">
        <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.32, ease: EASE_EXPO }}>
          <Link
            to="/explore"
            className="type-small inline-flex items-center gap-1.5 text-ink-2 transition-colors duration-fast hover:text-ink"
          >
            <ArrowLeft className="h-3.5 w-3.5" strokeWidth={1.75} />
            Explore
          </Link>
          <p className="type-eyebrow mt-4 text-brand">City builder · OpenStreetMap</p>
          <h1 className="type-h1 mt-2 text-ink">{profile.city}</h1>
          <p className="type-body mt-1 text-ink-2">
            {profile.country && <>{profile.country} · </>}
            <span className="tnum font-semibold text-ink">{profile.total}</span>{' '}
            {profile.total === 1 ? 'place' : 'places'} mapped via OpenStreetMap
            {profile.imported > 0 && (
              <span className="text-ink-3"> · <span className="tnum">{profile.imported}</span> just added for you</span>
            )}
          </p>

          {/* mini category chips */}
          <div className="mt-4 flex flex-wrap gap-1.5">
            {profile.groups.map((g) => (
              <span
                key={g.key}
                className="type-caption inline-flex h-7 items-center gap-1 rounded-pill bg-surface-2 px-2.5 font-medium text-ink-2"
              >
                <span aria-hidden>{g.emoji}</span>
                {g.label}
                <span className="tnum text-ink-3">{g.count}</span>
              </span>
            ))}
          </div>
        </motion.div>

        {/* ── most famous in {city}, the blog-style top-10 listicle ────── */}
        {famous.length > 0 && (
          <motion.section
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.32, ease: EASE_EXPO, delay: 0.05 }}
            className="mt-8"
            aria-label={`Most famous in ${profile.city}`}
          >
            <div className="mb-3">
              <h2 className="type-h3 flex items-center gap-2 text-ink">
                <Trophy className="h-5 w-5 text-ochre" strokeWidth={1.75} />
                Most famous in {profile.city}
              </h2>
              <p className="type-small mt-1 text-ink-3">
                The top {famous.length}, ranked by ratings, iconicity and our world-famous list. Tap a row to
                select it.
              </p>
            </div>
            <ol className="space-y-2">
              {famous.map((f) => (
                <li key={f.id}>
                  <FamousRow item={f} selected={selected.has(f.id)} onToggle={() => togglePlace(f.id)} />
                </li>
              ))}
            </ol>
          </motion.section>
        )}

        {/* ── getaways, within ~2 hours of {city} (r13-getaways) ───────── */}
        {/* Hidden entirely when the city has no getaways (tiny towns, error). */}
        {getaways && getawaysTotal > 0 && (
          <motion.section
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.32, ease: EASE_EXPO, delay: 0.08 }}
            className="mt-8"
            aria-label={`Getaways within two hours of ${profile.city}`}
          >
            <div className="mb-1">
              <h2 className="type-h3 flex items-center gap-2 text-ink">
                <Mountain className="h-5 w-5 text-pine" strokeWidth={1.75} />
                Getaways, within ~2 hours of {profile.city}
              </h2>
              <p className="type-small mt-1 text-ink-3">
                Small hikes, falls and heritage drives out of the city. Drive times from the city
                centre, tap a card to select it.
              </p>
            </div>
            <GetawayRow title="Hikes & viewpoints" places={getaways.hikes} selected={selected} onToggle={togglePlace} />
            <GetawayRow title="Nature & waterfalls" places={getaways.nature} selected={selected} onToggle={togglePlace} />
            <GetawayRow title="Heritage drives" places={getaways.heritage} selected={selected} onToggle={togglePlace} />
          </motion.section>
        )}

        {/* ── ★ Famous eats rail (r15-eats), rendered directly above the
              food category group; hidden entirely when the city (and its
              nearest big corpus city) has no famous eateries ────────────── */}
        {famousEats.length > 0 && (
          <motion.section
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.32, ease: EASE_EXPO, delay: 0.09 }}
            className="mt-8"
            aria-label={`Famous eats in ${profile.city}`}
          >
            <div className="mb-1">
              <h2 className="type-h3 flex items-center gap-2 text-ink">
                <Star className="h-5 w-5 fill-ochre text-ochre" strokeWidth={1.75} />
                Famous eats{famousEatsFallback ? ` · near ${profile.city}` : ` in ${profile.city}`}
              </h2>
              <p className="type-small mt-1 text-ink-3">
                {famousEatsFallback
                  ? `No famous eateries mapped here yet, these are the ones people pick from in ${famousEatsFallback.city}.`
                  : 'The most famous eateries in town, this is what people can pick from. Tap a card to select it.'}
              </p>
            </div>
            <div className="-mx-1 mt-2 flex snap-x gap-3 overflow-x-auto px-1 pb-1">
              {famousEats.map((p) => (
                <FamousEatCard key={p.id} place={p} selected={selected.has(p.id)} onToggle={() => togglePlace(p.id)} />
              ))}
            </div>
          </motion.section>
        )}

        {/* ── Taste {city} (r16-culinary), signature dishes, each mapped to
              the famous places for it; directly above the food category group.
              Hidden entirely when the city has no curated dishes ──────────── */}
        {tastes.length > 0 && (
          <motion.section
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.32, ease: EASE_EXPO, delay: 0.095 }}
            className="mt-8"
            aria-label={`Taste ${profile.city} · signature dishes`}
          >
            <div className="mb-1">
              <h2 className="type-h3 flex items-center gap-2 text-ink">
                <UtensilsCrossed className="h-5 w-5 text-ochre" strokeWidth={1.75} />
                Taste {profile.city}
              </h2>
              <p className="type-small mt-1 text-ink-3">
                The dishes this city is known for, and the famous places to eat each one.
              </p>
            </div>
            <div className="mt-3 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
              {tastes.map((d) => (
                <TasteDishCard key={d.id} dish={d} country={profile.country} />
              ))}
            </div>
          </motion.section>
        )}

        {/* ── groups ─────────────────────────────────────────────────────── */}
        <div className="mt-8 space-y-3">
          {profile.groups.length === 0 ? (
            <div className="rounded-xl border border-dashed border-border bg-surface px-6 py-12 text-center">
              <h3 className="type-h3 text-ink">No places mapped here yet</h3>
              <p className="type-body mt-2 text-ink-2">
                OpenStreetMap has no named spots in this corner of the world yet, try a nearby town.
              </p>
            </div>
          ) : (
            profile.groups.map((g, i) => (
              <GroupSection
                key={g.key}
                group={g}
                open={openGroups[g.key] ?? i < 3}
                onOpenChange={(o) => setOpenGroups((prev) => ({ ...prev, [g.key]: o }))}
                selected={selected}
                onToggle={togglePlace}
              />
            ))
          )}
        </div>

        {/* ── AI coming-soon card ────────────────────────────────────────── */}
        <motion.section
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.32, ease: EASE_EXPO, delay: 0.1 }}
          className="mt-10 overflow-hidden rounded-xl border border-border bg-surface shadow-sm"
        >
          <div className="border-b border-border bg-surface-2/60 px-6 py-5">
            <p className="type-small flex items-center gap-2 font-semibold text-ink">
              <Sparkles className="h-4 w-4 text-brand" strokeWidth={1.75} />
              AI itineraries for {profile.city}
            </p>
            <p className="type-small mt-1 max-w-[60ch] text-ink-2">
              Coming soon, our AI is learning this region from the same OpenStreetMap data above.
              Want it sooner? Request it and our team gets notified.
            </p>
          </div>
          <div className="px-6 py-5">
            {aiState === 'done' || aiState === 'already' ? (
              <motion.p
                initial={{ opacity: 0, scale: 0.97 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ duration: 0.28, ease: EASE_EXPO }}
                className="type-small flex items-center gap-2 font-semibold text-pine"
              >
                <span className="flex h-6 w-6 items-center justify-center rounded-full bg-pine-soft">
                  <Check className="h-3.5 w-3.5" strokeWidth={2.5} />
                </span>
                {aiState === 'done'
                  ? `Requested, you're on the list for ${profile.city}.`
                  : `Already requested, ${profile.city} is on our list.`}
              </motion.p>
            ) : (
              <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
                <Textarea
                  value={aiMessage}
                  onChange={(e) => setAiMessage(e.target.value)}
                  maxLength={255}
                  rows={2}
                  placeholder={`Anything specific? “Temple trail + seafood shacks, 2 days”… (optional)`}
                  aria-label="Message for the AI request (optional)"
                  className="min-h-[64px] flex-1 resize-none rounded-md border-border-strong bg-surface"
                />
                <Button onClick={sendAIRequest} disabled={aiState === 'sending'} className="shrink-0">
                  {aiState === 'sending' ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin" strokeWidth={2} />
                      Sending…
                    </>
                  ) : (
                    'Request AI itineraries'
                  )}
                </Button>
              </div>
            )}
          </div>
        </motion.section>
      </div>

      {/* ── sticky selection bar ─────────────────────────────────────────── */}
      <AnimatePresence>
        {selected.size > 0 && (
          <motion.div
            initial={{ opacity: 0, y: 24 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 24 }}
            transition={{ duration: 0.28, ease: EASE_EXPO }}
            className="fixed inset-x-0 bottom-[88px] z-40 flex justify-center px-4 md:bottom-6"
          >
            <div className="glass-strong flex flex-wrap items-center justify-center gap-2 rounded-pill border border-border px-4 py-2.5 shadow-lg sm:gap-3">
              <span className="type-small tnum font-semibold text-ink">
                {selected.size} selected
              </span>
              <Button
                variant="secondary"
                size="sm"
                pill
                onClick={() => void addSelectedToBucket()}
                disabled={addingBucket || startingTrip}
              >
                {addingBucket ? <Loader2 className="h-3.5 w-3.5 animate-spin" strokeWidth={2} /> : null}
                Add to bucket list
              </Button>
              <Button size="sm" pill onClick={() => setTripDialogOpen(true)} disabled={addingBucket || startingTrip}>
                Start a trip with these
              </Button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── start-a-trip date dialog ─────────────────────────────────────── */}
      <Dialog open={tripDialogOpen} onOpenChange={setTripDialogOpen}>
        <DialogContent className="max-w-[480px] rounded-xl">
          <DialogHeader>
            <DialogTitle className="type-h3 text-ink">Start “Explore {profile.city}”</DialogTitle>
            <DialogDescription className="type-small text-ink-2">
              Pick your dates, {selectedPlaces.length} selected {selectedPlaces.length === 1 ? 'place' : 'places'}{' '}
              land in the trip as unscheduled stops. Drag them into days in the workspace.
            </DialogDescription>
          </DialogHeader>
          <div className="flex justify-center overflow-x-auto rounded-lg border border-border bg-surface p-2">
            <Calendar
              mode="range"
              numberOfMonths={1}
              selected={range}
              onSelect={setRange}
              disabled={{ before: new Date() }}
            />
          </div>
          <DialogFooter className="gap-2">
            <Button variant="ghost" onClick={() => setTripDialogOpen(false)} disabled={startingTrip}>
              Cancel
            </Button>
            <Button onClick={() => void startTrip()} disabled={!range?.from || !range.to || startingTrip}>
              {startingTrip ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" strokeWidth={2} />
                  Creating…
                </>
              ) : (
                'Create trip'
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ToastHost />
    </div>
  );
}
