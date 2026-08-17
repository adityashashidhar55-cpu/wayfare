import { Link, useParams } from 'react-router';
import { motion } from 'framer-motion';
import {
  ArrowRight,
  BedDouble,
  CircleDot,
  Clock,
  Compass,
  Link2Off,
  Loader2,
  MapPin,
  ShoppingBag,
  Ticket,
  TrainFront,
  Utensils,
  Wallet,
  type LucideIcon,
} from 'lucide-react';
import Logo from '@/components/Logo';
import { trpc } from '@/providers/trpc';
import { formatDateRange, formatSingleDay, DEFAULT_COVER } from '@/components/trips/utils';
import { categoryMeta, formatDuration } from '@/components/workspace/utils';
import { formatMoney } from '@contracts/fx';
import { poolImageFor } from '@/lib/place-images';
import { format } from 'date-fns';

type SharedStop = {
  id: number;
  dayId: number | null;
  name: string;
  category: string;
  startTime: string | null;
  durationMin: number | null;
  notes: string | null;
  image: string | null;
  position: number;
};

type SharedFinances = {
  budgetCents: number;
  homeCurrency: string;
  totalSpentCents: number;
  expenses: { label: string; category: string; amountCents: number; date: string; paidByName: string }[];
  byCategory: { category: string; amountCents: number }[];
  perPerson: { name: string; paidCents: number; shareCents: number; netCents: number }[];
};

type SharedDestinationInfo = {
  city: string | null;
  country: string | null;
  lat: number | null;
  lng: number | null;
} | null;

/**
 * Cover for a shared trip: the trip's own cover first; otherwise a
 * destination-aware pool pick (right world region - a Bengaluru weekend gets
 * a South-Asian frame, never the global Kyoto hero). Falls back to the
 * default cover only when the destination can't be placed at all.
 */
function coverFor(
  coverImage: string | null,
  destination: string,
  info: SharedDestinationInfo,
): string {
  if (coverImage) return coverImage;
  const pooled = poolImageFor({
    category: 'cityscape',
    name: destination,
    city: info?.city ?? destination.split(',')[0]?.trim() ?? destination,
    country: info?.country ?? destination,
    lat: info?.lat ?? null,
    lng: info?.lng ?? null,
  });
  return pooled ?? DEFAULT_COVER;
}

/** Transfer stops carry machine JSON in notes ({transfer:{...}}) - render a
 *  human summary instead of the raw payload. */
function displayNotes(notes: string | null): string | null {
  if (!notes) return null;
  if (!notes.trimStart().startsWith("{")) return notes;
  try {
    const t = JSON.parse(notes)?.transfer;
    if (!t) return null;
    const opt = Array.isArray(t.options) ? t.options[0] : null;
    return [opt?.label, opt?.durationMin ? formatDuration(opt.durationMin) : null, t.km ? `${t.km} km` : null]
      .filter(Boolean)
      .join(" · ") || null;
  } catch {
    return null;
  }
}

function StopRow({ stop }: { stop: SharedStop }) {
  const meta = categoryMeta(stop.category);
  const Icon = meta.icon;
  const duration = formatDuration(stop.durationMin);
  const notes = displayNotes(stop.notes);
  return (
    <li className="flex gap-3.5 rounded-lg border border-border bg-surface p-3.5 shadow-sm transition-shadow duration-fast hover:shadow-md">
      <span
        className="mt-0.5 inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-md"
        style={{ backgroundColor: `${meta.color}1f`, color: meta.color }}
      >
        <Icon className="h-[18px] w-[18px]" strokeWidth={1.75} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex flex-wrap items-baseline gap-x-2.5">
          {stop.startTime && (
            <span className="type-caption font-semibold tabular-nums text-ink-3">{stop.startTime}</span>
          )}
          <span className="type-small font-semibold text-ink">{stop.name}</span>
          <span className="type-caption rounded-pill bg-surface-2 px-2 py-0.5 text-ink-3">{meta.label}</span>
        </span>
        {(duration || notes) && (
          <span className="type-caption mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-ink-3">
            {duration && (
              <span className="inline-flex items-center gap-1">
                <Clock className="h-3 w-3" strokeWidth={1.75} />
                {duration}
              </span>
            )}
            {notes && <span className="line-clamp-2 text-ink-2">{notes}</span>}
          </span>
        )}
      </span>
    </li>
  );
}

