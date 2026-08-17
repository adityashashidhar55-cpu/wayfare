/**
 * OpenInMapsSub (r24-smart, feature I) - the "Open in maps" submenu shared
 * by stop cards and day headers. Free deep links (Google / Apple / OSM) for
 * everyone; premium users also get "View in app" (EmbeddedMapDialog,
 * api-metered). Render inside a DropdownMenuContent.
 */
import { useState } from "react";
import { Crown, ExternalLink, Map as MapIcon } from "lucide-react";
import { useNavigate } from "react-router";
import {
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
} from "@/components/ui/dropdown-menu";
import { placeLinks, routeLinks, type MapPoint } from "@contracts/map-links";
import EmbeddedMapDialog from "./EmbeddedMapDialog";

export default function OpenInMapsSub({
  points,
  isPremium,
  label,
}: {
  /** One stop, or the day's ordered stops for a route. */
  points: MapPoint[];
  isPremium: boolean;
  /** Menu label, e.g. "Open day in maps" / "Open in maps". */
  label: string;
}) {
  const navigate = useNavigate();
  const [embedOpen, setEmbedOpen] = useState(false);
  const links = points.length > 1 ? routeLinks(points) : points[0] ? placeLinks(points[0]) : null;

  return (
    <>
      <DropdownMenuSub>
        <DropdownMenuSubTrigger className="gap-2">
          <MapIcon className="h-4 w-4" strokeWidth={1.75} />
          {label}
        </DropdownMenuSubTrigger>
        <DropdownMenuSubContent className="w-56 rounded-lg">
          {links?.google ? (
            <DropdownMenuItem asChild className="gap-2">
              <a href={links.google} target="_blank" rel="noreferrer" className="flex w-full items-center gap-2">
                <ExternalLink className="h-3.5 w-3.5 text-ink-3" strokeWidth={1.75} />
                Google Maps
              </a>
            </DropdownMenuItem>
          ) : null}
          {links?.apple ? (
            <DropdownMenuItem asChild className="gap-2">
              <a href={links.apple} target="_blank" rel="noreferrer" className="flex w-full items-center gap-2">
                <ExternalLink className="h-3.5 w-3.5 text-ink-3" strokeWidth={1.75} />
                Apple Maps
              </a>
            </DropdownMenuItem>
          ) : null}
          {links?.osm ? (
            <DropdownMenuItem asChild className="gap-2">
              <a href={links.osm} target="_blank" rel="noreferrer" className="flex w-full items-center gap-2">
                <ExternalLink className="h-3.5 w-3.5 text-ink-3" strokeWidth={1.75} />
                OpenStreetMap
              </a>
            </DropdownMenuItem>
          ) : null}
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
            {!isPremium ? (
              <Crown className="ml-auto h-3.5 w-3.5 text-ochre" strokeWidth={1.75} />
            ) : null}
          </DropdownMenuItem>
        </DropdownMenuSubContent>
      </DropdownMenuSub>
      {isPremium ? (
        <EmbeddedMapDialog
          points={points}
          open={embedOpen}
          onOpenChange={setEmbedOpen}
          title={label}
        />
      ) : null}
    </>
  );
}
