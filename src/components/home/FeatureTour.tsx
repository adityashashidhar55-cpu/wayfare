import { useEffect, useState } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import {
  MiniBudget,
  MiniFriends,
  MiniGetaways,
  MiniImport,
  MiniItinerary,
  MiniMapChip,
} from '@/components/home/minis';
import { EASE_EXPO } from '@/lib/motion';
import { cn } from '@/lib/utils';

/**
 * The quick feature tour: an ambient auto-cycling montage of the app's
 * features, restored into the hero start view (r20). Slides crossfade every
 * ~3.2s, pause on hover/focus, and respect prefers-reduced-motion (no
 * auto-cycling; the dots stay manually clickable).
 */

const SLIDE_MS = 3200;

const SLIDES: { caption: string; body: string; node: React.ReactNode }[] = [
  {
    caption: 'Itineraries that build themselves',
    body: 'Drop places in. Days and walk times sort themselves.',
    node: <MiniItinerary className="w-[290px]" />,
  },
  {
    caption: 'Maps that stay out of your way',
    body: 'A quiet canvas where pins and routes do the talking.',
    node: <MiniMapChip />,
  },
  {
    caption: 'Budgets that split fairly',
    body: 'Expenses categorized, converted, and squared up.',
    node: <MiniBudget />,
  },
  {
    caption: 'Getaways near you',
    body: 'Weekend ideas within a short drive, ready to plan.',
    node: <MiniGetaways className="w-[290px]" />,
  },
  {
    caption: 'Import from social',
    body: 'Paste a link and it lands on your map as a pin.',
    node: <MiniImport />,
  },
  {
    caption: 'Plan with friends',
    body: 'Vote on stops together, decide in one place.',
    node: <MiniFriends />,
  },
];

export default function FeatureTour({ className }: { className?: string }) {
  const reduced = useReducedMotion();
  const [slide, setSlide] = useState(0);
  const [paused, setPaused] = useState(false);

  useEffect(() => {
    if (reduced || paused) return;
    const id = window.setInterval(() => setSlide((s) => (s + 1) % SLIDES.length), SLIDE_MS);
    return () => window.clearInterval(id);
  }, [reduced, paused]);

  const active = SLIDES[slide];

  return (
    <div
      className={cn(
        'overflow-hidden rounded-[28px] border border-black/[0.08] bg-white/70 shadow-[0_8px_40px_rgba(0,0,0,0.08)] backdrop-blur-[20px]',
        className,
      )}
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocusCapture={() => setPaused(true)}
      onBlurCapture={() => setPaused(false)}
      role="region"
      aria-roledescription="carousel"
      aria-label="Wayfare feature tour"
    >
      <div className="flex items-center justify-between border-b border-black/[0.06] px-5 py-3">
        <span className="type-eyebrow text-wayfare-muted">The quick tour</span>
        <div className="flex items-center gap-1.5">
          {SLIDES.map((s, i) => (
            <button
              key={s.caption}
              type="button"
              aria-label={`Show feature ${i + 1}: ${s.caption}`}
              aria-current={i === slide}
              onClick={() => setSlide(i)}
              className={cn(
                'h-1.5 rounded-full transition-all duration-base',
                i === slide ? 'w-6 bg-wayfare-dark' : 'w-1.5 bg-black/15 hover:bg-black/30',
              )}
            />
          ))}
        </div>
      </div>

      {/* Stage: crossfading product minis */}
      <div className="relative flex h-[220px] items-center justify-center overflow-hidden bg-[#fafafa]">
        <AnimatePresence mode="wait">
          <motion.div
            key={slide}
            initial={reduced ? { opacity: 0 } : { opacity: 0, y: 16, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={reduced ? { opacity: 0 } : { opacity: 0, y: -12, scale: 0.98 }}
            transition={{ duration: 0.45, ease: EASE_EXPO }}
            className="flex items-center justify-center"
          >
            {active.node}
          </motion.div>
        </AnimatePresence>
      </div>

      {/* Caption */}
      <div className="border-t border-black/[0.06] px-5 py-4">
        <div aria-live="polite">
          <AnimatePresence mode="wait">
            <motion.div
              key={slide}
              initial={{ opacity: 0, y: reduced ? 0 : 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: reduced ? 0 : -6 }}
              transition={{ duration: 0.25, ease: EASE_EXPO }}
            >
              <div className="type-h4 text-wayfare-text">{active.caption}</div>
              <div className="type-small mt-0.5 min-h-[2.5em] text-wayfare-muted">{active.body}</div>
            </motion.div>
          </AnimatePresence>
        </div>
      </div>
    </div>
  );
}
