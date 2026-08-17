import { useState } from 'react';
import { motion } from 'framer-motion';
import type { TripMember } from '@contracts/types';
import { UserAvatar } from '@/components/UserAvatar';
import { cn } from '@/lib/utils';

/**
 * Avatar stack (design.md §10.4): 28px circles, surface ring, −8px overlap,
 * "+N" overflow chip. Fans out 4px per avatar on hover (200ms spring).
 * Presence ring uses each member's API-assigned presenceColor.
 */
export function AvatarStack({
  members,
  className,
  max = 3,
}: {
  members: TripMember[];
  className?: string;
  max?: number;
}) {
  const [hover, setHover] = useState(false);
  const shown = members.slice(0, max);
  const extra = members.length - shown.length;

  return (
    <span
      className={cn('inline-flex items-center', className)}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
    >
      {shown.map((m, i) => (
        <motion.span
          key={m.id}
          className={cn('relative inline-flex rounded-full', i > 0 && '-ml-2')}
          animate={{ x: hover ? i * 4 : 0 }}
          transition={{ type: 'spring', stiffness: 500, damping: 32 }}
          style={{ zIndex: i, boxShadow: m.presenceColor ? `0 0 0 2px ${m.presenceColor}` : undefined }}
          title={m.name}
        >
          <UserAvatar name={m.name} className="h-7 w-7 text-[11px]" />
        </motion.span>
      ))}
      {extra > 0 && (
        <motion.span
          animate={{ x: hover ? shown.length * 4 : 0 }}
          transition={{ type: 'spring', stiffness: 500, damping: 32 }}
          className="-ml-2 inline-flex h-7 items-center justify-center rounded-full bg-surface-2 px-1.5 text-[11px] font-semibold text-ink-2 ring-2 ring-surface"
          style={{ zIndex: shown.length }}
        >
          +{extra}
        </motion.span>
      )}
    </span>
  );
}
