import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { motion, useReducedMotion } from 'framer-motion';
import { ArrowRight, Check, MapPin, Sparkles } from 'lucide-react';
import { Eyebrow, Reveal } from '@/components/home/Reveal';
import { MapPin as MiniMapPin } from '@/components/home/minis';
import { useInView } from '@/hooks/useInView';
import { EASE_EXPO, SPRING_PIN_POP } from '@/lib/motion';

/* ------------------------------------------------------------------ */
/* "How it works" AI example (home §S3b): copy left, self-playing      */
/* animated mock right. Loops every ~14s, gated by IntersectionObserver */
/* and prefers-reduced-motion (static final frame).                    */
/* ------------------------------------------------------------------ */

const LOOP_MS = 14000;
const WORD = 'Kyoto';

/* Itinerary day colors (design.md §3.3) */
const DAY_CARDS: {
  day: number;
  color: string;
  stops: { name: string; time: string; img: string }[];
}[] = [
  {
    day: 1,
    color: '#BC5934',
    stops: [
      { name: 'Fushimi Inari Shrine', time: '9:00', img: '/place-temple.jpg' },
      { name: 'Ichiran Ramen', time: '12:30', img: '/place-ramen.jpg' },
    ],
  },
  {
    day: 2,
    color: '#44604F',
    stops: [
      { name: 'Arashiyama Bamboo Grove', time: '9:00', img: '/place-hike.jpg' },
      { name: 'Camellia Tea Ceremony', time: '15:00', img: '/explore-tea.jpg' },
    ],
  },
  {
    day: 3,
    color: '#6E7FA3',
    stops: [
      { name: 'Nara Deer Park', time: '9:30', img: '/place-temple.jpg' },
      { name: 'Dotonbori street food', time: '19:00', img: '/place-ramen.jpg' },
    ],
  },
];

/* Timeline (seconds within the 14s loop) */
const T = {
  typeStart: 0.7,
  typeChar: 0.13,
  destCheck: 2.0,
  shimmer: 2.4,
  dayCard: 3.9,
  dayCardStagger: 0.75,
  map: 6.7,
  route: 7.4,
  pin: 7.5,
  pinStagger: 0.35,
  success: 9.3,
};

const ROUTE_PINS = [
  { n: 1, color: DAY_CARDS[0].color, x: 11.7, y: 70.3 },
  { n: 2, color: DAY_CARDS[1].color, x: 48.3, y: 44.6 },
  { n: 3, color: DAY_CARDS[2].color, x: 88.3, y: 27.0 },
];

/** (a) Destination pill - types in "Kyoto", then a pine check pops. */
function DestPill({ playing }: { playing: boolean }) {
  const [n, setN] = useState(playing ? 0 : WORD.length);

  useEffect(() => {
    if (!playing) {
      setN(WORD.length);
      return;
    }
    const timers: ReturnType<typeof setTimeout>[] = [];
    for (let i = 1; i <= WORD.length; i++) {
      timers.push(setTimeout(() => setN(i), (T.typeStart + i * T.typeChar) * 1000));
    }
    return () => timers.forEach(clearTimeout);
  }, [playing]);

  const done = n >= WORD.length;
  return (
    <div className="flex items-center gap-2.5 rounded-lg border border-border bg-surface-2/50 px-3.5 py-2.5">
      <MapPin className="h-4 w-4 shrink-0 text-brand" strokeWidth={1.75} />
      <span className="type-small min-h-[20px] font-semibold text-ink">
        {WORD.slice(0, n)}
        {!done && (
          <span className="ml-px inline-block h-[14px] w-[2px] translate-y-[2px] animate-pulse bg-brand" />
        )}
      </span>
      <span className="type-caption ml-auto shrink-0 text-ink-3">Japan</span>
      <motion.span
        initial={playing ? { scale: 0 } : false}
        animate={{ scale: 1 }}
        transition={playing ? { ...SPRING_PIN_POP, delay: T.destCheck } : { duration: 0 }}
        className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-pine-soft text-pine"
      >
        <Check className="h-3 w-3" strokeWidth={2.5} />
      </motion.span>
    </div>
  );
}

