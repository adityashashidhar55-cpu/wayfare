/**
 * NotificationBell (r24-smart) - AppShell header bell with unread count and
 * a dropdown of recent notifications. Polls every 30s. Kinds: weather,
 * travel, wishlist, tokens, reward.
 */
import { Bell, CloudRain, Coins, Gift, Heart, MapPin } from "lucide-react";
import { Link } from "react-router";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { trpc } from "@/providers/trpc";
import { cn } from "@/lib/utils";

const KIND_ICON: Record<string, typeof Bell> = {
  weather: CloudRain,
  travel: MapPin,
  wishlist: Heart,
  tokens: Coins,
  reward: Gift,
};

function timeAgo(iso: string | Date): string {
  const t = new Date(iso).getTime();
  const mins = Math.max(0, Math.round((Date.now() - t) / 60000));
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const h = Math.round(mins / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.round(h / 24)}d ago`;
}

export default function NotificationBell() {
  const utils = trpc.useUtils();
  const q = trpc.notifications.list.useQuery(undefined, {
    refetchInterval: 30_000,
    retry: false,
  });
  const markRead = trpc.notifications.markRead.useMutation({
    onSuccess: () => utils.notifications.list.invalidate(),
  });
  const markAll = trpc.notifications.markAllRead.useMutation({
    onSuccess: () => utils.notifications.list.invalidate(),
  });

  const unread = q.data?.unread ?? 0;
  const items = q.data?.notifications ?? [];

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={unread > 0 ? `Notifications, ${unread} unread` : "Notifications"}
          className="relative inline-flex h-9 w-9 items-center justify-center rounded-md text-ink-2 transition-colors duration-fast hover:bg-surface-2 hover:text-ink"
        >
          <Bell className="h-[18px] w-[18px]" strokeWidth={1.75} />
          {unread > 0 ? (
            <span
              data-testid="notif-unread-count"
              className="type-caption absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-pill bg-brand px-1 font-semibold text-brand-ink"
            >
              {unread > 9 ? "9+" : unread}
            </span>
          ) : null}
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-[340px] rounded-xl p-0">
        <div className="flex items-center justify-between border-b border-border px-3.5 py-2.5">
          <p className="type-small font-semibold text-ink">Notifications</p>
          {unread > 0 ? (
            <button
              type="button"
              onClick={() => markAll.mutate()}
              className="type-caption font-semibold text-brand transition-colors duration-fast hover:underline"
            >
              Mark all read
            </button>
          ) : null}
        </div>
        <div className="max-h-[380px] overflow-y-auto">
          {items.length === 0 ? (
            <p className="type-small px-3.5 py-6 text-center text-ink-3">
              Nothing yet, weather advisories and trip updates land here.
            </p>
          ) : (
            items.map((n) => {
              const Icon = KIND_ICON[n.kind] ?? Bell;
              const cls = cn(
                "flex w-full items-start gap-2.5 px-3.5 py-2.5 text-left transition-colors duration-fast hover:bg-surface-2",
                !n.readAt && "bg-brand-soft/40",
              );
              const inner = (
                <>
                  <Icon className="mt-0.5 h-4 w-4 shrink-0 text-ink-3" strokeWidth={1.75} />
                  <span className="min-w-0 flex-1">
                    <span className={cn("type-small block text-ink", !n.readAt && "font-semibold")}>
                      {n.title}
                    </span>
                    {n.body ? (
                      <span className="type-caption mt-0.5 block text-ink-2">{n.body}</span>
                    ) : null}
                    <span className="type-caption mt-1 block text-ink-3">{timeAgo(n.createdAt)}</span>
                  </span>
                  {!n.readAt ? (
                    <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-brand" aria-label="Unread" />
                  ) : null}
                </>
              );
              const read = () => {
                if (!n.readAt) markRead.mutate({ id: n.id });
              };
              return n.tripId ? (
                <Link key={n.id} to={`/trips/${n.tripId}`} className={cls} onClick={read}>
                  {inner}
                </Link>
              ) : (
                <button key={n.id} type="button" onClick={read} className={cls}>
                  {inner}
                </button>
              );
            })
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
