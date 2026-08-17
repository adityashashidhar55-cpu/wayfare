/**
 * Rewards (r24-smart, feature Q) - token balance, the virtual rewards
 * catalog, "My rewards" shelf and the recent token ledger. Virtual goods
 * only; nothing here is a real purchase.
 */
import { Armchair, CloudRain, Coins, Gift, Languages, Luggage, Map as MapIcon } from "lucide-react";
import { trpc } from "@/providers/trpc";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

const ICONS: Record<string, typeof Gift> = {
  luggage: Luggage,
  map: MapIcon,
  languages: Languages,
  armchair: Armchair,
  "cloud-rain": CloudRain,
};

const EARN_LABEL: Record<string, string> = {
  trip_created: "Trip created",
  trip_published: "Trip published",
  join_accepted: "Join request accepted",
  stop_booked: "Stop marked booked",
  friend_session: "Friend session completed",
  wishlist_added: "Wishlist trip added",
  day_finalized: "Day plan finalized",
  redeem: "Reward redeemed",
};

export default function Rewards() {
  const utils = trpc.useUtils();
  const q = trpc.tokens.state.useQuery(undefined, { retry: false });
  const redeem = trpc.tokens.redeem.useMutation({
    onSuccess: async () => {
      await Promise.all([utils.tokens.state.invalidate(), utils.notifications.list.invalidate()]);
    },
  });

  if (q.isLoading || !q.data) {
    return (
      <div className="mx-auto max-w-[860px] px-4 py-6 md:px-6">
        <Skeleton className="h-10 w-64" />
        <div className="mt-5 grid gap-3 sm:grid-cols-2">
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-36 rounded-xl" />
          ))}
        </div>
      </div>
    );
  }

  const { balance, catalog, redeemed, history } = q.data;
  const redeemedIds = new Set(redeemed.map((r) => r.rewardId));

  return (
    <div className="mx-auto max-w-[860px] px-4 py-6 md:px-6">
      <header className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="type-h2 flex items-center gap-2 text-ink">
            <Coins className="h-6 w-6 text-ochre" strokeWidth={1.75} />
            Tokens & rewards
          </h2>
          <p className="type-body mt-1 text-ink-2">
            Earn tokens for planning your trips, then trade them for handy extras. All virtual,
            all yours.
          </p>
        </div>
        <span
          className="type-h3 inline-flex items-center gap-2 rounded-pill border border-ochre/30 bg-ochre-soft px-4 py-2 text-ink"
          data-testid="rewards-balance"
        >
          <Coins className="h-5 w-5 text-ochre" strokeWidth={1.75} />
          <span className="tnum">{balance}</span> tokens
        </span>
      </header>

      {/* catalog */}
      <section aria-label="Rewards catalog">
        <h3 className="type-h3 mb-3 text-ink">Catalog</h3>
        <ul className="grid gap-3 sm:grid-cols-2">
          {catalog.map((r) => {
            const Icon = ICONS[r.icon] ?? Gift;
            const owned = redeemedIds.has(r.id);
            const affordable = balance >= r.cost;
            return (
              <li
                key={r.id}
                className={cn(
                  "flex flex-col rounded-xl border border-border bg-surface p-4 shadow-sm",
                  owned && "opacity-80",
                )}
              >
                <p className="type-h4 flex items-center gap-2 text-ink">
                  <span className="flex h-9 w-9 items-center justify-center rounded-md bg-brand-soft">
                    <Icon className="h-4.5 w-4.5 text-brand" strokeWidth={1.75} />
                  </span>
                  {r.name}
                </p>
                <p className="type-small mt-2 flex-1 text-ink-2">{r.description}</p>
                <div className="mt-3 flex items-center justify-between">
                  <span className="type-small tnum font-semibold text-ochre">{r.cost} tokens</span>
                  {owned ? (
                    <span className="type-caption rounded-pill bg-pine-soft px-2.5 py-1 font-semibold text-pine">
                      On your shelf
                    </span>
                  ) : (
                    <Button
                      size="sm"
                      disabled={!affordable || redeem.isPending}
                      title={affordable ? "Redeem" : "Not enough tokens yet"}
                      onClick={() => redeem.mutate({ rewardId: r.id })}
                      data-testid={`redeem-${r.id}`}
                    >
                      Redeem
                    </Button>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      </section>

      {/* shelf + history */}
      <div className="mt-8 grid gap-6 md:grid-cols-2">
        <section aria-label="My rewards">
          <h3 className="type-h3 mb-3 text-ink">My rewards</h3>
          {redeemed.length === 0 ? (
            <p className="type-small rounded-lg border border-dashed border-border p-4 text-ink-3">
              Nothing redeemed yet, your shelf is ready when you are.
            </p>
          ) : (
            <ul className="space-y-2">
              {redeemed.map((r) => {
                const meta = catalog.find((c) => c.id === r.rewardId);
                const Icon = ICONS[meta?.icon ?? ""] ?? Gift;
                return (
                  <li key={r.id} className="flex items-center gap-2.5 rounded-lg border border-border bg-surface px-3.5 py-2.5">
                    <Icon className="h-4 w-4 shrink-0 text-brand" strokeWidth={1.75} />
                    <span className="type-small min-w-0 flex-1 font-semibold text-ink">
                      {meta?.name ?? r.rewardId}
                    </span>
                    <span className="type-caption text-ink-3">
                      {new Date(r.createdAt).toLocaleDateString()}
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        <section aria-label="Token history">
          <h3 className="type-h3 mb-3 text-ink">Token history</h3>
          {history.length === 0 ? (
            <p className="type-small rounded-lg border border-dashed border-border p-4 text-ink-3">
              No tokens yet. Create a trip and you'll earn your first 20.
            </p>
          ) : (
            <ul className="space-y-1.5">
              {history.map((h) => (
                <li key={h.id} className="flex items-center justify-between gap-2 rounded-md px-2 py-1.5 hover:bg-surface-2">
                  <span className="type-small text-ink-2">{EARN_LABEL[h.kind] ?? h.kind}</span>
                  <span
                    className={cn(
                      "type-small tnum font-semibold",
                      h.amount >= 0 ? "text-pine" : "text-ochre",
                    )}
                  >
                    {h.amount >= 0 ? `+${h.amount}` : h.amount}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}
