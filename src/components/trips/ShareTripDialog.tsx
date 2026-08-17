import { useState } from 'react';
import { Link } from 'react-router';
import { Crown, Loader2, Mail, UserPlus, X } from 'lucide-react';
import { toast } from 'sonner';
import { trpc } from '@/providers/trpc';
import { useAuth } from '@/hooks/useAuth';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { UserAvatar } from '@/components/UserAvatar';
import { CopyLinkField } from '@/components/CopyLinkField';
import { PublishTripSection } from '@/components/trips/PublishTripSection';
import { cn } from '@/lib/utils';
import type { ListedTrip } from '@/components/trips/utils';

function nameFromEmail(email: string): string {
  const local = email.split('@')[0] ?? email;
  return local
    .split(/[._-]+/)
    .filter(Boolean)
    .map((p) => p[0]?.toUpperCase() + p.slice(1))
    .join(' ') || email;
}

/**
 * Share dialog (dashboard §S2): real trip members from the API, invite by
 * email via trips.addMember (editor/viewer roles), and a public read-only
 * link (share.enableShareLink → /shared/:token). Free tier: 3 collaborators
 * (UPGRADE_REQUIRED → soft Voyager nudge).
 */
export function ShareTripDialog({
  trip,
  tier,
  open,
  onOpenChange,
}: {
  trip: ListedTrip;
  tier: 'wanderer' | 'voyager';
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const utils = trpc.useUtils();
  const { user } = useAuth();
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<'editor' | 'viewer'>('editor');
  const [limitHit, setLimitHit] = useState(false);

  const isOwner = user?.id === trip.ownerId;

  const addMember = trpc.trips.addMember.useMutation({
    onSuccess: (res) => {
      utils.trips.list.invalidate();
      setEmail('');
      toast.success(
        res.linked
          ? 'Added, it’s on their Trips page now.'
          : 'Invited, they’ll see it as soon as they sign up with this email.',
      );
    },
    onError: (e) => {
      if (e.message === 'UPGRADE_REQUIRED') setLimitHit(true);
      else toast.error(e.message);
    },
  });

  const removeMember = trpc.trips.removeMember.useMutation({
    onSuccess: () => {
      utils.trips.list.invalidate();
      toast.success('Removed from the trip.');
    },
    onError: (e) => toast.error(e.message),
  });

  // ── Public link ──────────────────────────────────────────────────────────
  const shareState = trpc.share.getShareState.useQuery({ tripId: trip.id }, { enabled: open });
  const toggleLink = trpc.share.enableShareLink.useMutation({
    onSuccess: () => utils.share.getShareState.invalidate({ tripId: trip.id }),
    onError: (e) => toast.error(e.message),
  });
  const disableLink = trpc.share.disableShareLink.useMutation({
    onSuccess: () => {
      utils.share.getShareState.invalidate({ tripId: trip.id });
      toast.success('Public link turned off.');
    },
    onError: (e) => toast.error(e.message),
  });

  const linkEnabled = shareState.data?.enabled ?? false;
  const shareUrl = shareState.data?.token ? `${window.location.origin}/shared/${shareState.data.token}` : null;
  const linkBusy = toggleLink.isPending || disableLink.isPending;

  const invite = () => {
    const value = email.trim();
    if (!value || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) {
      toast.error('Enter a valid email address');
      return;
    }
    addMember.mutate({ tripId: trip.id, name: nameFromEmail(value), email: value, role });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="rounded-xl sm:max-w-[480px]">
        <DialogHeader>
          <DialogTitle className="type-h3">Share “{trip.title}”</DialogTitle>
          <DialogDescription className="type-small text-ink-2">
            Tripmates can edit the itinerary, add places, and split expenses.
          </DialogDescription>
        </DialogHeader>

        {/* Members (real, from API) */}
        <ul className="space-y-2">
          {trip.members.map((m) => {
            const pending = m.userId == null && m.role !== 'owner';
            return (
              <li key={m.id} className="flex items-center gap-3 rounded-md px-2 py-1.5 transition-colors hover:bg-surface-2">
                <span
                  className="inline-flex rounded-full"
                  style={{ boxShadow: m.presenceColor ? `0 0 0 2px ${m.presenceColor}` : undefined }}
                >
                  <UserAvatar name={m.name} className="h-8 w-8 text-[12px]" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="type-small block truncate text-ink">{m.name}</span>
                  {m.email && (
                    <span className="type-caption block truncate text-ink-3">
                      {m.email}
                      {pending && ' · invited'}
                    </span>
                  )}
                </span>
                <span className="type-caption rounded-pill bg-surface-2 px-2 py-0.5 text-ink-3">
                  {m.role === 'owner' ? 'Owner' : m.role === 'editor' ? 'Can edit' : 'Can view'}
                </span>
                {isOwner && m.role !== 'owner' && (
                  <button
                    type="button"
                    aria-label={`Remove ${m.name}`}
                    title={`Remove ${m.name}`}
                    disabled={removeMember.isPending}
                    onClick={() => removeMember.mutate({ tripId: trip.id, memberId: m.id })}
                    className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-ink-3 transition-colors duration-fast hover:bg-surface hover:text-danger"
                  >
                    <X className="h-3.5 w-3.5" strokeWidth={2} />
                  </button>
                )}
              </li>
            );
          })}
        </ul>

        {/* Invite */}
        <form
          onSubmit={(e) => {
            e.preventDefault();
            invite();
          }}
          className="flex gap-2"
        >
          <div className="relative flex-1">
            <Mail className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-3" strokeWidth={1.75} />
            <Input
              value={email}
              onChange={(e) => {
                setEmail(e.target.value);
                setLimitHit(false);
              }}
              type="email"
              placeholder="friend@example.com"
              className="h-10 rounded-md border-border-strong bg-surface pl-9"
              aria-label="Invite by email"
            />
          </div>
          {/* Role: editor (default) or viewer */}
          <div className="flex overflow-hidden rounded-md border border-border-strong" role="radiogroup" aria-label="Invite role">
            {(['editor', 'viewer'] as const).map((r) => (
              <button
                key={r}
                type="button"
                role="radio"
                aria-checked={role === r}
                onClick={() => setRole(r)}
                className={cn(
                  'type-caption px-2.5 font-medium transition-colors duration-fast',
                  role === r ? 'bg-pine text-white' : 'bg-surface text-ink-3 hover:text-ink',
                )}
              >
                {r === 'editor' ? 'Can edit' : 'Can view'}
              </button>
            ))}
          </div>
          <Button type="submit" variant="secondary" disabled={addMember.isPending}>
            <UserPlus className="h-4 w-4" strokeWidth={1.75} />
            Invite
          </Button>
        </form>
        <p className="type-caption text-ink-3">
          Invites attach automatically when they sign up with this email. Free tier: up to 3 collaborators.
        </p>
        {limitHit && tier === 'wanderer' && (
          <Link
            to="/pricing"
            className="type-small inline-flex items-center gap-1.5 font-semibold text-ochre transition-colors hover:brightness-110"
          >
            <Crown className="h-3.5 w-3.5" strokeWidth={1.75} />
            Need more seats? Voyager has unlimited collaborators.
          </Link>
        )}

        {/* r24-social P: publish the trip as a public page (owner only) */}
        <PublishTripSection tripId={trip.id} isOwner={isOwner} />

        {/* Public link */}
        <div className="rounded-lg border border-border bg-surface-2 p-3">
          <div className="flex items-center justify-between gap-3">
            <span className="min-w-0">
              <span className="type-small block font-semibold text-ink">Public link</span>
              <span className="type-caption block text-ink-3">
                Anyone with the link sees a read-only itinerary, no sign-in needed.
              </span>
            </span>
            {linkBusy ? (
              <Loader2 className="h-4 w-4 shrink-0 animate-spin text-ink-3" strokeWidth={1.75} />
            ) : (
              <Switch
                checked={linkEnabled}
                onCheckedChange={(on) =>
                  on ? toggleLink.mutate({ tripId: trip.id }) : disableLink.mutate({ tripId: trip.id })
                }
                disabled={shareState.isLoading}
                aria-label="Toggle public link"
              />
            )}
          </div>
          {linkEnabled && shareUrl && (
            <CopyLinkField url={shareUrl} label="public share link" className="mt-2.5" />
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
