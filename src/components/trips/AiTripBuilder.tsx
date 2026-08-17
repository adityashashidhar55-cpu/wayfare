import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { AnimatePresence, motion } from 'framer-motion';
import {
  ArrowRight,
  Baby,
  Check,
  Crown,
  Loader2,
  MapPin,
  Minus,
  Plus,
  Sparkles,
  UtensilsCrossed,
  X,
} from 'lucide-react';
import { PREFERENCE_STYLES, priceForBrowser } from '@contracts/premium';
import { formatMoney } from '@contracts/fx';
import { formatChildAges } from '@contracts/kids';
import { DIET_META, isVegDiet, parseDietary } from '@/lib/diet';
import { trpc } from '@/providers/trpc';
import { BUDGET_BANDS, isBudgetBand } from '@/lib/exploreLive';
import type { BudgetBand, DayEstimate } from '@/lib/exploreLive';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { EASE_EXPO, SPRING_PIN_POP } from '@/lib/motion';
import { formatDateRange, thumbFor, toISODate, tripDays } from '@/components/trips/utils';
import { cn } from '@/lib/utils';

type Pace = 'relaxed' | 'balanced' | 'packed';
type Phase = 'form' | 'generating' | 'success' | 'upsell';

const PACES: { value: Pace; label: string; meta: string; slots: number }[] = [
  { value: 'relaxed', label: 'Relaxed', meta: '3/day', slots: 3 },
  { value: 'balanced', label: 'Balanced', meta: '4/day', slots: 4 },
  { value: 'packed', label: 'Packed', meta: '5/day', slots: 5 },
];

/* Traveler-tunable stop count bounds (matches the API schema min/max). */
const STOPS_MIN = 2;
const STOPS_MAX = 8;

type GenerateResult = {
  id: number;
  stopsCreated: number;
  days: number;
  city: string;
  dayEstimates?: DayEstimate[];
};

/**
 * Gradient entry card (design.md §3.4 grad-cta - the one per page) that opens
 * the AI trip builder. Rendered near the top of the Trips dashboard.
 */
export function AiTripBuilderCard({ onOpen }: { onOpen: () => void }) {
  return (
    <div
      className="relative overflow-hidden rounded-xl p-6 shadow-md md:p-8"
      style={{ backgroundImage: 'var(--grad-cta)' }}
    >
      <Sparkles
        aria-hidden
        className="pointer-events-none absolute -right-8 -top-10 h-44 w-44 text-white/15 dark:text-black/10"
        strokeWidth={1}
      />
      <div className="relative flex flex-wrap items-center gap-x-8 gap-y-5">
        <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-white/20 text-white dark:bg-black/15 dark:text-[#2A1B0E]">
          <Sparkles className="h-5 w-5" strokeWidth={1.75} />
        </span>
        <div className="min-w-[220px] flex-1">
          <h2 className="font-serif text-[22px] leading-[28px] tracking-[-0.01em] text-white dark:text-[#2A1B0E]">
            Build my itinerary with AI
          </h2>
          <p className="type-small mt-1 text-white/85 dark:text-[#2A1B0E]/80">
            Pick a place, we&rsquo;ll draft the days.
          </p>
        </div>
        <button
          type="button"
          onClick={onOpen}
          className="btn-sheen type-body inline-flex h-11 items-center gap-2 rounded-pill bg-surface px-5 font-semibold text-brand shadow-md transition-all duration-fast hover:-translate-y-px hover:shadow-lg active:scale-[0.97]"
        >
          Start with AI
          <ArrowRight className="h-4 w-4" strokeWidth={2} />
        </button>
      </div>
    </div>
  );
}

type ModalProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

/**
 * Shared Voyager upsell body - the paywall screen shown when an AI/premium
 * action hits UPGRADE_REQUIRED. Used inside the AI trip builder and as the
 * standalone VoyagerUpsellDialog (workspace AI + optimize entry points).
 */
export function VoyagerUpsellContent({ onClose }: { onClose: () => void }) {
  const navigate = useNavigate();
  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -8 }}
      transition={{ duration: 0.28, ease: EASE_EXPO }}
      className="flex flex-col items-center px-8 py-12 text-center"
    >
      <span className="flex h-14 w-14 items-center justify-center rounded-full bg-ochre-soft text-ochre">
        <Crown className="h-6 w-6" strokeWidth={1.75} />
      </span>
      <h3 className="type-h3 mt-5 text-ink">Voyager territory ahead</h3>
      <p className="type-body mt-2 max-w-[42ch] text-ink-2">
        Free plans hold 3 active trips. Wayfare Voyager unlocks unlimited trips, AI
        itineraries, route optimization, and unlimited collaborators, {' '}
        {priceForBrowser().yearly.label}.
      </p>
      <div className="mt-7 flex flex-wrap items-center justify-center gap-2">
        <Button variant="ghost" onClick={onClose}>
          Not now
        </Button>
        <Button variant="premium" onClick={() => navigate('/pricing')}>
          <Crown className="h-4 w-4" strokeWidth={1.75} />
          See Voyager plans
        </Button>
      </div>
    </motion.div>
  );
}

