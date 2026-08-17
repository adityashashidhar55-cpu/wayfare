/**
 * The Taste Profile quiz flow (onboarding.md): welcome → 5 questions →
 * profile reveal. Used full-screen by /onboarding and in compact mode by
 * Explore's "Retune" modal (same components, no welcome/reveal).
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { useNavigate } from 'react-router';
import { AnimatePresence, motion } from 'framer-motion';
import { ArrowLeft, ArrowRight, Coffee, Sparkles, Zap } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Slider } from '@/components/ui/slider';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import CompassIllustration from '@/components/onboarding/CompassIllustration';
import ProfileReveal from '@/components/onboarding/ProfileReveal';
import { BudgetCard, OptionChip } from '@/components/onboarding/OptionChip';
import { toast } from '@/components/explore/toast';
import type { Dietary } from '@contracts/diet';
import { cn } from '@/lib/utils';
import {
  BUDGET_OPTIONS,
  COMPANION_OPTIONS,
  CURRENCY_OPTIONS,
  DIET_OPTIONS,
  INTEREST_OPTIONS,
  MAX_INTERESTS,
  PACE_DETENTS,
  STYLE_CHIPS,
  computeArchetype,
  stylesForChips,
} from '@/components/onboarding/quiz-data';

const EASE_EXPO = [0.22, 1, 0.36, 1] as [number, number, number, number];
const EASE_IN = [0.65, 0, 0.35, 1] as [number, number, number, number];

export interface QuizAnswers {
  chips: string[];
  styles: string[];
  budgetBand: string;
  pace: string;
  interests: string[];
  companions: string;
  homeCurrency: string;
  dietary: Dietary;
}

export interface QuizProps {
  /** full: welcome + 5 steps + reveal (page). compact: 5 steps only (modal). */
  mode?: 'full' | 'compact';
  initial?: Partial<QuizAnswers>;
  onFinish: (answers: QuizAnswers) => void;
  /** full mode only - "Skip for now" (→ /trips) */
  onSkip?: () => void;
}

// ── step transition variants (onboarding.md shell) ──────────────────────────
const stepVariants = {
  enter: (dir: number) => ({
    x: dir * 32,
    opacity: 0,
    transition: { duration: 0.32, ease: EASE_EXPO },
  }),
  center: { x: 0, opacity: 1, transition: { duration: 0.32, ease: EASE_EXPO } },
  exit: (dir: number) => ({
    x: dir * -32,
    opacity: 0,
    transition: { duration: 0.24, ease: EASE_IN },
  }),
};

// ── content-group stagger (60ms on enter: title → options → footer) ─────────
function Group({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <motion.div
      initial="hidden"
      animate="show"
      variants={{ hidden: {}, show: { transition: { staggerChildren: 0.06 } } }}
      className={className}
    >
      {children}
    </motion.div>
  );
}

function Item({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <motion.div
      variants={{
        hidden: { opacity: 0, y: 12 },
        show: { opacity: 1, y: 0, transition: { duration: 0.32, ease: EASE_EXPO } },
      }}
      className={className}
    >
      {children}
    </motion.div>
  );
}

/** Progress rail - 5 segments: completed brand sweep, current brand 50%, upcoming border-strong. */
function ProgressRail({ step }: { step: number }) {
  return (
    <div className="flex items-center gap-2" aria-hidden>
      {[1, 2, 3, 4, 5].map((i) => (
        <div key={i} className="h-1 w-12 overflow-hidden rounded-pill bg-border-strong">
          <motion.div
            className="h-full rounded-pill bg-brand"
            style={{ originX: 0 }}
            initial={false}
            animate={{ scaleX: step > i ? 1 : step === i ? 0.5 : 0 }}
            transition={{ duration: 0.4, ease: EASE_EXPO }}
          />
        </div>
      ))}
    </div>
  );
}

function StepHeading({ eyebrow, title }: { eyebrow: string; title: string }) {
  return (
    <>
      <Item>
        <span className="type-eyebrow text-brand">{eyebrow}</span>
      </Item>
      <Item>
        <h2 className="type-h2 mt-2 text-ink">{title}</h2>
      </Item>
    </>
  );
}

