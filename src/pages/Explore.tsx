/**
 * Explore (/explore) - the personalized recommendation feed (explore.md).
 * Places arrive scored server-side from the user's Taste Profile
 * (trpc.explore.list → matchScore / matchStyles). Sections: personalization
 * header with retunable taste chips, sticky filter rail, FLIP-filtered place
 * grid with add-to-trip + bucket-list saves, curated rails, map peek, and
 * the community itineraries strip.
 */
import { useMemo, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { keepPreviousData } from '@tanstack/react-query';
import { AnimatePresence, motion } from 'framer-motion';
import { addDays, format } from 'date-fns';
import { ArrowRight, Compass } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Skeleton } from '@/components/ui/skeleton';
import { trpc } from '@/providers/trpc';
import { cn } from '@/lib/utils';
import { ToastHost, toast } from '@/components/explore/toast';
import TasteHeader from '@/components/explore/TasteHeader';
import FilterRail from '@/components/explore/FilterRail';
import type { SortId } from '@/components/explore/FilterRail';
import PlaceCard from '@/components/explore/PlaceCard';
import PlaceDetailDialog from '@/components/explore/PlaceDetailDialog';
import CuratedRails, { CommunityStrip } from '@/components/explore/Rails';
import FamousStrip from '@/components/explore/FamousStrip';
import AroundYou from '@/components/explore/AroundYou';
import MapPeek from '@/components/explore/MapPeek';
import BrowseWorld from '@/components/explore/BrowseWorld';
import RetuneDialog from '@/components/explore/RetuneDialog';
import type { ExploreCity, ExplorePlaceItem } from '@/components/explore/explore-utils';
import { CATEGORY_FILTERS, planDaysFor, planTitle, tastePhrase } from '@/components/explore/explore-utils';

const EASE_EXPO = [0.22, 1, 0.36, 1] as [number, number, number, number];

function GridSkeleton() {
  return (
    <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
      {Array.from({ length: 6 }, (_, i) => (
        <div key={i} className="overflow-hidden rounded-lg border border-border bg-surface shadow-sm">
          <Skeleton className="aspect-[4/3] w-full rounded-none" />
          <div className="space-y-2 p-4">
            <Skeleton className="h-4 w-2/3" />
            <Skeleton className="h-3 w-1/2" />
            <Skeleton className="h-3 w-3/4" />
            <Skeleton className="mt-2 h-8 w-28" />
          </div>
        </div>
      ))}
    </div>
  );
}

