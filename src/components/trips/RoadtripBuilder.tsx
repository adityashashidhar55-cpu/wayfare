import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import { AnimatePresence, motion } from 'framer-motion';
import {
  ArrowRight,
  ArrowUpDown,
  Car,
  Check,
  ChevronDown,
  Loader2,
  MapPin,
  Minus,
  Plus,
  Route,
  Sparkles,
  TrainFront,
  X,
} from 'lucide-react';
import { trpc } from '@/providers/trpc';
import { searchPlaces } from '@/lib/geocode';
import type { PlaceSearchHit } from '@/lib/geocode';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { EASE_EXPO, SPRING_PIN_POP } from '@/lib/motion';
import { toISODate } from '@/components/trips/utils';
import { PREFERENCE_STYLES } from '@contracts/premium';
import { VoyagerUpsellContent } from '@/components/trips/AiTripBuilder';
import { matchRouteHint, POPULAR_ROUTE_HINTS } from '@/components/roadtrip/popularRoutes';
import { cn } from '@/lib/utils';

type Mode = 'car' | 'transit';
type Phase = 'form' | 'generating' | 'upsell' | 'success';

const DAYS_MIN = 2;
const DAYS_MAX = 21;

type PlanResult = {
  tripId: number;
  title: string;
  singleCity: boolean;
  cities: { city: string; country: string; days: number; via?: boolean }[];
  transfers: {
    from: string;
    to: string;
    km: number;
    routeTag?: string;
    primaryOption: {
      kind: 'car' | 'train' | 'bus';
      label: string;
      durationMin: number;
      km: number;
      transfers?: number;
      estimated: boolean;
    } | null;
  }[];
  popularRoute: { slug: string; name: string; blurb: string } | null;
  routeEstimated: boolean;
  geocodeWarnings: string[];
  viaSkipped: { name: string; reason: string }[];
};

/** "1st of next month" - sensible default departure for a fresh plan. */
function defaultStartDate(): string {
  const now = new Date();
  return toISODate(new Date(now.getFullYear(), now.getMonth() + 1, 1));
}

function fmtMin(min: number): string {
  const h = Math.floor(min / 60);
  const m = Math.round(min % 60);
  return h ? `${h}h${m ? ` ${m}m` : ''}` : `${m}m`;
}

