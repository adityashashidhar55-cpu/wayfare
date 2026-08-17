/**
 * FamousStrip - small additive "Most famous in {city}" rail for the Explore
 * page, shown only while a city filter is active. Rows come from
 * explore.famousInCity (r11-quality): ranked by fame score with a one-line
 * blurb and a must-see ribbon; clicking a card opens the place detail
 * dialog. Data © OpenStreetMap contributors.
 */
import { Link } from 'react-router';
import { Sparkles } from 'lucide-react';
import { trpc } from '@/providers/trpc';
import { placeImageFor, poolImageFor } from '@/lib/place-images';
import { Skeleton } from '@/components/ui/skeleton';
import type { ExplorePlaceItem } from './explore-utils';

export default function FamousStrip({ city, onOpen }: { city: string; onOpen: (p: ExplorePlaceItem) => void }) {
  const famousQ = trpc.explore.famousInCity.useQuery({ city, limit: 8 });
  if (famousQ.isLoading) {
    return (
      <div className="mt-6 flex gap-3">
        {[0, 1, 2, 3].map((i) => (
          <Skeleton key={i} className="h-28 w-36 shrink-0 rounded-lg" />
        ))}
      </div>
    );
  }
  const places = famousQ.data?.places ?? [];
  if (places.length === 0) return null;
  return (
    <section className="mt-6" aria-label={`Most famous in ${city}`}>
      <div className="mb-3 flex items-center justify-between gap-3">
        <h3 className="type-small flex items-center gap-1.5 font-semibold text-ink">
          <Sparkles className="h-4 w-4 text-brand" strokeWidth={1.75} />
          Most famous in {city}
        </h3>
        <Link
          to={`/city/${encodeURIComponent(city)}`}
          className="type-caption shrink-0 font-semibold text-brand transition-colors duration-fast hover:text-brand-strong"
        >
          Open city builder
        </Link>
      </div>
      <div className="-mx-4 overflow-x-auto px-4 pb-1 sm:mx-0 sm:px-0">
        <div className="flex gap-3">
          {places.map((p) => {
            const img = placeImageFor(p);
            const item = { ...p, matchScore: 0, matchStyles: [], aboveBudget: false } as ExplorePlaceItem;
            return (
              <button
                key={p.id}
                type="button"
                onClick={() => onOpen(item)}
                className="w-36 shrink-0 overflow-hidden rounded-lg border border-border bg-surface text-left shadow-sm transition-all duration-fast hover:-translate-y-0.5 hover:shadow-md"
              >
                <span className="relative block h-20 w-full bg-surface-2">
                  {img && <img src={img} alt="" loading="lazy" className="photo h-full w-full object-cover" onError={e => { const fb = poolImageFor(p); const el = e.currentTarget; if (fb && el.src !== fb) el.src = fb; else el.style.display = 'none'; }} />}
                  {p.verdict === 'must-see' && (
                    <span className="absolute left-1 top-1 rounded-pill bg-brand px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-brand-ink shadow-sm">
                      Must-see
                    </span>
                  )}
                </span>
                <span className="block p-2">
                  <span className="type-caption block truncate font-semibold text-ink">
                    <span className="tnum text-ink-3">{p.rank}.</span> {p.name}
                  </span>
                  <span className="mt-0.5 block truncate text-[11px] text-ink-3">{p.blurb}</span>
                </span>
              </button>
            );
          })}
        </div>
      </div>
    </section>
  );
}