export default function Explore() {
  const navigate = useNavigate();
  const utils = trpc.useUtils();

  // ── data ──────────────────────────────────────────────────────────────────
  const prefsQ = trpc.preferences.get.useQuery();
  const [activeStyle, setActiveStyle] = useState<string | null>(null);
  const [city, setCity] = useState<string | null>(null);
  const listQ = trpc.explore.list.useQuery(
    { style: activeStyle ?? undefined, city: city ?? undefined },
    { placeholderData: keepPreviousData },
  );
  const citiesQ = trpc.explore.cities.useQuery();
  const bucketQ = trpc.explore.bucketList.useQuery();

  // ── local filter / UI state ───────────────────────────────────────────────
  const [category, setCategory] = useState('all');
  const [budgets, setBudgets] = useState<number[]>([]);
  const [sort, setSort] = useState<SortId>('match');
  const [query, setQuery] = useState('');
  const [retuneOpen, setRetuneOpen] = useState(false);
  const [detail, setDetail] = useState<ExplorePlaceItem | null>(null);
  const [planCity, setPlanCity] = useState<ExploreCity | null>(null);
  const [busyCity, setBusyCity] = useState<string | null>(null);
  const [flashId, setFlashId] = useState<number | null>(null);
  const mapSectionRef = useRef<HTMLDivElement>(null);

  const prefs = prefsQ.data;
  const styles = prefs?.styles ?? [];
  const places = useMemo(() => listQ.data?.places ?? [], [listQ.data]);
  const cities = useMemo(() => citiesQ.data ?? [], [citiesQ.data]);

  // ── bucket list ───────────────────────────────────────────────────────────
  const bucketItems = useMemo(() => bucketQ.data ?? [], [bucketQ.data]);
  const addBucket = trpc.explore.addBucket.useMutation({
    onSuccess: () => void utils.explore.bucketList.invalidate(),
    onError: () => toast('Could not save, please try again.', { kind: 'warn' }),
  });
  const removeBucket = trpc.explore.removeBucket.useMutation({
    onSuccess: () => void utils.explore.bucketList.invalidate(),
    onError: () => toast('Could not remove, please try again.', { kind: 'warn' }),
  });

  const savedItem = (p: ExplorePlaceItem) =>
    bucketItems.find((b) => b.name === p.name && b.country?.includes(p.country));

  function toggleSave(place: ExplorePlaceItem) {
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
      toast('Saved to bucket list', {
        kind: 'success',
        action: { label: 'View', onClick: () => navigate('/trips') },
      });
    }
  }

  // ── filter + sort pipeline (client-side, FLIP-animated) ──────────────────
  const q = query.trim().toLowerCase();
  const filtered = useMemo(() => {
    const cat = CATEGORY_FILTERS.find((c) => c.id === category) ?? CATEGORY_FILTERS[0]!;
    let out = places.filter(cat.match);
    if (budgets.length > 0) {
      out = out.filter((p) =>
        budgets.some((b) => (b === 3 ? (p.priceLevel ?? 2) >= 3 : (p.priceLevel ?? 2) === b)),
      );
    }
    if (q) {
      out = out.filter((p) =>
        `${p.name} ${p.city} ${p.country} ${(p.tags ?? []).join(' ')}`.toLowerCase().includes(q),
      );
    }
    const sorted = [...out];
    if (sort === 'rating') sorted.sort((a, b) => (b.rating ?? 0) - (a.rating ?? 0));
    else if (sort === 'hidden')
      sorted.sort((a, b) => Number(b.hidden) - Number(a.hidden) || b.matchScore - a.matchScore);
    else sorted.sort((a, b) => b.matchScore - a.matchScore);
    return sorted;
  }, [places, category, budgets, q, sort]);

  function clearFilters() {
    setCategory('all');
    setBudgets([]);
    setSort('match');
    setQuery('');
    setCity(null);
    setActiveStyle(null);
  }

  // ── ready-made plan copying ───────────────────────────────────────────────
  const createTrip = trpc.trips.create.useMutation();
  const addToTrip = trpc.explore.addToTrip.useMutation();

  async function confirmUsePlan() {
    const c = planCity;
    if (!c) return;
    setPlanCity(null);
    setBusyCity(c.city);
    try {
      const days = planDaysFor(c.count);
      const start = addDays(new Date(), 21);
      const { id } = await createTrip.mutateAsync({
        title: planTitle(c, styles),
        destination: `${c.city}, ${c.country}`,
        startDate: format(start, 'yyyy-MM-dd'),
        endDate: format(addDays(start, days - 1), 'yyyy-MM-dd'),
        coverImage: c.image ?? undefined,
      });
      const [tripDetail, cityFeed] = await Promise.all([
        utils.trips.get.fetch({ id }),
        utils.explore.list.fetch({ city: c.city }),
      ]);
      const dayIds = tripDetail.days.map((d) => d.id);
      const top = cityFeed.places.filter((p) => p.city === c.city).slice(0, days * 3);
      for (let i = 0; i < top.length; i++) {
        await addToTrip.mutateAsync({
          placeId: top[i]!.id,
          tripId: id,
          dayId: dayIds.length > 0 ? dayIds[i % dayIds.length]! : null,
        });
      }
      void utils.trips.list.invalidate();
      void utils.trips.get.invalidate({ id });
      toast('Plan copied, make it yours', { kind: 'success' });
      navigate(`/trips/${id}`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : '';
      if (msg.includes('UPGRADE_REQUIRED')) {
        toast('The free Wanderer tier allows 3 active trips', {
          kind: 'warn',
          action: { label: 'Upgrade', onClick: () => navigate('/pricing') },
        });
      } else {
        toast('Could not copy that plan, please try again.', { kind: 'warn' });
      }
    } finally {
      setBusyCity(null);
    }
  }

  function viewOnMap(place: ExplorePlaceItem) {
    setDetail(null);
    setFlashId(place.id);
    mapSectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }

  const reason = tastePhrase(styles);
  const isLoading = listQ.isLoading;

  return (
    <div className="pb-20">
      {/* ── S1 personalization header ───────────────────────────────────── */}
      <div className="mx-auto max-w-[1200px] px-4 pt-8 sm:px-6 md:pt-10 lg:px-10">
        {prefsQ.isLoading ? (
          <div className="space-y-4">
            <Skeleton className="h-3 w-20" />
            <Skeleton className="h-10 w-full max-w-[520px]" />
            <div className="flex gap-2">
              {[1, 2, 3, 4].map((i) => (
                <Skeleton key={i} className="h-8 w-24 rounded-pill" />
              ))}
            </div>
          </div>
        ) : (
          <TasteHeader
            archetype={prefs?.archetype ?? null}
            styles={styles}
            interests={prefs?.interests ?? []}
            onboardingDone={prefs?.onboardingDone ?? false}
            activeStyle={activeStyle}
            onToggleStyle={(s) => setActiveStyle((cur) => (cur === s ? null : s))}
            onRetune={() => setRetuneOpen(true)}
            query={query}
            onQuery={setQuery}
            cities={cities}
            places={places}
            onPickCity={(c) => {
              setCity(c);
              setQuery('');
            }}
            onPickPlace={(p) => {
              setDetail(p);
              setQuery('');
            }}
          />
        )}

        {/* city builder hook, query maps to few/no corpus places */}
        {q.length >= 2 &&
          (!cities.some((c) => `${c.city} ${c.country}`.toLowerCase().includes(q)) ||
            filtered.length <= 2) && (
            <Link
              to={`/city/${encodeURIComponent(query.trim())}`}
              className="mt-4 flex items-center gap-3 rounded-xl border border-dashed border-brand/40 bg-brand-soft/40 px-4 py-3 transition-colors duration-fast hover:bg-brand-soft"
            >
              <Compass className="h-5 w-5 shrink-0 text-brand" strokeWidth={1.75} />
              <span className="type-small text-ink">
                Don’t see <span className="font-semibold">{query.trim()}</span>? Open the city builder,
                we’ll map it live from OpenStreetMap.
              </span>
              <ArrowRight className="ml-auto h-4 w-4 shrink-0 text-brand" strokeWidth={1.75} />
            </Link>
          )}

        {/* personalization prompt when the quiz hasn't been taken */}
        {prefs && !prefs.onboardingDone && (
          <motion.section
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.32, ease: EASE_EXPO, delay: 0.15 }}
            className="mt-6 flex flex-col items-start gap-5 rounded-xl border border-border bg-surface p-6 shadow-sm sm:flex-row sm:items-center"
          >
            <img
              src="/onb-compass.svg"
              alt=""
              className="hidden w-[150px] shrink-0 sm:block"
              loading="lazy"
            />
            <div className="min-w-0 flex-1">
              <h3 className="type-h3 text-ink">Your taste profile lives here.</h3>
              <p className="type-body mt-1 max-w-[52ch] text-ink-2">
                Answer five quick questions and Explore re-sorts itself around your travel style,
                food-first, hidden-gem hunting, slow mornings, all of it.
              </p>
            </div>
            <Button pill size="lg" onClick={() => navigate('/onboarding')} className="shrink-0">
              Take the 1-minute quiz
              <ArrowRight className="h-4 w-4" strokeWidth={1.75} />
            </Button>
          </motion.section>
        )}
      </div>

      {/* ── S1b trips around you (r14-nearby) ───────────────────────────── */}
      <div className="mx-auto max-w-[1200px] px-4 sm:px-6 lg:px-10">
        <AroundYou profileStyles={styles} />
      </div>

      {/* ── S2 filter rail (sticky) ─────────────────────────────────────── */}
      <FilterRail
        category={category}
        onCategory={setCategory}
        budgets={budgets}
        onToggleBudget={(level) =>
          setBudgets((prev) =>
            prev.includes(level) ? prev.filter((b) => b !== level) : [...prev, level],
          )
        }
        city={city}
        onCity={setCity}
        cities={cities}
        sort={sort}
        onSort={setSort}
      />

      {/* ── S3 recommendation grid ──────────────────────────────────────── */}
      <div className="mx-auto max-w-[1200px] px-4 sm:px-6 lg:px-10">
        {/* additive: famous-in-city rail while a city filter is active */}
        {city && <FamousStrip city={city} onOpen={setDetail} />}
        <section className="mt-8" aria-label="Recommendations">
          <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
            <div>
              <h2 className="type-h3 text-ink">
                {reason ? `Because you love ${reason}` : 'Recommended for you'}
              </h2>
              <p className="type-small mt-1 text-ink-3">
                {activeStyle
                  ? `Hard-filtered by your ${activeStyle} taste`
                  : 'Sorted by how well each place fits your profile'}
              </p>
            </div>
            {(category !== 'all' || budgets.length > 0 || city || q || activeStyle) && (
              <button
                type="button"
                onClick={clearFilters}
                className="type-small inline-flex items-center gap-1 font-semibold text-brand transition-colors duration-fast hover:text-brand-strong"
              >
                See all
                <ArrowRight className="h-3.5 w-3.5" strokeWidth={1.75} />
              </button>
            )}
          </div>

          {isLoading ? (
            <GridSkeleton />
          ) : filtered.length === 0 ? (
            <div className="flex flex-col items-center rounded-xl border border-border bg-surface px-6 py-12 text-center">
              <img src="/empty-globe.svg" alt="" className="w-[200px]" loading="lazy" />
              <h3 className="type-h3 mt-5 text-ink">Nothing matches those filters</h3>
              <p className="type-body mt-2 max-w-[42ch] text-ink-2">
                Try widening the budget, clearing the city, or exploring another category.
              </p>
              <Button pill className="mt-5" onClick={clearFilters}>
                Clear filters
              </Button>
            </div>
          ) : (
            <motion.div layout className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
              <AnimatePresence mode="popLayout">
                {filtered.map((place, i) => (
                  <motion.div
                    key={place.id}
                    layout
                    initial={{ opacity: 0, y: 24 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, scale: 0.96, transition: { duration: 0.2 } }}
                    transition={{
                      duration: 0.32,
                      ease: EASE_EXPO,
                      delay: Math.min(i, 8) * 0.05,
                      layout: { duration: 0.4, ease: EASE_EXPO },
                    }}
                    className={cn(listQ.isFetching && 'pointer-events-none opacity-90')}
                  >
                    <PlaceCard
                      place={place}
                      saved={savedItem(place) != null}
                      saveBusy={addBucket.isPending || removeBucket.isPending}
                      onToggleSave={() => toggleSave(place)}
                      onOpenDetail={() => setDetail(place)}
                    />
                  </motion.div>
                ))}
              </AnimatePresence>
            </motion.div>
          )}
        </section>

        {/* ── S4 curated rails ────────────────────────────────────────── */}
        <div className="mt-14 space-y-14">
          <CuratedRails
            places={places}
            cities={cities}
            styles={styles}
            activeCity={city}
            onUsePlan={setPlanCity}
            busyCity={busyCity}
          />
        </div>
      </div>

      {/* ── S5 map peek ─────────────────────────────────────────────────── */}
      <div ref={mapSectionRef} className="mt-14 scroll-mt-20">
        {listQ.isLoading ? (
          <Skeleton className="h-[480px] w-full rounded-none" />
        ) : (
          <MapPeek places={filtered} flashId={flashId} onFlashDone={() => setFlashId(null)} />
        )}
      </div>

      {/* ── S6 community itineraries strip ──────────────────────────────── */}
      <div className="mx-auto mt-14 max-w-[1200px] px-4 sm:px-6 lg:px-10">
        <CommunityStrip cities={cities} styles={styles} onUsePlan={setPlanCity} busyCity={busyCity} />
      </div>

      {/* ── S7 browse the world directory (region → country → city) ─────── */}
      <div className="mx-auto max-w-[1200px] px-4 sm:px-6 lg:px-10">
        <BrowseWorld />
      </div>

      {/* ── dialogs, overlays ───────────────────────────────────────────── */}
      <PlaceDetailDialog
        place={detail}
        saved={detail ? savedItem(detail) != null : false}
        budgetBand={listQ.data?.preferences?.budgetBand ?? null}
        onClose={() => setDetail(null)}
        onToggleSave={toggleSave}
        onViewOnMap={viewOnMap}
      />

      <RetuneDialog open={retuneOpen} onOpenChange={setRetuneOpen} />

      <Dialog open={planCity != null} onOpenChange={(o) => !o && setPlanCity(null)}>
        <DialogContent className="max-w-[440px] rounded-xl">
          <DialogHeader>
            <DialogTitle className="type-h3 text-ink">Copy to your trips?</DialogTitle>
            <DialogDescription className="type-body text-ink-2">
              {planCity
                ? `We'll create a draft trip “${planTitle(planCity, styles)}” with ${planDaysFor(planCity.count)} days prefilled from our ${planCity.city} picks.`
                : ''}
            </DialogDescription>
          </DialogHeader>
          {planCity?.image && (
            <div className="overflow-hidden rounded-lg">
              <img src={planCity.image} alt="" className="photo h-36 w-full object-cover" />
            </div>
          )}
          <DialogFooter className="gap-2">
            <Button variant="ghost" onClick={() => setPlanCity(null)}>
              Cancel
            </Button>
            <Button onClick={() => void confirmUsePlan()}>Copy plan</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ToastHost />
    </div>
  );
}
