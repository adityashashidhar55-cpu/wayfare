/**
 * StopMapsMenu (r24-smart, feature I) - per-stop "Open in maps" chip on stop
 * cards. Free deep links for everyone; Voyager gets the metered in-app embed.
 */
import { Crown, ExternalLink, Map as MapIcon } from "lucide-react";
import { useState } from "react";
import { useNavigate } from "react-router";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { placeLinks, type MapPoint } from "@contracts/map-links";
import { useTier } from "@/hooks/useTier";
import EmbeddedMapDialog from "./EmbeddedMapDialog";

export default function StopMapsMenu({ stop }: { stop: MapPoint }) {
  const { isPremium } = useTier();
  const navigate = useNavigate();
  const [embedOpen, setEmbedOpen] = useState(false);
  const links = placeLinks(stop);
  const point: MapPoint = { name: stop.name, lat: stop.lat, lng: stop.lng };

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            aria-label={`Open ${stop.name} in maps`}
            title="Open in maps"
            onClick={(e) => e.stopPropagation()}
            className="type-caption inline-flex items-center gap-1 rounded-pill bg-surface-2 px-2 py-0.5 font-semibold text-ink-2 transition-colors duration-fast hover:bg-border hover:text-ink"
          >
            <MapIcon className="h-3 w-3" strokeWidth={1.75} />
            Maps
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          align="start"
          className="w-56 rounded-lg"
          onClick={(e) => e.stopPropagation()}
        >
          <p className="type-eyebrow px-2 pb-1 pt-1.5 text-ink-3">Open in maps</p>
          <DropdownMenuItem asChild className="gap-2">
            <a href={links.google!} target="_blank" rel="noreferrer" className="flex w-full items-center gap-2">
              <ExternalLink className="h-3.5 w-3.5 text-ink-3" strokeWidth={1.75} />
              Google Maps
            </a>
          </DropdownMenuItem>
          <DropdownMenuItem asChild className="gap-2">
            <a href={links.apple!} target="_blank" rel="noreferrer" className="flex w-full items-center gap-2">
              <ExternalLink className="h-3.5 w-3.5 text-ink-3" strokeWidth={1.75} />
              Apple Maps
            </a>
          </DropdownMenuItem>
          <DropdownMenuItem asChild className="gap-2">
            <a href={links.osm!} target="_blank" rel="noreferrer" className="flex w-full items-center gap-2">
              <ExternalLink className="h-3.5 w-3.5 text-ink-3" strokeWidth={1.75} />
              OpenStreetMap
            </a>
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            className="gap-2"
            onClick={() => {
              if (isPremium) setEmbedOpen(true);
              else navigate("/pricing");
            }}
          >
            <MapIcon className="h-3.5 w-3.5 text-ink-3" strokeWidth={1.75} />
            View in app
            {!isPremium ? <Crown className="ml-auto h-3.5 w-3.5 text-ochre" strokeWidth={1.75} /> : null}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      {isPremium ? (
        <EmbeddedMapDialog
          points={[point]}
          open={embedOpen}
          onOpenChange={setEmbedOpen}
          title={stop.name}
        />
      ) : null}
    </>
  );
}
