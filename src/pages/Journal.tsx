/**
 * Travel journal (/journal) - the blogs hub. "My journals" holds the user's
 * drafts + published entries; "Community" is everyone's published stories.
 * Card grid with cover (warm gradient fallback), status/source badges, and
 * relative dates. Wanderlog import lives in a modal here.
 */
import { useMemo, useState } from 'react';
import { Link } from 'react-router';
import { AnimatePresence, motion } from 'framer-motion';
import { ArrowDownToLine, Clock, Feather, Heart, Plus } from 'lucide-react';
import { trpc } from '@/providers/trpc';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { EASE_EXPO } from '@/lib/motion';
import { cn } from '@/lib/utils';
import WanderlogImport from '@/components/journal/WanderlogImport';
import type { JournalPostItem } from '@/components/journal/journal-utils';
import { excerpt, readingMinutes, relDate } from '@/components/journal/journal-utils';

type TabKey = 'mine' | 'community';

function GridSkeleton() {
  return (
    <div className="mt-6 grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
      {Array.from({ length: 3 }, (_, i) => (
        <div key={i} className="overflow-hidden rounded-lg border border-border bg-surface shadow-sm">
          <Skeleton className="aspect-[16/9] w-full rounded-none" />
          <div className="space-y-2 p-4">
            <Skeleton className="h-4 w-2/3" />
            <Skeleton className="h-3 w-full" />
            <Skeleton className="h-3 w-1/2" />
          </div>
        </div>
      ))}
    </div>
  );
}

function StatusBadges({ post }: { post: JournalPostItem }) {
  return (
    <>
      {post.status === 'draft' && (
        <span className="rounded-pill bg-ochre-soft px-2.5 py-1 text-[11px] font-semibold text-ochre shadow-sm">
          Draft
        </span>
      )}
      {post.source === 'wanderlog' && (
        <span className="inline-flex items-center gap-1 rounded-pill bg-pine-soft px-2.5 py-1 text-[11px] font-semibold text-pine shadow-sm">
          <ArrowDownToLine className="h-3 w-3" strokeWidth={1.75} />
          Imported
        </span>
      )}
    </>
  );
}

function PostCard({
  post,
  showAuthor,
  index,
}: {
  post: JournalPostItem;
  showAuthor?: boolean;
  index: number;
}) {
  const summary = excerpt(post.content);
  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.32, ease: EASE_EXPO, delay: Math.min(index, 5) * 0.04 }}
      className="h-full"
    >
      <Link
        to={`/journal/${post.id}`}
        className="group flex h-full flex-col overflow-hidden rounded-lg border border-border bg-surface shadow-sm transition-all duration-fast hover:-translate-y-1 hover:shadow-lg"
      >
        {/* cover, image or warm placeholder gradient */}
        <div className="relative aspect-[16/9] overflow-hidden bg-surface-2">
          {post.coverImage ? (
            <img
              src={post.coverImage}
              alt=""
              loading="lazy"
              className="photo h-full w-full object-cover transition-transform [transition-duration:600ms] ease-expo group-hover:scale-[1.045]"
            />
          ) : (
            <div
              className="flex h-full w-full items-center justify-center"
              style={{ background: 'linear-gradient(135deg, var(--brand-soft) 0%, var(--ochre-soft) 100%)' }}
            >
              <Feather className="h-8 w-8 text-brand/60" strokeWidth={1.5} />
            </div>
          )}
          <div className="absolute left-3 top-3 flex flex-wrap gap-1.5">
            <StatusBadges post={post} />
          </div>
          {post.likes > 0 && (
            <span className="absolute right-3 top-3 inline-flex items-center gap-1 rounded-pill bg-surface/90 px-2 py-1 text-[11px] font-semibold text-ink-2 shadow-sm backdrop-blur-sm">
              <Heart className="h-3 w-3 fill-brand text-brand" strokeWidth={1.75} />
              <span className="tnum">{post.likes}</span>
            </span>
          )}
          <span className="absolute bottom-3 right-3 inline-flex items-center gap-1 rounded-pill bg-surface/90 px-2 py-1 text-[11px] font-semibold text-ink-2 shadow-sm backdrop-blur-sm">
            <Clock className="h-3 w-3" strokeWidth={1.75} />
            {readingMinutes(post.content)} min read
          </span>
        </div>

        {/* body */}
        <div className="flex flex-1 flex-col p-4">
          <h3 className="font-serif text-[18px] font-medium leading-snug tracking-[-0.01em] text-ink">
            {post.title}
          </h3>
          <p className="type-small mt-1.5 line-clamp-2 text-ink-2">
            {summary || 'No words yet, open to start writing.'}
          </p>
          <div className="mt-auto flex items-center justify-between gap-2 pt-3">
            <span className="type-caption truncate text-ink-3">
              {showAuthor ? `${post.authorName ?? 'Traveler'} · ` : ''}
              {relDate(post.updatedAt)}
            </span>
            <span className="type-caption shrink-0 text-brand opacity-0 transition-opacity duration-fast group-hover:opacity-100">
              Read →
            </span>
          </div>
        </div>
      </Link>
    </motion.div>
  );
}

