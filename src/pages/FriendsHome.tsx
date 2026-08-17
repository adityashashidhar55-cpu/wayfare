/**
 * r13-entry - Friends planning home (/friends). First-class entry point for
 * group planning: it happens before/outside the trip planner, not inside it.
 *
 * Hero explains the flow in 3 steps, a primary CTA opens the Voyager-gated
 * FriendsPlanningModal (non-Voyager gets the standard UPGRADE_REQUIRED
 * upsell), and below the owner's/participant's sessions are listed with
 * status, deadline and a copyable invite link.
 */
import { useState } from 'react';
import { Link } from 'react-router';
import { motion } from 'framer-motion';
import type { Variants } from 'framer-motion';
import { ArrowRight, Compass, Loader2, MapPin, UserPlus, Users, Vote, Wand2 } from 'lucide-react';
import { toast } from 'sonner';
import { trpc } from '@/providers/trpc';
import { Button } from '@/components/ui/button';
import { Toaster } from '@/components/ui/sonner';
import { FriendsPlanningModal } from '@/components/trips/FriendsPlanningModal';
import { CopyLinkField } from '@/components/CopyLinkField';
import { EASE_EXPO } from '@/lib/motion';
import { cn } from '@/lib/utils';

const container: Variants = {
  hidden: {},
  show: { transition: { staggerChildren: 0.08 } },
};
const item: Variants = {
  hidden: { opacity: 0, y: 14 },
  show: { opacity: 1, y: 0, transition: { duration: 0.36, ease: EASE_EXPO } },
};

const STEPS = [
  {
    icon: Wand2,
    title: 'Create a session',
    body: 'Name the escape, set a voting deadline and how many friends a date needs to stick.',
  },
  {
    icon: Vote,
    title: 'Friends vote on their own links',
    body: 'Each friend gets a personal link, dates, vibe and home city. No account, no group-chat chaos.',
  },
  {
    icon: MapPin,
    title: 'Pick a destination near everyone',
    body: 'When enough align, Wayfare suggests places near the whole group and spins up a shared trip.',
  },
];

const STATUS_CHIP: Record<string, { label: string; className: string }> = {
  voting: { label: 'Voting', className: 'bg-ochre-soft text-ochre' },
  met: { label: 'Dates aligned', className: 'bg-pine-soft text-pine' },
  converted: { label: 'Trip created', className: 'bg-surface-2 text-ink-2' },
};

const DEADLINE_FMT = new Intl.DateTimeFormat('en', { month: 'short', day: 'numeric' });

function deadlineLabel(deadlineAt: Date | string, status: string): string {
  if (status === 'converted') return 'converted to a shared trip';
  const ms = new Date(deadlineAt).getTime() - Date.now();
  if (ms <= 0) return 'voting closed';
  const days = Math.floor(ms / 86_400_000);
  const when = DEADLINE_FMT.format(new Date(deadlineAt));
  return days >= 1 ? `voting closes ${when} · ${days}d left` : `voting closes ${when} · less than a day left`;
}

type Session = {
  id: number;
  title: string;
  status: string;
  deadlineAt: Date | string;
  minAvailable: number;
  tripId: number | null;
  role: 'owner' | 'participant';
  token: string;
  path: string;
};

/**
 * r24-social "not connecting" fix: the owner's OWN token link used to be
 * presented here as an "invite link" - friends who received it impersonated
 * the owner and overwrote their vote. Owners now mint a FRESH personal link
 * per friend (one click, copied); participants see their own personal link
 * labeled as such, never as an invite for others.
 */
