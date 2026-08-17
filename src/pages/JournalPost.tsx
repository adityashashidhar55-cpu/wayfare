/**
 * Journal reader (/journal/:id) - cover, Fraunces title, author + date,
 * rendered content paragraphs/lists, and attached places as mini cards
 * linking to Explore. Authors get an Edit button; drafts show a privacy note.
 */
import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router';
import { motion } from 'framer-motion';
import { ArrowLeft, ArrowDownToLine, CalendarDays, Clock, Heart, MapPin, PenLine, Ticket } from 'lucide-react';
import { formatMoney } from '@contracts/fx';
import { trpc } from '@/providers/trpc';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { UserAvatar } from '@/components/UserAvatar';
import { EASE_EXPO, EASE_SPRING_SOFT } from '@/lib/motion';
import { closedLabel, verdictChip } from '@/lib/place-meta';
import { cn } from '@/lib/utils';
import type { JournalPlace } from '@/components/journal/journal-utils';
import { parseContent, readingMinutes, relDate, renderInline } from '@/components/journal/journal-utils';

/** One like per browser session per post - ids of stories this browser loved. */
const LIKED_KEY = 'wayfare-liked';

function readLikedIds(): number[] {
  try {
    const raw: unknown = JSON.parse(window.localStorage.getItem(LIKED_KEY) ?? '[]');
    return Array.isArray(raw) ? raw.filter((x): x is number => typeof x === 'number') : [];
  } catch {
    return [];
  }
}

function writeLikedIds(ids: number[]) {
  try {
    window.localStorage.setItem(LIKED_KEY, JSON.stringify(ids));
  } catch {
    /* storage unavailable, the like still counts, it just won't persist */
  }
}

function PostSkeleton() {
  return (
    <div className="mx-auto w-full max-w-[760px] px-4 py-8 md:px-6 md:py-12" aria-label="Loading entry">
      <Skeleton className="h-8 w-24" />
      <Skeleton className="mt-10 h-10 w-3/4" />
      <Skeleton className="mt-4 h-4 w-56" />
      <Skeleton className="mt-8 aspect-[16/9] w-full rounded-xl" />
      <div className="mt-10 space-y-4">
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-11/12" />
        <Skeleton className="h-4 w-4/5" />
      </div>
    </div>
  );
}

function PlaceMiniCard({ place }: { place: JournalPlace }) {
  const verdict = verdictChip(place.verdict);
  const closed = closedLabel(place.closedStatus);
  return (
    <Link
      to="/explore"
      className="group flex items-center gap-3 rounded-lg border border-border bg-surface p-3 shadow-sm transition-all duration-fast hover:-translate-y-0.5 hover:shadow-md"
    >
      {place.image ? (
        <img src={place.image} alt="" loading="lazy" className="photo h-14 w-14 shrink-0 rounded-md object-cover" />
      ) : (
        <span
          className="flex h-14 w-14 shrink-0 items-center justify-center rounded-md"
          style={{ background: 'linear-gradient(135deg, var(--brand-soft), var(--ochre-soft))' }}
        >
          <MapPin className="h-5 w-5 text-brand/70" strokeWidth={1.5} />
        </span>
      )}
      <span className="min-w-0 flex-1">
        <span className="type-small block truncate font-semibold text-ink transition-colors duration-fast group-hover:text-brand">
          {place.name}
        </span>
        <span className="type-caption block truncate text-ink-3">
          {place.city}, {place.country}
        </span>
        {(verdict || closed) && (
          <span className="mt-0.5 flex flex-wrap items-center gap-1">
            {verdict && (
              <span
                className={cn('rounded-pill px-1.5 py-0.5 text-[10px] font-semibold', verdict.className)}
                title={verdict.title}
              >
                {verdict.label}
              </span>
            )}
            {closed && (
              <span className={cn('rounded-pill px-1.5 py-0.5 text-[10px] font-semibold', closed.chipClass)}>
                {closed.label}
              </span>
            )}
          </span>
        )}
        {place.feeCents != null && (
          <span
            className={cn(
              'mt-0.5 inline-flex items-center gap-1 text-[11px] font-semibold',
              place.feeCents > 0 ? 'text-ink-2' : 'text-pine',
            )}
            title={place.feeNote ?? undefined}
          >
            <Ticket className="h-3 w-3 shrink-0" strokeWidth={1.75} />
            <span className="tnum">
              {place.feeCents > 0 ? formatMoney(place.feeCents, place.feeCurrency ?? 'USD') : 'Free entry'}
            </span>
          </span>
        )}
      </span>
    </Link>
  );
}

