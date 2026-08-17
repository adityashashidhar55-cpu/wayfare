import { lazy, Suspense, useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { motion } from 'framer-motion';
import type { Variants } from 'framer-motion';
import { ArrowRight, Compass, Heart, Import, Plus, Route, Sparkles, Users } from 'lucide-react';
import type { BucketListItem } from '@contracts/types';
import { trpc } from '@/providers/trpc';
import { useAuth } from '@/hooks/useAuth';
import { Button } from '@/components/ui/button';
import { Toaster } from '@/components/ui/sonner';
import { EASE_EXPO } from '@/lib/motion';
import {
  consumeImportRequest,
  consumePlanPrompt,
  extractDestinationHint,
} from '@/lib/plan-prompt';
import { TripHeroCard } from '@/components/trips/TripHeroCard';
import { TripMemoryCard } from '@/components/trips/TripMemoryCard';
import { BucketRail } from '@/components/trips/BucketRail';
import { CreateTripModal } from '@/components/trips/CreateTripModal';
import { PlansGallery } from '@/components/trips/PlansGallery';
import { AiTripBuilderCard, AiTripBuilderModal } from '@/components/trips/AiTripBuilder';
import { RoadtripBuilderModal } from '@/components/trips/RoadtripBuilder';
import { FriendsPlanningModal } from '@/components/trips/FriendsPlanningModal'; // r12-friends
// r19-social; r21-perf: lazy so maplibre loads only when the modal opens
const SocialImportModal = lazy(() =>
  import('@/components/trips/SocialImportModal').then((m) => ({ default: m.SocialImportModal })),
);
import {
  daysUntil,
  firstName,
  greeting,
  isUnderway,
  tripDays,
} from '@/components/trips/utils';
import type { ListedTrip } from '@/components/trips/utils';

const container: Variants = {
  hidden: {},
  show: { transition: { staggerChildren: 0.06 } },
};
const item: Variants = {
  hidden: { opacity: 0, y: 12 },
  show: { opacity: 1, y: 0, transition: { duration: 0.32, ease: EASE_EXPO } },
};

/** Greeting headline with word-level rise (dashboard §S1). */
function RisingWords({ text }: { text: string }) {
  return (
    <h1
      aria-label={text}
      className="font-serif text-[26px] leading-[32px] tracking-[-0.02em] text-ink md:text-[32px] md:leading-[38px]"
    >
      {text.split(' ').map((word, i) => (
        <span key={i} aria-hidden className="inline-block overflow-hidden pb-1 align-bottom">
          <motion.span
            className="inline-block"
            initial={{ y: '110%' }}
            animate={{ y: 0 }}
            transition={{ duration: 0.55, ease: EASE_EXPO, delay: 0.05 + 0.05 * i }}
          >
            {word}
            {i < text.split(' ').length - 1 ? ' ' : ''}
          </motion.span>
        </span>
      ))}
    </h1>
  );
}

function DashboardSkeleton() {
  return (
    <div className="mx-auto w-full max-w-[1120px] px-4 py-8 md:px-6 md:py-10" aria-label="Loading your trips">
      <div className="flex items-end justify-between">
        <div className="space-y-3">
          <div className="h-8 w-64 animate-pulse rounded-md bg-surface-2" />
          <div className="h-4 w-80 max-w-[60vw] animate-pulse rounded-md bg-surface-2" />
        </div>
        <div className="h-12 w-32 animate-pulse rounded-pill bg-surface-2" />
      </div>
      <div className="mt-10 grid gap-6 min-[900px]:grid-cols-2">
        {[0, 1].map((i) => (
          <div key={i} className="aspect-[16/9] animate-pulse rounded-xl bg-surface-2" />
        ))}
      </div>
      <div className="mt-14 space-y-5">
        <div className="h-7 w-40 animate-pulse rounded-md bg-surface-2" />
        <div className="flex gap-4 overflow-hidden">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="h-[240px] w-[200px] shrink-0 animate-pulse rounded-lg bg-surface-2" />
          ))}
        </div>
      </div>
    </div>
  );
}

