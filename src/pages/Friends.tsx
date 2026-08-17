/**
 * Friends planning (r12-friends) - public guest page at /friends/:token.
 * The token in the URL IS the credential: friends need no Wayfare account.
 *
 * Three states in one page:
 *  (a) JOIN/FORM - name, home city (Photon search), availability date chips,
 *      style + location preferences, or "Let the group decide for me".
 *  (b) TALLY BOARD - participant checklist, per-date vote heat bars, live
 *      countdown to the deadline, threshold progress; celebration banner
 *      with the winning date once the quorum is met.
 *  (c) MET - destination suggestion cards near the available homes; the
 *      owner picks one (2–7 days) to convert the session into a shared trip.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { motion } from 'framer-motion';
import {
  CalendarCheck2,
  Check,
  ChevronLeft,
  ChevronRight,
  Crown,
  Loader2,
  MapPin,
  PartyPopper,
  Sparkles,
  Timer,
  UserPlus,
  Users,
} from 'lucide-react';
import Logo from '@/components/Logo';
import { FriendChatPanel } from '@/components/trips/FriendChatPanel';
import { formatMoneyCompact } from '@contracts/fx';
import { CopyLinkField } from '@/components/CopyLinkField';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Toaster } from '@/components/ui/sonner';
import { toast } from 'sonner';
import { trpc } from '@/providers/trpc';
import { cn } from '@/lib/utils';
import { EASE_EXPO } from '@/lib/motion';
import { STYLE_CHIPS, stylesForChips } from '@/components/onboarding/quiz-data';
import type { PreferenceStyle } from '@contracts/premium';

type SessionData = NonNullable<ReturnType<typeof useSessionData>['data']>;
function useSessionData(token: string) {
  return trpc.friends.getSessionByToken.useQuery(
    { token },
    { retry: false, refetchInterval: 15_000 },
  );
}

const LONG_FMT = new Intl.DateTimeFormat('en', { weekday: 'long', month: 'long', day: 'numeric' });
const SHORT_FMT = new Intl.DateTimeFormat('en', { weekday: 'short', month: 'short', day: 'numeric' });
const MONTH_YEAR_FMT = new Intl.DateTimeFormat('en', { month: 'long', year: 'numeric' });

/** Matches the api/friends-router submitPlan cap. */
const MAX_PICKS = 120;
const WEEKDAY_LABELS = ['M', 'T', 'W', 'T', 'F', 'S', 'S']; // Monday-first

function isoOfUTC(d: Date): string {
  return d.toISOString().slice(0, 10);
}
function todayIso(): string {
  return isoOfUTC(new Date());
}
/** Last selectable/votable day: today + 12 months (same window the api enforces). */
function maxPlanIso(): string {
  const d = new Date();
  d.setUTCFullYear(d.getUTCFullYear() + 1);
  return isoOfUTC(d);
}

type YM = { y: number; m: number };
function ymOf(iso: string): YM {
  return { y: Number(iso.slice(0, 4)), m: Number(iso.slice(5, 7)) - 1 };
}
function ymIndex(ym: YM): number {
  return ym.y * 12 + ym.m;
}
function shiftYm(ym: YM, delta: number): YM {
  const i = ymIndex(ym) + delta;
  return { y: Math.floor(i / 12), m: ((i % 12) + 12) % 12 };
}

type CalCell = { iso: string; day: number } | null;
/** Monday-first weeks for a (UTC) month; null cells pad the grid. */
function monthWeeks(ym: YM): CalCell[][] {
  const offset = (new Date(Date.UTC(ym.y, ym.m, 1)).getUTCDay() + 6) % 7;
  const daysIn = new Date(Date.UTC(ym.y, ym.m + 1, 0)).getUTCDate();
  const cells: CalCell[] = Array.from({ length: offset }, () => null);
  for (let d = 1; d <= daysIn; d++) {
    cells.push({ iso: isoOfUTC(new Date(Date.UTC(ym.y, ym.m, d))), day: d });
  }
  while (cells.length % 7 !== 0) cells.push(null);
  const weeks: CalCell[][] = [];
  for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7));
  return weeks;
}

