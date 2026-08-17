import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router';
import { motion } from 'framer-motion';
import { Crown, Lock, ShieldCheck } from 'lucide-react';
import { priceForBrowser } from '@contracts/premium';
import { trpc } from '@/providers/trpc';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { toast } from '@/components/expenses/toast';

export type BillingInterval = 'monthly' | 'yearly';

/**
 * r27: REAL CHECKOUT.
 *
 * This modal used to render fake card fields prefilled with 4242 4242 4242
 * 4242 and a note admitting "no card is ever charged". Submitting it called
 * billing.checkout, which granted Voyager for free.
 *
 * Now it hands off to Razorpay Checkout. Card details are entered in
 * Razorpay's own hosted overlay and never touch this app or its DOM, which is
 * both the only PCI-sane design and the reason the card inputs below are gone
 * rather than rewired.
 *
 * Flow: billing.createOrder (server prices it) -> Razorpay overlay -> their
 * handler returns a signature -> billing.confirm verifies it server-side. The
 * webhook at /api/webhooks/razorpay is the authoritative path and completes
 * the upgrade even if the user closes this tab mid-payment.
 */

/** Minimal shape of the global the Razorpay script installs. */
interface RazorpayHandlerResponse {
  razorpay_payment_id: string;
  razorpay_order_id: string;
  razorpay_signature: string;
}
interface RazorpayInstance {
  open: () => void;
  on: (event: string, cb: (e: unknown) => void) => void;
}
type RazorpayCtor = new (options: Record<string, unknown>) => RazorpayInstance;

const RAZORPAY_SCRIPT = 'https://checkout.razorpay.com/v1/checkout.js';

/** Load Razorpay's script once, on demand. Resolves false if it can't load. */
function loadRazorpay(): Promise<RazorpayCtor | null> {
  const w = window as unknown as { Razorpay?: RazorpayCtor };
  if (w.Razorpay) return Promise.resolve(w.Razorpay);
  return new Promise((resolve) => {
    const existing = document.querySelector<HTMLScriptElement>(`script[src="${RAZORPAY_SCRIPT}"]`);
    if (existing) {
      existing.addEventListener('load', () => resolve(w.Razorpay ?? null), { once: true });
      existing.addEventListener('error', () => resolve(null), { once: true });
      return;
    }
    const s = document.createElement('script');
    s.src = RAZORPAY_SCRIPT;
    s.async = true;
    s.onload = () => resolve(w.Razorpay ?? null);
    s.onerror = () => resolve(null);
    document.body.appendChild(s);
  });
}

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

  const price = priceForBrowser()[interval];
  const statusQ = trpc.billing.status.useQuery(undefined, { retry: false });
  const paymentsLive = statusQ.data?.paymentsEnabled ?? false;

  const createOrder = trpc.billing.createOrder.useMutation();
  const confirm = trpc.billing.confirm.useMutation({
    onSuccess: () => {
      setPhase('success');
      void utils.billing.status.invalidate();
      void utils.trips.list.invalidate();
      void utils.trips.get.invalidate();
    },
    onError: (e) => {
      setPhase('form');
      // The webhook still settles this server-side, so tell the truth rather
      // than implying the payment was lost.
      toast(
        e.message || "We couldn't verify that payment here. If you were charged it will apply shortly.",
        { tone: 'danger' },
      );
    },
  });

  const pay = async () => {
    setPhase('loading');
    try {
      const order = await createOrder.mutateAsync({ interval });
      const Razorpay = await loadRazorpay();
      if (!Razorpay) {
        setPhase('form');
        toast('Could not reach the payment provider. Check your connection and try again.', {
          tone: 'danger',
        });
        return;
      }
      const rzp = new Razorpay({
        key: order.keyId,
        order_id: order.orderId,
        amount: order.amount,
        currency: order.currency,
        name: 'Wayfare',
        description: `Voyager · ${interval} · ${order.label}`,
        handler: (res: RazorpayHandlerResponse) => {
          confirm.mutate({
            orderId: res.razorpay_order_id,
            paymentId: res.razorpay_payment_id,
            signature: res.razorpay_signature,
          });
        },
        modal: {
          // The user dismissed the overlay without paying. Not an error.
          ondismiss: () => setPhase('form'),
        },
        theme: { color: '#BC5934' },
      });
      rzp.on('payment.failed', () => {
        setPhase('form');
        toast('That payment did not go through. Nothing was charged.', { tone: 'danger' });
      });
      rzp.open();
    } catch (e) {
      setPhase('form');
      const message = e instanceof Error ? e.message : 'Could not start that payment';
      toast(message, { tone: 'danger' });
    }
  };

  const close = (v: boolean) => {
    onOpenChange(v);
    if (!v) setTimeout(() => setPhase('form'), 300);
  };

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
              Route optimization, email import and PDF exports are unlocked, go put them to work.
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
                <div className="type-caption capitalize text-ink-3">{interval} billing</div>
              </div>
              <div className="tnum text-[18px] font-semibold text-ink">{price.label}</div>
            </div>

            <div className="mt-4 rounded-md border border-border bg-surface-2/40 px-4 py-3">
              <p className="type-small flex items-center gap-2 text-ink-2">
                <ShieldCheck className="h-4 w-4 shrink-0 text-pine" strokeWidth={1.75} />
                Pay by UPI, card, netbanking or wallet.
              </p>
              <p className="type-caption mt-1.5 text-ink-3">
                Payment is handled by Razorpay in their own secure window. Wayfare never sees or
                stores your card details.
              </p>
            </div>

            {!paymentsLive && (
              <p className="type-caption mt-3 rounded-md bg-ochre-soft px-3 py-2 text-ink-2">
                Payments aren't switched on for this deployment yet, so checkout will not complete.
              </p>
            )}

            <p className="type-caption mt-3 flex items-center justify-center gap-1.5 text-center text-ink-3">
              <Lock className="h-3 w-3" strokeWidth={1.75} />
              Cancel any time. Access runs to the end of the period you've paid for.
            </p>

            <div className="mt-5 flex items-center justify-end gap-2">
              <Button variant="ghost" onClick={() => close(false)} disabled={phase === 'loading'}>
                Cancel
              </Button>
              <Button
                onClick={() => void pay()}
                disabled={phase === 'loading' || !paymentsLive}
                className="min-w-[140px]"
              >
                {phase === 'loading' ? (
                  <span className="h-4 w-4 animate-spin rounded-full border-2 border-brand-ink/40 border-t-brand-ink" />
                ) : (
                  `Pay ${price.label}`
                )}
              </Button>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
