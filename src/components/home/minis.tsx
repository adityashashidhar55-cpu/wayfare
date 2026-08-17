import { useEffect, useState } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { ArrowDown, Check, GripVertical, Link2, MapPin as MapPinIcon, Users } from 'lucide-react';
import { cn } from '@/lib/utils';

/* ------------------------------------------------------------------ */
/* Shared mini visuals - code-built product mocks used in the hero     */
/* collage and the "Watch 90s tour" montage.                            */
/* ------------------------------------------------------------------ */

const STOPS = ['Kiyomizu-dera', '% Arabica', 'Fushimi Inari'];
const WALK = ['12 min', '18 min'];

/**
 * Day-2 Kyoto itinerary mini-card. Auto-reorders every 5s: the last stop
 * glides to position 2 with a layout spring and badges renumber - a
 * self-playing demo of drag & drop.
 */
export function MiniItinerary({ className }: { className?: string }) {
  const reduced = useReducedMotion();
  const [order, setOrder] = useState([0, 1, 2]);

  useEffect(() => {
    if (reduced) return;
    const id = window.setInterval(() => {
      setOrder((o) => (o[1] === 1 ? [o[0], o[2], o[1]] : [o[0], o[2], o[1]]));
    }, 5000);
    return () => window.clearInterval(id);
  }, [reduced]);

  return (
    <div className={cn('glass rounded-lg border border-border p-4 shadow-md', className)}>
      <div className="mb-3 flex items-center justify-between">
        <span className="type-caption text-ink-3">DAY 2 · KYOTO</span>
        <span className="type-caption rounded-pill bg-brand-soft px-2 py-0.5 text-brand">3 stops</span>
      </div>
      <div className="space-y-1.5">
        {order.map((stopIdx, position) => (
          <motion.div
            key={stopIdx}
            layout="position"
            transition={{ type: 'spring', stiffness: 380, damping: 30 }}
            className="relative"
          >
            <div className="flex items-center gap-2.5 rounded-md border border-border/60 bg-surface px-2.5 py-2">
              <GripVertical className="h-3.5 w-3.5 shrink-0 text-ink-3" strokeWidth={1.75} />
              <span className="relative flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-full bg-brand">
                <AnimatePresence mode="popLayout" initial={false}>
                  <motion.span
                    key={position}
                    initial={{ opacity: 0, y: 4 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -4 }}
                    transition={{ duration: 0.15 }}
                    className="font-serif text-[12px] font-semibold leading-none text-white"
                  >
                    {position + 1}
                  </motion.span>
                </AnimatePresence>
              </span>
              <span className="type-small flex-1 truncate text-ink">{STOPS[stopIdx]}</span>
              {position > 0 && (
                <span className="type-caption shrink-0 rounded-pill bg-surface-2 px-1.5 py-0.5 text-ink-3">
                  {WALK[position - 1]}
                </span>
              )}
            </div>
          </motion.div>
        ))}
      </div>
    </div>
  );
}

/** Abstract map chip: celadon water, roads, two day pins, marching route. */
export function MiniMapChip({ className }: { className?: string }) {
  return (
    <div className={cn('glass relative h-[160px] w-[200px] overflow-hidden rounded-lg border border-border shadow-md', className)}>
      <svg viewBox="0 0 200 160" className="absolute inset-0 h-full w-full" aria-hidden="true">
        {/* water */}
        <path d="M-10 110 C40 90 60 130 110 118 C160 106 190 130 215 118 L215 170 L-10 170 Z" fill="#7C8DA6" fillOpacity="0.22" />
        {/* parks */}
        <ellipse cx="52" cy="44" rx="26" ry="16" fill="#44604F" fillOpacity="0.12" />
        {/* roads */}
        <g stroke="#8A8175" strokeOpacity="0.4" strokeWidth="3" fill="none" strokeLinecap="round">
          <path d="M-6 70 C50 60 120 84 206 60" />
          <path d="M30 -6 C40 40 34 90 22 130" />
          <path d="M120 -6 C112 40 128 90 150 130" />
        </g>
        <g stroke="#FFFFFF" strokeOpacity="0.85" strokeWidth="1.4" fill="none" strokeLinecap="round">
          <path d="M-6 70 C50 60 120 84 206 60" />
          <path d="M30 -6 C40 40 34 90 22 130" />
          <path d="M120 -6 C112 40 128 90 150 130" />
        </g>
        {/* route */}
        <path
          d="M58 52 C86 66 104 74 138 88"
          fill="none"
          stroke="#BC5934"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeDasharray="6 8"
          className="animate-route-march"
        />
      </svg>
      {/* pins */}
      <MapPin n={1} color="#BC5934" className="left-[46px] top-[36px]" />
      <MapPin n={2} color="#44604F" className="left-[126px] top-[72px]" />
      {/* optimized tag */}
      <span className="type-caption absolute bottom-2 right-2 inline-flex items-center gap-1 rounded-pill bg-pine-soft px-2 py-0.5 text-pine">
        <Check className="h-3 w-3" strokeWidth={2.5} />
        Optimized
      </span>
    </div>
  );
}

