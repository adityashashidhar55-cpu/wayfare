import { AnimatePresence, motion } from 'framer-motion';

/**
 * Digit roll-flip (pricing.md §S1): when the value changes, each character
 * rolls vertically - old slides up/out, new in - 300ms expo, staggered 40ms.
 */
export function RollingPrice({
  text,
  className,
}: {
  text: string;
  className?: string;
}) {
  return (
    <span className={className} style={{ display: 'inline-flex', overflow: 'hidden' }}>
      {text.split('').map((ch, i) => (
        <span key={`${i}`} style={{ display: 'inline-block', position: 'relative' }}>
          <AnimatePresence mode="popLayout" initial={false}>
            <motion.span
              key={ch}
              initial={{ y: '110%', opacity: 0 }}
              animate={{ y: '0%', opacity: 1 }}
              exit={{ y: '-110%', opacity: 0 }}
              transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1], delay: i * 0.04 }}
              style={{ display: 'inline-block', whiteSpace: 'pre' }}
            >
              {ch}
            </motion.span>
          </AnimatePresence>
        </span>
      ))}
    </span>
  );
}
