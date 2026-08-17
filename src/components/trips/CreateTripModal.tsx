import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import { AnimatePresence, motion } from 'framer-motion';
import {
  ArrowLeft,
  ArrowRight,
  Backpack,
  Check,
  Crown,
  Heart,
  ImagePlus,
  Loader2,
  MapPin,
  Minus,
  PartyPopper,
  Plus,
  Shuffle,
  Sparkles,
  UtensilsCrossed,
  X,
} from 'lucide-react';
import type { DateRange } from 'react-day-picker';
import { toast } from 'sonner';
import { CURRENCY_SYMBOLS, FX_PER_USD } from '@contracts/fx';
import { priceForBrowser } from '@contracts/premium';
import { trpc } from '@/providers/trpc';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Calendar } from '@/components/ui/calendar';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { useIsMobile } from '@/hooks/use-mobile';
import { EASE_EXPO, SPRING_PIN_POP } from '@/lib/motion';
import { searchCities, type CityHit } from '@/lib/geocode';
import { gearHints, travelAdvice } from '@/lib/travel-advice';
import { useTier } from '@/hooks/useTier';
import { COVER_OPTIONS, formatDateRange, toISODate, tripNights } from '@/components/trips/utils';
import { cn } from '@/lib/utils';

type Phase = 'form' | 'success' | 'upsell';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Cover uploads are rejected above this size (then downscaled client-side). */
const MAX_COVER_FILE_BYTES = 6 * 1024 * 1024;

/** r24-core (E): a destination chip is a city in ANY country. */
interface Dest {
  city: string;
  country: string;
}

const INTENT_OPTIONS = [
  { key: 'adventure', label: 'Adventure' },
  { key: 'food', label: 'Food' },
  { key: 'shopping', label: 'Shopping' },
  { key: 'culture', label: 'Culture' },
  { key: 'relaxation', label: 'Relaxation' },
  { key: 'nightlife', label: 'Nightlife' },
] as const;

const DIET_OPTIONS = [
  { key: 'veg', label: 'Vegetarian' },
  { key: 'vegan', label: 'Vegan' },
  { key: 'halal', label: 'Halal' },
  { key: 'kosher', label: 'Kosher' },
  { key: 'none', label: 'No preference' },
] as const;

type StepId =
  | 'destinations'
  | 'mustSee'
  | 'origin'
  | 'dates'
  | 'members'
  | 'intent'
  | 'budget'
  | 'tradeoffs'
  | 'gear'
  | 'food'
  | 'finishing';

const STEPS: { id: StepId; title: string; hint: string; skippable: boolean }[] = [
  { id: 'destinations', title: 'Where to?', hint: 'Add every city on the route, any country works.', skippable: false },
  { id: 'mustSee', title: 'Points to visit', hint: 'Things you want to do, places you refuse to miss.', skippable: true },
  { id: 'origin', title: 'From where?', hint: 'Your starting point, so routes can lean the right way.', skippable: true },
  { id: 'dates', title: 'When?', hint: 'A window of days, or a flexible month.', skippable: false },
  { id: 'members', title: 'Who is going?', hint: 'Adults and children, for pacing and portions.', skippable: true },
  { id: 'intent', title: 'What is this trip for?', hint: 'Pick a few, or keep it a mix.', skippable: true },
  { id: 'budget', title: 'Budget', hint: 'How much you want to spend, we plan accordingly.', skippable: true },
  { id: 'tradeoffs', title: 'Smart trade-offs', hint: 'A few honest pointers for this exact route.', skippable: true },
  { id: 'gear', title: 'Pack smart', hint: 'Gear hints for this climate and trip length.', skippable: true },
  { id: 'food', title: 'Food preferences', hint: 'So food suggestions land right.', skippable: true },
  { id: 'finishing', title: 'Finishing touches', hint: 'A name, a cover, and anyone coming along.', skippable: true },
];

/**
 * Downscale a picked photo to a compact JPEG data URL: max 1600px wide at
 * q=0.82; if that still exceeds 450KB, re-encode at 1280px / q=0.72.
 */
async function fileToCoverDataUrl(file: File): Promise<string> {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error('image decode failed'));
      el.src = url;
    });
    const encode = (maxW: number, quality: number): string => {
      const scale = Math.min(1, maxW / (img.naturalWidth || maxW));
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(img.naturalWidth * scale));
      canvas.height = Math.max(1, Math.round(img.naturalHeight * scale));
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('canvas unavailable');
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      return canvas.toDataURL('image/jpeg', quality);
    };
    const first = encode(1600, 0.82);
    return first.length > 450_000 ? encode(1280, 0.72) : first;
  } finally {
    URL.revokeObjectURL(url);
  }
}

function nameFromEmail(email: string): string {
  const local = email.split('@')[0] ?? email;
  return (
    local
      .split(/[._-]+/)
      .filter(Boolean)
      .map((p) => (p[0] ?? '').toUpperCase() + p.slice(1))
      .join(' ') || email
  );
}

/** Chip label: city with country alongside (r24-core, feature E). */
const destLabel = (d: Dest) => (d.country ? `${d.city}, ${d.country}` : d.city);

/** Generic debounced city combobox: corpus suggestions + global Photon. */
function useCitySearch(query: string, open: boolean) {
  const citiesQ = trpc.explore.cities.useQuery();
  const [photon, setPhoton] = useState<CityHit[]>([]);
  useEffect(() => {
    const q = query.trim();
    if (!open || q.length < 2) {
      setPhoton([]);
      return;
    }
    const t = setTimeout(() => {
      searchCities(q, 5).then(setPhoton);
    }, 250);
    return () => clearTimeout(t);
  }, [query, open]);

  return useMemo(() => {
    const q = query.trim().toLowerCase();
    const corpus = (citiesQ.data ?? [])
      .filter((c) => !q || c.city.toLowerCase().includes(q) || c.country.toLowerCase().includes(q))
      .slice(0, 4)
      .map((c) => ({ city: c.city, country: c.country, source: 'corpus' as const }));
    const seen = new Set(corpus.map((c) => `${c.city.toLowerCase()}|${c.country.toLowerCase()}`));
    const global = photon
      .filter((h) => !seen.has(`${h.city.toLowerCase()}|${h.country.toLowerCase()}`))
      .slice(0, 4)
      .map((h) => ({ city: h.city, country: h.country, source: 'global' as const }));
    return [...corpus, ...global].slice(0, 6);
  }, [query, citiesQ.data, photon]);
}

