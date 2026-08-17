/**
 * PublishedTrip (r24-social, feature P) - public page at /p/:slug.
 *
 * Read-only itinerary (days + stops, booked ticks), the organizer's updates
 * feed (notes, booking progress, milestones), and "Request to join" for
 * signed-in visitors. The owner gets a management panel: join-request inbox
 * (accept -> trip member, decline) and a post-an-update box. Logged-out
 * visitors see everything except interactive joins (prompted to sign in).
 * Unpublished slugs 404 via the api NOT_FOUND.
 */
import { useState } from 'react';
import { Link, useParams } from 'react-router';
import { motion } from 'framer-motion';
import {
  CalendarDays,
  Check,
  Globe2,
  Loader2,
  MapPin,
  Send,
  UserPlus,
  Users,
  X,
} from 'lucide-react';
import { toast } from 'sonner';
import Logo from '@/components/Logo';
import { Button } from '@/components/ui/button';
import { Toaster } from '@/components/ui/sonner';
import { trpc } from '@/providers/trpc';
import { cn } from '@/lib/utils';
import { EASE_EXPO } from '@/lib/motion';

const DAY_FMT = new Intl.DateTimeFormat('en', { weekday: 'short', month: 'short', day: 'numeric' });
const TIME_FMT = new Intl.DateTimeFormat('en', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });

type PageData = NonNullable<ReturnType<typeof usePage>['data']>;
function usePage(slug: string) {
  return trpc.publish.getBySlug.useQuery({ slug }, { retry: false });
}

const KIND_CHIP: Record<string, { label: string; className: string }> = {
  note: { label: 'Note', className: 'bg-surface-2 text-ink-2' },
  booking: { label: 'Booking', className: 'bg-pine-soft text-pine' },
  milestone: { label: 'Milestone', className: 'bg-brand-soft text-brand' },
};

