/**
 * Friends planning (r12-friends) - create-session dialog on the Trips page.
 * Voyager-only: the server's UPGRADE_REQUIRED flips the dialog to the
 * standard soft-upsell (same pattern as CreateTripModal / SmartPacking).
 * On success it shows the organizer's personal link plus the first invite
 * link to copy for a friend.
 */
import { useState } from 'react';
import { useNavigate } from 'react-router';
import { AnimatePresence, motion } from 'framer-motion';
import { Check, Copy, Crown, Loader2, Users } from 'lucide-react';
import { toast } from 'sonner';
import { priceForBrowser } from '@contracts/premium';
import { trpc } from '@/providers/trpc';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Slider } from '@/components/ui/slider';
import { EASE_EXPO } from '@/lib/motion';

type Phase = 'form' | 'success' | 'upsell';

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

export function FriendsPlanningModal(props: Props) {
  const [session, setSession] = useState(0);
  return (
    <Dialog
      open={props.open}
      onOpenChange={(o) => {
        if (o) setSession((s) => s + 1);
        props.onOpenChange(o);
      }}
    >
      <FriendsPlanningContent key={session} {...props} />
    </Dialog>
  );
}

function FriendsPlanningContent({ onOpenChange }: Props) {
  const navigate = useNavigate();
  const [phase, setPhase] = useState<Phase>('form');
  const [title, setTitle] = useState('');
  const [deadlineDays, setDeadlineDays] = useState(5);
  const [minAvailable, setMinAvailable] = useState(2);
  const [budget, setBudget] = useState('');
  const [budgetCurrency, setBudgetCurrency] = useState('USD');
  const [submitting, setSubmitting] = useState(false);
  const [ownerPath, setOwnerPath] = useState<string | null>(null);

  const createSession = trpc.friends.createSession.useMutation();

  const submit = async () => {
    if (!title.trim() || submitting) return;
    setSubmitting(true);
    try {
      const budgetAmount = Number(budget);
      const res = await createSession.mutateAsync({
        title: title.trim(),
        deadlineAt: new Date(Date.now() + deadlineDays * 86_400_000),
        minAvailable,
        ...(budget.trim() && Number.isFinite(budgetAmount) && budgetAmount > 0
          ? { budgetCents: Math.round(budgetAmount * 100), budgetCurrency }
          : {}),
      });
      setOwnerPath(res.invitePath);
      setPhase('success');
    } catch (err) {
      if (err instanceof Error && err.message.includes('UPGRADE_REQUIRED')) {
        setPhase('upsell');
      } else {
        toast.error('Could not create the session', {
          description: err instanceof Error ? err.message : undefined,
        });
      }
    } finally {
      setSubmitting(false);
    }
  };

  const copyLink = async () => {
    if (!ownerPath) return;
    try {
      await navigator.clipboard.writeText(`${window.location.origin}${ownerPath}`);
      toast.success('Your link copied', { description: 'Open it to vote and mint invite links for friends.' });
    } catch {
      toast.error('Copy failed, open the session and copy from there.');
    }
  };

  return (
    <DialogContent
      style={{ maxWidth: 'min(480px, calc(100% - 2rem))' }}
      className="flex max-h-[92dvh] flex-col gap-0 overflow-hidden rounded-xl border-border bg-surface p-0 shadow-lg"
    >
      <AnimatePresence mode="wait" initial={false}>
        {phase === 'upsell' ? (
          <motion.div
            key="upsell"
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.28, ease: EASE_EXPO }}
            className="flex flex-col items-center px-8 py-12 text-center"
          >
            <span className="flex h-14 w-14 items-center justify-center rounded-full bg-ochre-soft text-ochre">
              <Crown className="h-6 w-6" strokeWidth={1.75} />
            </span>
            <h3 className="type-h3 mt-5 text-ink">Friends planning is a Voyager perk</h3>
            <p className="type-body mt-2 max-w-[42ch] text-ink-2">
              One Voyager in the group is enough, everyone else joins free with a link. Voyager
              unlocks friends planning, unlimited trips, and more, {priceForBrowser().yearly.label}.
            </p>
            <div className="mt-7 flex flex-wrap items-center justify-center gap-2">
              <Button variant="ghost" onClick={() => onOpenChange(false)}>
                Not now
              </Button>
              <Button variant="premium" onClick={() => navigate('/pricing')}>
                <Crown className="h-4 w-4" strokeWidth={1.75} />
                See Voyager plans
              </Button>
            </div>
          </motion.div>
        ) : phase === 'success' ? (
          <motion.div
            key="success"
            initial={{ opacity: 0, scale: 0.97 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.3, ease: EASE_EXPO }}
            className="flex flex-col items-center px-8 py-12 text-center"
          >
            <span className="flex h-14 w-14 items-center justify-center rounded-full bg-pine-soft text-pine">
              <Check className="h-6 w-6" strokeWidth={2} />
            </span>
            <h3 className="type-h3 mt-5 text-ink">Your planning session is live</h3>
            <p className="type-body mt-2 max-w-[42ch] text-ink-2">
              Open your session to vote your own dates and mint a personal invite link for each
              friend, links admit one person each, no account needed.
            </p>
            <div className="mt-7 flex flex-wrap items-center justify-center gap-2">
              <Button variant="ghost" onClick={copyLink}>
                <Copy className="h-4 w-4" strokeWidth={1.75} />
                Copy my link
              </Button>
              <Button onClick={() => ownerPath && navigate(ownerPath)}>
                <Users className="h-4 w-4" strokeWidth={1.75} />
                Open the session
              </Button>
            </div>
          </motion.div>
        ) : (
          <motion.div
            key="form"
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.28, ease: EASE_EXPO }}
            className="px-6 py-6 md:px-8"
          >
            <DialogHeader>
              <DialogTitle className="type-h3 text-ink">Plan with friends</DialogTitle>
              <DialogDescription className="type-small text-ink-2">
                Friends vote their dates and vibe; when enough align, Wayfare suggests destinations
                near everyone and turns it into a shared trip.
              </DialogDescription>
            </DialogHeader>

            <label className="type-small mt-5 block font-medium text-ink" htmlFor="fs-title">
              Trip working title
            </label>
            <Input
              id="fs-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g. Monsoon escape with the gang"
              maxLength={120}
              className="mt-2 h-11 rounded-md border-border-strong bg-surface"
            />

            <div className="mt-5 flex items-baseline justify-between">
              <span className="type-small font-medium text-ink">Voting deadline</span>
              <span className="type-caption text-ink-3 tnum">
                {deadlineDays} {deadlineDays === 1 ? 'day' : 'days'}
              </span>
            </div>
            <Slider
              value={[deadlineDays]}
              onValueChange={([v]) => setDeadlineDays(v ?? 5)}
              min={1}
              max={14}
              step={1}
              className="mt-3"
              aria-label="Voting deadline in days"
            />

            <label className="type-small mt-5 block font-medium text-ink" htmlFor="fs-min">
              Friends needed on one date to make it happen
            </label>
            <Input
              id="fs-min"
              type="number"
              min={1}
              max={50}
              value={minAvailable}
              onChange={(e) => setMinAvailable(Math.max(1, Math.min(50, Number(e.target.value) || 1)))}
              className="mt-2 h-11 w-28 rounded-md border-border-strong bg-surface tnum"
            />

            {/* r24-social: optional pooled group budget */}
            <label className="type-small mt-5 block font-medium text-ink" htmlFor="fs-budget">
              Pooled group budget <span className="font-normal text-ink-3">(optional)</span>
            </label>
            <div className="mt-2 flex gap-2">
              <select
                aria-label="Budget currency"
                value={budgetCurrency}
                onChange={(e) => setBudgetCurrency(e.target.value)}
                className="type-small h-11 rounded-md border border-border-strong bg-surface px-2 text-ink outline-none focus:border-brand"
              >
                {['USD', 'EUR', 'GBP', 'INR', 'JPY', 'AUD'].map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
              <Input
                id="fs-budget"
                type="number"
                min={0}
                inputMode="decimal"
                value={budget}
                onChange={(e) => setBudget(e.target.value)}
                placeholder="e.g. 1200 total for the group"
                className="h-11 flex-1 rounded-md border-border-strong bg-surface tnum"
              />
            </div>
            <p className="type-caption mt-1.5 text-ink-3">
              Shows on the session and, once you start the trip, as planned-vs-budget in the workspace.
            </p>

            <Button size="lg" pill className="mt-7 w-full" disabled={!title.trim() || submitting} onClick={submit}>
              {submitting ? <Loader2 className="h-4 w-4 animate-spin" strokeWidth={1.75} /> : <Users className="h-4 w-4" strokeWidth={1.75} />}
              Create the session
            </Button>
          </motion.div>
        )}
      </AnimatePresence>
    </DialogContent>
  );
}
