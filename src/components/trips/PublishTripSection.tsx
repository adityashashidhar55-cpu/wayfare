/**
 * PublishTripSection (r24-social, feature P) - the "Publish trip" block in the
 * workspace Share dialog. Owner-only: publish (explicit opt-in) mints a public
 * /p/:slug page, toggle join requests, copy the link, unpublish takes it down.
 */
import { useState } from 'react';
import { Globe2, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { Link } from 'react-router';
import { trpc } from '@/providers/trpc';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { CopyLinkField } from '@/components/CopyLinkField';

export function PublishTripSection({ tripId, isOwner }: { tripId: number; isOwner: boolean }) {
  const utils = trpc.useUtils();
  const state = trpc.publish.getForTrip.useQuery({ tripId });
  const [summary, setSummary] = useState('');

  const refresh = () => utils.publish.getForTrip.invalidate({ tripId });
  const publish = trpc.publish.publish.useMutation({
    onSuccess: () => {
      void refresh();
      toast.success('Trip published', { description: 'Your public page is live, share the link.' });
    },
    onError: (e) => toast.error(e.message),
  });
  const unpublish = trpc.publish.unpublish.useMutation({
    onSuccess: () => {
      void refresh();
      toast.success('Unpublished', { description: 'The public page now 404s.' });
    },
    onError: (e) => toast.error(e.message),
  });
  const setOpen = trpc.publish.setOpen.useMutation({
    onSuccess: () => void refresh(),
    onError: (e) => toast.error(e.message),
  });

  if (!isOwner) return null;
  if (state.isLoading) {
    return (
      <div className="rounded-lg border border-border bg-surface-2 p-3">
        <Loader2 className="h-4 w-4 animate-spin text-ink-3" strokeWidth={1.75} />
      </div>
    );
  }

  const pub = state.data;
  const url = pub?.published ? `${window.location.origin}/p/${pub.slug}` : null;

  return (
    <div className="rounded-lg border border-border bg-surface-2 p-3">
      <div className="flex items-center justify-between gap-3">
        <span className="min-w-0">
          <span className="type-small flex items-center gap-1.5 font-semibold text-ink">
            <Globe2 className="h-4 w-4 text-brand" strokeWidth={1.75} />
            Publish trip
          </span>
          <span className="type-caption block text-ink-3">
            A public page with the itinerary and your updates, people can ask to join. Opt-in, off by default.
          </span>
        </span>
      </div>

      {pub?.published && url ? (
        <div className="mt-2.5 space-y-2.5">
          <CopyLinkField url={url} label="published trip link" copiedLabel="Public page link copied" />
          <div className="flex items-center justify-between gap-3">
            <span className="type-caption text-ink-2">
              Accepting join requests
              {pub.pendingRequests > 0 ? ` · ${pub.pendingRequests} waiting` : ''}
            </span>
            <Switch
              checked={pub.isOpen}
              onCheckedChange={(on) => setOpen.mutate({ tripId, isOpen: on })}
              disabled={setOpen.isPending}
              aria-label="Accept join requests"
            />
          </div>
          <div className="flex items-center gap-2">
            <Button variant="secondary" size="sm" asChild>
              <Link to={`/p/${pub.slug}`}>Open public page</Link>
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="text-danger"
              disabled={unpublish.isPending}
              onClick={() => unpublish.mutate({ tripId })}
            >
              Unpublish
            </Button>
          </div>
        </div>
      ) : (
        <div className="mt-2.5 space-y-2">
          <textarea
            value={summary}
            onChange={(e) => setSummary(e.target.value)}
            placeholder="One line for the public page (optional), e.g. “4 days in Kyoto, two seats open!”"
            aria-label="Public summary"
            rows={2}
            maxLength={500}
            className="type-small w-full rounded-md border border-border-strong bg-surface px-3 py-2 text-ink outline-none placeholder:text-ink-3 focus:border-brand"
          />
          <Button
            size="sm"
            pill
            disabled={publish.isPending}
            onClick={() => publish.mutate({ tripId, summary: summary.trim() || undefined, isOpen: true })}
          >
            {publish.isPending ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" strokeWidth={1.75} />
            ) : (
              <Globe2 className="h-3.5 w-3.5" strokeWidth={1.75} />
            )}
            Publish this trip
          </Button>
        </div>
      )}
    </div>
  );
}
