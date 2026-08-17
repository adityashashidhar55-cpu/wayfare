import { lazy, Suspense, useEffect, useState } from 'react';
import { Link } from 'react-router';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { ArrowRight, Check, Crown, FileText, Mail, WifiOff } from 'lucide-react';
import { Eyebrow, Reveal } from '@/components/home/Reveal';
import { useInView } from '@/hooks/useInView';
import { EASE_EXPO } from '@/lib/motion';
import { cn } from '@/lib/utils';

// r21-perf: keep recharts out of the initial landing chunk.
const ExpenseDonut = lazy(() => import('@/components/home/ExpenseDonut'));

const EXPENSE_ROWS = [
  { label: 'Ramen lunch', meta: '¥3,200 · split 3 ways', avatars: ['/avatar-1.png', '/avatar-2.png', '/avatar-3.png'] },
  { label: 'Ryokan night 2', meta: '¥18,500 · Daniel paid', avatars: ['/avatar-2.png'] },
  { label: 'Taxi to Gion', meta: '¥2,600 · split 2 ways', avatars: ['/avatar-1.png', '/avatar-4.png'] },
];

function Card({
  className,
  children,
  span,
}: {
  className?: string;
  children: React.ReactNode;
  span: string;
}) {
  return (
    <motion.div
      whileHover={{ y: -4 }}
      transition={{ duration: 0.25, ease: EASE_EXPO }}
      className={cn(
        'group relative overflow-hidden rounded-xl border border-border bg-surface p-8 shadow-sm transition-shadow duration-base hover:shadow-lg',
        span,
        className,
      )}
    >
      {children}
    </motion.div>
  );
}

function CardTitle({ children, className }: { children: React.ReactNode; className?: string }) {
  return <h3 className={cn('type-h3 mb-2 text-ink', className)}>{children}</h3>;
}

function CardBody({ children }: { children: React.ReactNode }) {
  return <p className="type-body text-ink-2">{children}</p>;
}

function CrownTag() {
  return (
    <span className="type-caption absolute right-6 top-6 inline-flex items-center gap-1 rounded-pill bg-ochre-soft px-2.5 py-1 text-ochre">
      <Crown className="h-3 w-3" strokeWidth={2} />
      Voyager
    </span>
  );
}

