/**
 * TravelMode (r24-smart, feature N) - premium in-trip companion. Toggle sits
 * in the workspace header for trips in progress by date. While ON it watches
 * the browser geolocation (explicit consent), compares it with today's plan
 * (running-late detection -> reroute notification) and offers a mood/health
 * check-in that adapts the rest of the day.
 *
 * Honest scope: this works only while the app is open; nothing tracks in the
 * background.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { Crown, Navigation, Route, Sparkles } from "lucide-react";
import { useNavigate } from "react-router";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { trpc } from "@/providers/trpc";
import { cn } from "@/lib/utils";
import {
  detectBehind,
  suggestForCheckIn,
  type CheckInTag,
  type Energy,
  type PlannedStop,
} from "@/lib/travel-mode";
import { haversineMeters } from "@/lib/geolocate";
import type { TripData } from "./utils";
import { useToast } from "./Toasts";

const ENERGIES: { key: Energy; label: string }[] = [
  { key: "low", label: "Low" },
  { key: "normal", label: "Normal" },
  { key: "high", label: "High" },
];
const TAGS: CheckInTag[] = ["tired", "hungry", "unwell", "fine"];

function nowMinutesLocal(): number {
  const n = new Date();
  return n.getHours() * 60 + n.getMinutes();
}

function tripInProgress(trip: TripData["trip"]): boolean {
  const today = new Date().toISOString().slice(0, 10);
  return today >= trip.startDate && today <= trip.endDate;
}

function TravelModePanel({ tripId }: { tripId: number }) {
  const { push } = useToast();
  const utils = trpc.useUtils();
  const [watching, setWatching] = useState(false);
  const [position, setPosition] = useState<{ lat: number; lng: number } | null>(null);
  const [geoError, setGeoError] = useState<string | null>(null);
  const [energy, setEnergy] = useState<Energy>("normal");
  const [tags, setTags] = useState<CheckInTag[]>([]);
  const reportedRef = useRef<Set<string>>(new Set());

  const q = trpc.travel.todayState.useQuery({ tripId }, { refetchInterval: 60_000 });
  const reportBehind = trpc.travel.reportBehind.useMutation();
  const checkIn = trpc.travel.checkIn.useMutation({
    onSuccess: () => {
      push({ title: "Check-in saved", description: "Your plan notes it, and the bell has a copy.", kind: "success" });
      utils.notifications.list.invalidate();
    },
  });
  const optimizeDay = trpc.trips.optimizeDay.useMutation({
    onSuccess: async () => {
      push({ title: "Route optimized", description: "Today's stops were re-ordered.", kind: "success" });
      await utils.trips.get.invalidate({ id: tripId });
    },
  });
  const updateStop = trpc.trips.updateStop.useMutation();

  const stops: PlannedStop[] = useMemo(() => q.data?.stops ?? [], [q.data]);
  const day = q.data?.day ?? null;

  // Geolocation watch (only while the panel is open and consent given).
  useEffect(() => {
    if (!watching) return;
    if (!("geolocation" in navigator)) {
      setGeoError("This browser has no geolocation.");
      return;
    }
    const id = navigator.geolocation.watchPosition(
      (p) => setPosition({ lat: p.coords.latitude, lng: p.coords.longitude }),
      (e) => setGeoError(e.message),
      { enableHighAccuracy: true, maximumAge: 30_000 },
    );
    return () => navigator.geolocation.clearWatch(id);
  }, [watching]);

  // Behind-schedule detection, on every fresh position.
  const behind = useMemo(
    () => detectBehind(stops, nowMinutesLocal(), position),
    [stops, position],
  );
  useEffect(() => {
    if (!behind.behind || !behind.lateStop || !behind.nextStop || !day) return;
    const key = `${day.id}:${behind.lateStop.id}`;
    if (reportedRef.current.has(key)) return;
    reportedRef.current.add(key);
    reportBehind.mutate({
      tripId,
      dayId: day.id,
      lateStopName: behind.lateStop.name,
      nextStopName: behind.nextStop.name,
      minutesLate: behind.minutesLate,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [behind.behind, behind.lateStop?.id, day?.id]);

  // Check-in context: nearest cafe among today's food stops + famous eatery.
  const ctx = useMemo(() => {
    const food = stops.filter((s) => s.category === "food");
    const eateries = q.data?.famousEateries ?? [];
    let nearestCafe: string | null = null;
    let nearestFamous: string | null = null;
    if (position) {
      const nearestOf = (list: { name: string; lat?: number | null; lng?: number | null }[]) =>
        list
          .filter((s) => s.lat != null && s.lng != null)
          .map((s) => ({ s, d: haversineMeters(position.lat, position.lng, s.lat!, s.lng!) }))
          .sort((a, b) => a.d - b.d)[0]?.s.name ?? null;
      nearestCafe = nearestOf(food);
      nearestFamous = nearestOf(eateries);
    } else {
      nearestCafe = food[0]?.name ?? null;
      nearestFamous = eateries[0]?.name ?? null;
    }
    // Remaining = stops whose planned window hasn't ended (or untimed ones).
    const remaining = stops.filter((s) => {
      if (!s.startTime) return true;
      const [h, m] = s.startTime.split(":").map(Number);
      return h * 60 + m + (s.durationMin ?? 60) > nowMinutesLocal();
    });
    return { remaining, nearestCafe, nearestFamousEatery: nearestFamous };
  }, [stops, position, q.data]);

  const suggestions = useMemo(() => suggestForCheckIn({ energy, tags }, ctx), [energy, tags, ctx]);

  const toggleTag = (t: CheckInTag) =>
    setTags((prev) => (prev.includes(t) ? prev.filter((x) => x !== t) : [...prev, t]));

  const applyDrop = async (stopIds: number[]) => {
    for (const id of stopIds) {
      await updateStop.mutateAsync({ id, tripId, dayId: null });
    }
    await utils.trips.get.invalidate({ id: tripId });
    push({ title: "Day relaxed", description: `${stopIds.length} stop(s) moved back to unscheduled.`, kind: "success" });
  };

  return (
    <div className="space-y-4">
      {/* location consent */}
      {!watching ? (
        <div className="rounded-lg border border-border bg-surface-2/50 p-3.5">
          <p className="type-small font-semibold text-ink">Share your location while you travel</p>
          <p className="type-small mt-1 text-ink-2">
            Travel mode watches your position <span className="font-semibold">only while this app is open</span>,
            compares it with today's plan, and nudges you when you run late. Nothing is tracked in the background.
          </p>
          <Button size="sm" className="mt-2.5" onClick={() => setWatching(true)}>
            <Navigation className="mr-1.5 h-3.5 w-3.5" strokeWidth={1.75} />
            Enable live location
          </Button>
          {geoError ? <p className="type-caption mt-2 text-danger">{geoError}</p> : null}
        </div>
      ) : (
        <p className="type-caption flex items-center gap-1.5 text-pine" role="status">
          <Navigation className="h-3.5 w-3.5" strokeWidth={1.75} />
          Live location on {position ? `(${position.lat.toFixed(4)}, ${position.lng.toFixed(4)})` : "(locating…)"}
        </p>
      )}

      {/* running-late card */}
      {behind.behind && behind.lateStop && behind.nextStop ? (
        <div className="rounded-lg border border-ochre/30 bg-ochre-soft/50 p-3.5" data-testid="travel-behind-card">
          <p className="type-small font-semibold text-ink">
            Running late, about {behind.minutesLate} min past {behind.lateStop.name}
          </p>
          <p className="type-small mt-1 text-ink-2">
            You're still {behind.distanceToNextM != null ? `${Math.round(behind.distanceToNextM)}m` : "away"} from{" "}
            {behind.nextStop.name}. Reroute the day, or relax the plan.
          </p>
          <div className="mt-2.5 flex gap-2">
            <Button
              size="sm"
              disabled={optimizeDay.isPending || !day}
              onClick={() => day && optimizeDay.mutate({ tripId, dayId: day.id })}
            >
              <Route className="mr-1.5 h-3.5 w-3.5" strokeWidth={1.75} />
              Reroute today
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={updateStop.isPending}
              onClick={() => {
                const rest = ctx.remaining.slice(2).map((s) => s.id);
                if (rest.length) void applyDrop(rest);
              }}
            >
              Drop extra stops
            </Button>
          </div>
        </div>
      ) : null}

      {/* check-in */}
      <div className="rounded-lg border border-border bg-surface-2/50 p-3.5">
        <p className="type-small font-semibold text-ink">How are you feeling?</p>
        <div className="mt-2 flex gap-1.5" role="radiogroup" aria-label="Energy">
          {ENERGIES.map((e) => (
            <button
              key={e.key}
              type="button"
              role="radio"
              aria-checked={energy === e.key}
              onClick={() => setEnergy(e.key)}
              className={cn(
                "type-small h-8 rounded-pill border px-3 font-semibold transition-colors duration-fast",
                energy === e.key
                  ? "border-brand bg-brand text-brand-ink"
                  : "border-border text-ink-2 hover:border-border-strong",
              )}
            >
              {e.label}
            </button>
          ))}
        </div>
        <div className="mt-2 flex flex-wrap gap-1.5">
          {TAGS.map((t) => (
            <button
              key={t}
              type="button"
              aria-pressed={tags.includes(t)}
              onClick={() => toggleTag(t)}
              className={cn(
                "type-caption h-7 rounded-pill border px-2.5 font-semibold capitalize transition-colors duration-fast",
                tags.includes(t)
                  ? "border-brand bg-brand-soft text-brand"
                  : "border-border text-ink-2 hover:border-border-strong",
              )}
            >
              {t}
            </button>
          ))}
        </div>

        <ul className="mt-3 space-y-2" data-testid="checkin-suggestions">
          {suggestions.map((s, i) => (
            <li key={i} className="flex items-start justify-between gap-2">
              <p className="type-small min-w-0 flex-1 text-ink-2">{s.text}</p>
              {s.kind === "drop_stops" && s.stopIds.length > 0 ? (
                <Button
                  size="sm"
                  variant="outline"
                  disabled={updateStop.isPending}
                  onClick={() => void applyDrop(s.stopIds)}
                >
                  Apply
                </Button>
              ) : null}
            </li>
          ))}
        </ul>
        <Button
          size="sm"
          variant="outline"
          className="mt-3"
          disabled={checkIn.isPending}
          onClick={() =>
            checkIn.mutate({
              tripId,
              energy,
              tags,
              summary: suggestions.map((s) => s.text).join(" ").slice(0, 500),
            })
          }
        >
          <Sparkles className="mr-1.5 h-3.5 w-3.5" strokeWidth={1.75} />
          Save check-in
        </Button>
      </div>

      <p className="type-caption text-ink-3">
        Travel mode works while the app is open. Close the tab and tracking stops with it.
      </p>
    </div>
  );
}

