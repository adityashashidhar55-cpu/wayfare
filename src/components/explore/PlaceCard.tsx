/**
 * Explore place card (explore.md §S3): 4:3 photo, glass category chip,
 * bookmark save with pop micro-interaction, rating/price/meta, "Matches your
 * taste" line, Add-to-trip popover with day picker + button morph +
 * shared-element fly toward the sidebar + toast with Undo.
 */
import { useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Link } from 'react-router';
import { motion } from 'framer-motion';
import { format } from 'date-fns';
import {
  Bookmark,
  Check,
  ChevronRight,
  CornerUpLeft,
  Gem,
  Hourglass,
  Info,
  Loader2,
  MapPin,
  Sparkles,
  Star,
  Ticket,
} from 'lucide-react';
import { formatMoney } from '@contracts/fx';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { dayColor } from '@/lib/map';
import { dietBadge } from '@/lib/diet';
import { placeImageFor, poolImageFor } from '@/lib/place-images';
import { trpc } from '@/providers/trpc';
import { cn } from '@/lib/utils';
import { toast } from '@/components/explore/toast';
import FamousPickBadge from '@/components/explore/FamousPickBadge';
import { useIsDark } from '@/components/explore/useIsDark';
import type { ExplorePlaceItem } from '@/components/explore/explore-utils';
import { categoryLabel, tastePhrase } from '@/components/explore/explore-utils';

const EASE_EXPO = [0.22, 1, 0.36, 1] as [number, number, number, number];

export interface AddedInfo {
  tripId: number;
  tripTitle: string;
  dayId: number | null;
  dayLabel: string;
  stopId: number | null;
}

// ── bookmark save (bucket list) ─────────────────────────────────────────────
export function SaveButton({
  saved,
  busy,
  onClick,
  className,
}: {
  saved: boolean;
  busy?: boolean;
  onClick: () => void;
  className?: string;
}) {
  return (
    <motion.button
      type="button"
      whileTap={{ scale: 0.88 }}
      onClick={onClick}
      disabled={busy}
      aria-label={saved ? 'Remove from bucket list' : 'Save to bucket list'}
      className={cn(
        'glass flex h-8 w-8 items-center justify-center rounded-full text-ink shadow-sm transition-colors duration-fast hover:text-brand',
        className,
      )}
    >
      <motion.span
        key={String(saved)}
        initial={{ scale: 0.55 }}
        animate={{ scale: 1 }}
        transition={{ type: 'spring', stiffness: 500, damping: 28 }}
        className="flex"
      >
        <Bookmark
          className={cn('h-4 w-4 transition-colors duration-fast', saved ? 'fill-brand text-brand' : '')}
          strokeWidth={1.75}
        />
      </motion.span>
    </motion.button>
  );
}

