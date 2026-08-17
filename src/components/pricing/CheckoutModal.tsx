import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router';
import { motion } from 'framer-motion';
import { CreditCard, Crown, Lock } from 'lucide-react';
import { priceForBrowser } from '@contracts/premium';
import { trpc } from '@/providers/trpc';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { toast } from '@/components/expenses/toast';

export type BillingInterval = 'monthly' | 'yearly';

/** Deterministic pseudo-random from an index (lint-pure, stable per burst). */
function hash01(i: number, salt: number): number {
  const x = Math.sin(i * 127.1 + salt * 311.7) * 43758.5453;
  return x - Math.floor(x);
}

/** Confetti-lite burst (pricing.md §S2): a handful of brand-hued sparks. */
function ConfettiLite() {
  const bits = useMemo(
    () =>
      Array.from({ length: 18 }, (_, i) => {
        const angle = (i / 18) * Math.PI * 2 + hash01(i, 1) * 0.5;
        const dist = 56 + hash01(i, 2) * 64;
        return {
          x: Math.cos(angle) * dist,
          y: Math.sin(angle) * dist - 24,
          size: 4 + hash01(i, 3) * 5,
          color: ['var(--brand)', 'var(--ochre)', 'var(--pine)'][i % 3]!,
          delay: hash01(i, 4) * 0.12,
          rotate: hash01(i, 5) * 180,
        };
      }),
    [],
  );
  return (
    <span className="pointer-events-none absolute inset-0 flex items-center justify-center" aria-hidden>
      {bits.map((b, i) => (
        <motion.span
          key={i}
          className="absolute rounded-[2px]"
          style={{ width: b.size, height: b.size, background: b.color }}
          initial={{ x: 0, y: 0, opacity: 1, rotate: 0, scale: 1 }}
          animate={{ x: b.x, y: b.y, opacity: 0, rotate: b.rotate, scale: 0.6 }}
          transition={{ duration: 0.9, delay: b.delay, ease: [0.22, 1, 0.36, 1] }}
        />
      ))}
    </span>
  );
}

/** Pine ring + check draw-in for the success state. */
function SuccessMark() {
  return (
    <span className="relative flex h-20 w-20 items-center justify-center">
      <motion.svg viewBox="0 0 80 80" className="h-20 w-20">
        <motion.circle
          cx="40"
          cy="40"
          r="34"
          fill="none"
          stroke="var(--pine)"
          strokeWidth="4"
          strokeLinecap="round"
          initial={{ pathLength: 0 }}
          animate={{ pathLength: 1 }}
          transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
        />
        <motion.path
          d="M27 41.5 L36.5 51 L54 32"
          fill="none"
          stroke="var(--pine)"
          strokeWidth="5"
          strokeLinecap="round"
          strokeLinejoin="round"
          initial={{ pathLength: 0 }}
          animate={{ pathLength: 1 }}
          transition={{ duration: 0.4, delay: 0.45, ease: [0.22, 1, 0.36, 1] }}
        />
      </motion.svg>
      <ConfettiLite />
    </span>
  );
}

