/**
 * "Trips around you" (r14-nearby) - Explore section that turns the user's
 * location (or a searched city) plus their taste-profile styles into a row of
 * nearby things-to-do: getaways within ~150 km and top-rated places within
 * ~40 km, preference-matched server-side (trpc.getaways.aroundMe, public,
 * 30-day cached).
 *
 * Flow: locate-me button (browser geolocation) → on denial/unavailability a
 * city search fallback (resolved through the cached getaways.near anchor).
 * Preference chips pre-select from the onboarding style profile; toggling
 * re-ranks. Each card can start a trip with that destination pre-filled.
 */
import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router';
import { keepPreviousData } from '@tanstack/react-query';
import { addDays, format } from 'date-fns';
import { CarFront, Loader2, LocateFixed, MapPin, Mountain, Search, Star } from 'lucide-react';
import { trpc } from '@/providers/trpc';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { PlaceImg } from '@/components/PlaceImg';
import { toast } from '@/components/explore/toast';
import { STYLE_CHIPS, stylesForChips } from '@/components/onboarding/quiz-data';
import { cn } from '@/lib/utils';

type AroundMePlace = {
  id: number;
  name: string;
  city: string;
  country: string;
  category: string;
  tags: string[] | null;
  rating: number | null;
  image: string | null;
  lat: number;
  lng: number;
  distKm: number;
  driveMin: number;
  driveKm: number;
  estimated: boolean;
  kind: string;
  scope: 'getaway' | 'nearby';
  score: number;
};

/** "1h 45m" drive label; estimates get the ≈ prefix and an "est." suffix. */
function driveChip(p: { driveMin: number; estimated: boolean }): string {
  const h = Math.floor(p.driveMin / 60);
  const m = p.driveMin % 60;
  const label = h > 0 ? (m > 0 ? `${h}h ${m}m` : `${h}h`) : `${m}m`;
  return p.estimated ? `≈${label} est.` : label;
}