function MintInviteButton({ session }: { session: Session }) {
  const createInvite = trpc.friends.createInvite.useMutation();
  const [link, setLink] = useState<string | null>(null);

  const mint = async () => {
    try {
      const res = await createInvite.mutateAsync({ token: session.token });
      const url = `${window.location.origin}${res.path}`;
      setLink(url);
      try {
        await navigator.clipboard.writeText(url);
        toast.success('Invite link copied', { description: 'Send it to one friend, each link admits one.' });
      } catch {
        toast.success('Invite link ready', { description: 'Copy it and send it to one friend.' });
      }
    } catch (e) {
      toast.error('Could not create invite', { description: e instanceof Error ? e.message : undefined });
    }
  };

  return (
    <div className="mt-3">
      <Button variant="secondary" size="sm" onClick={mint} disabled={createInvite.isPending}>
        {createInvite.isPending ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin" strokeWidth={1.75} />
        ) : (
          <UserPlus className="h-3.5 w-3.5" strokeWidth={1.75} />
        )}
        New invite link
      </Button>
      {link && (
        <CopyLinkField
          url={link}
          label={`invite link for ${session.title}`}
          copiedLabel="Invite link copied, it admits one friend"
          shareText={`Planning "${session.title}" on Wayfare - add the dates you're free and we'll find a weekend that works for everyone:`}
          className="mt-2"
        />
      )}
    </div>
  );
}

function SessionRow({ session: s }: { session: Session }) {
  const chip = STATUS_CHIP[s.status] ?? STATUS_CHIP.voting!;

  return (
    <motion.li
      variants={item}
      className="rounded-xl border border-border bg-surface p-4 shadow-sm md:p-5"
    >
      <div className="flex flex-wrap items-center gap-4">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="type-h4 truncate text-ink">{s.title}</h3>
            <span className={cn('type-caption rounded-pill px-2.5 py-0.5 font-semibold', chip.className)}>
              {chip.label}
            </span>
            {s.role === 'participant' && (
              <span className="type-caption rounded-pill bg-surface-2 px-2.5 py-0.5 text-ink-3">invited</span>
            )}
          </div>
          <p className="type-caption mt-1.5 text-ink-3">
            {s.role === 'owner' ? 'You organize' : 'A friend organizes'} · needs {s.minAvailable}{' '}
            {s.minAvailable === 1 ? 'friend' : 'friends'} on one date · {deadlineLabel(s.deadlineAt, s.status)}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Button variant="secondary" size="sm" asChild>
            <Link to={s.path}>
              Open
              <ArrowRight className="h-3.5 w-3.5" strokeWidth={1.75} />
            </Link>
          </Button>
        </div>
      </div>
      {s.role === 'owner' ? (
        s.status === 'converted' ? null : <MintInviteButton session={s} />
      ) : (
        <CopyLinkField
          url={`${window.location.origin}${s.path}`}
          label={`your personal link for ${s.title}`}
          copiedLabel="Your personal link copied, keep it to yourself"
          // Personal, single-user link - no WhatsApp button, sharing it would
          // hand someone else your own slot in the session.
          showWhatsApp={false}
          className="mt-3"
        />
      )}
    </motion.li>
  );
}

/** r24-social P: open published trips from the community - request to join. */
function DiscoverTrips() {
  const q = trpc.publish.discover.useQuery(undefined, { retry: false, staleTime: 60_000 });
  const trips = q.data?.trips ?? [];
  if (q.isLoading || trips.length === 0) return null;
  return (
    <motion.section variants={item} aria-label="Discover published trips">
      <div className="mb-5 flex items-center gap-2">
        <Compass className="h-4 w-4 text-brand" strokeWidth={1.75} />
        <h2 className="type-h2 text-ink">Discover trips</h2>
      </div>
      <ul className="grid gap-3 sm:grid-cols-2">
        {trips.map((t) => (
          <li key={t.slug} className="rounded-xl border border-border bg-surface p-4 shadow-sm">
            <h3 className="type-h4 truncate text-ink">{t.title}</h3>
            <p className="type-caption mt-1 text-ink-3">
              {t.destination} · by {t.ownerName}
            </p>
            {t.summary && <p className="type-small mt-2 line-clamp-2 text-ink-2">{t.summary}</p>}
            <Button variant="secondary" size="sm" pill className="mt-3" asChild>
              <Link to={`/p/${t.slug}`}>View & request to join</Link>
            </Button>
          </li>
        ))}
      </ul>
    </motion.section>
  );
}

