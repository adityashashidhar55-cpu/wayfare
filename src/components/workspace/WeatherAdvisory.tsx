/**
 * WeatherAdvisory (r24-smart, feature K) - premium weather-adaptation UX.
 * When the trip forecast crosses thresholds, a banner appears above the
 * itinerary; "Review" opens a panel listing flags and one-tap adaptations
 * (swap days, swap in an indoor alternative, mark the day flexible). Every
 * apply also posts a notification server-side.
 */
import { useMemo, useState } from "react";
import { CloudRain, Crown, Flame, Snowflake, Umbrella } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { trpc } from "@/providers/trpc";
import { useToast } from "./Toasts";
import type { TripData } from "./utils";

type Adaptation = {
  kind: "indoor" | "lighter" | "swap" | "flexible";
  dayId: number;
  withDayId?: number;
  text: string;
};

const FLAG_ICON = { hot: Flame, rainy: CloudRain, cold: Snowflake } as const;

export default function WeatherAdvisory({
  data,
  tripId,
  isVoyager,
}: {
  data: TripData;
  tripId: number;
  isVoyager: boolean;
}) {
  const { push } = useToast();
  const utils = trpc.useUtils();
  const [open, setOpen] = useState(false);
  const q = trpc.weather.tripForecast.useQuery(
    { tripId },
    { enabled: isVoyager, staleTime: 30 * 60_000, retry: false },
  );
  const apply = trpc.weather.applyAdaptation.useMutation({
    onSuccess: async (r) => {
      push({
        title: "Adaptation applied",
        description:
          r.applied === "indoor" && "replacement" in r
            ? `Swapped in ${r.replacement}.`
            : r.applied === "swap"
              ? "The two days exchanged their plans."
              : "The day is now flexible.",
        kind: "success",
      });
      await Promise.all([
        utils.trips.get.invalidate({ id: tripId }),
        utils.weather.tripForecast.invalidate({ tripId }),
      ]);
    },
    onError: (e) => push({ title: "Could not apply", description: e.message, kind: "danger" }),
  });

  // First outdoor stop per day (the replace target for "indoor").
  const firstOutdoorByDay = useMemo(() => {
    const m = new Map<number, number>();
    for (const s of data.stops) {
      if (s.dayId == null) continue;
      if (s.category !== "activity" && s.category !== "shopping") continue;
      if (!m.has(s.dayId)) m.set(s.dayId, s.id);
    }
    return m;
  }, [data.stops]);

  if (!isVoyager || !q.data) return null;
  const { flagged, adaptations, approximateAll, days } = q.data;
  if (flagged.length === 0) return null;

  const dayNo = new Map(days.map((d) => [d.dayId, d.position]));
  const first = flagged[0]!;
  const flagWord = first.flags.includes("rainy") ? "Rain" : first.flags.includes("hot") ? "Heat" : "Cold";
  const byDay = new Map<number, Adaptation[]>();
  for (const a of adaptations as Adaptation[]) {
    byDay.set(a.dayId, [...(byDay.get(a.dayId) ?? []), a]);
  }

  const runApply = (a: Adaptation) => {
    if (a.kind === "swap" && a.withDayId) {
      apply.mutate({ tripId, kind: "swap", dayId: a.dayId, withDayId: a.withDayId });
    } else if (a.kind === "indoor") {
      const stopId = firstOutdoorByDay.get(a.dayId);
      if (!stopId) {
        push({ title: "No outdoor stop to replace", description: "This day has no outdoor stops.", kind: "info" });
        return;
      }
      apply.mutate({ tripId, kind: "indoor", dayId: a.dayId, stopId });
    } else if (a.kind === "flexible") {
      apply.mutate({ tripId, kind: "flexible", dayId: a.dayId });
    }
  };

  return (
    <>
      {/* advisory banner above the itinerary list */}
      <div
        className="mx-4 mt-3 flex items-center gap-2.5 rounded-lg border border-ochre/30 px-3 py-2"
        style={{ background: "color-mix(in srgb, var(--ochre-soft) 72%, var(--glass))" }}
        role="status"
        data-testid="weather-advisory-banner"
      >
        <Umbrella className="h-4 w-4 shrink-0 text-ochre" strokeWidth={1.75} />
        <p className="type-small min-w-0 flex-1 text-ink">
          <span className="font-semibold">Weather advisory{approximateAll ? " (typical climate)" : ""}:</span>{" "}
          {flagWord} expected on Day {dayNo.get(first.dayId) ?? "?"}
          {flagged.length > 1 ? ` and ${flagged.length - 1} more day${flagged.length - 1 === 1 ? "" : "s"}` : ""}.
        </p>
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="type-small shrink-0 rounded-pill bg-ochre px-3 py-1 font-semibold text-white transition-transform duration-fast hover:-translate-y-px"
        >
          Review
        </button>
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="rounded-xl sm:max-w-[560px]">
          <DialogHeader>
            <DialogTitle className="type-h4 flex items-center gap-2 text-ink">
              Weather advisory
              <span className="type-caption inline-flex items-center gap-1 rounded-pill bg-ochre-soft px-2 py-0.5 font-semibold text-ochre">
                <Crown className="h-3 w-3" strokeWidth={1.75} />
                Voyager
              </span>
            </DialogTitle>
            <DialogDescription className="type-small text-ink-2">
              {approximateAll
                ? "Your dates are past the 16-day forecast, this uses typical climate for the season."
                : "Live forecast for your trip dates. Pick an adaptation to apply it in one tap."}
            </DialogDescription>
          </DialogHeader>

          <div className="max-h-[60dvh] space-y-3 overflow-y-auto pr-1">
            {flagged.map((f) => (
              <div key={f.dayId} className="rounded-lg border border-border bg-surface-2/50 p-3.5">
                <p className="type-small flex flex-wrap items-center gap-2 font-semibold text-ink">
                  Day {dayNo.get(f.dayId) ?? "?"} · {f.date}
                  {f.flags.map((fl) => {
                    const Icon = FLAG_ICON[fl];
                    return (
                      <span
                        key={fl}
                        className="type-caption inline-flex items-center gap-1 rounded-pill bg-surface px-2 py-0.5 font-semibold text-ink-2"
                      >
                        <Icon className="h-3 w-3 text-ochre" strokeWidth={1.75} />
                        {fl === "hot"
                          ? `${Math.round(f.tmaxC ?? 0)}°C`
                          : fl === "rainy"
                            ? `${f.precipProbPct ?? 0}% rain`
                            : `${Math.round(f.tmaxC ?? 0)}°C`}
                        {f.approximate ? " (typical)" : ""}
                      </span>
                    );
                  })}
                </p>
                <ul className="mt-2 space-y-1.5">
                  {(byDay.get(f.dayId) ?? []).map((a, i) => (
                    <li key={i} className="flex items-start justify-between gap-3">
                      <p className="type-small min-w-0 flex-1 text-ink-2">{a.text}</p>
                      {a.kind === "lighter" ? null : (
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={apply.isPending}
                          onClick={() => runApply(a)}
                          className="shrink-0"
                        >
                          Apply
                        </Button>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
