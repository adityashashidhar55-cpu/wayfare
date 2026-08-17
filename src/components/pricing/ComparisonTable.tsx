import { useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Check, ChevronDown, Crown, Minus } from 'lucide-react';
import { cn } from '@/lib/utils';

type Cell = { kind: 'check' } | { kind: 'dash' } | { kind: 'text'; text: string };

interface Row {
  feature: string;
  wanderer: Cell;
  voyager: Cell;
}

interface Section {
  title: string;
  rows: Row[];
}

const SECTIONS: Section[] = [
  {
    title: 'Planning',
    rows: [
      { feature: 'Itinerary + map', wanderer: { kind: 'check' }, voyager: { kind: 'check' } },
      {
        feature: 'Collaborators',
        wanderer: { kind: 'text', text: '3' },
        voyager: { kind: 'text', text: '∞' },
      },
      { feature: 'Optimize route', wanderer: { kind: 'dash' }, voyager: { kind: 'check' } },
      { feature: 'Auto-fill day', wanderer: { kind: 'dash' }, voyager: { kind: 'check' } },
    ],
  },
  {
    title: 'Import & offline',
    rows: [
      { feature: 'Email import', wanderer: { kind: 'dash' }, voyager: { kind: 'check' } },
      { feature: 'Offline maps', wanderer: { kind: 'dash' }, voyager: { kind: 'check' } },
      { feature: 'PDF export', wanderer: { kind: 'dash' }, voyager: { kind: 'check' } },
      {
        feature: 'Attachments',
        wanderer: { kind: 'text', text: '5' },
        voyager: { kind: 'text', text: '∞' },
      },
    ],
  },
  {
    title: 'Money',
    rows: [
      { feature: 'Expense splitting', wanderer: { kind: 'check' }, voyager: { kind: 'check' } },
      { feature: 'Multi-currency', wanderer: { kind: 'check' }, voyager: { kind: 'check' } },
      { feature: 'Export CSV', wanderer: { kind: 'check' }, voyager: { kind: 'check' } },
    ],
  },
  {
    title: 'Support',
    rows: [
      { feature: 'Community', wanderer: { kind: 'check' }, voyager: { kind: 'check' } },
      { feature: 'Priority', wanderer: { kind: 'dash' }, voyager: { kind: 'check' } },
    ],
  },
];

function CellValue({ cell, voyager }: { cell: Cell; voyager?: boolean }) {
  if (cell.kind === 'check')
    return voyager ? (
      <Crown className="h-4 w-4 text-ochre" strokeWidth={1.75} aria-label="Included in Voyager" />
    ) : (
      <Check className="h-4 w-4 text-pine" strokeWidth={2} aria-label="Included" />
    );
  if (cell.kind === 'dash')
    return <Minus className="h-4 w-4 text-ink-3" strokeWidth={1.75} aria-label="Not included" />;
  return <span className="tnum text-[14px] font-semibold text-ink">{cell.text}</span>;
}

/** Collapsible comparison table (pricing.md §S3). */
export function ComparisonTable() {
  const [open, setOpen] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(SECTIONS.map((s) => [s.title, true])),
  );

  return (
    <div className="overflow-hidden rounded-lg border border-border bg-surface shadow-sm">
      {/* Header */}
      <div className="grid grid-cols-[1fr_88px_88px] items-center border-b border-border px-5 py-4 sm:grid-cols-[1fr_140px_140px] sm:px-7">
        <span className="type-caption text-ink-3">Feature</span>
        <span className="type-caption text-center text-ink-3">Wanderer</span>
        <span className="type-caption text-center font-bold text-brand">Voyager</span>
      </div>

      {SECTIONS.map((section) => {
        const isOpen = open[section.title] ?? true;
        return (
          <div key={section.title} className="border-b border-border last:border-b-0">
            <button
              type="button"
              onClick={() => setOpen((o) => ({ ...o, [section.title]: !isOpen }))}
              aria-expanded={isOpen}
              className="flex w-full items-center justify-between bg-surface-2/50 px-5 py-3 transition-colors hover:bg-surface-2 sm:px-7"
            >
              <span className="type-h4 text-ink">{section.title}</span>
              <ChevronDown
                className={cn(
                  'h-4 w-4 text-ink-3 transition-transform duration-200',
                  !isOpen && '-rotate-90',
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
                  transition={{ duration: 0.25, ease: [0.22, 1, 0.36, 1] }}
                  className="overflow-hidden"
                >
                  {section.rows.map((row, i) => (
                    <motion.div
                      key={row.feature}
                      initial={{ opacity: 0, y: 8 }}
                      whileInView={{ opacity: 1, y: 0 }}
                      viewport={{ once: true, margin: '-40px' }}
                      transition={{ delay: i * 0.025, duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
                      className="grid grid-cols-[1fr_88px_88px] items-center border-t border-border px-5 py-3 sm:grid-cols-[1fr_140px_140px] sm:px-7"
                    >
                      <span className="type-small text-ink">{row.feature}</span>
                      <span className="flex justify-center">
                        <CellValue cell={row.wanderer} />
                      </span>
                      <span className="flex justify-center bg-brand-soft/60 py-1">
                        <CellValue cell={row.voyager} voyager />
                      </span>
                    </motion.div>
                  ))}
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        );
      })}
    </div>
  );
}