const EXPENSE_DATE_FMT = 'EEE, MMM d';

/** Expense category meta - mirrors @/components/expenses/utils CATEGORY_META
 *  (duplicated here so this public page doesn't pull the MapLibre CSS that
 *  module transitively imports via @/lib/map). */
const EXPENSE_META: Record<string, { label: string; icon: LucideIcon; color: string }> = {
  food: { label: 'Food', icon: Utensils, color: '#C97F45' },
  lodging: { label: 'Lodging', icon: BedDouble, color: '#7C8DA6' },
  transport: { label: 'Transport', icon: TrainFront, color: '#6E9A8B' },
  activities: { label: 'Activities', icon: Ticket, color: '#A86B8C' },
  shopping: { label: 'Shopping', icon: ShoppingBag, color: '#C9A63C' },
  other: { label: 'Other', icon: CircleDot, color: '#8A8175' },
};
function expenseCategoryMeta(category: string) {
  return EXPENSE_META[category] ?? EXPENSE_META.other!;
}

/** Read-only "Trip finances" block: budget-vs-spent bar, category breakdown,
 *  per-person split summary. Hidden entirely when there is nothing to show. */
function FinancesSection({ finances }: { finances: SharedFinances }) {
  const { budgetCents, homeCurrency, totalSpentCents, expenses, byCategory, perPerson } = finances;
  const hasBudget = budgetCents > 0;
  const hasExpenses = expenses.length > 0;
  if (!hasBudget && !hasExpenses) return null;

  const pct = hasBudget ? Math.min(100, Math.round((totalSpentCents / budgetCents) * 100)) : 0;
  const over = hasBudget && totalSpentCents > budgetCents;
  const catMax = Math.max(1, ...byCategory.map((c) => c.amountCents));

  return (
    <motion.section
      initial={{ opacity: 0, y: 16 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: '-40px' }}
      transition={{ duration: 0.45, ease: [0.22, 1, 0.36, 1] }}
      className="mt-14"
      aria-label="Trip finances"
    >
      <div className="flex items-baseline gap-3">
        <h2 className="type-h3 font-serif text-ink">Trip finances</h2>
        <p className="type-small text-ink-3">Shared read-only · in {homeCurrency}</p>
      </div>

      <div className="mt-4 rounded-xl border border-border bg-surface p-5 shadow-sm md:p-6">
        {/* budget vs spent */}
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <p className="type-small font-semibold text-ink">
            <Wallet className="mr-1.5 inline h-4 w-4 align-[-2px] text-brand" strokeWidth={1.75} />
            {hasExpenses ? `${formatMoney(totalSpentCents, homeCurrency)} spent` : 'Nothing spent yet'}
            {hasBudget && <span className="font-normal text-ink-3"> of {formatMoney(budgetCents, homeCurrency)} budget</span>}
          </p>
          {hasBudget && (
            <p className={`type-caption tnum ${over ? 'font-semibold text-danger' : 'text-ink-3'}`}>
              {over
                ? `${formatMoney(totalSpentCents - budgetCents, homeCurrency)} over budget`
                : `${formatMoney(budgetCents - totalSpentCents, homeCurrency)} left`}
            </p>
          )}
        </div>
        {hasBudget && (
          <div className="mt-2.5 h-2 overflow-hidden rounded-full bg-surface-2" role="img" aria-label={`${pct}% of budget spent`}>
            <div
              className={`h-full rounded-full ${over ? 'bg-danger' : 'bg-brand'}`}
              style={{ width: `${pct}%` }}
            />
          </div>
        )}

        {hasExpenses && (
          <div className="mt-6 grid gap-6 md:grid-cols-2">
            {/* category breakdown */}
            <div>
              <p className="type-caption font-semibold uppercase tracking-[0.08em] text-ink-3">By category</p>
              <ul className="mt-3 space-y-2">
                {byCategory.map((c) => {
                  const meta = expenseCategoryMeta(c.category);
                  const Icon = meta.icon;
                  return (
                    <li key={c.category} className="flex items-center gap-2.5">
                      <span
                        className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md"
                        style={{ backgroundColor: `${meta.color}1f`, color: meta.color }}
                      >
                        <Icon className="h-3.5 w-3.5" strokeWidth={1.75} />
                      </span>
                      <span className="type-small w-20 shrink-0 text-ink-2">{meta.label}</span>
                      <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-surface-2">
                        <span
                          className="block h-full rounded-full"
                          style={{ width: `${(c.amountCents / catMax) * 100}%`, backgroundColor: meta.color }}
                        />
                      </span>
                      <span className="type-caption w-20 shrink-0 text-right text-ink tnum">
                        {formatMoney(c.amountCents, homeCurrency)}
                      </span>
                    </li>
                  );
                })}
              </ul>
            </div>

            {/* per-person shares */}
            {perPerson.length > 0 && (
              <div>
                <p className="type-caption font-semibold uppercase tracking-[0.08em] text-ink-3">Per person</p>
                <ul className="mt-3 space-y-1.5">
                  {perPerson.map((p) => (
                    <li
                      key={p.name}
                      className="flex items-center justify-between gap-3 rounded-md border border-border bg-bg-subtle px-3 py-2"
                    >
                      <span className="type-small min-w-0 truncate text-ink">{p.name}</span>
                      <span className="type-caption shrink-0 text-ink-3 tnum">
                        paid {formatMoney(p.paidCents, homeCurrency)} · share {formatMoney(p.shareCents, homeCurrency)}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}

        {/* recent expenses */}
        {hasExpenses && (
          <div className="mt-6 border-t border-border pt-4">
            <p className="type-caption font-semibold uppercase tracking-[0.08em] text-ink-3">Expenses</p>
            <ul className="mt-3 space-y-1.5">
              {expenses.slice(0, 12).map((e, i) => (
                <li key={`${e.date}-${e.label}-${i}`} className="flex items-baseline justify-between gap-3">
                  <span className="type-small min-w-0 truncate text-ink">
                    {e.label}
                    <span className="type-caption text-ink-3">
                      {' '}· {e.paidByName} · {format(new Date(e.date + 'T00:00:00'), EXPENSE_DATE_FMT)}
                    </span>
                  </span>
                  <span className="type-small shrink-0 text-ink tnum">{formatMoney(e.amountCents, homeCurrency)}</span>
                </li>
              ))}
            </ul>
            {expenses.length > 12 && (
              <p className="type-caption mt-2 text-ink-3 tnum">+ {expenses.length - 12} more</p>
            )}
          </div>
        )}
      </div>
    </motion.section>
  );
}

/**
 * Public, read-only itinerary behind a share link (/shared/:token). No auth
 * required - the payload is redacted server-side (no emails, no user ids).
 */
export default function SharedTrip() {
  const { token } = useParams<{ token: string }>();
  const query = trpc.share.getSharedTrip.useQuery(
    { token: token ?? '' },
    { enabled: Boolean(token), retry: false },
  );

  const cta = (
    <Link
      to="/login"
      className="btn-sheen type-small inline-flex h-11 items-center justify-center gap-2 rounded-pill bg-brand px-6 font-semibold text-brand-ink shadow-sm transition-all duration-fast hover:-translate-y-px hover:bg-brand-strong hover:shadow-md active:scale-[0.98]"
    >
      Make your own trip
      <ArrowRight className="h-4 w-4" strokeWidth={2} />
    </Link>
  );

  return (
    <div className="min-h-[100dvh] bg-bg text-ink">
      {/* Slim public header */}
      <header className="glass-strong sticky top-0 z-40 border-b border-border">
        <div className="mx-auto flex h-16 max-w-[860px] items-center justify-between px-4 md:px-6">
          <Link to="/" aria-label="Wayfare home">
            <Logo />
          </Link>
          {cta}
        </div>
      </header>

      {query.isLoading && (
        <div className="flex flex-col items-center gap-3 py-32 text-ink-3">
          <Loader2 className="h-6 w-6 animate-spin" strokeWidth={1.75} />
          <p className="type-small">Loading this itinerary…</p>
        </div>
      )}

      {query.isError && (
        <div className="mx-auto flex max-w-[520px] flex-col items-center px-6 py-32 text-center">
          <span className="inline-flex h-14 w-14 items-center justify-center rounded-full bg-ochre-soft text-ochre">
            <Link2Off className="h-6 w-6" strokeWidth={1.75} />
          </span>
          <h1 className="type-h2 mt-6 font-serif text-ink">This link has wandered off</h1>
          <p className="type-body mt-3 text-ink-2">
            {query.error.message || 'This share link is invalid or has been turned off.'}
          </p>
          <p className="type-small mt-8">{cta}</p>
        </div>
      )}

      {query.data && (
        <main className="mx-auto max-w-[860px] px-4 pb-24 md:px-6">
          {/* Hero */}
          <motion.section
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
            className="relative mt-6 aspect-[16/7] overflow-hidden rounded-xl shadow-md"
          >
            <img
              onError={e => { e.currentTarget.style.display = 'none'; }}
              src={coverFor(query.data.trip.coverImage, query.data.trip.destination, query.data.destinationInfo)}
              alt=""
              className="photo absolute inset-0 h-full w-full object-cover"
            />
            <div className="absolute inset-0 bg-gradient-to-t from-[rgba(22,19,15,0.72)] via-[rgba(22,19,15,0.18)] to-transparent" />
            <div className="absolute bottom-5 left-5 right-5 md:bottom-7 md:left-7">
              <p className="type-eyebrow text-[#FAF7F1]/80">Shared itinerary</p>
              <h1 className="mt-2 font-serif text-[30px] leading-[1.1] tracking-[-0.02em] text-[#FAF7F1] md:text-[40px]">
                {query.data.trip.title}
              </h1>
              <p className="type-small mt-2 flex flex-wrap items-center gap-x-2 text-[#FAF7F1]/85">
                <span>{formatDateRange(query.data.trip.startDate, query.data.trip.endDate, { withYear: true })}</span>
                <span aria-hidden>·</span>
                <span className="inline-flex items-center gap-1">
                  <MapPin className="h-3.5 w-3.5" strokeWidth={1.75} />
                  {query.data.trip.destination}
                </span>
              </p>
            </div>
          </motion.section>

          {/* Days */}
          <div className="mt-10 space-y-10">
            {query.data.days.map((day, i) => {
              const stops = query.data.stops.filter((s) => s.dayId === day.id);
              return (
                <motion.section
                  key={day.id}
                  initial={{ opacity: 0, y: 16 }}
                  whileInView={{ opacity: 1, y: 0 }}
                  viewport={{ once: true, margin: '-40px' }}
                  transition={{ duration: 0.45, ease: [0.22, 1, 0.36, 1] }}
                >
                  <div className="flex items-baseline gap-3">
                    <h2 className="type-h3 font-serif text-ink">Day {i + 1}</h2>
                    <p className="type-small text-ink-3">{formatSingleDay(day.date, { withYear: true })}</p>
                  </div>
                  {stops.length ? (
                    <ul className="mt-4 space-y-2.5">
                      {stops.map((s) => (
                        <StopRow key={s.id} stop={s} />
                      ))}
                    </ul>
                  ) : (
                    <p className="type-small mt-4 rounded-lg border border-dashed border-border-strong px-4 py-6 text-center text-ink-3">
                      Nothing planned yet, this day is still open.
                    </p>
                  )}
                </motion.section>
              );
            })}

            {/* Unscheduled stops */}
            {query.data.stops.some((s) => s.dayId == null) && (
              <section>
                <div className="flex items-baseline gap-3">
                  <h2 className="type-h3 font-serif text-ink">Saved for later</h2>
                  <p className="type-small text-ink-3">Not scheduled yet</p>
                </div>
                <ul className="mt-4 space-y-2.5">
                  {query.data.stops
                    .filter((s) => s.dayId == null)
                    .map((s) => (
                      <StopRow key={s.id} stop={s} />
                    ))}
                </ul>
              </section>
            )}
          </div>

          {/* Trip finances (read-only, redacted server-side) */}
          <FinancesSection finances={query.data.finances} />

          {/* CTA band */}
          <section className="mt-16 flex flex-col items-center rounded-xl border border-border bg-surface px-6 py-12 text-center shadow-sm">
            <span className="inline-flex h-12 w-12 items-center justify-center rounded-full bg-pine-soft text-pine">
              <Compass className="h-6 w-6" strokeWidth={1.75} />
            </span>
            <h2 className="type-h2 mt-5 font-serif text-ink">Plan a trip like this</h2>
            <p className="type-body mt-2 max-w-[420px] text-ink-2">
              Build day-by-day itineraries, invite tripmates, and split expenses, free with Wayfare.
            </p>
            <p className="mt-6">{cta}</p>
          </section>
        </main>
      )}
    </div>
  );
}
