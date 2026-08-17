import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router';
import { AnimatePresence, motion } from 'framer-motion';
import { ArrowUpRight, CheckCircle2, ChevronRight, LifeBuoy, Send, Sparkles, X } from 'lucide-react';
import { format } from 'date-fns';
import { trpc } from '@/providers/trpc';
import { useAuth } from '@/hooks/useAuth';
import { POPULAR_FAQS } from '@/components/support/faq-data';
import { EASE_EXPO } from '@/lib/motion';
import { cn } from '@/lib/utils';

const CATEGORIES = [
  { value: 'booking', label: 'Booking & imports' },
  { value: 'routes', label: 'Routes & itineraries' },
  { value: 'weather', label: 'Weather & advisories' },
  { value: 'kids', label: 'Kids & family' },
  { value: 'account', label: 'Account & sign-in' },
  { value: 'app', label: 'App & install' },
  { value: 'bug', label: 'Bug report' },
  { value: 'other', label: 'Something else' },
] as const;

type CategoryValue = (typeof CATEGORIES)[number]['value'];

const MIN_MESSAGE = 10;
const MAX_MESSAGE = 2000;

/** Status pill for the "My tickets" mini-list. */
function StatusPill({ status }: { status: string }) {
  const open = status === 'open';
  return (
    <span
      className={cn(
        'type-caption inline-flex items-center rounded-pill px-2 py-0.5 font-semibold',
        open ? 'bg-ochre-soft text-ochre' : 'bg-pine-soft text-pine',
      )}
    >
      {open ? 'Open' : 'Closed'}
    </span>
  );
}

