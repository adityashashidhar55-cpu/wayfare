import type { ReactNode } from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import { EASE_EXPO } from '@/lib/motion';
import { cn } from '@/lib/utils';

/**
 * Default marketing reveal (design.md §7.2): y 32→0, opacity 0→1, 700ms
 * expo, trigger when the element top crosses 78% of the viewport.
 */
export function Reveal({
  children,
  className,
  delay = 0,
  y = 32,
}: {
  children: ReactNode;
  className?: string;
  delay?: number;
  y?: number;
}) {
  const reduced = useReducedMotion();
  return (
    <motion.div
      initial={{ opacity: 0, y: reduced ? 0 : y }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: '0px 0px -22% 0px' }}
      transition={{ duration: 0.7, ease: EASE_EXPO, delay }}
      className={className}
    >
      {children}
    </motion.div>
  );
}

/** Eyebrow / kicker label. */
export function Eyebrow({ children, className }: { children: ReactNode; className?: string }) {
  return <span className={cn('type-eyebrow text-brand', className)}>{children}</span>;
}