/* ---------------- card 1: expenses donut + rows ---------------- */
function ExpensesVisual() {
  const { ref, inView } = useInView<HTMLDivElement>(0.3);
  return (
    <div ref={ref} className="mt-6 flex flex-col gap-6 sm:flex-row sm:items-center">
      <div className="relative h-[168px] w-[168px] shrink-0 transition-transform duration-base group-hover:scale-[1.02]">
        {inView && (
          <Suspense fallback={null}>
            <ExpenseDonut />
          </Suspense>
        )}
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
          <span className="type-caption text-ink-3">TRIP</span>
          <span className="type-numeral text-[18px] text-ink">$1,170</span>
        </div>
      </div>
      <div className="min-w-0 flex-1 space-y-2">
        {EXPENSE_ROWS.map((r) => (
          <div key={r.label} className="flex items-center gap-3 rounded-md border border-border/60 bg-surface-2/60 px-3 py-2">
            <div className="min-w-0 flex-1">
              <div className="type-small truncate text-ink">{r.label}</div>
              <div className="type-caption tnum text-ink-3">{r.meta}</div>
            </div>
            <div className="flex -space-x-1.5">
              {r.avatars.map((a) => (
                <img key={a} src={a} alt="" className="h-5 w-5 rounded-full object-cover ring-2 ring-surface" />
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ---------------- card 2: live cursors over mock itinerary ---------------- */
const CURSORS = [
  { name: 'Maya', color: '#BC5934', x: [8, 130, 60, 8], y: [12, 44, 96, 12], dur: 8 },
  { name: 'Priya', color: '#A86B8C', x: [170, 60, 200, 170], y: [70, 110, 20, 70], dur: 9.5 },
  { name: 'Leo', color: '#6E7FA3', x: [90, 200, 20, 90], y: [100, 80, 40, 100], dur: 11 },
];

function CursorFlag({ name, color, x, y, dur }: { name: string; color: string; x: number[]; y: number[]; dur: number }) {
  return (
    <motion.div
      className="absolute left-0 top-0 z-10"
      animate={{ x, y }}
      transition={{ duration: dur, repeat: Infinity, ease: 'easeInOut' }}
    >
      <svg width="12" height="14" viewBox="0 0 12 14" className="drop-shadow-sm">
        <path d="M1 1 L11 6.5 L6 7.5 L4 13 Z" fill={color} />
      </svg>
      <span
        className="type-caption ml-2.5 -mt-1 inline-block whitespace-nowrap rounded-pill px-1.5 py-0.5 text-white"
        style={{ backgroundColor: color }}
      >
        {name}
      </span>
    </motion.div>
  );
}

function CollabVisual() {
  const { ref, inView } = useInView<HTMLDivElement>(0.3);
  const reduced = useReducedMotion();
  return (
    <div ref={ref} className="relative mt-6 h-[180px] overflow-hidden rounded-md border border-border/60 bg-bg-subtle p-3 transition-transform duration-base group-hover:scale-[1.02]">
      <div className="space-y-2 opacity-80">
        {[1, 2, 3].map((n) => (
          <div key={n} className="flex items-center gap-2 rounded-sm bg-surface px-2.5 py-2 shadow-sm">
            <span className="flex h-4 w-4 items-center justify-center rounded-full bg-brand font-serif text-[10px] font-semibold text-white">{n}</span>
            <span className="h-2 rounded-full bg-border" style={{ width: `${52 - n * 8}%` }} />
          </div>
        ))}
      </div>
      {inView && !reduced && CURSORS.map((c) => <CursorFlag key={c.name} {...c} />)}
      <span className="absolute bottom-3 left-3 inline-flex items-center gap-1.5 rounded-pill border border-border bg-surface px-2.5 py-1 shadow-sm">
        <span className="relative flex h-1.5 w-1.5">
          <span className="absolute h-full w-full animate-ping rounded-full bg-[#A86B8C] opacity-70" />
          <span className="h-1.5 w-1.5 rounded-full bg-[#A86B8C]" />
        </span>
        <span className="type-caption text-ink-2">Priya is editing Day 2</span>
      </span>
    </div>
  );
}

/* ---------------- card 3: explore tuned to you ---------------- */
const PLACE_CARDS = [
  { img: '/place-temple.jpg', name: 'Kennin-ji Temple', tag: 'Hidden gem · 92% match' },
  { img: '/explore-tea.jpg', name: 'Tea house, Uji', tag: 'Because you love quiet mornings' },
];

function ExploreVisual() {
  const { ref, inView } = useInView<HTMLDivElement>(0.3);
  const reduced = useReducedMotion();
  const [idx, setIdx] = useState(0);

  useEffect(() => {
    if (!inView || reduced) return;
    const id = window.setInterval(() => setIdx((i) => (i + 1) % PLACE_CARDS.length), 4000);
    return () => window.clearInterval(id);
  }, [inView, reduced]);

  const place = PLACE_CARDS[idx];
  return (
    <div ref={ref}>
      <div className="mt-6 flex flex-wrap gap-2">
        {['Adventure', 'Foodie', 'Budget'].map((t, i) => (
          <span
            key={t}
            className={cn(
              'type-small rounded-pill px-3 py-1.5',
              i === 1 ? 'bg-brand-soft font-semibold text-brand' : 'bg-surface-2 text-ink-2',
            )}
          >
            {t}
          </span>
        ))}
      </div>
      <div className="relative mt-4 h-[150px]">
        <AnimatePresence mode="popLayout">
          <motion.div
            key={place.img}
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            transition={{ duration: 0.45, ease: EASE_EXPO }}
            className="absolute inset-0 flex items-center gap-4 rounded-md border border-border/60 bg-surface-2/60 p-3"
          >
            <img src={place.img} alt={place.name} className="photo h-[120px] w-[120px] rounded-md object-cover" />
            <div className="min-w-0">
              <div className="type-small font-semibold text-ink">{place.name}</div>
              <div className="type-caption mt-1 text-ink-3">{place.tag}</div>
              <span className="type-caption mt-3 inline-flex items-center gap-1 rounded-pill bg-pine-soft px-2 py-0.5 text-pine">
                <Check className="h-3 w-3" strokeWidth={2.5} />
                Added
              </span>
            </div>
          </motion.div>
        </AnimatePresence>
      </div>
    </div>
  );
}

/* ---------------- card 4: offline maps & PDF ---------------- */
function OfflineVisual() {
  const { ref, inView } = useInView<HTMLDivElement>(0.3);
  const reduced = useReducedMotion();
  const R = 15;
  const C = 2 * Math.PI * R;
  return (
    <div ref={ref} className="mt-6 flex items-center gap-5">
      <div className="relative h-[170px] w-[96px] shrink-0 overflow-hidden rounded-[18px] border-2 border-border-strong bg-bg-subtle shadow-md transition-transform duration-base group-hover:scale-[1.02]">
        <svg viewBox="0 0 96 170" className="absolute inset-0 h-full w-full">
          <path d="M-6 120 C30 100 50 130 80 116 C96 108 102 122 108 118 L108 180 L-6 180 Z" fill="#7C8DA6" fillOpacity="0.25" />
          <g stroke="#8A8175" strokeOpacity="0.4" strokeWidth="3" fill="none">
            <path d="M-4 60 C30 50 60 70 100 56" />
            <path d="M30 -4 C36 50 28 100 22 140" />
          </g>
          <circle cx="52" cy="66" r="6" fill="#BC5934" />
        </svg>
        <span className="type-caption absolute left-1.5 top-1.5 inline-flex items-center gap-1 rounded-pill bg-pine px-2 py-0.5 text-white">
          <WifiOff className="h-2.5 w-2.5" strokeWidth={2} />
          Offline
        </span>
      </div>
      <div className="flex flex-col items-center gap-2">
        <div className="relative">
          <FileText className="h-10 w-10 text-ink-3" strokeWidth={1.5} />
          <svg viewBox="0 0 40 40" className="absolute -right-3 -top-3 h-10 w-10 -rotate-90">
            <circle cx="20" cy="20" r={R} fill="none" stroke="var(--border)" strokeWidth="3" />
            <motion.circle
              cx="20"
              cy="20"
              r={R}
              fill="none"
              stroke="var(--pine)"
              strokeWidth="3"
              strokeLinecap="round"
              strokeDasharray={C}
              initial={{ strokeDashoffset: C }}
              animate={inView && !reduced ? { strokeDashoffset: [C, C * 0.15, C] } : { strokeDashoffset: C * 0.15 }}
              transition={inView && !reduced ? { duration: 3.2, repeat: Infinity, ease: 'easeInOut' } : { duration: 0.6 }}
            />
          </svg>
        </div>
        <span className="type-caption text-ink-3">PDF export</span>
      </div>
    </div>
  );
}

/* ---------------- card 5: email import ---------------- */
function EmailImportVisual() {
  const { ref, inView } = useInView<HTMLDivElement>(0.3);
  const reduced = useReducedMotion();
  return (
    <div ref={ref} className="mt-6 flex items-center gap-3">
      <span className="flex h-11 w-11 items-center justify-center rounded-md border border-border bg-surface-2">
        <Mail className="h-5 w-5 text-ink-3" strokeWidth={1.75} />
      </span>
      <ArrowRight className="h-4 w-4 shrink-0 text-ink-3" strokeWidth={1.75} />
      <AnimatePresence>
        {(inView || reduced) && (
          <motion.span
            key="bp"
            initial={{ opacity: 0, scale: 0.9, y: 8 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            transition={{ duration: 0.4, ease: EASE_EXPO, delay: 0.3 }}
            className="type-caption inline-flex items-center gap-1.5 rounded-md border border-border bg-surface px-2.5 py-2 font-semibold text-ink shadow-sm"
          >
            UA 842 · SFO→NRT
          </motion.span>
        )}
      </AnimatePresence>
    </div>
  );
}

/* ---------------- S4 - the bento ---------------- */
export default function FeatureBento() {
  return (
    <section id="features" className="mx-auto max-w-[1200px] scroll-mt-24 px-6 py-24 md:py-32">
      <Reveal className="mb-12 flex flex-wrap items-end justify-between gap-6">
        <div className="max-w-[560px]">
          <Eyebrow>The workspace</Eyebrow>
          <h2 className="type-display mt-3 text-ink">Everything the trip needs. Nothing it doesn't.</h2>
        </div>
        <Link
          to="/pricing"
          className="type-body group inline-flex items-center gap-1.5 font-medium text-brand transition-colors hover:text-brand-strong"
        >
          See pricing
          <ArrowRight className="h-4 w-4 transition-transform duration-fast group-hover:translate-x-0.5" strokeWidth={1.75} />
        </Link>
      </Reveal>

      <div className="grid grid-cols-1 gap-6 md:grid-cols-12">
        <Reveal className="md:col-span-7" delay={0}>
          <Card span="h-full">
            <CardTitle>Expenses & fair splitting</CardTitle>
            <CardBody>Log it in yen, split it in dollars. Currencies auto-convert. Debts simplify themselves.</CardBody>
            <ExpensesVisual />
          </Card>
        </Reveal>

        <Reveal className="md:col-span-5" delay={0.1}>
          <Card span="h-full">
            <CardTitle>Real-time collaboration</CardTitle>
            <CardBody>Cursors, presence, and edits that land as you watch, planning together feels like sitting together.</CardBody>
            <CollabVisual />
          </Card>
        </Reveal>

        <Reveal className="md:col-span-5" delay={0}>
          <Card span="h-full">
            <CardTitle>Explore, tuned to you</CardTitle>
            <CardBody>A five-question taste profile turns into recommendations that actually fit how you travel.</CardBody>
            <ExploreVisual />
          </Card>
        </Reveal>

        <Reveal className="md:col-span-4" delay={0.1}>
          <Card span="h-full">
            <CrownTag />
            <CardTitle className="pr-20">Offline maps & PDF export</CardTitle>
            <CardBody>Your whole trip, with or without signal.</CardBody>
            <OfflineVisual />
          </Card>
        </Reveal>

        <Reveal className="md:col-span-3" delay={0.2}>
          <Card span="h-full">
            <CrownTag />
            <CardTitle className="pr-20">Email import</CardTitle>
            <CardBody>Forward a confirmation. It becomes a reservation.</CardBody>
            <EmailImportVisual />
          </Card>
        </Reveal>
      </div>
    </section>
  );
}
