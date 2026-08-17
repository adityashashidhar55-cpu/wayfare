import { useState } from "react";
import { TriangleAlert, X } from "lucide-react";
import type { TripData } from "../workspace/utils";

/* r12-routeui: road-trip planner caveats banner.
   planRoadtrip persists geocode corrections / skipped must-visit stops as
   the trip's note (api/roadtrip-router.ts), headed by ROUTE_CAVEATS_HEADER
   followed by "- …" lines. This banner parses that note back into a
   dismissible amber strip at the top of the workspace. The note stays
   human-readable in the Notes tab; deleting it there also clears the banner. */

const HEADER = "Route planner heads-up:";

/** Parse a trip note into caveat lines; [] for plain user notes. */
function parseRouteCaveats(content: string | null | undefined): string[] {
  if (!content) return [];
  const lines = content.split("\n");
  if (lines[0]?.trim() !== HEADER) return [];
  return lines
    .slice(1)
    .map((l) => l.trim())
    .filter((l) => l.startsWith("- "))
    .map((l) => l.slice(2));
}

export function RouteWarningsBanner({
  note,
  tripId,
}: {
  note: TripData["note"];
  tripId: number;
}) {
  const caveats = parseRouteCaveats(note?.content);
  /* Dismissal is remembered per trip + content, so a re-plan with fresh
     caveats resurfaces the banner. */
  const dismissKey = `wayfare.routeCaveats.${tripId}.${note?.content?.length ?? 0}`;
  const [dismissed, setDismissed] = useState(() => {
    try {
      return window.localStorage.getItem(dismissKey) === "1";
    } catch {
      return false;
    }
  });

  if (caveats.length === 0 || dismissed) return null;

  const dismiss = () => {
    setDismissed(true);
    try {
      window.localStorage.setItem(dismissKey, "1");
    } catch {
      /* private mode, banner just returns next visit */
    }
  };

  return (
    <div
      role="status"
      className="rounded-md border border-ochre/30 bg-ochre-soft px-3.5 py-2.5"
    >
      <div className="flex items-start gap-2.5">
        <TriangleAlert
          className="mt-0.5 h-4 w-4 shrink-0 text-ochre"
          strokeWidth={1.75}
        />
        <div className="min-w-0 flex-1">
          <p className="type-small font-semibold text-ink">
            Route planner heads-up
          </p>
          <ul className="mt-0.5 space-y-0.5">
            {caveats.map((c) => (
              <li key={c} className="type-caption leading-relaxed text-ink-2">
                {c}
              </li>
            ))}
          </ul>
        </div>
        <button
          type="button"
          onClick={dismiss}
          aria-label="Dismiss route planner notes"
          className="flex h-6 w-6 shrink-0 items-center justify-center rounded-sm text-ink-3 transition-colors duration-fast hover:bg-ochre/10 hover:text-ink"
        >
          <X className="h-3.5 w-3.5" strokeWidth={2} />
        </button>
      </div>
    </div>
  );
}
