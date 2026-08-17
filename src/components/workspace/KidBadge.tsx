import { Baby } from "lucide-react";
import { trpc } from "@/providers/trpc";
import { AGE_FIT_LABEL, ageFit, kidReason, parseChildAges } from "@contracts/kids";
import type { WsStop } from "./utils";

/**
 * Family badge on a stop card - shown only when the trip has kids mode on.
 * Renders an age-fit chip ("Ages 5-9") plus a one-line "why kids love it"
 * under the description. Classification mirrors the server generator exactly
 * (shared @contracts/kids), computed from the stop's name/category.
 */
export default function KidBadge({ stop }: { stop: WsStop }) {
  /* The workspace page already fetched trips.get - shared-cache read. */
  const q = trpc.trips.get.useQuery({ id: stop.tripId }, { staleTime: 60_000 });
  const trip = q.data?.trip;
  if (!trip?.withChildren) return null;
  const ages = parseChildAges(trip.childAges);
  const like = { name: stop.name, category: stop.category };
  const reason = kidReason(like, ages.length ? ages : undefined);
  if (!reason) return null;
  return (
    <span className="mt-1 block">
      <span className="type-caption inline-flex items-center gap-1 rounded-pill bg-ochre-soft px-2 py-0.5 font-semibold text-ochre">
        <Baby className="h-3 w-3" strokeWidth={1.75} />
        {AGE_FIT_LABEL[ageFit(like)]}
      </span>
      <span className="type-caption mt-0.5 block truncate text-ink-3" title={reason}>
        {reason}
      </span>
    </span>
  );
}
