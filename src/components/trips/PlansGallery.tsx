import { useState } from 'react';
import { useNavigate } from 'react-router';
import { motion } from 'framer-motion';
import { CalendarDays, Clock, Flame, Loader2, MapPin, Sparkles } from 'lucide-react';
import { toast } from 'sonner';
import { trpc } from '@/providers/trpc';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { EASE_EXPO } from '@/lib/motion';
import { toISODate } from '@/components/trips/utils';

const RAIL_MASK =
  'linear-gradient(90deg, transparent, black 48px, black calc(100% - 48px), transparent)';

/** Stop start-time cadence - mirrors the clone procedure's slot times. */
const SLOT_TIMES = ['09:00', '12:30', '15:00', '19:00', '21:15'];

type TemplateListItem = {
  id: number;
  slug: string;
  title: string;
  destination: string;
  country: string | null;
  days: number;
  summary: string | null;
  coverImage: string | null;
  popularity: number;
};

/** "1.2k trips" / "890 trips" popularity chip label. */
export function popularityLabel(n: number): string {
  if (n >= 1000) return `${(n / 1000).toFixed(1).replace(/\.0$/, '')}k trips`;
  return `${n} trips`;
}

/** Next Saturday (or today +1 when today IS Saturday) as a sensible default start. */
function defaultStartDate(): string {
  const d = new Date();
  const delta = (6 - d.getDay() + 7) % 7 || 7;
  d.setDate(d.getDate() + delta);
  return toISODate(d);
}

/**
 * "Ready-made plans" gallery (dashboard §S4b): horizontal snap-scroll of
 * curated trip templates. Click a card for the day-by-day preview modal with a
 * start-date picker and one-click clone into the traveler's account.
 */
export function PlansGallery({ prominent = false }: { prominent?: boolean }) {
  const templatesQ = trpc.templates.list.useQuery();
  const [previewSlug, setPreviewSlug] = useState<string | null>(null);
  const templates = templatesQ.data?.templates ?? [];

  if (!templatesQ.isLoading && templates.length === 0) return null;

  return (
    <section aria-label="Ready-made plans">
      <div className="mb-5 flex items-end justify-between gap-4">
        <div className="flex items-baseline gap-3">
          <h2 className="type-h2 text-ink">Ready-made plans</h2>
          <span className="type-small text-ink-3 tnum">
            {templates.length} curated itineraries
          </span>
        </div>
        <span className="type-small hidden items-center gap-1 text-ink-3 sm:inline-flex">
          <Sparkles className="h-3.5 w-3.5" strokeWidth={1.75} />
          Clone with one click
        </span>
      </div>

      {templatesQ.isLoading ? (
        <div className="flex gap-4 overflow-hidden">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="h-[280px] w-[230px] shrink-0 animate-pulse rounded-lg bg-surface-2" />
          ))}
        </div>
      ) : (
        <div
          className="-mx-1 overflow-x-auto px-1 pb-2 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
          style={{ maskImage: RAIL_MASK, WebkitMaskImage: RAIL_MASK }}
        >
          <div className="flex w-max snap-x snap-mandatory gap-4">
            {templates.map((t, i) => (
              <PlanCard
                key={t.slug}
                template={t}
                index={i}
                prominent={prominent}
                onOpen={() => setPreviewSlug(t.slug)}
              />
            ))}
          </div>
        </div>
      )}

      <PlanPreviewModal slug={previewSlug} onClose={() => setPreviewSlug(null)} />
    </section>
  );
}

function PlanCard({
  template: t,
  index,
  prominent,
  onOpen,
}: {
  template: TemplateListItem;
  index: number;
  prominent: boolean;
  onOpen: () => void;
}) {
  return (
    <motion.button
      type="button"
      onClick={onOpen}
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, ease: EASE_EXPO, delay: 0.05 * Math.min(index, 8) }}
      whileHover={{ y: -4 }}
      className="group relative h-[280px] w-[230px] shrink-0 snap-start overflow-hidden rounded-lg border border-border bg-surface text-left shadow-sm transition-shadow duration-base hover:shadow-lg"
      aria-label={`Preview plan: ${t.title}`}
    >
      <div className="relative h-[150px] overflow-hidden">
        <img
          src={t.coverImage ?? '/hero-kyoto.jpg'}
          alt=""
          loading={prominent ? 'eager' : 'lazy'}
          style={{ transition: 'transform 600ms var(--ease-expo)' }}
          className="photo h-full w-full object-cover group-hover:scale-[1.045]"
        />
        <span className="absolute right-2.5 top-2.5 inline-flex items-center gap-1 rounded-pill bg-black/55 px-2 py-1 text-[11px] font-semibold text-white backdrop-blur-md">
          <Flame className="h-3 w-3" strokeWidth={2} />
          {popularityLabel(t.popularity)}
        </span>
      </div>
      <div className="flex h-[130px] flex-col gap-1.5 p-4">
        <h3 className="type-h4 line-clamp-2 text-ink">{t.title}</h3>
        <span className="type-caption inline-flex items-center gap-1 text-ink-3">
          <MapPin className="h-3 w-3 shrink-0" strokeWidth={1.75} />
          <span className="truncate">{t.destination}{t.country ? `, ${t.country}` : ''}</span>
        </span>
        <span className="type-caption mt-auto inline-flex items-center gap-1 font-semibold text-pine">
          <CalendarDays className="h-3 w-3" strokeWidth={1.75} />
          {t.days} days · 3–4 stops/day
        </span>
      </div>
    </motion.button>
  );
}