export default function TravelModeToggle({ data, tripId }: { data: TripData; tripId: number }) {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const isVoyager = data.tier === "voyager";
  if (!tripInProgress(data.trip)) return null;

  return (
    <>
      <button
        type="button"
        title={isVoyager ? "Travel mode: live adaptation while you're on the trip" : "Travel mode (Voyager)"}
        onClick={() => (isVoyager ? setOpen(true) : navigate("/pricing"))}
        className="type-caption inline-flex shrink-0 items-center gap-1.5 rounded-pill bg-surface-2 px-2.5 py-1 font-semibold text-ink-2 transition-colors duration-fast hover:bg-border hover:text-ink"
        data-testid="travel-mode-toggle"
      >
        <Navigation className="h-3.5 w-3.5" strokeWidth={1.75} />
        Travel mode
        {!isVoyager ? <Crown className="h-3 w-3 text-ochre" strokeWidth={1.75} /> : null}
      </button>
      {isVoyager ? (
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogContent className="rounded-xl sm:max-w-[560px]">
            <DialogHeader>
              <DialogTitle className="type-h4 flex items-center gap-2 text-ink">
                Travel mode
                <span className="type-caption inline-flex items-center gap-1 rounded-pill bg-ochre-soft px-2 py-0.5 font-semibold text-ochre">
                  <Crown className="h-3 w-3" strokeWidth={1.75} />
                  Voyager
                </span>
              </DialogTitle>
              <DialogDescription className="type-small text-ink-2">
                Live adaptation for {data.trip.title}, today only.
              </DialogDescription>
            </DialogHeader>
            <TravelModePanel tripId={tripId} />
          </DialogContent>
        </Dialog>
      ) : null}
    </>
  );
}
