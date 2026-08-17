/**
 * Browser geolocation helpers - shared by the "Near me" overlay, the map
 * my-location chrome, and the arrival watcher.
 *
 * Browsers require geolocation requests to be triggered from a user gesture:
 * always call `requestUserPosition()` synchronously inside a click handler
 * (no `await` before it), never from a deferred effect.
 */

/** UI state machine for the permission flow. */
export type GeoPermissionState =
  | "idle" // never asked
  | "asking" // request in flight (spinner)
  | "granted" // we have a fix
  | "denied" // user/browser blocked it
  | "unavailable"; // no geolocation API in this browser

export type GeolocateErrorKind = "denied" | "unavailable" | "timeout" | "unknown";

export class GeolocateError extends Error {
  readonly kind: GeolocateErrorKind;
  constructor(kind: GeolocateErrorKind, message: string) {
    super(message);
    this.name = "GeolocateError";
    this.kind = kind;
  }
}

export function geolocationSupported(): boolean {
  return typeof navigator !== "undefined" && "geolocation" in navigator;
}

/**
 * Promise wrapper over `navigator.geolocation.getCurrentPosition`.
 * Must be invoked synchronously from a user-gesture handler.
 */
export function requestUserPosition(options?: PositionOptions): Promise<GeolocationPosition> {
  return new Promise((resolve, reject) => {
    if (!geolocationSupported()) {
      reject(new GeolocateError("unavailable", "Location isn't available in this browser."));
      return;
    }
    navigator.geolocation.getCurrentPosition(
      resolve,
      (err) => {
        const kind: GeolocateErrorKind =
          err.code === err.PERMISSION_DENIED
            ? "denied"
            : err.code === err.TIMEOUT
              ? "timeout"
              : "unknown";
        reject(new GeolocateError(kind, err.message || "Could not determine your location."));
      },
      options,
    );
  });
}

/**
 * Empty 20×20 marker element - portal target for the <UserLocationDot/>
 * component (see src/components/geo/UserLocationDot.tsx).
 */
export function createUserMarkerEl(): HTMLDivElement {
  const el = document.createElement("div");
  el.style.cssText = "width:20px;height:20px;";
  el.setAttribute("aria-hidden", "true");
  return el;
}

/** Great-circle distance in meters between two WGS84 points. */
export function haversineMeters(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number,
): number {
  const R = 6371000;
  const toRad = (v: number) => (v * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}
