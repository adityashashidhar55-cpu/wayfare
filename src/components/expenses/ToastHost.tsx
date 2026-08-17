import { useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Check, Info, TriangleAlert } from 'lucide-react';
import { cn } from '@/lib/utils';
import { subscribeToasts, type ToastItem, type ToastTone } from './toast';

/**
 * Toast host (design.md §10.4): surface + shadow-lg + left 3px status color;
 * slides up 16px + fade (320ms spring); auto-dismiss 3.5s with a draining
 * progress hairline. Bottom-center desktop / above bottom-nav mobile.
 */

const TONE_STYLE: Record<ToastTone, { bar: string; icon: typeof Check; iconClass: string }> = {
  success: { bar: 'bg-pine', icon: Check, iconClass: 'text-pine' },
  info: { bar: 'bg-info', icon: Info, iconClass: 'text-info' },
  danger: { bar: 'bg-danger', icon: TriangleAlert, iconClass: 'text-danger' },
};

const TONE_BAR_VAR: Record<ToastTone, string> = {
  success: 'var(--pine)',
  info: 'var(--info)',
  danger: 'var(--danger)',
};

function ToastCard({ item, onDone }: { item: ToastItem; onDone: (id: number) => void }) {
  const [leaving, setLeaving] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => setLeaving(true), 3500);
    return () => clearTimeout(t);
  }, []);

  const Icon = TONE_STYLE[item.tone].icon;

  return (
    <motion.div
      layout="position"
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: 8 }}
      transition={{ type: 'spring', stiffness: 380, damping: 30 }}
      onAnimationComplete={() => {
        if (leaving) onDone(item.id);
      }}
      className="pointer-events-auto relative flex w-[min(92vw,380px)] items-center gap-3 overflow-hidden rounded-md border border-border bg-surface py-3 pl-4 pr-3 shadow-lg"
      role="status"
    >
      <span className={cn('absolute inset-y-0 left-0 w-[3px]', TONE_STYLE[item.tone].bar)} aria-hidden />
      <Icon className={cn('h-4 w-4 shrink-0', TONE_STYLE[item.tone].iconClass)} strokeWidth={2} />
      <span className="type-small min-w-0 flex-1 text-ink">{item.message}</span>
      {item.action && (
        <button
          type="button"
          onClick={() => {
            item.action!.onClick();
            onDone(item.id);
          }}
          className="type-small shrink-0 rounded-sm px-2 py-1 font-semibold text-brand transition-colors hover:bg-brand-soft"
        >
          {item.action.label}
        </button>
      )}
      {/* draining progress hairline */}
      <motion.span
        className="absolute bottom-0 left-0 h-[2px]"
        style={{ background: TONE_BAR_VAR[item.tone] }}
        initial={{ width: '100%' }}
        animate={{ width: leaving ? '100%' : '0%' }}
        transition={{ duration: 3.5, ease: 'linear' }}
        aria-hidden
      />
    </motion.div>
  );
}

export function ToastHost() {
  const [items, setItems] = useState<ToastItem[]>([]);

  useEffect(() => {
    return subscribeToasts((t) => setItems((prev) => [...prev.slice(-3), t]));
  }, []);

  const remove = (id: number) => setItems((prev) => prev.filter((t) => t.id !== id));

  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-[80px] z-[70] flex flex-col items-center gap-2 md:bottom-6">
      <AnimatePresence>
        {items.map((t) => (
          <ToastCard key={t.id} item={t} onDone={remove} />
        ))}
      </AnimatePresence>
    </div>
  );
}
