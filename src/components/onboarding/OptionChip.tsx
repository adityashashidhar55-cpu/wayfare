/**
 * Quiz selection primitives with the global chip-select micro-interaction
 * (design.md §7.2): background → brand-soft, check icon draws in
 * (stroke dash 240ms), scale .94 → 1 spring on select.
 */
import { useEffect, useRef } from 'react';
import { AnimatePresence, motion, useAnimation } from 'framer-motion';
import type { LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';

/** Animated check that draws itself in (stroke-dashoffset 240ms). */
export function DrawnCheck({ className }: { className?: string }) {
  return (
    <motion.svg
      viewBox="0 0 16 16"
      className={cn('h-4 w-4 shrink-0', className)}
      fill="none"
      aria-hidden
    >
      <motion.path
        d="M3.5 8.5l3 3 6-7"
        stroke="currentColor"
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
        initial={{ pathLength: 0, opacity: 0 }}
        animate={{ pathLength: 1, opacity: 1 }}
        exit={{ opacity: 0, transition: { duration: 0.12 } }}
        transition={{ duration: 0.24, ease: 'easeOut' }}
      />
    </motion.svg>
  );
}

function useSelectPop(selected: boolean) {
  const controls = useAnimation();
  const prev = useRef(selected);
  useEffect(() => {
    if (selected && !prev.current) {
      controls.start({
        scale: [0.94, 1],
        transition: { type: 'spring', stiffness: 500, damping: 28 },
      });
    }
    prev.current = selected;
  }, [selected, controls]);
  return controls;
}

interface OptionChipProps {
  label: string;
  icon?: LucideIcon;
  /** emoji shown in place of a Lucide icon (diet card row) */
  emoji?: string;
  selected: boolean;
  onClick: () => void;
  /** smaller, wrapping chip (Q4 interests) */
  small?: boolean;
  className?: string;
}

export function OptionChip({ label, icon: Icon, emoji, selected, onClick, small, className }: OptionChipProps) {
  const controls = useSelectPop(selected);
  return (
    <motion.button
      type="button"
      onClick={onClick}
      animate={controls}
      whileTap={{ scale: 0.96 }}
      transition={{ duration: 0.18 }}
      aria-pressed={selected}
      className={cn(
        'group inline-flex items-center gap-2 rounded-pill border text-left transition-colors duration-fast',
        small ? 'h-9 px-3.5 text-[13px] font-medium' : 'h-12 px-4 text-[14px] font-medium',
        selected
          ? 'border-brand bg-brand-soft text-brand'
          : 'border-border-strong bg-surface text-ink-2 hover:border-brand/50 hover:text-ink',
        className,
      )}
    >
      {Icon && (
        <Icon
          className={cn(
            'shrink-0 transition-colors duration-fast',
            small ? 'h-4 w-4' : 'h-[18px] w-[18px]',
            selected ? 'text-brand' : 'text-ink-3 group-hover:text-ink-2',
          )}
          strokeWidth={1.75}
        />
      )}
      {emoji && !Icon && (
        <span aria-hidden className={cn('shrink-0 leading-none', small ? 'text-[14px]' : 'text-[16px]')}>
          {emoji}
        </span>
      )}
      <span className="min-w-0 flex-1 truncate">{label}</span>
      <AnimatePresence>{selected && <DrawnCheck className="text-brand" />}</AnimatePresence>
    </motion.button>
  );
}

interface BudgetCardProps {
  title: string;
  blurb: string;
  icon: LucideIcon;
  selected: boolean;
  onClick: () => void;
}

/** Q2 segmented card: border → brand 2px, brand-soft wash, corner check draws. */
export function BudgetCard({ title, blurb, icon: Icon, selected, onClick }: BudgetCardProps) {
  const controls = useSelectPop(selected);
  return (
    <motion.button
      type="button"
      onClick={onClick}
      animate={controls}
      whileTap={{ scale: 0.97 }}
      aria-pressed={selected}
      className={cn(
        'relative flex flex-1 flex-col items-start gap-1 rounded-lg border-2 p-4 text-left transition-colors duration-fast sm:p-5',
        selected
          ? 'border-brand bg-brand-soft'
          : 'border-border-strong bg-surface hover:border-brand/50 hover:bg-surface-2',
      )}
    >
      <AnimatePresence>
        {selected && (
          <motion.span
            initial={{ scale: 0.6, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0.6, opacity: 0, transition: { duration: 0.12 } }}
            transition={{ type: 'spring', stiffness: 500, damping: 28 }}
            className="absolute right-3 top-3 flex h-5 w-5 items-center justify-center rounded-full bg-brand text-brand-ink"
          >
            <DrawnCheck className="h-3 w-3" />
          </motion.span>
        )}
      </AnimatePresence>
      <Icon
        className={cn('h-5 w-5 transition-colors duration-fast', selected ? 'text-brand' : 'text-ink-3')}
        strokeWidth={1.75}
      />
      <span className={cn('text-[14px] font-semibold transition-colors duration-fast', selected ? 'text-brand' : 'text-ink')}>
        {title}
      </span>
      <span className="type-caption leading-snug text-ink-3">{blurb}</span>
    </motion.button>
  );
}