/**
 * Create-trip wizard (r24-core, feature L): an 11-step inspiration flow -
 * destinations (multi-country chips), must-see notes, origin, dates, members,
 * intent, budget, smart trade-offs, gear hints, food preferences, finishing
 * touches. Only destinations + dates are required; every other step skips.
 * Submits via trpc.trips.create; UPGRADE_REQUIRED routes to the upsell state.
 */
type ModalProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  prefillDestination?: string;
  atLimit: boolean;
};

/**
 * Shell - remounts the content component on every open (key change), so all
 * form state resets via useState initializers rather than effects.
 */
export function CreateTripModal(props: ModalProps) {
  const [session, setSession] = useState(0);
  return (
    <Dialog
      open={props.open}
      onOpenChange={(o) => {
        if (o) setSession((s) => s + 1);
        props.onOpenChange(o);
      }}
    >
      <CreateTripModalContent key={session} {...props} />
    </Dialog>
  );
}

function CreateTripModalContent({
  onOpenChange,
  prefillDestination,
  atLimit,
}: ModalProps) {
  const navigate = useNavigate();
  const utils = trpc.useUtils();
  const isMobile = useIsMobile();

  const [phase, setPhase] = useState<Phase>(atLimit ? 'upsell' : 'form');
  const [step, setStep] = useState(0);

  /* step 1: destinations (multi-country) */
  const [destinations, setDestinations] = useState<Dest[]>(() => {
    if (!prefillDestination) return [];
    const [city = '', ...rest] = prefillDestination.split(',').map((s) => s.trim());
    return [{ city, country: rest.join(', ') }];
  });
  const [comboInput, setComboInput] = useState('');
  const [comboFocus, setComboFocus] = useState(false);
  const comboRef = useRef<HTMLInputElement>(null);

  /* step 2: must-see */
  const [mustSee, setMustSee] = useState('');

  /* step 3: origin */
  const [originCity, setOriginCity] = useState('');
  const [originInput, setOriginInput] = useState('');
  const [originFocus, setOriginFocus] = useState(false);

  /* step 4: dates */
  const [range, setRange] = useState<DateRange | undefined>();
  const [flexible, setFlexible] = useState(false);
  const [flexMonth, setFlexMonth] = useState(() => toISODate(new Date()).slice(0, 7));
  const [flexNights, setFlexNights] = useState(7);

  /* step 5: members */
  const [adults, setAdults] = useState(2);
  const [children, setChildren] = useState(0);

  /* step 6: intent */
  const [intent, setIntent] = useState<string[]>([]);

  /* step 7: budget */
  const [currencyChoice, setCurrencyChoice] = useState<string | null>(null);
  const [budget, setBudget] = useState('');

  /* step 8: flexibility */
  const [flexibility, setFlexibility] = useState<'planned' | 'flexible' | null>(null);

  /* step 10: food */
  const [foodDiets, setFoodDiets] = useState<string[]>([]);
  const [foodNote, setFoodNote] = useState('');

  /* step 11: finishing */
  const [titleOverride, setTitleOverride] = useState<string | null>(null);
  const [cover, setCover] = useState<string>(
    () => COVER_OPTIONS[Math.floor(Math.random() * COVER_OPTIONS.length)] ?? COVER_OPTIONS[0],
  );
  const [uploadedCover, setUploadedCover] = useState<string | null>(null);
  const [coverUploadError, setCoverUploadError] = useState<string | null>(null);
  const coverFileRef = useRef<HTMLInputElement>(null);
  const [invites, setInvites] = useState<string[]>([]);
  const [inviteInput, setInviteInput] = useState('');

  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  useEffect(() => () => timers.current.forEach(clearTimeout), []);

  const prefQ = trpc.preferences.get.useQuery();
  /* Currency defaults to the saved preference until the user picks one */
  const currency = currencyChoice ?? prefQ.data?.homeCurrency ?? 'USD';

  const suggestions = useCitySearch(comboInput, comboFocus);
  const originSuggestions = useCitySearch(originInput, originFocus && !originCity);

  const monthOptions = useMemo(() => {
    const out: { value: string; label: string }[] = [];
    const now = new Date();
    for (let i = 0; i < 18; i++) {
      const d = new Date(now.getFullYear(), now.getMonth() + i, 1);
      out.push({
        value: toISODate(d).slice(0, 7),
        label: d.toLocaleString(undefined, { month: 'long', year: 'numeric' }),
      });
    }
    return out;
  }, []);

  /* Effective dates from either the range calendar or flexible mode */
  const dates = useMemo((): { start?: string; end?: string } => {
    if (flexible) {
      const [y, m] = flexMonth.split('-').map(Number);
      const start = new Date(y ?? 2025, (m ?? 1) - 1, 1);
      const end = new Date(start);
      end.setDate(end.getDate() + flexNights);
      return { start: toISODate(start), end: toISODate(end) };
    }
    if (range?.from && range.to) return { start: toISODate(range.from), end: toISODate(range.to) };
    return {};
  }, [flexible, flexMonth, flexNights, range]);

  const tripDays = dates.start && dates.end ? tripNights(dates.start, dates.end) + 1 : 0;
  const budgetCents = Math.max(0, Math.round(parseFloat(budget.replace(/,/g, '') || '0') * 100));

  /* Smart trade-offs + gear hints, recomputed as earlier steps fill in */
  const adviceCtx = useMemo(
    () => ({
      destinations,
      days: tripDays,
      budgetCents: budgetCents || null,
      budgetCurrency: currency,
      intent,
      children,
      startMonth: dates.start ? Number(dates.start.slice(5, 7)) : undefined,
    }),
    [destinations, tripDays, budgetCents, currency, intent, children, dates.start],
  );
  const advice = useMemo(() => travelAdvice(adviceCtx), [adviceCtx]);
  // r24-smart: rules flagged `premium` are Voyager-gated; free users see a
  // locked teaser with an upgrade CTA instead of the advice body.
  const { isPremium } = useTier();
  const gear = useMemo(() => gearHints(adviceCtx), [adviceCtx]);

  const canSubmit = destinations.length > 0 && !!dates.start && !!dates.end && !submitting;

  const derivedTitle = destinations.map((d) => d.city).join(' · ');
  const tripTitle = titleOverride?.trim() || derivedTitle;

  const create = trpc.trips.create.useMutation();
  const update = trpc.trips.update.useMutation();
  const addMember = trpc.trips.addMember.useMutation();

  const addDestination = (d: Dest) => {
    const city = d.city.trim();
    if (!city) return;
    if (destinations.some((x) => x.city.toLowerCase() === city.toLowerCase())) return;
    setDestinations((v) => [...v, { city, country: d.country.trim() }]);
    setComboInput('');
    comboRef.current?.focus();
  };

  const addInvite = (raw: string) => {
    const email = raw.trim().replace(/,$/, '');
    if (!email) return;
    if (!EMAIL_RE.test(email)) {
      toast.error('That doesn’t look like an email address');
      return;
    }
    if (!invites.includes(email)) setInvites((v) => [...v, email]);
    setInviteInput('');
  };

  const toggleIntent = (key: string) => {
    if (key === 'mix') {
      setIntent(['mix']);
      return;
    }
    setIntent((v) => {
      const base = v.filter((k) => k !== 'mix');
      return base.includes(key) ? base.filter((k) => k !== key) : [...base, key];
    });
  };

  const toggleDiet = (key: string) => {
    if (key === 'none') {
      setFoodDiets(['none']);
      return;
    }
    setFoodDiets((v) => {
      const base = v.filter((k) => k !== 'none');
      return base.includes(key) ? base.filter((k) => k !== key) : [...base, key];
    });
  };

  function handleCoverFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    if (file.size > MAX_COVER_FILE_BYTES) {
      setCoverUploadError('That photo is over 6 MB. Pick a smaller one.');
      return;
    }
    setCoverUploadError(null);
    fileToCoverDataUrl(file)
      .then((dataUrl) => {
        setUploadedCover(dataUrl);
        setCover(dataUrl);
      })
      .catch(() => setCoverUploadError('Could not read that image. Try another photo.'));
  }

  function clearUploadedCover() {
    setUploadedCover(null);
    setCoverUploadError(null);
    setCover(COVER_OPTIONS[Math.floor(Math.random() * COVER_OPTIONS.length)] ?? COVER_OPTIONS[0]);
  }

  const submit = () => {
    if (!canSubmit || !dates.start || !dates.end) return;
    setSubmitting(true);
    setFormError(null);
    const startedAt = Date.now();
    create.mutate(
      {
        title: tripTitle,
        destination: destinations.map(destLabel).join(', '),
        startDate: dates.start,
        endDate: dates.end,
        coverImage: cover,
        homeCurrency: currency,
        budgetCents,
        budgetCurrency: currency,
        originCity: originCity || undefined,
        adults,
        children,
        intent: intent.length ? JSON.stringify(intent) : undefined,
        flexibility: flexibility ?? undefined,
        foodPrefs:
          foodDiets.length || foodNote.trim()
            ? JSON.stringify({ diets: foodDiets, note: foodNote.trim() })
            : undefined,
        mustSee: mustSee.trim() || undefined,
      },
      {
        onSuccess: async ({ id }) => {
          /* Family mode rides on the existing withChildren flag */
          if (children > 0) {
            try {
              await update.mutateAsync({ id, withChildren: true });
            } catch {
              /* cosmetic flag, ignore */
            }
          }
          // Best-effort tripmate invites (server enforces collaborator limits)
          for (const email of invites) {
            try {
              await addMember.mutateAsync({ tripId: id, name: nameFromEmail(email), email });
            } catch {
              /* invite skipped, trip itself is created */
            }
          }
          utils.trips.list.invalidate();
          // Keep the button loading for ~700ms, then crossfade to success
          timers.current.push(
            setTimeout(() => {
              setPhase('success');
              timers.current.push(
                setTimeout(() => {
                  onOpenChange(false);
                  navigate(`/trips/${id}`);
                }, 1100),
              );
            }, Math.max(0, 700 - (Date.now() - startedAt))),
          );
        },
        onError: (err) => {
          setSubmitting(false);
          if (err.message === 'UPGRADE_REQUIRED') setPhase('upsell');
          else setFormError(err.message);
        },
      },
    );
  };

  const meta = STEPS[step];
  const isLast = step === STEPS.length - 1;
  const canContinue =
    meta.id === 'destinations'
      ? destinations.length > 0
      : meta.id === 'dates'
        ? !!dates.start && !!dates.end
        : true;

  const goNext = () => {
    if (!canContinue) return;
    if (isLast) submit();
    else setStep((s) => Math.min(STEPS.length - 1, s + 1));
  };

  /* ── step bodies ── */

  const destinationStep = (
    <div>
      <div
        className={cn(
          'flex min-h-[48px] flex-wrap items-center gap-1.5 rounded-md border border-border-strong bg-surface px-3 py-2 transition-shadow duration-fast',
          comboFocus && 'border-brand ring-2 ring-brand/40',
        )}
        onClick={() => comboRef.current?.focus()}
      >
        <MapPin className="h-4 w-4 shrink-0 text-ink-3" strokeWidth={1.75} />
        {destinations.map((d) => (
          <span
            key={destLabel(d)}
            className="type-small inline-flex items-center gap-1 rounded-pill bg-brand-soft py-1 pl-3 pr-1.5 font-semibold text-brand"
          >
            {destLabel(d)}
            <button
              type="button"
              aria-label={`Remove ${d.city}`}
              onClick={() => setDestinations((v) => v.filter((x) => x !== d))}
              className="inline-flex h-4 w-4 items-center justify-center rounded-full transition-colors hover:bg-brand/20"
            >
              <X className="h-3 w-3" strokeWidth={2} />
            </button>
          </span>
        ))}
        <input
          ref={comboRef}
          value={comboInput}
          onChange={(e) => setComboInput(e.target.value)}
          onFocus={() => setComboFocus(true)}
          onBlur={() => setTimeout(() => setComboFocus(false), 150)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              const s = suggestions[0];
              if (s) addDestination(s);
              else if (comboInput.trim()) addDestination({ city: comboInput, country: '' });
            } else if (e.key === 'Backspace' && !comboInput && destinations.length) {
              setDestinations((v) => v.slice(0, -1));
            }
          }}
          placeholder={
            destinations.length ? 'Add another city…' : 'Search any city: Kyoto, Lisbon, Marrakech…'
          }
          className="type-body min-w-[150px] flex-1 bg-transparent py-1 outline-none placeholder:text-ink-3"
          aria-label="Destination city"
        />
      </div>

      {comboFocus && suggestions.length > 0 && (
        <ul className="z-10 mt-2 overflow-hidden rounded-md border border-border bg-surface shadow-lg">
          {suggestions.map((c, i) => (
            <motion.li
              key={`${c.city}|${c.country}`}
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.18, delay: 0.04 * i }}
            >
              <button
                type="button"
                onMouseDown={(e) => {
                  e.preventDefault();
                  addDestination(c);
                }}
                className="flex w-full items-center justify-between gap-3 px-3.5 py-2.5 text-left transition-colors duration-fast hover:bg-surface-2"
              >
                <span className="type-small inline-flex items-center gap-2 font-semibold text-ink">
                  <MapPin className="h-3.5 w-3.5 text-ink-3" strokeWidth={1.75} />
                  {c.city}
                </span>
                <span className="type-caption shrink-0 text-ink-3">
                  {c.country}
                  {c.source === 'global' ? ' · worldwide' : ''}
                </span>
              </button>
            </motion.li>
          ))}
        </ul>
      )}
      <p className="type-caption mt-2 text-ink-3">
        Cities from different countries are welcome, cross-border trips plan just the same.
      </p>
    </div>
  );

  const mustSeeStep = (
    <div>
      <textarea
        value={mustSee}
        onChange={(e) => setMustSee(e.target.value)}
        rows={5}
        maxLength={5000}
        placeholder={'e.g. Fushimi Inari at sunrise, a proper ramen night, teamLab, day trip to Nara…'}
        aria-label="Points to visit, things you want to do"
        className="type-body w-full resize-none rounded-md border border-border-strong bg-surface px-3.5 py-3 text-ink placeholder:text-ink-3 focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/40"
      />
      <p className="type-caption mt-2 text-ink-3">
        Free text, we keep it pinned to the trip so suggestions honour it.
      </p>
    </div>
  );

  const originStep = (
    <div className="relative">
      {originCity ? (
        <div className="flex items-center gap-2">
          <span className="type-small inline-flex items-center gap-1.5 rounded-pill bg-brand-soft py-1.5 pl-3 pr-1.5 font-semibold text-brand">
            <MapPin className="h-3.5 w-3.5" strokeWidth={1.75} />
            {originCity}
            <button
              type="button"
              aria-label="Clear starting point"
              onClick={() => {
                setOriginCity('');
                setOriginInput('');
              }}
              className="inline-flex h-4 w-4 items-center justify-center rounded-full transition-colors hover:bg-brand/20"
            >
              <X className="h-3 w-3" strokeWidth={2} />
            </button>
          </span>
        </div>
      ) : (
        <>
          <Input
            value={originInput}
            onChange={(e) => setOriginInput(e.target.value)}
            onFocus={() => setOriginFocus(true)}
            onBlur={() => setTimeout(() => setOriginFocus(false), 150)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                const s = originSuggestions[0];
                if (s) setOriginCity(destLabel(s));
                else if (originInput.trim()) setOriginCity(originInput.trim());
              }
            }}
            placeholder="Your home city or airport…"
            aria-label="From location"
            className="h-11 rounded-md border-border-strong bg-surface"
          />
          {originFocus && originSuggestions.length > 0 && (
            <ul className="absolute z-10 mt-2 w-full overflow-hidden rounded-md border border-border bg-surface shadow-lg">
              {originSuggestions.map((c) => (
                <li key={`${c.city}|${c.country}`}>
                  <button
                    type="button"
                    onMouseDown={(e) => {
                      e.preventDefault();
                      setOriginCity(destLabel(c));
                      setOriginInput('');
                    }}
                    className="flex w-full items-center justify-between gap-3 px-3.5 py-2.5 text-left transition-colors duration-fast hover:bg-surface-2"
                  >
                    <span className="type-small font-semibold text-ink">{c.city}</span>
                    <span className="type-caption text-ink-3">{c.country}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </div>
  );

  const datesStep = (
    <div>
      <div className="flex items-center justify-between gap-3">
        <span className="type-small text-ink-2">Exact dates</span>
        <label className="type-small inline-flex cursor-pointer items-center gap-2 text-ink-2">
          Flexible dates
          <Switch checked={flexible} onCheckedChange={setFlexible} aria-label="Flexible dates" />
        </label>
      </div>

      {flexible ? (
        <div className="mt-3 flex flex-wrap items-center gap-x-6 gap-y-4 rounded-lg border border-border bg-surface-2/60 p-4">
          <div>
            <span className="type-caption mb-1.5 block text-ink-3">Month</span>
            <Select value={flexMonth} onValueChange={setFlexMonth}>
              <SelectTrigger className="h-10 w-[180px] rounded-md border-border-strong bg-surface">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {monthOptions.map((m) => (
                  <SelectItem key={m.value} value={m.value}>
                    {m.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <span className="type-caption mb-1.5 block text-ink-3">Nights</span>
            <div className="flex items-center gap-1">
              <Button
                type="button"
                variant="secondary"
                size="icon-sm"
                aria-label="Fewer nights"
                onClick={() => setFlexNights((n) => Math.max(1, n - 1))}
              >
                <Minus className="h-3.5 w-3.5" strokeWidth={1.75} />
              </Button>
              <span className="type-small tnum w-[72px] text-center font-semibold text-ink">
                {flexNights} {flexNights === 1 ? 'night' : 'nights'}
              </span>
              <Button
                type="button"
                variant="secondary"
                size="icon-sm"
                aria-label="More nights"
                onClick={() => setFlexNights((n) => Math.min(30, n + 1))}
              >
                <Plus className="h-3.5 w-3.5" strokeWidth={1.75} />
              </Button>
            </div>
          </div>
        </div>
      ) : (
        <div className="mt-3 flex justify-center overflow-x-auto rounded-lg border border-border bg-surface p-2">
          <Calendar
            mode="range"
            numberOfMonths={isMobile ? 1 : 2}
            selected={range}
            onSelect={setRange}
            disabled={{ before: new Date() }}
          />
        </div>
      )}

      {dates.start && dates.end && (
        <motion.span
          initial={{ opacity: 0, scale: 0.94 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ type: 'spring', stiffness: 500, damping: 28 }}
          className="type-small tnum mt-3 inline-flex rounded-pill bg-brand-soft px-3 py-1.5 font-semibold text-brand"
        >
          {tripNights(dates.start, dates.end)} {tripNights(dates.start, dates.end) === 1 ? 'night' : 'nights'} ·{' '}
          {formatDateRange(dates.start, dates.end)}
        </motion.span>
      )}
    </div>
  );

  const membersStep = (
    <div className="grid gap-4 sm:grid-cols-2">
      {(
        [
          { label: 'Adults', value: adults, set: setAdults, min: 1, max: 20 },
          { label: 'Children', value: children, set: setChildren, min: 0, max: 12 },
        ] as const
      ).map((row) => (
        <div key={row.label} className="rounded-lg border border-border bg-surface-2/60 p-4">
          <span className="type-caption mb-2 block text-ink-3">{row.label}</span>
          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="secondary"
              size="icon-sm"
              aria-label={`Fewer ${row.label.toLowerCase()}`}
              onClick={() => row.set((n: number) => Math.max(row.min, n - 1))}
            >
              <Minus className="h-3.5 w-3.5" strokeWidth={1.75} />
            </Button>
            <span className="type-h3 tnum w-12 text-center text-ink">{row.value}</span>
            <Button
              type="button"
              variant="secondary"
              size="icon-sm"
              aria-label={`More ${row.label.toLowerCase()}`}
              onClick={() => row.set((n: number) => Math.min(row.max, n + 1))}
            >
              <Plus className="h-3.5 w-3.5" strokeWidth={1.75} />
            </Button>
          </div>
        </div>
      ))}
      {children > 0 && (
        <p className="type-caption sm:col-span-2 text-ink-3">
          Family mode switches on: gentler pacing and kid-friendly suggestions.
        </p>
      )}
    </div>
  );

  const intentStep = (
    <div className="flex flex-wrap gap-2">
      {INTENT_OPTIONS.map((o) => (
        <button
          key={o.key}
          type="button"
          aria-pressed={intent.includes(o.key)}
          onClick={() => toggleIntent(o.key)}
          className={cn(
            'type-small rounded-pill border px-4 py-2 font-semibold transition-all duration-fast active:scale-[0.97]',
            intent.includes(o.key)
              ? 'border-transparent bg-brand text-brand-ink shadow-sm'
              : 'border-border bg-surface text-ink-2 hover:border-border-strong hover:text-ink',
          )}
        >
          {o.label}
        </button>
      ))}
      <button
        type="button"
        aria-pressed={intent.includes('mix')}
        onClick={() => toggleIntent('mix')}
        className={cn(
          'type-small inline-flex items-center gap-1.5 rounded-pill border px-4 py-2 font-semibold transition-all duration-fast active:scale-[0.97]',
          intent.includes('mix')
            ? 'border-transparent bg-brand text-brand-ink shadow-sm'
            : 'border-border bg-surface text-ink-2 hover:border-border-strong hover:text-ink',
        )}
      >
        <Sparkles className="h-3.5 w-3.5" strokeWidth={1.75} />
        A mix of everything
      </button>
    </div>
  );

  const budgetStep = (
    <div>
      <div className="flex items-end gap-3">
        <div className="flex-1">
          <span className="type-caption mb-1.5 block text-ink-3">Amount (optional)</span>
          <div className="relative">
            <span className="type-small pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-3">
              {CURRENCY_SYMBOLS[currency] ?? currency}
            </span>
            <Input
              type="number"
              min={0}
              step={50}
              inputMode="decimal"
              placeholder="2,000"
              value={budget}
              onChange={(e) => setBudget(e.target.value)}
              className="h-11 rounded-md border-border-strong bg-surface pl-8 tnum"
              aria-label="Trip budget"
            />
          </div>
        </div>
        <div>
          <span className="type-caption mb-1.5 block text-ink-3">Currency</span>
          <Select value={currency} onValueChange={setCurrencyChoice}>
            <SelectTrigger className="h-11 w-[130px] rounded-md border-border-strong bg-surface" aria-label="Budget currency">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {Object.keys(FX_PER_USD).map((code) => (
                <SelectItem key={code} value={code}>
                  {code} ({CURRENCY_SYMBOLS[code] ?? code})
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>
      <p className="type-caption mt-2 text-ink-3">
        Tell us how much you want to spend, we rank friendlier options first and
        flag the plan when it runs over. A soft target, adjust anytime.
      </p>
    </div>
  );

  const tradeoffsStep = (
    <div className="space-y-4">
      {advice.length > 0 ? (
        <ul className="space-y-2.5">
          {advice.map((a) => (
            <li key={a.id} className="rounded-lg border border-border bg-surface-2/50 p-3.5">
              <p className="type-small flex items-center gap-2 font-semibold text-ink">
                <Sparkles className="h-4 w-4 shrink-0 text-brand" strokeWidth={1.75} />
                {a.title}
                {a.premium ? (
                  isPremium ? (
                    <span
                      title="Deeper trade-off analysis, included with Voyager"
                      className="type-caption inline-flex items-center gap-1 rounded-pill bg-ochre-soft px-2 py-0.5 font-semibold text-ochre"
                    >
                      <Crown className="h-3 w-3" strokeWidth={1.75} />
                      Voyager
                    </span>
                  ) : (
                    <span
                      title="Voyager feature"
                      className="type-caption inline-flex items-center gap-1 rounded-pill bg-ochre-soft px-2 py-0.5 font-semibold text-ochre"
                    >
                      <Crown className="h-3 w-3" strokeWidth={1.75} />
                      Voyager
                    </span>
                  )
                ) : null}
              </p>
              {a.premium && !isPremium ? (
                <div className="mt-1.5 flex items-center justify-between gap-3 rounded-md border border-dashed border-ochre/40 bg-ochre-soft/40 px-3 py-2">
                  <p className="type-small text-ink-2">
                    This trade-off analysis is a Voyager feature.
                  </p>
                  <Button
                    variant="premium"
                    size="sm"
                    onClick={() => navigate('/pricing')}
                  >
                    Upgrade
                  </Button>
                </div>
              ) : (
                <p className="type-small mt-1.5 text-ink-2">{a.body}</p>
              )}
            </li>
          ))}
        </ul>
      ) : (
        <p className="type-small rounded-lg border border-dashed border-border p-3.5 text-ink-3">
          Add destinations and dates and we surface route-specific trade-offs here.
        </p>
      )}

      <div>
        <span className="type-caption mb-2 block text-ink-3">Planning style</span>
        <div className="grid gap-2.5 sm:grid-cols-2">
          {(
            [
              {
                key: 'planned' as const,
                title: 'Well-planned',
                body: 'Timed days, booked-ahead headline spots, fewer decisions on the ground.',
              },
              {
                key: 'flexible' as const,
                title: 'Flexible',
                body: 'Loose day skeletons and room to wander, swap, and stay longer where it feels right.',
              },
            ]
          ).map((o) => (
            <button
              key={o.key}
              type="button"
              aria-pressed={flexibility === o.key}
              onClick={() => setFlexibility((f) => (f === o.key ? null : o.key))}
              className={cn(
                'rounded-lg border p-3.5 text-left transition-all duration-fast active:scale-[0.98]',
                flexibility === o.key
                  ? 'border-transparent bg-brand-soft ring-2 ring-brand'
                  : 'border-border bg-surface hover:border-border-strong',
              )}
            >
              <span className="type-small block font-semibold text-ink">{o.title}</span>
              <span className="type-caption mt-1 block text-ink-2">{o.body}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );

  const gearStep = (
    <ul className="space-y-2.5">
      {gear.map((g) => (
        <li key={g.id} className="rounded-lg border border-border bg-surface-2/50 p-3.5">
          <p className="type-small flex items-center gap-2 font-semibold text-ink">
            <Backpack className="h-4 w-4 shrink-0 text-brand" strokeWidth={1.75} />
            {g.title}
          </p>
          <p className="type-small mt-1.5 text-ink-2">{g.body}</p>
        </li>
      ))}
    </ul>
  );

  const foodStep = (
    <div>
      <div className="flex flex-wrap gap-2">
        {DIET_OPTIONS.map((o) => (
          <button
            key={o.key}
            type="button"
            aria-pressed={foodDiets.includes(o.key)}
            onClick={() => toggleDiet(o.key)}
            className={cn(
              'type-small inline-flex items-center gap-1.5 rounded-pill border px-4 py-2 font-semibold transition-all duration-fast active:scale-[0.97]',
              foodDiets.includes(o.key)
                ? 'border-transparent bg-brand text-brand-ink shadow-sm'
                : 'border-border bg-surface text-ink-2 hover:border-border-strong hover:text-ink',
            )}
          >
            <UtensilsCrossed className="h-3.5 w-3.5" strokeWidth={1.75} />
            {o.label}
          </button>
        ))}
      </div>
      <textarea
        value={foodNote}
        onChange={(e) => setFoodNote(e.target.value)}
        rows={3}
        maxLength={500}
        placeholder="Anything else: allergies, must-try dishes, no spicy food…"
        aria-label="Food notes"
        className="type-body mt-3 w-full resize-none rounded-md border border-border-strong bg-surface px-3.5 py-3 text-ink placeholder:text-ink-3 focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/40"
      />
    </div>
  );

  const finishingStep = (
    <div className="space-y-6">
      <div>
        <span className="type-caption mb-1.5 block text-ink-3">Trip name</span>
        <Input
          value={titleOverride ?? derivedTitle}
          onChange={(e) => setTitleOverride(e.target.value)}
          placeholder="Name this journey"
          maxLength={255}
          className="h-11 rounded-md border-border-strong bg-surface"
          aria-label="Trip name"
        />
      </div>

      <div>
        <div className="flex items-center justify-between">
          <span className="type-caption text-ink-3">Cover</span>
          <button
            type="button"
            onClick={() =>
              setCover(COVER_OPTIONS[Math.floor(Math.random() * COVER_OPTIONS.length)] ?? COVER_OPTIONS[0])
            }
            className="type-small inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-ink-2 transition-colors duration-fast hover:bg-surface-2 hover:text-ink"
          >
            <Shuffle className="h-3.5 w-3.5" strokeWidth={1.75} />
            Surprise me
          </button>
        </div>
        <div className="mt-3 grid grid-cols-3 gap-3">
          <input
            ref={coverFileRef}
            type="file"
            accept="image/*"
            className="hidden"
            aria-hidden="true"
            tabIndex={-1}
            onChange={handleCoverFile}
          />
          <div
            className={cn(
              'relative aspect-[16/9] overflow-hidden rounded-md transition-all duration-200',
              uploadedCover && cover === uploadedCover
                ? 'scale-[1.02] ring-2 ring-brand ring-offset-2 ring-offset-surface'
                : 'hover:scale-[1.02]',
            )}
          >
            <button
              type="button"
              aria-pressed={uploadedCover != null && cover === uploadedCover}
              aria-label={uploadedCover ? 'Replace uploaded cover photo' : 'Upload a cover photo'}
              onClick={() => coverFileRef.current?.click()}
              className={cn(
                'flex h-full w-full flex-col items-center justify-center gap-1 rounded-md',
                uploadedCover
                  ? ''
                  : 'border border-dashed border-border-strong text-ink-3 transition-colors duration-fast hover:border-brand/50 hover:text-brand',
              )}
            >
              {uploadedCover ? (
                <img src={uploadedCover} alt="Uploaded cover" className="photo h-full w-full object-cover" />
              ) : (
                <>
                  <ImagePlus className="h-5 w-5" strokeWidth={1.75} />
                  <span className="type-caption">Upload photo</span>
                </>
              )}
            </button>
            {uploadedCover && (
              <button
                type="button"
                aria-label="Remove uploaded photo"
                onClick={clearUploadedCover}
                className="absolute right-1.5 top-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-black/55 text-white transition-colors duration-fast hover:bg-black/75"
              >
                <X className="h-3 w-3" strokeWidth={2.5} />
              </button>
            )}
          </div>
          {COVER_OPTIONS.slice(0, 6).map((src) => (
            <button
              key={src}
              type="button"
              aria-pressed={cover === src}
              onClick={() => setCover(src)}
              className={cn(
                'relative aspect-[16/9] overflow-hidden rounded-md transition-all duration-200',
                cover === src
                  ? 'scale-[1.02] ring-2 ring-brand ring-offset-2 ring-offset-surface'
                  : 'hover:scale-[1.02] hover:ring-1 hover:ring-border-strong',
              )}
            >
              <img src={src} alt="" className="photo h-full w-full object-cover" />
              {cover === src && (
                <motion.span
                  initial={{ scale: 0 }}
                  animate={{ scale: 1 }}
                  transition={SPRING_PIN_POP}
                  className="absolute right-1.5 top-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-brand text-brand-ink"
                >
                  <Check className="h-3 w-3" strokeWidth={2.5} />
                </motion.span>
              )}
            </button>
          ))}
        </div>
        {coverUploadError && (
          <p className="type-caption mt-2 text-danger" role="alert">
            {coverUploadError}
          </p>
        )}
      </div>

      <div>
        <span className="type-caption mb-1.5 block text-ink-3">Invite tripmates</span>
        <div
          className="flex min-h-[48px] flex-wrap items-center gap-1.5 rounded-md border border-border-strong bg-surface px-3 py-2"
          onClick={() => document.getElementById('invite-input')?.focus()}
        >
          {invites.map((email) => (
            <span
              key={email}
              className="type-small inline-flex items-center gap-1 rounded-pill bg-surface-2 py-1 pl-3 pr-1.5 font-medium text-ink"
            >
              {email}
              <button
                type="button"
                aria-label={`Remove ${email}`}
                onClick={() => setInvites((v) => v.filter((x) => x !== email))}
                className="inline-flex h-4 w-4 items-center justify-center rounded-full text-ink-3 transition-colors hover:bg-border hover:text-ink"
              >
                <X className="h-3 w-3" strokeWidth={2} />
              </button>
            </span>
          ))}
          <input
            id="invite-input"
            value={inviteInput}
            onChange={(e) => setInviteInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ',') {
                e.preventDefault();
                addInvite(inviteInput);
              } else if (e.key === 'Backspace' && !inviteInput && invites.length) {
                setInvites((v) => v.slice(0, -1));
              }
            }}
            onBlur={() => inviteInput.trim() && addInvite(inviteInput)}
            placeholder={invites.length ? 'Add another email…' : 'friend@example.com'}
            type="email"
            className="type-body min-w-[180px] flex-1 bg-transparent py-1 outline-none placeholder:text-ink-3"
            aria-label="Invite by email"
          />
        </div>
        <p className="type-caption mt-2 text-ink-3">
          They’ll get a magic link. Free tier: up to 3 collaborators.
        </p>
        {invites.length > 3 && (
          <button
            type="button"
            onClick={() => navigate('/pricing')}
            className="type-small mt-1.5 inline-flex items-center gap-1.5 font-semibold text-ochre transition-colors hover:brightness-110"
          >
            <Crown className="h-3.5 w-3.5" strokeWidth={1.75} />
            Need more? Voyager
          </button>
        )}
      </div>
    </div>
  );

  const stepBody: Record<StepId, React.ReactNode> = {
    destinations: destinationStep,
    mustSee: mustSeeStep,
    origin: originStep,
    dates: datesStep,
    members: membersStep,
    intent: intentStep,
    budget: budgetStep,
    tradeoffs: tradeoffsStep,
    gear: gearStep,
    food: foodStep,
    finishing: finishingStep,
  };

  return (
      <DialogContent
        showCloseButton={phase !== 'success'}
        className={cn(
          'flex max-h-[92dvh] flex-col gap-0 overflow-hidden rounded-xl border-border bg-surface p-0 shadow-lg sm:max-w-[720px] max-md:max-w-none',
          // Mobile: full-height bottom sheet (90% detent)
          'max-md:bottom-0 max-md:left-0 max-md:top-auto max-md:h-[90dvh] max-md:max-h-none max-md:translate-x-0 max-md:translate-y-0 max-md:rounded-b-none max-md:rounded-t-[24px]',
        )}
      >
        <AnimatePresence mode="wait" initial={false}>
          {phase === 'upsell' ? (
            <motion.div
              key="upsell"
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              transition={{ duration: 0.28, ease: EASE_EXPO }}
              className="flex flex-col items-center px-8 py-12 text-center"
            >
              <span className="flex h-14 w-14 items-center justify-center rounded-full bg-ochre-soft text-ochre">
                <Crown className="h-6 w-6" strokeWidth={1.75} />
              </span>
              <h3 className="type-h3 mt-5 text-ink">Your Wanderer atlas is full</h3>
              <p className="type-body mt-2 max-w-[42ch] text-ink-2">
                Free plans hold 3 active trips. Wayfare Voyager unlocks unlimited trips, route
                optimization, and unlimited collaborators, {priceForBrowser().yearly.label}.
              </p>
              <div className="mt-7 flex flex-wrap items-center justify-center gap-2">
                <Button variant="ghost" onClick={() => onOpenChange(false)}>
                  Not now
                </Button>
                <Button variant="premium" onClick={() => navigate('/pricing')}>
                  <Crown className="h-4 w-4" strokeWidth={1.75} />
                  See Voyager plans
                </Button>
              </div>
            </motion.div>
          ) : phase === 'success' ? (
            <motion.div
              key="success"
              initial={{ opacity: 0, scale: 0.97 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.32, ease: EASE_EXPO }}
              className="flex flex-col items-center px-8 py-16 text-center"
            >
              <motion.span
                initial={{ scale: 0.5, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                transition={SPRING_PIN_POP}
                className="flex h-14 w-14 items-center justify-center rounded-full bg-pine-soft text-pine"
              >
                <PartyPopper className="h-6 w-6" strokeWidth={1.75} />
              </motion.span>
              <h3 className="type-h3 mt-5 text-ink">Trip created, let’s fill Day 1</h3>
              <p className="type-small mt-2 text-ink-3">Opening your workspace…</p>
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
                <DialogTitle className="type-h3 text-ink">New trip</DialogTitle>
                <DialogDescription className="type-small text-ink-2">
                  A few quick questions, everything except places and dates is skippable.
                </DialogDescription>
              </DialogHeader>

              {/* progress dots */}
              <div className="flex items-center gap-1.5 border-b border-border px-6 py-2.5 md:px-8" aria-label={`Step ${step + 1} of ${STEPS.length}`}>
                {STEPS.map((s, i) => (
                  <button
                    key={s.id}
                    type="button"
                    aria-label={`Go to step: ${s.title}`}
                    onClick={() => {
                      /* jump back freely; forward moves go through Continue
                         so required steps stay enforced */
                      if (i < step) setStep(i);
                    }}
                    className={cn(
                      'h-1.5 flex-1 rounded-full transition-colors duration-fast',
                      i === step ? 'bg-brand' : i < step ? 'bg-brand/40' : 'bg-surface-2',
                    )}
                  />
                ))}
              </div>

              <div className="min-h-0 flex-1 overflow-y-auto px-6 py-6 md:px-8">
                <AnimatePresence mode="wait" initial={false}>
                  <motion.section
                    key={meta.id}
                    initial={{ opacity: 0, x: 16 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0, x: -12 }}
                    transition={{ duration: 0.22, ease: EASE_EXPO }}
                  >
                    <span className="type-eyebrow text-ink-3">
                      Step {step + 1} of {STEPS.length}
                    </span>
                    <h4 className="type-h4 mt-1 text-ink">{meta.title}</h4>
                    <p className="type-small mt-0.5 text-ink-2">{meta.hint}</p>
                    <div className="mt-4">{stepBody[meta.id]}</div>
                  </motion.section>
                </AnimatePresence>
              </div>

              {/* Footer */}
              <div className="flex items-center justify-between gap-3 border-t border-border px-6 py-4 md:px-8">
                <span className="type-caption text-danger" role="alert">
                  {formError ?? ''}
                </span>
                <div className="flex items-center gap-2">
                  {step > 0 ? (
                    <Button variant="ghost" onClick={() => setStep((s) => Math.max(0, s - 1))}>
                      <ArrowLeft className="h-4 w-4" strokeWidth={1.75} />
                      Back
                    </Button>
                  ) : (
                    <Button variant="ghost" onClick={() => onOpenChange(false)}>
                      Cancel
                    </Button>
                  )}
                  {meta.skippable && !isLast ? (
                    <Button variant="ghost" onClick={() => setStep((s) => Math.min(STEPS.length - 1, s + 1))}>
                      Skip
                    </Button>
                  ) : null}
                  <Button onClick={goNext} disabled={!canContinue || submitting} className="min-w-[128px]">
                    {submitting ? (
                      <>
                        <Loader2 className="h-4 w-4 animate-spin" strokeWidth={2} />
                        Creating…
                      </>
                    ) : isLast ? (
                      <>
                        <Heart className="h-4 w-4" strokeWidth={1.75} />
                        Create trip
                      </>
                    ) : (
                      <>
                        Continue
                        <ArrowRight className="h-4 w-4" strokeWidth={1.75} />
                      </>
                    )}
                  </Button>
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </DialogContent>
  );
}
