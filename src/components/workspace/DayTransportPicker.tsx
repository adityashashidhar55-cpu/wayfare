import { Car, Footprints, TrainFront, TramFront } from "lucide-react";
import { trpc } from "@/providers/trpc";
import { cn } from "@/lib/utils";
import type { DayTransportMode } from "./utils";
import { useToast } from "./Toasts";

const MODES = [
  { key: "walk", label: "Walk", icon: Footprints },
  { key: "car", label: "Drive", icon: Car },
  { key: "transit", label: "Transit", icon: TramFront },
  { key: "train", label: "Train", icon: TrainFront },
] as const satisfies readonly { key: DayTransportMode; label: string; icon: typeof Car }[];

/**
 * Compact segmented control for a day's transport mode (walk/car/transit/
 * train). Persists via trips.setDayTransportMode (server recomputes the day's
 * leg estimates); optimistic cache update + invalidation of trips.get.
 */
export default function DayTransportPicker({
  tripId,
  dayId,
  mode,
}: {
  tripId: number;
  dayId: number;
  mode: DayTransportMode;
}) {
  const utils = trpc.useUtils();
  const { push } = useToast();

  const setMode = trpc.trips.setDayTransportMode.useMutation({
    onMutate: async vars => {
      await utils.trips.get.cancel({ id: tripId });
      const prev = utils.trips.get.getData({ id: tripId });
      utils.trips.get.setData({ id: tripId }, old =>
        old
          ? {
              ...old,
              days: old.days.map(d =>
                d.id === dayId ? { ...d, transportMode: vars.mode } : d
              ),
            }
          : old
      );
      return { prev };
    },
    onError: (e, _vars, ctx) => {
      if (ctx?.prev) utils.trips.get.setData({ id: tripId }, ctx.prev);
      push({
        title: "Could not change transport mode",
        description: e.message,
        kind: "danger",
      });
    },
    onSettled: () => utils.trips.get.invalidate({ id: tripId }),
  });

  return (
    <div
      role="radiogroup"
      aria-label="Transport mode for this day"
      className="flex shrink-0 items-center gap-0.5 rounded-pill border border-border bg-surface-2/60 p-0.5"
    >
      {MODES.map(m => {
        const active = m.key === mode;
        return (
          <button
            key={m.key}
            type="button"
            role="radio"
            aria-checked={active}
            title={`Get around by ${m.label.toLowerCase()}, updates leg time estimates`}
            onClick={() => {
              if (!active) setMode.mutate({ tripId, dayId, mode: m.key });
            }}
            className={cn(
              "type-caption flex items-center gap-1 rounded-pill px-2 py-1 transition-colors duration-fast",
              active
                ? "bg-surface font-semibold text-ink shadow-sm"
                : "text-ink-3 hover:bg-surface/70 hover:text-ink-2"
            )}
          >
            <m.icon className="h-3 w-3" strokeWidth={1.75} />
            <span className="hidden min-[480px]:inline">{m.label}</span>
          </button>
        );
      })}
    </div>
  );
}
