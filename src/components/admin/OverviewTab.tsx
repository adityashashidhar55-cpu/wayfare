import { BookOpenCheck, Ghost, Heart, Hourglass, MapPin, NotebookPen, Route, Users, Wallet } from 'lucide-react';
import { trpc } from '@/providers/trpc';
import { CountUp } from '@/components/profile/CountUp';
import { cn } from '@/lib/utils';

function StatCard({
  icon: Icon,
  label,
  value,
  caption,
  className,
  children,
  onClick,
}: {
  icon: React.ComponentType<{ className?: string; strokeWidth?: number }>;
  label: string;
  value: number;
  caption?: string;
  className?: string;
  children?: React.ReactNode;
  /** When set, the card renders as a button (e.g. linking to another tab). */
  onClick?: () => void;
}) {
  const body = (
    <>
      <span className="flex items-center gap-2">
        <Icon className="h-4 w-4 text-ink-3" strokeWidth={1.75} />
        <span className="type-eyebrow text-ink-3">{label}</span>
      </span>
      <CountUp value={value} className="type-numeral tnum mt-3 block text-[28px] leading-[34px] text-ink" />
      {caption && <span className="type-caption mt-1 block text-ink-3">{caption}</span>}
      {children}
    </>
  );
  const classes = cn('rounded-xl border border-border bg-surface p-6 shadow-sm', className);
  if (onClick) {
    return (
      <button
        type="button"
        onClick={onClick}
        className={cn(
          classes,
          'block w-full text-left transition-all duration-fast hover:-translate-y-px hover:border-ochre hover:shadow-md',
        )}
      >
        {body}
      </button>
    );
  }
  return <div className={classes}>{body}</div>;
}

function OverviewSkeleton() {
  return (
    <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
      {[0, 1, 2, 3, 4, 5, 6, 7].map((i) => (
        <div key={i} className="h-[128px] animate-pulse rounded-xl border border-border bg-surface" />
      ))}
    </div>
  );
}

/** Overview bento (§10.4 stat blocks): platform-wide counts, per-source place mix. */
export function OverviewTab({ onShowReview }: { onShowReview?: () => void }) {
  const statsQ = trpc.admin.stats.useQuery();

  if (statsQ.isLoading) return <OverviewSkeleton />;
  const s = statsQ.data;
  if (!s) {
    return <p className="type-small text-ink-2">Couldn’t load stats, try refreshing.</p>;
  }

  const sources = [
    { label: 'Curated', value: s.placesCurated, chip: 'bg-brand-soft text-brand' },
    { label: 'OpenStreetMap', value: s.placesOsm, chip: 'bg-pine-soft text-pine' },
    { label: 'Traveler-added', value: s.placesUser, chip: 'bg-ochre-soft text-ochre' },
  ];

  return (
    <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
      <StatCard
        icon={Users}
        label="Travelers"
        value={s.users}
        caption="Signed-in explorers (guests excluded)"
        className="col-span-2"
      />
      <StatCard icon={Route} label="Trips" value={s.trips} caption={`${s.stops.toLocaleString()} stops planned`} />
      <StatCard icon={NotebookPen} label="Stories" value={s.posts} caption="Journal entries, drafts included" />

      <StatCard icon={MapPin} label="Places" value={s.placesTotal} caption="In the atlas" className="col-span-2">
        <div className="mt-4 flex flex-wrap gap-2">
          {sources.map((src) => (
            <span
              key={src.label}
              className={cn('type-caption inline-flex items-center gap-1.5 rounded-pill px-2.5 py-1', src.chip)}
            >
              <span className="type-numeral tnum">{src.value.toLocaleString()}</span>
              {src.label}
            </span>
          ))}
        </div>
      </StatCard>
      <StatCard icon={Heart} label="Likes" value={s.likes} caption="Across all stories" />
      <StatCard icon={Wallet} label="Expenses" value={s.expenses} caption="Logged across trips" />

      <StatCard icon={BookOpenCheck} label="Reservations" value={s.reservations} caption="Booked and tracked" />
      <StatCard icon={Ghost} label="Guest sessions" value={s.guests} caption="Ephemeral demo accounts" />

      <StatCard
        icon={Hourglass}
        label="Awaiting review"
        value={s.pendingPlaces}
        caption="Traveler-submitted places, open the queue"
        onClick={onShowReview}
        className={s.pendingPlaces > 0 ? 'border-ochre' : undefined}
      />
    </div>
  );
}
