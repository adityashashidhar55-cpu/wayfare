import { Link } from 'react-router';
import { motion } from 'framer-motion';
import { Settings2, Sparkles } from 'lucide-react';
import type { Preference, User } from '@contracts/types';
import { EASE_EXPO, SPRING_PIN_POP } from '@/lib/motion';
import { handleFor } from '@/components/trips/utils';

/**
 * Identity header (profile §S1): squircle avatar, name, handle, archetype
 * chip, member meta. Settings icon scrolls to the settings section.
 */
export function IdentityHeader({ user, pref }: { user: User; pref?: Preference }) {
  const since = user.createdAt ? new Date(user.createdAt).getFullYear() : new Date().getFullYear();
  const initials = (user.name ?? 'T')
    .split(' ')
    .map((p) => p[0])
    .filter(Boolean)
    .slice(0, 2)
    .join('')
    .toUpperCase();

  return (
    <motion.header
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.45, ease: EASE_EXPO }}
      className="grid items-center gap-6 rounded-xl border border-border bg-surface p-6 shadow-sm md:grid-cols-[96px_1fr_auto] md:p-10"
    >
      {/* Squircle avatar (radius 24, editorial, not circular) */}
      {user.avatar ? (
        <img
          src={user.avatar}
          alt={user.name ?? 'Your photo'}
          className="photo h-24 w-24 rounded-[24px] object-cover shadow-sm"
        />
      ) : (
        <span
          aria-label={user.name ?? 'Traveler'}
          className="flex h-24 w-24 items-center justify-center rounded-[24px] bg-brand-soft font-serif text-[32px] font-semibold text-brand shadow-sm"
        >
          {initials}
        </span>
      )}

      <div className="min-w-0">
        <h1 className="font-serif text-[28px] leading-[34px] tracking-[-0.02em] text-ink md:text-[32px] md:leading-[38px]">
          {user.name ?? 'Traveler'}
        </h1>
        <p className="type-caption mt-1 text-ink-3">{handleFor(user)}</p>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          {pref?.archetype ? (
            <motion.span
              initial={{ scale: 0.6, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              transition={{ ...SPRING_PIN_POP, delay: 0.3 }}
              className="type-small inline-flex items-center gap-1.5 rounded-pill bg-brand-soft px-3 py-1.5 font-semibold text-brand"
            >
              <Sparkles className="h-3.5 w-3.5" strokeWidth={1.75} />
              {pref.archetype}
            </motion.span>
          ) : (
            <Link
              to="/onboarding"
              className="type-small inline-flex items-center gap-1.5 rounded-pill bg-surface-2 px-3 py-1.5 font-semibold text-ink-2 transition-colors duration-fast hover:bg-brand-soft hover:text-brand"
            >
              <Sparkles className="h-3.5 w-3.5" strokeWidth={1.75} />
              Discover your travel archetype
            </Link>
          )}
          <span className="type-caption text-ink-3">Wandering since {since}</span>
        </div>
      </div>

      <div className="flex items-center gap-2 md:flex-col md:items-end">
        <a
          href="#settings"
          aria-label="Go to settings"
          className="inline-flex h-10 w-10 items-center justify-center rounded-md border border-border-strong bg-surface text-ink-2 shadow-sm transition-all duration-fast hover:-translate-y-px hover:bg-surface-2 hover:text-ink"
        >
          <Settings2 className="h-[18px] w-[18px]" strokeWidth={1.75} />
        </a>
      </div>
    </motion.header>
  );
}
