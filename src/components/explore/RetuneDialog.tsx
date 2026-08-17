/**
 * "Retune" modal (explore.md §S1) - the onboarding quiz in compact mode.
 * Saving re-sweeps the feed (invalidate explore.list + preferences.get) and
 * toasts "Explore retuned".
 */
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Skeleton } from '@/components/ui/skeleton';
import Quiz from '@/components/onboarding/Quiz';
import type { QuizAnswers } from '@/components/onboarding/Quiz';
import { STYLE_CHIPS, computeArchetype } from '@/components/onboarding/quiz-data';
import { parseDietary } from '@/lib/diet';
import { toast } from '@/components/explore/toast';
import { trpc } from '@/providers/trpc';

interface RetuneDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export default function RetuneDialog({ open, onOpenChange }: RetuneDialogProps) {
  const utils = trpc.useUtils();
  const prefs = trpc.preferences.get.useQuery(undefined, { enabled: open });

  const upsert = trpc.preferences.upsert.useMutation({
    onSuccess: () => {
      void utils.preferences.get.invalidate();
      void utils.explore.list.invalidate();
      toast('Explore retuned', { kind: 'success' });
      onOpenChange(false);
    },
    onError: () => toast('Could not save, please try again.', { kind: 'warn' }),
  });

  const initial: Partial<QuizAnswers> | undefined = prefs.data
    ? {
        chips: (prefs.data.styles ?? []).filter((s) => STYLE_CHIPS.some((c) => c.id === s)),
        budgetBand: prefs.data.budgetBand ?? undefined,
        pace: prefs.data.pace ?? undefined,
        interests: prefs.data.interests ?? [],
        companions: prefs.data.companions ?? undefined,
        homeCurrency: prefs.data.homeCurrency ?? 'USD',
        dietary: parseDietary(prefs.data.dietary),
      }
    : undefined;

  function handleFinish(a: QuizAnswers) {
    upsert.mutate({
      styles: a.styles,
      budgetBand: a.budgetBand,
      pace: a.pace,
      interests: a.interests,
      companions: a.companions,
      homeCurrency: a.homeCurrency,
      dietary: a.dietary,
      archetype: computeArchetype(a.styles),
      onboardingDone: true,
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85dvh] w-[calc(100vw-32px)] max-w-[640px] overflow-y-auto rounded-xl p-5 sm:p-8">
        <DialogHeader>
          <DialogTitle className="type-h3 text-ink">Retune your taste</DialogTitle>
        </DialogHeader>
        {prefs.isLoading ? (
          <div className="mt-4 space-y-3">
            <Skeleton className="h-6 w-2/3" />
            <Skeleton className="h-12 w-full" />
            <Skeleton className="h-12 w-full" />
            <Skeleton className="h-12 w-full" />
          </div>
        ) : (
          <Quiz mode="compact" initial={initial} onFinish={handleFinish} />
        )}
      </DialogContent>
    </Dialog>
  );
}