function EmptyJournal({ tab, onImport }: { tab: TabKey; onImport: () => void }) {
  return (
    <div className="mx-auto flex w-full max-w-[480px] flex-col items-center gap-4 px-6 py-16 text-center">
      <motion.img
        src="/empty-globe.svg"
        alt=""
        initial={{ opacity: 0, scale: 0.94 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 0.7, ease: EASE_EXPO }}
        className="w-[200px] max-w-[70vw]"
      />
      {tab === 'mine' ? (
        <>
          <h3 className="type-h3 text-ink">No entries yet</h3>
          <p className="type-body text-ink-2">
            Your travel writing lives here. Start a fresh entry, or pull one in from Wanderlog.
          </p>
          <div className="mt-2 flex flex-wrap items-center justify-center gap-2">
            <Button pill asChild>
              <Link to="/journal/new">
                <Plus className="h-4 w-4" strokeWidth={2} />
                Write my first entry
              </Link>
            </Button>
            <Button variant="ghost" onClick={onImport}>
              <ArrowDownToLine className="h-4 w-4" strokeWidth={1.75} />
              Import from Wanderlog
            </Button>
          </div>
        </>
      ) : (
        <>
          <h3 className="type-h3 text-ink">Nothing published yet</h3>
          <p className="type-body text-ink-2">
            Community stories appear here once travelers publish their journals, yours could be
            first.
          </p>
          <Button pill asChild className="mt-2">
            <Link to="/journal/new">
              <Plus className="h-4 w-4" strokeWidth={2} />
              Write an entry
            </Link>
          </Button>
        </>
      )}
    </div>
  );
}

export default function Journal() {
  const [tab, setTab] = useState<TabKey>('mine');
  const [importOpen, setImportOpen] = useState(false);
  const listQ = trpc.journal.list.useQuery();
  /* r27: the community feed is paginated (keyset on likes+id) - it used to
     fetch every published post on every visit. */
  const feedQ = trpc.journal.feed.useInfiniteQuery(
    { limit: 20 },
    { getNextPageParam: (last) => last.nextCursor ?? undefined },
  );

  const mine = listQ.data?.mine ?? [];
  /* Community: most-loved first, then freshest (client-side safety sort) */
  const community = useMemo(
    () =>
      (feedQ.data?.pages ?? [])
        .flatMap((p) => p.posts)
        .sort(
          (a, b) => b.likes - a.likes || new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
        ),
    [feedQ.data],
  );
  const shown = tab === 'mine' ? mine : community;
  const loading = tab === 'mine' ? listQ.isLoading : feedQ.isLoading;

  const tabs = [
    { key: 'mine' as TabKey, label: 'My journals', count: mine.length },
    { key: 'community' as TabKey, label: 'Community', count: community.length },
  ];

  return (
    <div className="mx-auto w-full max-w-[1120px] px-4 py-8 md:px-6 md:py-10">
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.32, ease: EASE_EXPO }}
      >
        {/* ---------- header ---------- */}
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="type-eyebrow text-brand">Journal</p>
            <h2 className="type-h1 mt-2 font-serif text-ink">Travel journal</h2>
            <p className="type-body mt-2 max-w-[52ch] text-ink-2">
              Field notes from the road, draft in private, publish to the community when a story
              is ready.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="secondary" onClick={() => setImportOpen(true)}>
              <ArrowDownToLine className="h-4 w-4" strokeWidth={1.75} />
              Import from Wanderlog
            </Button>
            <Button pill asChild>
              <Link to="/journal/new">
                <Plus className="h-4 w-4" strokeWidth={2} />
                New entry
              </Link>
            </Button>
          </div>
        </div>

        {/* ---------- segmented tabs ---------- */}
        <div
          className="mt-8 inline-flex rounded-pill bg-surface-2 p-1"
          role="tablist"
          aria-label="Journal feeds"
        >
          {tabs.map((t) => (
            <button
              key={t.key}
              type="button"
              role="tab"
              aria-selected={tab === t.key}
              onClick={() => setTab(t.key)}
              className={cn(
                'relative inline-flex items-center gap-1.5 rounded-pill px-4 py-1.5 text-[13px] font-semibold transition-colors duration-fast',
                tab === t.key ? 'text-ink' : 'text-ink-2 hover:text-ink',
              )}
            >
              {tab === t.key && (
                <motion.span
                  layoutId="journal-tab-pill"
                  transition={{ type: 'spring', stiffness: 400, damping: 32 }}
                  className="absolute inset-0 rounded-pill bg-surface shadow-sm"
                />
              )}
              <span className="relative z-[1]">{t.label}</span>
              <span
                className={cn(
                  'relative z-[1] rounded-pill px-1.5 text-[11px] font-semibold tnum',
                  tab === t.key ? 'bg-brand-soft text-brand' : 'bg-surface text-ink-3',
                )}
              >
                {t.count}
              </span>
            </button>
          ))}
        </div>

        {/* ---------- content ---------- */}
        {loading ? (
          <GridSkeleton />
        ) : (
          <AnimatePresence mode="wait" initial={false}>
            <motion.div
              key={tab}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -4 }}
              transition={{ duration: 0.2, ease: EASE_EXPO }}
              className="mt-6"
            >
              {shown.length === 0 ? (
                <EmptyJournal tab={tab} onImport={() => setImportOpen(true)} />
              ) : (
                <>
                  <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
                    {shown.map((post, i) => (
                      <PostCard key={post.id} post={post} showAuthor={tab === 'community'} index={i} />
                    ))}
                  </div>
                  {/* r27: the community feed is paged - pull the next page on
                      demand instead of shipping every published post at once. */}
                  {tab === 'community' && feedQ.hasNextPage && (
                    <div className="mt-8 flex justify-center">
                      <Button
                        variant="secondary"
                        onClick={() => void feedQ.fetchNextPage()}
                        disabled={feedQ.isFetchingNextPage}
                      >
                        {feedQ.isFetchingNextPage ? 'Loading…' : 'Load more stories'}
                      </Button>
                    </div>
                  )}
                </>
              )}
            </motion.div>
          </AnimatePresence>
        )}
      </motion.div>

      <WanderlogImport open={importOpen} onOpenChange={setImportOpen} />
    </div>
  );
}