/** The ticket form + history - Voyager members only. */
function MessageUs({ onDone }: { onDone: () => void }) {
  const { user } = useAuth();
  const utils = trpc.useUtils();
  const [category, setCategory] = useState<CategoryValue>('other');
  const [message, setMessage] = useState('');
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);

  const ticketsQ = trpc.support.myTickets.useQuery(undefined, { retry: false });
  const submit = trpc.support.submitTicket.useMutation({
    onSuccess: () => {
      setSent(true);
      setMessage('');
      void utils.support.myTickets.invalidate();
    },
  });

  const trimmed = message.trim();
  const canSend = trimmed.length >= MIN_MESSAGE && trimmed.length <= MAX_MESSAGE && !submit.isPending;
  const tickets = ticketsQ.data?.tickets ?? [];

  if (sent) {
    return (
      <div className="px-4 py-5 text-center">
        <span className="mx-auto flex h-11 w-11 items-center justify-center rounded-full bg-pine-soft text-pine">
          <CheckCircle2 className="h-5 w-5" strokeWidth={1.75} />
        </span>
        <p className="type-h4 mt-3 text-ink">Message received.</p>
        <p className="type-small mt-1 text-ink-2">We typically reply within a day, keep an eye on your inbox.</p>
        <div className="mt-4 flex items-center justify-center gap-2">
          <button
            type="button"
            onClick={() => setSent(false)}
            className="type-small inline-flex h-9 items-center rounded-md border border-border bg-surface px-4 font-semibold text-ink transition-colors duration-fast hover:bg-surface-2"
          >
            Send another
          </button>
          <button
            type="button"
            onClick={onDone}
            className="type-small inline-flex h-9 items-center rounded-md bg-brand px-4 font-semibold text-brand-ink transition-colors duration-fast hover:bg-brand-strong"
          >
            Done
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="px-4 py-4">
      <p className="type-small font-semibold text-ink">Didn&apos;t find it? Message us</p>
      <p className="type-caption mt-0.5 text-ink-3">Pick a category so the right human sees it first.</p>

      <form
        className="mt-3 space-y-2.5"
        onSubmit={(e) => {
          e.preventDefault();
          if (!canSend) return;
          submit.mutate({ category, message: trimmed, email: email.trim() || undefined });
        }}
      >
        <label className="block">
          <span className="type-caption mb-1 block font-semibold text-ink-2">Category</span>
          <select
            value={category}
            onChange={(e) => setCategory(e.target.value as CategoryValue)}
            className="type-small h-9 w-full rounded-md border border-border bg-surface px-2.5 text-ink outline-none transition-colors duration-fast focus:border-brand"
          >
            {CATEGORIES.map((c) => (
              <option key={c.value} value={c.value}>
                {c.label}
              </option>
            ))}
          </select>
        </label>

        <label className="block">
          <span className="type-caption mb-1 flex items-baseline justify-between font-semibold text-ink-2">
            What&apos;s going on?
            <span className={cn('tnum font-normal', trimmed.length > MAX_MESSAGE ? 'text-danger' : 'text-ink-3')}>
              {trimmed.length}/{MAX_MESSAGE}
            </span>
          </span>
          <textarea
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            rows={4}
            maxLength={MAX_MESSAGE + 200}
            placeholder="Tell us what you expected and what happened instead…"
            className="type-small w-full resize-none rounded-md border border-border bg-surface px-2.5 py-2 text-ink outline-none transition-colors duration-fast placeholder:text-ink-3 focus:border-brand"
          />
        </label>

        <label className="block">
          <span className="type-caption mb-1 block font-semibold text-ink-2">
            Reply email <span className="font-normal text-ink-3">(optional, defaults to {user?.email ?? 'your account email'})</span>
          </span>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@example.com"
            className="type-small h-9 w-full rounded-md border border-border bg-surface px-2.5 text-ink outline-none transition-colors duration-fast placeholder:text-ink-3 focus:border-brand"
          />
        </label>

        {submit.error && (
          <p className="type-caption rounded-md border border-danger/30 bg-danger/10 px-2.5 py-2 text-danger" role="alert">
            {submit.error.message}
          </p>
        )}

        <button
          type="submit"
          disabled={!canSend}
          className="btn-sheen type-small inline-flex h-9 w-full items-center justify-center gap-1.5 rounded-md bg-brand font-semibold text-brand-ink shadow-sm transition-all duration-fast hover:bg-brand-strong disabled:cursor-not-allowed disabled:opacity-50"
        >
          <Send className="h-3.5 w-3.5" strokeWidth={2} />
          {submit.isPending ? 'Sending…' : 'Send to the team'}
        </button>
      </form>

      {/* My tickets mini-list */}
      {tickets.length > 0 && (
        <div className="mt-4 border-t border-border pt-3">
          <p className="type-caption font-semibold text-ink-3">My tickets</p>
          <ul className="mt-1.5 space-y-1.5">
            {tickets.slice(0, 3).map((t) => (
              <li key={t.id} className="flex items-center gap-2 rounded-md bg-surface-2 px-2.5 py-2">
                <span className="type-caption min-w-0 flex-1 truncate text-ink-2">{t.message}</span>
                <span className="type-caption tnum shrink-0 text-ink-3">{format(new Date(t.createdAt), 'MMM d')}</span>
                <StatusPill status={t.status} />
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

/**
 * Floating support widget (r10-support) - mounted once in AppShell, so every
 * signed-in screen gets the help button. Wanderers see FAQ shortcuts plus the
 * Voyager priority-help line; Voyagers additionally get the ticket form and
 * their ticket history. Positioned above the mobile bottom nav.
 */
export default function SupportWidget() {
  const [open, setOpen] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);
  const billingQ = trpc.billing.status.useQuery(undefined, { retry: false });
  const isVoyager =
    billingQ.data?.subscription?.tier === 'voyager' && billingQ.data?.subscription?.status === 'active';

  // Close on Escape / outside click while open.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    const onPointer = (e: PointerEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('pointerdown', onPointer);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('pointerdown', onPointer);
    };
  }, [open]);

  return (
    <div ref={panelRef} className="fixed bottom-20 right-4 z-50 flex flex-col items-end md:bottom-6 md:right-6">
      <AnimatePresence>
        {open && (
          <motion.div
            key="panel"
            initial={{ opacity: 0, y: 12, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 12, scale: 0.97 }}
            transition={{ duration: 0.25, ease: EASE_EXPO }}
            className="mb-3 w-[min(340px,calc(100vw-2rem))] overflow-hidden rounded-xl border border-border bg-surface shadow-xl"
            role="dialog"
            aria-label="Help and support"
          >
            {/* Panel header */}
            <div className="flex items-center gap-2.5 border-b border-border bg-surface-2 px-4 py-3">
              <span className="flex h-8 w-8 items-center justify-center rounded-md bg-brand-soft text-brand">
                <LifeBuoy className="h-4 w-4" strokeWidth={1.75} />
              </span>
              <div className="min-w-0 flex-1">
                <p className="type-small font-semibold text-ink">Help & support</p>
                <p className="type-caption text-ink-3">{isVoyager ? 'Priority help · Voyager' : 'Answers first, humans second'}</p>
              </div>
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label="Close help panel"
                className="inline-flex h-7 w-7 items-center justify-center rounded-md text-ink-3 transition-colors duration-fast hover:bg-surface hover:text-ink"
              >
                <X className="h-4 w-4" strokeWidth={1.75} />
              </button>
            </div>

            {/* Popular FAQs */}
            <div className="border-b border-border px-4 py-3">
              <p className="type-caption font-semibold text-ink-3">Popular FAQs</p>
              <ul className="mt-1">
                {POPULAR_FAQS.map((f) => (
                  <li key={f.q}>
                    <Link
                      to={`/faq#${f.groupId}`}
                      onClick={() => setOpen(false)}
                      className="group -mx-1.5 flex items-center gap-1.5 rounded-md px-1.5 py-1.5 transition-colors duration-fast hover:bg-surface-2"
                    >
                      <span className="type-small min-w-0 flex-1 truncate text-ink-2 transition-colors duration-fast group-hover:text-brand">
                        {f.q}
                      </span>
                      <ChevronRight className="h-3.5 w-3.5 shrink-0 text-ink-3 transition-colors duration-fast group-hover:text-brand" strokeWidth={1.75} />
                    </Link>
                  </li>
                ))}
              </ul>
              <Link
                to="/faq"
                onClick={() => setOpen(false)}
                className="type-caption mt-1 inline-flex items-center gap-1 font-semibold text-brand underline-offset-2 transition-colors duration-fast hover:underline"
              >
                Browse all FAQs
                <ArrowUpRight className="h-3 w-3" strokeWidth={2} />
              </Link>
            </div>

            {/* Tier-dependent body */}
            {isVoyager ? (
              <MessageUs onDone={() => setOpen(false)} />
            ) : (
              <div className="px-4 py-4">
                <div className="flex items-start gap-2.5 rounded-md bg-brand-soft px-3 py-2.5">
                  <Sparkles className="mt-0.5 h-4 w-4 shrink-0 text-brand" strokeWidth={1.75} />
                  <p className="type-small text-ink">
                    Voyager members get priority help, message us from right here and we typically reply within a
                    day.{' '}
                    <Link
                      to="/pricing"
                      onClick={() => setOpen(false)}
                      className="font-semibold text-brand underline-offset-2 transition-colors duration-fast hover:underline"
                    >
                      Upgrade to Voyager
                    </Link>
                  </p>
                </div>
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>

      {/* Floating help button */}
      <motion.button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label={open ? 'Close help' : 'Get help'}
        aria-expanded={open}
        whileHover={{ scale: 1.05 }}
        whileTap={{ scale: 0.94 }}
        className={cn(
          'flex h-12 w-12 items-center justify-center rounded-full shadow-lg transition-colors duration-fast',
          open ? 'bg-surface-2 text-ink' : 'bg-brand text-brand-ink hover:bg-brand-strong',
        )}
      >
        {open ? <X className="h-5 w-5" strokeWidth={2} /> : <LifeBuoy className="h-5 w-5" strokeWidth={1.75} />}
      </motion.button>
    </div>
  );
}
