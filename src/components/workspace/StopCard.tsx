import { useState } from "react";
import { motion } from "framer-motion";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import {
  Car,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Clock,
  Copy,
  ExternalLink,
  Footprints,
  GripVertical,
  Plane,
  Star,
  StickyNote,
  Ticket,
  TrainFront,
  TramFront,
  Trash2,
  UtensilsCrossed,
} from "lucide-react";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import { bookingLinks } from "@/lib/booking-links";
import { cn } from "@/lib/utils";
import { TransferChips, parseTransferNotes } from "./TransferChips";
import StopMapsMenu from "@/components/maps/StopMapsMenu";
import { formatMoneyCompact } from "@contracts/fx";
import { trpc } from "@/providers/trpc";
import KidBadge from "./KidBadge";
import {
  categoryMeta,
  dayLabel,
  formatDuration,
  formatKm,
  formatMinutes,
  haversineKm,
  travelEstimate,
  TRAVEL_MODES,
} from "./utils";
import type { TravelMode, WsDay, WsStop } from "./utils";

/* ── Price chip ("¥500" / "Free" / "≈€18") - stop matched to explore_places ──
   Every card calls the same trip-scoped query, so react-query shares one fetch. */

function StopPriceChip({ stop }: { stop: WsStop }) {
  const q = trpc.explore.stopPrices.useQuery(
    { tripId: stop.tripId },
    { staleTime: 60_000 }
  );
  const p = q.data?.prices.find(x => x.stopId === stop.id);
  if (!p) return null;
  const cur = p.feeCurrency ?? "USD";

  const isFood = p.category === "food";
  if (isFood && p.mealCents == null) return null;
  if (!isFood && p.feeCents == null) return null;

  const text = isFood
    ? `≈${formatMoneyCompact(p.mealCents!, cur)}`
    : p.feeCents === 0
      ? "Free"
      : `${p.estimated ? "≈" : ""}${formatMoneyCompact(p.feeCents!, cur)}`;
  const tip = isFood
    ? "Avg meal per person"
    : p.feeCents === 0
      ? "Free entry"
      : p.estimated
        ? "Avg adult ticket"
        : "Admission";
  const Icon = isFood ? UtensilsCrossed : Ticket;

  return (
    <span
      className="type-caption tnum inline-flex items-center gap-1 rounded-pill bg-surface-2 px-2 py-0.5 text-ink-2"
      title={tip}
    >
      <Icon className="h-3 w-3" strokeWidth={1.75} />
      {text}
    </span>
  );
}

const MODE_ICONS = {
  walking: Footprints,
  transit: TramFront,
  driving: Car,
  train: TrainFront,
} as const;

/* ── r24-core (H): per-leg transport mode + approx fare picker ── */

export type LegMode = "walk" | "transit" | "train" | "flight" | "car";

export const LEG_MODE_META: Record<
  LegMode,
  { label: string; icon: typeof Footprints }
> = {
  walk: { label: "Walk", icon: Footprints },
  transit: { label: "Transit", icon: TramFront },
  train: { label: "Train", icon: TrainFront },
  flight: { label: "Flight", icon: Plane },
  car: { label: "Car", icon: Car },
};

export interface LegFareOption {
  mode: LegMode;
  /** e.g. "approx $5-8" - already converted to the trip currency */
  fareText: string;
  available: boolean;
  note: string;
}

/* ── r24-core (G): Book menu - honest outbound deep links + booked tracking ──
   No in-app booking exists: links open provider searches in a new tab, and
   the traveler pastes the confirmation URL to mark the stop booked. */

function cityFromAddress(address: string | null | undefined): string | undefined {
  const parts = (address ?? "").split(",").map(s => s.trim()).filter(Boolean);
  return parts.length >= 2 ? parts[parts.length - 2] : undefined;
}

