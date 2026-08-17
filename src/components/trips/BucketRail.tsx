import { Link } from 'react-router';
import { motion } from 'framer-motion';
import { ArrowRight, Bookmark, MapPin } from 'lucide-react';
import { toast } from 'sonner';
import type { BucketListItem } from '@contracts/types';
import { trpc } from '@/providers/trpc';
import { EASE_EXPO } from '@/lib/motion';
import { thumbFor } from '@/components/trips/utils';

const RAIL_MASK =
  'linear-gradient(90deg, transparent, black 48px, black calc(100% - 48px), transparent)';

/**
 * Bucket-list rail (dashboard §S4): horizontal snap-scroll of 200×240 cards,
 * edge fade masks, bookmark wiggle (click to un-save), "Plan a trip here"
 * hover quick-action.
 */
export function BucketRail({
  items,
  loading,
  onPlan,
}: {
  items: BucketListItem[];
  loading?: boolean;
  onPlan: (item: BucketListItem) => void;
}) {
  const utils = trpc.useUtils();
  const removeBucket = trpc.explore.removeBucket.useMutation({
    onSuccess: () => {
      utils.explore.bucketList.invalidate();
      toast.success('Removed from bucket list');
    },
    onError: (e) => toast.error(e.message),
  });
  return (
    <section aria-label="Bucket list">
      <div className="mb-5 flex items-end justify-between gap-4">
        <div className="flex items-baseline gap-3">
          <h2 className="type-h2 text-ink">Bucket list</h2>
          <span className="type-small text-ink-3 tnum">{items.length} {items.length === 1 ? 'place' : 'places'} saved</span>
        </div>
        <Link
          to="/profile#bucket"
          className="type-small inline-flex items-center gap-1 font-semibold text-brand transition-colors duration-fast hover:text-brand-strong"
        >
          Manage <ArrowRight className="h-3.5 w-3.5" strokeWidth={2} />
        </Link>
      </div>

      {loading ? (
        <div className="flex gap-4 overflow-hidden">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="h-[240px] w-[200px] shrink-0 animate-pulse rounded-lg bg-surface-2" />
          ))}
        </div>
      ) : items.length === 0 ? (
        <Link
          to="/explore"
          className="flex items-center gap-4 rounded-lg border border-dashed border-border-strong bg-surface px-5 py-4 transition-colors duration-fast hover:bg-surface-2"
        >
          <span className="inline-flex h-10 w-10 items-center justify-center rounded-md bg-brand-soft text-brand">
            <Bookmark className="h-[18px] w-[18px]" strokeWidth={1.75} />
          </span>
          <span>
            <span className="type-small block text-ink">Nothing saved yet</span>
            <span className="type-caption block text-ink-3">Save places from Explore with the bookmark.</span>
          </span>
        </Link>
      ) : (
        <div
          className="-mx-1 overflow-x-auto px-1 pb-2 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
          style={{ maskImage: RAIL_MASK, WebkitMaskImage: RAIL_MASK }}
        >
          <div className="flex w-max snap-x snap-mandatory gap-4">
            {items.map((item, i) => (
              <motion.article
                key={item.id}
                initial={{ opacity: 0, y: 16 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.4, ease: EASE_EXPO, delay: 0.06 * i }}
                whileHover={{ y: -4 }}
                className="group relative h-[240px] w-[200px] shrink-0 snap-start overflow-hidden rounded-lg border border-border bg-surface shadow-sm transition-shadow duration-base hover:shadow-lg"
              >
                <div className="relative h-[132px] overflow-hidden">
                  <img
                    src={item.image ?? thumbFor(item.name)}
                    alt=""
                    style={{ transition: 'transform 600ms var(--ease-expo)' }}
                    className="photo h-full w-full object-cover group-hover:scale-[1.045]"
                  />
                  {/* bookmark wiggle, click to un-save */}
                  <motion.button
                    type="button"
                    aria-label={`Remove ${item.name} from bucket list`}
                    title="Remove from bucket list"
                    disabled={removeBucket.isPending}
                    onClick={() => removeBucket.mutate({ id: item.id })}
                    className="absolute right-2.5 top-2.5 inline-flex h-7 w-7 items-center justify-center rounded-md bg-white/70 text-brand backdrop-blur-md transition-colors hover:bg-white/90 disabled:opacity-50"
                    whileHover={{ rotate: [0, -6, 5, 0] }}
                    transition={{ duration: 0.45 }}
                  >
                    <Bookmark className="h-3.5 w-3.5" strokeWidth={1.75} fill="currentColor" />
                  </motion.button>
                  {/* hover quick action */}
                  <button
                    type="button"
                    onClick={() => onPlan(item)}
                    className="type-caption absolute inset-x-3 bottom-2.5 translate-y-2 rounded-pill bg-brand py-1.5 font-semibold text-brand-ink opacity-0 shadow-md transition-all duration-base ease-expo hover:bg-brand-strong group-hover:translate-y-0 group-hover:opacity-100"
                  >
                    Plan a trip here
                  </button>
                </div>
                <div className="px-3.5 pt-3">
                  <h4 className="truncate text-[14px] font-semibold leading-[20px] text-ink">{item.name}</h4>
                  <p className="type-caption mt-1 inline-flex items-center gap-1 text-ink-3">
                    <MapPin className="h-3 w-3" strokeWidth={1.75} />
                    <span className="truncate">{item.country ?? 'Anywhere'}</span>
                  </p>
                </div>
              </motion.article>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}
