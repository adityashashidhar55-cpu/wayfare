import { useEffect, useState } from "react";
import { resolveHotelImage } from "@/lib/hotel-image";
import { cn } from "@/lib/utils";

/**
 * Hotel thumbnail with a strict no-broken-images contract:
 *   Wikipedia/Commons photo → deterministic lodging pool → monogram tile.
 * Any <img> error swaps to the monogram, so a bad URL never reaches the eye.
 * The monogram is the hotel's initial in a warm tile (font-serif, ochre).
 */
export default function HotelThumb({
  name,
  city,
  className,
}: {
  name: string;
  /** Trip destination city - nudges the Wikipedia search. */
  city?: string;
  className?: string;
}) {
  const [src, setSrc] = useState<string | null>(null);
  const [broken, setBroken] = useState(false);

  useEffect(() => {
    let alive = true;
    setSrc(null);
    setBroken(false);
    resolveHotelImage(name, city).then(url => {
      if (alive) setSrc(url);
    });
    return () => {
      alive = false;
    };
  }, [name, city]);

  if (src && !broken) {
    return (
      <img
        src={src}
        alt=""
        loading="lazy"
        onError={() => setBroken(true)}
        className={cn("photo shrink-0 rounded-sm object-cover", className)}
      />
    );
  }

  const initial = (name.trim()[0] ?? "H").toUpperCase();
  return (
    <span
      aria-hidden
      className={cn(
        "flex shrink-0 select-none items-center justify-center rounded-sm border border-ochre/25 bg-gradient-to-br from-ochre-soft to-ochre/25 font-serif font-semibold text-ochre",
        className
      )}
    >
      {initial}
    </span>
  );
}
