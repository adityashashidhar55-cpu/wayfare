import { Link } from 'react-router';
import { motion } from 'framer-motion';
import { CalendarDays, Users } from 'lucide-react';
import { EASE_EXPO } from '@/lib/motion';
import { TripCardMenu } from '@/components/trips/TripCardMenu';
import { formatDateRange, tripNights, tripCoverFor } from '@/components/trips/utils';
import type { ListedTrip } from '@/components/trips/utils';
import { cn } from '@/lib/utils';

/**
 * Past-trip memory card (dashboard §S5): desaturated cover + 8% paper wash;
 * on hover full color returns over 400ms (memory → color signature detail).
 */
export function TripMemoryCard({
  trip,
  index,
  currentUserId,
  className,
}: {
  trip: ListedTrip;
  index: number;
  currentUserId?: number;
  className?: string;
}) {
  const nights = tripNights(trip.startDate, trip.endDate);

  return (
    <motion.article
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.45, ease: EASE_EXPO, delay: 0.08 * index }}
      className={cn('group relative', className)}
    >
      <div className="relative aspect-[16/9] overflow-hidden rounded-lg border border-border shadow-sm">
        <img
          src={tripCoverFor(trip.coverImage, trip.destination)}
          alt=""
          style={{ transition: 'filter 400ms var(--ease-expo), transform 400ms var(--ease-expo)' }}
          className="absolute inset-0 h-full w-full object-cover saturate-[0.55] contrast-[0.98] group-hover:saturate-[0.95] group-hover:scale-[1.02] dark:brightness-[0.85]"
        />
        {/* 8% paper wash, signals "memory" */}
        <div className="pointer-events-none absolute inset-0 bg-bg opacity-[0.08]" />
        <div className="absolute right-2 top-2 z-[2] opacity-0 transition-opacity duration-fast group-hover:opacity-100 max-md:opacity-100">
          <TripCardMenu
            trip={trip}
            isOwner={trip.ownerId === currentUserId}
            triggerClassName="inline-flex h-8 w-8 items-center justify-center rounded-md bg-white/70 text-[#1C1917] backdrop-blur-md transition-colors hover:bg-white/90"
          />
        </div>
        <Link to={`/trips/${trip.id}`} aria-label={`Open ${trip.title}`} className="absolute inset-0 z-[1]" />
        {/* "Shared with you" badge on trips owned by someone else */}
        {currentUserId != null && trip.ownerId !== currentUserId && (
          <span className="type-caption absolute left-2 top-2 z-[2] rounded-pill bg-pine/90 px-2.5 py-1 font-medium text-white backdrop-blur-md">
            Shared with you
          </span>
        )}
      </div>

      <div className="mt-3 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h4 className="type-h4 truncate text-ink">{trip.title}</h4>
          <p className="type-caption mt-0.5 text-ink-3">
            {formatDateRange(trip.startDate, trip.endDate, { withYear: true })}
          </p>
        </div>
      </div>
      <div className="type-small mt-2 flex items-center gap-4 text-ink-2">
        <span className="inline-flex items-center gap-1.5">
          <CalendarDays className="h-3.5 w-3.5 text-ink-3" strokeWidth={1.75} />
          <span className="tnum">{nights} {nights === 1 ? 'night' : 'nights'}</span>
        </span>
        <span className="inline-flex items-center gap-1.5">
          <Users className="h-3.5 w-3.5 text-ink-3" strokeWidth={1.75} />
          <span className="tnum">{trip.members.length} {trip.members.length === 1 ? 'traveler' : 'travelers'}</span>
        </span>
      </div>
    </motion.article>
  );
}
