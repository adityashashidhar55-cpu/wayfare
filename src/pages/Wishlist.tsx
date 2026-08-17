/**
 * Wishlist (r24-smart, feature O) - unplanned want-to-do trips. Adding and
 * browsing is free; the per-destination best-time advisor (climate + cost
 * seasonality + crowds) is Voyager. Cards highlight when a best month is
 * coming up within 2 months.
 */
import { useState } from "react";
import { CalendarHeart, Crown, Heart, Plus, Trash2 } from "lucide-react";
import { Link } from "react-router";
import { trpc } from "@/providers/trpc";
import { useTier } from "@/hooks/useTier";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

/** Months starting within the next 2 (inclusive of the current one). */
function soonMonths(): Set<number> {
  const m = new Date().getMonth() + 1;
  return new Set([0, 1, 2].map((k) => ((m - 1 + k) % 12) + 1));
}

function BestTimeCard({ destination }: { destination: string }) {
  const { isPremium } = useTier();
  const q = trpc.wishlist.bestTime.useQuery(
    { destination },
    { enabled: isPremium, staleTime: 24 * 60 * 60_000, retry: false },
  );

  if (!isPremium) {
    return (
      <div className="mt-3 flex items-center justify-between gap-3 rounded-lg border border-dashed border-ochre/40 bg-ochre-soft/40 px-3 py-2.5">
        <p className="type-small flex items-center gap-1.5 text-ink-2">
          <Crown className="h-3.5 w-3.5 text-ochre" strokeWidth={1.75} />
          Best-time advisor is a Voyager feature.
        </p>
        <Link to="/pricing" className="type-caption shrink-0 font-semibold text-brand hover:underline">
          Upgrade
        </Link>
      </div>
    );
  }
  if (!q.data) return null;

  const soon = soonMonths();
  return (
    <div className="mt-3 rounded-lg border border-border bg-surface-2/50 p-3" data-testid="best-time-card">
      <p className="type-eyebrow text-ink-3">Best time to go</p>
      <ul className="mt-2 space-y-2">
        {q.data.top.map((m) => (
          <li key={m.month} className="flex items-start gap-2.5">
            <span
              className={cn(
                "type-caption tnum mt-0.5 inline-flex h-6 min-w-6 items-center justify-center rounded-pill px-1.5 font-semibold",
                soon.has(m.month) ? "bg-pine-soft text-pine" : "bg-surface text-ink-2",
              )}
            >
              {m.score}
            </span>
            <span className="min-w-0">
              <span className="type-small block font-semibold text-ink">
                {m.name}
                {soon.has(m.month) ? (
                  <span className="type-caption ml-1.5 rounded-pill bg-pine-soft px-1.5 py-0.5 font-semibold text-pine">
                    coming up
                  </span>
                ) : null}
              </span>
              <span className="type-caption block text-ink-3">{m.reasons.slice(0, 2).join(" · ")}</span>
            </span>
          </li>
        ))}
      </ul>
      <p className="type-caption mt-2 text-ink-3">
        Typical climate by season{q.data.matchedDestination ? "" : " (generic profile, destination not in our curated table yet)"}.
      </p>
    </div>
  );
}

export default function Wishlist() {
  const utils = trpc.useUtils();
  const list = trpc.wishlist.list.useQuery(undefined, { retry: false });
  const add = trpc.wishlist.add.useMutation({
    onSuccess: async () => {
      await Promise.all([utils.wishlist.list.invalidate(), utils.tokens.state.invalidate()]);
      setTitle("");
      setDestination("");
      setNotes("");
    },
  });
  const remove = trpc.wishlist.remove.useMutation({
    onSuccess: () => utils.wishlist.list.invalidate(),
  });

  const [title, setTitle] = useState("");
  const [destination, setDestination] = useState("");
  const [notes, setNotes] = useState("");
  const canAdd = title.trim().length > 0 && destination.trim().length > 0 && !add.isPending;

  return (
    <div className="mx-auto max-w-[860px] px-4 py-6 md:px-6">
      <header className="mb-5">
        <h2 className="type-h2 flex items-center gap-2 text-ink">
          <Heart className="h-6 w-6 text-brand" strokeWidth={1.75} />
          Trip wishlist
        </h2>
        <p className="type-body mt-1 text-ink-2">
          Someday-maybe journeys. Voyager members get the best months to go, and we nudge you when
          one of them is coming up.
        </p>
      </header>

      {/* add form */}
      <form
        className="mb-6 grid gap-2 rounded-xl border border-border bg-surface p-4 sm:grid-cols-[1fr_1fr_auto]"
        onSubmit={(e) => {
          e.preventDefault();
          if (canAdd) add.mutate({ title: title.trim(), destination: destination.trim(), notes: notes.trim() || undefined });
        }}
      >
        <Input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Trip idea, e.g. Cherry blossom week"
          aria-label="Wishlist title"
          className="bg-bg"
        />
        <Input
          value={destination}
          onChange={(e) => setDestination(e.target.value)}
          placeholder="Destination, e.g. Kyoto, Japan"
          aria-label="Wishlist destination"
          className="bg-bg"
        />
        <Button type="submit" disabled={!canAdd} className="gap-1.5">
          <Plus className="h-4 w-4" strokeWidth={2} />
          Add
        </Button>
        <Input
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="Notes (optional)"
          aria-label="Wishlist notes"
          className="bg-bg sm:col-span-3"
        />
      </form>

      {list.isLoading ? (
        <div className="grid gap-3 sm:grid-cols-2">
          {[0, 1].map((i) => (
            <Skeleton key={i} className="h-40 rounded-xl" />
          ))}
        </div>
      ) : (list.data?.items.length ?? 0) === 0 ? (
        <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed border-border px-6 py-14 text-center">
          <CalendarHeart className="h-8 w-8 text-ink-3" strokeWidth={1.5} />
          <p className="type-h3 text-ink">No wishes yet</p>
          <p className="type-body max-w-[40ch] text-ink-2">
            Park the trips you dream about here. When the timing is right, we'll tell you.
          </p>
        </div>
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2">
          {list.data!.items.map((w) => (
            <li
              key={w.id}
              className="relative rounded-xl border border-border bg-surface p-4 shadow-sm transition-shadow duration-fast hover:shadow-md"
              data-testid={`wishlist-card-${w.id}`}
            >
              <button
                type="button"
                aria-label={`Remove ${w.title}`}
                disabled={remove.isPending}
                onClick={() => remove.mutate({ id: w.id })}
                className="absolute right-3 top-3 flex h-8 w-8 items-center justify-center rounded-md text-ink-3 transition-colors duration-fast hover:bg-danger/10 hover:text-danger"
              >
                <Trash2 className="h-4 w-4" strokeWidth={1.75} />
              </button>
              <p className="type-h4 pr-8 text-ink">{w.title}</p>
              <p className="type-small mt-0.5 text-ink-2">{w.destination}</p>
              {w.notes ? <p className="type-caption mt-1.5 text-ink-3">{w.notes}</p> : null}
              <BestTimeCard destination={w.destination} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
