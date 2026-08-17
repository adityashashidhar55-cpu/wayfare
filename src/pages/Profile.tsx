import { useEffect } from 'react';
import { Link, useLocation } from 'react-router';
import { motion } from 'framer-motion';
import type { Variants } from 'framer-motion';
import { trpc } from '@/providers/trpc';
import { useAuth } from '@/hooks/useAuth';
import { Toaster } from '@/components/ui/sonner';
import { EASE_EXPO } from '@/lib/motion';
import { IdentityHeader } from '@/components/profile/IdentityHeader';
import { TravelStats } from '@/components/profile/TravelStats';
import { TasteProfile } from '@/components/profile/TasteProfile';
import { BucketListSection } from '@/components/profile/BucketListSection';
import { PastJourneys } from '@/components/profile/PastJourneys';
import { InviteFriendsCard } from '@/components/profile/InviteFriendsCard';
import { SettingsSection } from '@/components/profile/SettingsSection';
import type { ListedTrip } from '@/components/trips/utils';

const container: Variants = {
  hidden: {},
  show: { transition: { staggerChildren: 0.06 } },
};
const item: Variants = {
  hidden: { opacity: 0, y: 12 },
  show: { opacity: 1, y: 0, transition: { duration: 0.32, ease: EASE_EXPO } },
};

function ProfileSkeleton() {
  return (
    <div className="mx-auto w-full max-w-[1120px] px-4 py-8 md:px-6 md:py-10" aria-label="Loading your profile">
      <div className="flex items-center gap-6 rounded-xl border border-border bg-surface p-6 md:p-10">
        <div className="h-24 w-24 animate-pulse rounded-[24px] bg-surface-2" />
        <div className="flex-1 space-y-3">
          <div className="h-8 w-56 animate-pulse rounded-md bg-surface-2" />
          <div className="h-4 w-32 animate-pulse rounded-md bg-surface-2" />
          <div className="h-6 w-44 animate-pulse rounded-pill bg-surface-2" />
        </div>
      </div>
      <div className="mt-12 grid grid-cols-2 gap-px overflow-hidden rounded-xl border border-border bg-border md:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="h-[104px] animate-pulse bg-surface" />
        ))}
      </div>
      <div className="mt-6 h-[280px] animate-pulse rounded-xl bg-surface-2" />
      <div className="mt-12 h-[320px] animate-pulse rounded-xl bg-surface-2" />
    </div>
  );
}

export default function Profile() {
  const { user } = useAuth();
  const { hash } = useLocation();
  const tripsQ = trpc.trips.list.useQuery();
  const prefQ = trpc.preferences.get.useQuery();
  const bucketQ = trpc.explore.bucketList.useQuery();
  const citiesQ = trpc.explore.cities.useQuery();

  /* Anchor scrolls (e.g. /profile#bucket from the dashboard "Manage" link) */
  useEffect(() => {
    if (!hash || tripsQ.isLoading) return;
    const el = document.getElementById(hash.slice(1));
    if (el) {
      const t = setTimeout(() => el.scrollIntoView({ behavior: 'smooth', block: 'start' }), 150);
      return () => clearTimeout(t);
    }
  }, [hash, tripsQ.isLoading]);

  if (tripsQ.isLoading || prefQ.isLoading) return <ProfileSkeleton />;
  if (!user) return null;

  const trips: ListedTrip[] = tripsQ.data?.trips ?? [];
  const past = trips.filter((t) => t.status === 'past').sort((a, b) => (a.endDate > b.endDate ? -1 : 1));
  const directory = (citiesQ.data ?? []).map((c) => ({ city: c.city, country: c.country }));

  return (
    <div className="mx-auto w-full max-w-[1120px] px-4 py-8 md:px-6 md:py-10">
      <motion.div variants={container} initial="hidden" animate="show" className="space-y-12 md:space-y-16">
        {/* S1, identity header */}
        <motion.div variants={item}>
          <IdentityHeader user={user} pref={prefQ.data} />
        </motion.div>

        {/* S2, travel stats + dotted world map */}
        <motion.div variants={item}>
          <TravelStats trips={trips} directory={directory} />
        </motion.div>

        {/* S3, travel style (taste profile) */}
        {prefQ.data && (
          <motion.div variants={item}>
            <TasteProfile pref={prefQ.data} />
          </motion.div>
        )}

        {/* S4, bucket list management */}
        <motion.div variants={item}>
          <BucketListSection items={bucketQ.data ?? []} />
        </motion.div>

        {/* S5, past journeys */}
        {past.length > 0 && (
          <motion.div variants={item}>
            <PastJourneys trips={past} currentUserId={user.id} />
          </motion.div>
        )}

        {/* S5b, invite friends (referral link) */}
        <InviteFriendsCard />

        {/* S6, settings */}
        <motion.div variants={item}>
          <SettingsSection user={user} pref={prefQ.data} />
        </motion.div>

        {/* S7, get the app */}
        <motion.div variants={item} className="text-center">
          <Link to="/get-app" className="type-small text-ink-3 underline decoration-border-strong underline-offset-4 transition-colors duration-fast hover:text-brand">
            Get the Wayfare app for Android &amp; iOS
          </Link>
        </motion.div>
      </motion.div>
      <Toaster position="bottom-center" />
    </div>
  );
}