/** Mock checkout modal (pricing.md §S2) - demo only, no real payment. */
export function CheckoutModal({
  open,
  onOpenChange,
  interval,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  interval: BillingInterval;
}) {
  const navigate = useNavigate();
  const utils = trpc.useUtils();
  const [phase, setPhase] = useState<'form' | 'loading' | 'success'>('form');
  const [card, setCard] = useState('4242 4242 4242 4242');
  const [expiry, setExpiry] = useState('12 / 28');
  const [cvc, setCvc] = useState('424');

  const price = priceForBrowser()[interval];

  const checkout = trpc.billing.checkout.useMutation({
    onSuccess: () => {
      setPhase('success');
      void utils.billing.status.invalidate();
      void utils.trips.list.invalidate();
      void utils.trips.get.invalidate();
    },
    onError: (e) => {
      setPhase('form');
      toast(e.message || 'Checkout failed', { tone: 'danger' });
    },
  });

  const startTrial = () => {
    setPhase('loading');
    // 900ms processing beat per pricing.md, then the mock checkout resolves.
    setTimeout(() => checkout.mutate({ interval }), 900);
  };

  const close = (v: boolean) => {
    onOpenChange(v);
    if (!v) setTimeout(() => setPhase('form'), 300);
  };

  const formatCard = (v: string) =>
    v
      .replace(/\D/g, '')
      .slice(0, 16)
      .replace(/(\d{4})(?=\d)/g, '$1 ');

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent className="w-[min(520px,calc(100vw-2rem))] rounded-xl border-border bg-surface p-7 shadow-lg max-sm:bottom-0 max-sm:left-0 max-sm:top-auto max-sm:w-full max-sm:max-w-none max-sm:translate-x-0 max-sm:translate-y-0 max-sm:rounded-b-none">
        {phase === 'success' ? (
          <div className="flex flex-col items-center gap-4 py-6 text-center">
            <SuccessMark />
            <h3 className="type-h3 mt-2 text-ink">
              Welcome aboard, Voyager <span className="text-brand">✳︎</span>
            </h3>
            <p className="type-body max-w-[38ch] text-ink-2">
              Route optimization, email import, offline maps and PDF exports are unlocked, go put
              them to work.
            </p>
            <Button
              size="lg"
              pill
              className="mt-2"
              onClick={() => {
                close(false);
                navigate('/trips');
              }}
            >
              Plan a trip
            </Button>
          </div>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle className="type-h3 flex items-center gap-2 text-ink">
                <Crown className="h-5 w-5 text-ochre" strokeWidth={1.75} />
                Checkout · Wayfare Voyager
              </DialogTitle>
            </DialogHeader>

            {/* Order summary */}
            <div className="mt-5 flex items-center justify-between rounded-md border border-border bg-surface-2/60 px-4 py-3">
              <div>
                <div className="type-small font-semibold text-ink">Voyager</div>
                <div className="type-caption capitalize text-ink-3">
                  {interval} billing · 7-day free trial
                </div>
              </div>
              <div className="tnum text-[18px] font-semibold text-ink">{price.label}</div>
            </div>

            {/* Card cluster (demo placeholder fields) */}
            <div className="mt-4 space-y-3">
              <div className="flex items-center gap-2 rounded-md border border-border-strong bg-surface px-3 transition-colors focus-within:border-brand">
                <CreditCard className="h-4 w-4 shrink-0 text-ink-3" strokeWidth={1.75} />
                <input
                  value={card}
                  onChange={(e) => setCard(formatCard(e.target.value))}
                  inputMode="numeric"
                  aria-label="Card number"
                  className="tnum type-body h-11 w-full bg-transparent text-ink outline-none placeholder:text-ink-3"
                  placeholder="4242 4242 4242 4242"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <input
                  value={expiry}
                  onChange={(e) => setExpiry(e.target.value.slice(0, 7))}
                  inputMode="numeric"
                  aria-label="Expiry"
                  className="tnum type-body h-11 rounded-md border border-border-strong bg-surface px-3 text-ink outline-none transition-colors placeholder:text-ink-3 focus:border-brand"
                  placeholder="MM / YY"
                />
                <input
                  value={cvc}
                  onChange={(e) => setCvc(e.target.value.replace(/\D/g, '').slice(0, 4))}
                  inputMode="numeric"
                  aria-label="CVC"
                  className="tnum type-body h-11 rounded-md border border-border-strong bg-surface px-3 text-ink outline-none transition-colors placeholder:text-ink-3 focus:border-brand"
                  placeholder="CVC"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <button
                  type="button"
                  onClick={startTrial}
                  className="type-small flex h-10 items-center justify-center rounded-md bg-ink font-semibold text-bg transition-transform duration-fast hover:-translate-y-px active:scale-[0.97]"
                >
                  Apple Pay
                </button>
                <button
                  type="button"
                  onClick={startTrial}
                  className="type-small flex h-10 items-center justify-center rounded-md border border-border-strong bg-surface font-semibold text-ink transition-all duration-fast hover:-translate-y-px hover:bg-surface-2 active:scale-[0.97]"
                >
                  Google Pay
                </button>
              </div>
            </div>

            <p className="type-caption mt-3 flex items-center justify-center gap-1.5 text-center text-ink-3">
              <Lock className="h-3 w-3" strokeWidth={1.75} />
              This is a demo checkout, no card is ever charged.
            </p>

            <div className="mt-5 flex items-center justify-end gap-2">
              <Button variant="ghost" onClick={() => close(false)} disabled={phase === 'loading'}>
                Cancel
              </Button>
              <Button onClick={startTrial} disabled={phase === 'loading'} className="min-w-[140px]">
                {phase === 'loading' ? (
                  <span className="h-4 w-4 animate-spin rounded-full border-2 border-brand-ink/40 border-t-brand-ink" />
                ) : (
                  'Start trial'
                )}
              </Button>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