export function StopBookMenu({ stop }: { stop: WsStop }) {
  const utils = trpc.useUtils();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [url, setUrl] = useState(stop.bookingUrl ?? "");
  const markBooked = trpc.trips.markStopBooked.useMutation({
    onSettled: () => utils.trips.get.invalidate({ id: stop.tripId }),
  });
  const booked = stop.bookedAt != null;
  const links = bookingLinks(stop.name, cityFromAddress(stop.address));

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            onClick={e => e.stopPropagation()}
            title="Book this stop on a provider site (opens in a new tab)"
            className={cn(
              "type-caption inline-flex items-center gap-1 rounded-pill px-2 py-0.5 font-semibold transition-colors duration-fast",
              booked
                ? "bg-pine-soft text-pine"
                : "bg-surface-2 text-ink-2 hover:bg-border hover:text-ink"
            )}
          >
            {booked ? (
              <CheckCircle2 className="h-3 w-3" strokeWidth={2} />
            ) : (
              <ExternalLink className="h-3 w-3" strokeWidth={1.75} />
            )}
            {booked ? "Booked" : "Book"}
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          align="start"
          className="w-56 rounded-lg"
          onClick={e => e.stopPropagation()}
        >
          <p className="type-eyebrow px-2 pb-1 pt-1.5 text-ink-3">
            Book on a provider
          </p>
          {links.map(l => (
            <DropdownMenuItem key={l.key} asChild className="gap-2">
              <a
                href={l.url}
                target="_blank"
                // noopener (not noreferrer): still severs window.opener, but
                // keeps the Referer header, which some affiliate programs use
                // for attribution alongside the query-string partner id.
                rel="noopener"
                className="flex w-full items-center gap-2"
              >
                <ExternalLink className="h-3.5 w-3.5 text-ink-3" strokeWidth={1.75} />
                {l.label}
              </a>
            </DropdownMenuItem>
          ))}
          <DropdownMenuSeparator />
          <DropdownMenuItem
            className="gap-2"
            onClick={() => {
              setUrl(stop.bookingUrl ?? "");
              setDialogOpen(true);
            }}
          >
            <CheckCircle2 className="h-3.5 w-3.5 text-ink-3" strokeWidth={1.75} />
            {booked ? "Update booking…" : "Mark booked…"}
          </DropdownMenuItem>
          {booked ? (
            <DropdownMenuItem
              className="gap-2 text-danger focus:text-danger"
              onClick={() =>
                markBooked.mutate({ id: stop.id, tripId: stop.tripId, booked: false })
              }
            >
              <Trash2 className="h-3.5 w-3.5" strokeWidth={1.75} />
              Mark not booked
            </DropdownMenuItem>
          ) : null}
        </DropdownMenuContent>
      </DropdownMenu>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="rounded-xl sm:max-w-[420px]">
          <DialogHeader>
            <DialogTitle className="type-h4 text-ink">
              {booked ? "Update booking" : "Mark as booked"}
            </DialogTitle>
            <DialogDescription className="type-small text-ink-2">
              Booked on a provider site? Paste the confirmation link so the
              trip keeps track of it.
            </DialogDescription>
          </DialogHeader>
          <input
            value={url}
            onChange={e => setUrl(e.target.value)}
            placeholder="https://… confirmation URL (optional)"
            aria-label="Booking confirmation URL"
            className="type-small h-10 w-full rounded-md border border-border-strong bg-surface px-3 text-ink placeholder:text-ink-3 focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/40"
          />
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setDialogOpen(false)}>
              Cancel
            </Button>
            <Button
              disabled={markBooked.isPending}
              onClick={() => {
                markBooked.mutate(
                  {
                    id: stop.id,
                    tripId: stop.tripId,
                    booked: true,
                    bookingUrl: url.trim() || null,
                  },
                  { onSuccess: () => setDialogOpen(false) }
                );
              }}
            >
              {markBooked.isPending ? "Saving…" : "Mark booked"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

/** Legacy connector mode -> leg mode for fare display. */
function legModeForTravelMode(mode: TravelMode): LegMode {
  switch (mode) {
    case "walking":
      return "walk";
    case "transit":
      return "transit";
    case "train":
      return "train";
    default:
      return "car";
  }
}

/* ── Travel connector between two consecutive stops (§1.3) ──
   r24-core (H): when `legOptions` are provided the pill opens a mode picker
   with approx fares (Rome2Rio-style, everything approximate); otherwise it
   keeps the original click-to-cycle behavior. */

export function TravelConnector({
  from,
  to,
  mode,
  onCycle,
  legOptions,
  legSelected,
  onPickLeg,
}: {
  from: WsStop;
  to: WsStop;
  mode: TravelMode;
  onCycle: () => void;
  legOptions?: LegFareOption[];
  legSelected?: LegMode | null;
  onPickLeg?: (mode: LegMode) => void;
}) {
  const hasGeo =
    from.lat != null && from.lng != null && to.lat != null && to.lng != null;
  const km = hasGeo
    ? haversineKm(from.lat!, from.lng!, to.lat!, to.lng!)
    : null;
  const est = km != null ? travelEstimate(mode, km) : null;
  const Icon = MODE_ICONS[mode];
  const modeLabel = TRAVEL_MODES.find(m => m.key === mode)?.label ?? "Walk";

  const selectedLeg = legSelected ?? legModeForTravelMode(mode);
  const selectedOption = legOptions?.find(o => o.mode === selectedLeg);
  const LegIcon = LEG_MODE_META[selectedLeg].icon;

  const pillBody = (
    <>
      {legOptions ? (
        <LegIcon className="h-3 w-3" strokeWidth={1.75} />
      ) : (
        <Icon className="h-3 w-3" strokeWidth={1.75} />
      )}
      {est ? (
        <span className="tnum">
          {formatMinutes(est.minutes)} · {formatKm(est.km)}
        </span>
      ) : (
        LEG_MODE_META[selectedLeg].label ?? modeLabel
      )}
      {legOptions && selectedOption ? (
        <span className="tnum font-semibold text-ink">
          {selectedOption.fareText}
        </span>
      ) : null}
      {legOptions ? (
        <ChevronDown className="h-3 w-3 text-ink-3" strokeWidth={2} />
      ) : null}
    </>
  );

  return (
    <div className="relative flex h-10 items-center">
      <span
        className="absolute bottom-0 left-[37px] top-0 border-l border-dashed border-border-strong"
        aria-hidden
      />
      {legOptions && onPickLeg ? (
        <Popover>
          <PopoverTrigger asChild>
            <button
              type="button"
              title="Choose transport for this leg, fares are approximate"
              className="type-caption relative z-[1] ml-[46px] flex items-center gap-1.5 rounded-pill bg-surface-2 px-2.5 py-1 text-ink-2 transition-colors duration-fast hover:bg-border hover:text-ink"
            >
              {pillBody}
            </button>
          </PopoverTrigger>
          <PopoverContent align="start" className="w-64 rounded-lg p-1.5">
            <p className="type-eyebrow px-2 pb-1 pt-1 text-ink-3">
              This leg · approx fares
            </p>
            <ul>
              {legOptions.map(o => {
                const OIcon = LEG_MODE_META[o.mode].icon;
                const active = o.mode === selectedLeg;
                return (
                  <li key={o.mode}>
                    <button
                      type="button"
                      disabled={!o.available}
                      onClick={() => onPickLeg(o.mode)}
                      className={cn(
                        "flex w-full items-center gap-2.5 rounded-sm px-2 py-2 text-left transition-colors duration-fast disabled:opacity-45",
                        active ? "bg-brand-soft" : "hover:bg-surface-2"
                      )}
                    >
                      <span
                        className={cn(
                          "flex h-7 w-7 shrink-0 items-center justify-center rounded-full",
                          active
                            ? "bg-brand text-brand-ink"
                            : "bg-surface-2 text-ink-2"
                        )}
                      >
                        <OIcon className="h-3.5 w-3.5" strokeWidth={1.75} />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="type-small block font-semibold text-ink">
                          {LEG_MODE_META[o.mode].label}
                        </span>
                        <span className="type-caption block truncate text-ink-3">
                          {o.note}
                        </span>
                      </span>
                      <span className="type-caption tnum shrink-0 font-semibold text-ink">
                        {o.available ? o.fareText : "n/a"}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
            <p className="type-caption px-2 pb-1 pt-1.5 text-ink-3">
              Rough planning estimates only, check real fares before booking.
            </p>
          </PopoverContent>
        </Popover>
      ) : (
        <button
          type="button"
          onClick={onCycle}
          title={`Travel mode: ${modeLabel}, click to change`}
          className="type-caption relative z-[1] ml-[46px] flex items-center gap-1.5 rounded-pill bg-surface-2 px-2.5 py-1 text-ink-2 transition-colors duration-fast hover:bg-border hover:text-ink"
        >
          {pillBody}
        </button>
      )}
    </div>
  );
}

/* ── Card shell (shared by sortable card + drag overlay) ── */

export function StopCardShell({
  stop,
  number,
  color,
  selected,
  flash,
  onSelect,
  onEdit,
  onDelete,
  days,
  onDuplicate,
  onMove,
  stopIndex,
  stopCount,
  dragHandle,
  overlay,
}: {
  stop: WsStop;
  number: number;
  color: string;
  selected?: boolean;
  flash?: boolean;
  onSelect?: () => void;
  onEdit?: () => void;
  onDelete?: () => void;
  days?: WsDay[];
  onDuplicate?: (dayId: number | null) => void;
  /* r20-responsive: touch reorder - drag handles are pointer-first, so phones
     get explicit move up/down buttons (rendered in the mobile action row). */
  onMove?: (dir: -1 | 1) => void;
  stopIndex?: number;
  stopCount?: number;
  dragHandle?: React.ReactNode;
  overlay?: boolean;
}) {
  const meta = categoryMeta(stop.category);
  const [dupOpen, setDupOpen] = useState(false);
  const [imgBroken, setImgBroken] = useState(false);
  const transfer = parseTransferNotes(stop.notes); // road-trip intercity legs
  const orderedDays = days
    ? [...days].sort((a, b) => a.position - b.position)
    : [];

  return (
    <div
      onClick={onSelect}
      role={onSelect ? "button" : undefined}
      tabIndex={onSelect ? 0 : undefined}
      onKeyDown={
        onSelect
          ? e => {
              if (e.key === "Enter") onSelect();
            }
          : undefined
      }
      className={cn(
        "group relative flex items-center gap-2.5 rounded-md border bg-surface p-3 transition-colors duration-fast max-lg:flex-wrap",
        selected
          ? "border-transparent bg-brand-soft/60 shadow-[inset_2px_0_0_var(--brand)]"
          : "border-border hover:border-border-strong",
        overlay && "scale-[1.02] shadow-lg",
        flash && "animate-pulse-ring",
        onSelect && "cursor-pointer"
      )}
    >
      {/* drag handle */}
      <span className="flex w-4 shrink-0 items-center justify-center text-ink-3 opacity-60 transition-opacity duration-fast group-hover:opacity-100">
        {dragHandle ?? <GripVertical className="h-4 w-4" strokeWidth={1.75} />}
      </span>

      {/* number badge, matches the map pin exactly */}
      <motion.span
        key={number}
        initial={{ scale: 1.35, opacity: 0.2 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={{ type: "spring", stiffness: 500, damping: 28 }}
        className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full font-serif text-[13px] font-semibold leading-none text-white"
        style={{ backgroundColor: color }}
      >
        {number}
      </motion.span>

      {/* thumb with category badge (hidden <400px), onError hides it so a
          broken URL (e.g. stale lodging photo) never renders as a broken img */}
      {stop.image && !imgBroken ? (
        <span className="relative hidden shrink-0 min-[400px]:block">
          <img
            src={stop.image}
            alt=""
            onError={() => setImgBroken(true)}
            className="photo h-14 w-14 rounded-sm object-cover"
          />
          <span
            className="absolute -bottom-1 -right-1 flex h-5 w-5 items-center justify-center rounded-full text-white ring-2 ring-surface"
            style={{ backgroundColor: meta.color }}
            title={meta.label}
          >
            <meta.icon className="h-3 w-3" strokeWidth={1.75} />
          </span>
        </span>
      ) : null}

      {/* content */}
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[14px] font-semibold text-ink">
          {stop.name}
        </span>
        <span className="mt-1 flex flex-wrap items-center gap-1.5">
          <span
            className="type-caption inline-flex items-center gap-1 rounded-pill px-2 py-0.5"
            style={{ backgroundColor: `${meta.color}1f`, color: meta.color }}
          >
            <meta.icon className="h-3 w-3" strokeWidth={1.75} />
            {meta.label}
          </span>
          {formatDuration(stop.durationMin) ? (
            <span className="type-caption inline-flex items-center gap-1 rounded-pill bg-surface-2 px-2 py-0.5 text-ink-2">
              <Clock className="h-3 w-3" strokeWidth={1.75} />
              {formatDuration(stop.durationMin)}
            </span>
          ) : null}
          <StopPriceChip stop={stop} />
          {!overlay && onEdit ? <StopBookMenu stop={stop} /> : null}
          {/* r24-smart I: per-stop Open-in-maps menu */}
          {!overlay ? <StopMapsMenu stop={stop} /> : null}
          {stop.famousEatery ? (
            <span
              title="One of the most famous eateries in town, a popular pick"
              className="type-caption inline-flex items-center gap-1 rounded-pill bg-ochre-soft px-2 py-0.5 font-semibold text-ochre"
            >
              <Star className="h-3 w-3 fill-ochre text-ochre" strokeWidth={1.75} />
              Famous pick
            </span>
          ) : null}
        </span>
        {transfer ? (
          <TransferChips transfer={transfer} />
        ) : stop.notes ? (
          <span className="type-caption mt-1 flex items-center gap-1 truncate text-ink-3">
            <StickyNote className="h-3 w-3 shrink-0" strokeWidth={1.75} />
            <span className="truncate">{stop.notes}</span>
          </span>
        ) : null}
        {/* kids mode: age-fit chip + one-line reason (renders null otherwise) */}
        <KidBadge stop={stop} />
      </span>

      {/* time col */}
      <button
        type="button"
        onClick={e => {
          e.stopPropagation();
          onEdit?.();
        }}
        title="Edit time & details"
        className="flex shrink-0 flex-col items-end gap-0.5 rounded-sm px-1 py-0.5 opacity-60 transition-opacity duration-fast hover:bg-surface-2 group-hover:opacity-100"
      >
        <span className="tnum text-[13px] font-semibold text-ink">
          {stop.startTime ?? "-"}
        </span>
        <span className="type-caption text-ink-3">
          {formatDuration(stop.durationMin) ?? ""}
        </span>
      </button>

      {/* hover quick actions */}
      {!overlay && (onEdit || onDelete || onDuplicate) ? (
        <span className="absolute right-2 top-2 flex items-center gap-0.5 rounded-md border border-border bg-surface p-0.5 opacity-0 shadow-sm transition-opacity duration-fast group-hover:opacity-100">
          {onEdit ? (
            <button
              type="button"
              aria-label="Reschedule"
              title="Reschedule"
              onClick={e => {
                e.stopPropagation();
                onEdit();
              }}
              className="flex h-6 w-6 items-center justify-center rounded-sm text-ink-3 transition-colors duration-fast hover:bg-surface-2 hover:text-ink"
            >
              <Clock className="h-3.5 w-3.5" strokeWidth={1.75} />
            </button>
          ) : null}
          {onDuplicate && days && days.length > 1 ? (
            <Popover open={dupOpen} onOpenChange={setDupOpen}>
              <PopoverTrigger asChild>
                <button
                  type="button"
                  aria-label="Duplicate to another day"
                  title="Duplicate to another day"
                  onClick={e => e.stopPropagation()}
                  className="flex h-6 w-6 items-center justify-center rounded-sm text-ink-3 transition-colors duration-fast hover:bg-surface-2 hover:text-ink"
                >
                  <Copy className="h-3.5 w-3.5" strokeWidth={1.75} />
                </button>
              </PopoverTrigger>
              <PopoverContent
                align="end"
                className="w-44 rounded-lg p-1"
                onClick={e => e.stopPropagation()}
              >
                <p className="type-eyebrow px-2 py-1.5 text-ink-3">
                  Duplicate to
                </p>
                {orderedDays.map((d, i) => (
                  <button
                    key={d.id}
                    type="button"
                    onClick={() => {
                      setDupOpen(false);
                      onDuplicate(d.id);
                    }}
                    className="type-small flex w-full items-center rounded-sm px-2 py-1.5 text-left text-ink-2 transition-colors duration-fast hover:bg-surface-2 hover:text-ink"
                  >
                    {dayLabel(i)}
                  </button>
                ))}
              </PopoverContent>
            </Popover>
          ) : null}
          {onDelete ? (
            <button
              type="button"
              aria-label="Remove stop"
              title="Remove stop"
              onClick={e => {
                e.stopPropagation();
                onDelete();
              }}
              className="flex h-6 w-6 items-center justify-center rounded-sm text-ink-3 transition-colors duration-fast hover:bg-danger/10 hover:text-danger"
            >
              <Trash2 className="h-3.5 w-3.5" strokeWidth={1.75} />
            </button>
          ) : null}
        </span>
      ) : null}

      {/* r20-responsive: touch action row (hover quick actions never fire on
          phones). 40px targets: move up/down replaces pointer-only drag, plus
          duplicate + remove which are otherwise unreachable by touch. */}
      {!overlay && (onMove || onDelete || onDuplicate) ? (
        <div className="order-last mt-1 flex basis-full items-center justify-end gap-1 lg:hidden">
          {onMove ? (
            <>
              <button
                type="button"
                aria-label={`Move ${stop.name} up`}
                title="Move up"
                disabled={stopIndex != null && stopIndex <= 0}
                onClick={e => {
                  e.stopPropagation();
                  onMove(-1);
                }}
                className="flex h-10 w-10 items-center justify-center rounded-md border border-border bg-surface text-ink-2 transition-colors duration-fast active:bg-surface-2 disabled:opacity-40"
              >
                <ChevronUp className="h-4 w-4" strokeWidth={1.75} />
              </button>
              <button
                type="button"
                aria-label={`Move ${stop.name} down`}
                title="Move down"
                disabled={stopIndex != null && stopCount != null && stopIndex >= stopCount - 1}
                onClick={e => {
                  e.stopPropagation();
                  onMove(1);
                }}
                className="flex h-10 w-10 items-center justify-center rounded-md border border-border bg-surface text-ink-2 transition-colors duration-fast active:bg-surface-2 disabled:opacity-40"
              >
                <ChevronDown className="h-4 w-4" strokeWidth={1.75} />
              </button>
            </>
          ) : null}
          {onDuplicate && days && days.length > 1 ? (
            <Popover open={dupOpen} onOpenChange={setDupOpen}>
              <PopoverTrigger asChild>
                <button
                  type="button"
                  aria-label="Duplicate to another day"
                  title="Duplicate to another day"
                  onClick={e => e.stopPropagation()}
                  className="flex h-10 w-10 items-center justify-center rounded-md border border-border bg-surface text-ink-2 transition-colors duration-fast active:bg-surface-2"
                >
                  <Copy className="h-4 w-4" strokeWidth={1.75} />
                </button>
              </PopoverTrigger>
              <PopoverContent
                align="end"
                className="w-44 rounded-lg p-1"
                onClick={e => e.stopPropagation()}
              >
                <p className="type-eyebrow px-2 py-1.5 text-ink-3">
                  Duplicate to
                </p>
                {orderedDays.map((d, i) => (
                  <button
                    key={d.id}
                    type="button"
                    onClick={() => {
                      setDupOpen(false);
                      onDuplicate(d.id);
                    }}
                    className="type-small flex w-full items-center rounded-sm px-2 py-1.5 text-left text-ink-2 transition-colors duration-fast hover:bg-surface-2 hover:text-ink"
                  >
                    {dayLabel(i)}
                  </button>
                ))}
              </PopoverContent>
            </Popover>
          ) : null}
          {onDelete ? (
            <button
              type="button"
              aria-label="Remove stop"
              title="Remove stop"
              onClick={e => {
                e.stopPropagation();
                onDelete();
              }}
              className="flex h-10 w-10 items-center justify-center rounded-md border border-border bg-surface text-danger transition-colors duration-fast active:bg-danger/10"
            >
              <Trash2 className="h-4 w-4" strokeWidth={1.75} />
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

/* ── Sortable wrapper ── */

export interface SortableStopCardProps {
  stop: WsStop;
  number: number;
  color: string;
  selected: boolean;
  flash: boolean;
  connector?: {
    from: WsStop;
    mode: TravelMode;
    onCycle: () => void;
    /* r24-core (H): approx fare picker for this leg */
    legOptions?: LegFareOption[];
    legSelected?: LegMode | null;
    onPickLeg?: (mode: LegMode) => void;
  } | null;
  onSelect: () => void;
  onEdit: () => void;
  onDelete: () => void;
  days: WsDay[];
  onDuplicate: (dayId: number | null) => void;
  /* r20-responsive: touch reorder buttons (phones/tablets) */
  onMove?: (dir: -1 | 1) => void;
  stopIndex?: number;
  stopCount?: number;
  registerRef?: (id: number, el: HTMLDivElement | null) => void;
}

export function SortableStopCard({
  stop,
  number,
  color,
  selected,
  flash,
  connector,
  onSelect,
  onEdit,
  onDelete,
  days,
  onDuplicate,
  onMove,
  stopIndex,
  stopCount,
  registerRef,
}: SortableStopCardProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({
    id: `stop-${stop.id}`,
  });

  return (
    <div
      ref={el => {
        setNodeRef(el);
        registerRef?.(stop.id, el);
      }}
      style={{
        transform: CSS.Translate.toString(transform),
        transition: transition ?? "transform 300ms cubic-bezier(.22,1,.36,1)",
      }}
      className="relative"
    >
      {connector ? (
        <TravelConnector
          from={connector.from}
          to={stop}
          mode={connector.mode}
          onCycle={connector.onCycle}
          legOptions={connector.legOptions}
          legSelected={connector.legSelected}
          onPickLeg={connector.onPickLeg}
        />
      ) : null}
      {isDragging ? (
        /* §1.4: drop target - 3px brand gap line animating open */
        <motion.div
          initial={{ height: 0, opacity: 0 }}
          animate={{ height: 64, opacity: 1 }}
          transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
          className="flex items-center overflow-hidden"
          aria-hidden
        >
          <div className="h-[3px] w-full rounded-full bg-brand/70" />
        </motion.div>
      ) : (
        <StopCardShell
          stop={stop}
          number={number}
          color={color}
          selected={selected}
          flash={flash}
          onSelect={onSelect}
          onEdit={onEdit}
          onDelete={onDelete}
          days={days}
          onDuplicate={onDuplicate}
          onMove={onMove}
          stopIndex={stopIndex}
          stopCount={stopCount}
          dragHandle={
            <span
              {...attributes}
              {...listeners}
              role="button"
              aria-label={`Drag ${stop.name} to reorder`}
              tabIndex={0}
              className="cursor-grab rounded-sm p-0.5 outline-none active:cursor-grabbing"
              onClick={e => e.stopPropagation()}
            >
              <GripVertical className="h-4 w-4" strokeWidth={1.75} />
            </span>
          }
        />
      )}
    </div>
  );
}
