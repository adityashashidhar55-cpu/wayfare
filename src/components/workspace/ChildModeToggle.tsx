import { useState } from "react";
import { Link } from "react-router";
import { Baby, BookOpen } from "lucide-react";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Switch } from "@/components/ui/switch";
import { trpc } from "@/providers/trpc";
import { parseChildAges } from "@contracts/kids";
import { cn } from "@/lib/utils";
import { useToast } from "./Toasts";

/**
 * Kids-mode pill for the workspace header. ON means: AI day-fills plan family
 * pace (≤4 stops, early dinner, a downtime break), kid-avoid places leave the
 * pool, and suggestion lists prefer kid-friendly spots. Persists to
 * trips.withChildren so every future AI fill on this trip honors it.
 */
export default function ChildModeToggle({
  tripId,
  withChildren,
  childAges,
}: {
  tripId: number;
  withChildren: boolean;
  childAges: string | null;
}) {
  const utils = trpc.useUtils();
  const { push } = useToast();
  const [open, setOpen] = useState(false);
  const ages = parseChildAges(childAges);

  const update = trpc.trips.update.useMutation({
    onSuccess: () => {
      utils.trips.get.invalidate({ id: tripId });
      utils.trips.list.invalidate();
    },
    onError: e =>
      push({
        title: "Could not update kids mode",
        description: e.message,
        kind: "danger",
      }),
  });

  const setKids = (on: boolean) => update.mutate({ id: tripId, withChildren: on });

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-pressed={withChildren}
          aria-label={withChildren ? "Kids mode on" : "Kids mode off"}
          title="Kids mode, family pace, kid-friendly picks"
          className={cn(
            "type-small flex shrink-0 items-center gap-1.5 rounded-pill border px-3 py-1.5 font-semibold transition-all duration-fast",
            withChildren
              ? "border-transparent bg-brand text-brand-ink shadow-sm"
              : "border-border bg-surface text-ink-3 hover:border-border-strong hover:text-ink"
          )}
        >
          <Baby className="h-3.5 w-3.5" strokeWidth={1.75} />
          <span className="hidden sm:inline">Kids</span>
          {withChildren ? <span className="type-caption">on</span> : null}
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-72 rounded-xl p-4">
        <div className="flex items-center justify-between gap-3">
          <span className="flex items-center gap-2">
            <span className="flex h-7 w-7 items-center justify-center rounded-full bg-brand-soft text-brand">
              <Baby className="h-3.5 w-3.5" strokeWidth={1.75} />
            </span>
            <span className="type-small font-semibold text-ink">Kids mode</span>
          </span>
          <Switch
            checked={withChildren}
            onCheckedChange={setKids}
            disabled={update.isPending}
            aria-label="Kids mode"
          />
        </div>
        <p className="type-caption mt-2.5 leading-relaxed text-ink-2">
          {withChildren
            ? "AI day-fills now plan family pace: up to 4 stops, done by 18:30, a daily downtime break, and suggestions prefer kid-friendly spots."
            : "Turn on to plan at family pace: fewer stops, early evenings, a daily park break, and kid-friendly suggestions."}
        </p>
        {withChildren && ages.length ? (
          <p className="type-caption tnum mt-2 text-ink-3">
            Kids on this trip: ages {ages.join(", ")}
          </p>
        ) : null}
        <Link
          to="/kids"
          onClick={() => setOpen(false)}
          className="type-small mt-3 flex items-center gap-1.5 font-semibold text-brand transition-colors duration-fast hover:text-brand-strong"
        >
          <BookOpen className="h-3.5 w-3.5" strokeWidth={1.75} />
          Open the kids travel guide
        </Link>
      </PopoverContent>
    </Popover>
  );
}
