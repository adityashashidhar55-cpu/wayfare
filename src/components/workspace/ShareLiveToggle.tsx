import { useCallback, useEffect, useRef, useState } from "react";
import { Radio } from "lucide-react";
import { trpc } from "@/providers/trpc";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  GeolocateError,
  geolocationSupported,
  haversineMeters,
  requestUserPosition,
} from "@/lib/geolocate";
import { useToast } from "./Toasts";

/** Minimum time between position posts. */
const MIN_INTERVAL_MS = 30_000;
/** Minimum movement between position posts. */
const MIN_DISTANCE_M = 100;
/** Keep-alive so a stationary-but-sharing user never looks stale (server
 * marks >5min fixes stale; stay well under that). */
const KEEPALIVE_MS = 4 * 60_000;

function storageKey(tripId: number): string {
  return `wf:live-share:${tripId}`;
}

/**
 * "Share live location" pill for the workspace header (next to Share).
 * Privacy-first: OFF by default, and a reload always starts OFF - the stored
 * opt-in is only used to post one sharing:false cleanup ping for the session
 * that just ended, until the user explicitly re-enables. Turning ON requests
 * geolocation synchronously from the click (browser gesture requirement),
 * starts a watchPosition, and posts geo.shareMyLocation throttled to ≥30s
 * AND ≥100m of movement (plus a 4min keep-alive).
 */
export default function ShareLiveToggle({ tripId }: { tripId: number }) {
  const { push } = useToast();
  const [state, setState] = useState<"off" | "asking" | "on">("off");
  const watchIdRef = useRef<number | null>(null);
  const lastPostedRef = useRef<{ lat: number; lng: number; at: number } | null>(null);

  const share = trpc.geo.shareMyLocation.useMutation({
    onError: e =>
      push({
        title: "Couldn't update live location",
        description: e.message,
        kind: "danger",
      }),
  });
  const shareRef = useRef(share);
  useEffect(() => {
    shareRef.current = share;
  });

  const clearWatch = useCallback(() => {
    if (watchIdRef.current != null && geolocationSupported()) {
      navigator.geolocation.clearWatch(watchIdRef.current);
    }
    watchIdRef.current = null;
  }, []);

  /* stop the watcher on unmount; sharing itself stops via the remount
     cleanup ping below (a reload always comes back OFF) */
  useEffect(() => clearWatch, [clearWatch]);

  /* remount cleanup: if the previous page-load ended while live, retract the
     stale fix once - reloads never resume sharing on their own */
  useEffect(() => {
    let stored: string | null = null;
    try {
      stored = window.localStorage.getItem(storageKey(tripId));
    } catch {
      /* private mode etc. */
    }
    if (stored === "1") {
      shareRef.current.mutate({ tripId, sharing: false });
      try {
        window.localStorage.setItem(storageKey(tripId), "0");
      } catch {
        /* ignore */
      }
    }
  }, [tripId]);

  const startWatch = useCallback(() => {
    if (!geolocationSupported()) return;
    clearWatch();
    watchIdRef.current = navigator.geolocation.watchPosition(
      pos => {
        const lat = pos.coords.latitude;
        const lng = pos.coords.longitude;
        const last = lastPostedRef.current;
        const now = Date.now();
        const dt = last ? now - last.at : Number.POSITIVE_INFINITY;
        const moved = last ? haversineMeters(last.lat, last.lng, lat, lng) : Number.POSITIVE_INFINITY;
        if ((dt >= MIN_INTERVAL_MS && moved >= MIN_DISTANCE_M) || dt >= KEEPALIVE_MS) {
          lastPostedRef.current = { lat, lng, at: now };
          shareRef.current.mutate({ tripId, lat, lng, sharing: true });
        }
      },
      () => {
        /* transient watch errors are non-fatal, the next fix retries */
      },
      { enableHighAccuracy: true, maximumAge: 15_000, timeout: 20_000 },
    );
  }, [tripId, clearWatch]);

  const turnOff = useCallback(() => {
    clearWatch();
    lastPostedRef.current = null;
    setState("off");
    try {
      window.localStorage.setItem(storageKey(tripId), "0");
    } catch {
      /* ignore */
    }
    shareRef.current.mutate({ tripId, sharing: false });
  }, [tripId, clearWatch]);

  /** IMPORTANT: the geolocation request must stay inside this click
   * handler's synchronous call stack (browser user-gesture requirement). */
  const turnOn = () => {
    setState("asking");
    requestUserPosition({ timeout: 10_000, maximumAge: 30_000 })
      .then(pos => {
        const lat = pos.coords.latitude;
        const lng = pos.coords.longitude;
        lastPostedRef.current = { lat, lng, at: Date.now() };
        shareRef.current.mutate({ tripId, lat, lng, sharing: true });
        startWatch();
        setState("on");
        try {
          window.localStorage.setItem(storageKey(tripId), "1");
        } catch {
          /* ignore */
        }
        push({
          title: "You're live",
          description: "Trip members can see your location on the map.",
          kind: "success",
        });
      })
      .catch((err: unknown) => {
        setState("off");
        if (err instanceof GeolocateError && err.kind === "denied") {
          push({
            title: "Location is blocked",
            description: "Allow location access in your browser's site settings to go live.",
            kind: "danger",
          });
        } else if (err instanceof GeolocateError && err.kind === "unavailable") {
          push({
            title: "Location isn't available in this browser",
            kind: "danger",
          });
        } else {
          push({
            title: "Couldn't pin down your location, try again.",
            kind: "danger",
          });
        }
      });
  };

  const live = state === "on";
  return (
    <Button
      type="button"
      variant={live ? "pine" : "secondary"}
      size="sm"
      pill
      aria-pressed={live}
      disabled={state === "asking"}
      onClick={() => (live ? turnOff() : turnOn())}
      title={live ? "Stop sharing your live location" : "Share your live location with trip members"}
      className={cn(live && "gap-2")}
    >
      {live ? (
        <span className="relative flex h-2 w-2">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-white opacity-75" />
          <span className="relative inline-flex h-2 w-2 rounded-full bg-white" />
        </span>
      ) : (
        <Radio className="h-3.5 w-3.5" />
      )}
      {state === "asking" ? "Locating…" : live ? "Live" : "Share live"}
    </Button>
  );
}