/** "Continue planning" strip (§S3) - shown for trips underway right now. */
function UnderwayStrip({ trips }: { trips: ListedTrip[] }) {
  if (!trips.length) return null;
  return (
    <div className="flex flex-wrap gap-4">
      {trips.map((t, i) => {
        const total = tripDays(t.startDate, t.endDate);
        const dayN = Math.min(total, Math.max(1, 1 - daysUntil(t.startDate)));
        const pct = Math.round((dayN / total) * 100);
        return (
          <motion.div
            key={t.id}
            initial={{ opacity: 0, x: -16 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ duration: 0.3, ease: EASE_EXPO, delay: 0.1 * i }}
            className="w-full max-w-[320px] rounded-lg border border-border bg-surface p-4 shadow-sm"
          >
            <span className="type-caption font-semibold uppercase tracking-[0.1em] text-pine">Underway now</span>
            <h3 className="type-h4 mt-1 truncate text-ink">{t.title}</h3>
            <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-surface-2">
              <motion.div
                initial={{ width: 0 }}
                animate={{ width: `${pct}%` }}
                transition={{ duration: 0.6, ease: EASE_EXPO, delay: 0.2 }}
                className="h-full rounded-full bg-pine"
              />
            </div>
            <div className="mt-3 flex items-center justify-between">
              <span className="type-caption text-ink-3 tnum">
                Day {dayN} of {total}
              </span>
              <Button variant="ghost" size="sm" asChild>
                <Link to={`/trips/${t.id}`}>
                  Resume <ArrowRight className="h-3.5 w-3.5" strokeWidth={1.75} />
                </Link>
              </Button>
            </div>
          </motion.div>
        );
      })}
    </div>
  );
}

