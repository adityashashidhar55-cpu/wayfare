import { useEffect, useMemo, useRef, useState } from "react";
import { motion } from "framer-motion";
import { Loader2, MapPin, X } from "lucide-react";
import type maplibregl from "maplibre-gl";
import { reverseGeocode, splitDestination } from "@/lib/geocode";
import { cn } from "@/lib/utils";
import { useSaveToLibrary } from "../places/useSaveToLibrary";
import { categoryMeta } from "./utils";

export interface AddPlacePinPopoverProps {
  /** Live MapLibre instance - used to keep the popover glued to the pin */
  map: maplibregl.Map | null;
  lat: number;
  lng: number;
  /** Trip destination - fallback city/country when reverse geocoding fails */
  destination: string;
  onClose: () => void;
}

const CATEGORIES = ["activity", "food"] as const;

/**
 * Right-click "drop a pin" popover (workspace map): name + category +
 * city/country (prefilled by ONE Photon reverse call, trip destination as
 * fallback), saved to the shared places library via explore.addPlace.
 * Anchored to the dropped point and tracks map movement; basemap click or
 * Escape closes it.
 */
export default function AddPlacePinPopover({
  map,
  lat,
  lng,
  destination,
  onClose,
}: AddPlacePinPopoverProps) {
  const { save, isPending } = useSaveToLibrary();
  const fallback = useMemo(() => splitDestination(destination), [destination]);

  const [name, setName] = useState("");
  const [category, setCategory] = useState<"activity" | "food">("activity");
  const [city, setCity] = useState(fallback.city);
  const [country, setCountry] = useState(fallback.country);
  const [locating, setLocating] = useState(true);
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);
  const cityDirty = useRef(false);
  const countryDirty = useRef(false);
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  /* ONE reverse-geocode call per dropped pin (the parent keys this component
     by coordinates, so each pin is a fresh mount) - upgrades the destination
     fallback prefill unless the user already typed into that field */
  useEffect(() => {
    let cancelled = false;
    void reverseGeocode(lat, lng).then(geo => {
      if (cancelled) return;
      setLocating(false);
      if (geo) {
        if (geo.city && !cityDirty.current) setCity(geo.city);
        if (geo.country && !countryDirty.current) setCountry(geo.country);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [lat, lng]);

  /* keep the popover anchored to the pin while the map moves */
  useEffect(() => {
    if (!map) return;
    const update = () => {
      const p = map.project([lng, lat]);
      setPos({ x: p.x, y: p.y });
    };
    update();
    map.on("move", update);
    return () => {
      map.off("move", update);
    };
  }, [map, lat, lng]);

  /* basemap click dismisses (popover clicks never reach the map) */
  useEffect(() => {
    if (!map) return;
    const close = () => onCloseRef.current();
    map.on("click", close);
    return () => {
      map.off("click", close);
    };
  }, [map]);

  const canSave =
    name.trim().length >= 2 &&
    city.trim().length > 0 &&
    country.trim().length > 0 &&
    !isPending;

  const submit = () => {
    if (!canSave) return;
    save(
      {
        name: name.trim(),
        lat,
        lng,
        category,
        city: city.trim(),
        country: country.trim(),
      },
      () => onCloseRef.current()
    );
  };

  if (!pos) return null;

  return (
    <div
      className="pointer-events-none absolute z-20"
      style={{ left: pos.x, top: pos.y + 14, transform: "translate(-50%, 0)" }}
    >
      <motion.div
        initial={{ opacity: 0, y: -6, scale: 0.97 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ type: "spring", stiffness: 260, damping: 26 }}
        className="glass pointer-events-auto w-[280px] rounded-xl border border-border p-3 shadow-lg"
        role="dialog"
        aria-label="Add place here"
      >
        <div className="flex items-center gap-2">
          <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-brand-soft text-brand">
            <MapPin className="h-3.5 w-3.5" strokeWidth={1.75} />
          </span>
          <p className="min-w-0 flex-1 truncate text-[14px] font-semibold text-ink">
            Add place here
          </p>
          <button
            type="button"
            aria-label="Cancel"
            onClick={() => onCloseRef.current()}
            className="rounded-sm p-1 text-ink-3 transition-colors duration-fast hover:bg-surface-2 hover:text-ink"
          >
            <X className="h-3.5 w-3.5" strokeWidth={1.75} />
          </button>
        </div>

        <input
          value={name}
          onChange={e => setName(e.target.value)}
          onKeyDown={e => {
            if (e.key === "Enter") submit();
            if (e.key === "Escape") onCloseRef.current();
          }}
          placeholder="Place name"
          aria-label="Place name"
          maxLength={120}
          autoFocus
          className="type-small mt-3 h-9 w-full rounded-md border border-border-strong bg-surface px-3 font-medium text-ink placeholder:text-ink-3 focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/40"
        />

        {/* category select */}
        <div className="mt-2 flex gap-1.5" role="radiogroup" aria-label="Category">
          {CATEGORIES.map(c => {
            const meta = categoryMeta(c);
            const on = category === c;
            return (
              <button
                key={c}
                type="button"
                role="radio"
                aria-checked={on}
                onClick={() => setCategory(c)}
                className={cn(
                  "type-caption flex h-8 flex-1 items-center justify-center gap-1.5 rounded-md border font-semibold transition-all duration-fast",
                  on
                    ? "border-transparent bg-brand-soft text-brand"
                    : "border-border bg-surface text-ink-3 hover:border-border-strong hover:text-ink-2"
                )}
              >
                <meta.icon
                  className="h-3.5 w-3.5"
                  strokeWidth={1.75}
                  style={on ? { color: meta.color } : undefined}
                />
                {meta.label}
              </button>
            );
          })}
        </div>

        {/* city / country, reverse-geocode prefill with destination fallback */}
        <div className="mt-2 flex gap-1.5">
          <input
            value={city}
            onChange={e => {
              cityDirty.current = true;
              setCity(e.target.value);
            }}
            placeholder="City"
            aria-label="City"
            maxLength={255}
            className="type-small h-9 min-w-0 flex-1 rounded-md border border-border-strong bg-surface px-3 font-medium text-ink placeholder:text-ink-3 focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/40"
          />
          <input
            value={country}
            onChange={e => {
              countryDirty.current = true;
              setCountry(e.target.value);
            }}
            placeholder="Country"
            aria-label="Country"
            maxLength={255}
            className="type-small h-9 min-w-0 flex-1 rounded-md border border-border-strong bg-surface px-3 font-medium text-ink placeholder:text-ink-3 focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/40"
          />
        </div>
        <p className="type-caption mt-1.5 text-ink-3">
          {locating ? "Locating the pin…" : "Saved to the shared places library."}
        </p>

        <button
          type="button"
          onClick={submit}
          disabled={!canSave}
          className="btn-sheen type-small mt-2 flex h-9 w-full items-center justify-center gap-1.5 rounded-md bg-brand font-semibold text-brand-ink shadow-sm transition-all duration-fast hover:-translate-y-px hover:bg-brand-strong hover:shadow-md active:scale-[0.97] disabled:opacity-60"
        >
          {isPending ? (
            <Loader2 className="h-4 w-4 animate-spin" strokeWidth={2} />
          ) : null}
          {isPending ? "Saving…" : "Save place"}
        </button>
      </motion.div>
    </div>
  );
}
