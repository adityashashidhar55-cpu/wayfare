/**
 * "Browse the world" - the world city directory (missions J/K) on Explore.
 *
 * Region accordion → country → city chips. Every country is listed and every
 * city name is always visible, even with zero corpus places. Mapped cities
 * (≥ 12 places within 25 km) link straight into the city builder
 * (/city/:name); unmapped cities show a "Coming soon - map it now" state that
 * calls citybuild.cityProfile - which imports the city from OpenStreetMap on
 * demand (24 h server cache) - and then opens the builder.
 */
import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { ChevronDown, Globe2, Loader2, MapPin, Sparkles } from 'lucide-react';
import { trpc } from '@/providers/trpc';
import { cn } from '@/lib/utils';
import { Skeleton } from '@/components/ui/skeleton';
import { toast } from '@/components/explore/toast';

const REGION_ORDER = ['Africa', 'Asia', 'Europe', 'North America', 'South America', 'Oceania'];

const SIX_HOURS = 6 * 60 * 60 * 1000;

export default function BrowseWorld() {
  const navigate = useNavigate();
  const utils = trpc.useUtils();
  const dirQ = trpc.citybuild.worldDirectory.useQuery(undefined, {
    staleTime: SIX_HOURS,
    gcTime: 2 * SIX_HOURS,
  });

  const [openRegion, setOpenRegion] = useState<string | null>(null);
  const [openCountry, setOpenCountry] = useState<string | null>(null);
  const [busyCity, setBusyCity] = useState<string | null>(null);

  const regions = useMemo(() => {
    const byRegion = new Map<string, { country: string; code: string; cities: CityRow[] }[]>();
    for (const c of dirQ.data ?? []) {
      const list = byRegion.get(c.region) ?? [];
      list.push(c);
      byRegion.set(c.region, list);
    }
    const order = (r: string) => {
      const i = REGION_ORDER.indexOf(r);
      return i === -1 ? REGION_ORDER.length : i;
    };
    return [...byRegion.entries()]
      .sort((a, b) => order(a[0]) - order(b[0]) || a[0].localeCompare(b[0]))
      .map(([region, countries]) => ({
        region,
        countries: [...countries].sort((a, b) => a.country.localeCompare(b.country)),
      }));
  }, [dirQ.data]);

  const stats = useMemo(() => {
    let cities = 0;
    let mapped = 0;
    for (const c of dirQ.data ?? []) {
      cities += c.cities.length;
      mapped += c.cities.filter((x) => x.mapped).length;
    }
    return { countries: dirQ.data?.length ?? 0, cities, mapped };
  }, [dirQ.data]);

  /** "Coming soon - map it now": import on demand, then open the builder. */
  async function mapItNow(cityName: string) {
    if (busyCity) return;
    setBusyCity(cityName);
    try {
      await utils.citybuild.cityProfile.fetch({ city: cityName });
      navigate(`/city/${encodeURIComponent(cityName)}`);
    } catch (err) {
      toast(
        err instanceof Error && err.message
          ? err.message
          : `We couldn't map ${cityName} right now, please try again.`,
        { kind: 'warn' },
      );
    } finally {
      setBusyCity(null);
    }
  }

  return (
    <section aria-label="Browse the world" className="mt-14">
      <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="type-h3 text-ink flex items-center gap-2">
            <Globe2 className="h-5 w-5 text-brand" strokeWidth={1.75} />
            Browse the world
          </h2>
          <p className="type-small mt-1 text-ink-3">
            {dirQ.data
              ? `${stats.countries} countries · ${stats.cities.toLocaleString()} cities listed · ${stats.mapped.toLocaleString()} mapped, the rest are mapped from OpenStreetMap on demand`
              : 'Every country, its top cities, mapped from OpenStreetMap'}
          </p>
        </div>
      </div>

      {dirQ.isLoading ? (
        <div className="space-y-3">
          {Array.from({ length: 4 }, (_, i) => (
            <Skeleton key={i} className="h-14 w-full rounded-xl" />
          ))}
        </div>
      ) : dirQ.isError ? (
        <div className="rounded-xl border border-border bg-surface px-6 py-8 text-center">
          <p className="type-body text-ink-2">The world directory couldn’t load just now.</p>
          <button
            type="button"
            onClick={() => void dirQ.refetch()}
            className="type-small mt-2 font-semibold text-brand transition-colors duration-fast hover:text-brand-strong"
          >
            Try again
          </button>
        </div>
      ) : (
        <div className="overflow-hidden rounded-xl border border-border bg-surface shadow-sm">
          {regions.map(({ region, countries }) => {
            const isOpen = openRegion === region;
            const regionCities = countries.reduce((n, c) => n + c.cities.length, 0);
            return (
              <div key={region} className="border-b border-border last:border-b-0">
                <button
                  type="button"
                  onClick={() => {
                    setOpenRegion(isOpen ? null : region);
                    setOpenCountry(null);
                  }}
                  className="flex w-full items-center gap-3 px-4 py-3.5 text-left transition-colors duration-fast hover:bg-brand-soft/40 sm:px-6"
                  aria-expanded={isOpen}
                >
                  <span className="type-body font-semibold text-ink">{region}</span>
                  <span className="type-small text-ink-3">
                    {countries.length} countries · {regionCities.toLocaleString()} cities
                  </span>
                  <ChevronDown
                    className={cn(
                      'ml-auto h-4 w-4 shrink-0 text-ink-3 transition-transform duration-fast',
                      isOpen && 'rotate-180',
                    )}
                    strokeWidth={1.75}
                  />
                </button>

                {isOpen && (
                  <div className="border-t border-border/60 px-3 py-3 sm:px-5">
                    <div className="grid grid-cols-1 gap-1 sm:grid-cols-2 lg:grid-cols-3">
                      {countries.map((c) => {
                        const countryOpen = openCountry === c.code;
                        const mappedCount = c.cities.filter((x) => x.mapped).length;
                        return (
                          <button
                            key={c.code}
                            type="button"
                            onClick={() => setOpenCountry(countryOpen ? null : c.code)}
                            className={cn(
                              'flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left transition-colors duration-fast',
                              countryOpen ? 'bg-brand-soft' : 'hover:bg-brand-soft/40',
                            )}
                            aria-expanded={countryOpen}
                          >
                            <MapPin
                              className={cn(
                                'h-3.5 w-3.5 shrink-0',
                                mappedCount > 0 ? 'text-brand' : 'text-ink-3',
                              )}
                              strokeWidth={1.75}
                            />
                            <span className="type-small truncate font-semibold text-ink">
                              {c.country}
                            </span>
                            <span className="type-caption ml-auto shrink-0 text-ink-3">
                              {mappedCount}/{c.cities.length}
                            </span>
                          </button>
                        );
                      })}
                    </div>

                    {/* city chips for the open country, full width below the grid */}
                    {openCountry &&
                      (() => {
                        const c = countries.find((x) => x.code === openCountry);
                        if (!c) return null;
                        return (
                          <div className="mt-2 rounded-lg bg-brand-soft/30 p-3">
                            <p className="type-caption mb-2 text-ink-3">
                              {c.country} · {c.cities.filter((x) => x.mapped).length} of{' '}
                              {c.cities.length} cities mapped; the rest are listed and mapped on
                              demand.
                            </p>
                            <div className="flex flex-wrap gap-1.5">
                              {c.cities.map((city) =>
                                city.mapped ? (
                                  <Link
                                    key={city.name}
                                    to={`/city/${encodeURIComponent(city.name)}`}
                                    className="type-caption inline-flex items-center gap-1 rounded-pill border border-brand/30 bg-surface px-2.5 py-1 font-medium text-ink transition-colors duration-fast hover:bg-brand-soft"
                                    title={`${city.name}, ${city.placeCount} places mapped`}
                                  >
                                    {city.name}
                                    <span className="text-ink-3">{city.placeCount}</span>
                                  </Link>
                                ) : (
                                  <button
                                    key={city.name}
                                    type="button"
                                    disabled={busyCity != null}
                                    onClick={() => void mapItNow(city.name)}
                                    className={cn(
                                      'type-caption inline-flex items-center gap-1 rounded-pill border border-dashed border-ink-3/40 px-2.5 py-1 font-medium text-ink-3 transition-colors duration-fast',
                                      busyCity == null && 'hover:border-brand/50 hover:text-brand',
                                      busyCity === city.name && 'border-brand/50 text-brand',
                                    )}
                                    title={`${city.name}, coming soon, map it now from OpenStreetMap`}
                                  >
                                    {busyCity === city.name ? (
                                      <Loader2 className="h-3 w-3 animate-spin" strokeWidth={2} />
                                    ) : (
                                      <Sparkles className="h-3 w-3" strokeWidth={1.75} />
                                    )}
                                    {city.name}
                                    <span className="opacity-75">
                                      {busyCity === city.name ? 'mapping…' : 'map it now'}
                                    </span>
                                  </button>
                                ),
                              )}
                            </div>
                          </div>
                        );
                      })()}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}

type CityRow = { name: string; mapped: boolean; placeCount: number };
