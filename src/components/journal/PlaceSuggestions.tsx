/**
 * PlaceSuggestions - chips for places auto-detected in the journal story.
 * Corpus matches ("In library", pine/clay accents) can be attached with one
 * click. OSM matches (ochre accents) are imported into the library by the
 * suggest pipeline - those chips ("Added to library") attach the same way;
 * the rare unverifiable OSM hit stays informational ("via OSM"). Every chip
 * can be dismissed.
 */
import { AnimatePresence, motion } from 'framer-motion';
import { MapPin, Plus, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { PlaceSuggestion } from './journal-utils';

interface PlaceSuggestionsProps {
  suggestions: PlaceSuggestion[];
  onAccept: (s: PlaceSuggestion) => void;
  onDismiss: (key: string) => void;
}

export function PlaceSuggestions({ suggestions, onAccept, onDismiss }: PlaceSuggestionsProps) {
  if (!suggestions.length) return null;
  return (
    <div className="mt-3" aria-live="polite">
      <p className="type-caption text-ink-3">FOUND IN YOUR STORY</p>
      <ul className="mt-2 flex flex-wrap gap-2">
        <AnimatePresence initial={false}>
          {suggestions.map((s) => {
            const isCorpus = s.source === 'corpus';
            /** imported OSM hits come back with a placeId - attachable too */
            const attachable = s.placeId != null;
            return (
              <motion.li
                key={s.key}
                layout="position"
                initial={{ opacity: 0, scale: 0.94 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.94 }}
                transition={{ duration: 0.18, ease: 'easeOut' }}
                className={cn(
                  'type-small inline-flex items-center gap-1.5 rounded-pill py-1.5 pl-3 pr-1.5 text-ink',
                  isCorpus ? 'bg-pine-soft' : 'bg-ochre-soft',
                )}
              >
                <MapPin
                  className={cn('h-3.5 w-3.5', isCorpus ? 'text-brand' : 'text-ochre')}
                  strokeWidth={1.75}
                />
                <span className="font-semibold">{s.name}</span>
                <span className="text-ink-3">· {[s.city, s.country].filter(Boolean).join(', ')}</span>
                <span
                  className={cn(
                    'rounded-pill px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-[0.06em]',
                    isCorpus ? 'bg-pine/15 text-pine' : 'bg-ochre/15 text-ochre',
                  )}
                >
                  {isCorpus ? 'In library' : attachable ? 'Added to library' : 'via OSM'}
                </span>
                {attachable && (
                  <button
                    type="button"
                    aria-label={`Attach ${s.name}`}
                    title={`Attach ${s.name}`}
                    onClick={() => onAccept(s)}
                    className="ml-0.5 inline-flex h-5 w-5 items-center justify-center rounded-full text-ink-3 transition-colors duration-fast hover:bg-surface hover:text-pine"
                  >
                    <Plus className="h-3 w-3" strokeWidth={2} />
                  </button>
                )}
                <button
                  type="button"
                  aria-label={`Dismiss ${s.name}`}
                  title={`Dismiss ${s.name}`}
                  onClick={() => onDismiss(s.key)}
                  className={cn(
                    'inline-flex h-5 w-5 items-center justify-center rounded-full text-ink-3 transition-colors duration-fast hover:bg-surface hover:text-danger',
                    !attachable && 'ml-0.5',
                  )}
                >
                  <X className="h-3 w-3" strokeWidth={2} />
                </button>
              </motion.li>
            );
          })}
        </AnimatePresence>
      </ul>
    </div>
  );
}