function fmtElapsed(ms: number): string {
  const s = Math.floor(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/**
 * City/place field with Photon autocomplete. Selecting a suggestion (or
 * pressing Enter on free text) commits the value as a removable chip.
 */
function EndpointField({
  label,
  value,
  onCommit,
  placeholder,
  error,
}: {
  label: string;
  value: string;
  onCommit: (v: string) => void;
  placeholder: string;
  error?: string | null;
}) {
  const [input, setInput] = useState('');
  const [focus, setFocus] = useState(false);
  const [hits, setHits] = useState<PlaceSearchHit[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);
  const seq = useRef(0);

  /* Debounced Photon search while the field is focused and uncommitted. */
  useEffect(() => {
    const q = input.trim();
    if (!focus || value || q.length < 2) {
      setHits([]);
      return;
    }
    const id = ++seq.current;
    const t = window.setTimeout(async () => {
      const res = await searchPlaces(q, undefined, 6);
      if (seq.current === id) setHits(res);
    }, 250);
    return () => window.clearTimeout(t);
  }, [input, focus, value]);

  const commit = (v: string) => {
    const clean = v.trim();
    if (!clean) return;
    onCommit(clean);
    setInput('');
    setHits([]);
  };

  return (
    <div className="min-w-0 flex-1">
      <span className="type-eyebrow text-ink-3">{label}</span>
      <div className="relative mt-2">
        <div
          className={cn(
            'flex min-h-[48px] flex-wrap items-center gap-1.5 rounded-md border border-border-strong bg-surface px-3 py-2 transition-shadow duration-fast',
            focus && 'border-brand ring-2 ring-brand/40',
            error && 'border-danger',
          )}
          onClick={() => inputRef.current?.focus()}
        >
          <MapPin className="h-4 w-4 shrink-0 text-ink-3" strokeWidth={1.75} />
          {value && (
            <span className="type-small inline-flex items-center gap-1 rounded-pill bg-brand-soft py-1 pl-3 pr-1.5 font-semibold text-brand">
              {value}
              <button
                type="button"
                aria-label={`Remove ${value}`}
                onClick={() => onCommit('')}
                className="inline-flex h-4 w-4 items-center justify-center rounded-full transition-colors hover:bg-brand/20"
              >
                <X className="h-3 w-3" strokeWidth={2} />
              </button>
            </span>
          )}
          <input
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onFocus={() => setFocus(true)}
            onBlur={() => window.setTimeout(() => setFocus(false), 150)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                if (hits[0]) commit(hits[0].address ? `${hits[0].name}, ${hits[0].address.split(', ').pop()}` : hits[0].name);
                else commit(input);
              } else if (e.key === 'Backspace' && !input && value) {
                onCommit('');
              }
            }}
            placeholder={value ? 'Change…' : placeholder}
            className="type-body min-w-[120px] flex-1 bg-transparent py-1 outline-none placeholder:text-ink-3"
            aria-label={label}
            aria-invalid={!!error}
          />
        </div>

        {focus && !value && hits.length > 0 && (
          <ul className="absolute z-10 mt-2 w-full overflow-hidden rounded-md border border-border bg-surface shadow-lg">
            {hits.map((h, i) => (
              <motion.li
                key={`${h.name}-${h.lat}-${i}`}
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.18, delay: 0.03 * i }}
              >
                <button
                  type="button"
                  onMouseDown={(e) => {
                    e.preventDefault();
                    commit(h.address ? `${h.name}, ${h.address.split(', ').pop()}` : h.name);
                  }}
                  className="flex w-full items-center gap-3 px-3.5 py-2.5 text-left transition-colors duration-fast hover:bg-surface-2"
                >
                  <MapPin className="h-3.5 w-3.5 shrink-0 text-ink-3" strokeWidth={1.75} />
                  <span className="type-small flex-1 truncate font-semibold text-ink">{h.name}</span>
                  <span className="type-caption max-w-[45%] shrink-0 truncate text-ink-3">
                    {h.address}
                  </span>
                </button>
              </motion.li>
            ))}
          </ul>
        )}
      </div>
      {error && (
        <p className="type-caption mt-1.5 text-danger" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

const VIA_MAX = 5;

/**
 * "Must-visit along the way" - multi-value chip input with the same Photon
 * autocomplete as the endpoint fields. Enter (or picking a suggestion) adds
 * a chip; the planner guarantees each must-visit stop gets ≥ 1 day.
 */
function ViaField({
  values,
  onChange,
}: {
  values: string[];
  onChange: (v: string[]) => void;
}) {
  const [input, setInput] = useState('');
  const [focus, setFocus] = useState(false);
  const [hits, setHits] = useState<PlaceSearchHit[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);
  const seq = useRef(0);
  const full = values.length >= VIA_MAX;

  /* Debounced Photon search while the field is focused and not full. */
  useEffect(() => {
    const q = input.trim();
    if (!focus || full || q.length < 2) {
      setHits([]);
      return;
    }
    const id = ++seq.current;
    const t = window.setTimeout(async () => {
      const res = await searchPlaces(q, undefined, 5);
      if (seq.current === id) setHits(res);
    }, 250);
    return () => window.clearTimeout(t);
  }, [input, focus, full]);

  const add = (v: string) => {
    const clean = v.trim();
    setInput('');
    setHits([]);
    if (!clean || full) return;
    if (values.some((x) => x.toLowerCase() === clean.toLowerCase())) return;
    onChange([...values, clean]);
  };

  const remove = (i: number) => onChange(values.filter((_, k) => k !== i));

  return (
    <div>
      <span className="type-eyebrow text-ink-3">Stopovers you can't skip (optional)</span>
      <div className="relative mt-2">
        <div
          className={cn(
            'flex min-h-[48px] flex-wrap items-center gap-1.5 rounded-md border border-border-strong bg-surface px-3 py-2 transition-shadow duration-fast',
            focus && 'border-brand ring-2 ring-brand/40',
          )}
          onClick={() => inputRef.current?.focus()}
        >
          <MapPin className="h-4 w-4 shrink-0 text-ink-3" strokeWidth={1.75} />
          {values.map((v, i) => (
            <span
              key={v}
              className="type-small inline-flex items-center gap-1 rounded-pill bg-brand-soft py-1 pl-3 pr-1.5 font-semibold text-brand"
            >
              {v}
              <button
                type="button"
                aria-label={`Remove ${v}`}
                onClick={() => remove(i)}
                className="inline-flex h-4 w-4 items-center justify-center rounded-full transition-colors hover:bg-brand/20"
              >
                <X className="h-3 w-3" strokeWidth={2} />
              </button>
            </span>
          ))}
          {!full && (
            <input
              ref={inputRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onFocus={() => setFocus(true)}
              onBlur={() => window.setTimeout(() => setFocus(false), 150)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  if (hits[0])
                    add(hits[0].address ? `${hits[0].name}, ${hits[0].address.split(', ').pop()}` : hits[0].name);
                  else add(input);
                } else if (e.key === 'Backspace' && !input && values.length) {
                  remove(values.length - 1);
                }
              }}
              placeholder={values.length ? 'Add another…' : 'Nara, Hakone…'}
              className="type-body min-w-[140px] flex-1 bg-transparent py-1 outline-none placeholder:text-ink-3"
              aria-label="Stopovers you can't skip"
            />
          )}
        </div>

        {focus && !full && hits.length > 0 && (
          <ul className="absolute z-10 mt-2 w-full overflow-hidden rounded-md border border-border bg-surface shadow-lg">
            {hits.map((h, i) => (
              <motion.li
                key={`${h.name}-${h.lat}-${i}`}
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.18, delay: 0.03 * i }}
              >
                <button
                  type="button"
                  onMouseDown={(e) => {
                    e.preventDefault();
                    add(h.address ? `${h.name}, ${h.address.split(', ').pop()}` : h.name);
                  }}
                  className="flex w-full items-center gap-3 px-3.5 py-2.5 text-left transition-colors duration-fast hover:bg-surface-2"
                >
                  <MapPin className="h-3.5 w-3.5 shrink-0 text-ink-3" strokeWidth={1.75} />
                  <span className="type-small flex-1 truncate font-semibold text-ink">{h.name}</span>
                  <span className="type-caption max-w-[45%] shrink-0 truncate text-ink-3">
                    {h.address}
                  </span>
                </button>
              </motion.li>
            ))}
          </ul>
        )}
      </div>
      <p className="type-caption mt-1.5 text-ink-3">
        Up to {VIA_MAX} places, the planner routes through them and gives each at least a day.
      </p>
    </div>
  );
}

