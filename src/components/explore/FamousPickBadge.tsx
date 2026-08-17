/**
 * FamousPickBadge (r15-eats) - the "★ Famous pick" star shown on eateries
 * flagged famousEatery (deterministic per-city backfill: verdict='must-see'
 * or top 8% by rating, min 4.3, cap 15/city). Warm ochre/gold - same pill
 * language as the "Hidden gem" badge.
 */
import { Star } from 'lucide-react';
import { cn } from '@/lib/utils';

export default function FamousPickBadge({ className }: { className?: string }) {
  return (
    <span
      title="One of the most famous eateries in town, a popular pick"
      className={cn(
        'inline-flex items-center gap-1 rounded-pill bg-ochre-soft px-2.5 py-1 text-[11px] font-semibold text-ochre',
        className,
      )}
    >
      <Star className="h-3 w-3 fill-ochre text-ochre" strokeWidth={1.75} />
      Famous pick
    </span>
  );
}