export default function FriendsHome() {
  const [createOpen, setCreateOpen] = useState(false);
  const utils = trpc.useUtils();
  const sessionsQ = trpc.friends.mySessions.useQuery(undefined, { retry: false });
  const sessions = (sessionsQ.data?.sessions ?? []) as Session[];

  /* Refresh the list after the create dialog closes (a session may have been
     minted inside - the modal itself navigates to it on "Open the session"). */
  const onCreateOpenChange = (open: boolean) => {
    setCreateOpen(open);
    if (!open) void utils.friends.mySessions.invalidate();
  };

  return (
    <div className="mx-auto w-full max-w-[1120px] px-4 py-8 md:px-6 md:py-10">
      <motion.div variants={container} initial="hidden" animate="show" className="space-y-12 md:space-y-14">
        {/* Hero, the flow in 3 steps */}
        <motion.section variants={item} aria-label="How friends planning works">
          <span className="type-eyebrow inline-flex items-center gap-2 rounded-pill border border-border bg-surface px-3.5 py-1.5 text-brand shadow-sm">
            <Users className="h-3.5 w-3.5" strokeWidth={1.75} />
            Friends planning
          </span>
          <h1 className="mt-4 font-serif text-[28px] leading-[34px] tracking-[-0.02em] text-ink md:text-[36px] md:leading-[42px]">
            Agree on dates <em className="serif-em text-brand">before</em> there’s a trip.
          </h1>
          <p className="type-body-l mt-3 max-w-[58ch] text-ink-2">
            Skip the 200-message group chat. Start a planning session, send everyone a personal
            link, and let Wayfare find the dates, and the destination, that fit the whole crew.
          </p>

          <div className="mt-8 grid gap-4 md:grid-cols-3">
            {STEPS.map((step, i) => (
              <motion.div
                key={step.title}
                variants={item}
                className="relative rounded-xl border border-border bg-surface p-5 shadow-sm"
              >
                <div className="flex items-center justify-between">
                  <span className="flex h-10 w-10 items-center justify-center rounded-full bg-brand-soft text-brand">
                    <step.icon className="h-5 w-5" strokeWidth={1.75} />
                  </span>
                  <span className="type-numeral font-serif text-[22px] leading-none text-ink-3/60">
                    {String(i + 1).padStart(2, '0')}
                  </span>
                </div>
                <h2 className="type-h4 mt-4 text-ink">{step.title}</h2>
                <p className="type-small mt-1.5 text-ink-2">{step.body}</p>
              </motion.div>
            ))}
          </div>

          <div className="mt-8 flex flex-wrap items-center gap-3">
            <Button size="lg" pill onClick={() => setCreateOpen(true)}>
              <Users className="h-4 w-4" strokeWidth={1.75} />
              Start a planning session
            </Button>
            <span className="type-caption text-ink-3">
              Voyager perk, one Voyager in the group is enough; friends join free.
            </span>
          </div>
        </motion.section>

        {/* Your sessions */}
        <motion.section variants={item} aria-label="Your planning sessions">
          <h2 className="type-h2 mb-5 text-ink">Your sessions</h2>

          {sessionsQ.isLoading ? (
            <div className="space-y-3" aria-label="Loading your sessions">
              {[0, 1].map((i) => (
                <div key={i} className="h-[76px] animate-pulse rounded-xl bg-surface-2" />
              ))}
            </div>
          ) : sessions.length === 0 ? (
            <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed border-border-strong bg-surface px-6 py-12 text-center">
              <span className="flex h-12 w-12 items-center justify-center rounded-full bg-brand-soft text-brand">
                <Users className="h-5 w-5" strokeWidth={1.75} />
              </span>
              <h3 className="type-h4 text-ink">No planning sessions yet</h3>
              <p className="type-small max-w-[46ch] text-ink-2">
                Start one and send each friend their own link, they vote dates and preferences,
                you pick the destination that suits everyone.
              </p>
              <Button variant="secondary" className="mt-2" onClick={() => setCreateOpen(true)}>
                <Users className="h-4 w-4" strokeWidth={1.75} />
                Start your first session
              </Button>
            </div>
          ) : (
            <motion.ul variants={container} initial="hidden" animate="show" className="space-y-3">
              {sessions.map((s) => (
                <SessionRow key={s.id} session={s} />
              ))}
            </motion.ul>
          )}
        </motion.section>

        <DiscoverTrips />
      </motion.div>

      <FriendsPlanningModal open={createOpen} onOpenChange={onCreateOpenChange} />
      <Toaster position="bottom-center" />
    </div>
  );
}