export default function Quiz({ mode = 'full', initial, onFinish, onSkip }: QuizProps) {
  const navigate = useNavigate();
  const compact = mode === 'compact';

  const [step, setStep] = useState(compact ? 1 : 0);
  const [dir, setDir] = useState(1);

  const [chips, setChips] = useState<string[]>(initial?.chips ?? []);
  const [budgetId, setBudgetId] = useState<string | null>(
    BUDGET_OPTIONS.find((o) => o.band === initial?.budgetBand)?.id ?? null,
  );
  const [paceIdx, setPaceIdx] = useState(() => {
    const idx = PACE_DETENTS.findIndex((d) => d.id === initial?.pace);
    return idx >= 0 ? idx : 2;
  });
  const [interests, setInterests] = useState<string[]>(initial?.interests ?? []);
  const [companions, setCompanions] = useState<string | null>(initial?.companions ?? null);
  const [currency, setCurrency] = useState(initial?.homeCurrency ?? 'USD');
  const [dietary, setDietary] = useState<Dietary>(
    DIET_OPTIONS.some((o) => o.id === initial?.dietary) ? initial!.dietary! : 'non-veg',
  );

  const autoAdvance = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => {
    if (autoAdvance.current) clearTimeout(autoAdvance.current);
  }, []);

  const answers = useMemo<QuizAnswers>(
    () => ({
      chips,
      styles: stylesForChips(chips),
      budgetBand: BUDGET_OPTIONS.find((o) => o.id === budgetId)?.band ?? 'mid',
      pace: PACE_DETENTS[paceIdx]?.id ?? 'balanced',
      interests,
      companions: companions ?? 'friends',
      homeCurrency: currency,
      dietary,
    }),
    [chips, budgetId, paceIdx, interests, companions, currency, dietary],
  );

  const archetype = useMemo(() => computeArchetype(answers.styles), [answers.styles]);

  const revealChips = useMemo(() => {
    const styleLabels = STYLE_CHIPS.filter((c) => chips.includes(c.id)).map((c) => c.label);
    const interestLabels = INTEREST_OPTIONS.filter((o) => interests.includes(o.id)).map((o) => o.label);
    return [...styleLabels, ...interestLabels].slice(0, 10);
  }, [chips, interests]);

  function go(next: number) {
    setDir(next > step ? 1 : -1);
    setStep(next);
  }

  function toggleChip(id: string) {
    setChips((prev) => (prev.includes(id) ? prev.filter((c) => c !== id) : [...prev, id]));
  }

  function toggleInterest(id: string) {
    setInterests((prev) => {
      if (prev.includes(id)) return prev.filter((i) => i !== id);
      if (prev.length >= MAX_INTERESTS) {
        toast('Six is plenty, your profile stays sharp.', { kind: 'info', icon: <Sparkles className="h-4 w-4 text-ochre" strokeWidth={1.75} /> });
        return prev;
      }
      return [...prev, id];
    });
  }

  function pickBudget(id: string) {
    setBudgetId(id);
    if (autoAdvance.current) clearTimeout(autoAdvance.current);
    // delight: auto-advance after 350ms (still reversible via Back)
    autoAdvance.current = setTimeout(() => go(step + 1), 350);
  }

  function finish() {
    onFinish(answers);
    if (!compact) go(6);
  }

  const canContinue =
    step === 1 ? chips.length >= 1 :
    step === 2 ? budgetId !== null :
    step === 5 ? companions !== null :
    true;

  const caption =
    step >= 1 && step <= 5 ? `Step ${step} of 5` : step === 6 ? 'Your profile' : 'Welcome';

  const body = (
    <>
      {/* progress rail + step caption */}
      <div className={cn('flex items-center', compact ? 'justify-center' : 'justify-between')}>
        <ProgressRail step={Math.min(step, 5) === 0 ? 0 : step === 6 ? 6 : step} />
        {!compact && (
          <AnimatePresence mode="wait" initial={false}>
            <motion.span
              key={caption}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.2 }}
              className="type-caption text-ink-3"
            >
              {caption}
            </motion.span>
          </AnimatePresence>
        )}
      </div>

      <div className={cn(compact ? 'mt-6' : 'mt-5 rounded-xl border border-border bg-surface p-6 shadow-md sm:px-10 sm:py-12')}>
        <AnimatePresence mode="wait" custom={dir} initial={false}>
          <motion.div
            key={step}
            custom={dir}
            variants={stepVariants}
            initial="enter"
            animate="center"
            exit="exit"
          >
            {/* ── S0 · welcome ─────────────────────────────────────────── */}
            {step === 0 && (
              <Group className="flex flex-col items-center text-center">
                <Item>
                  <CompassIllustration />
                </Item>
                <Item>
                  <h1 className="mt-6 font-serif text-[34px] font-[560] leading-[1.15] tracking-[-0.02em] text-ink">
                    Let&rsquo;s learn your travel style.
                  </h1>
                </Item>
                <Item>
                  <p className="type-body mt-3 max-w-[46ch] text-ink-2">
                    Five quick questions. Wayfare tunes Explore, hidden gems, and daily pace to fit
                    you, not everyone.
                  </p>
                </Item>
                <Item className="mt-7">
                  <Button size="lg" pill autoFocus onClick={() => go(1)}>
                    Let&rsquo;s go
                    <ArrowRight className="h-4 w-4" strokeWidth={1.75} />
                  </Button>
                </Item>
                <Item>
                  <p className="type-caption mt-3 text-ink-3">Takes about a minute</p>
                </Item>
              </Group>
            )}

            {/* ── Q1 · travel styles ───────────────────────────────────── */}
            {step === 1 && (
              <Group>
                <StepHeading eyebrow="01 · Style" title="What kind of traveler are you?" />
                <Item className="mt-6">
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 md:grid-cols-3">
                    {STYLE_CHIPS.map((chip) => (
                      <OptionChip
                        key={chip.id}
                        label={chip.label}
                        icon={chip.icon}
                        selected={chips.includes(chip.id)}
                        onClick={() => toggleChip(chip.id)}
                        className="w-full"
                      />
                    ))}
                  </div>
                </Item>
                <Item>
                  <StepFooter
                    onBack={() => go(step - 1)}
                    backDisabled={compact}
                    onNext={() => go(2)}
                    nextDisabled={!canContinue}
                    meta={
                      <span className="type-caption text-ink-3">
                        {chips.length} selected
                      </span>
                    }
                  />
                </Item>
              </Group>
            )}

            {/* ── Q2 · budget posture ──────────────────────────────────── */}
            {step === 2 && (
              <Group>
                <StepHeading eyebrow="02 · Budget" title="How do you like to spend?" />
                <Item className="mt-6">
                  <div className="flex flex-col gap-3 sm:flex-row">
                    {BUDGET_OPTIONS.map((opt) => (
                      <BudgetCard
                        key={opt.id}
                        title={opt.title}
                        blurb={opt.blurb}
                        icon={opt.icon}
                        selected={budgetId === opt.id}
                        onClick={() => pickBudget(opt.id)}
                      />
                    ))}
                  </div>
                </Item>
                <Item>
                  <StepFooter onBack={() => go(1)} hideNext />
                </Item>
              </Group>
            )}

            {/* ── Q3 · pace ────────────────────────────────────────────── */}
            {step === 3 && (
              <Group>
                <StepHeading eyebrow="03 · Pace" title="What's your ideal pace?" />
                <Item className="mt-8">
                  <div className="flex items-center justify-between">
                    <span className="type-small inline-flex items-center gap-1.5 text-ink-3">
                      <Coffee className="h-4 w-4" strokeWidth={1.75} />
                      Slow mornings
                    </span>
                    <span className="type-small inline-flex items-center gap-1.5 text-ink-3">
                      Dawn to midnight
                      <Zap className="h-4 w-4" strokeWidth={1.75} />
                    </span>
                  </div>
                  <Slider
                    value={[paceIdx]}
                    onValueChange={(v) => setPaceIdx(v[0] ?? 2)}
                    min={0}
                    max={4}
                    step={1}
                    aria-label="Trip pace"
                    className={cn(
                      'mt-5',
                      '[&_[data-slot=slider-track]]:h-2 [&_[data-slot=slider-track]]:bg-border-strong',
                      '[&_[data-slot=slider-range]]:bg-pine',
                      '[&_[data-slot=slider-thumb]]:size-6 [&_[data-slot=slider-thumb]]:border-border [&_[data-slot=slider-thumb]]:bg-surface [&_[data-slot=slider-thumb]]:shadow-md',
                      'max-sm:[&_[data-slot=slider-thumb]]:size-7',
                    )}
                  />
                  <div className="mt-2 flex justify-between px-[3px]" aria-hidden>
                    {PACE_DETENTS.map((d, i) => (
                      <span
                        key={d.id}
                        className={cn(
                          'h-1.5 w-1.5 rounded-full transition-colors duration-fast',
                          i === paceIdx ? 'bg-pine' : 'bg-border-strong',
                        )}
                      />
                    ))}
                  </div>
                  <div className="mt-4 flex min-h-6 justify-center">
                    <AnimatePresence mode="wait" initial={false}>
                      <motion.p
                        key={paceIdx}
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        transition={{ duration: 0.2 }}
                        className="type-small text-center text-pine"
                      >
                        {PACE_DETENTS[paceIdx]?.caption}
                      </motion.p>
                    </AnimatePresence>
                  </div>
                </Item>
                <Item>
                  <StepFooter onBack={() => go(2)} onNext={() => go(4)} />
                </Item>
              </Group>
            )}

            {/* ── Q4 · interests ───────────────────────────────────────── */}
            {step === 4 && (
              <Group>
                <StepHeading eyebrow="04 · Interests" title="Anything you love to seek out?" />
                <Item className="mt-6">
                  <div className="flex flex-wrap gap-2.5">
                    {INTEREST_OPTIONS.map((opt) => (
                      <OptionChip
                        key={opt.id}
                        label={opt.label}
                        small
                        selected={interests.includes(opt.id)}
                        onClick={() => toggleInterest(opt.id)}
                      />
                    ))}
                  </div>
                </Item>
                <Item>
                  <StepFooter
                    onBack={() => go(3)}
                    onNext={() => go(5)}
                    meta={
                      <span className="type-caption text-ink-3">
                        {interests.length} of {MAX_INTERESTS}
                      </span>
                    }
                  />
                </Item>
              </Group>
            )}

            {/* ── Q5 · companions & currency ───────────────────────────── */}
            {step === 5 && (
              <Group>
                <StepHeading eyebrow="05 · Companions" title="Who's usually along?" />
                <Item className="mt-6">
                  <div className="flex flex-wrap gap-2.5">
                    {COMPANION_OPTIONS.map((opt) => (
                      <OptionChip
                        key={opt.id}
                        label={opt.label}
                        selected={companions === opt.id}
                        onClick={() => setCompanions(opt.id)}
                      />
                    ))}
                  </div>
                </Item>
                <Item className="mt-7">
                  <span className="type-eyebrow text-ink-3">Food &amp; diet</span>
                  <div className="mt-2 flex flex-wrap gap-2.5" role="radiogroup" aria-label="Dietary preference">
                    {DIET_OPTIONS.map((opt) => (
                      <OptionChip
                        key={opt.id}
                        label={opt.label}
                        emoji={opt.emoji}
                        small
                        selected={dietary === opt.id}
                        onClick={() => setDietary(opt.id)}
                      />
                    ))}
                  </div>
                  <p className="type-caption mt-2 text-ink-3">
                    We&rsquo;ll tune restaurant picks to match wherever we can.
                  </p>
                </Item>
                <Item className="mt-7">
                  <span className="type-eyebrow text-ink-3">Home currency</span>
                  <Select value={currency} onValueChange={setCurrency}>
                    <SelectTrigger className="mt-2 h-11 w-full sm:w-[280px]">
                      <SelectValue placeholder="Home currency" />
                    </SelectTrigger>
                    <SelectContent>
                      {CURRENCY_OPTIONS.map((c) => (
                        <SelectItem key={c.code} value={c.code}>
                          <span className="tnum font-semibold">{c.code}</span>
                          <span className="text-ink-3">&nbsp; · {c.label}</span>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </Item>
                <Item>
                  <StepFooter
                    onBack={() => go(4)}
                    onNext={finish}
                    nextDisabled={!canContinue}
                    nextLabel={compact ? 'Save & retune' : 'Build my profile'}
                  />
                </Item>
              </Group>
            )}

            {/* ── S6 · profile reveal ──────────────────────────────────── */}
            {step === 6 && (
              <ProfileReveal
                archetype={archetype}
                chips={revealChips}
                onCreateTrip={() => navigate('/trips?new=1')}
                onExplore={() => navigate('/explore')}
              />
            )}
          </motion.div>
        </AnimatePresence>
      </div>
    </>
  );

  if (compact) return <div className="w-full">{body}</div>;

  return (
    <div className="mx-auto w-full max-w-[640px]">
      {/* minimal chrome: skip link */}
      <div className="mb-5 flex justify-end">
        <button
          type="button"
          onClick={onSkip}
          className="type-small text-ink-3 transition-colors duration-fast hover:text-ink"
        >
          Skip for now
        </button>
      </div>
      {body}
    </div>
  );
}

interface StepFooterProps {
  onBack?: () => void;
  backDisabled?: boolean;
  onNext?: () => void;
  nextDisabled?: boolean;
  nextLabel?: string;
  hideNext?: boolean;
  meta?: ReactNode;
}

function StepFooter({ onBack, backDisabled, onNext, nextDisabled, nextLabel, hideNext, meta }: StepFooterProps) {
  return (
    <div className="mt-8 flex items-center gap-3 max-sm:w-full">
      <Button
        variant="ghost"
        onClick={onBack}
        disabled={backDisabled}
        className="max-sm:flex-[1]"
      >
        <ArrowLeft className="h-4 w-4" strokeWidth={1.75} />
        Back
      </Button>
      <div className="flex-1 text-center max-sm:hidden">{meta}</div>
      {!hideNext && (
        <Button onClick={onNext} disabled={nextDisabled} className="max-sm:flex-[2]">
          {nextLabel ?? 'Continue'}
          <ArrowRight className="h-4 w-4" strokeWidth={1.75} />
        </Button>
      )}
    </div>
  );
}