/** (b) Progress shimmer - brand fill sweeps across a track. */
function ProgressLine({ playing }: { playing: boolean }) {
  return (
    <div>
      <div className="mb-1.5 flex items-center justify-between">
        <span className="type-caption inline-flex items-center gap-1 text-ink-3">
          <Sparkles className="h-3 w-3 text-brand" strokeWidth={2} />
          Drafting your days
        </span>
        <span className="type-caption tnum text-ink-3">balanced · 4/day</span>
      </div>
      <div className="relative h-1.5 overflow-hidden rounded-full bg-surface-2">
        <motion.div
          className="absolute inset-y-0 left-0 rounded-full bg-brand/80"
          initial={playing ? { width: '0%' } : false}
          animate={{ width: '100%' }}
          transition={playing ? { delay: T.shimmer, duration: 1.1, ease: EASE_EXPO } : { duration: 0 }}
        />
        {playing && (
          <motion.span
            aria-hidden
            className="absolute inset-y-0 w-1/3"
            style={{
              background: 'linear-gradient(90deg, transparent, var(--surface), transparent)',
              opacity: 0.7,
            }}
            initial={{ x: '-110%' }}
            animate={{ x: '330%' }}
            transition={{ delay: T.shimmer, duration: 1.1, ease: EASE_EXPO }}
          />
        )}
      </div>
    </div>
  );
}

/** (c) Day card - numbered day-color pin + stops with thumbs and times. */
function DayCard({
  card,
  index,
  playing,
}: {
  card: (typeof DAY_CARDS)[number];
  index: number;
  playing: boolean;
}) {
  const delay = T.dayCard + index * T.dayCardStagger;
  return (
    <motion.div
      initial={playing ? { opacity: 0, y: 16, scale: 0.98 } : false}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={playing ? { duration: 0.55, ease: EASE_EXPO, delay } : { duration: 0 }}
      className="rounded-lg border border-border/70 bg-surface-2/40 px-3.5 py-3"
    >
      <div className="flex items-center gap-2.5">
        <span
          className="flex h-[22px] w-[22px] items-center justify-center rounded-full shadow-sm ring-2 ring-surface"
          style={{ backgroundColor: card.color }}
        >
          <span className="font-serif text-[12px] font-semibold leading-none text-white">{card.day}</span>
        </span>
        <span className="type-small font-semibold text-ink">Day {card.day}</span>
        <span className="type-caption tnum ml-auto text-ink-3">4 stops</span>
      </div>
      <div className="mt-2.5 space-y-1.5">
        {card.stops.map((s, j) => (
          <motion.div
            key={s.name}
            initial={playing ? { opacity: 0, x: -8 } : false}
            animate={{ opacity: 1, x: 0 }}
            transition={
              playing
                ? { duration: 0.35, ease: EASE_EXPO, delay: delay + 0.18 + j * 0.16 }
                : { duration: 0 }
            }
            className="flex items-center gap-2.5 rounded-md bg-surface px-2 py-1.5 shadow-sm"
          >
            <img src={s.img} alt="" className="photo h-7 w-7 shrink-0 rounded-sm object-cover" />
            <span className="type-small flex-1 truncate text-ink">{s.name}</span>
            <span className="type-caption tnum shrink-0 text-ink-3">{s.time}</span>
          </motion.div>
        ))}
        <motion.div
          initial={playing ? { opacity: 0 } : false}
          animate={{ opacity: 1 }}
          transition={
            playing ? { duration: 0.35, ease: EASE_EXPO, delay: delay + 0.55 } : { duration: 0 }
          }
          className="type-caption px-2 pt-0.5 text-ink-3"
        >
          + 2 more stops placed
        </motion.div>
      </div>
    </motion.div>
  );
}

