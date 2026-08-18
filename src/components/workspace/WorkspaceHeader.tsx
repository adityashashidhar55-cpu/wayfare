import { useEffect, useRef, useState } from "react";
import { Link } from "react-router";
import { motion } from "framer-motion";
import {
  CalendarDays,
  Check,
  Link2,
  Map,
  NotebookPen,
  CheckSquare,
  BookMarked,
  Wallet,
  Share2,
  UserPlus,
  Users,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { UserAvatar } from "@/components/UserAvatar";
import { trpc } from "@/providers/trpc";
import { cn } from "@/lib/utils";
import { fullDateRange } from "./utils";
import type { TripData } from "./utils";
import { useToast } from "./Toasts";
import { RouteWarningsBanner } from "@/components/roadtrip/RouteWarningsBanner"; // r12-routeui
import { ShareTripDialog } from "@/components/trips/ShareTripDialog"; // r12-share
import ShareLiveToggle from "./ShareLiveToggle";
import ChildModeToggle from "./ChildModeToggle";
import TripInsights from "./TripInsights";
import TripCostChip from "./TripCostChip";
import FinalizePanel from "./FinalizePanel";
import TravelModeToggle from "./TravelMode"; // r24-smart N

export type WorkspaceTab =
  "itinerary" | "crew" | "reservations" | "checklists" | "notes";

export const WORKSPACE_TABS: {
  key: WorkspaceTab;
  label: string;
  icon: typeof Map;
}[] = [
  { key: "itinerary", label: "Itinerary", icon: Map },
  // r32: chat + voting. Sits second because deciding WHERE to go is the
  // argument that happens before anything else on this list matters.
  { key: "crew", label: "Crew", icon: Users },
  { key: "reservations", label: "Reservations", icon: BookMarked },
  { key: "checklists", label: "Checklists", icon: CheckSquare },
  { key: "notes", label: "Notes", icon: NotebookPen },
];

export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    try {
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      document.body.removeChild(ta);
      return true;
    } catch {
      return false;
    }
  }
}

/* ── Editable trip title (§0: click → inline input, brand caret, Enter/blur saves) ── */

function EditableTitle({ tripId, title }: { tripId: number; title: string }) {
  const utils = trpc.useUtils();
  const { push } = useToast();
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(title);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editing) inputRef.current?.select();
  }, [editing]);

  const update = trpc.trips.update.useMutation({
    onSuccess: () => utils.trips.get.invalidate({ id: tripId }),
    onError: e =>
      push({
        title: "Could not rename trip",
        description: e.message,
        kind: "danger",
      }),
  });

  const commit = () => {
    const next = value.trim();
    setEditing(false);
    if (next && next !== title) update.mutate({ id: tripId, title: next });
    else setValue(title);
  };

  if (editing) {
    return (
      <input
        ref={inputRef}
        value={value}
        onChange={e => setValue(e.target.value)}
        onBlur={commit}
        onKeyDown={e => {
          if (e.key === "Enter") commit();
          if (e.key === "Escape") {
            setValue(title);
            setEditing(false);
          }
        }}
        className="type-h3 w-full min-w-0 max-w-[320px] rounded-sm border border-brand/40 bg-surface px-1.5 py-0.5 text-ink caret-brand outline-none"
        aria-label="Trip title"
      />
    );
  }
  return (
    <button
      type="button"
      onClick={() => {
        setValue(title);
        setEditing(true);
      }}
      title="Click to rename"
      className="type-h3 truncate rounded-sm px-1.5 py-0.5 text-left text-ink transition-colors duration-fast hover:bg-surface-2"
    >
      {title}
    </button>
  );
}

/* ── Segmented workspace tabs (§10.4: pill container, layoutId spring 300ms) ── */

export function WorkspaceTabs({
  tab,
  onChange,
  tripId,
}: {
  tab: WorkspaceTab;
  onChange: (t: WorkspaceTab) => void;
  tripId: number;
}) {
  return (
    <div
      role="tablist"
      aria-label="Workspace sections"
      className="flex items-center gap-1 overflow-x-auto rounded-pill bg-surface-2 p-1"
    >
      {WORKSPACE_TABS.map(t => {
        const Icon = t.icon;
        const active = t.key === tab;
        return (
          <button
            key={t.key}
            role="tab"
            aria-selected={active}
            onClick={() => onChange(t.key)}
            className={cn(
              "relative flex shrink-0 items-center gap-1.5 rounded-pill px-3.5 py-1.5 text-[13px] font-semibold transition-colors duration-fast",
              active ? "text-ink" : "text-ink-3 hover:text-ink-2"
            )}
          >
            {active ? (
              <motion.span
                layoutId="ws-tab-pill"
                className="absolute inset-0 rounded-pill bg-surface shadow-sm"
                transition={{ type: "spring", stiffness: 380, damping: 30 }}
              />
            ) : null}
            <Icon className="relative h-3.5 w-3.5" strokeWidth={1.75} />
            <span className="relative">{t.label}</span>
          </button>
        );
      })}
      {/* Expenses lives at the sibling route */}
      <Link
        to={`/trips/${tripId}/expenses`}
        className="flex shrink-0 items-center gap-1.5 rounded-pill px-3.5 py-1.5 text-[13px] font-semibold text-ink-3 transition-colors duration-fast hover:text-ink-2"
      >
        <Wallet className="h-3.5 w-3.5" strokeWidth={1.75} />
        <span>Expenses</span>
      </Link>
    </div>
  );
}