function UpdatesFeed({ updates }: { updates: PageData['updates'] }) {
  if (!updates.length) return null;
  return (
    <section aria-label="Trip updates" className="rounded-xl border border-border bg-surface p-5 shadow-sm">
      <h2 className="type-h4 text-ink">Updates</h2>
      <ul className="mt-3 space-y-3">
        {updates.map((u) => {
          const chip = KIND_CHIP[u.kind] ?? KIND_CHIP.note!;
          return (
            <li key={u.id} className="flex items-start gap-3">
              <span className={cn('type-caption mt-0.5 shrink-0 rounded-pill px-2 py-0.5 font-semibold', chip.className)}>
                {chip.label}
              </span>
              <div className="min-w-0">
                <p className="type-small text-ink">{u.body}</p>
                <p className="type-caption mt-0.5 text-ink-3 tnum">
                  {u.authorName ? `${u.authorName} · ` : ''}{TIME_FMT.format(new Date(u.createdAt))}
                </p>
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function Itinerary({ data }: { data: PageData }) {
  if (!data.days.length) return null;
  return (
    <section aria-label="Itinerary" className="rounded-xl border border-border bg-surface p-5 shadow-sm">
      <h2 className="type-h4 text-ink">Itinerary</h2>
      <ol className="mt-3 space-y-4">
        {data.days.map((d, i) => {
          const stops = data.stops.filter((s) => s.dayId === d.id);
          return (
            <li key={d.id}>
              <p className="type-small font-semibold text-ink tnum">
                Day {i + 1} · {DAY_FMT.format(new Date(d.date + 'T00:00:00Z'))}
              </p>
              {stops.length ? (
                <ul className="mt-1.5 space-y-1">
                  {stops.map((s) => (
                    <li key={s.id} className="flex items-center gap-2">
                      {s.bookedAt ? (
                        <Check className="h-3.5 w-3.5 shrink-0 text-pine" strokeWidth={2.25} />
                      ) : (
                        <MapPin className="h-3.5 w-3.5 shrink-0 text-ink-3" strokeWidth={1.75} />
                      )}
                      <span className="type-small truncate text-ink">{s.name}</span>
                      {s.startTime && <span className="type-caption shrink-0 text-ink-3 tnum">{s.startTime}</span>}
                      {s.bookedAt && <span className="type-caption shrink-0 text-pine">booked</span>}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="type-caption mt-1 text-ink-3">Open day</p>
              )}
            </li>
          );
        })}
      </ol>
    </section>
  );
}

/** Signed-in visitor join request; owner never sees this. */
function JoinPanel({ slug, data }: { slug: string; data: PageData }) {
  const utils = trpc.useUtils();
  const [message, setMessage] = useState('');
  const requestJoin = trpc.publish.requestJoin.useMutation({
    onSuccess: () => {
      toast.success('Request sent', { description: 'The organizer will see it on their side.' });
      void utils.publish.getBySlug.invalidate({ slug });
    },
    onError: (e) => toast.error(e.message),
  });

  if (data.viewer.isOwner || data.viewer.isMember) return null;
  if (!data.signedIn) {
    return (
      <div className="rounded-xl border border-border bg-surface p-5 text-center shadow-sm">
        <p className="type-small text-ink-2">Sign in to ask {data.ownerName} for a seat on this trip.</p>
        <Button pill className="mt-3" asChild>
          <Link to={`/login?next=/p/${slug}`}>Sign in to request a spot</Link>
        </Button>
      </div>
    );
  }
  if (data.viewer.requestStatus === 'pending') {
    return (
      <p className="type-small rounded-xl border border-ochre/30 bg-ochre-soft px-4 py-3 text-center text-ink-2">
        Your join request is waiting for {data.ownerName}.
      </p>
    );
  }
  if (data.viewer.requestStatus === 'accepted') return null;
  if (!data.isOpen) {
    return (
      <p className="type-small rounded-xl border border-border bg-surface px-4 py-3 text-center text-ink-3">
        {data.ownerName} isn’t accepting join requests right now.
      </p>
    );
  }
  return (
    <div className="rounded-xl border border-border bg-surface p-5 shadow-sm">
      <h2 className="type-h4 text-ink">Request to join</h2>
      <textarea
        value={message}
        onChange={(e) => setMessage(e.target.value)}
        placeholder={`Say hi to ${data.ownerName} (optional)`}
        aria-label="Join request message"
        rows={2}
        maxLength={500}
        className="type-small mt-2 w-full rounded-md border border-border-strong bg-surface px-3 py-2 text-ink outline-none placeholder:text-ink-3 focus:border-brand"
      />
      <Button
        pill
        className="mt-2 w-full"
        disabled={requestJoin.isPending}
        onClick={() => requestJoin.mutate({ slug, message: message.trim() || undefined })}
      >
        {requestJoin.isPending ? (
          <Loader2 className="h-4 w-4 animate-spin" strokeWidth={1.75} />
        ) : (
          <UserPlus className="h-4 w-4" strokeWidth={1.75} />
        )}
        Request to join this trip
      </Button>
    </div>
  );
}

/** Owner console: join-request inbox + post updates. */
function OwnerPanel({ data, tripId }: { data: PageData; tripId: number }) {
  const utils = trpc.useUtils();
  const requestsQ = trpc.publish.listRequests.useQuery(
    { tripId },
    { enabled: data.viewer.isOwner },
  );
  const respond = trpc.publish.respondRequest.useMutation({
    onSuccess: (res) => {
      toast.success(res.status === 'accepted' ? 'They’re in!' : 'Request declined');
      void requestsQ.refetch();
      void utils.publish.getBySlug.invalidate({ slug: data.slug });
    },
    onError: (e) => toast.error(e.message),
  });
  const postUpdate = trpc.publish.postUpdate.useMutation({
    onSuccess: () => {
      setDraft('');
      toast.success('Update posted');
      void utils.publish.getBySlug.invalidate({ slug: data.slug });
    },
    onError: (e) => toast.error(e.message),
  });
  const [draft, setDraft] = useState('');

  const requests = requestsQ.data?.requests ?? [];
  const pending = requests.filter((r) => r.status === 'pending');

  return (
    <section aria-label="Organizer panel" className="space-y-4 rounded-xl border border-brand/30 bg-brand-soft/40 p-5">
      <h2 className="type-h4 flex items-center gap-2 text-ink">
        <Users className="h-4 w-4 text-brand" strokeWidth={1.75} />
        Join requests {pending.length > 0 && <span className="type-caption rounded-pill bg-brand px-2 py-0.5 font-bold text-brand-ink tnum">{pending.length}</span>}
      </h2>
      {pending.length === 0 ? (
        <p className="type-small text-ink-2">No pending requests. Share your link to gather interest.</p>
      ) : (
        <ul className="space-y-2">
          {pending.map((r) => (
            <li key={r.id} className="rounded-lg border border-border bg-surface p-3">
              <p className="type-small font-semibold text-ink">{r.name}</p>
              {r.message && <p className="type-small mt-1 text-ink-2">“{r.message}”</p>}
              <div className="mt-2 flex gap-2">
                <Button
                  size="sm"
                  pill
                  disabled={respond.isPending}
                  onClick={() => respond.mutate({ requestId: r.id, accept: true })}
                >
                  <Check className="h-3.5 w-3.5" strokeWidth={2} /> Accept
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={respond.isPending}
                  onClick={() => respond.mutate({ requestId: r.id, accept: false })}
                >
                  <X className="h-3.5 w-3.5" strokeWidth={1.75} /> Decline
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}

      <div>
        <h3 className="type-small font-semibold text-ink">Post an update</h3>
        <div className="mt-2 flex items-end gap-2">
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="News for followers, e.g. “Flights booked!”"
            aria-label="Post an update"
            rows={2}
            maxLength={2000}
            className="type-small flex-1 rounded-md border border-border-strong bg-surface px-3 py-2 text-ink outline-none placeholder:text-ink-3 focus:border-brand"
          />
          <button
            type="button"
            aria-label="Post update"
            disabled={!draft.trim() || postUpdate.isPending}
            onClick={() => postUpdate.mutate({ tripId, body: draft, kind: 'note' })}
            className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-pill bg-wayfare-dark text-[#fafafa] transition-all duration-fast hover:brightness-125 active:scale-95 disabled:opacity-40"
          >
            {postUpdate.isPending ? (
              <Loader2 className="h-4 w-4 animate-spin" strokeWidth={1.75} />
            ) : (
              <Send className="h-4 w-4" strokeWidth={1.75} />
            )}
          </button>
        </div>
      </div>
    </section>
  );
}

export default function PublishedTrip() {
  const { slug = '' } = useParams();
  const q = usePage(slug);

  return (
    <div className="relative min-h-[100dvh] bg-bg text-ink">
      <header className="mx-auto flex h-16 w-full max-w-[760px] items-center justify-between px-4 md:px-6">
        <Link to="/" aria-label="Wayfare home">
          <Logo />
        </Link>
        <span className="type-caption inline-flex items-center gap-1.5 rounded-pill bg-brand-soft px-2.5 py-1 font-semibold text-brand">
          <Globe2 className="h-3 w-3" strokeWidth={1.75} />
          Published trip
        </span>
      </header>

      <main className="mx-auto w-full max-w-[760px] px-4 pb-20 md:px-6">
        {q.isLoading ? (
          <div className="space-y-4" aria-label="Loading published trip">
            <div className="h-9 w-2/3 animate-pulse rounded-md bg-surface-2" />
            <div className="h-[320px] animate-pulse rounded-lg bg-surface-2" />
          </div>
        ) : q.isError || !q.data ? (
          <div className="flex flex-col items-center rounded-lg border border-border bg-surface px-6 py-16 text-center">
            <h1 className="type-h2 text-ink">This page isn’t published</h1>
            <p className="type-body mt-2 max-w-[44ch] text-ink-2">
              The link may be mistyped, or the organizer took the trip back to private.
            </p>
            <Button variant="ghost" className="mt-6" asChild>
              <Link to="/">Back to Wayfare</Link>
            </Button>
          </div>
        ) : (
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.35, ease: EASE_EXPO }}
            className="space-y-6"
          >
            <div>
              <h1 className="type-h2 text-ink">{q.data.title}</h1>
              <p className="type-small mt-1 flex flex-wrap items-center gap-2 text-ink-2">
                <CalendarDays className="h-3.5 w-3.5 text-ink-3" strokeWidth={1.75} />
                <span className="tnum">
                  {q.data.trip.startDate} → {q.data.trip.endDate}
                </span>
                · {q.data.trip.destination} · by {q.data.ownerName}
              </p>
              {q.data.summary && <p className="type-body mt-2 text-ink-2">{q.data.summary}</p>}
            </div>

            {q.data.viewer.isOwner && q.data.ownerTripId != null && <OwnerPanel data={q.data} tripId={q.data.ownerTripId} />}
            <JoinPanel slug={slug} data={q.data} />
            <UpdatesFeed updates={q.data.updates} />
            <Itinerary data={q.data} />
          </motion.div>
        )}
      </main>
      <Toaster position="bottom-center" />
    </div>
  );
}