export function MapPin({ n, color, className }: { n: number; color: string; className?: string }) {
  return (
    <span
      className={cn(
        'absolute flex h-[26px] w-[26px] -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full shadow-md ring-2 ring-surface',
        className,
      )}
      style={{ backgroundColor: color }}
    >
      <span className="font-serif text-[12px] font-semibold leading-none text-white">{n}</span>
    </span>
  );
}

const DONUT_R = 20;
const DONUT_C = 2 * Math.PI * DONUT_R;
const DONUT = (() => {
  let acc = 0;
  return [
    { color: '#C97F45', frac: 0.4 }, // food
    { color: '#7C8DA6', frac: 0.28 }, // lodging
    { color: '#6E9A8B', frac: 0.2 }, // transport
    { color: '#A86B8C', frac: 0.12 }, // activities
  ].map((s) => {
    const seg = { ...s, dash: `${s.frac * DONUT_C} ${DONUT_C}`, offset: -acc * DONUT_C };
    acc += s.frac;
    return seg;
  });
})();

/** Budget mini-card: today's spend + 4-segment donut + within-budget note. */
export function MiniBudget({ className }: { className?: string }) {
  return (
    <div className={cn('glass flex items-center gap-4 rounded-lg border border-border p-4 shadow-md', className)}>
      <svg viewBox="0 0 56 56" className="h-14 w-14 -rotate-90" aria-hidden="true">
        <circle cx="28" cy="28" r={DONUT_R} fill="none" stroke="var(--border)" strokeWidth="8" />
        {DONUT.map((s) => (
          <circle
            key={s.color}
            cx="28"
            cy="28"
            r={DONUT_R}
            fill="none"
            stroke={s.color}
            strokeWidth="8"
            strokeDasharray={s.dash}
            strokeDashoffset={s.offset}
          />
        ))}
      </svg>
      <div>
        <div className="type-caption text-ink-3">TODAY</div>
        <div className="type-numeral text-[22px] leading-7 text-ink">¥9,400</div>
        <div className="type-caption mt-0.5 inline-flex items-center gap-1 text-pine">
          <Check className="h-3 w-3" strokeWidth={2.5} />
          within budget
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* r20: extra minis so the hero feature tour covers the whole app.     */
/* Same visual language as above: soft borders, muted tones, tiny type.*/
/* ------------------------------------------------------------------ */

const GETAWAYS = [
  { name: 'Blue Ridge cabins', drive: '2h 10m' },
  { name: 'Hudson Valley', drive: '1h 45m' },
  { name: 'Cape Ann', drive: '55 min' },
];

/** Getaways mini-card: nearby weekend ideas with drive times. */
export function MiniGetaways({ className }: { className?: string }) {
  return (
    <div className={cn('glass rounded-lg border border-border p-4 shadow-md', className)}>
      <div className="mb-3 flex items-center justify-between">
        <span className="type-caption text-ink-3">NEAR YOU · THIS WEEKEND</span>
        <span className="type-caption rounded-pill bg-brand-soft px-2 py-0.5 text-brand">3 ideas</span>
      </div>
      <div className="space-y-1.5">
        {GETAWAYS.map((g) => (
          <div
            key={g.name}
            className="flex items-center gap-2.5 rounded-md border border-border/60 bg-surface px-2.5 py-2"
          >
            <span className="flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-full bg-pine-soft">
              <MapPinIcon className="h-3 w-3 text-pine" strokeWidth={1.75} />
            </span>
            <span className="type-small flex-1 truncate text-ink">{g.name}</span>
            <span className="type-caption shrink-0 rounded-pill bg-surface-2 px-1.5 py-0.5 text-ink-3">
              {g.drive}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

/** Import mini-card: a pasted social link resolves into a map pin. */
export function MiniImport({ className }: { className?: string }) {
  return (
    <div className={cn('glass w-[272px] rounded-lg border border-border p-4 shadow-md', className)}>
      <div className="mb-3 flex items-center justify-between">
        <span className="type-caption text-ink-3">SAVED FROM SOCIAL</span>
        <span className="type-caption rounded-pill bg-brand-soft px-2 py-0.5 text-brand">import</span>
      </div>
      <div className="flex items-center gap-2.5 rounded-md border border-border/60 bg-surface px-2.5 py-2">
        <span className="flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-full bg-surface-2">
          <Link2 className="h-3 w-3 text-ink-3" strokeWidth={1.75} />
        </span>
        <span className="type-small flex-1 truncate text-ink-2">instagram.com/reel/Cx4…</span>
      </div>
      <div className="flex justify-center py-1" aria-hidden="true">
        <ArrowDown className="h-3.5 w-3.5 text-ink-3" strokeWidth={1.75} />
      </div>
      <div className="flex items-center gap-2.5 rounded-md border border-brand/30 bg-brand-soft/40 px-2.5 py-2">
        <span className="flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-full bg-brand">
          <MapPinIcon className="h-3 w-3 text-brand-ink" strokeWidth={2} />
        </span>
        <span className="type-small flex-1 truncate text-ink">Cafe Onion, Seoul</span>
        <span className="type-caption inline-flex shrink-0 items-center gap-1 rounded-pill bg-pine-soft px-1.5 py-0.5 text-pine">
          <Check className="h-3 w-3" strokeWidth={2.5} />
          Pinned
        </span>
      </div>
    </div>
  );
}

const FRIEND_AVATARS = ['/avatar-1.png', '/avatar-2.png', '/avatar-3.png'];
const VOTES = [
  { label: 'Day trip to Sintra', frac: 1, tally: '3/3' },
  { label: 'Fado night in Alfama', frac: 2 / 3, tally: '2/3' },
];

/** Friends mini-card: group avatars plus a live vote on the plan. */
export function MiniFriends({ className }: { className?: string }) {
  return (
    <div className={cn('glass w-[260px] rounded-lg border border-border p-4 shadow-md', className)}>
      <div className="mb-3 flex items-center justify-between">
        <span className="type-caption text-ink-3">GROUP TRIP · LISBON</span>
        <span className="type-caption inline-flex items-center gap-1 rounded-pill bg-brand-soft px-2 py-0.5 text-brand">
          <Users className="h-3 w-3" strokeWidth={2} />
          3 planning
        </span>
      </div>
      <div className="mb-3 flex items-center gap-2">
        <div className="flex -space-x-1.5">
          {FRIEND_AVATARS.map((src, i) => (
            <img
              key={src}
              src={src}
              alt=""
              className="h-6 w-6 rounded-full object-cover ring-2 ring-surface"
              style={{ zIndex: FRIEND_AVATARS.length - i }}
            />
          ))}
        </div>
        <span className="type-caption text-ink-3">voting now</span>
      </div>
      <div className="space-y-2">
        {VOTES.map((v) => (
          <div key={v.label}>
            <div className="mb-1 flex items-center justify-between gap-2">
              <span className="type-small truncate text-ink">{v.label}</span>
              <span className="type-numeral shrink-0 text-[11px] text-ink-3">{v.tally}</span>
            </div>
            <div className="h-1.5 overflow-hidden rounded-full bg-surface-2">
              <div className="h-full rounded-full bg-brand" style={{ width: `${v.frac * 100}%` }} />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