/* ── Members bar: presence avatar stack + people popover + share modal ── */

function PresenceAvatar({
  name,
  color,
  className,
}: {
  name: string;
  color?: string | null;
  className?: string;
}) {
  return (
    <span className={cn("relative inline-block shrink-0", className)}>
      <UserAvatar name={name} className="h-7 w-7 text-[11px]" />
      {color ? (
        <span
          className="absolute -bottom-px -right-px h-2 w-2 rounded-full ring-[1.5px] ring-surface"
          style={{ backgroundColor: color }}
          aria-hidden
        />
      ) : null}
    </span>
  );
}

export function MembersBar({
  data,
  tripId,
}: {
  data: TripData;
  tripId: number;
}) {
  const { push } = useToast();
  const [shareOpen, setShareOpen] = useState(false);
  const [peopleOpen, setPeopleOpen] = useState(false);
  const members = data.members;
  const tripUrl =
    typeof window !== "undefined"
      ? `${window.location.origin}/trips/${tripId}`
      : `/trips/${tripId}`;

  const copyLink = async () => {
    const ok = await copyText(tripUrl);
    push(
      ok
        ? {
            title: "Link copied",
            description: "Anyone with the link can ask to join.",
            kind: "success",
          }
        : { title: "Copy failed", kind: "danger" }
    );
  };

  const visible = members.slice(0, 4);
  const overflow = members.length - visible.length;

  return (
    <div className="flex items-center gap-2">
      {/* Avatar stack, fans out on hover (§10.4) */}
      <Popover open={peopleOpen} onOpenChange={setPeopleOpen}>
        <PopoverTrigger asChild>
          <button
            type="button"
            aria-label="Trip members"
            className="group flex items-center rounded-pill py-1 pl-2 pr-1 transition-colors duration-fast hover:bg-surface-2 max-[420px]:hidden"
          >
            {visible.map(m => (
              <PresenceAvatar
                key={m.id}
                name={m.name}
                color={m.presenceColor}
                className="-ml-2 transition-all duration-fast ease-spring-soft first:ml-0 group-hover:-ml-1"
              />
            ))}
            {overflow > 0 ? (
              <span className="type-caption -ml-2 inline-flex h-7 items-center rounded-full bg-surface-2 px-1.5 text-ink-2 ring-2 ring-surface">
                +{overflow}
              </span>
            ) : null}
          </button>
        </PopoverTrigger>
        <PopoverContent align="end" className="w-80 rounded-xl p-0">
          <div className="border-b border-border px-4 py-3">
            <p className="type-h4 flex items-center gap-2 text-ink">
              <Users className="h-4 w-4 text-ink-3" strokeWidth={1.75} /> People
            </p>
          </div>
          <ul className="max-h-56 overflow-y-auto px-2 py-2">
            {members.map(m => (
              <li
                key={m.id}
                className="flex items-center gap-3 rounded-md px-2 py-2 transition-colors duration-fast hover:bg-surface-2"
              >
                <PresenceAvatar name={m.name} color={m.presenceColor} />
                <span className="min-w-0 flex-1">
                  <span className="type-small block truncate text-ink">
                    {m.name}
                  </span>
                  <span className="type-caption block truncate text-ink-3">
                    {m.email ?? "Invited guest"}
                  </span>
                </span>
                <span
                  className={cn(
                    "type-caption rounded-pill px-2 py-0.5",
                    m.role === "owner"
                      ? "bg-brand-soft text-brand"
                      : "bg-surface-2 text-ink-3"
                  )}
                >
                  {m.role === "owner"
                    ? "Owner"
                    : m.role === "editor"
                      ? "Editor"
                      : "Viewer"}
                </span>
              </li>
            ))}
          </ul>
          <div className="space-y-2 border-t border-border p-3">
            <Button
              variant="secondary"
              size="sm"
              className="w-full"
              onClick={copyLink}
            >
              <Link2 className="h-3.5 w-3.5" /> Copy invite link
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="w-full text-brand"
              onClick={() => {
                setPeopleOpen(false);
                setShareOpen(true);
              }}
            >
              <UserPlus className="h-3.5 w-3.5" /> Invite people
            </Button>
          </div>
        </PopoverContent>
      </Popover>

      <ShareLiveToggle tripId={tripId} />

      <Button
        variant="secondary"
        size="sm"
        pill
        onClick={() => setShareOpen(true)}
      >
        <Share2 className="h-3.5 w-3.5" /> Share
      </Button>

      {/* r12: the rebuilt share dialog, public link + email invites that
          actually link accounts + roles + member management (was a dead
          invite form + a useless /trips link) */}
      <ShareTripDialog
        trip={{ ...data.trip, members, status: "planned" }}
        tier={data.tier}
        open={shareOpen}
        onOpenChange={setShareOpen}
      />
    </div>
  );
}

