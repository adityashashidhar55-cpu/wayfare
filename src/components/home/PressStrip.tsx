import { motion, useReducedMotion } from 'framer-motion';
import { EASE_EXPO } from '@/lib/motion';

const PRESS = [
  { name: 'Condé Traveler', serif: true },
  { name: 'TechCrunch', serif: false },
  { name: 'The Verge', serif: false },
  { name: 'Monocle', serif: true },
  { name: 'AFAR', serif: false },
];

/** S2 - Press / proof strip. */
export default function PressStrip() {
  const reduced = useReducedMotion();
  return (
    <section className="border-y border-border">
      <div className="mx-auto max-w-[1200px] px-6 py-12">
        <p className="type-caption mb-7 text-center text-ink-3">AS FEATURED IN</p>
        <div className="flex flex-wrap items-center justify-center gap-x-12 gap-y-4">
          {PRESS.map((p, i) => (
            <motion.span
              key={p.name}
              initial={{ opacity: 0 }}
              whileInView={{ opacity: 1 }}
              viewport={{ once: true, margin: '0px 0px -15% 0px' }}
              transition={{ duration: reduced ? 0.3 : 0.6, ease: EASE_EXPO, delay: i * 0.08 }}
              className={
                (p.serif
                  ? 'font-serif text-[19px] italic font-medium'
                  : 'text-[16px] font-semibold tracking-[0.06em]') +
                ' text-ink-3/70 transition-colors duration-fast hover:text-ink-2'
              }
            >
              {p.name}
            </motion.span>
          ))}
        </div>
      </div>
    </section>
  );
}