// ── add-to-trip popover ─────────────────────────────────────────────────────
export function AddToTripButton({
  place,
  added,
  onAdded,
  className,
}: {
  place: ExplorePlaceItem;
  added: AddedInfo | null;
  onAdded: (info: AddedInfo) => void;
  className?: string;
}) {
  const utils = trpc.useUtils();
  const isDark = useIsDark();
  const [open, setOpen] = useState(false);
  const [tripId, setTripId] = useState<number | null>(null);

  const tripsQ = trpc.trips.list.useQuery(undefined, { enabled: open });
  const detailQ = trpc.trips.get.useQuery({ id: tripId ?? 0 }, { enabled: open && tripId != null });

  const addMut = trpc.explore.addToTrip.useMutation({
    onSuccess: (data, vars) => {
      void utils.trips.get.invalidate({ id: vars.tripId });
      void utils.trips.list.invalidate();
      const trips = tripsQ.data?.trips ?? [];
      const trip = trips.find((t) => t.id === vars.tripId);
      const days = detailQ.data?.days ?? [];
      const dayIdx = days.findIndex((d) => d.id === vars.dayId);
      onAdded({
        tripId: vars.tripId,
        tripTitle: trip?.title ?? 'your trip',
        dayId: vars.dayId,
        dayLabel: dayIdx >= 0 ? `Day ${dayIdx + 1}` : 'Unscheduled',
        stopId: data.ok && 'stopId' in data ? (data.stopId ?? null) : null,
      });
      setOpen(false);
      setTripId(null);
    },
    onError: () => toast('Could not add that place, please try again.', { kind: 'warn' }),
  });

  const trips = tripsQ.data?.trips ?? [];
  const sortedTrips = [...trips].sort((a, b) => (a.status === b.status ? 0 : a.status === 'upcoming' ? -1 : 1));
  const detail = detailQ.data;
  const stops = detail?.stops ?? [];

  return (
    <Popover
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (!o) setTripId(null);
      }}
    >
      <PopoverTrigger asChild>
        <Button
          size="sm"
          variant={added ? 'pine' : 'primary'}
          className={cn('transition-colors [transition-duration:250ms]', className)}
        >
          {addMut.isPending ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" strokeWidth={2} />
          ) : added ? (
            <Check className="h-3.5 w-3.5" strokeWidth={2} />
          ) : null}
          {added ? `Added to ${added.dayLabel}` : 'Add to trip'}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-72 rounded-lg p-2">
        {tripId == null ? (
          <>
            <p className="type-caption px-2 pb-1 pt-1.5 text-ink-3">ADD TO TRIP</p>
            {tripsQ.isLoading ? (
              <div className="flex items-center justify-center py-6">
                <Loader2 className="h-4 w-4 animate-spin text-ink-3" strokeWidth={2} />
              </div>
            ) : sortedTrips.length === 0 ? (
              <div className="px-2 py-3 text-center">
                <p className="type-small text-ink-2">No trips yet, start one first.</p>
                <Button asChild variant="ghost" size="sm" className="mt-1 text-brand">
                  <Link to="/trips">Create a trip</Link>
                </Button>
              </div>
            ) : (
              <ul className="max-h-64 overflow-y-auto">
                {sortedTrips.map((t) => (
                  <li key={t.id}>
                    <button
                      type="button"
                      onClick={() => setTripId(t.id)}
                      className="group flex w-full items-center gap-2 rounded-md px-2 py-2 text-left transition-colors duration-fast hover:bg-surface-2"
                    >
                      <span className="min-w-0 flex-1">
                        <span className="type-small block truncate font-semibold text-ink">{t.title}</span>
                        <span className="type-caption block truncate text-ink-3">
                          {t.destination}
                          {t.startDate ? ` · ${format(new Date(`${t.startDate}T00:00:00`), 'MMM d')}` : ''}
                        </span>
                      </span>
                      <ChevronRight className="h-4 w-4 shrink-0 text-ink-3 transition-transform duration-fast group-hover:translate-x-0.5" strokeWidth={1.75} />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </>
        ) : (
          <>
            <button
              type="button"
              onClick={() => setTripId(null)}
              className="type-caption flex items-center gap-1 rounded-sm px-2 pb-1 pt-1.5 text-ink-3 transition-colors hover:text-ink"
            >
              <CornerUpLeft className="h-3 w-3" strokeWidth={1.75} />
              {detail?.trip.title ?? 'Back'}
            </button>
            {detailQ.isLoading ? (
              <div className="flex items-center justify-center py-6">
                <Loader2 className="h-4 w-4 animate-spin text-ink-3" strokeWidth={2} />
              </div>
            ) : (
              <ul className="max-h-64 overflow-y-auto">
                {(detail?.days ?? []).map((day, i) => {
                  const count = stops.filter((s) => s.dayId === day.id).length;
                  return (
                    <li key={day.id}>
                      <button
                        type="button"
                        disabled={addMut.isPending}
                        onClick={() => addMut.mutate({ placeId: place.id, tripId, dayId: day.id })}
                        className="flex w-full items-center gap-2.5 rounded-md px-2 py-2 text-left transition-colors duration-fast hover:bg-surface-2 disabled:opacity-50"
                      >
                        <span
                          className="h-2.5 w-2.5 shrink-0 rounded-full"
                          style={{ background: dayColor(i + 1, isDark) }}
                        />
                        <span className="min-w-0 flex-1">
                          <span className="type-small block font-semibold text-ink">Day {i + 1}</span>
                          <span className="type-caption block text-ink-3">
                            {format(new Date(`${day.date}T00:00:00`), 'EEE, MMM d')}
                            {count > 0 ? ` · ${count} stop${count === 1 ? '' : 's'}` : ''}
                          </span>
                        </span>
                      </button>
                    </li>
                  );
                })}
                <li>
                  <button
                    type="button"
                    disabled={addMut.isPending}
                    onClick={() => addMut.mutate({ placeId: place.id, tripId, dayId: null })}
                    className="flex w-full items-center gap-2.5 rounded-md px-2 py-2 text-left transition-colors duration-fast hover:bg-surface-2 disabled:opacity-50"
                  >
                    <span className="h-2.5 w-2.5 shrink-0 rounded-full border border-dashed border-ink-3" />
                    <span className="type-small min-w-0 flex-1 font-semibold text-ink">Unscheduled</span>
                  </button>
                </li>
              </ul>
            )}
          </>
        )}
      </PopoverContent>
    </Popover>
  );
}

// ── the card ────────────────────────────────────────────────────────────────
interface PlaceCardProps {
  place: ExplorePlaceItem;
  saved: boolean;
  saveBusy?: boolean;
  onToggleSave: () => void;
  onOpenDetail: () => void;
}

export default function PlaceCard({ place, saved, saveBusy, onToggleSave, onOpenDetail }: PlaceCardProps) {
  const utils = trpc.useUtils();
  const meQ = trpc.auth.me.useQuery();
  const imgWrapRef = useRef<HTMLDivElement>(null);
  const [fly, setFly] = useState<{ from: DOMRect; to: DOMRect } | null>(null);
  const [added, setAdded] = useState<AddedInfo | null>(null);
  /** own photo → deterministic tag-pool photo → gradient/pin placeholder */
  const img = placeImageFor(place);
  const [loadedSrc, setLoadedSrc] = useState<string | null>(null);
  const imgLoaded = img != null && loadedSrc === img;

  /** Own submission still waiting for admin validation → ochre "Pending review" badge */
  const pendingMine = !place.approved && place.addedById != null && place.addedById === meQ.data?.id;

  /** Food places: small diet badge from tags/name ("Pure veg" / "Vegan options" / "Veg-friendly") */
  const diet = dietBadge(place);

  const deleteStop = trpc.trips.deleteStop.useMutation({
    onSuccess: (_d, vars) => {
      void utils.trips.get.invalidate({ id: vars.tripId });
      void utils.trips.list.invalidate();
    },
  });

  /** shared-element fly of a mini card clone toward the sidebar Trips item */
  function startFly() {
    const from = imgWrapRef.current?.getBoundingClientRect();
    if (!from) return;
    const targets = Array.from(document.querySelectorAll<HTMLElement>('a[href="/trips"]'));
    const target = targets.find((el) => el.offsetParent !== null) ?? targets[0];
    if (!target) return;
    setFly({ from, to: target.getBoundingClientRect() });
  }

  function handleAdded(info: AddedInfo) {
    setAdded(info);
    startFly();
    toast(`Added to ${info.tripTitle} · ${info.dayLabel}`, {
      kind: 'success',
      action:
        info.stopId != null
          ? {
              label: 'Undo',
              onClick: () => {
                deleteStop.mutate({ id: info.stopId!, tripId: info.tripId });
                setAdded(null);
              },
            }
          : undefined,
    });
  }

  const matchLine =
    place.matchStyles.length > 0
      ? `Matches your ${tastePhrase(place.matchStyles)} taste`
      : place.hidden
        ? 'Hidden gem, few travelers find this'
        : (place.rating ?? 0) >= 4.7
          ? `Top rated in ${place.city}`
          : null;

  return (
    <div className="group flex h-full flex-col overflow-hidden rounded-lg border border-border bg-surface shadow-sm transition-all duration-fast hover:-translate-y-1 hover:shadow-lg">
      {/* photo */}
      <div ref={imgWrapRef} className="relative aspect-[4/3] overflow-hidden bg-surface-2">
        {img ? (
          <img
            src={img}
            alt={place.name}
            loading="lazy"
            onError={e => {
              // r13: dead photo URL → pool fallback → hide (gradient remains)
              const fb = poolImageFor(place);
              const el = e.currentTarget;
              if (fb && el.src !== fb) { el.src = fb; setLoadedSrc(fb); }
              else el.style.display = 'none';
            }}
            onLoad={() => setLoadedSrc(img)}
            className={cn(
              'photo h-full w-full object-cover transition-[opacity,transform] [transition-duration:600ms] ease-expo group-hover:scale-[1.045]',
              imgLoaded ? 'opacity-100' : 'opacity-0',
            )}
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center">
            <MapPin className="h-8 w-8 text-ink-3" strokeWidth={1.5} />
          </div>
        )}
        <span className="glass type-caption absolute left-3 top-3 rounded-pill px-2.5 py-1 text-ink">
          {categoryLabel(place)}
        </span>
        <SaveButton saved={saved} busy={saveBusy} onClick={onToggleSave} className="absolute right-3 top-3" />
        {(place.hidden || pendingMine || diet || place.famousEatery) && (
          <div className="absolute bottom-3 left-3 flex items-center gap-1.5">
            {place.famousEatery && <FamousPickBadge />}
            {diet && (
              <span className="inline-flex items-center gap-1 rounded-pill bg-pine-soft px-2.5 py-1 text-[11px] font-semibold text-pine">
                🌱 {diet.label}
              </span>
            )}
            {place.hidden && (
              <span className="inline-flex items-center gap-1 rounded-pill bg-ochre-soft px-2.5 py-1 text-[11px] font-semibold text-ochre">
                <Gem className="h-3 w-3" strokeWidth={1.75} />
                Hidden gem
              </span>
            )}
            {pendingMine && (
              <span className="inline-flex items-center gap-1 rounded-pill bg-ochre-soft px-2.5 py-1 text-[11px] font-semibold text-ochre">
                <Hourglass className="h-3 w-3" strokeWidth={1.75} />
                Pending review
              </span>
            )}
          </div>
        )}
      </div>

      {/* body */}
      <div className="flex flex-1 flex-col p-4">
        <h3 className="text-[15px] font-semibold leading-snug text-ink">{place.name}</h3>
        {/* researched admission fee (feeNote rides along as a tooltip) */}
        {place.feeCents != null && (
          <p
            className={cn(
              'mt-1 inline-flex items-center gap-1 text-[12px] font-medium',
              place.feeCents > 0 ? 'text-ink-2' : 'text-pine',
            )}
            title={place.feeNote ?? undefined}
          >
            <Ticket className="h-3.5 w-3.5 shrink-0" strokeWidth={1.75} />
            <span className="tnum">
              {place.feeCents > 0 ? formatMoney(place.feeCents, place.feeCurrency ?? 'USD') : 'Free entry'}
            </span>
          </p>
        )}
        <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-0.5">
          {/* Only render a star when we actually have a rating. Places imported
              from OSM have none - showing a filled star with a made-up number
              reads as social proof the place never earned. */}
          {place.rating != null && (
            <span className="inline-flex items-center gap-1">
              <Star className="h-3.5 w-3.5 fill-ochre text-ochre" strokeWidth={1.75} />
              <span className="type-small tnum font-semibold text-ink">{place.rating.toFixed(1)}</span>
            </span>
          )}
          {place.priceLevel != null && (
            <span className="type-small text-ink-3">{'$'.repeat(Math.max(1, place.priceLevel))}</span>
          )}
          <span className="type-caption text-ink-3">
            {place.city}, {place.country}
          </span>
        </div>

        {/* budget honesty: above-budget places lose the match line for a calm notice */}
        {place.aboveBudget ? (
          <p className="mt-2">
            <span className="inline-flex items-center gap-1 rounded-pill bg-ochre-soft px-2 py-0.5 text-[11px] font-semibold text-ochre">
              Above your budget
            </span>
          </p>
        ) : (
          matchLine && (
            <p
              className={cn(
                'mt-2 inline-flex items-center gap-1.5 text-[12px] font-medium',
                place.matchStyles.length > 0 ? 'text-pine' : 'text-ochre',
              )}
            >
              <Sparkles className="h-3.5 w-3.5 shrink-0" strokeWidth={1.75} />
              {matchLine}
            </p>
          )
        )}

        <div className="mt-3 flex items-center gap-2 pt-1">
          <AddToTripButton place={place} added={added} onAdded={handleAdded} />
          <button
            type="button"
            onClick={onOpenDetail}
            aria-label={`About ${place.name}`}
            className="inline-flex h-8 w-8 items-center justify-center rounded-md text-ink-3 transition-colors duration-fast hover:bg-surface-2 hover:text-ink"
          >
            <Info className="h-4 w-4" strokeWidth={1.75} />
          </button>
        </div>
      </div>

      {/* shared-element fly clone */}
      {fly &&
        createPortal(
          <motion.div
            initial={{
              x: fly.from.left,
              y: fly.from.top,
              width: fly.from.width,
              height: fly.from.height,
              opacity: 1,
              borderRadius: 12,
            }}
            animate={{
              x: fly.to.left + fly.to.width / 2 - 22,
              y: fly.to.top + fly.to.height / 2 - 22,
              width: 44,
              height: 44,
              opacity: 0.35,
              borderRadius: 999,
            }}
            transition={{ duration: 0.45, ease: EASE_EXPO }}
            onAnimationComplete={() => setFly(null)}
            className="pointer-events-none fixed left-0 top-0 z-[80] overflow-hidden shadow-lg"
            aria-hidden
          >
            {img && <img src={img} alt="" className="h-full w-full object-cover" />}
          </motion.div>,
          document.body,
        )}
    </div>
  );
}
