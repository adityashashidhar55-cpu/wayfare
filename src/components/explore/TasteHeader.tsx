/**
 * Explore personalization header (explore.md §S1): eyebrow + archetype
 * headline, retunable taste chips (toggling one re-queries the feed), a
 * "Retune" ghost chip, and an expanding search with grouped glass results.
 */
import { useMemo, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { Coffee, Gem, MapPin, Pencil, PiggyBank, Search } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { ExploreCity, ExplorePlaceItem } from '@/components/explore/explore-utils';
import { styleMeta } from '@/components/explore/explore-utils';

const EASE_EXPO = [0.22, 1, 0.36, 1] as [number, number, number, number];

const container = {
  hidden: {},
  show: { transition: { staggerChildren: 0.06 } },
};
const item = {
  hidden: { opacity: 0, y: 12 },
  show: { opacity: 1, y: 0, transition: { duration: 0.32, ease: EASE_EXPO } },
};

/** generic chips for visitors who haven't taken the quiz yet */
const GENERIC_CHIPS = [
  { icon: styleMeta('food').icon, label: 'Food & drink' },
  { icon: styleMeta('historical').icon, label: 'Historical' },
  { icon: Coffee, label: 'Coffee' },
  { icon: Gem, label: 'Hidden gems' },
];

interface TasteHeaderProps {
  archetype: string | null;
  styles: string[];
  interests: string[];
  onboardingDone: boolean;
  activeStyle: string | null;
  onToggleStyle: (style: string) => void;
  onRetune: () => void;
  query: string;
  onQuery: (q: string) => void;
  cities: ExploreCity[];
  places: ExplorePlaceItem[];
  onPickCity: (city: string) => void;
  onPickPlace: (place: ExplorePlaceItem) => void;
}

export default function TasteHeader({
  archetype,
  styles,
  interests,
  onboardingDone,
  activeStyle,
  onToggleStyle,
  onRetune,
  query,
  onQuery,
  cities,
  places,
  onPickCity,
  onPickPlace,
}: TasteHeaderProps) {
  const [focused, setFocused] = useState(false);
  const blurTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const q = query.trim().toLowerCase();
  const cityResults = useMemo(
    () =>
      q
        ? cities.filter((c) => `${c.city} ${c.country}`.toLowerCase().includes(q)).slice(0, 4)
        : [],
    [q, cities],
  );
  const placeResults = useMemo(
    () =>
      q
        ? places
            .filter((p) =>
              `${p.name} ${p.city} ${(p.tags ?? []).join(' ')}`.toLowerCase().includes(q),
            )
            .slice(0, 5)
        : [],
    [q, places],
  );
  const showResults = focused && q.length > 0;

  const interestLabels = interests
    .slice(0, 2)
    .map((i) => i.split('-').map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' '));

  return (
    <motion.header
      variants={container}
      initial="hidden"
      animate="show"
      className="flex flex-wrap items-end justify-between gap-x-8 gap-y-6"
    >
      <div className="min-w-0 max-w-[660px]">
        <motion.p variants={item} className="type-eyebrow text-brand">
          Explore
        </motion.p>
        <motion.h1 variants={item} className="type-h1 mt-2 text-ink">
          {archetype ? (
            <>
              Made for a <span className="serif-em text-brand">{archetype}</span>.
            </>
          ) : (
            <>
              Made for the way <span className="serif-em text-brand">you</span> travel.
            </>
          )}
        </motion.h1>

        {/* taste chip row (the profile), retunable */}
        <motion.div variants={item} className="mt-4 flex flex-wrap items-center gap-2">
          {onboardingDone ? (
            <>
              {/* taste honesty: a budget style is a hard constraint, say so first */}
              {styles.includes('budget') && (
                <motion.span
                  initial={{ scale: 0.6, opacity: 0 }}
                  animate={{ scale: 1, opacity: 1 }}
                  transition={{ delay: 0.2, type: 'spring', stiffness: 500, damping: 28 }}
                  title="Places above your budget always sort last"
                  className="type-small inline-flex h-8 items-center gap-1.5 rounded-pill bg-pine-soft px-3 font-medium text-pine"
                >
                  <PiggyBank className="h-3.5 w-3.5" strokeWidth={1.75} />
                  Budget-first
                </motion.span>
              )}
              {styles.slice(0, 4).map((s, i) => {
                const meta = styleMeta(s);
                const Icon = meta.icon;
                const active = activeStyle === s;
                return (
                  <motion.button
                    key={s}
                    type="button"
                    onClick={() => onToggleStyle(s)}
                    aria-pressed={active}
                    initial={{ scale: 0.6, opacity: 0 }}
                    animate={{ scale: 1, opacity: 1 }}
                    transition={{ delay: 0.24 + i * 0.04, type: 'spring', stiffness: 500, damping: 28 }}
                    className={cn(
                      'type-small inline-flex h-8 items-center gap-1.5 rounded-pill px-3 font-medium transition-colors duration-fast',
                      active
                        ? 'bg-brand text-brand-ink'
                        : 'bg-brand-soft text-brand hover:brightness-95',
                    )}
                  >
                    <Icon className="h-3.5 w-3.5" strokeWidth={1.75} />
                    {meta.label}
                  </motion.button>
                );
              })}
              {interestLabels.map((label, i) => (
                <motion.span
                  key={label}
                  initial={{ scale: 0.6, opacity: 0 }}
                  animate={{ scale: 1, opacity: 1 }}
                  transition={{
                    delay: 0.24 + (styles.length + i) * 0.04,
                    type: 'spring',
                    stiffness: 500,
                    damping: 28,
                  }}
                  className="type-small inline-flex h-8 items-center rounded-pill bg-surface-2 px-3 font-medium text-ink-2"
                >
                  {label}
                </motion.span>
              ))}
            </>
          ) : (
            GENERIC_CHIPS.map((chip, i) => (
              <motion.span
                key={chip.label}
                initial={{ scale: 0.6, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                transition={{ delay: 0.24 + i * 0.04, type: 'spring', stiffness: 500, damping: 28 }}
                className="type-small inline-flex h-8 items-center gap-1.5 rounded-pill bg-brand-soft px-3 font-medium text-brand"
              >
                <chip.icon className="h-3.5 w-3.5" strokeWidth={1.75} />
                {chip.label}
              </motion.span>
            ))
          )}
          <button
            type="button"
            onClick={onRetune}
            className="type-small inline-flex h-8 items-center gap-1.5 rounded-pill border border-border-strong px-3 text-ink-2 transition-colors duration-fast hover:border-brand/50 hover:text-ink"
          >
            <Pencil className="h-3.5 w-3.5" strokeWidth={1.75} />
            Retune
          </button>
        </motion.div>
      </div>

      {/* search, expands 320 → 420px on focus (300ms), grouped glass results */}
      <motion.div variants={item} className="w-full sm:w-auto">
        <div
          className={cn(
            'relative w-full transition-[width] duration-300 ease-expo sm:w-[320px]',
            focused && 'sm:w-[420px]',
          )}
        >
          <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-3" strokeWidth={1.75} />
          <input
            type="search"
            value={query}
            onChange={(e) => onQuery(e.target.value)}
            onFocus={() => {
              if (blurTimer.current) clearTimeout(blurTimer.current);
              setFocused(true);
            }}
            onBlur={() => {
              blurTimer.current = setTimeout(() => setFocused(false), 140);
            }}
            placeholder="Search places, cities, vibes…"
            aria-label="Search places, cities, vibes"
            className="type-small h-11 w-full rounded-md border border-border-strong bg-surface pl-10 pr-4 text-ink shadow-sm outline-none transition-colors duration-fast placeholder:text-ink-3 focus:border-brand focus:ring-2 focus:ring-brand/40"
          />

          {showResults && (
            <div className="glass-strong absolute right-0 top-full z-40 mt-2 w-full overflow-hidden rounded-lg border border-border shadow-lg">
              {cityResults.length === 0 && placeResults.length === 0 ? (
                <p className="type-small px-4 py-5 text-center text-ink-3">
                  Nothing found for &ldquo;{query}&rdquo;
                </p>
              ) : (
                <div className="max-h-[320px] overflow-y-auto p-2">
                  {cityResults.length > 0 && (
                    <>
                      <p className="type-caption px-2 pb-1 pt-1.5 text-ink-3">CITIES</p>
                      <ul>
                        {cityResults.map((c) => (
                          <li key={c.city}>
                            <button
                              type="button"
                              onMouseDown={(e) => e.preventDefault()}
                              onClick={() => onPickCity(c.city)}
                              className="flex w-full items-center gap-2.5 rounded-md px-2 py-2 text-left transition-colors duration-fast hover:bg-surface-2"
                            >
                              <MapPin className="h-4 w-4 shrink-0 text-brand" strokeWidth={1.75} />
                              <span className="type-small min-w-0 flex-1 truncate font-semibold text-ink">
                                {c.city}
                                <span className="font-normal text-ink-3"> · {c.country}</span>
                              </span>
                            </button>
                          </li>
                        ))}
                      </ul>
                    </>
                  )}
                  {placeResults.length > 0 && (
                    <>
                      <p className="type-caption px-2 pb-1 pt-1.5 text-ink-3">PLACES</p>
                      <ul>
                        {placeResults.map((p) => (
                          <li key={p.id}>
                            <button
                              type="button"
                              onMouseDown={(e) => e.preventDefault()}
                              onClick={() => onPickPlace(p)}
                              className="flex w-full items-center gap-2.5 rounded-md px-2 py-2 text-left transition-colors duration-fast hover:bg-surface-2"
                            >
                              {p.image ? (
                                <img src={p.image} alt="" className="photo h-8 w-8 shrink-0 rounded-sm object-cover" />
                              ) : (
                                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-sm bg-surface-2">
                                  <MapPin className="h-4 w-4 text-ink-3" strokeWidth={1.75} />
                                </span>
                              )}
                              <span className="min-w-0 flex-1">
                                <span className="type-small block truncate font-semibold text-ink">{p.name}</span>
                                <span className="type-caption block truncate text-ink-3">{p.city}</span>
                              </span>
                            </button>
                          </li>
                        ))}
                      </ul>
                    </>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      </motion.div>
    </motion.header>
  );
}
