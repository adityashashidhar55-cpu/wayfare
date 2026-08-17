import { useMemo } from 'react';
import { motion } from 'framer-motion';
import { useInView } from '@/hooks/useInView';
import { SPRING_PIN_POP } from '@/lib/motion';
import { CountUp } from '@/components/profile/CountUp';
import { anchorFor, extractCountries, parseDay } from '@/components/trips/utils';
import type { CityRef, ListedTrip } from '@/components/trips/utils';

function elapsedDays(t: ListedTrip): number {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const start = parseDay(t.startDate);
  if (start > today) return 0;
  const end = parseDay(t.endDate);
  const last = end < today ? end : today;
  return Math.round((last.getTime() - start.getTime()) / 86_400_000) + 1;
}

/**
 * Travel stats band (profile §S2): four count-up stat blocks on a
 * hairline-separated card, then the dotted world map where visited
 * countries' dots pop in brand as the card scrolls into view.
 */
export function TravelStats({ trips, directory }: { trips: ListedTrip[]; directory: CityRef[] }) {
  const { ref: mapRef, inView: mapInView } = useInView<HTMLDivElement>(0.35, true);

  const stats = useMemo(() => {
    const countries = extractCountries(
      trips.map((t) => t.destination),
      directory,
    );
    const days = trips.reduce((sum, t) => sum + elapsedDays(t), 0);
    const upcoming = trips.filter((t) => t.status === 'upcoming').length;
    // Trips per country (for map tooltips)
    const perCountry = new Map<string, number>();
    for (const t of trips) {
      for (const c of extractCountries([t.destination], directory)) {
        perCountry.set(c, (perCountry.get(c) ?? 0) + 1);
      }
    }
    return { trips: trips.length, countries, days, upcoming, perCountry };
  }, [trips, directory]);

  const blocks = [
    { label: 'Trips', value: stats.trips },
    { label: 'Countries', value: stats.countries.length },
    { label: 'Days on the road', value: stats.days },
    { label: 'Upcoming', value: stats.upcoming },
  ];

  const pct = Math.round((stats.countries.length / 195) * 100);

  return (
    <section aria-label="Travel stats" className="space-y-6">
      {/* Stat blocks, hairline-separated via 1px gaps */}
      <div className="grid grid-cols-2 gap-px overflow-hidden rounded-xl border border-border bg-border shadow-sm md:grid-cols-4">
        {blocks.map((b, i) => (
          <div key={b.label} className="bg-surface p-6">
            <CountUp
              value={b.value}
              delay={0.1 * i}
              className="type-numeral tnum block text-[28px] leading-[34px] text-ink"
            />
            <span className="type-caption mt-1 block text-ink-3">{b.label}</span>
          </div>
        ))}
      </div>

      {/* Dotted world map */}
      <div className="rounded-xl border border-border bg-surface p-6 shadow-sm md:p-8" ref={mapRef}>
        <div className="mb-5 flex flex-wrap items-baseline justify-between gap-2">
          <h3 className="type-h4 text-ink">Where you’ve wandered</h3>
          <span className="type-caption text-ink-3 tnum">
            {stats.countries.length} of 195 countries, {pct}%
          </span>
        </div>
        <div className="relative aspect-[2/1] w-full overflow-hidden rounded-md bg-surface-2/40">
          <img
            src="/world-dots.svg"
            alt="Dotted world map"
            className="absolute inset-0 h-full w-full object-fill dark:opacity-70 dark:invert-[0.72]"
          />
          {stats.countries.map((country, i) => {
            const anchor = anchorFor(country);
            if (!anchor) return null;
            const n = stats.perCountry.get(country) ?? 1;
            return (
              <motion.span
                key={country}
                initial={{ scale: 0, opacity: 0 }}
                animate={mapInView ? { scale: 1, opacity: 1 } : undefined}
                transition={{ ...SPRING_PIN_POP, delay: 0.02 * i }}
                className="group absolute z-[2]"
                style={{ left: `${anchor[0]}%`, top: `${anchor[1]}%` }}
              >
                <span className="block h-3 w-3 -translate-x-1/2 -translate-y-1/2 cursor-pointer rounded-full bg-brand ring-2 ring-surface shadow-sm transition-transform duration-fast group-hover:scale-125" />
                <span className="type-caption pointer-events-none absolute bottom-full left-1/2 mb-1.5 -translate-x-1/2 whitespace-nowrap rounded-md border border-border bg-surface/90 px-2 py-1 text-ink opacity-0 shadow-md backdrop-blur-md transition-opacity duration-fast group-hover:opacity-100">
                  {country} · {n} {n === 1 ? 'trip' : 'trips'}
                </span>
              </motion.span>
            );
          })}
        </div>
        {stats.countries.length > 0 && (
          <div className="mt-4 flex flex-wrap gap-1.5">
            {stats.countries.map((c) => (
              <span key={c} className="type-caption rounded-pill bg-brand-soft px-2.5 py-1 font-semibold text-brand">
                {c}
              </span>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
