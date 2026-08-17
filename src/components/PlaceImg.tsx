import { useState } from "react";
import {
  placeImageFor,
  poolImageFor,
  type PlaceImageInput,
} from "@/lib/place-images";
import { cn } from "@/lib/utils";

/**
 * r13: image with graceful degradation - real place photo → category pool →
 * nothing (caller keeps its gradient background). Fixes broken-image icons
 * when a stored photo URL 404s or hotlink-blocks.
 */
export function PlaceImg({
  place,
  className,
  alt,
  loading = "lazy",
}: {
  place: PlaceImageInput;
  className?: string;
  alt?: string;
  loading?: "lazy" | "eager";
}) {
  const [stage, setStage] = useState<0 | 1 | 2>(0);
  const primary = placeImageFor(place);
  const fallback = poolImageFor(place);
  const src = stage === 0 ? primary : stage === 1 ? fallback : null;
  if (!src) return null;
  return (
    <img
      src={src}
      alt={alt ?? place.name ?? ""}
      loading={loading}
      className={cn(className)}
      onError={() => setStage((s) => (s === 0 && fallback && fallback !== primary ? 1 : 2))}
    />
  );
}