/** (d) Tiny map chip - pins pop and a route line draws itself. */
function MapChip({ playing }: { playing: boolean }) {
  return (
    <motion.div
      initial={playing ? { opacity: 0, y: 16 } : false}
      animate={{ opacity: 1, y: 0 }}
      transition={playing ? { duration: 0.55, ease: EASE_EXPO, delay: T.map } : { duration: 0 }}
      className="relative h-[148px] overflow-hidden rounded-lg border border-border/70 bg-surface-2/40"
    >
      <svg
        viewBox="0 0 480 148"
        preserveAspectRatio="xMidYMid slice"
        className="absolute inset-0 h-full w-full"
        aria-hidden="true"
      >
        {/* water */}
        <path
          d="M330 118 C380 100 430 122 486 110 L486 154 L330 154 Z"
          fill="#7C8DA6"
          fillOpacity="0.22"
        />
        {/* park */}
        <ellipse cx="120" cy="40" rx="30" ry="16" fill="#44604F" fillOpacity="0.12" />
        {/* roads */}
        <g stroke="#8A8175" strokeOpacity="0.4" strokeWidth="3" fill="none" strokeLinecap="round">
          <path d="M-6 116 C90 100 200 128 486 104" />
          <path d="M60 -6 C74 50 66 100 52 154" />
          <path d="M300 -6 C292 50 308 100 330 154" />
        </g>
        <g stroke="var(--surface)" strokeOpacity="0.85" strokeWidth="1.4" fill="none" strokeLinecap="round">
          <path d="M-6 116 C90 100 200 128 486 104" />
          <path d="M60 -6 C74 50 66 100 52 154" />
          <path d="M300 -6 C292 50 308 100 330 154" />
        </g>
        {/* route draws in */}
        <motion.path
          d="M56 104 C120 70 170 92 232 66 C290 44 340 70 424 40"
          fill="none"
          stroke="var(--brand)"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeOpacity="0.75"
          initial={playing ? { pathLength: 0 } : false}
          animate={{ pathLength: 1 }}
          transition={playing ? { delay: T.route, duration: 1.5, ease: EASE_EXPO } : { duration: 0 }}
        />
      </svg>

      {/* pins pop at route stops */}
      {ROUTE_PINS.map((p, i) => (
        <motion.span
          key={p.n}
          className="absolute"
          style={{ left: `${p.x}%`, top: `${p.y}%` }}
          initial={playing ? { scale: 0 } : false}
          animate={{ scale: 1 }}
          transition={
            playing ? { ...SPRING_PIN_POP, delay: T.pin + i * T.pinStagger } : { duration: 0 }
          }
        >
          <MiniMapPin n={p.n} color={p.color} className="static" />
        </motion.span>
      ))}

      <span className="type-caption absolute left-2 top-2 inline-flex items-center gap-1 rounded-pill border border-border bg-surface px-2 py-0.5 text-ink-3 shadow-sm">
        <MapPin className="h-3 w-3 text-brand" strokeWidth={2} />
        Kyoto
      </span>
      <motion.span
        initial={playing ? { opacity: 0, y: 6 } : false}
        animate={{ opacity: 1, y: 0 }}
        transition={playing ? { duration: 0.3, ease: EASE_EXPO, delay: T.route + 1.5 } : { duration: 0 }}
        className="type-caption absolute bottom-2 right-2 inline-flex items-center gap-1 rounded-pill border border-border bg-surface px-2 py-0.5 text-pine shadow-sm"
      >
        <Check className="h-3 w-3" strokeWidth={2.5} />
        Route drawn
      </motion.span>
    </motion.div>
  );
}