/* ── The sticky workspace bar shared by all tabs (§0) ── */

export function WorkspaceHeader({
  data,
  tripId,
  tab,
  onTabChange,
}: {
  data: TripData;
  tripId: number;
  tab: WorkspaceTab;
  onTabChange: (t: WorkspaceTab) => void;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: -12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.32, ease: [0.22, 1, 0.36, 1] }}
      className="glass-strong sticky top-16 z-30 border-b border-border"
    >
      <div className="mx-auto flex max-w-[1600px] flex-col gap-2 px-4 py-2.5 md:px-6">
        <div className="flex items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-3">
            {data.trip.coverImage ? (
              <img
                src={data.trip.coverImage}
                alt=""
                className="photo h-10 w-10 shrink-0 rounded-sm object-cover"
              />
            ) : (
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-sm bg-brand-soft font-serif text-[15px] font-semibold text-brand">
                {data.trip.title.charAt(0)}
              </span>
            )}
            <div className="min-w-0">
              <EditableTitle tripId={tripId} title={data.trip.title} />
              <span className="type-caption flex min-w-0 items-center gap-1.5 px-1.5 text-ink-3">
                <CalendarDays className="h-3 w-3 shrink-0" strokeWidth={1.75} />
                <span className="truncate">
                  {fullDateRange(data.trip.startDate, data.trip.endDate)}
                  <span aria-hidden> · </span>
                  {data.trip.destination}
                </span>
              </span>
              {/* Insights row, desktop: tucks under the title; on narrow
                  screens the members bar squeezes this column, so a second
                  instance below spans the full header width instead. */}
              <div className="max-md:hidden">
                <TripInsights tripId={tripId} />
              </div>
            </div>
          </div>
          <MembersBar data={data} tripId={tripId} />
        </div>
        <div className="md:hidden">
          <TripInsights tripId={tripId} />
        </div>
        <div className="flex items-center justify-between gap-3">
          <WorkspaceTabs tab={tab} onChange={onTabChange} tripId={tripId} />
          <span className="flex items-center gap-2.5">
            {/* r24-core (A+J): planned-vs-budget chip with breakdown popover */}
            <TripCostChip data={data} tripId={tripId} />
            {/* r24-core (M-lite): readiness checklist */}
            <FinalizePanel data={data} />
            {/* r24-smart N: travel mode (premium, trips in progress only) */}
            <TravelModeToggle data={data} tripId={tripId} />
            {/* r24-core (G): bookings channel */}
            <Link
              to={`/trips/${tripId}/bookings`}
              title="Bookings: track what is reserved and export a summary"
              className="type-caption inline-flex shrink-0 items-center gap-1.5 rounded-pill bg-surface-2 px-2.5 py-1 font-semibold text-ink-2 transition-colors duration-fast hover:bg-border hover:text-ink"
            >
              <Wallet className="h-3.5 w-3.5" strokeWidth={1.75} />
              Bookings
            </Link>
            <ChildModeToggle
              tripId={tripId}
              withChildren={data.trip.withChildren ?? false}
              childAges={data.trip.childAges ?? null}
            />
            <span
              className="type-caption hidden items-center gap-1.5 text-ink-3 md:flex"
              aria-live="polite"
            >
              <Check className="h-3 w-3 text-pine" strokeWidth={2} /> Autosaved
            </span>
          </span>
        </div>
        {/* r12-routeui: road-trip planner caveats (geocode corrections,
            skipped stopovers) persisted on the trip note, dismissible. */}
        <RouteWarningsBanner note={data.note} tripId={tripId} />
      </div>
    </motion.div>
  );
}
