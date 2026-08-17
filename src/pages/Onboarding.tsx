/**
 * Onboarding - Travel-style preference quiz (/onboarding).
 * Builds the user's Taste Profile in 5 steps and reveals the generated
 * archetype, then persists via trpc.preferences.upsert (onboarding.md).
 */
import { useNavigate } from 'react-router';
import Quiz from '@/components/onboarding/Quiz';
import type { QuizAnswers } from '@/components/onboarding/Quiz';
import { STYLE_CHIPS, computeArchetype } from '@/components/onboarding/quiz-data';
import { parseDietary } from '@/lib/diet';
import { ToastHost, toast } from '@/components/explore/toast';
import { Skeleton } from '@/components/ui/skeleton';
import { trpc } from '@/providers/trpc';

export default function Onboarding() {
  const navigate = useNavigate();
  const utils = trpc.useUtils();
  const prefs = trpc.preferences.get.useQuery();

  const upsert = trpc.preferences.upsert.useMutation({
    onSuccess: () => {
      void utils.preferences.get.invalidate();
      void utils.explore.list.invalidate();
    },
    onError: () => toast('Could not save your profile, please try again.', { kind: 'warn' }),
  });

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

  return (
    <div className="flex min-h-[calc(100dvh-64px)] justify-center px-4 pb-24 pt-24 sm:px-6 md:items-center md:py-16">
      {prefs.isLoading ? (
        <div className="w-full max-w-[640px]">
          <div className="flex gap-2">
            {[1, 2, 3, 4, 5].map((i) => (
              <Skeleton key={i} className="h-1 w-12 rounded-pill" />
            ))}
          </div>
          <div className="mt-5 rounded-xl border border-border bg-surface p-6 shadow-md sm:px-10 sm:py-12">
            <Skeleton className="mx-auto h-[180px] w-60 rounded-xl" />
            <Skeleton className="mx-auto mt-6 h-8 w-3/4" />
            <Skeleton className="mx-auto mt-3 h-4 w-full max-w-[46ch]" />
            <Skeleton className="mx-auto mt-7 h-12 w-40 rounded-pill" />
          </div>
        </div>
      ) : (
        <Quiz mode="full" initial={initial} onSkip={() => navigate('/trips')} onFinish={handleFinish} />
      )}
      <ToastHost />
    </div>
  );
}
