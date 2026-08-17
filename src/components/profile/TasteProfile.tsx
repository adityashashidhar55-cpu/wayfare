import { useState } from 'react';
import { Link } from 'react-router';
import { motion } from 'framer-motion';
import { Check, Plus, RotateCcw, X } from 'lucide-react';
import { toast } from 'sonner';
import type { Preference } from '@contracts/types';
import { PREFERENCE_STYLES } from '@contracts/premium';
import { trpc } from '@/providers/trpc';
import { Button } from '@/components/ui/button';
import { EASE_EXPO } from '@/lib/motion';
import { BUDGET_BANDS, PACE_INFO, PACE_OPTIONS, STYLE_LABELS } from '@/components/trips/utils';
import { DIETARIES, DIET_META, parseDietary } from '@/lib/diet';
import type { Dietary } from '@/lib/diet';
import { cn } from '@/lib/utils';

/**
 * Travel style / taste profile (profile §S3): styles, budget band, and pace
 * edit inline via preferences.upsert; loves are removable chips with an
 * inline add field.
 */
export function TasteProfile({ pref }: { pref: Preference }) {
  const utils = trpc.useUtils();
  const [adding, setAdding] = useState(false);
  const [newLove, setNewLove] = useState('');

  const styles = pref.styles ?? [];
  const interests = pref.interests ?? [];
  const paceKey = pref.pace ?? 'balanced';
  const pace = PACE_INFO[paceKey] ?? PACE_INFO.balanced!;
  const budgetBand = pref.budgetBand ?? 'mid';
  const dietary = parseDietary(pref.dietary);

  const upsert = trpc.preferences.upsert.useMutation({
    onSuccess: () => {
      utils.preferences.get.invalidate();
      toast.success('Profile retuned');
    },
    onError: (e) => toast.error(e.message),
  });

  const toggleStyle = (style: string) => {
    const next = styles.includes(style) ? styles.filter((s) => s !== style) : [...styles, style];
    upsert.mutate({ styles: next });
  };

  const chooseBudget = (band: string) => {
    if (band !== budgetBand) upsert.mutate({ budgetBand: band });
  };

  const chooseDiet = (d: Dietary) => {
    if (d !== dietary) upsert.mutate({ dietary: d });
  };

  const choosePace = (key: string) => {
    if (key !== paceKey) upsert.mutate({ pace: key });
  };

  const removeLove = (love: string) => {
    upsert.mutate({ interests: interests.filter((i) => i !== love) });
  };

  const addLove = () => {
    const v = newLove.trim();
    if (!v) return;
    if (!interests.some((i) => i.toLowerCase() === v.toLowerCase())) {
      upsert.mutate({ interests: [...interests, v] });
    }
    setNewLove('');
    setAdding(false);
  };

  const empty = styles.length === 0 && interests.length === 0;

  return (
    <section aria-label="Travel style" className="rounded-xl border border-border bg-surface p-6 shadow-sm md:p-8">
      <div className="mb-6 flex items-center justify-between gap-3">
        <h3 className="type-h3 text-ink">Travel style</h3>
        <Button variant="ghost" size="sm" asChild>
          <Link to="/onboarding">
            <RotateCcw className="h-3.5 w-3.5" strokeWidth={1.75} />
            Retake quiz
          </Link>
        </Button>
      </div>

      {empty ? (
        <div className="flex flex-col items-start gap-3 rounded-lg bg-surface-2/60 p-5">
          <p className="type-body text-ink-2">
            No taste profile yet, take the 5-step quiz and Explore will tune itself to you.
          </p>
          <Button asChild>
            <Link to="/onboarding">Take the quiz</Link>
          </Button>
        </div>
      ) : (
        <div className="space-y-7">
          {/* STYLES */}
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: '-40px' }}
            transition={{ duration: 0.35, ease: EASE_EXPO }}
          >
            <span className="type-caption mb-2.5 block tracking-[0.1em] text-ink-3">STYLES</span>
            <div className="flex flex-wrap gap-2">
              {PREFERENCE_STYLES.map((style) => {
                const active = styles.includes(style);
                return (
                  <button
                    key={style}
                    type="button"
                    aria-pressed={active}
                    onClick={() => toggleStyle(style)}
                    className={cn(
                      'type-small inline-flex items-center gap-1.5 rounded-pill px-3.5 py-1.5 font-medium transition-all duration-fast',
                      active
                        ? 'bg-brand-soft font-semibold text-brand'
                        : 'bg-surface-2 text-ink-2 hover:text-ink',
                    )}
                  >
                    {active && <Check className="h-3.5 w-3.5" strokeWidth={2} />}
                    {STYLE_LABELS[style] ?? style}
                  </button>
                );
              })}
            </div>
          </motion.div>

          {/* BUDGET, single-select band chips */}
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: '-40px' }}
            transition={{ duration: 0.35, ease: EASE_EXPO, delay: 0.04 }}
          >
            <span className="type-caption mb-2.5 block tracking-[0.1em] text-ink-3">BUDGET</span>
            <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Budget band">
              {BUDGET_BANDS.map((band) => {
                const active = budgetBand === band.value;
                return (
                  <button
                    key={band.value}
                    type="button"
                    role="radio"
                    aria-checked={active}
                    title={band.caption}
                    onClick={() => chooseBudget(band.value)}
                    className={cn(
                      'type-small inline-flex items-center gap-1.5 rounded-pill px-3.5 py-1.5 font-medium transition-all duration-fast',
                      active
                        ? 'bg-brand-soft font-semibold text-brand'
                        : 'bg-surface-2 text-ink-2 hover:text-ink',
                    )}
                  >
                    {active && <Check className="h-3.5 w-3.5" strokeWidth={2} />}
                    {band.label}
                  </button>
                );
              })}
            </div>
          </motion.div>

          {/* DIET, single-select; restaurant picks tune to it wherever possible */}
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: '-40px' }}
            transition={{ duration: 0.35, ease: EASE_EXPO, delay: 0.06 }}
          >
            <span className="type-caption mb-2.5 block tracking-[0.1em] text-ink-3">FOOD &amp; DIET</span>
            <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Dietary preference">
              {DIETARIES.map((d) => {
                const active = dietary === d;
                return (
                  <button
                    key={d}
                    type="button"
                    role="radio"
                    aria-checked={active}
                    onClick={() => chooseDiet(d)}
                    className={cn(
                      'type-small inline-flex items-center gap-1.5 rounded-pill px-3.5 py-1.5 font-medium transition-all duration-fast',
                      active
                        ? 'bg-brand-soft font-semibold text-brand'
                        : 'bg-surface-2 text-ink-2 hover:text-ink',
                    )}
                  >
                    {active && <Check className="h-3.5 w-3.5" strokeWidth={2} />}
                    <span aria-hidden>{DIET_META[d].emoji}</span>
                    {DIET_META[d].label}
                  </button>
                );
              })}
            </div>
            <p className="type-caption mt-2 text-ink-3">
              Restaurant suggestions and generated days prefer {DIET_META[dietary].label.toLowerCase()}-friendly spots.
            </p>
          </motion.div>

          {/* PACE, pine slider, click a detent to retune */}
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: '-40px' }}
            transition={{ duration: 0.35, ease: EASE_EXPO, delay: 0.08 }}
          >
            <span className="type-caption mb-2.5 block tracking-[0.1em] text-ink-3">PACE</span>
            <div className="max-w-[420px]">
              <div className="type-small mb-2 flex items-center justify-between">
                <span className="font-semibold text-ink">{pace.label}</span>
                <span className="text-ink-3 tnum">{pace.stops}</span>
              </div>
              <div
                role="radiogroup"
                aria-label="Travel pace"
                className="relative py-2"
              >
                {/* track + pine fill */}
                <div className="relative h-1.5 rounded-full bg-border">
                  <motion.div
                    initial={false}
                    animate={{ width: `${((pace.detent - 1) / 4) * 100}%` }}
                    transition={{ duration: 0.28, ease: EASE_EXPO }}
                    className="absolute inset-y-0 left-0 rounded-full bg-pine"
                  />
                </div>
                {/* detent hit areas */}
                {PACE_OPTIONS.map((key) => {
                  const info = PACE_INFO[key]!;
                  const pct = ((info.detent - 1) / 4) * 100;
                  const active = key === paceKey;
                  return (
                    <button
                      key={key}
                      type="button"
                      role="radio"
                      aria-checked={active}
                      aria-label={`${info.label}, ${info.stops}`}
                      title={`${info.label}, ${info.stops}`}
                      onClick={() => choosePace(key)}
                      className="group absolute top-1/2 flex h-7 w-7 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full"
                      style={{ left: `${pct}%` }}
                    >
                      <span
                        className={cn(
                          'block rounded-full border-2 transition-all duration-fast',
                          active
                            ? 'h-4 w-4 border-pine bg-surface shadow-sm'
                            : 'h-2.5 w-2.5 border-border-strong bg-surface group-hover:border-pine group-hover:bg-pine-soft',
                        )}
                      />
                    </button>
                  );
                })}
              </div>
              <div className="type-caption mt-1.5 flex justify-between text-ink-3">
                <span>Slow mornings</span>
                <span>Dawn to midnight</span>
              </div>
            </div>
          </motion.div>

          {/* LOVES */}
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: '-40px' }}
            transition={{ duration: 0.35, ease: EASE_EXPO, delay: 0.16 }}
          >
            <span className="type-caption mb-2.5 block tracking-[0.1em] text-ink-3">LOVES</span>
            <div className="flex flex-wrap gap-2">
              {interests.map((love) => (
                <span
                  key={love}
                  className="type-small group inline-flex items-center gap-1 rounded-pill bg-surface-2 py-1.5 pl-3.5 pr-2 font-medium text-ink"
                >
                  {love}
                  <button
                    type="button"
                    aria-label={`Remove ${love}`}
                    onClick={() => removeLove(love)}
                    className="inline-flex h-4 w-4 items-center justify-center rounded-full text-ink-3 opacity-0 transition-all duration-fast hover:bg-border hover:text-ink group-hover:opacity-100"
                  >
                    <X className="h-3 w-3" strokeWidth={2} />
                  </button>
                </span>
              ))}
              {adding ? (
                <input
                  autoFocus
                  value={newLove}
                  onChange={(e) => setNewLove(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') addLove();
                    if (e.key === 'Escape') {
                      setAdding(false);
                      setNewLove('');
                    }
                  }}
                  onBlur={addLove}
                  placeholder="e.g. Coffee"
                  className="type-small w-[130px] rounded-pill border border-border-strong bg-surface px-3.5 py-1.5 outline-none placeholder:text-ink-3 focus:border-brand"
                  aria-label="Add something you love"
                />
              ) : (
                <button
                  type="button"
                  onClick={() => setAdding(true)}
                  className="type-small inline-flex items-center gap-1 rounded-pill border border-dashed border-border-strong px-3.5 py-1.5 font-medium text-ink-2 transition-colors duration-fast hover:border-brand hover:text-brand"
                >
                  <Plus className="h-3.5 w-3.5" strokeWidth={1.75} />
                  Add
                </button>
              )}
            </div>
          </motion.div>

          <p className="type-caption text-ink-3">Explore and auto-fill use this to tune recommendations.</p>
        </div>
      )}
    </section>
  );
}