/** Day-by-day preview + start-date picker + one-click clone. */
export function PlanPreviewModal({ slug, onClose }: { slug: string | null; onClose: () => void }) {
  const navigate = useNavigate();
  const utils = trpc.useUtils();
  const templateQ = trpc.templates.get.useQuery({ slug: slug! }, { enabled: !!slug });
  const [startDate, setStartDate] = useState<string>(() => defaultStartDate());

  const clone = trpc.templates.clone.useMutation({
    onSuccess: async (res) => {
      toast.success('Plan added to your trips');
      await utils.trips.list.invalidate();
      onClose();
      navigate(`/trips/${res.tripId}`);
    },
    onError: (e) => {
      if (e.data?.code === 'UNAUTHORIZED') {
        toast.error('Sign in to use this plan');
        navigate('/login');
      } else if (e.message === 'UPGRADE_REQUIRED') {
        toast.error('You’ve hit the free trip limit, finish a trip or upgrade to Voyager');
      } else {
        toast.error(e.message);
      }
    },
  });

  const t = templateQ.data?.template;
  const payload = t?.payload;
  const isRoadtrip = payload?.tags.includes('roadtrip');

  return (
    <Dialog open={!!slug} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[88dvh] max-w-[560px] overflow-hidden p-0">
        {templateQ.isLoading || !t || !payload ? (
          <div className="flex h-[320px] items-center justify-center">
            <Loader2 className="h-6 w-6 animate-spin text-ink-3" strokeWidth={1.75} />
          </div>
        ) : (
          <div className="flex max-h-[88dvh] flex-col">
            {/* Hero */}
            <div className="relative h-[180px] shrink-0">
              <img src={t.coverImage ?? '/hero-kyoto.jpg'} alt="" className="h-full w-full object-cover" />
              <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-black/20 to-transparent" />
              <div className="absolute inset-x-5 bottom-4">
                <DialogHeader className="text-left">
                  <DialogTitle className="text-white">{t.title}</DialogTitle>
                  <DialogDescription className="text-white/80">
                    {t.destination}{t.country ? `, ${t.country}` : ''} · {t.days} days
                    {isRoadtrip ? ' · road trip' : ''} · {popularityLabel(t.popularity)}
                  </DialogDescription>
                </DialogHeader>
              </div>
            </div>

            {/* Day-by-day summary */}
            <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
              <p className="type-small text-ink-2">{t.summary}</p>
              <ol className="mt-4 space-y-4">
                {payload.days.map((day, i) => (
                  <li key={i} className="rounded-md border border-border bg-surface-2/40 p-3">
                    <div className="type-caption font-semibold uppercase tracking-[0.08em] text-pine">
                      Day {i + 1} · {day.label}
                    </div>
                    <ul className="mt-2 space-y-1">
                      {day.stops.map((stop, j) => (
                        <li key={j} className="type-small flex items-baseline gap-2 text-ink-2">
                          <span className="tnum w-[44px] shrink-0 text-ink-3">
                            {SLOT_TIMES[j] ?? '21:15'}
                          </span>
                          <span className="min-w-0">
                            <span className="font-medium text-ink">{stop.name}</span>
                            {stop.durationMin ? (
                              <span className="text-ink-3"> · {Math.round(stop.durationMin / 60 * 10) / 10}h</span>
                            ) : null}
                          </span>
                        </li>
                      ))}
                    </ul>
                  </li>
                ))}
              </ol>
            </div>

            {/* Footer: start date + clone */}
            <div className="shrink-0 border-t border-border bg-surface px-5 py-4">
              <label htmlFor="plan-start" className="type-caption mb-1.5 flex items-center gap-1 font-semibold text-ink-2">
                <Clock className="h-3 w-3" strokeWidth={1.75} />
                When does your trip start?
              </label>
              <div className="flex items-center gap-2">
                <Input
                  id="plan-start"
                  type="date"
                  value={startDate}
                  min={toISODate(new Date())}
                  onChange={(e) => setStartDate(e.target.value)}
                  className="w-[170px]"
                />
                <Button
                  pill
                  className="flex-1"
                  disabled={!startDate || clone.isPending}
                  onClick={() => clone.mutate({ slug: t.slug, startDate })}
                >
                  {clone.isPending ? (
                    <Loader2 className="h-4 w-4 animate-spin" strokeWidth={2} />
                  ) : (
                    <Sparkles className="h-4 w-4" strokeWidth={1.75} />
                  )}
                  {clone.isPending ? 'Building your trip…' : 'Use this plan'}
                </Button>
              </div>
              <p className="type-caption mt-2 text-ink-3">
                Creates your own editable copy, every stop, time and day can be changed after.
              </p>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
