import { useState } from 'react';
import { Compass, MapPin, Sparkles } from 'lucide-react';
import { toast } from 'sonner';
import { trpc } from '@/providers/trpc';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

/**
 * Discover tab: import OpenStreetMap POIs for a city into the atlas.
 * Idempotent per city - safe to re-run to top up.
 */
export function DiscoverTab() {
  const utils = trpc.useUtils();
  const [city, setCity] = useState('');
  const citiesQ = trpc.explore.cities.useQuery();

  const discover = trpc.admin.discoverCity.useMutation({
    onSuccess: (result, vars) => {
      void utils.admin.places.invalidate();
      void utils.admin.stats.invalidate();
      void utils.explore.cities.invalidate();
      toast.success(`Added ${result.inserted.toLocaleString()} · ${result.total.toLocaleString()} total in ${vars.city.trim()}`);
      setCity('');
    },
    onError: (e) => toast.error(e.message),
  });

  const submit = () => {
    const c = city.trim();
    if (c.length >= 2 && !discover.isPending) discover.mutate({ city: c });
  };

  const cities = citiesQ.data ?? [];

  return (
    <div className="space-y-6">
      {/* Import card */}
      <div className="rounded-xl border border-border bg-surface p-6 shadow-sm md:p-8">
        <div className="flex items-center gap-2">
          <Compass className="h-4 w-4 text-ink-3" strokeWidth={1.75} />
          <span className="type-eyebrow text-ink-3">Grow the atlas</span>
        </div>
        <h3 className="type-h3 mt-2 text-ink">Import a city’s places</h3>
        <p className="type-small mt-1 max-w-[56ch] text-ink-2">
          Pulls named POIs from OpenStreetMap (via Overpass) into the Explore corpus, landmarks,
          museums, parks, cafés, and more. Running it again for the same city only adds what’s new.
        </p>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
          className="mt-5 flex flex-col gap-3 sm:flex-row"
        >
          <Input
            value={city}
            onChange={(e) => setCity(e.target.value)}
            placeholder="City name, e.g. Kyoto"
            aria-label="City to import"
            maxLength={120}
            className="h-11 rounded-md border-border-strong bg-surface sm:max-w-[320px]"
          />
          <Button
            type="submit"
            disabled={city.trim().length < 2 || discover.isPending}
            className="btn-sheen h-11 gap-2 rounded-md bg-brand font-semibold text-brand-ink hover:bg-brand-strong"
          >
            <Sparkles className="h-4 w-4" strokeWidth={1.75} />
            {discover.isPending ? 'Importing…' : 'Import places'}
          </Button>
        </form>
        {discover.isPending && (
          <p className="type-caption mt-3 text-ink-3">
            Talking to OpenStreetMap, this can take up to a minute for a big city.
          </p>
        )}
      </div>

      {/* Current corpus */}
      <div className="rounded-xl border border-border bg-surface p-6 shadow-sm md:p-8">
        <div className="flex items-center gap-2">
          <MapPin className="h-4 w-4 text-ink-3" strokeWidth={1.75} />
          <span className="type-eyebrow text-ink-3">In the atlas now</span>
        </div>
        {citiesQ.isLoading ? (
          <div className="mt-4 flex flex-wrap gap-2">
            {[0, 1, 2, 3, 4].map((i) => (
              <div key={i} className="h-7 w-24 animate-pulse rounded-pill bg-surface-2" />
            ))}
          </div>
        ) : cities.length ? (
          <div className="mt-4 flex flex-wrap gap-2">
            {cities.map((c) => (
              <button
                key={c.city}
                type="button"
                onClick={() => setCity(c.city)}
                title={`Top up ${c.city}`}
                className="type-small tnum inline-flex items-center gap-1.5 rounded-pill bg-surface-2 px-3 py-1.5 text-ink-2 transition-colors duration-fast hover:bg-brand-soft hover:text-brand"
              >
                <span className="font-semibold text-ink">{c.city}</span>
                {c.count.toLocaleString()}
              </button>
            ))}
          </div>
        ) : (
          <p className="type-small mt-4 text-ink-2">Nothing imported yet, pick a city above to start.</p>
        )}
      </div>
    </div>
  );
}
