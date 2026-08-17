import { useRef } from 'react';
import { Link } from 'react-router';
import { motion, useReducedMotion, useScroll, useTransform } from 'framer-motion';
import { Users } from 'lucide-react';
import { EASE_EXPO } from '@/lib/motion';

const WORDS = 'The next trip is already calling.'.split(' ');
const NBSP = '\u00A0';

/** Word-by-word rising headline, triggered when the block scrolls into view. */
function WordStagger({ words, className }: { words: string[]; className?: string }) {
  const reduced = useReducedMotion();
  return (
    <motion.h2
      className={className}
      initial="hidden"
      whileInView="show"
      viewport={{ once: true }}
      variants={{ hidden: {}, show: { transition: { staggerChildren: 0.06 } } }}
    >
      {words.map((w, i) => (
        <span key={`${w}-${i}`} className="inline-block overflow-hidden pb-[0.08em] align-bottom">
          <motion.span
            className="inline-block"
            variants={{
              hidden: reduced ? { opacity: 0 } : { y: '110%', opacity: 0 },
              show: { y: 0, opacity: 1, transition: { duration: 0.8, ease: EASE_EXPO } },
            }}
          >
            {w}
            {i < words.length - 1 ? NBSP : ''}
          </motion.span>
        </span>
      ))}
    </motion.h2>
  );
}

/** S7 - CTA band with slow parallax over the desert-dusk photo. */
export default function CtaBand() {
  const ref = useRef<HTMLElement>(null);
  const reduced = useReducedMotion();
  const { scrollYProgress } = useScroll({ target: ref, offset: ['start end', 'end start'] });
  const bgY = useTransform(scrollYProgress, [0, 1], ['-7%', '7%']);

  return (
    <section ref={ref} className="relative h-[480px] overflow-hidden">
      {/* parallax background */}
      <motion.div style={reduced ? undefined : { y: bgY }} className="absolute -inset-y-[10%] inset-x-0">
        <img src="/cta-band.jpg" alt="" className="photo h-full w-full object-cover" />
      </motion.div>
      {/* warm dark scrim */}
      <div
        className="absolute inset-0"
        style={{ background: 'linear-gradient(180deg, rgba(22,19,15,.55) 0%, rgba(22,19,15,.25) 100%)' }}
      />

      <div className="relative z-[2] flex h-full flex-col items-center justify-center px-6 text-center">
        <WordStagger words={WORDS} className="type-display max-w-[16ch] text-[#FAF7F1]" />
        <motion.p
          initial={{ opacity: 0, y: reduced ? 0 : 16 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.7, ease: EASE_EXPO, delay: 0.35 }}
          className="type-body-l mt-4 text-[#FAF7F1]/80"
        >
          Set up in two minutes. Free forever for small trips.
        </motion.p>
        <motion.div
          initial={{ opacity: 0, y: reduced ? 0 : 16 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.7, ease: EASE_EXPO, delay: 0.45 }}
          className="mt-8 flex flex-col items-center gap-3"
        >
          <div className="flex flex-wrap items-center justify-center gap-3">
            <Link
              to="/login"
              className="type-body inline-flex h-12 items-center rounded-pill bg-bg px-7 font-semibold text-ink shadow-lg transition-all duration-fast animate-pulse-ring hover:-translate-y-px hover:animate-none active:scale-[0.97]"
            >
              Create an itinerary, free
            </Link>
            {/* r13-entry: dual CTA, friends planning as an equal path */}
            <Link
              to="/friends"
              className="type-body inline-flex h-12 items-center gap-2 rounded-pill border border-[#FAF7F1]/45 px-6 font-semibold text-[#FAF7F1] transition-all duration-fast hover:-translate-y-px hover:bg-[#FAF7F1]/10 active:scale-[0.97]"
            >
              <Users className="h-4 w-4" strokeWidth={1.75} />
              Plan with friends, vote dates together
            </Link>
          </div>
          <span className="type-caption text-[#FAF7F1]/70">No card required</span>
        </motion.div>
      </div>
    </section>
  );
}