export default function JournalPost() {
  const { id } = useParams();
  const postId = Number(id);
  const getQ = trpc.journal.get.useQuery({ id: postId }, { retry: false });
  const utils = trpc.useUtils();
  const [liked, setLiked] = useState(() => readLikedIds().includes(postId));

  /* Re-check the liked set if we navigate between posts without remounting */
  useEffect(() => {
    setLiked(readLikedIds().includes(postId));
  }, [postId]);

  const like = trpc.journal.like.useMutation({
    onSuccess: (d) => {
      utils.journal.get.setData({ id: postId }, (old) =>
        old ? { ...old, post: { ...old.post, likes: d.likes } } : old,
      );
      void utils.journal.feed.invalidate();
      void utils.journal.list.invalidate();
    },
    onError: () => {
      // roll back the optimistic like
      setLiked(false);
      writeLikedIds(readLikedIds().filter((x) => x !== postId));
      utils.journal.get.setData({ id: postId }, (old) =>
        old ? { ...old, post: { ...old.post, likes: Math.max(0, old.post.likes - 1) } } : old,
      );
    },
  });

  function onLike() {
    if (liked || like.isPending) return;
    setLiked(true);
    writeLikedIds([...readLikedIds(), postId]);
    utils.journal.get.setData({ id: postId }, (old) =>
      old ? { ...old, post: { ...old.post, likes: old.post.likes + 1 } } : old,
    );
    like.mutate({ id: postId });
  }

  if (getQ.isLoading) return <PostSkeleton />;
  if (getQ.isError || !getQ.data) {
    return (
      <div className="mx-auto flex min-h-[60dvh] w-full max-w-[460px] flex-col items-center justify-center gap-4 px-6 py-16 text-center">
        <img src="/empty-globe.svg" alt="" className="w-[200px] max-w-[70vw]" />
        <h2 className="type-h2 text-ink">We couldn’t find that entry</h2>
        <p className="type-body text-ink-2">It may be a private draft, or the link is stale.</p>
        <Button pill asChild>
          <Link to="/journal">Back to the journal</Link>
        </Button>
      </div>
    );
  }

  const { post, places, isAuthor } = getQ.data;
  const blocks = parseContent(post.content ?? '');
  const firstParagraph = blocks.findIndex((b) => b.kind === 'p');

  return (
    <div className="mx-auto w-full max-w-[760px] px-4 py-8 md:px-6 md:py-12">
      <motion.article
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.32, ease: EASE_EXPO }}
      >
        {/* ---------- top row ---------- */}
        <div className="flex items-center justify-between gap-3">
          <Button variant="ghost" size="sm" asChild>
            <Link to="/journal">
              <ArrowLeft className="h-4 w-4" strokeWidth={1.75} />
              Journal
            </Link>
          </Button>
          {isAuthor && (
            <Button variant="secondary" size="sm" asChild>
              <Link to={`/journal/${post.id}/edit`}>
                <PenLine className="h-4 w-4" strokeWidth={1.75} />
                Edit
              </Link>
            </Button>
          )}
        </div>

        {/* ---------- header ---------- */}
        <p className="type-eyebrow mt-8 text-brand">Travel journal</p>
        <h2 className="type-h1 mt-3 font-serif text-ink">{post.title}</h2>
        <div className="mt-4 flex flex-wrap items-center gap-x-3 gap-y-2">
          <span className="flex items-center gap-2">
            <UserAvatar name={post.authorName} avatar={post.authorAvatar} className="h-6 w-6 text-[10px]" />
            <span className="type-small font-semibold text-ink-2">{post.authorName ?? 'Traveler'}</span>
          </span>
          <span aria-hidden className="text-ink-3">
            ·
          </span>
          <span className="type-caption inline-flex items-center gap-1.5 text-ink-3">
            <CalendarDays className="h-3.5 w-3.5" strokeWidth={1.75} />
            {relDate(post.updatedAt)}
          </span>
          <span aria-hidden className="text-ink-3">
            ·
          </span>
          <span className="type-caption inline-flex items-center gap-1.5 text-ink-3">
            <Clock className="h-3.5 w-3.5" strokeWidth={1.75} />
            {readingMinutes(post.content)} min read
          </span>
          {post.status === 'draft' && isAuthor && (
            <span className="rounded-pill bg-ochre-soft px-2.5 py-1 text-[11px] font-semibold text-ochre">
              Draft, only you can see this
            </span>
          )}
        </div>
        {post.source === 'wanderlog' && (
          <p className="type-caption mt-3 inline-flex items-center gap-1.5 text-ink-3">
            <ArrowDownToLine className="h-3.5 w-3.5" strokeWidth={1.75} />
            Imported from{' '}
            {post.sourceUrl ? (
              <a
                href={post.sourceUrl}
                target="_blank"
                rel="noreferrer"
                className="text-brand underline decoration-brand/40 underline-offset-2 transition-colors duration-fast hover:decoration-brand"
              >
                Wanderlog
              </a>
            ) : (
              'Wanderlog'
            )}
          </p>
        )}

        {/* ---------- cover ---------- */}
        {post.coverImage && (
          <div className="mt-8 overflow-hidden rounded-xl border border-border shadow-md">
            <img src={post.coverImage} alt="" className="photo aspect-[16/9] w-full object-cover" />
          </div>
        )}

        {/* ---------- body ---------- */}
        <div className="mt-10 space-y-6">
          {blocks.length === 0 ? (
            <p className="type-body-l italic text-ink-3">This entry has no words yet.</p>
          ) : (
            blocks.map((b, i) => {
              if (b.kind === 'h2') {
                return (
                  <h3
                    key={i}
                    className="max-w-prose66 font-serif text-[26px] font-medium leading-snug tracking-[-0.02em] text-ink"
                  >
                    {renderInline(b.text)}
                  </h3>
                );
              }
              if (b.kind === 'p') {
                return (
                  <p
                    key={i}
                    className={cn(
                      'type-body-l max-w-prose66 text-ink',
                      /* drop cap: Fraunces, ~3-line cap, clay (design.md §2/§4) */
                      i === firstParagraph &&
                        'first-letter:float-left first-letter:mr-3 first-letter:mt-[0.4rem] first-letter:font-serif first-letter:text-[84px] first-letter:font-medium first-letter:leading-[0.8] first-letter:text-brand',
                    )}
                  >
                    {renderInline(b.text)}
                  </p>
                );
              }
              return (
                <ul key={i} className="max-w-prose66 space-y-2.5">
                  {b.items.map((item, j) => (
                    <li key={j} className="type-body flex gap-2.5 text-ink">
                      <span className="mt-[9px] h-1.5 w-1.5 shrink-0 rounded-full bg-brand" />
                      <span>{renderInline(item)}</span>
                    </li>
                  ))}
                </ul>
              );
            })
          )}
        </div>

        {/* ---------- gallery ---------- */}
        {post.gallery && post.gallery.length > 0 && (
          <section className="mt-12" aria-label="Photo gallery">
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              {post.gallery.map((url, i) => (
                <div
                  key={`${url}-${i}`}
                  className="group overflow-hidden rounded-lg border border-border bg-surface-2 shadow-sm"
                >
                  <img
                    src={url}
                    alt=""
                    loading="lazy"
                    className="photo aspect-[4/3] w-full object-cover transition-transform [transition-duration:600ms] ease-expo group-hover:scale-[1.045]"
                  />
                </div>
              ))}
            </div>
          </section>
        )}

        {/* ---------- like ---------- */}
        <div className="mt-12 flex flex-wrap items-center gap-3 border-t border-border pt-8">
          <motion.button
            type="button"
            onClick={onLike}
            disabled={liked}
            aria-pressed={liked}
            aria-label={liked ? 'You liked this story' : 'Like this story'}
            whileTap={liked ? undefined : { scale: 0.97 }}
            className={cn(
              'inline-flex h-10 items-center gap-2 rounded-pill border px-4 text-[13px] font-semibold transition-all duration-fast',
              liked
                ? 'border-brand bg-brand text-brand-ink shadow-sm'
                : 'border-border-strong bg-surface text-ink-2 shadow-sm hover:-translate-y-px hover:bg-surface-2 hover:text-ink hover:shadow-md',
            )}
          >
            <motion.span
              initial={false}
              animate={liked ? { scale: [1, 1.4, 1] } : { scale: 1 }}
              transition={{ duration: 0.4, ease: EASE_SPRING_SOFT }}
              className="inline-flex"
            >
              <Heart className={cn('h-[18px] w-[18px]', liked && 'fill-current')} strokeWidth={1.75} />
            </motion.span>
            <span className="tnum">{post.likes}</span>
          </motion.button>
          <p className="type-caption text-ink-3">
            {liked ? 'Thanks, this story felt the love.' : 'Enjoyed this story? Leave a like.'}
          </p>
        </div>

        {/* ---------- attached places ---------- */}
        {places.length > 0 && (
          <section className="mt-12 border-t border-border pt-8" aria-label="Places in this story">
            <h3 className="type-h3 text-ink">Places in this story</h3>
            <div className="mt-5 grid grid-cols-1 gap-3 sm:grid-cols-2">
              {places.map((p) => (
                <PlaceMiniCard key={p.id} place={p} />
              ))}
            </div>
          </section>
        )}
      </motion.article>
    </div>
  );
}
