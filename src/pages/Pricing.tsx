import { useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import { AnimatePresence, motion, useMotionValue, useSpring } from 'framer-motion';
import { Check, Crown } from 'lucide-react';
import { priceForBrowser } from '@contracts/premium';
import { CURRENCY_SYMBOLS } from '@contracts/fx';
import { trpc } from '@/providers/trpc';
import { useAuth } from '@/hooks/useAuth';
import { LOGIN_PATH } from '@/const';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { RollingPrice } from '@/components/pricing/RollingPrice';
import { CheckoutModal, type BillingInterval } from '@/components/pricing/CheckoutModal';
import { ComparisonTable } from '@/components/pricing/ComparisonTable';
import { Faq } from '@/components/pricing/Faq';
import { toast } from '@/components/expenses/toast';
import { ToastHost } from '@/components/expenses/ToastHost';
import { cn } from '@/lib/utils';

const EASE_EXPO = [0.22, 1, 0.36, 1] as [number, number, number, number];

const WANDERER_FEATURES = [
  'Day-by-day itinerary + map',
  'Expense tracking & splitting',
  'Up to 3 collaborators',
  'Explore recommendations',
  'Checklists & notes',
  'Unlimited trips',
];

/* r26: two entries were removed because nothing implemented them.
   - "Offline maps": public/sw.js explicitly excludes map tiles AND /api/* from
     caching, so there was never any offline capability to sell.
   - "Unlimited attachments & receipts": there is no upload or storage path in
     the codebase at all.
   "PDF itinerary export" stayed, because it is now real (browser print
   pipeline + the print stylesheet in index.css). Selling a feature that does
   not exist is a refund waiting to happen; add these back when they ship. */
const VOYAGER_FEATURES = [
  'Unlimited trips & collaborators',
  'AI itinerary generation',
  'Optimize route (traveling-salesman smart ordering)',
  'Flight & hotel email import',
  'Group planning with availability voting',
  'Travel mode & live location sharing',
  'PDF itinerary export',
  'Priority support',
];

const CTA_WORDS = 'The best trips are the ones you actually take.'.split(' ');
const NBSP = '\u00A0';

const rise = (i: number, base = 0) => ({
  initial: { opacity: 0, y: 24 },
  animate: { opacity: 1, y: 0 },
  transition: { delay: base + i * 0.08, duration: 0.6, ease: EASE_EXPO },
});

/* ------------------------------ Billing toggle ----------------------------- */

function BillingToggle({
  interval,
  onChange,
}: {
  interval: BillingInterval;
  onChange: (i: BillingInterval) => void;
}) {
  // r25: prices are per-market (see contracts/premium.ts) - India gets rupee
  // pricing rather than an FX conversion of the US price.
  const P = priceForBrowser();
  const savePct = Math.round((1 - P.yearly.cents / (P.monthly.cents * 12)) * 100);
  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.94 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ delay: 0.3, duration: 0.3, ease: EASE_EXPO }}
      className="inline-flex items-center gap-3"
    >
      <div className="relative flex rounded-pill border border-border bg-surface-2 p-1 shadow-sm">
        {(['monthly', 'yearly'] as const).map((opt) => (
          <button
            key={opt}
            type="button"
            onClick={() => onChange(opt)}
            className={cn(
              'relative z-[1] rounded-pill px-5 py-2 text-[13px] font-semibold capitalize transition-colors duration-fast',
              interval === opt ? 'text-ink' : 'text-ink-3 hover:text-ink',
            )}
            aria-pressed={interval === opt}
          >
            {interval === opt && (
              <motion.span
                layoutId="billing-thumb"
                className="absolute inset-0 rounded-pill bg-surface shadow-sm"
                transition={{ type: 'spring', stiffness: 380, damping: 30 }}
              />
            )}
            <span className="relative">{opt}</span>
          </button>
        ))}
      </div>
      <AnimatePresence>
        {interval === 'yearly' && (
          <motion.span
            initial={{ opacity: 0, scale: 0.85 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.85 }}
            transition={{ duration: 0.25 }}
            className="type-caption rounded-pill bg-ochre-soft px-2.5 py-1 font-bold text-ochre"
          >
            Save {savePct}%
          </motion.span>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

/* --------------------------------- Voyager CTA ----------------------------- */

function VoyagerCta({
  interval,
  isVoyager,
  periodEnd,
  onUpgrade,
}: {
  interval: BillingInterval;
  isVoyager: boolean;
  periodEnd?: string | null;
  onUpgrade: () => void;
}) {
  const utils = trpc.useUtils();
  const navigate = useNavigate();
  const cancel = trpc.billing.cancel.useMutation({
    onSuccess: () => {
      void utils.billing.status.invalidate();
      void utils.trips.list.invalidate();
      void utils.trips.get.invalidate();
      toast('Voyager canceled, you are back on Wanderer', { tone: 'info' });
    },
    onError: (e) => toast(e.message || 'Could not cancel', { tone: 'danger' }),
  });

  if (isVoyager) {
    return (
      <div className="mt-8 space-y-3">
        <div className="flex items-center gap-2 rounded-md bg-pine-soft px-3.5 py-2.5">
          <Check className="h-4 w-4 shrink-0 text-pine" strokeWidth={2.5} />
          <span className="type-small font-semibold text-pine">Voyager active</span>
          {periodEnd && (
            <span className="type-caption tnum ml-auto text-ink-2">renews {periodEnd}</span>
          )}
        </div>
        <Button size="lg" pill className="w-full" onClick={() => navigate('/trips')}>
          Plan a trip
        </Button>
        <Popover>
          <PopoverTrigger asChild>
            <Button variant="danger-ghost" size="sm" className="w-full">
              Cancel plan
            </Button>
          </PopoverTrigger>
          <PopoverContent align="center" className="w-72 border-border bg-surface p-4 shadow-lg">
            <p className="type-small text-ink">
              Cancel Voyager? Your trips and data stay, premium features pause at the end of the
              period.
            </p>
            <div className="mt-3 flex justify-end">
              <Button
                variant="destructive"
                size="sm"
                disabled={cancel.isPending}
                onClick={() => cancel.mutate()}
              >
                {cancel.isPending ? 'Canceling…' : 'Confirm cancel'}
              </Button>
            </div>
          </PopoverContent>
        </Popover>
      </div>
    );
  }

  return (
    <div className="mt-8">
      <Button size="lg" pill className="w-full" onClick={onUpgrade}>
        Go Voyager, {priceForBrowser()[interval].label}
      </Button>
      <p className="type-caption mt-3 text-center text-ink-3">
        7-day free trial · Cancel in one click
      </p>
    </div>
  );
}

/* --------------------------------- Main page ------------------------------- */

export default function Pricing() {
  const navigate = useNavigate();
  const { isAuthenticated, isLoading: authLoading } = useAuth();
  const [interval, setInterval] = useState<BillingInterval>('yearly');
  const [checkoutOpen, setCheckoutOpen] = useState(false);

  const billing = trpc.billing.status.useQuery(undefined, {
    enabled: isAuthenticated,
    retry: false,
  });
  const isVoyager = billing.data?.subscription.tier === 'voyager';
  const periodEnd = billing.data?.subscription.currentPeriodEnd;

  const P = priceForBrowser();
  const sym = CURRENCY_SYMBOLS[P.currency] ?? '$';
  const monthlyEq = (P.yearly.cents / 12 / 100).toFixed(P.currency === 'INR' ? 0 : 2);
  const monthlyPrice = (P.monthly.cents / 100).toFixed(P.currency === 'INR' ? 0 : 2);

  const handleUpgrade = () => {
    if (authLoading) return;
    if (!isAuthenticated) {
      navigate(LOGIN_PATH);
      return;
    }
    setCheckoutOpen(true);
  };

  // CTA band glow parallax
  const bandRef = useRef<HTMLDivElement>(null);
  const glowX = useMotionValue(0);
  const glowY = useMotionValue(0);
  const sx = useSpring(glowX, { stiffness: 60, damping: 20 });
  const sy = useSpring(glowY, { stiffness: 60, damping: 20 });

  return (
    <div className="relative">
      {/* ------------------------------- S1 Hero ------------------------------- */}
      <section className="relative overflow-hidden px-6 pb-16 pt-[128px]">
        <div
          className="pointer-events-none absolute inset-0"
          style={{ background: 'var(--grad-hero)' }}
          aria-hidden
        />
        <div className="relative mx-auto flex max-w-[880px] flex-col items-center text-center">
          <motion.span {...rise(0)} className="type-eyebrow text-brand">
            Pricing
          </motion.span>
          <motion.h1 {...rise(1)} className="type-display mt-4 text-ink">
            Free to wander. <span className="serif-em text-brand">Voyager</span> to fly.
          </motion.h1>
          <motion.p {...rise(2)} className="type-body-l mt-5 max-w-[56ch] text-ink-2">
            Start free with everything a small trip needs. Upgrade when the whole crew, and the
            miles, show up.
          </motion.p>
          <div className="mt-8">
            <BillingToggle interval={interval} onChange={setInterval} />
          </div>
        </div>
      </section>

      {/* ----------------------------- S2 Plan cards ---------------------------- */}
      <section className="px-6 pb-24">
        <div className="mx-auto grid max-w-[920px] items-start gap-6 min-[820px]:grid-cols-2">
          {/* Wanderer */}
          <motion.div
            initial={{ opacity: 0, y: 28 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.35, duration: 0.55, ease: EASE_EXPO }}
            className="order-2 rounded-xl border border-border bg-surface p-10 shadow-sm transition-all duration-base hover:-translate-y-1 hover:shadow-md min-[820px]:order-1"
          >
            <h2 className="type-h3 text-ink">Wanderer</h2>
            <p className="type-small mt-1 text-ink-3">For weekends & small crews</p>
            <div className="mt-6 flex items-baseline gap-2">
              <span className="tnum font-serif text-[48px] font-medium leading-none tracking-[-0.02em] text-ink">
                $0
              </span>
              <span className="type-caption text-ink-3">forever</span>
            </div>
            <ul className="mt-8 space-y-3.5">
              {WANDERER_FEATURES.map((f, i) => (
                <motion.li
                  key={f}
                  initial={{ opacity: 0, x: -8 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: 0.6 + i * 0.04, duration: 0.35, ease: EASE_EXPO }}
                  className="flex items-start gap-2.5 text-[15px] text-ink"
                >
                  <Check className="mt-0.5 h-4 w-4 shrink-0 text-pine" strokeWidth={2} />
                  {f}
                </motion.li>
              ))}
            </ul>
            <Button
              variant="secondary"
              size="lg"
              className="mt-8 w-full"
              onClick={() => navigate(isAuthenticated ? '/trips' : LOGIN_PATH)}
            >
              Start free
            </Button>
          </motion.div>

          {/* Voyager */}
          <motion.div
            initial={{ opacity: 0, y: 28 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.47, duration: 0.55, ease: EASE_EXPO }}
            className="animate-breathe relative order-1 rounded-xl border-2 border-brand bg-surface p-10 min-[820px]:order-2"
          >
            <motion.span
              initial={{ opacity: 0, scale: 0.6 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ delay: 0.85, type: 'spring', stiffness: 500, damping: 28 }}
              className="absolute -top-3.5 left-1/2 flex -translate-x-1/2 items-center gap-1.5 whitespace-nowrap rounded-pill bg-brand px-3.5 py-1.5 text-[11px] font-bold tracking-[0.1em] text-brand-ink shadow-md"
            >
              <Crown className="h-3.5 w-3.5" strokeWidth={2} />
              MOST LOVED
            </motion.span>

            <h2 className="type-h3 flex items-center gap-2 text-ink">
              Voyager
              <Crown className="h-4 w-4 text-ochre" strokeWidth={1.75} />
            </h2>
            <p className="type-small mt-1 text-ink-3">For the long haul & the whole crew</p>
            <div className="mt-6 flex flex-wrap items-baseline gap-x-3 gap-y-1">
              <RollingPrice
                text={`${sym}${(P[interval].cents / 100).toFixed(P.currency === 'INR' ? 0 : 2)}`}
                className="tnum font-serif text-[48px] font-medium leading-none tracking-[-0.02em] text-ink"
              />
              <span className="type-caption text-ink-3">/{interval === 'yearly' ? 'year' : 'month'}</span>
              {interval === 'yearly' && (
                <span className="type-caption tnum text-ink-3">
                  <s>{sym}{monthlyPrice}/mo</s>{' '}
                  <span className="font-semibold text-ink-2">{sym}{monthlyEq}/mo</span>
                </span>
              )}
            </div>
            <ul className="mt-8 space-y-3.5">
              <motion.li
                initial={{ opacity: 0, x: -8 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: 0.7, duration: 0.35, ease: EASE_EXPO }}
                className="type-small font-semibold text-ink-2"
              >
                Everything in Wanderer, plus:
              </motion.li>
              {VOYAGER_FEATURES.map((f, i) => (
                <motion.li
                  key={f}
                  initial={{ opacity: 0, x: -8 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: 0.74 + i * 0.04, duration: 0.35, ease: EASE_EXPO }}
                  className="flex items-start gap-2.5 text-[15px] text-ink"
                >
                  <Check className="mt-0.5 h-4 w-4 shrink-0 text-brand" strokeWidth={2} />
                  {f}
                </motion.li>
              ))}
            </ul>
            <VoyagerCta
              interval={interval}
              isVoyager={isVoyager}
              periodEnd={periodEnd}
              onUpgrade={handleUpgrade}
            />
          </motion.div>
        </div>
      </section>

      {/* --------------------------- S3 Comparison table -------------------------- */}
      <section className="px-6 pb-24">
        <div className="mx-auto max-w-[920px]">
          <motion.h2
            initial={{ opacity: 0, y: 24 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: '-80px' }}
            transition={{ duration: 0.6, ease: EASE_EXPO }}
            className="type-h2 mb-8 text-center text-ink"
          >
            Side by side
          </motion.h2>
          <ComparisonTable />
        </div>
      </section>

      {/* ----------------------------- S4 Testimonial ---------------------------- */}
      <section className="px-6 pb-24">
        <motion.figure
          initial={{ opacity: 0, y: 24 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: '-80px' }}
          transition={{ duration: 0.6, ease: EASE_EXPO }}
          className="mx-auto flex max-w-[680px] flex-col items-center text-center"
        >
          <blockquote className="font-serif text-[24px] font-medium italic leading-[1.4] tracking-[-0.01em] text-ink">
            “Route optimization turned our chaotic Rome list into perfect days. Paid for itself
            before lunch.”
          </blockquote>
          <figcaption className="mt-6 flex items-center gap-3">
            <img
              src="/avatar-5.png"
              alt="Sofia"
              className="photo h-10 w-10 rounded-full object-cover ring-2 ring-surface"
            />
            <span className="text-left">
              <span className="type-small block font-semibold text-ink">Sofia Marchetti</span>
              <span className="type-caption block text-ink-3">Voyager since 2023</span>
            </span>
          </figcaption>
        </motion.figure>
      </section>

      {/* --------------------------------- S5 FAQ -------------------------------- */}
      <section className="px-6 pb-24">
        <div className="mx-auto max-w-[720px]">
          <motion.h2
            initial={{ opacity: 0, y: 24 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: '-80px' }}
            transition={{ duration: 0.6, ease: EASE_EXPO }}
            className="type-h2 mb-8 text-center text-ink"
          >
            Questions, answered
          </motion.h2>
          <Faq />
        </div>
      </section>

      {/* ------------------------------ S6 Final CTA ----------------------------- */}
      <section className="px-6 pb-28">
        <div
          ref={bandRef}
          onMouseMove={(e) => {
            const r = bandRef.current?.getBoundingClientRect();
            if (!r) return;
            glowX.set(((e.clientX - r.left) / r.width - 0.5) * 20);
            glowY.set(((e.clientY - r.top) / r.height - 0.5) * 20);
          }}
          className="relative mx-auto max-w-[1100px] overflow-hidden rounded-xl border border-border bg-bg-subtle px-6 py-20 text-center"
        >
          <motion.div
            className="pointer-events-none absolute -right-24 -top-24 h-[420px] w-[420px] rounded-full opacity-70 blur-3xl"
            style={{
              background:
                'radial-gradient(circle, color-mix(in srgb, var(--brand) 26%, transparent), color-mix(in srgb, var(--ochre) 14%, transparent) 55%, transparent 75%)',
              x: sx,
              y: sy,
            }}
            aria-hidden
          />
          <h2 className="type-h2 relative mx-auto max-w-[22ch] text-ink">
            {CTA_WORDS.map((w, i) => (
              <motion.span
                key={`${w}-${i}`}
                className="inline-block"
                initial={{ opacity: 0, y: 16 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true, margin: '-60px' }}
                transition={{ delay: i * 0.05, duration: 0.5, ease: EASE_EXPO }}
              >
                {w}
                {i < CTA_WORDS.length - 1 ? NBSP : ''}
              </motion.span>
            ))}
          </h2>
          <motion.div
            initial={{ opacity: 0, y: 16 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: '-60px' }}
            transition={{ delay: 0.35, duration: 0.5, ease: EASE_EXPO }}
            className="relative mt-8"
          >
            <Button
              size="lg"
              pill
              className="px-8"
              onClick={() => navigate(isAuthenticated ? '/trips' : LOGIN_PATH)}
            >
              Start free
            </Button>
            <p className="type-caption mt-4 text-ink-3">
              Upgrade whenever, your plans carry over.
            </p>
          </motion.div>
        </div>
      </section>

      <CheckoutModal open={checkoutOpen} onOpenChange={setCheckoutOpen} interval={interval} />
      <ToastHost />
    </div>
  );
}