/** The self-playing mini Wayfare window. Remounts each loop via `loopKey`. */
function AiMock({ playing, loopKey }: { playing: boolean; loopKey: number }) {
  return (
    <div key={loopKey} className="relative mx-auto w-full max-w-[520px]">
      <motion.div
        initial={playing ? { opacity: 0, y: 24, scale: 0.98 } : false}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={playing ? { duration: 0.6, ease: EASE_EXPO } : { duration: 0 }}
        className="overflow-hidden rounded-xl border border-border bg-surface shadow-lg"
      >
        {/* window chrome */}
        <div className="flex items-center gap-3 border-b border-border bg-surface-2/60 px-4 py-3">
          <span className="flex w-[52px] gap-1.5" aria-hidden>
            <span className="h-2.5 w-2.5 rounded-full bg-border-strong" />
            <span className="h-2.5 w-2.5 rounded-full bg-border-strong" />
            <span className="h-2.5 w-2.5 rounded-full bg-border-strong" />
          </span>
          <span className="type-caption mx-auto inline-flex items-center gap-1.5 rounded-pill border border-border bg-surface px-3 py-1 text-ink-3 shadow-sm">
            <Sparkles className="h-3 w-3 text-brand" strokeWidth={2} />
            wayfare.app · AI trip builder
          </span>
          <span className="w-[52px]" aria-hidden />
        </div>

        <div className="space-y-4 p-5">
          <DestPill playing={playing} />
          <ProgressLine playing={playing} />
          <div className="space-y-2.5">
            {DAY_CARDS.map((card, i) => (
              <DayCard key={card.day} card={card} index={i} playing={playing} />
            ))}
          </div>
          <MapChip playing={playing} />
        </div>
      </motion.div>

      {/* success pill, overlapping the window */}
      <motion.div
        initial={playing ? { opacity: 0, scale: 0.8, y: 10 } : false}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        transition={playing ? { ...SPRING_PIN_POP, delay: T.success } : { duration: 0 }}
        className="absolute -bottom-5 right-4 flex items-center gap-2.5 rounded-pill border border-border bg-surface px-4 py-2.5 shadow-lg"
      >
        <span className="flex h-6 w-6 items-center justify-center rounded-full bg-pine-soft text-pine">
          <Check className="h-3.5 w-3.5" strokeWidth={2.5} />
        </span>
        <span className="type-small font-semibold text-ink">3-day Kyoto draft ready</span>
        <span className="type-caption tnum text-ink-3">12 stops</span>
      </motion.div>
    </div>
  );
}

export default function AiExample() {
  const reduced = useReducedMotion();
  const { ref, inView } = useInView<HTMLDivElement>(0.35);
  const [cycle, setCycle] = useState(0);
  const playing = inView && !reduced;

  /* Loop the mock every ~14s while on screen; static final frame otherwise */
  useEffect(() => {
    if (!playing) return;
    const id = window.setInterval(() => setCycle((c) => c + 1), LOOP_MS);
    return () => window.clearInterval(id);
  }, [playing]);

  return (
    <section className="mx-auto max-w-[1200px] px-6 py-24 md:py-32">
      <div className="grid items-center gap-12 lg:grid-cols-2 lg:gap-16">
        {/* Left, copy */}
        <Reveal>
          <Eyebrow>AI trip builder</Eyebrow>
          <h2 className="type-display mt-3 text-ink">
            Watch an itinerary <em className="serif-em text-brand">plan itself.</em>
          </h2>
          <p className="type-body-l mt-5 max-w-[52ch] text-ink-2">
            Pick a destination, dates, and a pace. Wayfare drafts a day-by-day itinerary, stops
            tuned to your taste profile, pinned to the map in seconds. Then make it yours: drag
            days around, optimize the route, split the costs.
          </p>
          <Link
            to="/login"
            className="btn-sheen type-body mt-8 inline-flex h-12 items-center gap-2 rounded-pill bg-brand px-7 font-semibold text-brand-ink shadow-md transition-all duration-fast hover:-translate-y-px hover:bg-brand-strong hover:shadow-lg active:scale-[0.97]"
          >
            Create an itinerary
            <ArrowRight className="h-4 w-4" strokeWidth={2} />
          </Link>
        </Reveal>

        {/* Right, self-playing mock (decorative) */}
        <Reveal delay={0.15}>
          <div ref={ref} aria-hidden="true" className="pb-6">
            <AiMock playing={playing} loopKey={playing ? cycle : -1} />
          </div>
        </Reveal>
      </div>
    </section>
  );
}
