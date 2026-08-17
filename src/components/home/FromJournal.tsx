/**
 * Landing "From the journal" (after testimonials) - eyebrow, Fraunces
 * headline, and the 3 latest published community stories as cards linking to
 * /journal/:id. Data comes from the public journal.feed procedure; if the
 * feed can't load (signed out, API down) the section quietly skips itself.
 */
import { useMemo } from 'react';
import { Link } from 'react-router';
import { ArrowRight, Clock, Feather, Heart } from 'lucide-react';
import { trpc } from '@/providers/trpc';
import { Eyebrow, Reveal } from '@/components/home/Reveal';
import type { JournalPostItem } from '@/components/journal/journal-utils';
import { excerpt, readingMinutes } from '@/components/journal/journal-utils';

function StoryCard({ post }: { post: JournalPostItem }) {
  return (
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
      </div>

      <div className="flex flex-1 flex-col p-5">
        <h3 className="font-serif text-[18px] font-medium leading-snug tracking-[-0.01em] text-ink transition-colors duration-fast group-hover:text-brand">
          {post.title}
        </h3>
        <p className="type-small mt-1.5 line-clamp-2 text-ink-2">{excerpt(post.content)}</p>
        <div className="mt-auto flex items-center justify-between gap-2 pt-4">
          <span className="type-caption truncate text-ink-3">{post.authorName ?? 'Traveler'}</span>
          <span className="flex shrink-0 items-center gap-2.5">
            <span className="type-caption inline-flex items-center gap-1 text-ink-3">
              <Clock className="h-3 w-3" strokeWidth={1.75} />
              {readingMinutes(post.content)} min
            </span>
            {post.likes > 0 && (
              <span className="type-caption inline-flex items-center gap-1 text-ink-3">
                <Heart className="h-3 w-3 fill-brand text-brand" strokeWidth={1.75} />
                <span className="tnum">{post.likes}</span>
              </span>
            )}
          </span>
        </div>
      </div>
    </Link>
  );
}

export default function FromJournal() {
  /* r27: ask for one page, not the whole feed - this strip shows three cards. */
  const feedQ = trpc.journal.feed.useQuery({ limit: 12 }, { retry: false });

  /* Latest three published stories (feed arrives like-sorted - re-sort by date). */
  const posts = useMemo(
    () =>
      [...(feedQ.data?.posts ?? [])]
        .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
        .slice(0, 3),
    [feedQ.data],
  );

  if (feedQ.isLoading || feedQ.isError || posts.length === 0) return null;

  return (
    <section className="mx-auto max-w-[1200px] px-6 py-24 md:py-32">
      <Reveal className="mx-auto mb-12 max-w-[640px] text-center">
        <Eyebrow>From the journal</Eyebrow>
        <h2 className="type-display mt-3 text-ink">Stories from the road</h2>
        <p className="type-body-l mt-4 text-ink-2">
          Field notes, photo diaries, and the trips that inspired them, straight from the Wayfare
          community.
        </p>
      </Reveal>

      <div className="grid grid-cols-1 gap-6 md:grid-cols-3">
        {posts.map((post, i) => (
          <Reveal key={post.id} delay={0.08 * i} className="h-full">
            <StoryCard post={post} />
          </Reveal>
        ))}
      </div>

      <Reveal className="mt-10 text-center" delay={0.28}>
        <Link
          to="/journal"
          className="type-body group inline-flex items-center gap-1.5 font-medium text-brand transition-colors hover:text-brand-strong"
        >
          Read the journal
          <ArrowRight
            className="h-4 w-4 transition-transform duration-fast group-hover:translate-x-0.5"
            strokeWidth={1.75}
          />
        </Link>
      </Reveal>
    </section>
  );
}