/** Month grid frame: weekday header + prev/next navigation. */
function MonthFrame({
  ym,
  minYm,
  maxYm,
  onShift,
  children,
}: {
  ym: YM;
  minYm: YM;
  maxYm: YM;
  onShift: (delta: number) => void;
  children: React.ReactNode;
}) {
  return (
    <div>
      <div className="flex items-center justify-between">
        <button
          type="button"
          aria-label="Previous month"
          disabled={ymIndex(ym) <= ymIndex(minYm)}
          onClick={() => onShift(-1)}
          className="rounded-md p-1.5 text-ink-3 transition-colors duration-fast hover:bg-surface-2 hover:text-ink disabled:pointer-events-none disabled:opacity-30"
        >
          <ChevronLeft className="h-4 w-4" strokeWidth={1.75} />
        </button>
        <span className="type-small font-semibold text-ink">
          {MONTH_YEAR_FMT.format(new Date(Date.UTC(ym.y, ym.m, 1)))}
        </span>
        <button
          type="button"
          aria-label="Next month"
          disabled={ymIndex(ym) >= ymIndex(maxYm)}
          onClick={() => onShift(1)}
          className="rounded-md p-1.5 text-ink-3 transition-colors duration-fast hover:bg-surface-2 hover:text-ink disabled:pointer-events-none disabled:opacity-30"
        >
          <ChevronRight className="h-4 w-4" strokeWidth={1.75} />
        </button>
      </div>
      <div className="mt-2 grid grid-cols-7 gap-1">
        {WEEKDAY_LABELS.map((w, i) => (
          <span key={i} className="type-caption py-0.5 text-center font-semibold uppercase tracking-[0.06em] text-ink-3">
            {w}
          </span>
        ))}
        {children}
      </div>
    </div>
  );
}

/**
 * Interactive availability calendar: click toggles a day, drag paints a
 * contiguous selection (paint mode = select or deselect, set by the first
 * cell), taps work via synthesized mouse events. Window: today..+12 months.
 */
function AvailabilityCalendar({
  dates,
  setDates,
}: {
  dates: Set<string>;
  setDates: React.Dispatch<React.SetStateAction<Set<string>>>;
}) {
  const minIso = todayIso();
  const maxIso = maxPlanIso();
  const minYm = ymOf(minIso);
  const maxYm = ymOf(maxIso);
  const [ym, setYm] = useState<YM>(() => {
    const first = [...dates].sort().find((d) => d >= minIso && d <= maxIso);
    return first ? ymOf(first) : minYm;
  });
  const drag = useRef<{ paint: boolean } | null>(null);

  useEffect(() => {
    const up = () => {
      drag.current = null;
    };
    window.addEventListener('mouseup', up);
    return () => window.removeEventListener('mouseup', up);
  }, []);

  const apply = (iso: string, paint: boolean) =>
    setDates((prev) => {
      const has = prev.has(iso);
      if (paint === has) return prev;
      if (paint && prev.size >= MAX_PICKS) return prev;
      const next = new Set(prev);
      if (paint) next.add(iso);
      else next.delete(iso);
      return next;
    });

  const weeks = monthWeeks(ym);
  return (
    <MonthFrame ym={ym} minYm={minYm} maxYm={maxYm} onShift={(d) => setYm((v) => shiftYm(v, d))}>
      {weeks.flat().map((cell, i) =>
        cell == null ? (
          <span key={`x${i}`} />
        ) : (
          (() => {
            const on = dates.has(cell.iso);
            const disabled = cell.iso < minIso || cell.iso > maxIso;
            return (
              <button
                key={cell.iso}
                type="button"
                disabled={disabled}
                aria-pressed={on}
                aria-label={LONG_FMT.format(new Date(cell.iso + 'T00:00:00Z'))}
                onMouseDown={(e) => {
                  e.preventDefault();
                  if (disabled) return;
                  drag.current = { paint: !on };
                  apply(cell.iso, !on);
                }}
                onMouseEnter={() => {
                  if (drag.current && !disabled) apply(cell.iso, drag.current.paint);
                }}
                className={cn(
                  'flex h-9 select-none items-center justify-center rounded-md border text-[12px] font-medium transition-colors duration-fast',
                  on
                    ? 'border-pine bg-pine text-white'
                    : 'border-border bg-surface text-ink-2 hover:border-border-strong hover:text-ink',
                  disabled && 'pointer-events-none border-transparent bg-transparent text-ink-3/40',
                )}
              >
                {cell.day}
              </button>
            );
          })()
        ),
      )}
    </MonthFrame>
  );
}

function useNow(intervalMs = 1000) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(t);
  }, [intervalMs]);
  return now;
}

function countdownParts(ms: number) {
  if (ms <= 0) return 'Voting closed';
  const s = Math.floor(ms / 1000);
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (d > 0) return `${d}d ${h}h left to vote`;
  if (h > 0) return `${h}h ${m}m left to vote`;
  return `${m}m ${sec}s left to vote`;
}

