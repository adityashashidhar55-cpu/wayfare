/**
 * S6 - Profile reveal (onboarding.md): a pine ring sweeps to 100% (700ms)
 * around the ✳︎ mark, a restrained 24-dot paper confetti burst, then the
 * generated profile: archetype headline, chosen chips, CTAs.
 */
import { useEffect, useMemo, useState } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { CompassMark } from '@/components/Logo';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

const EASE_EXPO = [0.22, 1, 0.36, 1] as [number, number, number, number];
const CONFETTI_COLORS = ['var(--brand)', 'var(--ochre)', 'var(--pine)'];

/** Restrained paper-grain confetti: 24 dots burst once, gravity, 900ms, gone. */
function ConfettiBurst() {
  const dots = useMemo(
    () =>
      Array.from({ length: 24 }, (_, i) => {
        const angle = (i / 24) * Math.PI * 2 + (Math.random() - 0.5) * 0.6;
        const dist = 64 + Math.random() * 88;
        return {
          id: i,
          x: Math.cos(angle) * dist,
          y: Math.sin(angle) * dist * 0.72 + 46 + Math.random() * 28,
          size: 4 + Math.random() * 4,
          color: CONFETTI_COLORS[i % CONFETTI_COLORS.length],
          delay: Math.random() * 0.08,
        };
      }),
    [],
  );
  return (
    <div className="pointer-events-none absolute inset-0 overflow-visible" aria-hidden>
      {dots.map((d) => (
        <motion.span
          key={d.id}
          className="absolute left-1/2 top-[64px] rounded-full"
          style={{ width: d.size, height: d.size, background: d.color }}
          initial={{ x: 0, y: 0, opacity: 1, scale: 1 }}
          animate={{ x: d.x, y: d.y, opacity: 0, scale: 0.55 }}
          transition={{ duration: 0.9, delay: d.delay, ease: 'easeOut' }}
        />
      ))}
    </div>
  );
}

interface ProfileRevealProps {
  archetype: string;
  chips: string[];
  onCreateTrip: () => void;
  onExplore: () => void;
}

export default function ProfileReveal({ archetype, chips, onCreateTrip, onExplore }: ProfileRevealProps) {
  const reduced = useReducedMotion();
  const [revealed, setRevealed] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => setRevealed(true), reduced ? 120 : 950);
    return () => clearTimeout(t);
  }, [reduced]);

  // progress ring geometry (design §10.4 progress ring)
  const r = 44;
  const c = 2 * Math.PI * r;

  return (
    <div className="relative flex flex-col items-center text-center">
      {!reduced && revealed && <ConfettiBurst />}

      {/* pine ring sweeping to 100% around the ✳︎ mark */}
      <div className="relative flex h-32 w-32 items-center justify-center">
        <svg viewBox="0 0 104 104" className="absolute inset-0 h-full w-full -rotate-90">
          <circle cx={52} cy={52} r={r} fill="none" stroke="var(--border)" strokeWidth={5} />
          <motion.circle
            cx={52}
            cy={52}
            r={r}
            fill="none"
            stroke="var(--pine)"
            strokeWidth={5}
            strokeLinecap="round"
            strokeDasharray={c}
            initial={{ strokeDashoffset: c }}
            animate={{ strokeDashoffset: 0 }}
            transition={{ duration: reduced ? 0 : 0.7, ease: EASE_EXPO }}
          />
        </svg>
        <motion.span
          initial={{ scale: 0.6, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ delay: reduced ? 0 : 0.35, type: 'spring', stiffness: 500, damping: 28 }}
        >
          <CompassMark className="h-9 w-9 text-brand" />
        </motion.span>
      </div>

      <AnimatePresence>
        {revealed && (
          <motion.div
            key="profile"
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.32, ease: EASE_EXPO }}
            className="mt-5 flex flex-col items-center"
          >
            <span className="type-eyebrow text-pine">Your taste profile</span>
            <h2 className="type-h2 mt-2 text-ink">
              You&rsquo;re a <span className="serif-em text-brand">{archetype}</span>.
            </h2>

            {/* chosen styles / interests, stagger pop 60ms each */}
            <div className="mt-4 flex max-w-[440px] flex-wrap items-center justify-center gap-2">
              {chips.map((chip, i) => (
                <motion.span
                  key={chip}
                  initial={{ scale: 0.6, opacity: 0 }}
                  animate={{ scale: 1, opacity: 1 }}
                  transition={{
                    delay: 0.15 + i * 0.06,
                    type: 'spring',
                    stiffness: 500,
                    damping: 28,
                  }}
                  className={cn(
                    'inline-flex h-8 items-center rounded-pill px-3 text-[12px] font-medium',
                    i % 3 === 0 ? 'bg-brand-soft text-brand' : 'bg-surface-2 text-ink-2',
                  )}
                >
                  {chip}
                </motion.span>
              ))}
            </div>

            <p className="type-body mt-4 max-w-[44ch] text-ink-2">
              Explore, itineraries, and hidden gems are now tuned to this. You can retune anytime in
              Profile.
            </p>

            <div className="mt-6 flex w-full flex-col gap-2 sm:w-auto sm:flex-row">
              <Button size="lg" pill onClick={onCreateTrip} className="sm:min-w-[200px]">
                Create my first trip
              </Button>
              <Button size="lg" pill variant="ghost" onClick={onExplore}>
                Take me to Explore
              </Button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
