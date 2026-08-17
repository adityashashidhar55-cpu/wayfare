/**
 * Wayfare toast (design.md §7.2 / §10.4) - surface + shadow-lg + left 3px
 * status color, icon + message + optional action, slides up 16px + fade
 * (320ms spring), auto-dismiss 3.5s with a draining progress hairline.
 * Bottom-center on desktop, above the bottom nav on mobile.
 *
 * Usage: call `toast("Saved", { action: { label: "View", onClick } })` from
 * anywhere and mount `<ToastHost />` once per page.
 */
import { useEffect, useState, useSyncExternalStore } from 'react';
import type { ReactNode } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Check, Info, TriangleAlert } from 'lucide-react';

export interface ToastAction {
  label: string;
  onClick: () => void;
}

export interface ToastOptions {
  kind?: 'success' | 'info' | 'warn';
  icon?: ReactNode;
  action?: ToastAction;
  duration?: number;
}

interface ToastItem extends ToastOptions {
  id: number;
  message: string;
}

let items: ToastItem[] = [];
const listeners = new Set<() => void>();
const timers = new Map<number, ReturnType<typeof setTimeout>>();
let seq = 0;

function emit() {
  listeners.forEach((l) => l());
}

export function dismissToast(id: number) {
  const timer = timers.get(id);
  if (timer) clearTimeout(timer);
  timers.delete(id);
  if (items.some((t) => t.id === id)) {
    items = items.filter((t) => t.id !== id);
    emit();
  }
}

export function toast(message: string, opts: ToastOptions = {}): number {
  const id = ++seq;
  const duration = opts.duration ?? 3500;
  items = [...items.slice(-2), { id, message, ...opts, duration }];
  emit();
  timers.set(
    id,
    setTimeout(() => dismissToast(id), duration),
  );
  return id;
}

function subscribe(cb: () => void) {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

function getSnapshot() {
  return items;
}

const KIND_BAR: Record<NonNullable<ToastOptions['kind']>, string> = {
  success: 'var(--success)',
  info: 'var(--info)',
  warn: 'var(--ochre)',
};

const KIND_ICON: Record<NonNullable<ToastOptions['kind']>, ReactNode> = {
  success: <Check className="h-4 w-4 text-success" strokeWidth={2} />,
  info: <Info className="h-4 w-4 text-info" strokeWidth={1.75} />,
  warn: <TriangleAlert className="h-4 w-4 text-ochre" strokeWidth={1.75} />,
};

function ToastCard({ item }: { item: ToastItem }) {
  const kind = item.kind ?? 'success';
  const duration = item.duration ?? 3500;
  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: 8, transition: { duration: 0.18 } }}
      transition={{ type: 'spring', stiffness: 380, damping: 30 }}
      className="pointer-events-auto relative flex w-full max-w-sm items-center gap-2.5 overflow-hidden rounded-md border border-border bg-surface py-3 pl-4 pr-3 shadow-lg"
      role="status"
    >
      <span className="absolute inset-y-0 left-0 w-[3px]" style={{ background: KIND_BAR[kind] }} />
      <span className="shrink-0">{item.icon ?? KIND_ICON[kind]}</span>
      <span className="type-small min-w-0 flex-1 text-ink">{item.message}</span>
      {item.action && (
        <button
          type="button"
          onClick={() => {
            item.action?.onClick();
            dismissToast(item.id);
          }}
          className="type-small shrink-0 font-semibold text-brand transition-colors duration-fast hover:text-brand-strong"
        >
          {item.action.label}
        </button>
      )}
      <motion.span
        initial={{ scaleX: 1 }}
        animate={{ scaleX: 0 }}
        transition={{ duration: duration / 1000, ease: 'linear' }}
        className="absolute bottom-0 left-0 h-[2px] w-full origin-left bg-border-strong"
      />
    </motion.div>
  );
}

/**
 * Mounted host registry - only the first-mounted ToastHost renders. The ⌘K
 * palette (AppShell-level) mounts one app-wide so toasts work on every page;
 * page-level hosts (Explore, CityBuilder) then become inert instead of
 * double-rendering the same store. Registration lives in an effect so React
 * StrictMode's mount/unmount simulation can't leak a stale primary.
 */
const mountedHosts: symbol[] = [];

export function ToastHost() {
  const current = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  const [id] = useState(() => Symbol('toast-host'));
  const [primary, setPrimary] = useState(false);
  useEffect(() => {
    mountedHosts.push(id);
    setPrimary(mountedHosts[0] === id);
    return () => {
      const i = mountedHosts.indexOf(id);
      if (i >= 0) mountedHosts.splice(i, 1);
    };
  }, [id]);
  if (!primary) return null;
  return (
    <div
      className="pointer-events-none fixed inset-x-0 bottom-[76px] z-[70] flex flex-col items-center gap-2 px-4 md:bottom-6"
      aria-live="polite"
    >
      <AnimatePresence mode="popLayout">
        {current.map((t) => (
          <ToastCard key={t.id} item={t} />
        ))}
      </AnimatePresence>
    </div>
  );
}