/** Numbered section heading - the step-by-step scaffold for the form. */
function SectionHeading({ n, title, hint }: { n: number; title: string; hint?: string }) {
  return (
    <div className="flex items-baseline gap-2.5">
      <span className="flex h-[22px] w-[22px] shrink-0 translate-y-0.5 items-center justify-center rounded-full bg-brand-soft font-serif text-[12px] font-semibold text-brand">
        {n}
      </span>
      <span className="type-h4 text-ink">{title}</span>
      {hint && <span className="type-caption text-ink-3">{hint}</span>}
    </div>
  );
}

/** Shell - remounts content on every open so form state resets. */
export function RoadtripBuilderModal({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [session, setSession] = useState(0);
  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (o) setSession((s) => s + 1);
        onOpenChange(o);
      }}
    >
      <RoadtripBuilderContent key={session} open={open} onOpenChange={onOpenChange} />
    </Dialog>
  );
}

/**
 * r12-routeui: one planning step with a rough share of the expected wait.
 * The plan is a single tRPC call, so progress is simulated against these
 * weights - the honest elapsed timer + "usually takes 20–60s" caption keep
 * it from feeling like a fake promise.
 */
type PlanStep = { label: string; secs: number };

function RoadtripBuilderContent({ onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const navigate = useNavigate();
  const utils = trpc.useUtils();

  const [phase, setPhase] = useState<Phase>('form');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [via, setVia] = useState<string[]>([]);
  const [mode, setMode] = useState<Mode>('car');
  const [days, setDays] = useState(7);
  const [startDate, setStartDate] = useState(defaultStartDate);
  const [styles, setStyles] = useState<string[]>([]);
  const [stylesOpen, setStylesOpen] = useState(false);
  const [triedSubmit, setTriedSubmit] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [elapsedMs, setElapsedMs] = useState(0);
  const [result, setResult] = useState<PlanResult | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const cancelledRef = useRef(false);

  const todayIso = useMemo(() => toISODate(new Date()), []);
  const fromError = triedSubmit && !from ? 'Pick a starting city.' : null;
  const toError = triedSubmit && !to ? 'Pick a destination.' : null;
  const dateError = triedSubmit && (!startDate || startDate < todayIso) ? 'Start date must be today or later.' : null;
  const canSubmit = !!from && !!to && !!startDate && startDate >= todayIso;
  const routeHint = useMemo(() => matchRouteHint(from, to), [from, to]);

  const steps = useMemo<PlanStep[]>(
    () => [
      {
        label: via.length
          ? `Finding ${from.split(',')[0]}, ${to.split(',')[0]} + ${via.length} stopover${via.length === 1 ? '' : 's'}`
          : `Finding ${from.split(',')[0]} and ${to.split(',')[0]}`,
        secs: 5,
      },
      { label: 'Routing the corridor', secs: 7 },
      { label: 'Choosing stops along the way', secs: 9 },
      { label: 'Checking for famous routes', secs: 4 },
      { label: 'Weighing how long each city deserves', secs: 6 },
      { label: mode === 'transit' ? 'Estimating trains & buses' : 'Estimating the driving legs', secs: 12 },
      { label: 'Pinning the best stops', secs: 7 },
    ],
    [from, to, via.length, mode],
  );
  const totalSecs = useMemo(() => steps.reduce((a, s) => a + s.secs, 0), [steps]);
  /* Steps completed by the clock - the last step only "completes" when the
     answer actually arrives, so the panel never sits at 100% while waiting. */
  const clockDone = useMemo(() => {
    let acc = 0;
    let n = 0;
    const elapsed = elapsedMs / 1000;
    for (const s of steps) {
      acc += s.secs;
      if (elapsed >= acc) n++;
      else break;
    }
    return Math.min(n, steps.length - 1);
  }, [elapsedMs, steps]);
  const stepsDone = result ? steps.length : clockDone;
  const progressPct = result ? 100 : Math.min(96, (elapsedMs / 1000 / totalSecs) * 100);

  /* Elapsed clock while generating. */
  useEffect(() => {
    if (phase !== 'generating') return;
    const t0 = Date.now();
    const id = window.setInterval(() => setElapsedMs(Date.now() - t0), 200);
    return () => window.clearInterval(id);
  }, [phase]);

  /* Result arrived → let the last checkmark land, then celebrate. */
  useEffect(() => {
    if (phase !== 'generating' || !result) return;
    const id = window.setTimeout(() => setPhase('success'), 650);
    return () => window.clearTimeout(id);
  }, [phase, result]);

  /* Auto-open the new trip shortly after success; "Open now" jumps in sooner.
     The timer is cleared on unmount or when the phase changes (e.g. close). */
  useEffect(() => {
    if (phase !== 'success' || !result) return;
    const id = window.setTimeout(() => {
      onOpenChange(false);
      navigate(`/trips/${result.tripId}`);
    }, 1400);
    return () => window.clearTimeout(id);
  }, [phase, result, onOpenChange, navigate]);

  const cancel = () => {
    cancelledRef.current = true;
    abortRef.current?.abort();
    setPhase('form');
  };

  const submit = () => {
    setTriedSubmit(true);
    if (!canSubmit) return;
    setFormError(null);
    setResult(null);
    setElapsedMs(0);
    cancelledRef.current = false;
    const controller = new AbortController();
    abortRef.current = controller;
    setPhase('generating');
    /* Vanilla client (not the hook) so the request carries an AbortSignal -
       the Cancel button genuinely stops waiting on the server. */
    utils.client.roadtrip.planRoadtrip
      .mutate(
        {
          originText: from,
          destText: to,
          mode,
          days,
          startDate,
          via: via.length ? via : undefined,
          styles: styles.length ? styles : undefined,
        },
        { signal: controller.signal },
      )
      .then((data) => {
        if (cancelledRef.current) return;
        setResult(data as PlanResult);
        utils.trips.list.invalidate();
      })
      .catch((err: { message?: string }) => {
        if (cancelledRef.current) return;
        const msg = err?.message ?? '';
        if (msg === 'UPGRADE_REQUIRED') {
          setPhase('upsell');
          return;
        }
        if (msg === 'GEOCODE_UNKNOWN') {
          setFormError(`We couldn't place “${from}” or “${to}”, try more specific place names.`);
        } else if (msg === 'ORIGIN_UNKNOWN') {
          setFormError(`We couldn't place “${from}”, try a nearby city name.`);
        } else if (msg === 'DESTINATION_UNKNOWN') {
          setFormError(`We couldn't place “${to}”, try a nearby city name.`);
        } else {
          setFormError(msg || 'Something went wrong, please try again.');
        }
        setPhase('form');
      });
  };

  const swapEndpoints = () => {
    setFrom(to);
    setTo(from);
  };

  const applyRoute = (slug: string) => {
    const r = POPULAR_ROUTE_HINTS.find((x) => x.slug === slug);
    if (!r) return;
    setFrom(r.suggested[0]);
    setTo(r.suggested[1]);
    setVia([]);
    setMode(r.slug === 'golden-route-japan' ? 'transit' : 'car');
    setDays(5);
    setStartDate(defaultStartDate());
    setFormError(null);
    setTriedSubmit(false);
  };

  return (
    <DialogContent
      showCloseButton={phase === 'form'}
      className={cn(
        'flex max-h-[92dvh] flex-col gap-0 overflow-hidden rounded-xl border-border bg-surface p-0 shadow-lg sm:max-w-[560px] max-md:max-w-none',
        'max-md:bottom-0 max-md:left-0 max-md:top-auto max-md:h-[90dvh] max-md:max-h-none max-md:translate-x-0 max-md:translate-y-0 max-md:rounded-b-none max-md:rounded-t-[24px]',
      )}
    >
      <AnimatePresence mode="wait" initial={false}>
        {phase === 'generating' ? (
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
                <Route className="h-5 w-5" strokeWidth={1.75} />
              </span>
              <div className="min-w-0 flex-1">
                <h3 className="type-h3 truncate text-ink">
                  Mapping {from.split(',')[0]} → {to.split(',')[0]}
                </h3>
                <p className="type-caption mt-0.5 text-ink-3">
                  {days} days · {mode === 'car' ? 'by car' : 'public transport'}
                </p>
              </div>
              {/* honest elapsed clock, this is a 20–60s request, own it */}
              <span className="type-small tnum shrink-0 font-semibold text-ink-2" aria-live="off">
                {fmtElapsed(elapsedMs)}
              </span>
            </div>

            <div
              className="mt-7 h-1 overflow-hidden rounded-full bg-surface-2"
              role="progressbar"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={Math.round(progressPct)}
            >
              <div
                className="h-full rounded-full bg-brand transition-[width] duration-300 ease-out"
                style={{ width: `${progressPct}%` }}
              />
            </div>

            <ul className="mt-7 space-y-4">
              {steps.map((s, i) => {
                const done = i < stepsDone;
                const active = i === stepsDone;
                return (
                  <li key={s.label} className="flex items-center gap-3">
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
                      {s.label}
                    </motion.span>
                  </li>
                );
              })}
            </ul>

            <div className="mt-8 flex items-center justify-between gap-3">
              <p className="type-caption text-ink-3">
                Planning a real route, usually takes 20–60 seconds.
              </p>
              <Button variant="ghost" size="sm" onClick={cancel}>
                Cancel
              </Button>
            </div>
          </motion.div>
        ) : phase === 'upsell' ? (
          /* planRoadtrip hit the free-tier trip cap */
          <VoyagerUpsellContent key="upsell" onClose={() => setPhase('form')} />
        ) : phase === 'success' && result ? (
          <motion.div
            key="success"
            initial={{ opacity: 0, scale: 0.97 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.32, ease: EASE_EXPO }}
            className="flex max-h-[92dvh] flex-col items-center overflow-y-auto px-8 py-12 text-center"
          >
            <motion.span
              initial={{ scale: 0.5, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              transition={SPRING_PIN_POP}
              className="flex h-14 w-14 items-center justify-center rounded-full bg-pine-soft text-pine"
            >
              <Route className="h-6 w-6" strokeWidth={1.75} />
            </motion.span>
            <h3 className="type-h3 mt-5 text-ink">{result.title} is on the map</h3>
            {result.popularRoute && (
              <motion.div
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.3, delay: 0.15 }}
                className="mt-3 flex max-w-[360px] flex-col items-center gap-1.5"
              >
                <span className="inline-flex items-center gap-1.5 rounded-pill bg-brand-soft px-3 py-1.5">
                  <Sparkles className="h-3.5 w-3.5 text-brand" strokeWidth={1.75} />
                  <span className="type-caption font-semibold text-brand">
                    Following the {result.popularRoute.name}
                  </span>
                </span>
                <p className="type-caption text-center text-ink-3">{result.popularRoute.blurb}</p>
              </motion.div>
            )}
            {result.singleCity && (
              <p className="type-caption mt-2 text-ink-3">
                Heads up: these two are close, we planned it as a single-city trip.
              </p>
            )}
            {result.routeEstimated && (
              <p className="type-caption mt-2 max-w-[340px] text-ink-3">
                Live routing was unreachable, so the corridor follows a straight-line estimate,
                distances may vary.
              </p>
            )}
            {result.geocodeWarnings.map((w) => (
              <p key={w} className="type-caption mt-2 max-w-[340px] text-ink-3">
                {w}
              </p>
            ))}
            {result.viaSkipped.map((v) => (
              <p key={v.name} className="type-caption mt-2 max-w-[340px] text-ink-3">
                Skipped “{v.name}”, {v.reason}.
              </p>
            ))}
            <ul className="mt-5 w-full max-w-[360px] space-y-2 text-left">
              {result.cities.map((c, i) => (
                <li key={`${c.city}-${i}`} className="flex items-center gap-3">
                  <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-brand-soft font-serif text-[12px] font-semibold text-brand">
                    {i + 1}
                  </span>
                  <span className="type-small flex-1 truncate font-semibold text-ink">{c.city}</span>
                  {c.via && (
                    <span className="type-caption inline-flex shrink-0 items-center gap-1 rounded-pill bg-brand-soft px-2 py-0.5 font-semibold text-brand">
                      <MapPin className="h-3 w-3" strokeWidth={2} />
                      must-visit
                    </span>
                  )}
                  <span className="type-caption tnum shrink-0 text-ink-3">
                    {c.days} {c.days === 1 ? 'day' : 'days'}
                  </span>
                </li>
              ))}
            </ul>
            {result.transfers.length > 0 && (
              <div className="mt-4 w-full max-w-[360px] space-y-1.5">
                {result.transfers.map((t, i) => (
                  <p key={i} className="type-caption tnum text-ink-3">
                    {t.from} → {t.to}: {t.km} km
                    {t.primaryOption
                      ? ` · ${t.primaryOption.kind === 'car' ? '🚗' : t.primaryOption.kind === 'train' ? '🚆' : '🚌'} ${fmtMin(t.primaryOption.durationMin)}${t.primaryOption.estimated ? ' (est.)' : ''}`
                      : ''}
                    {t.routeTag ? ` · ${t.routeTag}` : ''}
                  </p>
                ))}
              </div>
            )}
            <p className="type-caption mt-4 text-ink-3">Opening your trip…</p>
            <div className="mt-5 flex flex-wrap items-center justify-center gap-2">
              <Button
                onClick={() => {
                  onOpenChange(false);
                  navigate(`/trips/${result.tripId}`);
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
                <Route className="h-[18px] w-[18px] text-brand" strokeWidth={1.75} />
                Plan a road trip
              </DialogTitle>
              <DialogDescription className="type-small text-ink-2">
                Start and end anywhere, we find the cities in-between, how long each
                deserves, and how to hop between them.
              </DialogDescription>
            </DialogHeader>

            <div className="min-h-0 flex-1 space-y-8 overflow-y-auto px-6 py-6 md:px-8">
              {/* 1 · Route */}
              <section>
                <SectionHeading n={1} title="Your route" />
                <div className="mt-3 flex items-start gap-2">
                  <EndpointField
                    label="From"
                    value={from}
                    onCommit={setFrom}
                    placeholder="Starting city. Jaipur, Kyoto…"
                    error={fromError}
                  />
                  <button
                    type="button"
                    onClick={swapEndpoints}
                    disabled={!from && !to}
                    title="Swap start and destination"
                    aria-label="Swap start and destination"
                    className="mt-[26px] flex h-12 w-9 shrink-0 items-center justify-center rounded-md border border-border-strong bg-surface text-ink-3 transition-colors duration-fast hover:border-brand hover:text-brand disabled:opacity-40 disabled:hover:border-border-strong disabled:hover:text-ink-3"
                  >
                    <ArrowUpDown className="h-4 w-4" strokeWidth={1.75} />
                  </button>
                  <EndpointField
                    label="To"
                    value={to}
                    onCommit={setTo}
                    placeholder="Destination. Agra, Tokyo…"
                    error={toError}
                  />
                </div>
                <div className="mt-4">
                  <ViaField values={via} onChange={setVia} />
                </div>
                {routeHint && (
                  <p className="type-caption mt-3 inline-flex items-center gap-1.5 rounded-pill bg-brand-soft px-3 py-1.5 font-semibold text-brand">
                    <Sparkles className="h-3.5 w-3.5" strokeWidth={1.75} />
                    This looks like the {routeHint.name}, we'll tag the legs that follow it.
                  </p>
                )}
                {!from && !to && (
                  <div className="mt-3 flex flex-wrap items-center gap-1.5">
                    <span className="type-caption text-ink-3">Try a classic:</span>
                    {POPULAR_ROUTE_HINTS.slice(0, 3).map((r) => (
                      <button
                        key={r.slug}
                        type="button"
                        onClick={() => applyRoute(r.slug)}
                        className="type-caption inline-flex items-center gap-1 rounded-pill bg-surface-2 px-2.5 py-1 font-semibold text-ink-2 transition-colors duration-fast hover:bg-brand-soft hover:text-brand"
                      >
                        <Sparkles className="h-3 w-3" strokeWidth={1.75} />
                        {r.name}
                      </button>
                    ))}
                  </div>
                )}
              </section>

              {/* 2 · Travel */}
              <section>
                <SectionHeading n={2} title="How you travel" />
                <div className="mt-3 grid grid-cols-2 gap-2">
                  {(
                    [
                      {
                        value: 'car',
                        label: 'Car',
                        Icon: Car,
                        blurb: 'Flexible, scenic detours and stops on your schedule.',
                      },
                      {
                        value: 'transit',
                        label: 'Public transport',
                        Icon: TrainFront,
                        blurb: 'Trains & buses between cities, no parking, no driving.',
                      },
                    ] as const
                  ).map(({ value, label, Icon, blurb }) => {
                    const active = mode === value;
                    return (
                      <button
                        key={value}
                        type="button"
                        aria-pressed={active}
                        onClick={() => setMode(value)}
                        className={cn(
                          'rounded-md border p-3 text-left transition-colors duration-fast',
                          active
                            ? 'border-brand bg-brand-soft/50'
                            : 'border-border-strong bg-surface hover:border-ink-3',
                        )}
                      >
                        <span className="flex items-center gap-2">
                          <span
                            className={cn(
                              'flex h-8 w-8 items-center justify-center rounded-full',
                              active ? 'bg-brand text-white' : 'bg-surface-2 text-ink-2',
                            )}
                          >
                            <Icon className="h-4 w-4" strokeWidth={1.75} />
                          </span>
                          <span className="type-small font-semibold text-ink">{label}</span>
                          {active && <Check className="ml-auto h-4 w-4 text-brand" strokeWidth={2.5} />}
                        </span>
                        <span className="type-caption mt-2 block leading-relaxed text-ink-3">
                          {blurb}
                        </span>
                      </button>
                    );
                  })}
                </div>
                <div className="mt-4 flex flex-wrap items-center gap-x-6 gap-y-4">
                  <div>
                    <span className="type-caption mb-1.5 block text-ink-3">Trip length</span>
                    <div className="inline-flex items-center gap-1 rounded-pill bg-surface-2 p-1">
                      <button
                        type="button"
                        aria-label="Fewer days"
                        disabled={days <= DAYS_MIN}
                        onClick={() => setDays((d) => Math.max(DAYS_MIN, d - 1))}
                        className="flex h-8 w-8 items-center justify-center rounded-full text-ink-2 transition-colors duration-fast hover:bg-surface hover:text-ink disabled:opacity-40 disabled:hover:bg-transparent"
                      >
                        <Minus className="h-4 w-4" strokeWidth={2} />
                      </button>
                      <span aria-live="polite" className="type-small tnum w-16 text-center font-semibold text-ink">
                        {days} days
                      </span>
                      <button
                        type="button"
                        aria-label="More days"
                        disabled={days >= DAYS_MAX}
                        onClick={() => setDays((d) => Math.min(DAYS_MAX, d + 1))}
                        className="flex h-8 w-8 items-center justify-center rounded-full text-ink-2 transition-colors duration-fast hover:bg-surface hover:text-ink disabled:opacity-40 disabled:hover:bg-transparent"
                      >
                        <Plus className="h-4 w-4" strokeWidth={2} />
                      </button>
                    </div>
                  </div>
                  <div className="min-w-[160px] flex-1">
                    <span className="type-caption mb-1.5 block text-ink-3">Start date</span>
                    <Input
                      type="date"
                      value={startDate}
                      min={todayIso}
                      onChange={(e) => setStartDate(e.target.value)}
                      className={cn(
                        'h-11 rounded-md border-border-strong bg-surface tnum [color-scheme:light] dark:[color-scheme:dark]',
                        dateError && 'border-danger',
                      )}
                      aria-label="Start date"
                      aria-invalid={!!dateError}
                    />
                    {dateError && (
                      <p className="type-caption mt-1.5 text-danger" role="alert">
                        {dateError}
                      </p>
                    )}
                  </div>
                </div>
              </section>

              {/* 3 · Styles (collapsible) */}
              <section>
                <button
                  type="button"
                  aria-expanded={stylesOpen}
                  onClick={() => setStylesOpen((o) => !o)}
                  className="flex w-full items-center gap-2.5 rounded-md py-1 text-left"
                >
                  <SectionHeading n={3} title="Travel style" hint="optional" />
                  <span className="ml-auto flex items-center gap-2">
                    {styles.length > 0 && (
                      <span className="type-caption rounded-pill bg-brand-soft px-2 py-0.5 font-semibold text-brand">
                        {styles.length}
                      </span>
                    )}
                    <ChevronDown
                      className={cn('h-4 w-4 text-ink-3 transition-transform duration-fast', stylesOpen && 'rotate-180')}
                      strokeWidth={1.75}
                    />
                  </span>
                </button>
                {stylesOpen && (
                  <div className="mt-3 flex flex-wrap gap-2">
                    {PREFERENCE_STYLES.map((s) => {
                      const on = styles.includes(s);
                      return (
                        <motion.button
                          key={s}
                          type="button"
                          aria-pressed={on}
                          whileTap={{ scale: 0.94 }}
                          onClick={() =>
                            setStyles((v) => (on ? v.filter((x) => x !== s) : [...v, s]))
                          }
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
                )}
              </section>
            </div>

            {/* Footer */}
            <div className="border-t border-border px-6 py-4 md:px-8">
              {formError && (
                <p className="type-small mb-2.5 text-danger" role="alert">
                  {formError}
                </p>
              )}
              <div className="flex items-center justify-between gap-3">
                <span className="type-caption text-ink-3">
                  {days} days · {mode === 'car' ? 'by car' : 'public transport'}
                  {via.length ? ` · ${via.length} stopover${via.length === 1 ? '' : 's'}` : ''}
                </span>
                <Button onClick={submit} size="lg" pill className="min-w-[170px]">
                  <Route className="h-4 w-4" strokeWidth={1.75} />
                  Plan my route
                </Button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </DialogContent>
  );
}
