/**
 * EmbeddedMapDialog (r24-smart, feature I) - premium in-app Google Maps
 * embed. The server meters every view (100/month cap) and keeps the API key
 * off the client. Three honest states: the map, "embed unavailable" (no key
 * configured), and "cap reached, use the free links".
 */
import { useEffect, useState } from "react";
import { Crown, ExternalLink, MapPin } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { trpc } from "@/providers/trpc";
import { placeLinks, routeLinks, type MapPoint } from "@contracts/map-links";

function FreeLinks({ points }: { points: MapPoint[] }) {
  const links = points.length > 1 ? routeLinks(points) : points[0] ? placeLinks(points[0]) : null;
  if (!links) return null;
  const items = [
    { label: "Google Maps", url: links.google },
    { label: "Apple Maps", url: links.apple },
    { label: "OpenStreetMap", url: links.osm },
  ].filter((l) => l.url);
  return (
    <div className="flex flex-wrap gap-2">
      {items.map((l) => (
        <a
          key={l.label}
          href={l.url!}
          target="_blank"
          rel="noreferrer"
          className="type-small inline-flex h-9 items-center gap-1.5 rounded-md border border-border-strong px-3 font-semibold text-ink-2 transition-colors duration-fast hover:border-brand hover:text-brand"
        >
          <ExternalLink className="h-3.5 w-3.5" strokeWidth={1.75} />
          {l.label}
        </a>
      ))}
    </div>
  );
}

export default function EmbeddedMapDialog({
  points,
  open,
  onOpenChange,
  title,
}: {
  points: MapPoint[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
}) {
  const embed = trpc.maps.embed.useMutation();
  const [capReached, setCapReached] = useState(false);

  useEffect(() => {
    if (!open) return;
    setCapReached(false);
    embed.mutate(
      { stops: points.map((p) => ({ name: p.name, lat: p.lat ?? null, lng: p.lng ?? null })) },
      {
        onError: (e) => {
          if (e.message === "MAPS_CAP_REACHED") setCapReached(true);
        },
      },
    );
    // One embed request per dialog open.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const d = embed.data;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="rounded-xl sm:max-w-[720px]">
        <DialogHeader>
          <DialogTitle className="type-h4 flex items-center gap-2 text-ink">
            <MapPin className="h-4 w-4 text-brand" strokeWidth={1.75} />
            {title}
            <span className="type-caption inline-flex items-center gap-1 rounded-pill bg-ochre-soft px-2 py-0.5 font-semibold text-ochre">
              <Crown className="h-3 w-3" strokeWidth={1.75} />
              Voyager
            </span>
          </DialogTitle>
          <DialogDescription className="type-small text-ink-2">
            {d?.available
              ? `In-app map, ${d.used}/${d.cap} embed views used this month.`
              : "The free map links always work, no matter what."}
          </DialogDescription>
        </DialogHeader>

        {capReached ? (
          <div className="space-y-3 rounded-lg border border-border bg-surface-2/50 p-4">
            <p className="type-small font-semibold text-ink">Monthly map-view cap reached</p>
            <p className="type-small text-ink-2">
              You've used all {d?.cap ?? 100} in-app map views this month. The free links below
              open the same route in your maps app.
            </p>
            <FreeLinks points={points} />
          </div>
        ) : embed.isPending ? (
          <div className="flex h-[380px] items-center justify-center rounded-lg border border-border bg-surface-2/50">
            <p className="type-small text-ink-3">Loading the map…</p>
          </div>
        ) : d?.available ? (
          <iframe
            title={title}
            src={d.url}
            className="h-[380px] w-full rounded-lg border border-border"
            loading="lazy"
            referrerPolicy="no-referrer-when-downgrade"
            allowFullScreen
          />
        ) : (
          <div className="space-y-3 rounded-lg border border-border bg-surface-2/50 p-4" data-testid="maps-embed-unavailable">
            <p className="type-small font-semibold text-ink">Maps embed unavailable right now</p>
            <p className="type-small text-ink-2">
              The in-app map needs a Google Maps key that isn't configured on this server. These
              free links open the same {points.length > 1 ? "route" : "place"} in your maps app.
            </p>
            <FreeLinks points={points} />
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
