import { useState } from 'react';
import { Link } from 'react-router';
import { motion } from 'framer-motion';
import { ArrowRight, Share2 } from 'lucide-react';
import { EASE_EXPO, SPRING_PIN_POP } from '@/lib/motion';
import { AvatarStack } from '@/components/trips/AvatarStack';
import { ShareTripDialog } from '@/components/trips/ShareTripDialog';
import { TripCardMenu } from '@/components/trips/TripCardMenu';
import { countdownLabel, formatDateRange, tripCoverFor } from '@/components/trips/utils';
import type { ListedTrip } from '@/components/trips/utils';

const GLASS_CHIP =
  'inline-flex items-center justify-center rounded-md bg-white/70 text-[#1C1917] backdrop-blur-md shadow-sm transition-colors duration-fast hover:bg-white/90';

/**
 * Upcoming trip hero card (dashboard §S2): full-bleed cover, bottom scrim,
 * countdown pill, collaborator stack, share + menu, hover reveal CTA.
 */
export function TripHeroCard({
  trip,
  index,
  tier,
  currentUserId,
}: {
  trip: ListedTrip;
  index: number;
  tier: 'wanderer' | 'voyager';
  currentUserId?: number;
}) {
  const [shareOpen, setShareOpen] = useState(false);
  const isOwner = trip.ownerId === currentUserId;

  return (
    <motion.article
      initial={{ opacity: 0, y: 24 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, ease: EASE_EXPO, delay: 0.12 * index }}
      whileHover={{ y: -4 }}
      className="group relative aspect-[16/9] overflow-hidden rounded-xl shadow-md transition-shadow duration-base hover:shadow-lg"
    >
      {/* Cover */}
      <img
        src={tripCoverFor(trip.coverImage, trip.destination)}
        alt=""
        style={{ transition: 'transform 600ms var(--ease-expo)' }}
        className="photo absolute inset-0 h-full w-full object-cover group-hover:scale-[1.045]"
      />
      {/* Bottom scrim rgba(22,19,15, 0→.6); deepens ~10% on hover */}
      <div className="absolute inset-0 bg-gradient-to-t from-[rgba(22,19,15,0.6)] via-[rgba(22,19,15,0.12)] to-transparent transition-opacity duration-base" />
      <div className="absolute inset-0 bg-[rgba(22,19,15,0.06)] opacity-0 transition-opacity duration-base group-hover:opacity-100" />

      {/* Whole-card link (stretched) */}
      <Link to={`/trips/${trip.id}`} aria-label={`Open ${trip.title}`} className="absolute inset-0 z-[1]" />

      {/* Countdown pill, pops in with a spring after the card rises */}
      <motion.span
        initial={{ scale: 0.5, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={{ ...SPRING_PIN_POP, delay: 0.3 + 0.12 * index }}
        className="type-caption absolute left-4 top-4 z-[2] rounded-pill bg-white/70 px-2.5 py-1 text-[#1C1917] backdrop-blur-md"
      >
        {countdownLabel(trip.startDate, trip.endDate)}
      </motion.span>

      {/* "Shared with you" badge on trips owned by someone else */}
      {!isOwner && currentUserId != null && (
        <span className="type-caption absolute left-4 top-14 z-[2] rounded-pill bg-pine/90 px-2.5 py-1 font-medium text-white backdrop-blur-md">
          Shared with you
        </span>
      )}

      {/* Top-right: collaborator stack + share + menu */}
      <div className="absolute right-4 top-4 z-[2] flex items-center gap-2">
        <AvatarStack members={trip.members} />
        <button
          type="button"
          aria-label={`Share ${trip.title}`}
          onClick={() => setShareOpen(true)}
          className={`${GLASS_CHIP} h-9 w-9 md:opacity-0 md:transition-all md:duration-fast md:group-hover:opacity-100`}
        >
          <Share2 className="h-4 w-4" strokeWidth={1.75} />
        </button>
        <TripCardMenu trip={trip} isOwner={isOwner} triggerClassName={`${GLASS_CHIP} h-9 w-9`} />
      </div>

      {/* Bottom-left: title + metadata */}
      <div className="absolute bottom-4 left-4 z-[2] max-w-[70%]">
        <h3 className="font-serif text-[24px] leading-[30px] tracking-[-0.02em] text-[#FAF7F1] md:text-[28px] md:leading-[34px]">
          {trip.title}
        </h3>
        <p className="type-small mt-1 text-[#FAF7F1]/80">
          {formatDateRange(trip.startDate, trip.endDate)} · {trip.destination}
        </p>
      </div>

      {/* Bottom-right: hover-reveal workspace pill */}
      <span className="type-small absolute bottom-4 right-4 z-[2] hidden translate-y-3 items-center gap-1.5 rounded-pill bg-[#FAF7F1] px-3.5 py-2 font-semibold text-[#1C1917] opacity-0 transition-all duration-base ease-expo group-hover:translate-y-0 group-hover:opacity-100 md:inline-flex">
        Open workspace
        <ArrowRight className="h-3.5 w-3.5" strokeWidth={2} />
      </span>

      <ShareTripDialog trip={trip} tier={tier} open={shareOpen} onOpenChange={setShareOpen} />
    </motion.article>
  );
}