export default function Trips() {
  const { user } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const tripsQ = trpc.trips.list.useQuery();
  const bucketQ = trpc.explore.bucketList.useQuery();

  /* Deep link: /trips?new=1(&dest=Lisbon) opens the create-trip modal.
     Derived from the URL - no effect needed; closing clears the params. */
  const openFromUrl = searchParams.get('new') === '1';
  const prefillFromUrl = searchParams.get('dest') ?? undefined;
  const [modalState, setModalState] = useState<{ open: boolean; prefill?: string }>({ open: false });
  const [aiOpen, setAiOpen] = useState(false);
  const [roadtripOpen, setRoadtripOpen] = useState(false);
  const [friendsOpen, setFriendsOpen] = useState(false); // r12-friends
  const [socialOpen, setSocialOpen] = useState(false); // r19-social
  const modalOpen = modalState.open || openFromUrl;
  const prefill = openFromUrl ? prefillFromUrl : modalState.prefill;
  const onModalOpenChange = (open: boolean) => {
    if (!open) {
      if (openFromUrl) setSearchParams({}, { replace: true });
      setModalState({ open: false });
    }
  };

  /* Deep link: /trips?import=1 opens the social-import modal (r23 landing
     upload button). Same URL-derived pattern as ?new=1 above. */
  const importFromUrl = searchParams.get('import') === '1';
  const socialModalOpen = socialOpen || importFromUrl;
  const onSocialOpenChange = (open: boolean) => {
    if (!open) {
      if (importFromUrl) setSearchParams({}, { replace: true });
      setSocialOpen(false);
    }
  };

  /* r23: the landing "Plan My Trip" / upload buttons stash their intent in
     sessionStorage so they survive the login redirect; resume them here
     once the (now authenticated) Trips page mounts. If the deep-link params
     made it through (already signed in), just clear the stash. */
  useEffect(() => {
    const prompt = consumePlanPrompt();
    if (prompt && searchParams.get('new') !== '1') {
      setModalState({ open: true, prefill: extractDestinationHint(prompt) });
    }
    if (consumeImportRequest() && searchParams.get('import') !== '1') {
      setSocialOpen(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const trips = useMemo(() => tripsQ.data?.trips ?? [], [tripsQ.data?.trips]);
  const tier = tripsQ.data?.tier ?? 'wanderer';

  const { underway, upcoming, past } = useMemo(() => {
    const u: ListedTrip[] = [];
    const up: ListedTrip[] = [];
    const p: ListedTrip[] = [];
    for (const t of trips) {
      if (t.status === 'past') p.push(t);
      else if (isUnderway(t.startDate, t.endDate)) u.push(t);
      else up.push(t);
    }
    up.sort((a, b) => (a.startDate < b.startDate ? -1 : 1));
    p.sort((a, b) => (a.endDate > b.endDate ? -1 : 1));
    return { underway: u, upcoming: up, past: p };
  }, [trips]);

  /* Free tier: 3 active trips → Voyager soft-upsell in the create modal */
  const ownedActive = trips.filter((t) => t.ownerId === user?.id && t.status === 'upcoming').length;
  const atLimit = tier === 'wanderer' && ownedActive >= 3;

  /* Greeting caption - next journey context (dashboard §S1) */
  const caption = useMemo(() => {
    const next = underway[0] ?? upcoming[0];
    if (!next) return 'Your next journey starts with a single pin.';
    const dest = next.destination.split(',')[0]?.trim() ?? next.destination;
    const others = next.members.length - 1;
    const friends =
      others > 0 ? `, ${others} ${others === 1 ? 'friend is' : 'friends are'} planning with you` : '';
    if (underway[0]) return `${dest} is happening right now${friends}.`;
    const d = daysUntil(next.startDate);
    const when = d <= 0 ? 'leaves today' : d === 1 ? 'is 1 day away' : `is ${d} days away`;
    return `${dest} ${when}${friends}.`;
  }, [underway, upcoming]);

  if (tripsQ.isLoading) return <DashboardSkeleton />;

  const openCreate = (dest?: string) => setModalState({ open: true, prefill: dest });

  const onPlanBucket = (bucketItem: BucketListItem) => openCreate(bucketItem.name);

  /* S6 - empty state replaces S2–S5 for brand-new accounts */
  if (trips.length === 0) {
    return (
      <div className="mx-auto flex min-h-[70dvh] w-full max-w-[1120px] flex-col items-center justify-center gap-4 px-6 py-16 text-center">
        <div className="flex w-full max-w-[520px] flex-col items-center gap-4">
        <motion.img
          src="/empty-globe.svg"
          alt=""
          initial={{ opacity: 0, scale: 0.94 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.9, ease: EASE_EXPO }}
          className="w-[240px] max-w-[70vw]"
        />
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4, ease: EASE_EXPO, delay: 0.15 }}
          className="space-y-3"
        >
          <h2 className="type-h2 text-ink">Your atlas is empty, for now.</h2>
          <p className="type-body text-ink-2">
            Create your first trip. Invite friends later; Wayfare is lovely solo too.
          </p>
        </motion.div>
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4, ease: EASE_EXPO, delay: 0.28 }}
          className="mt-2 flex flex-col items-center gap-2"
        >
          <Button size="lg" pill onClick={() => openCreate()}>
            <Plus className="h-4 w-4" strokeWidth={2} />
            Plan my first trip
          </Button>
          <Button variant="ghost" onClick={() => setAiOpen(true)}>
            <Sparkles className="h-4 w-4" strokeWidth={1.75} />
            Build it with AI
          </Button>
          <Button variant="ghost" onClick={() => setRoadtripOpen(true)}>
            <Route className="h-4 w-4" strokeWidth={1.75} />
            Plan a road trip
          </Button>
          {/* r12-friends */}
          <Button variant="ghost" onClick={() => setFriendsOpen(true)}>
            <Users className="h-4 w-4" strokeWidth={1.75} />
            Plan with friends
          </Button>
          {/* r19-social */}
          <Button variant="ghost" onClick={() => setSocialOpen(true)}>
            <Import className="h-4 w-4" strokeWidth={1.75} />
            Import from social
          </Button>
          <Button variant="ghost" asChild>
            <Link to="/explore">
              <Compass className="h-4 w-4" strokeWidth={1.75} />
              Get recommendations first
            </Link>
          </Button>
        </motion.div>
        </div>
        {/* S6b, ready-made plans: instant first trip for brand-new accounts */}
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4, ease: EASE_EXPO, delay: 0.4 }}
          className="mt-10 w-full text-left"
        >
          <PlansGallery prominent />
        </motion.div>
        <CreateTripModal open={modalOpen} onOpenChange={onModalOpenChange} prefillDestination={prefill} atLimit={atLimit} />
        <AiTripBuilderModal open={aiOpen} onOpenChange={setAiOpen} />
        <RoadtripBuilderModal open={roadtripOpen} onOpenChange={setRoadtripOpen} />
        <FriendsPlanningModal open={friendsOpen} onOpenChange={setFriendsOpen} /> {/* r12-friends */}
        <Suspense fallback={null}>
          <SocialImportModal open={socialModalOpen} onOpenChange={onSocialOpenChange} /> {/* r19-social */}
        </Suspense>
        <Toaster position="bottom-center" />
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-[1120px] px-4 py-8 md:px-6 md:py-10">
      <motion.div variants={container} initial="hidden" animate="show" className="space-y-12 md:space-y-16">
        {/* S1, greeting header */}
        <motion.div variants={item} className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <RisingWords text={`${greeting()}, ${firstName(user?.name)}.`} />
            <p className="type-small mt-2 text-ink-2">{caption}</p>
          </div>
          <div className="flex flex-wrap items-center gap-2 max-sm:justify-start">
            <Button variant="ghost" size="lg" onClick={() => setAiOpen(true)}>
              <Sparkles className="h-4 w-4" strokeWidth={1.75} />
              AI
            </Button>
            <Button variant="ghost" size="lg" onClick={() => setRoadtripOpen(true)}>
              <Route className="h-4 w-4" strokeWidth={1.75} />
              Road trip
            </Button>
            {/* r12-friends */}
            <Button variant="ghost" size="lg" onClick={() => setFriendsOpen(true)}>
              <Users className="h-4 w-4" strokeWidth={1.75} />
              Friends
            </Button>
            {/* r19-social */}
            <Button variant="ghost" size="lg" onClick={() => setSocialOpen(true)}>
              <Import className="h-4 w-4" strokeWidth={1.75} />
              Import
            </Button>
            {/* r24-smart O: wishlist entry (mobile-reachable path) */}
            <Link to="/wishlist">
              <Button variant="ghost" size="lg">
                <Heart className="h-4 w-4" strokeWidth={1.75} />
                Wishlist
              </Button>
            </Link>
            <Button size="lg" pill onClick={() => openCreate()}>
              <Plus className="h-4 w-4" strokeWidth={2} />
              New trip
            </Button>
          </div>
        </motion.div>

        {/* S1b · AI trip builder entry (grad-cta, the one per page) */}
        <motion.div variants={item}>
          <AiTripBuilderCard onOpen={() => setAiOpen(true)} />
        </motion.div>

        {/* S3, continue planning (underway trips) */}
        {underway.length > 0 && (
          <motion.div variants={item}>
            <UnderwayStrip trips={underway} />
          </motion.div>
        )}

        {/* S2, upcoming trips hero cards */}
        {upcoming.length > 0 && (
          <motion.section variants={item} aria-label="Upcoming trips">
            <div className="grid gap-6 min-[900px]:grid-cols-2">
              {upcoming.map((t, i) => (
                <TripHeroCard key={t.id} trip={t} index={i} tier={tier} currentUserId={user?.id} />
              ))}
            </div>
          </motion.section>
        )}

        {/* S4, bucket list rail */}
        <motion.div variants={item}>
          <BucketRail items={bucketQ.data ?? []} loading={bucketQ.isLoading} onPlan={onPlanBucket} />
        </motion.div>

        {/* S4b, ready-made plans (curated clonable templates) */}
        <motion.div variants={item}>
          <PlansGallery />
        </motion.div>

        {/* S5, past trips */}
        {past.length > 0 && (
          <motion.section variants={item} aria-label="Past journeys">
            <h2 className="type-h2 mb-5 text-ink">Past journeys</h2>
            <div className="grid gap-6 min-[640px]:grid-cols-2 min-[1024px]:grid-cols-3">
              {past.map((t, i) => (
                <TripMemoryCard key={t.id} trip={t} index={i} currentUserId={user?.id} />
              ))}
            </div>
          </motion.section>
        )}
      </motion.div>

      <CreateTripModal open={modalOpen} onOpenChange={onModalOpenChange} prefillDestination={prefill} atLimit={atLimit} />
      <AiTripBuilderModal open={aiOpen} onOpenChange={setAiOpen} />
      <RoadtripBuilderModal open={roadtripOpen} onOpenChange={setRoadtripOpen} />
      <FriendsPlanningModal open={friendsOpen} onOpenChange={setFriendsOpen} /> {/* r12-friends */}
      <Suspense fallback={null}>
        <SocialImportModal open={socialModalOpen} onOpenChange={onSocialOpenChange} /> {/* r19-social */}
      </Suspense>
      <Toaster position="bottom-center" />
    </div>
  );
}
