import { useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Plus } from 'lucide-react';
import { cn } from '@/lib/utils';

const FAQS = [
  {
    q: 'What happens to my trips if I cancel Voyager?',
    a: 'Nothing is deleted, ever. Premium features like route optimization and email import simply pause, and every trip, expense, and note stays right where you left it.',
  },
  {
    q: 'How does email import work?',
    a: 'Each trip gets its own address. Forward your flight and hotel confirmations to it, and we parse them into reservations automatically, dates, times, and confirmation codes included.',
  },
  {
    q: 'Do collaborators need Voyager too?',
    a: 'No. Only the trip owner needs Voyager, everyone they invite gets the full collaborative experience for free.',
  },
  {
    q: 'Is offline really offline?',
    a: 'Yes. Full maps and your complete itinerary are cached per trip, per city. Airplane mode changes nothing.',
  },
  {
    q: 'Can I switch monthly ↔ yearly?',
    a: 'Anytime. Switches are prorated automatically, so you only ever pay for what you use.',
  },
];

/** FAQ accordion (pricing.md §S5): hairlines, plus → × rotation, height spring. */
export function Faq() {
  const [openIdx, setOpenIdx] = useState<number | null>(0);

  return (
    <div className="divide-y divide-border border-y border-border">
      {FAQS.map((f, i) => {
        const isOpen = openIdx === i;
        return (
          <div key={f.q}>
            <button
              type="button"
              onClick={() => setOpenIdx(isOpen ? null : i)}
              aria-expanded={isOpen}
              className="flex w-full items-center justify-between gap-4 py-5 text-left transition-colors hover:text-brand"
            >
              <span className="text-[15px] font-semibold text-ink">{f.q}</span>
              <Plus
                className={cn(
                  'h-[18px] w-[18px] shrink-0 text-ink-3 transition-transform duration-[250ms] ease-expo',
                  isOpen && 'rotate-45 text-brand',
                )}
                strokeWidth={1.75}
              />
            </button>
            <AnimatePresence initial={false}>
              {isOpen && (
                <motion.div
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: 'auto', opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
                  className="overflow-hidden"
                >
                  <p className="max-w-[62ch] pb-5 text-[15px] leading-[26px] text-ink-2">{f.a}</p>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        );
      })}
    </div>
  );
}
