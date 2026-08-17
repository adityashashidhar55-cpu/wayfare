import { motion } from 'framer-motion';
import type { Variants } from 'framer-motion';
import { Gift, Users } from 'lucide-react';
import { trpc } from '@/providers/trpc';
import { CopyLinkField } from '@/components/CopyLinkField';
import { EASE_EXPO } from '@/lib/motion';

const item: Variants = {
  hidden: { opacity: 0, y: 12 },
  show: { opacity: 1, y: 0, transition: { duration: 0.32, ease: EASE_EXPO } },
};

/**
 * "Invite friends to Wayfare" (r14-linkfix): the user's personal referral
 * link (full URL, selectable) with copy/open controls and a count of friends
 * who joined through it.
 */
export function InviteFriendsCard() {
  const referralQ = trpc.auth.referralInfo.useQuery(undefined, { retry: false });
  const code = referralQ.data?.code;
  const joined = referralQ.data?.joined ?? 0;
  const url = code ? `${window.location.origin}/login?ref=${code}` : null;

  return (
    <motion.section
      variants={item}
      aria-label="Invite friends to Wayfare"
      className="rounded-xl border border-border bg-surface p-6 shadow-sm md:p-8"
    >
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex items-start gap-4">
          <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-brand-soft text-brand">
            <Gift className="h-5 w-5" strokeWidth={1.75} />
          </span>
          <div>
            <h2 className="type-h3 text-ink">Invite friends to Wayfare</h2>
            <p className="type-small mt-1 max-w-[52ch] text-ink-2">
              Share your personal link, anyone who signs up through it is counted as your invite.
            </p>
          </div>
        </div>
        <span className="type-caption inline-flex items-center gap-1.5 rounded-pill bg-pine-soft px-3 py-1.5 font-semibold text-pine tnum">
          <Users className="h-3.5 w-3.5" strokeWidth={1.75} />
          {joined === 0 ? 'No friends joined yet' : `${joined} ${joined === 1 ? 'friend' : 'friends'} joined`}
        </span>
      </div>

      {referralQ.isLoading ? (
        <div className="mt-5 h-9 animate-pulse rounded-md bg-surface-2" />
      ) : url ? (
        <CopyLinkField url={url} label="your Wayfare invite link" copiedLabel="Invite link copied" className="mt-5" />
      ) : (
        <p className="type-small mt-5 text-ink-3">Your invite link isn’t ready yet, try reloading.</p>
      )}
    </motion.section>
  );
}
