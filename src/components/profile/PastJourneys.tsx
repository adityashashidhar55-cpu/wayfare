import { TripMemoryCard } from '@/components/trips/TripMemoryCard';
import type { ListedTrip } from '@/components/trips/utils';

/**
 * Past journeys (profile §S5): horizontal snap row of 240px memory-treated
 * cards (desat → color on hover). Click opens the trip archive.
 */
export function PastJourneys({ trips, currentUserId }: { trips: ListedTrip[]; currentUserId?: number }) {
  if (!trips.length) return null;
  return (
    <section aria-label="Past journeys">
      <h3 className="type-h3 mb-5 text-ink">Past journeys</h3>
      <div className="-mx-1 overflow-x-auto px-1 pb-2 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        <div className="flex w-max snap-x snap-mandatory gap-5">
          {trips.map((t, i) => (
            <TripMemoryCard
              key={t.id}
              trip={t}
              index={i}
              currentUserId={currentUserId}
              className="w-[240px] shrink-0 snap-start"
            />
          ))}
        </div>
      </div>
    </section>
  );
}