export default function AroundYou({ profileStyles }: { profileStyles: string[] }) {
  const navigate = useNavigate();
  const utils = trpc.useUtils();

  // ── location state ────────────────────────────────────────────────────────
  const [coords, setCoords] = useState<{ lat: number; lng: number; label: string } | null>(null);
  const [locState, setLocState] = useState<'idle' | 'locating' | 'denied'>('idle');
  const [cityQuery, setCityQuery] = useState('');
  const [cityBusy, setCityBusy] = useState(false);

  // ── preference chips (pre-selected from the onboarding style profile) ────
  const [chips, setChips] = useState<string[]>([]);
  const [chipsTouched, setChipsTouched] = useState(false);
  useEffect(() => {
    if (chipsTouched || profileStyles.length === 0) return;
    const pre = STYLE_CHIPS.filter((c) => profileStyles.includes(c.style)).map((c) => c.id);
    if (pre.length > 0) setChips(pre);
  }, [profileStyles, chipsTouched]);
  const styles = useMemo(() => stylesForChips(chips), [chips]);

  // ── results ───────────────────────────────────────────────────────────────
  const aroundQ = trpc.getaways.aroundMe.useQuery(
    { lat: coords?.lat ?? 0, lng: coords?.lng ?? 0, styles, limit: 12 },
    { enabled: coords != null, staleTime: 30 * 60 * 1000, placeholderData: keepPreviousData },
  );
  const places = (aroundQ.data?.places ?? []) as AroundMePlace[];

  function locate() {
    if (!('geolocation' in navigator)) {
      setLocState('denied');
      return;
    }
    setLocState('locating');
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setCoords({ lat: pos.coords.latitude, lng: pos.coords.longitude, label: 'you' });
        setLocState('idle');
      },
      () => setLocState('denied'),
      { timeout: 10_000, maximumAge: 10 * 60 * 1000 },
    );
  }

  async function searchCity() {
    const q = cityQuery.trim();
    if (q.length < 2 || cityBusy) return;
    setCityBusy(true);
    try {
      // The near() anchor doubles as our geocoder - and it's 30-day cached.
      const res = await utils.getaways.near.fetch({ city: q });
      setCoords({ lat: res.anchor.lat, lng: res.anchor.lng, label: res.anchor.city ?? q });
      setLocState('idle');
    } catch {
      toast(`We couldn't find “${q}”, try a nearby larger town.`, { kind: 'warn' });
    } finally {
      setCityBusy(false);
    }
  }

  function toggleChip(id: string) {
    setChipsTouched(true);
    setChips((prev) => (prev.includes(id) ? prev.filter((c) => c !== id) : [...prev, id]));
  }

  // ── plan-a-trip CTA ───────────────────────────────────────────────────────
  const [planningId, setPlanningId] = useState<number | null>(null);
  const createTrip = trpc.trips.create.useMutation();
  const addToTrip = trpc.explore.addToTrip.useMutation();

  async function planTrip(p: AroundMePlace) {
    if (planningId != null) return;
    setPlanningId(p.id);
    try {
      const start = addDays(new Date(), 21);
      const { id } = await createTrip.mutateAsync({
        title: `${p.name} · ${p.scope === 'getaway' ? 'getaway' : 'day out'}`,
        destination: `${p.city}, ${p.country}`,
        startDate: format(start, 'yyyy-MM-dd'),
        endDate: format(addDays(start, 2), 'yyyy-MM-dd'),
        coverImage: p.image ?? undefined,
      });
      try {
        await addToTrip.mutateAsync({ placeId: p.id, tripId: id, dayId: null });
      } catch {
        /* the trip exists even if the stop didn't attach */
      }
      void utils.trips.list.invalidate();
      toast('Trip created, make it yours', { kind: 'success' });
      navigate(`/trips/${id}`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : '';
      if (msg.includes('UPGRADE_REQUIRED')) {
        toast('The free Wanderer tier allows 3 active trips', {
          kind: 'warn',
          action: { label: 'Upgrade', onClick: () => navigate('/pricing') },
        });
      } else if (msg.includes('UNAUTHORIZED') || msg.includes('unauthenticated')) {
        navigate('/login');
      } else {
        toast('Could not start that trip, please try again.', { kind: 'warn' });
      }
    } finally {
      setPlanningId(null);
    }
  }

  // ── render ────────────────────────────────────────────────────────────────
  return (
    <section className="mt-8" aria-label="Trips around you">
      <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="type-h3 flex items-center gap-2 text-ink">
            <LocateFixed className="h-5 w-5 text-pine" strokeWidth={1.75} />
            Trips around {coords ? coords.label : 'you'}
          </h2>
          <p className="type-small mt-1 text-ink-3">
            Getaways within ~2 hours and the best-rated spots nearby, matched to what you like.
          </p>
        </div>
        {coords && (
          <button
            type="button"
            onClick={() => {
              setCoords(null);
              setLocState('idle');
            }}
            className="type-caption font-semibold text-brand hover:underline"
          >
            Change location
          </button>
        )}
      </div>

      {/* preference chips */}
      <div className="mb-4 flex flex-wrap gap-2">
        {STYLE_CHIPS.map((chip) => {
          const active = chips.includes(chip.id);
          const Icon = chip.icon;
          return (
            <button
              key={chip.id}
              type="button"
              onClick={() => toggleChip(chip.id)}
              aria-pressed={active}
              className={cn(
                'type-caption flex items-center gap-1.5 rounded-pill border px-3 py-1.5 font-semibold transition-colors duration-fast',
                active
                  ? 'border-brand bg-brand-soft text-brand'
                  : 'border-border bg-surface text-ink-2 hover:border-brand/40',
              )}
            >
              <Icon className="h-3.5 w-3.5" strokeWidth={1.75} />
              {chip.label}
            </button>
          );
        })}
      </div>

      {/* locate / fallback search */}
      {!coords && (
        <div className="flex flex-col gap-4 rounded-xl border border-border bg-surface p-6 shadow-sm sm:flex-row sm:items-center">
          <Button pill size="lg" onClick={locate} disabled={locState === 'locating'} className="shrink-0">
            {locState === 'locating' ? (
              <Loader2 className="h-4 w-4 animate-spin" strokeWidth={1.75} />
            ) : (
              <LocateFixed className="h-4 w-4" strokeWidth={1.75} />
            )}
            {locState === 'locating' ? 'Locating…' : 'Use my location'}
          </Button>
          <div className="flex min-w-0 flex-1 items-center gap-2">
            <div className="relative min-w-0 flex-1">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-3" strokeWidth={1.75} />
              <input
                value={cityQuery}
                onChange={(e) => setCityQuery(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') void searchCity();
                }}
                placeholder={
                  locState === 'denied'
                    ? 'Location unavailable, search your city instead'
                    : 'or type your city'
                }
                aria-label="Search your city"
                className="type-small h-11 w-full rounded-pill border border-border bg-surface pl-9 pr-4 text-ink placeholder:text-ink-3 focus:border-brand focus:outline-none"
              />
            </div>
            <Button pill variant="outline" onClick={() => void searchCity()} disabled={cityBusy || cityQuery.trim().length < 2}>
              {cityBusy ? <Loader2 className="h-4 w-4 animate-spin" strokeWidth={1.75} /> : 'Search'}
            </Button>
          </div>
          {locState === 'denied' && (
            <p className="type-caption text-ink-3 sm:w-48">
              We couldn't access your location, no problem, a city name works just as well.
            </p>
          )}
        </div>
      )}

      {/* loading */}
      {coords && aroundQ.isLoading && (
        <div className="flex gap-4 overflow-hidden">
          {Array.from({ length: 4 }, (_, i) => (
            <div key={i} className="w-44 shrink-0 overflow-hidden rounded-lg border border-border bg-surface shadow-sm sm:w-48">
              <Skeleton className="aspect-[4/3] w-full rounded-none" />
              <div className="space-y-2 p-3">
                <Skeleton className="h-4 w-2/3" />
                <Skeleton className="h-3 w-1/2" />
                <Skeleton className="h-8 w-full" />
              </div>
            </div>
          ))}
        </div>
      )}

      {/* empty */}
      {coords && !aroundQ.isLoading && aroundQ.data && places.length === 0 && (
        <div className="rounded-xl border border-dashed border-border bg-surface px-6 py-10 text-center">
          <Mountain className="mx-auto h-6 w-6 text-ink-3" strokeWidth={1.75} />
          <h3 className="type-h3 mt-2 text-ink">Nothing mapped around {coords.label} yet</h3>
          <p className="type-small mx-auto mt-1 max-w-[52ch] text-ink-2">
            Try widening your picks above, or search a bigger nearby city, new regions are mapped
            from OpenStreetMap every month.
          </p>
        </div>
      )}

      {/* cards */}
      {coords && places.length > 0 && (
        <div className="-mx-1 flex snap-x snap-mandatory gap-4 overflow-x-auto px-1 pb-2">
          {places.map((p) => (
            <article
              key={p.id}
              className="group relative w-44 shrink-0 snap-start overflow-hidden rounded-lg border border-border bg-surface shadow-sm transition-all duration-fast hover:-translate-y-0.5 hover:shadow-md sm:w-48"
            >
              <div className="relative aspect-[4/3] w-full overflow-hidden bg-surface-2">
                <PlaceImg place={p} className="photo h-full w-full object-cover" alt="" />
                <span className="type-caption absolute bottom-2 left-2 flex items-center gap-1 rounded-pill bg-surface/90 px-2 py-0.5 font-semibold text-ink shadow-sm backdrop-blur-sm">
                  <CarFront className="h-3 w-3 text-pine" strokeWidth={2} />
                  <span className="tnum">{driveChip(p)}</span>
                </span>
                {p.scope === 'getaway' && (
                  <span className="type-caption absolute right-2 top-2 rounded-pill bg-pine/90 px-2 py-0.5 font-semibold text-white shadow-sm">
                    getaway
                  </span>
                )}
              </div>
              <div className="p-3">
                <p className="type-small truncate font-semibold text-ink" title={p.name}>
                  {p.name}
                </p>
                <p className="type-caption mt-1 flex items-center gap-1.5 text-ink-3">
                  <span className="rounded-pill bg-surface-2 px-1.5 py-px text-[10px] font-semibold capitalize text-ink-2">
                    {p.kind}
                  </span>
                  {p.rating != null && (
                    <span className="flex items-center gap-0.5">
                      <Star className="h-3 w-3 fill-amber-400 text-amber-400" strokeWidth={1.5} />
                      <span className="tnum">{p.rating.toFixed(1)}</span>
                    </span>
                  )}
                  <span className="flex items-center gap-0.5 truncate">
                    <MapPin className="h-3 w-3" strokeWidth={1.75} />
                    {Math.round(p.distKm)} km
                  </span>
                </p>
                <Button
                  pill
                  size="sm"
                  variant="outline"
                  className="mt-2.5 w-full"
                  disabled={planningId != null}
                  onClick={() => void planTrip(p)}
                >
                  {planningId === p.id ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" strokeWidth={1.75} />
                  ) : null}
                  Plan a trip here
                </Button>
              </div>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}