/** Standalone upgrade dialog for premium entry points outside the AI builder. */
export function VoyagerUpsellDialog({ open, onOpenChange }: ModalProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        style={{ maxWidth: 'min(520px, calc(100% - 2rem))' }}
        className="rounded-xl border-border bg-surface p-0 shadow-lg"
      >
        <VoyagerUpsellContent onClose={() => onOpenChange(false)} />
      </DialogContent>
    </Dialog>
  );
}

/**
 * Shell - remounts the content component on every open (key change), so all
 * form state resets via useState initializers rather than effects.
 */
export function AiTripBuilderModal(props: ModalProps) {
  const [session, setSession] = useState(0);
  return (
    <Dialog
      open={props.open}
      onOpenChange={(o) => {
        if (o) setSession((s) => s + 1);
        props.onOpenChange(o);
      }}
    >
      <AiTripBuilderContent key={session} {...props} />
    </Dialog>
  );
}

function AiTripBuilderContent({ onOpenChange }: ModalProps) {
  const navigate = useNavigate();
  const utils = trpc.useUtils();

  const [phase, setPhase] = useState<Phase>('form');
  const [destination, setDestination] = useState('');
  const [comboInput, setComboInput] = useState('');
  const [comboFocus, setComboFocus] = useState(false);
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [pace, setPace] = useState<Pace>('balanced');
  /* Places/day: null = follow the pace preset; a number = traveler override */
  const [stopsOverride, setStopsOverride] = useState<number | null>(null);
  const [includeFood, setIncludeFood] = useState(true);
  const [withKids, setWithKids] = useState(false);
  const [kidAges, setKidAges] = useState<number[]>([]);
  const [budget, setBudget] = useState<BudgetBand>('mid');
  const [budgetTouched, setBudgetTouched] = useState(false);
  const [vibes, setVibes] = useState<string[]>([]);
  const [vibesTouched, setVibesTouched] = useState(false);
  const [unknownDest, setUnknownDest] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [stepsDone, setStepsDone] = useState(0);
  const [result, setResult] = useState<GenerateResult | null>(null);

  const comboRef = useRef<HTMLInputElement>(null);

  const citiesQ = trpc.explore.cities.useQuery();
  const prefQ = trpc.preferences.get.useQuery();

  /* Active dietary (saved in Preferences) - shown as a read-only chip so the
     traveler knows restaurant picks are being tuned. */
  const dietary = parseDietary(prefQ.data?.dietary);

  /* Vibe chips prefill from the saved taste profile until the traveler edits them */
  useEffect(() => {
    if (vibesTouched || !prefQ.data?.styles) return;
    setVibes(prefQ.data.styles.filter((s) => (PREFERENCE_STYLES as readonly string[]).includes(s)));
  }, [prefQ.data, vibesTouched]);

  /* Budget band prefills from the saved profile until the traveler edits it -
     state adjusted during render (react.dev: "adjusting state from props") */
  const savedBand = prefQ.data?.budgetBand;
  const [prevSavedBand, setPrevSavedBand] = useState(savedBand);
  if (savedBand !== prevSavedBand) {
    setPrevSavedBand(savedBand);
    if (!budgetTouched && isBudgetBand(savedBand)) setBudget(savedBand);
  }

  const suggestions = useMemo(() => {
    const q = comboInput.trim().toLowerCase();
    return (citiesQ.data ?? [])
      .filter((c) => c.city !== destination)
      .filter((c) => !q || c.city.toLowerCase().includes(q) || c.country.toLowerCase().includes(q))
      .slice(0, 5);
  }, [comboInput, citiesQ.data, destination]);

  const todayIso = useMemo(() => toISODate(new Date()), []);
  const datesValid = !!startDate && !!endDate && endDate >= startDate;
  const canSubmit = !!destination && datesValid;

  /* Effective stops/day: the override once touched, else the pace preset -
     so switching pace re-bases the default until the traveler overrides. */
  const paceSlots = PACES.find((p) => p.value === pace)?.slots ?? 4;
  const stopsPerDay = stopsOverride ?? paceSlots;

  const cityLabel = destination.split(',')[0]?.trim() || destination;
  const styleLabel = vibes.length ? vibes.slice(0, 2).join(' + ') : 'travel';
  const steps = useMemo(
    () => [
      `Finding the best ${cityLabel} spots`,
      'Balancing activity and food',
      `Tuning to your ${styleLabel} style`,
      'Placing pins on the map',
    ],
    [cityLabel, styleLabel],
  );

  const generate = trpc.trips.generateItinerary.useMutation();

  /* Stepped theatre: checkmarks land every ~700ms while the mutation runs */
  useEffect(() => {
    if (phase !== 'generating') return;
    const id = window.setInterval(
      () => setStepsDone((n) => Math.min(steps.length, n + 1)),
      700,
    );
    return () => window.clearInterval(id);
  }, [phase, steps.length]);

  /* Honest success: only once the mutation has resolved AND the steps played */
  useEffect(() => {
    if (phase === 'generating' && result && stepsDone >= steps.length) setPhase('success');
  }, [phase, result, stepsDone, steps.length]);

  /* Auto-open the new trip shortly after success; "Open now" jumps in sooner.
     The timer is cleared on unmount or when the phase changes (e.g. close). */
  useEffect(() => {
    if (phase !== 'success' || !result) return;
    const id = window.setTimeout(() => {
      onOpenChange(false);
      navigate(`/trips/${result.id}`);
    }, 1400);
    return () => window.clearTimeout(id);
  }, [phase, result, onOpenChange, navigate]);

  const pickDestination = (city: string) => {
    setDestination(city.trim());
    setComboInput('');
    setUnknownDest(null);
    setFormError(null);
    comboRef.current?.focus();
  };

  const applyExample = () => {
    const now = new Date();
    setDestination('Kyoto');
    setStartDate(toISODate(new Date(now.getFullYear(), now.getMonth() + 1, 1)));
    setEndDate(toISODate(new Date(now.getFullYear(), now.getMonth() + 1, 5)));
    setPace('balanced');
    setUnknownDest(null);
    setFormError(null);
  };

  const submit = () => {
    if (!canSubmit) return;
    setFormError(null);
    setUnknownDest(null);
    setResult(null);
    setStepsDone(0);
    setPhase('generating');
    // budgetBand ships with the parallel AI backend branch; the structural
    // payload type accepts it today and the zod schema will once merged.
    const payload = {
      destination,
      startDate,
      endDate,
      pace,
      stopsPerDay: stopsOverride ?? undefined,
      excludeFood: !includeFood,
      styles: vibes.length ? vibes : undefined,
      homeCurrency: prefQ.data?.homeCurrency,
      budgetBand: budget,
      withChildren: withKids,
      childAges: withKids ? (formatChildAges(kidAges) ?? undefined) : undefined,
    };
    generate.mutate(
      payload,
      {
        onSuccess: (data) => {
          setResult(data);
          utils.trips.list.invalidate();
        },
        onError: (err) => {
          if (err.message === 'UPGRADE_REQUIRED') {
            setPhase('upsell');
          } else if (err.message === 'DESTINATION_UNKNOWN') {
            setUnknownDest(destination);
            setDestination('');
            setComboInput('');
            setPhase('form');
          } else {
            setFormError(err.message);
            setPhase('form');
          }
        },
      },
    );
  };

  return (
    <DialogContent
      showCloseButton={phase === 'form' || phase === 'upsell'}
      className={cn(
        'flex max-h-[92dvh] flex-col gap-0 overflow-hidden rounded-xl border-border bg-surface p-0 shadow-lg sm:max-w-[520px] max-md:max-w-none',
        // Mobile: full-height bottom sheet (90% detent)
        'max-md:bottom-0 max-md:left-0 max-md:top-auto max-md:h-[90dvh] max-md:max-h-none max-md:translate-x-0 max-md:translate-y-0 max-md:rounded-b-none max-md:rounded-t-[24px]',
      )}
    >
      <AnimatePresence mode="wait" initial={false}>
        {phase === 'upsell' ? (
          <VoyagerUpsellContent key="upsell" onClose={() => onOpenChange(false)} />
        ) : phase === 'generating' ? (
          <motion.div
            key="generating"
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.28, ease: EASE_EXPO }}
            className="flex flex-col px-8 py-10"
          >
            <div className="flex items-center gap-4">
              <span className="relative flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-brand-soft text-brand">
                <span className="absolute inset-0 rounded-full animate-pulse-ring" />
                <Sparkles className="h-5 w-5" strokeWidth={1.75} />
              </span>
              <div>
                <h3 className="type-h3 text-ink">Drafting your {cityLabel} itinerary</h3>
                <p className="type-caption mt-0.5 text-ink-3">
                  {tripDays(startDate, endDate)} days · {pace} · {stopsPerDay}/day
                  {includeFood ? '' : ' · sights only'}
                  {withKids ? ' · family pace' : ''}
                </p>
              </div>
            </div>

            <div className="mt-7 h-1 overflow-hidden rounded-full bg-surface-2">
              <motion.div
                className="h-full rounded-full bg-brand"
                initial={{ width: '0%' }}
                animate={{ width: `${(stepsDone / steps.length) * 100}%` }}
                transition={{ duration: 0.5, ease: EASE_EXPO }}
              />
            </div>

            <ul className="mt-7 space-y-4">
              {steps.map((label, i) => {
                const done = i < stepsDone;
                const active = i === stepsDone;
                return (
                  <li key={label} className="flex items-center gap-3">
                    <span
                      className={cn(
                        'flex h-6 w-6 shrink-0 items-center justify-center rounded-full border transition-colors duration-base',
                        done
                          ? 'border-pine bg-pine-soft text-pine'
                          : active
                            ? 'border-brand/40 text-brand'
                            : 'border-border-strong text-ink-3',
                      )}
                    >
                      {done ? (
                        <motion.span
                          initial={{ scale: 0 }}
                          animate={{ scale: 1 }}
                          transition={SPRING_PIN_POP}
                          className="flex"
                        >
                          <Check className="h-3.5 w-3.5" strokeWidth={2.5} />
                        </motion.span>
                      ) : active ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" strokeWidth={2} />
                      ) : (
                        <span className="h-1.5 w-1.5 rounded-full bg-border-strong" />
                      )}
                    </span>
                    <motion.span
                      initial={false}
                      animate={{ opacity: done || active ? 1 : 0.45 }}
                      transition={{ duration: 0.3 }}
                      className={cn('type-small', done || active ? 'text-ink' : 'text-ink-3')}
                    >
                      {label}
                    </motion.span>
                  </li>
                );
              })}
            </ul>
          </motion.div>
        ) : phase === 'success' && result ? (
          <motion.div
            key="success"
            initial={{ opacity: 0, scale: 0.97 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.32, ease: EASE_EXPO }}
            className="flex flex-col items-center px-8 py-14 text-center"
          >
            <motion.span
              initial={{ scale: 0.5, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              transition={SPRING_PIN_POP}
              className="flex h-14 w-14 items-center justify-center rounded-full bg-pine-soft text-pine"
            >
              <Sparkles className="h-6 w-6" strokeWidth={1.75} />
            </motion.span>
            <h3 className="type-h3 mt-5 text-ink">
              Your {result.days}-day {result.city} itinerary is ready
            </h3>
            <p className="type-small tnum mt-2 text-ink-3">
              {result.stopsCreated} stops placed · tune it, drag it, make it yours
            </p>
            {result.dayEstimates && result.dayEstimates.length > 0 ? (
              <p className="type-caption tnum mt-2 text-ink-3">
                Est. fees:{' '}
                {result.dayEstimates
                  .map(
                    (d, i) =>
                      `${formatMoney(d.totalCents, d.currencies[0] ?? prefQ.data?.homeCurrency ?? 'USD')} day ${i + 1}`,
                  )
                  .join(' · ')}
              </p>
            ) : null}
            <p className="type-caption mt-4 text-ink-3">Opening your trip…</p>
            <div className="mt-5 flex flex-wrap items-center justify-center gap-2">
              <Button
                onClick={() => {
                  onOpenChange(false);
                  navigate(`/trips/${result.id}`);
                }}
              >
                Open now
                <ArrowRight className="h-4 w-4" strokeWidth={2} />
              </Button>
            </div>
          </motion.div>
        ) : (
          <motion.div
            key="form"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.24, ease: EASE_EXPO }}
            className="flex min-h-0 flex-1 flex-col"
          >
            <DialogHeader className="border-b border-border px-6 py-5 text-left md:px-8">
              <DialogTitle className="type-h3 flex items-center gap-2 text-ink">
                <Sparkles className="h-[18px] w-[18px] text-brand" strokeWidth={1.75} />
                Build my itinerary with AI
              </DialogTitle>
              <DialogDescription className="type-small text-ink-2">
                A place, a window of days, a pace, we draft day-by-day stops tuned to your taste.
              </DialogDescription>
            </DialogHeader>

            <div className="min-h-0 flex-1 space-y-7 overflow-y-auto px-6 py-6 md:px-8">
              {/* 1 · Destination */}
              <section>
                <span className="type-eyebrow text-ink-3">Where to?</span>
                <div className="relative mt-2">
                  <div
                    className={cn(
                      'flex min-h-[48px] flex-wrap items-center gap-1.5 rounded-md border border-border-strong bg-surface px-3 py-2 transition-shadow duration-fast',
                      comboFocus && 'border-brand ring-2 ring-brand/40',
                    )}
                    onClick={() => comboRef.current?.focus()}
                  >
                    <MapPin className="h-4 w-4 shrink-0 text-ink-3" strokeWidth={1.75} />
                    {destination && (
                      <span className="type-small inline-flex items-center gap-1 rounded-pill bg-brand-soft py-1 pl-3 pr-1.5 font-semibold text-brand">
                        {destination}
                        <button
                          type="button"
                          aria-label={`Remove ${destination}`}
                          onClick={() => setDestination('')}
                          className="inline-flex h-4 w-4 items-center justify-center rounded-full transition-colors hover:bg-brand/20"
                        >
                          <X className="h-3 w-3" strokeWidth={2} />
                        </button>
                      </span>
                    )}
                    <input
                      ref={comboRef}
                      value={comboInput}
                      onChange={(e) => setComboInput(e.target.value)}
                      onFocus={() => setComboFocus(true)}
                      onBlur={() => setTimeout(() => setComboFocus(false), 150)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          e.preventDefault();
                          if (suggestions[0]) pickDestination(suggestions[0].city);
                          else if (comboInput.trim()) pickDestination(comboInput);
                        } else if (e.key === 'Backspace' && !comboInput && destination) {
                          setDestination('');
                        }
                      }}
                      placeholder={destination ? 'Change city…' : 'Search cities: Kyoto, Lisbon, Marrakech…'}
                      className="type-body min-w-[150px] flex-1 bg-transparent py-1 outline-none placeholder:text-ink-3"
                      aria-label="Destination"
                    />
                  </div>

                  {comboFocus && suggestions.length > 0 && (
                    <ul className="absolute z-10 mt-2 w-full overflow-hidden rounded-md border border-border bg-surface shadow-lg">
                      {suggestions.map((c, i) => (
                        <motion.li
                          key={c.city}
                          initial={{ opacity: 0, y: 6 }}
                          animate={{ opacity: 1, y: 0 }}
                          transition={{ duration: 0.18, delay: 0.04 * i }}
                        >
                          <button
                            type="button"
                            onMouseDown={(e) => {
                              e.preventDefault();
                              pickDestination(c.city);
                            }}
                            className="flex w-full items-center gap-3 px-3.5 py-2.5 text-left transition-colors duration-fast hover:bg-surface-2"
                          >
                            <img
                              src={c.image ?? thumbFor(c.city)}
                              alt=""
                              className="photo h-8 w-8 shrink-0 rounded-sm object-cover"
                            />
                            <span className="type-small flex-1 font-semibold text-ink">{c.city}</span>
                            <span className="type-caption shrink-0 text-ink-3">
                              {c.country} · {c.count} {c.count === 1 ? 'place' : 'places'}
                            </span>
                          </button>
                        </motion.li>
                      ))}
                    </ul>
                  )}
                </div>

                {unknownDest && (
                  <motion.div
                    initial={{ opacity: 0, y: 6 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.24, ease: EASE_EXPO }}
                    role="alert"
                    className="mt-3 rounded-md border border-border bg-surface-2/60 p-3.5"
                  >
                    <p className="type-small text-ink-2">
                      We don&rsquo;t have <span className="font-semibold text-ink">{unknownDest}</span>{' '}
                      yet, try one of these:
                    </p>
                    <div className="mt-2.5 flex flex-wrap gap-1.5">
                      {(citiesQ.data ?? []).slice(0, 6).map((c) => (
                        <button
                          key={c.city}
                          type="button"
                          onClick={() => pickDestination(c.city)}
                          className="type-small inline-flex items-center gap-1.5 rounded-pill border border-border bg-surface px-2.5 py-1 font-medium text-ink shadow-sm transition-colors duration-fast hover:border-brand hover:text-brand"
                        >
                          <img
                            src={c.image ?? thumbFor(c.city)}
                            alt=""
                            className="photo h-4 w-4 rounded-full object-cover"
                          />
                          {c.city}
                        </button>
                      ))}
                    </div>
                  </motion.div>
                )}
              </section>

              {/* 2 · Dates */}
              <section>
                <span className="type-eyebrow text-ink-3">When?</span>
                <div className="mt-2 grid grid-cols-2 gap-3">
                  <div>
                    <span className="type-caption mb-1.5 block text-ink-3">Start</span>
                    <Input
                      type="date"
                      value={startDate}
                      min={todayIso}
                      onChange={(e) => {
                        const v = e.target.value;
                        setStartDate(v);
                        if (v && endDate && endDate < v) setEndDate('');
                      }}
                      className="h-11 rounded-md border-border-strong bg-surface tnum [color-scheme:light] dark:[color-scheme:dark]"
                      aria-label="Start date"
                    />
                  </div>
                  <div>
                    <span className="type-caption mb-1.5 block text-ink-3">End</span>
                    <Input
                      type="date"
                      value={endDate}
                      min={startDate || todayIso}
                      onChange={(e) => setEndDate(e.target.value)}
                      className="h-11 rounded-md border-border-strong bg-surface tnum [color-scheme:light] dark:[color-scheme:dark]"
                      aria-label="End date"
                    />
                  </div>
                </div>
                {datesValid && (
                  <motion.span
                    initial={{ opacity: 0, scale: 0.94 }}
                    animate={{ opacity: 1, scale: 1 }}
                    transition={SPRING_PIN_POP}
                    className="type-small tnum mt-3 inline-flex rounded-pill bg-brand-soft px-3 py-1.5 font-semibold text-brand"
                  >
                    {tripDays(startDate, endDate)} days · {formatDateRange(startDate, endDate)}
                  </motion.span>
                )}
              </section>

              {/* 3 · Pace */}
              <section>
                <span className="type-eyebrow text-ink-3">Pace</span>
                <div className="mt-2 grid grid-cols-3 gap-1 rounded-pill bg-surface-2 p-1">
                  {PACES.map((p) => {
                    const active = pace === p.value;
                    return (
                      <button
                        key={p.value}
                        type="button"
                        aria-pressed={active}
                        onClick={() => setPace(p.value)}
                        className="relative rounded-pill px-3 py-2 text-center"
                      >
                        {active && (
                          <motion.span
                            layoutId="ai-pace-pill"
                            transition={{ type: 'spring', stiffness: 380, damping: 30 }}
                            className="absolute inset-0 rounded-pill bg-surface shadow-sm"
                          />
                        )}
                        <span
                          className={cn(
                            'type-small relative block font-semibold transition-colors duration-fast',
                            active ? 'text-ink' : 'text-ink-2',
                          )}
                        >
                          {p.label}
                        </span>
                        <span className="type-caption tnum relative block text-ink-3">{p.meta}</span>
                      </button>
                    );
                  })}
                </div>
              </section>

              {/* 4 · Places per day & food stops */}
              <section>
                <div className="flex items-baseline justify-between gap-3">
                  <span className="type-eyebrow text-ink-3">Places per day</span>
                  {stopsOverride == null ? (
                    <span className="type-caption text-ink-3">From pace</span>
                  ) : (
                    <button
                      type="button"
                      onClick={() => setStopsOverride(null)}
                      className="type-caption font-semibold text-brand transition-colors duration-fast hover:text-brand-strong"
                    >
                      Reset to pace ({paceSlots}/day)
                    </button>
                  )}
                </div>
                <div className="mt-2 flex items-center gap-3">
                  <div className="inline-flex items-center gap-1 rounded-pill bg-surface-2 p-1">
                    <button
                      type="button"
                      aria-label="Fewer places per day"
                      disabled={stopsPerDay <= STOPS_MIN}
                      onClick={() => setStopsOverride(Math.max(STOPS_MIN, stopsPerDay - 1))}
                      className="flex h-8 w-8 items-center justify-center rounded-full text-ink-2 transition-colors duration-fast hover:bg-surface hover:text-ink disabled:opacity-40 disabled:hover:bg-transparent"
                    >
                      <Minus className="h-4 w-4" strokeWidth={2} />
                    </button>
                    <span
                      aria-live="polite"
                      className="type-small tnum w-16 text-center font-semibold text-ink"
                    >
                      {stopsPerDay} {stopsPerDay === 1 ? 'place' : 'places'}
                    </span>
                    <button
                      type="button"
                      aria-label="More places per day"
                      disabled={stopsPerDay >= STOPS_MAX}
                      onClick={() => setStopsOverride(Math.min(STOPS_MAX, stopsPerDay + 1))}
                      className="flex h-8 w-8 items-center justify-center rounded-full text-ink-2 transition-colors duration-fast hover:bg-surface hover:text-ink disabled:opacity-40 disabled:hover:bg-transparent"
                    >
                      <Plus className="h-4 w-4" strokeWidth={2} />
                    </button>
                  </div>
                  <span className="type-caption text-ink-3">
                    {STOPS_MIN}–{STOPS_MAX} stops each day
                  </span>
                </div>
                <label className="mt-4 flex cursor-pointer items-center justify-between gap-3">
                  <span className="flex items-center gap-2.5">
                    <UtensilsCrossed className="h-4 w-4 shrink-0 text-ink-3" strokeWidth={1.75} />
                    <span>
                      <span className="type-small block font-semibold text-ink">
                        Include restaurants &amp; cafés
                      </span>
                      <span className="type-caption block text-ink-3">
                        Off = attractions &amp; sights only
                      </span>
                    </span>
                  </span>
                  <Switch
                    checked={includeFood}
                    onCheckedChange={setIncludeFood}
                    aria-label="Include restaurants and cafés"
                  />
                </label>
                {includeFood && isVegDiet(dietary) && (
                  <Link
                    to="/profile"
                    title="Dietary preference lives in your profile"
                    className="type-caption mt-2.5 inline-flex items-center gap-1.5 rounded-pill bg-pine-soft px-2.5 py-1 font-semibold text-pine transition-colors duration-fast hover:bg-pine hover:text-white"
                  >
                    <span aria-hidden>{DIET_META[dietary].emoji}</span>
                    Restaurants tuned: {DIET_META[dietary].label}, change in Preferences
                  </Link>
                )}
              </section>

              {/* 4b · Travelling with children */}
              <section>
                <label className="flex cursor-pointer items-center justify-between gap-3">
                  <span className="flex items-center gap-2.5">
                    <Baby className="h-4 w-4 shrink-0 text-ink-3" strokeWidth={1.75} />
                    <span>
                      <span className="type-small block font-semibold text-ink">
                        Travelling with children
                      </span>
                      <span className="type-caption block text-ink-3">
                        Family pace: up to 4 stops/day, done by 18:30, a daily downtime break
                      </span>
                    </span>
                  </span>
                  <Switch
                    checked={withKids}
                    onCheckedChange={setWithKids}
                    aria-label="Travelling with children"
                  />
                </label>
                <AnimatePresence initial={false}>
                  {withKids && (
                    <motion.div
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: 'auto', opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }}
                      transition={{ duration: 0.24, ease: EASE_EXPO }}
                      className="overflow-hidden"
                    >
                      <div className="mt-3 rounded-md border border-border bg-surface-2/60 p-3.5">
                        <span className="type-caption mb-2 block text-ink-3">
                          Ages of the kids coming along
                        </span>
                        <div className="flex flex-wrap gap-1.5">
                          {Array.from({ length: 18 }, (_, age) => {
                            const on = kidAges.includes(age);
                            return (
                              <button
                                key={age}
                                type="button"
                                aria-pressed={on}
                                onClick={() =>
                                  setKidAges((a) =>
                                    on ? a.filter((x) => x !== age) : [...a, age].sort((x, y) => x - y),
                                  )
                                }
                                className={cn(
                                  'type-caption tnum inline-flex h-7 w-7 items-center justify-center rounded-full font-semibold transition-colors duration-fast',
                                  on ? 'bg-brand text-brand-ink' : 'bg-surface text-ink-2 hover:text-ink',
                                )}
                              >
                                {age}
                              </button>
                            );
                          })}
                        </div>
                        <p className="type-caption mt-2.5 text-ink-3">
                          New to family travel?{' '}
                          <Link to="/kids" className="font-semibold text-brand hover:text-brand-strong">
                            What to know before you go →
                          </Link>
                        </p>
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </section>

              {/* 5 · Budget */}
              <section>
                <div className="flex items-baseline justify-between gap-3">
                  <span className="type-eyebrow text-ink-3">Budget</span>
                  {!budgetTouched && prefQ.data?.budgetBand ? (
                    <span className="type-caption text-ink-3">From your taste profile</span>
                  ) : null}
                </div>
                <div className="mt-2 grid grid-cols-4 gap-1 rounded-pill bg-surface-2 p-1">
                  {BUDGET_BANDS.map((b) => {
                    const active = budget === b.value;
                    return (
                      <button
                        key={b.value}
                        type="button"
                        aria-pressed={active}
                        onClick={() => {
                          setBudgetTouched(true);
                          setBudget(b.value);
                        }}
                        className="relative rounded-pill px-2 py-2 text-center"
                      >
                        {active && (
                          <motion.span
                            layoutId="ai-budget-pill"
                            transition={{ type: 'spring', stiffness: 380, damping: 30 }}
                            className="absolute inset-0 rounded-pill bg-surface shadow-sm"
                          />
                        )}
                        <span
                          className={cn(
                            'type-small relative block font-semibold transition-colors duration-fast',
                            active ? 'text-ink' : 'text-ink-2',
                          )}
                        >
                          {b.label}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </section>

              {/* 6 · Vibes */}
              <section>
                <div className="flex items-baseline justify-between gap-3">
                  <span className="type-eyebrow text-ink-3">Vibe (optional)</span>
                  {!vibesTouched && prefQ.data?.styles?.length ? (
                    <span className="type-caption text-ink-3">Prefilled from your taste profile</span>
                  ) : null}
                </div>
                <div className="mt-2 flex flex-wrap gap-2">
                  {PREFERENCE_STYLES.map((s) => {
                    const on = vibes.includes(s);
                    return (
                      <motion.button
                        key={s}
                        type="button"
                        aria-pressed={on}
                        whileTap={{ scale: 0.94 }}
                        onClick={() => {
                          setVibesTouched(true);
                          setVibes((v) => (on ? v.filter((x) => x !== s) : [...v, s]));
                        }}
                        className={cn(
                          'type-small inline-flex items-center gap-1.5 rounded-pill px-3.5 py-2 font-medium transition-colors duration-fast',
                          on ? 'bg-brand-soft text-brand' : 'bg-surface-2 text-ink-2 hover:text-ink',
                        )}
                      >
                        {on && <Check className="h-3.5 w-3.5" strokeWidth={2.5} />}
                        {s.charAt(0).toUpperCase() + s.slice(1)}
                      </motion.button>
                    );
                  })}
                </div>
              </section>

              {/* Example hint */}
              <button
                type="button"
                onClick={applyExample}
                className="type-small inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-ink-3 transition-colors duration-fast hover:bg-surface-2 hover:text-brand"
              >
                <Sparkles className="h-3.5 w-3.5" strokeWidth={1.75} />
                Try: Kyoto · next month · balanced
              </button>
            </div>

            {/* Footer */}
            <div className="flex items-center justify-between gap-3 border-t border-border px-6 py-4 md:px-8">
              <span className="type-caption text-danger" role="alert">
                {formError ?? ''}
              </span>
              <div className="flex items-center gap-2">
                <Button variant="ghost" onClick={() => onOpenChange(false)}>
                  Cancel
                </Button>
                <Button onClick={submit} disabled={!canSubmit} className="min-w-[168px]">
                  <Sparkles className="h-4 w-4" strokeWidth={1.75} />
                  Generate itinerary
                </Button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </DialogContent>
  );
}