// ── (a) join + preferences form ─────────────────────────────────────────────
function PlanForm({ token, data }: { token: string; data: SessionData }) {
  const utils = trpc.useUtils();
  const me = data.me;
  const storedPrefs = useMemo(() => {
    try {
      return me.prefsJson ? (JSON.parse(me.prefsJson) as {
        styles?: string[]; locationPref?: string; region?: string; useGroupDecision?: boolean;
      }) : null;
    } catch {
      return null;
    }
  }, [me.prefsJson]);

  const [name, setName] = useState(me.name === 'Invited friend' ? '' : me.name);
  const [email, setEmail] = useState(me.email ?? '');
  const [home, setHome] = useState<{ name: string; lat: number; lng: number } | null>(
    me.homeName && me.homeLat != null && me.homeLng != null
      ? { name: me.homeName, lat: me.homeLat, lng: me.homeLng }
      : null,
  );
  const [homeQuery, setHomeQuery] = useState(me.homeName ?? '');
  const [homeFocus, setHomeFocus] = useState(false);
  const [debouncedQuery, setDebouncedQuery] = useState('');
  const [dates, setDates] = useState<Set<string>>(
    () => new Set(me.datesJson ? (JSON.parse(me.datesJson) as string[]) : []),
  );
  const [chips, setChips] = useState<Set<string>>(
    () => new Set(STYLE_CHIPS.filter((c) => storedPrefs?.styles?.includes(c.style)).map((c) => c.id)),
  );
  const [locationPref, setLocationPref] = useState<'near-me' | 'region' | 'anywhere'>(
    (storedPrefs?.locationPref as 'near-me' | 'region' | 'anywhere') ?? 'anywhere',
  );
  const [region, setRegion] = useState(storedPrefs?.region ?? '');
  const [groupDecides, setGroupDecides] = useState(storedPrefs?.useGroupDecision ?? false);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => setDebouncedQuery(homeQuery.trim()), 300);
    return () => clearTimeout(t);
  }, [homeQuery]);

  const citiesQ = trpc.friends.searchCities.useQuery(
    { query: debouncedQuery },
    { enabled: homeFocus && debouncedQuery.length >= 2, retry: false },
  );
  const join = trpc.friends.joinByToken.useMutation();
  const submit = trpc.friends.submitPlan.useMutation();

  const canSubmit =
    name.trim().length > 0 && home != null && dates.size > 0 &&
    (groupDecides || locationPref !== 'region' || region.trim().length > 0);

  const toggleChip = (id: string) =>
    setChips((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const onSubmit = async () => {
    if (!canSubmit || !home) return;
    setSubmitting(true);
    try {
      await join.mutateAsync({
        token,
        name: name.trim(),
        homeName: home.name,
        homeLat: home.lat,
        homeLng: home.lng,
        ...(email.trim() ? { email: email.trim() } : {}),
      });
      await submit.mutateAsync({
        token,
        dates: [...dates].sort(),
        styles: groupDecides ? [] : (stylesForChips([...chips]) as PreferenceStyle[]),
        locationPref: groupDecides ? 'anywhere' : locationPref,
        region: groupDecides || locationPref !== 'region' ? undefined : region.trim(),
        useGroupDecision: groupDecides,
      });
      toast.success('You’re in!', { description: 'Your availability and preferences are counted.' });
      await utils.friends.getSessionByToken.invalidate({ token });
    } catch (e) {
      toast.error('Could not save', { description: e instanceof Error ? e.message : undefined });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <motion.section
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35, ease: EASE_EXPO }}
      className="rounded-lg border border-border bg-surface p-6 shadow-sm md:p-8"
    >
      <h2 className="type-h3 text-ink">Join the plan</h2>
      <p className="type-small mt-1 text-ink-2">
        Tell {data.ownerName} when you can go and what you’re into.
      </p>

      {/* name */}
      <label className="type-small mt-6 block font-medium text-ink" htmlFor="fp-name">
        Your name
      </label>
      <input
        id="fp-name"
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="e.g. Priya"
        maxLength={120}
        className="type-body mt-2 h-11 w-full rounded-md border border-border-strong bg-surface px-3 text-ink outline-none transition-colors duration-fast placeholder:text-ink-3 focus:border-brand"
      />

      {/* home city */}
      <label className="type-small mt-5 block font-medium text-ink" htmlFor="fp-home">
        Your home city
      </label>
      <div className="relative mt-2">
        <MapPin className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-3" strokeWidth={1.75} />
        <input
          id="fp-home"
          value={homeQuery}
          onChange={(e) => {
            setHomeQuery(e.target.value);
            setHome(null);
          }}
          onFocus={() => setHomeFocus(true)}
          onBlur={() => setTimeout(() => setHomeFocus(false), 150)}
          placeholder="Start typing, e.g. Jaipur"
          maxLength={120}
          className="type-body h-11 w-full rounded-md border border-border-strong bg-surface pl-9 pr-3 text-ink outline-none transition-colors duration-fast placeholder:text-ink-3 focus:border-brand"
        />
        {homeFocus && citiesQ.data && citiesQ.data.length > 0 && !home && (
          <ul className="absolute z-20 mt-1 w-full overflow-hidden rounded-md border border-border bg-surface shadow-md">
            {citiesQ.data.map((c) => (
              <li key={`${c.name}-${c.country}`}>
                <button
                  type="button"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => {
                    setHome({ name: c.name, lat: c.lat, lng: c.lng });
                    setHomeQuery(`${c.name}, ${c.country}`);
                    setHomeFocus(false);
                  }}
                  className="type-small flex w-full items-center gap-2 px-3 py-2.5 text-left text-ink transition-colors duration-fast hover:bg-surface-2"
                >
                  <MapPin className="h-3.5 w-3.5 shrink-0 text-ink-3" strokeWidth={1.75} />
                  {c.name}
                  <span className="text-ink-3">{[c.state, c.country].filter(Boolean).join(', ')}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
      <p className="type-caption mt-1.5 text-ink-3">
        Used only to find destinations near everyone once the group agrees on a date.
      </p>

      {/* email (optional, lets a later account claim this spot) */}
      <label className="type-small mt-5 block font-medium text-ink" htmlFor="fp-email">
        Email <span className="font-normal text-ink-3">(optional)</span>
      </label>
      <input
        id="fp-email"
        type="email"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        placeholder="you@example.com"
        maxLength={320}
        className="type-body mt-2 h-11 w-full rounded-md border border-border-strong bg-surface px-3 text-ink outline-none transition-colors duration-fast placeholder:text-ink-3 focus:border-brand"
      />
      <p className="type-caption mt-1.5 text-ink-3">
        If you later create a Wayfare account with this email, the trip lands in your trips automatically.
      </p>

      {/* availability */}
      <div className="mt-6 flex items-baseline justify-between">
        <span className="type-small font-medium text-ink">When are you free? (next 12 months)</span>
        <span className="type-caption text-ink-3 tnum">{dates.size} picked</span>
      </div>
      <div className="mt-2 rounded-md border border-border bg-bg-subtle p-3">
        <AvailabilityCalendar dates={dates} setDates={setDates} />
        <p className="type-caption mt-2 text-ink-3">
          Click days or drag across a range, pick every day you could travel.
        </p>
      </div>

      {/* group decision toggle */}
      <div className="mt-6 flex items-center justify-between gap-4 rounded-md border border-brand/30 bg-brand-soft px-4 py-3">
        <div className="flex items-center gap-3">
          <Sparkles className="h-4 w-4 shrink-0 text-brand" strokeWidth={1.75} />
          <div>
            <p className="type-small font-semibold text-ink">Let the group decide for me</p>
            <p className="type-caption text-ink-2">Skip style & location picks, go with the majority.</p>
          </div>
        </div>
        <Switch checked={groupDecides} onCheckedChange={setGroupDecides} aria-label="Let the group decide for me" />
      </div>

      {/* styles + location (disabled when the group decides) */}
      <fieldset disabled={groupDecides} className={cn('transition-opacity duration-fast', groupDecides && 'opacity-40')}>
        <span className="type-small mt-5 block font-medium text-ink">What are you into?</span>
        <div className="mt-2 flex flex-wrap gap-1.5">
          {STYLE_CHIPS.map((c) => {
            const on = chips.has(c.id);
            const Icon = c.icon;
            return (
              <button
                key={c.id}
                type="button"
                onClick={() => toggleChip(c.id)}
                aria-pressed={on}
                className={cn(
                  'type-small inline-flex items-center gap-1.5 rounded-pill border px-3 py-1.5 transition-colors duration-fast',
                  on
                    ? 'border-pine bg-pine-soft text-pine'
                    : 'border-border bg-surface text-ink-2 hover:border-border-strong hover:text-ink',
                )}
              >
                <Icon className="h-3.5 w-3.5" strokeWidth={1.75} />
                {c.label}
              </button>
            );
          })}
        </div>

        <span className="type-small mt-5 block font-medium text-ink">Where should the trip go?</span>
        <div className="mt-2 space-y-1.5">
          {(
            [
              { id: 'near-me', label: 'Near me', hint: 'Keep it within a few hours of home' },
              { id: 'region', label: 'A region', hint: 'Name a region or country' },
              { id: 'anywhere', label: 'Anywhere', hint: 'Happy to fly far' },
            ] as const
          ).map((opt) => (
            <label
              key={opt.id}
              className={cn(
                'flex cursor-pointer items-center gap-3 rounded-md border px-3 py-2.5 transition-colors duration-fast',
                locationPref === opt.id ? 'border-pine bg-pine-soft' : 'border-border bg-surface hover:border-border-strong',
              )}
            >
              <input
                type="radio"
                name="fp-loc"
                checked={locationPref === opt.id}
                onChange={() => setLocationPref(opt.id)}
                className="h-4 w-4 accent-[var(--pine)]"
              />
              <span className="type-small font-medium text-ink">{opt.label}</span>
              <span className="type-caption text-ink-3">{opt.hint}</span>
            </label>
          ))}
        </div>
        {locationPref === 'region' && (
          <input
            value={region}
            onChange={(e) => setRegion(e.target.value)}
            placeholder="e.g. Rajasthan, Japan, the Alps…"
            maxLength={120}
            className="type-body mt-2 h-11 w-full rounded-md border border-border-strong bg-surface px-3 text-ink outline-none transition-colors duration-fast placeholder:text-ink-3 focus:border-brand"
          />
        )}
      </fieldset>

      <Button size="lg" pill className="mt-7 w-full" disabled={!canSubmit || submitting} onClick={onSubmit}>
        {submitting ? <Loader2 className="h-4 w-4 animate-spin" strokeWidth={1.75} /> : <Check className="h-4 w-4" strokeWidth={2} />}
        Count me in
      </Button>
    </motion.section>
  );
}

/**
 * Read-only vote calendar: every voted day shows a heat fill scaled by its
 * vote count (pine once it reaches the threshold) plus the exact count.
 */
function VoteHeatCalendar({
  tally,
  minAvailable,
}: {
  tally: { date: string; count: number }[];
  minAvailable: number;
}) {
  const counts = useMemo(() => new Map(tally.map((t) => [t.date, t.count])), [tally]);
  const maxCount = Math.max(1, ...tally.map((t) => t.count));
  const minYm = ymOf(todayIso());
  const maxYm = ymOf(maxPlanIso());
  const [ym, setYm] = useState<YM>(() => {
    const first = tally[0] ? ymIndex(ymOf(tally[0].date)) : ymIndex(minYm);
    const clamped = Math.min(Math.max(first, ymIndex(minYm)), ymIndex(maxYm));
    return { y: Math.floor(clamped / 12), m: clamped % 12 };
  });
  const weeks = monthWeeks(ym);
  return (
    <MonthFrame ym={ym} minYm={minYm} maxYm={maxYm} onShift={(d) => setYm((v) => shiftYm(v, d))}>
      {weeks.flat().map((cell, i) => {
        if (cell == null) return <span key={`x${i}`} />;
        const count = counts.get(cell.iso) ?? 0;
        const qualifies = count > 0 && count >= minAvailable;
        return (
          <div
            key={cell.iso}
            title={count > 0 ? `${count} ${count === 1 ? 'vote' : 'votes'}` : undefined}
            className={cn(
              'relative flex h-9 flex-col items-center justify-center overflow-hidden rounded-md border text-[12px] font-medium',
              count > 0 ? 'border-border text-ink' : 'border-transparent text-ink-3/50',
              qualifies && 'border-pine ring-1 ring-pine',
            )}
          >
            {count > 0 && (
              <span
                aria-hidden
                className={cn('absolute inset-0', qualifies ? 'bg-pine' : 'bg-brand')}
                style={{ opacity: 0.15 + 0.55 * (count / maxCount) }}
              />
            )}
            <span className="relative leading-none">{cell.day}</span>
            {count > 0 && (
              <span
                className={cn(
                  'relative text-[9px] font-semibold leading-none tnum',
                  qualifies ? 'text-pine' : 'text-ink-3',
                )}
              >
                ×{count}
              </span>
            )}
          </div>
        );
      })}
    </MonthFrame>
  );
}

// ── (b) tally board ─────────────────────────────────────────────────────────
function TallyBoard({ token, data }: { token: string; data: SessionData }) {
  const now = useNow();
  const deadlineMs = new Date(data.session.deadlineAt).getTime() - now;
  const total = data.participants.length;
  const submitted = data.participants.filter((p) => p.submitted).length;
  const maxCount = Math.max(1, ...data.tally.map((t) => t.count));
  const met = data.session.status !== 'voting' && data.winningDate != null;
  const invited = data.participants.filter((p) => p.name === 'Invited friend' && !p.submitted).length;
  const qualifying = data.tally.filter((t) => t.count >= data.session.minAvailable);

  return (
    <motion.section
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35, ease: EASE_EXPO }}
      className="rounded-lg border border-border bg-surface p-6 shadow-sm md:p-8"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="type-h3 text-ink">The vote so far</h2>
        {data.session.status === 'voting' && (
          <span className="type-small inline-flex items-center gap-1.5 rounded-pill bg-ochre-soft px-3 py-1.5 font-semibold text-ochre tnum">
            <Timer className="h-3.5 w-3.5" strokeWidth={1.75} />
            {countdownParts(deadlineMs)}
          </span>
        )}
        {data.session.budgetCents ? (
          <span
            className="type-small inline-flex items-center gap-1.5 rounded-pill bg-brand-soft px-3 py-1.5 font-semibold text-brand tnum"
            title="Pooled group budget set by the organizer; after the trip starts it shows as planned-vs-budget in the workspace"
          >
            Budget {formatMoneyCompact(data.session.budgetCents, data.session.budgetCurrency ?? 'USD')}
          </span>
        ) : null}
      </div>
      <p className="type-small mt-1 text-ink-2 tnum">
        {submitted} of {total} submitted · {data.session.minAvailable} needed on a date to make it happen
      </p>

      {/* threshold progress */}
      <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-surface-2">
        <div
          className="h-full rounded-full bg-pine transition-all duration-[400ms]"
          style={{ width: `${Math.min(100, (maxCount / data.session.minAvailable) * 100)}%` }}
        />
      </div>
      <p className="type-caption mt-1.5 text-ink-3 tnum">
        {maxCount >= data.session.minAvailable
          ? 'Threshold reached!'
          : `${maxCount} of ${data.session.minAvailable} friends aligned on the best date so far`}
      </p>

      {/* participants */}
      <ul className="mt-5 space-y-1.5">
        {data.participants.map((p, i) => (
          <li
            key={i}
            className="flex items-center justify-between gap-3 rounded-md border border-border bg-bg-subtle px-3 py-2"
          >
            <span className="type-small flex min-w-0 items-center gap-2 text-ink">
              <span
                className={cn(
                  'flex h-6 w-6 shrink-0 items-center justify-center rounded-full',
                  p.submitted ? 'bg-pine-soft text-pine' : 'bg-surface-2 text-ink-3',
                )}
              >
                {p.submitted ? <Check className="h-3.5 w-3.5" strokeWidth={2.25} /> : <Timer className="h-3 w-3" strokeWidth={1.75} />}
              </span>
              <span className="truncate">{p.name}</span>
              {p.homeName && <span className="type-caption hidden truncate text-ink-3 min-[480px]:inline">· {p.homeName}</span>}
            </span>
            <span className="type-caption shrink-0 text-ink-3 tnum">
              {p.submitted ? `${p.datesCount} ${p.datesCount === 1 ? 'date' : 'dates'}` : 'waiting'}
            </span>
          </li>
        ))}
      </ul>

      {/* vote heat calendar + every qualifying date */}
      {data.tally.length > 0 && (
        <div className="mt-6">
          <span className="type-small font-medium text-ink">Date votes</span>
          <div className="mt-2 rounded-md border border-border bg-bg-subtle p-3">
            <VoteHeatCalendar tally={data.tally} minAvailable={data.session.minAvailable} />
          </div>
          {qualifying.length > 0 && (
            <ul className="mt-3 space-y-1">
              {qualifying.map((t) => (
                <li key={t.date} className="type-small flex items-center gap-2 text-pine">
                  <Check className="h-3.5 w-3.5 shrink-0" strokeWidth={2.25} />
                  <span className="tnum">
                    {t.count} can make {SHORT_FMT.format(new Date(t.date + 'T00:00:00Z'))}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {/* met banner */}
      {met && data.winningDate && (
        <div className="mt-6 rounded-md border border-pine/30 bg-pine-soft px-4 py-4">
          <p className="type-small flex items-center gap-2 font-semibold text-pine">
            <PartyPopper className="h-4 w-4" strokeWidth={1.75} />
            It’s happening, {LONG_FMT.format(new Date(data.winningDate + 'T00:00:00Z'))}!
          </p>
          <p className="type-caption mt-1 text-ink-2">
            In:{' '}
            {data.participants
              .filter((p) => p.availableOnWinningDate)
              .map((p) => p.name)
              .join(', ') || '-'}
          </p>
        </div>
      )}

      {data.isOwner && data.session.status === 'voting' && <InvitePanel token={token} invited={invited} />}
    </motion.section>
  );
}

/** Owner-only invite-link minting - each link admits exactly one friend. */
function InvitePanel({ token, invited }: { token: string; invited: number }) {
  const createInvite = trpc.friends.createInvite.useMutation();
  const [link, setLink] = useState<string | null>(null);

  const mint = async () => {
    try {
      const res = await createInvite.mutateAsync({ token });
      const url = `${window.location.origin}${res.path}`;
      setLink(url);
      try {
        await navigator.clipboard.writeText(url);
        toast.success('Invite link copied', { description: 'Send it to one friend, each link admits one.' });
      } catch {
        toast.success('Invite link ready', { description: 'Copy it and send it to one friend.' });
      }
    } catch (e) {
      toast.error('Could not create invite', { description: e instanceof Error ? e.message : undefined });
    }
  };

  return (
    <div className="mt-6 rounded-md border border-border bg-bg-subtle px-4 py-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="type-small font-semibold text-ink">Invite friends</p>
          <p className="type-caption text-ink-3 tnum">
            {invited > 0 ? `${invited} open ${invited === 1 ? 'link' : 'links'} waiting` : 'One personal link per friend'}
          </p>
        </div>
        <Button variant="secondary" size="sm" onClick={mint} disabled={createInvite.isPending}>
          {createInvite.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" strokeWidth={1.75} /> : <UserPlus className="h-3.5 w-3.5" strokeWidth={1.75} />}
          New invite link
        </Button>
      </div>
      {link && (
        <CopyLinkField
          url={link}
          label="friend invite link"
          copiedLabel="Invite link copied, it admits one friend"
          className="mt-3"
        />
      )}
    </div>
  );
}

// ── (c) destination suggestions + convert ───────────────────────────────────
function Suggestions({ token, data }: { token: string; data: SessionData }) {
  const navigate = useNavigate();
  const utils = trpc.useUtils();
  const suggestionsQ = trpc.friends.suggestDestinations.useQuery(
    { token },
    { enabled: data.session.status === 'met', retry: false },
  );
  const convert = trpc.friends.convert.useMutation();
  const [days, setDays] = useState<Record<string, number>>({});
  const [busyCity, setBusyCity] = useState<string | null>(null);
  // Trip start: defaults to the earliest qualifying date; the owner can pick
  // any qualifying date via chips or type any date.
  const [startDate, setStartDate] = useState<string | null>(data.winningDate);

  if (data.session.status !== 'met') return null;
  const suggestions = suggestionsQ.data?.suggestions ?? data.suggestions ?? [];

  const startPlanning = async (city: string, country: string) => {
    if (!startDate) return;
    setBusyCity(city);
    try {
      const res = await convert.mutateAsync({
        token,
        city,
        country,
        startDate,
        days: days[city] ?? 4,
      });
      await utils.friends.getSessionByToken.invalidate({ token });
      navigate(`/trips/${res.tripId}`);
    } catch (e) {
      toast.error('Could not start the trip', { description: e instanceof Error ? e.message : undefined });
      setBusyCity(null);
    }
  };

  return (
    <motion.section
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35, ease: EASE_EXPO, delay: 0.08 }}
      className="rounded-lg border border-border bg-surface p-6 shadow-sm md:p-8"
    >
      <h2 className="type-h3 text-ink">Where to?</h2>
      <p className="type-small mt-1 text-ink-2">
        Picked from places near everyone who’s free on the winning date.
      </p>

      {data.isOwner && data.winningDates.length > 0 && (
        <div className="mt-4">
          <span className="type-small font-medium text-ink">Trip start date</span>
          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            {data.winningDates.map((d) => (
              <button
                key={d}
                type="button"
                aria-pressed={startDate === d}
                onClick={() => setStartDate(d)}
                className={cn(
                  'type-small rounded-pill border px-3 py-1.5 transition-colors duration-fast tnum',
                  startDate === d
                    ? 'border-pine bg-pine-soft text-pine'
                    : 'border-border bg-surface text-ink-2 hover:border-border-strong hover:text-ink',
                )}
              >
                {SHORT_FMT.format(new Date(d + 'T00:00:00Z'))}
              </button>
            ))}
            <input
              type="date"
              aria-label="Custom trip start date"
              value={startDate ?? ''}
              min={todayIso()}
              max={maxPlanIso()}
              onChange={(e) => setStartDate(e.target.value || null)}
              className="type-small h-9 rounded-md border border-border-strong bg-surface px-2 text-ink outline-none focus:border-brand"
            />
          </div>
        </div>
      )}

      {suggestionsQ.isLoading ? (
        <div className="mt-5 space-y-3">
          {[0, 1, 2].map((i) => (
            <div key={i} className="h-24 animate-pulse rounded-md bg-surface-2" />
          ))}
        </div>
      ) : suggestions.length === 0 ? (
        <p className="type-body mt-5 text-ink-2">
          No destination clusters found near the group yet, try again once more friends add their home cities.
        </p>
      ) : (
        <ul className="mt-5 grid gap-3 min-[720px]:grid-cols-2">
          {suggestions.map((s) => {
            const avgKm = s.availableCount > 0 ? Math.round(s.sumKm / s.availableCount) : 0;
            const chosenDays = days[s.city] ?? 4;
            return (
              <li key={`${s.city}-${s.country}`} className="rounded-md border border-border bg-bg-subtle p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <h3 className="type-h4 truncate text-ink">{s.city}</h3>
                    <p className="type-caption text-ink-3">{s.country}</p>
                  </div>
                  <span className="type-caption shrink-0 rounded-pill bg-brand-soft px-2 py-1 font-semibold text-brand tnum">
                    {s.placeCount} places
                  </span>
                </div>
                <p className="type-caption mt-2 text-ink-2 tnum">
                  <Users className="mr-1 inline h-3 w-3" strokeWidth={1.75} />
                  {s.availableCount} of {s.totalParticipants} friends in · ~{avgKm} km avg from home
                </p>
                {data.isOwner ? (
                  <div className="mt-3 flex items-center gap-2">
                    <select
                      aria-label="Trip length in days"
                      value={chosenDays}
                      onChange={(e) => setDays((prev) => ({ ...prev, [s.city]: Number(e.target.value) }))}
                      className="type-small h-9 rounded-md border border-border-strong bg-surface px-2 text-ink outline-none focus:border-brand"
                    >
                      {[2, 3, 4, 5, 6, 7].map((d) => (
                        <option key={d} value={d}>
                          {d} days
                        </option>
                      ))}
                    </select>
                    <Button
                      size="sm"
                      className="flex-1"
                      disabled={busyCity != null || startDate == null}
                      onClick={() => startPlanning(s.city, s.country)}
                    >
                      {busyCity === s.city ? <Loader2 className="h-3.5 w-3.5 animate-spin" strokeWidth={1.75} /> : <CalendarCheck2 className="h-3.5 w-3.5" strokeWidth={1.75} />}
                      Start planning
                    </Button>
                  </div>
                ) : (
                  <p className="type-caption mt-3 text-ink-3">
                    Waiting for {data.ownerName} to pick a destination…
                  </p>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </motion.section>
  );
}

/** Converted state - the trip exists, everyone continues in the workspace. */
function ConvertedBanner({ data }: { data: SessionData }) {
  return (
    <motion.section
      initial={{ opacity: 0, scale: 0.98 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ duration: 0.35, ease: EASE_EXPO }}
      className="flex flex-col items-center rounded-lg border border-pine/30 bg-pine-soft px-6 py-10 text-center"
    >
      <span className="flex h-12 w-12 items-center justify-center rounded-full bg-surface text-pine shadow-sm">
        <PartyPopper className="h-5 w-5" strokeWidth={1.75} />
      </span>
      <h2 className="type-h3 mt-4 text-ink">The trip is on!</h2>
      <p className="type-body mt-1 max-w-[46ch] text-ink-2">
        {data.ownerName} turned this plan into a shared trip. Open the workspace to plan the days together.
      </p>
      {data.session.tripId && (
        <Button size="lg" pill className="mt-5" asChild>
          <Link to={`/trips/${data.session.tripId}`}>Open the trip</Link>
        </Button>
      )}
    </motion.section>
  );
}

// ── page ────────────────────────────────────────────────────────────────────
export default function Friends() {
  const { token = '' } = useParams();
  const q = useSessionData(token);

  return (
    <div className="relative min-h-[100dvh] bg-bg text-ink">
      <header className="mx-auto flex h-16 w-full max-w-[760px] items-center justify-between px-4 md:px-6">
        <Link to="/" aria-label="Wayfare home">
          <Logo />
        </Link>
        <span className="type-caption inline-flex items-center gap-1.5 rounded-pill bg-ochre-soft px-2.5 py-1 font-semibold text-ochre">
          <Crown className="h-3 w-3" strokeWidth={1.75} />
          Friends planning
        </span>
      </header>

      <main className="mx-auto w-full max-w-[760px] px-4 pb-20 md:px-6">
        {q.isLoading ? (
          <div className="space-y-4" aria-label="Loading session">
            <div className="h-9 w-2/3 animate-pulse rounded-md bg-surface-2" />
            <div className="h-[320px] animate-pulse rounded-lg bg-surface-2" />
          </div>
        ) : q.isError || !q.data ? (
          <div className="flex flex-col items-center rounded-lg border border-border bg-surface px-6 py-16 text-center">
            <h1 className="type-h2 text-ink">This invite link doesn’t work</h1>
            <p className="type-body mt-2 max-w-[44ch] text-ink-2">
              It may have been mistyped or the session was closed. Ask the organizer for a fresh link.
            </p>
            <Button variant="ghost" className="mt-6" asChild>
              <Link to="/">Back to Wayfare</Link>
            </Button>
          </div>
        ) : (
          <div className="space-y-6">
            <div>
              <h1 className="type-h2 text-ink">{q.data.session.title}</h1>
              <p className="type-small mt-1 text-ink-2">
                {q.data.ownerName} invited you to plan a trip together, vote your dates, share your vibe.
              </p>
            </div>

            {q.data.claimedByOther ? (
              <div className="rounded-lg border border-ochre/30 bg-ochre-soft px-6 py-8 text-center">
                <h2 className="type-h3 text-ink">This invite link is already claimed</h2>
                <p className="type-body mt-2 max-w-[46ch] text-ink-2">
                  It belongs to {q.data.me.name}. Sign in with that account, or ask {q.data.ownerName}
                  to mint a fresh invite link just for you from the session page.
                </p>
              </div>
            ) : q.data.session.status === 'converted' ? (
              <>
                <ConvertedBanner data={q.data} />
                <FriendChatPanel token={token} canChat />
              </>
            ) : (
              <>
                {q.data.me.submittedAt == null && q.data.session.status === 'voting' && (
                  <PlanForm key={q.data.me.id} token={token} data={q.data} />
                )}
                <TallyBoard token={token} data={q.data} />
                <Suggestions token={token} data={q.data} />
                <FriendChatPanel token={token} canChat={q.data.me.submittedAt != null} />
              </>
            )}
          </div>
        )}
      </main>
      <Toaster position="bottom-center" />
    </div>
  );
}
