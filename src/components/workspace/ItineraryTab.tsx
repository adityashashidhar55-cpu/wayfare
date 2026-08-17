import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { motion } from "framer-motion";
import {
  DndContext,
  DragOverlay,
  MeasuringStrategy,
  PointerSensor,
  closestCorners,
  useDroppable,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import type {
  DragEndEvent,
  DragOverEvent,
  DragStartEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import {
  Bus,
  Car,
  ChevronDown,
  ChevronUp,
  Crown,
  GripVertical,
  Loader2,
  Map as MapIcon,
  MoreHorizontal,
  Plus,
  Route,
  Sparkles,
  Trash2,
  TrainFront,
  Wand2,
} from "lucide-react";
import { dayColor } from "@/lib/map";
import {
  countryFromDestination,
  estimateLeg,
  estimateMidCents,
} from "../../../api/lib/transport-estimate";
import { convertCents } from "@/lib/day-cost";
import { formatMoneyCompact } from "@contracts/fx";
import { useTheme } from "@/hooks/useTheme";
import { trpc } from "@/providers/trpc";
import { VoyagerUpsellDialog } from "@/components/trips/AiTripBuilder";
import type maplibregl from "maplibre-gl";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import MapPane from "./MapPane";
import MapSearchOverlay from "./MapSearchOverlay";
import NearMeOverlay from "./NearMeOverlay";
import AddPlacePinPopover from "./AddPlacePinPopover";
import DayFillOptions, { type DayFillChoice } from "./DayFillOptions";
import OptimizePill from "./OptimizePill";
import AddPlaceOverlay from "./AddPlaceOverlay";
import StopEditDialog from "./StopEditDialog";
import DayTransportPicker from "./DayTransportPicker";
import HotelBanner from "./HotelBanner";
import { SortableStopCard, StopCardShell, TravelConnector } from "./StopCard";
import type { LegFareOption, LegMode, SortableStopCardProps } from "./StopCard";
import { parseTransferNotes } from "./TransferChips";
import type { CommuteOptionView, TransferView } from "./TransferChips";
import DayCostChip from "./DayCostChip";
import DayWeatherChip from "./DayWeatherChip";
import OpenInMapsSub from "@/components/maps/OpenInMapsSub";
import WeatherAdvisory from "./WeatherAdvisory";
import { catalogForDestination } from "./SuggestedPlaces";
import {
  dayLabel,
  daySpanMinutes,
  formatKm,
  formatMinutes,
  haversineKm,
  routeKm,
  shortDate,
  travelModeForDayMode,
} from "./utils";
import type {
  DayTransportMode,
  TravelMode,
  TripData,
  WsDay,
  WsStop,
} from "./utils";
import { useToast } from "./Toasts";

const stopNum = (id: string) => Number(id.replace("stop-", ""));
const dayKeyOf = (id: string) =>
  id.startsWith("day-") || id.startsWith("pill-")
    ? id.slice(id.indexOf("-") + 1)
    : null;

interface DayGroup {
  key: string;
  day: WsDay | null;
  index: number;
  stops: WsStop[];
}

/* ── Day rail pill (droppable target for cross-day moves, §1.2) ── */

function DayPill({
  group,
  active,
  isDark,
  onClick,
}: {
  group: DayGroup;
  active: boolean;
  isDark: boolean;
  onClick: () => void;
}) {
  const { setNodeRef, isOver } = useDroppable({
    id: `pill-${group.key}`,
    disabled: group.day == null,
  });
  const color = dayColor(group.index + 1, isDark);
  return (
    <button
      ref={setNodeRef}
      type="button"
      onClick={e => {
        /* r24-core (F): keep the tapped pill visible inside the horizontally
           scrollable strip (matters on phones with many days) */
        e.currentTarget.scrollIntoView({
          behavior: "smooth",
          inline: "center",
          block: "nearest",
        });
        onClick();
      }}
      style={
        active
          ? { backgroundColor: color, borderColor: "transparent" }
          : isOver
            ? { backgroundColor: `${color}2e`, borderColor: color }
            : undefined
      }
      className={cn(
        "type-small flex shrink-0 snap-start items-center gap-1.5 rounded-pill border px-3 py-1.5 font-semibold transition-all duration-fast",
        active
          ? "text-white shadow-sm"
          : "border-border bg-surface text-ink-2 hover:border-border-strong hover:text-ink"
      )}
    >
      <span
        className="h-2 w-2 rounded-full"
        style={{ backgroundColor: active ? "#FFFFFF" : color }}
        aria-hidden
      />
      {dayLabel(group.index)} · {group.day ? shortDate(group.day.date) : ""}
      <span
        className={cn(
          "type-caption tnum",
          active ? "text-white/80" : "text-ink-3"
        )}
      >
        {group.stops.length}
      </span>
    </button>
  );
}

/* ── r12-routeui: intercity transfer leg card ──────────────────────────────
   Road-trip transport stops (notes = JSON { transfer: { fromCity, toCity,
   km, options[] } }) render as a distinct card instead of a plain stop:
   prominent mode icon + km/duration, honest "estimated" tag, and an
   expandable "Travel options" list with every commute alternative. Options
   are display-only - there is no per-leg switch-mode endpoint yet. */

const TRANSFER_KIND_ICON = { car: Car, train: TrainFront, bus: Bus } as const;

function fmtTransferMin(min: number): string {
  const h = Math.floor(min / 60);
  const m = Math.round(min % 60);
  return h ? `${h}h${m ? ` ${String(m).padStart(2, "0")}` : ""}` : `${m}m`;
}

function TransferOptionRow({ option }: { option: CommuteOptionView }) {
  const Icon = TRANSFER_KIND_ICON[option.kind] ?? Car;
  return (
    <li className="flex items-center gap-2.5 rounded-sm px-2 py-1.5">
      <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-surface-2 text-ink-2">
        <Icon className="h-3.5 w-3.5" strokeWidth={1.75} />
      </span>
      <span className="type-small min-w-0 flex-1 truncate font-semibold text-ink">
        {option.label}
        {option.transfers ? (
          <span className="font-normal text-ink-3">
            {" "}
            · {option.transfers} change{option.transfers === 1 ? "" : "s"}
          </span>
        ) : null}
      </span>
      <span className="type-small tnum shrink-0 text-ink">
        {fmtTransferMin(option.durationMin)}
      </span>
      <span className="type-caption tnum shrink-0 text-ink-3">
        {option.km} km
      </span>
      {option.estimated ? (
        <span className="type-caption shrink-0 rounded-pill bg-ochre-soft px-1.5 py-0.5 font-semibold text-ochre">
          est.
        </span>
      ) : null}
    </li>
  );
}

function TransferLegCard({
  stop,
  number,
  color,
  transfer,
  selected,
  flash,
  onSelect,
  onEdit,
  onDelete,
  onMove,
  stopIndex,
  stopCount,
  dragHandle,
}: {
  stop: WsStop;
  number: number;
  color: string;
  transfer: TransferView;
  selected?: boolean;
  flash?: boolean;
  onSelect?: () => void;
  onEdit?: () => void;
  onDelete?: () => void;
  /* r20-responsive: touch reorder buttons (drag handles are pointer-first) */
  onMove?: (dir: -1 | 1) => void;
  stopIndex?: number;
  stopCount?: number;
  dragHandle?: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const primary = transfer.options[0] ?? null;
  const PrimaryIcon = primary ? (TRANSFER_KIND_ICON[primary.kind] ?? Car) : Car;

  return (
    <div
      className={cn(
        "group relative rounded-md border bg-surface transition-colors duration-fast",
        selected
          ? "border-transparent bg-brand-soft/60 shadow-[inset_2px_0_0_var(--brand)]"
          : "border-border hover:border-border-strong",
        flash && "animate-pulse-ring"
      )}
    >
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
        className={cn("flex items-center gap-2.5 p-3", onSelect && "cursor-pointer")}
      >
        {/* drag handle */}
        <span className="flex w-4 shrink-0 items-center justify-center text-ink-3 opacity-60 transition-opacity duration-fast group-hover:opacity-100">
          {dragHandle ?? <GripVertical className="h-4 w-4" strokeWidth={1.75} />}
        </span>

        {/* number badge, matches the map pin exactly */}
        <span
          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full font-serif text-[13px] font-semibold leading-none text-white"
          style={{ backgroundColor: color }}
        >
          {number}
        </span>

        {/* mode badge */}
        <span className="hidden h-9 w-9 shrink-0 items-center justify-center rounded-full bg-brand-soft text-brand min-[400px]:flex">
          <PrimaryIcon className="h-4 w-4" strokeWidth={1.75} />
        </span>

        {/* content */}
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[14px] font-semibold text-ink">
            {transfer.fromCity} → {transfer.toCity}
          </span>
          <span className="mt-1 flex flex-wrap items-center gap-1.5">
            {primary ? (
              <span className="type-caption tnum inline-flex items-center gap-1 rounded-pill bg-brand-soft px-2 py-0.5 font-semibold text-brand">
                <PrimaryIcon className="h-3 w-3" strokeWidth={1.75} />
                {fmtTransferMin(primary.durationMin)}
              </span>
            ) : null}
            <span className="type-caption tnum inline-flex items-center gap-1 rounded-pill bg-surface-2 px-2 py-0.5 text-ink-2">
              <Route className="h-3 w-3" strokeWidth={1.75} />
              {transfer.km} km
            </span>
            {primary?.estimated ? (
              <span
                title="Rough estimate, no live schedule/route data for this leg"
                className="type-caption inline-flex items-center rounded-pill bg-ochre-soft px-2 py-0.5 font-semibold text-ochre"
              >
                estimated
              </span>
            ) : null}
            {transfer.routeTag ? (
              <span
                title={`This leg follows the ${transfer.routeTag}, a famous route`}
                className="type-caption inline-flex items-center gap-1 rounded-pill bg-brand-soft px-2 py-0.5 font-semibold text-brand"
              >
                <Sparkles className="h-3 w-3" strokeWidth={1.75} />
                {transfer.routeTag}
              </span>
            ) : null}
          </span>
        </span>

        {/* time col (edit) */}
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
          <span className="type-caption text-ink-3">depart</span>
        </button>

        {/* expand toggle */}
        {transfer.options.length > 0 ? (
          <button
            type="button"
            aria-expanded={open}
            aria-label={`Travel options for ${transfer.fromCity} to ${transfer.toCity}`}
            onClick={e => {
              e.stopPropagation();
              setOpen(o => !o);
            }}
            className="type-caption flex shrink-0 items-center gap-1 rounded-pill bg-surface-2 px-2.5 py-1 font-semibold text-ink-2 transition-colors duration-fast hover:bg-border hover:text-ink"
          >
            {transfer.options.length} option{transfer.options.length === 1 ? "" : "s"}
            <ChevronDown
              className={cn(
                "h-3.5 w-3.5 transition-transform duration-fast",
                open && "rotate-180"
              )}
              strokeWidth={2}
            />
          </button>
        ) : null}
      </div>

      {/* expandable alternatives (display-only, no per-leg switch endpoint yet) */}
      {open && transfer.options.length > 0 ? (
        <div className="border-t border-border px-3 py-2">
          <p className="type-eyebrow px-2 pb-1 pt-1 text-ink-3">Travel options</p>
          <ul className="divide-y divide-border/60">
            {transfer.options.map((o, i) => (
              <TransferOptionRow key={`${o.kind}-${i}`} option={o} />
            ))}
          </ul>
          <p className="type-caption px-2 pb-1 pt-1.5 text-ink-3">
            Times are estimates for planning, check schedules before you book.
          </p>
        </div>
      ) : null}

      {/* hover quick action: remove */}
      {onDelete ? (
        <span className="absolute right-2 top-2 hidden items-center gap-0.5 rounded-md border border-border bg-surface p-0.5 opacity-0 shadow-sm transition-opacity duration-fast group-hover:opacity-100 group-hover:flex">
          <button
            type="button"
            aria-label="Remove transfer stop"
            title="Remove transfer stop"
            onClick={e => {
              e.stopPropagation();
              onDelete();
            }}
            className="flex h-6 w-6 items-center justify-center rounded-sm text-ink-3 transition-colors duration-fast hover:bg-danger/10 hover:text-danger"
          >
            <Trash2 className="h-3.5 w-3.5" strokeWidth={1.75} />
          </button>
        </span>
      ) : null}

      {/* r20-responsive: touch action row - hover actions never fire on
          phones, so move up/down + remove get 40px targets here. */}
      {onMove || onDelete ? (
        <div className="flex items-center justify-end gap-1 border-t border-border/60 px-3 py-1.5 lg:hidden">
          {onMove ? (
            <>
              <button
                type="button"
                aria-label={`Move ${transfer.fromCity} to ${transfer.toCity} up`}
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
                aria-label={`Move ${transfer.fromCity} to ${transfer.toCity} down`}
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
          {onDelete ? (
            <button
              type="button"
              aria-label="Remove transfer stop"
              title="Remove transfer stop"
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

/** Sortable wrapper - mirrors SortableStopCard so DnD keeps working. */
function SortableTransferLegCard(props: SortableStopCardProps) {
  const { stop, connector } = props;
  const transfer = parseTransferNotes(stop.notes);
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
        props.registerRef?.(stop.id, el);
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
        <TransferLegCard
          stop={stop}
          number={props.number}
          color={props.color}
          transfer={transfer!}
          selected={props.selected}
          flash={props.flash}
          onSelect={props.onSelect}
          onEdit={props.onEdit}
          onDelete={props.onDelete}
          onMove={props.onMove}
          stopIndex={props.stopIndex}
          stopCount={props.stopCount}
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

/* ── One day section in the timeline (§1.3) ── */

interface DaySectionProps {
  group: DayGroup;
  tripId: number;
  isDark: boolean;
  isVoyager: boolean;
  selectedStopId: number | null;
  flashStopId: number | null;
  modes: Record<string, TravelMode>;
  days: WsDay[];
  generating: boolean;
  optimizing: boolean;
  onSelectStop: (id: number) => void;
  onEditStop: (stop: WsStop) => void;
  onDeleteStop: (stop: WsStop) => void;
  onDuplicateStop: (stop: WsStop, dayId: number | null) => void;
  onMoveStop: (stopId: number, dir: -1 | 1) => void;
  onCycleMode: (pairKey: string) => void;
  onAddStop: (dayId: number | null) => void;
  onOptimizeDay: (dayId: number) => void;
  onFillDay: (dayId: number, anchor: HTMLElement) => void;
  onClearDay: (group: DayGroup) => void;
  registerStopRef: (id: number, el: HTMLDivElement | null) => void;
  /* r24-core (F): section element ref so day pills can scroll to the day */
  registerDayRef?: (el: HTMLElement | null) => void;
  /* r24-core (H): leg fare picker plumbing */
  currency: string;
  country: string | null;
  onPickLeg: (stop: WsStop, mode: LegMode, cents: number | null) => void;
}

function DaySection({
  group,
  tripId,
  isDark,
  isVoyager,
  selectedStopId,
  flashStopId,
  modes,
  days,
  generating,
  optimizing,
  onSelectStop,
  onEditStop,
  onDeleteStop,
  onDuplicateStop,
  onMoveStop,
  onCycleMode,
  onAddStop,
  onOptimizeDay,
  onFillDay,
  onClearDay,
  registerStopRef,
  registerDayRef,
  currency,
  country,
  onPickLeg,
}: DaySectionProps) {
  const { setNodeRef, isOver } = useDroppable({ id: `day-${group.key}` });
  const color = dayColor(group.index + 1, isDark);
  const dayTravelMode = travelModeForDayMode(group.day?.transportMode);
  const km = routeKm(group.stops);
  const span = daySpanMinutes(group.stops, dayTravelMode);

  return (
    <section aria-label={dayLabel(group.index)} ref={registerDayRef} className="scroll-mt-2">
      {/* header row - sticky so the day context stays visible while scrolling
          long stop lists (esp. on phones where the panel is full-width) */}
      <div className="sticky top-0 z-10 -mx-1 flex items-center gap-2.5 bg-bg px-1 py-2">
        <span
          className="h-6 w-2 shrink-0 rounded-full"
          style={{ backgroundColor: color }}
          aria-hidden
        />
        <h4 className="type-h4 min-w-0 flex-1 truncate text-ink">
          {group.day ? dayLabel(group.index) : "Unscheduled"}
          <span className="ml-2 type-small font-normal text-ink-3">
            {group.day ? shortDate(group.day.date) : "No day assigned"}
          </span>
        </h4>
        <span className="type-caption hidden shrink-0 text-ink-3 min-[420px]:block">
          {group.stops.length} stops{km > 0 ? ` · ${formatKm(km)}` : ""}
          {group.stops.length > 0 ? ` · ${formatMinutes(span)}` : ""}
        </span>
        {group.day ? (
          <>
            <DayTransportPicker
              tripId={tripId}
              dayId={group.day.id}
              mode={(group.day.transportMode as DayTransportMode) ?? "car"}
            />
            <DayCostChip
              tripId={group.day.tripId}
              stops={group.stops}
              currency={currency}
            />
            <DayWeatherChip tripId={group.day.tripId} dayId={group.day.id} />
          </>
        ) : null}
        {group.day && group.stops.length >= 2 ? (
          <button
            type="button"
            onClick={() => onOptimizeDay(group.day!.id)}
            disabled={optimizing}
            title={
              isVoyager
                ? "Optimize this day, shortest path"
                : "Optimize this day (Voyager)"
            }
            aria-label={`Optimize ${dayLabel(group.index)}`}
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-ink-3 transition-colors duration-fast hover:bg-pine-soft hover:text-pine disabled:opacity-60"
          >
            {optimizing ? (
              <Loader2 className="h-4 w-4 animate-spin" strokeWidth={1.75} />
            ) : (
              <Wand2 className="h-4 w-4" strokeWidth={1.75} />
            )}
          </button>
        ) : null}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              aria-label={`${dayLabel(group.index)} options`}
              className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-ink-3 transition-colors duration-fast hover:bg-surface-2 hover:text-ink"
            >
              <MoreHorizontal className="h-4 w-4" strokeWidth={1.75} />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-52 rounded-lg">
            {group.day ? (
              <>
                <DropdownMenuItem
                  onClick={() => onOptimizeDay(group.day!.id)}
                  className="gap-2"
                >
                  <Route className="h-4 w-4" strokeWidth={1.75} />
                  Optimize this day
                  {!isVoyager ? (
                    <Crown
                      className="ml-auto h-3.5 w-3.5 text-ochre"
                      strokeWidth={1.75}
                    />
                  ) : null}
                </DropdownMenuItem>
                {/* r24-smart I: free deep links + premium in-app embed */}
                <OpenInMapsSub
                  points={group.stops.map(s => ({ name: s.name, lat: s.lat, lng: s.lng }))}
                  isPremium={isVoyager}
                  label="Open day in maps"
                />
              </>
            ) : null}
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onClick={() => onClearDay(group)}
              disabled={group.stops.length === 0}
              className="gap-2 text-danger focus:text-danger"
            >
              <Trash2 className="h-4 w-4" strokeWidth={1.75} />
              Clear {group.day ? "day" : "list"}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {/* stops */}
      <SortableContext
        items={group.stops.map(s => `stop-${s.id}`)}
        strategy={verticalListSortingStrategy}
      >
        <div
          ref={setNodeRef}
          className={cn("mt-2 rounded-md", isOver && "bg-surface-2/60")}
        >
          {group.stops.map((stop, i) => {
            const prev = i > 0 ? group.stops[i - 1] : null;
            const pairKey = prev ? `${prev.id}-${stop.id}` : null;
            /* r24-core (H): approx per-leg fares for the connector picker */
            const legKm =
              prev &&
              prev.lat != null &&
              prev.lng != null &&
              stop.lat != null &&
              stop.lng != null
                ? haversineKm(prev.lat, prev.lng, stop.lat, stop.lng)
                : null;
            const legEstimates = legKm != null ? estimateLeg(legKm, country) : null;
            const legSelected = (stop.transportMode as LegMode | null) ?? null;
            const legOptions: LegFareOption[] | undefined =
              legEstimates?.map(e => ({
                mode: e.mode,
                fareText:
                  legSelected === e.mode && stop.transportCents != null
                    ? `≈${formatMoneyCompact(stop.transportCents, currency)}`
                    : e.available
                      ? `≈${formatMoneyCompact(convertCents(e.centsLow, "USD", currency), currency)}-${formatMoneyCompact(convertCents(e.centsHigh, "USD", currency), currency)}`
                      : "",
                available: e.available,
                note: e.note,
              })) ?? undefined;
            const cardProps: SortableStopCardProps = {
              stop,
              number: i + 1,
              color,
              selected: selectedStopId === stop.id,
              flash: flashStopId === stop.id,
              connector:
                prev && pairKey
                  ? {
                      from: prev,
                      mode: modes[pairKey] ?? dayTravelMode,
                      onCycle: () => onCycleMode(pairKey),
                      legOptions:
                        legOptions && legOptions.length > 0
                          ? legOptions
                          : undefined,
                      legSelected,
                      onPickLeg:
                        legEstimates != null
                          ? (m: LegMode) => {
                              const e = legEstimates.find(x => x.mode === m);
                              onPickLeg(
                                stop,
                                m,
                                e ? convertCents(estimateMidCents(e), "USD", currency) : null
                              );
                            }
                          : undefined,
                    }
                  : null,
              onSelect: () => onSelectStop(stop.id),
              onEdit: () => onEditStop(stop),
              onDelete: () => onDeleteStop(stop),
              days,
              onDuplicate: dayId => onDuplicateStop(stop, dayId),
              onMove: dir => onMoveStop(stop.id, dir),
              stopIndex: i,
              stopCount: group.stops.length,
              registerRef: registerStopRef,
            };
            /* r12-routeui: intercity transfer legs get the rich card with
               expandable travel options; everything else keeps StopCard. */
            const transfer =
              stop.category === "transport"
                ? parseTransferNotes(stop.notes)
                : null;
            return transfer ? (
              <SortableTransferLegCard key={stop.id} {...cardProps} />
            ) : (
              <SortableStopCard key={stop.id} {...cardProps} />
            );
          })}
          {group.stops.length === 0 ? (
            generating ? (
              /* AI day-fill shimmer (§7: calm pulse while the day is planned) */
              <div
                className="space-y-2.5 rounded-md border border-border p-3"
                aria-label="Planning this day with AI"
              >
                {[0, 1, 2].map(i => (
                  <div key={i} className="flex items-center gap-2.5">
                    <span
                      className="h-9 w-9 shrink-0 animate-pulse rounded-md bg-surface-2"
                      style={{ animationDelay: `${i * 140}ms` }}
                    />
                    <span
                      className="h-3 flex-1 animate-pulse rounded bg-surface-2"
                      style={{ animationDelay: `${i * 140}ms` }}
                    />
                  </div>
                ))}
                <p className="type-caption flex items-center gap-1.5 pt-1 text-ink-3">
                  <Loader2 className="h-3 w-3 animate-spin" strokeWidth={2} />
                  Planning this day with AI…
                </p>
              </div>
            ) : (
              <div className="rounded-md border border-dashed border-border">
                <div className="flex h-14 items-center justify-center text-ink-3">
                  <span className="type-caption">
                    Drag stops here, or fill it your way:
                  </span>
                </div>
                {group.day ? (
                  /* manual browse and AI fill - equal footing (§manual-first) */
                  <div className="mx-2 mb-2 flex gap-2">
                    <button
                      type="button"
                      onClick={() => onAddStop(group.day!.id)}
                      className="btn-sheen type-small flex h-9 flex-1 items-center justify-center gap-1.5 rounded-md bg-brand font-semibold text-brand-ink shadow-sm transition-all duration-fast hover:-translate-y-px hover:bg-brand-strong hover:shadow-md active:scale-[0.98]"
                    >
                      <Plus className="h-4 w-4" strokeWidth={2} />
                      Browse places
                    </button>
                    <button
                      type="button"
                      onClick={e => onFillDay(group.day!.id, e.currentTarget)}
                      className="type-small flex h-9 flex-1 items-center justify-center gap-1.5 rounded-md border border-border-strong font-semibold text-ink-2 transition-all duration-fast hover:-translate-y-px hover:border-brand hover:text-brand active:scale-[0.98]"
                    >
                      <Sparkles className="h-4 w-4" strokeWidth={1.75} />
                      Fill with AI
                      {!isVoyager ? (
                        <Crown
                          className="h-3.5 w-3.5 text-ochre"
                          strokeWidth={1.75}
                        />
                      ) : null}
                    </button>
                  </div>
                ) : null}
              </div>
            )
          ) : null}
        </div>
      </SortableContext>

      {/* add-stop row */}
      <button
        type="button"
        onClick={() => onAddStop(group.day?.id ?? null)}
        className="type-small mt-2 flex h-10 w-full items-center justify-center gap-1.5 rounded-md border border-dashed border-border-strong font-semibold text-ink-3 transition-all duration-fast hover:border-brand hover:text-brand"
      >
        <Plus className="h-4 w-4" strokeWidth={1.75} /> Add a place
      </button>
    </section>
  );
}

/* ── Itinerary tab - split-screen planner (§1) ── */

export default function ItineraryTab({
  data,
  tripId,
}: {
  data: TripData;
  tripId: number;
}) {
  const utils = trpc.useUtils();
  const { push } = useToast();
  const { isDark } = useTheme();
  const catalog = useMemo(
    () => catalogForDestination(data.trip.destination),
    [data.trip.destination]
  );
  const isVoyager = data.tier === "voyager";

  const orderedDays = useMemo(
    () => [...data.days].sort((a, b) => a.position - b.position),
    [data.days]
  );
  const stopById = useMemo(
    () => new Map(data.stops.map(s => [s.id, s])),
    [data.stops]
  );

  const [activeDayId, setActiveDayId] = useState<number | null>(
    orderedDays[0]?.id ?? null
  );
  const [selectedStopId, setSelectedStopId] = useState<number | null>(null);
  const [flashStopId, setFlashStopId] = useState<number | null>(null);
  const [renumberSeed, setRenumberSeed] = useState(0);
  const [board, setBoard] = useState<Record<string, number[]> | null>(null);
  const [dragStopId, setDragStopId] = useState<number | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [addDayId, setAddDayId] = useState<number | null>(null);
  const [editStop, setEditStop] = useState<WsStop | null>(null);
  const [modes, setModes] = useState<Record<string, TravelMode>>({});
  const [mobileView, setMobileView] = useState<"itinerary" | "map">(
    "itinerary"
  );
  const [panelW, setPanelW] = useState<number | null>(null);
  const [optimizing, setOptimizing] = useState(false);
  const [optimizingDayId, setOptimizingDayId] = useState<number | null>(null);
  const [generatingDay, setGeneratingDay] = useState<number | "new" | null>(
    null
  );
  const [upsellOpen, setUpsellOpen] = useState(false);
  const [aiUpsellOpen, setAiUpsellOpen] = useState(false);
  /* AI day-fill popover: which day to fill + where to anchor the options */
  const [dayFill, setDayFill] = useState<{
    dayId: number | null;
    rect: DOMRect;
  } | null>(null);
  const [mapInstance, setMapInstance] = useState<maplibregl.Map | null>(null);
  const [pinDrop, setPinDrop] = useState<{ lat: number; lng: number } | null>(
    null
  );
  const stopRefs = useRef(new Map<number, HTMLDivElement>());
  const dayRefs = useRef(new Map<string, HTMLElement>());
  const dayListRef = useRef<HTMLDivElement | null>(null);
  const preDragBoard = useRef<Record<string, number[]> | null>(null);

  /* keep the active day valid as data changes (render-phase adjust, react.dev) */
  const [prevDays, setPrevDays] = useState(orderedDays);
  if (prevDays !== orderedDays) {
    setPrevDays(orderedDays);
    if (orderedDays.length === 0) {
      if (activeDayId !== null) setActiveDayId(null);
    } else if (activeDayId == null || !orderedDays.some(d => d.id === activeDayId)) {
      setActiveDayId(orderedDays[0].id);
    }
  }

  /* ── grouped stops (live during drag via `board`) ── */
  const groups = useMemo<DayGroup[]>(() => {
    const base: DayGroup[] = orderedDays.map((d, i) => ({
      key: String(d.id),
      day: d,
      index: i,
      stops: [],
    }));
    const unscheduled: DayGroup = {
      key: "none",
      day: null,
      index: orderedDays.length,
      stops: [],
    };
    if (board) {
      const lookup = new Map(base.map(g => [g.key, g] as const));
      lookup.set("none", unscheduled);
      for (const [key, ids] of Object.entries(board)) {
        const g = lookup.get(key);
        if (!g) continue;
        g.stops = ids
          .map((id, i) => {
            const s = stopById.get(id);
            return s ? { ...s, dayId: g.day?.id ?? null, position: i } : null;
          })
          .filter((s): s is WsStop => s != null);
      }
    } else {
      const byKey = new Map(base.map(g => [g.key, g] as const));
      for (const s of data.stops) {
        const g = s.dayId != null ? byKey.get(String(s.dayId)) : undefined;
        (g ?? unscheduled).stops.push(s);
      }
      for (const g of [...base, unscheduled])
        g.stops.sort((a, b) => a.position - b.position);
    }
    return unscheduled.stops.length > 0 ? [...base, unscheduled] : base;
  }, [orderedDays, data.stops, board, stopById]);

  const workingStops = useMemo(() => groups.flatMap(g => g.stops), [groups]);
  const activeGroup = useMemo(
    () => groups.find(g => g.day?.id === activeDayId) ?? null,
    [groups, activeDayId]
  );
  const allEmpty = useMemo(
    () => groups.every(g => g.stops.length === 0),
    [groups]
  );
  const addTargetGroup = useMemo(
    () =>
      groups.find(g =>
        addDayId == null ? g.key === "none" : g.day?.id === addDayId
      ) ??
      activeGroup ??
      groups[0] ??
      null,
    [groups, addDayId, activeGroup]
  );

  const centroid = useMemo<[number, number] | null>(() => {
    const pts = (activeGroup?.stops ?? []).filter(
      s => s.lat != null && s.lng != null
    );
    if (!pts.length)
      return catalog.center ? [catalog.center[1], catalog.center[0]] : null;
    const lat = pts.reduce((a, s) => a + s.lat!, 0) / pts.length;
    const lng = pts.reduce((a, s) => a + s.lng!, 0) / pts.length;
    return [lat, lng];
  }, [activeGroup, catalog]);

  /* ── mutations ── */
  const invalidate = useCallback(
    () => utils.trips.get.invalidate({ id: tripId }),
    [utils, tripId]
  );

  const reorder = trpc.trips.reorderStops.useMutation({
    onSettled: invalidate,
    onError: e =>
      push({ title: "Reorder failed", description: e.message, kind: "danger" }),
  });

  /* r24-core (H): persist the chosen leg mode + approx fare on the stop the
     leg LEADS to (stored in trip home currency). */
  const updateStopLeg = trpc.trips.updateStop.useMutation({
    onSettled: invalidate,
    onError: e =>
      push({ title: "Could not save leg", description: e.message, kind: "danger" }),
  });
  const legCountry = useMemo(
    () => countryFromDestination(data.trip.destination),
    [data.trip.destination]
  );
  const homeCurrency = data.trip.homeCurrency || "USD";

  /* r24-core (L): trip intent feeds AI day-fill styles (culture→historical,
     relaxation→relaxing to match the taste-profile vocabulary). */
  const tripIntentStyles = useMemo(() => {
    try {
      const arr = data.trip.intent
        ? (JSON.parse(data.trip.intent) as string[])
        : [];
      return arr
        .filter(k => k !== "mix")
        .map(k =>
          k === "culture" ? "historical" : k === "relaxation" ? "relaxing" : k
        );
    } catch {
      return [];
    }
  }, [data.trip.intent]);

  /* r24-core (A): an amount-based budget steers AI suggestions - map the
     per-day budget to the generator's band so cheaper places rank first. */
  const tripBudgetBand = useMemo(() => {
    const cents = data.trip.budgetCents ?? 0;
    if (cents <= 0) return undefined;
    const nDays =
      Math.max(
        1,
        Math.round(
          (Date.parse(data.trip.endDate) - Date.parse(data.trip.startDate)) /
            86_400_000
        )
      ) + 1;
    const perDayUsd = convertCents(
      Math.round(cents / nDays),
      data.trip.budgetCurrency || homeCurrency,
      "USD"
    ) / 100;
    return perDayUsd < 75
      ? ("shoestring" as const)
      : perDayUsd < 200
        ? ("mid" as const)
        : perDayUsd < 450
          ? ("comfort" as const)
          : ("luxury" as const);
  }, [data.trip.budgetCents, data.trip.budgetCurrency, data.trip.startDate, data.trip.endDate, homeCurrency]);
  const pickLeg = useCallback(
    (stop: WsStop, mode: LegMode, cents: number | null) => {
      updateStopLeg.mutate({
        id: stop.id,
        tripId,
        transportMode: mode,
        transportCents: cents,
      });
    },
    [updateStopLeg, tripId]
  );

  const applyBoardToCache = useCallback(
    (b: Record<string, number[]>) => {
      utils.trips.get.setData({ id: tripId }, old => {
        if (!old) return old;
        const next = old.stops.map(s => ({ ...s }));
        for (const [key, ids] of Object.entries(b)) {
          const dayId = key === "none" ? null : Number(key);
          ids.forEach((id, position) => {
            const s = next.find(x => x.id === id);
            if (s) {
              s.dayId = dayId;
              s.position = position;
            }
          });
        }
        next.sort((a, b) => a.position - b.position);
        return { ...old, stops: next };
      });
    },
    [utils, tripId]
  );

  const movesFromBoard = useCallback(
    (
      b: Record<string, number[]>,
      onlyChangedAgainst?: Record<string, number[]>
    ) => {
      const prev = new Map<
        number,
        { dayId: number | null; position: number }
      >();
      if (onlyChangedAgainst) {
        for (const [key, ids] of Object.entries(onlyChangedAgainst)) {
          const dayId = key === "none" ? null : Number(key);
          ids.forEach((id, position) => prev.set(id, { dayId, position }));
        }
      }
      const moves: { id: number; dayId: number | null; position: number }[] =
        [];
      for (const [key, ids] of Object.entries(b)) {
        const dayId = key === "none" ? null : Number(key);
        ids.forEach((id, position) => {
          const p = prev.get(id);
          if (
            !onlyChangedAgainst ||
            !p ||
            p.dayId !== dayId ||
            p.position !== position
          ) {
            moves.push({ id, dayId, position });
          }
        });
      }
      return moves;
    },
    []
  );

  const commitBoard = useCallback(
    (
      finalBoard: Record<string, number[]>,
      prevBoard: Record<string, number[]>,
      movedName?: string
    ) => {
      const moves = movesFromBoard(finalBoard, prevBoard);
      if (!moves.length) return;
      applyBoardToCache(finalBoard);
      reorder.mutate({ tripId, moves });
      setRenumberSeed(s => s + 1);
      push({
        title: movedName ? `Moved ${movedName}` : "Itinerary updated",
        kind: "success",
        actionLabel: "Undo",
        onAction: () => {
          applyBoardToCache(prevBoard);
          reorder.mutate({ tripId, moves: movesFromBoard(prevBoard) });
          setRenumberSeed(s => s + 1);
        },
      });
    },
    [applyBoardToCache, movesFromBoard, reorder, tripId, push]
  );

  /* r20-responsive: tap-to-move reorder for touch devices. Mirrors a drag
     swap within the stop's day group, then commits through the same board
     machinery (optimistic cache + reorder mutation + undo toast). */
  const moveStop = useCallback(
    (stopId: number, dir: -1 | 1) => {
      const prevBoard: Record<string, number[]> = board
        ? Object.fromEntries(
            Object.entries(board).map(([k, v]) => [k, [...v]])
          )
        : Object.fromEntries(groups.map(g => [g.key, g.stops.map(s => s.id)]));
      const nextBoard: Record<string, number[]> = Object.fromEntries(
        Object.entries(prevBoard).map(([k, v]) => [k, [...v]])
      );
      for (const ids of Object.values(nextBoard)) {
        const i = ids.indexOf(stopId);
        if (i === -1) continue;
        const j = i + dir;
        if (j < 0 || j >= ids.length) return;
        const tmp = ids[i]!;
        ids[i] = ids[j]!;
        ids[j] = tmp;
        commitBoard(nextBoard, prevBoard, stopById.get(stopId)?.name);
        return;
      }
    },
    [board, groups, commitBoard, stopById]
  );

  const deleteStop = trpc.trips.deleteStop.useMutation({
    onSettled: invalidate,
    onError: e =>
      push({
        title: "Could not remove stop",
        description: e.message,
        kind: "danger",
      }),
  });
  const addStop = trpc.trips.addStop.useMutation({
    onSuccess: invalidate,
    onError: e =>
      push({
        title: "Could not add stop",
        description: e.message,
        kind: "danger",
      }),
  });
  const optimize = trpc.trips.optimizeRoute.useMutation();
  const optimizeDay = trpc.trips.optimizeDay.useMutation();
  const generateDay = trpc.trips.generateDay.useMutation();

  /* ── AI day-fill (§B): fill one empty day, or append a fresh AI day ── */
  const runGenerateDay = useCallback(
    async (dayId: number | null, opts?: DayFillChoice) => {
      if (!isVoyager) {
        setAiUpsellOpen(true);
        return;
      }
      setGeneratingDay(dayId ?? "new");
      try {
        const res = await generateDay.mutateAsync(
          dayId != null
            ? {
                tripId,
                dayId,
                styles: tripIntentStyles.length ? tripIntentStyles : undefined,
                budgetBand: tripBudgetBand,
                ...opts,
              }
            : {
                tripId,
                styles: tripIntentStyles.length ? tripIntentStyles : undefined,
                budgetBand: tripBudgetBand,
                ...opts,
              }
        );
        await invalidate();
        setActiveDayId(res.dayId);
        setRenumberSeed(s => s + 1);
        push({
          title: `AI planned ${res.stopsCreated} stops`,
          description: `${shortDate(res.date)}, drag anything to make it yours.`,
          kind: "success",
        });
      } catch (e) {
        const msg = (e as { message?: string })?.message ?? "";
        if (msg.includes("UPGRADE_REQUIRED")) {
          setAiUpsellOpen(true);
        } else if (msg.includes("NO_NEW_PLACES")) {
          push({
            title: "No new places left",
            description: "Every spot we know here is already in your trip.",
            kind: "info",
          });
        } else if (msg.includes("DESTINATION_UNKNOWN")) {
          push({
            title: "No AI coverage for this destination",
            description: "AI day-fill works for cities in Explore.",
            kind: "info",
          });
        } else {
          push({
            title: "Could not generate the day",
            description: msg,
            kind: "danger",
          });
        }
      } finally {
        setGeneratingDay(null);
      }
    },
    [isVoyager, generateDay, tripId, invalidate, push, tripIntentStyles, tripBudgetBand]
  );

  /* Every AI day-fill entry point opens the options popover first (Voyager
     gate mirrors runGenerateDay's, so the upsell shows instead). */
  const openDayFill = useCallback(
    (dayId: number | null, anchor: HTMLElement) => {
      if (!isVoyager) {
        setAiUpsellOpen(true);
        return;
      }
      setDayFill({ dayId, rect: anchor.getBoundingClientRect() });
    },
    [isVoyager]
  );

  /* ── per-day optimize (§E): wand on each day header ── */
  const runOptimizeDay = useCallback(
    async (dayId: number) => {
      if (!isVoyager) {
        setAiUpsellOpen(true);
        return;
      }
      setOptimizingDayId(dayId);
      try {
        await optimizeDay.mutateAsync({ tripId, dayId });
        await invalidate();
        setRenumberSeed(s => s + 1);
        push({ title: "Day reordered for the shortest path", kind: "success" });
      } catch (e) {
        const msg = (e as { message?: string })?.message ?? "";
        if (msg.includes("UPGRADE_REQUIRED")) {
          setAiUpsellOpen(true);
        } else {
          push({
            title: "Could not optimize",
            description: msg,
            kind: "danger",
          });
        }
      } finally {
        setOptimizingDayId(null);
      }
    },
    [isVoyager, optimizeDay, tripId, invalidate, push]
  );

  const handleDeleteStop = useCallback(
    (stop: WsStop) => {
      utils.trips.get.setData({ id: tripId }, old =>
        old ? { ...old, stops: old.stops.filter(s => s.id !== stop.id) } : old
      );
      deleteStop.mutate({ id: stop.id, tripId });
      push({
        title: `Removed ${stop.name}`,
        kind: "info",
        actionLabel: "Undo",
        onAction: () =>
          addStop.mutate({
            tripId,
            dayId: stop.dayId ?? null,
            name: stop.name,
            category: stop.category,
            address: stop.address ?? undefined,
            lat: stop.lat ?? undefined,
            lng: stop.lng ?? undefined,
            startTime: stop.startTime ?? null,
            durationMin: stop.durationMin ?? null,
            notes: stop.notes ?? undefined,
            image: stop.image ?? undefined,
          }),
      });
    },
    [utils, tripId, deleteStop, addStop, push]
  );

  const handleDuplicateStop = useCallback(
    (stop: WsStop, dayId: number | null) => {
      addStop.mutate(
        {
          tripId,
          dayId,
          name: stop.name,
          category: stop.category,
          address: stop.address ?? undefined,
          lat: stop.lat ?? undefined,
          lng: stop.lng ?? undefined,
          startTime: stop.startTime ?? null,
          durationMin: stop.durationMin ?? null,
          notes: stop.notes ?? undefined,
          image: stop.image ?? undefined,
        },
        {
          onSuccess: () =>
            push({ title: `Duplicated ${stop.name}`, kind: "success" }),
        }
      );
    },
    [addStop, tripId, push]
  );

  const handleClearDay = useCallback(
    (group: DayGroup) => {
      if (!group.stops.length) return;
      group.stops.forEach(s => deleteStop.mutate({ id: s.id, tripId }));
      push({
        title: `Cleared ${group.day ? dayLabel(group.index) : "unscheduled stops"}`,
        kind: "info",
      });
    },
    [deleteStop, tripId, push]
  );

  /* ── optimize (§1.7) ── */
  const runOptimize = useCallback(
    async (dayId: number | null) => {
      if (!isVoyager) {
        setUpsellOpen(true);
        return;
      }
      if (dayId == null) {
        push({
          title: "Pick a day first",
          description: "Route optimization works per day.",
          kind: "info",
        });
        return;
      }
      const group = groups.find(g => g.day?.id === dayId);
      const geo = (group?.stops ?? []).filter(
        s => s.lat != null && s.lng != null
      );
      if (geo.length < 3) {
        push({
          title: "Need at least 3 pinned stops",
          description: "Add places with locations to optimize.",
          kind: "info",
        });
        return;
      }
      const prevBoard: Record<string, number[]> = {};
      for (const g of groups) prevBoard[g.key] = g.stops.map(s => s.id);
      setOptimizing(true);
      const started = Date.now();
      try {
        const res = await optimize.mutateAsync({ tripId, dayId });
        const wait = Math.max(0, 900 - (Date.now() - started));
        if (wait) await new Promise(r => window.setTimeout(r, wait));
        await invalidate();
        setOptimizing(false);
        setRenumberSeed(s => s + 1);
        if (res.changed) {
          push({
            title: "Route optimized",
            description: `${res.savedKm} km shorter`,
            kind: "success",
            actionLabel: "Undo",
            onAction: () => {
              applyBoardToCache(prevBoard);
              reorder.mutate({ tripId, moves: movesFromBoard(prevBoard) });
              setRenumberSeed(s => s + 1);
            },
          });
        } else {
          push({ title: "Already the fastest order", kind: "info" });
        }
      } catch (e) {
        setOptimizing(false);
        if (
          String((e as { message?: string })?.message ?? "").includes(
            "UPGRADE_REQUIRED"
          )
        ) {
          setUpsellOpen(true);
        } else {
          push({
            title: "Could not optimize",
            description: (e as { message?: string })?.message,
            kind: "danger",
          });
        }
      }
    },
    [
      isVoyager,
      groups,
      optimize,
      tripId,
      invalidate,
      push,
      applyBoardToCache,
      movesFromBoard,
      reorder,
    ]
  );

  /* ── selection sync (§1.3: card ↔ pin) ── */
  const selectStop = useCallback(
    (id: number | null) => setSelectedStopId(id),
    []
  );

  /* r24-core (F): tapping a day pill selects the day AND scrolls its stops
     into view inside the timeline panel ("All" scrolls back to the top). */
  const selectDay = useCallback((dayId: number | null, key: string | null) => {
    setActiveDayId(dayId);
    window.setTimeout(() => {
      if (key == null) {
        dayListRef.current?.scrollTo({ top: 0, behavior: "smooth" });
        return;
      }
      dayRefs.current
        .get(key)
        ?.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 40);
  }, []);

  const openInTimeline = useCallback((id: number) => {
    setSelectedStopId(id);
    setMobileView("itinerary");
    window.setTimeout(() => {
      const el = stopRefs.current.get(id);
      el?.scrollIntoView({ behavior: "smooth", block: "center" });
      setFlashStopId(id);
      window.setTimeout(
        () => setFlashStopId(cur => (cur === id ? null : cur)),
        1500
      );
    }, 60);
  }, []);

  /* ── add place ── */
  const openAdd = useCallback(
    (dayId: number | null) => {
      setAddDayId(dayId ?? activeDayId ?? orderedDays[0]?.id ?? null);
      setAddOpen(true);
    },
    [activeDayId, orderedDays]
  );

  /* keyboard: n = new stop (§cross-cutting) */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.tagName === "SELECT")
      )
        return;
      if (e.key === "n" && !addOpen) {
        e.preventDefault();
        openAdd(null);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [addOpen, openAdd]);

  /* ── dnd ── */
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } })
  );

  const findContainerKey = useCallback(
    (b: Record<string, number[]>, stopId: number) =>
      Object.keys(b).find(k => b[k].includes(stopId)) ?? null,
    []
  );

  const onDragStart = useCallback(
    ({ active }: DragStartEvent) => {
      const id = stopNum(String(active.id));
      setDragStopId(id);
      const snapshot: Record<string, number[]> = {};
      for (const g of groups) snapshot[g.key] = g.stops.map(s => s.id);
      preDragBoard.current = snapshot;
      setBoard(snapshot);
    },
    [groups]
  );

  const onDragOver = useCallback(
    ({ active, over }: DragOverEvent) => {
      if (!over) return;
      const activeId = stopNum(String(active.id));
      const overIdStr = String(over.id);
      setBoard(prev => {
        if (!prev) return prev;
        const fromKey = findContainerKey(prev, activeId);
        const toKey = overIdStr.startsWith("stop-")
          ? findContainerKey(prev, stopNum(overIdStr))
          : dayKeyOf(overIdStr);
        if (!fromKey || !toKey || fromKey === toKey || !prev[toKey])
          return prev;
        const fromItems = prev[fromKey].filter(id => id !== activeId);
        const toItems = [...prev[toKey]];
        let insertAt = toItems.length;
        if (overIdStr.startsWith("stop-")) {
          const overIdx = toItems.indexOf(stopNum(overIdStr));
          const translated = active.rect.current.translated;
          const below =
            translated && translated.top > over.rect.top + over.rect.height / 2;
          insertAt = overIdx + (below ? 1 : 0);
        }
        toItems.splice(
          Math.max(0, Math.min(insertAt, toItems.length)),
          0,
          activeId
        );
        return { ...prev, [fromKey]: fromItems, [toKey]: toItems };
      });
    },
    [findContainerKey]
  );

  const onDragEnd = useCallback(
    ({ active, over }: DragEndEvent) => {
      const activeId = stopNum(String(active.id));
      const finalBoard = (() => {
        if (!board || !over) return board;
        const overIdStr = String(over.id);
        const key = overIdStr.startsWith("stop-")
          ? findContainerKey(board, stopNum(overIdStr))
          : dayKeyOf(overIdStr);
        if (!key || !board[key] || !board[key].includes(activeId)) return board;
        const items = board[key];
        const oldIdx = items.indexOf(activeId);
        const newIdx = overIdStr.startsWith("stop-")
          ? items.indexOf(stopNum(overIdStr))
          : items.length - 1;
        if (oldIdx === newIdx || newIdx < 0) return board;
        return { ...board, [key]: arrayMove(items, oldIdx, newIdx) };
      })();
      const prev = preDragBoard.current;
      setBoard(null);
      setDragStopId(null);
      preDragBoard.current = null;
      if (finalBoard && prev) {
        commitBoard(finalBoard, prev, stopById.get(activeId)?.name);
      }
    },
    [board, commitBoard, findContainerKey, stopById]
  );

  const onDragCancel = useCallback(() => {
    setBoard(null);
    setDragStopId(null);
    preDragBoard.current = null;
  }, []);

  const dragStop =
    dragStopId != null ? (stopById.get(dragStopId) ?? null) : null;
  const dragStopGroupKey =
    dragStopId != null && board ? findContainerKey(board, dragStopId) : null;
  const dragStopGroup = groups.find(g => g.key === dragStopGroupKey) ?? null;

  /* ── divider drag (§1.1: 380–620px at ≥1280px) ── */
  const startDividerDrag = useCallback(
    (e: React.PointerEvent) => {
      if (window.innerWidth < 1280) return;
      e.preventDefault();
      const startX = e.clientX;
      const startW = panelW ?? 480;
      const onMove = (ev: PointerEvent) =>
        setPanelW(Math.min(620, Math.max(380, startW + ev.clientX - startX)));
      const onUp = () => {
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
      };
      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
    },
    [panelW]
  );

  return (
    <div className="relative">
      {/* mobile view toggle (§1.1) */}
      <div className="pointer-events-none absolute left-1/2 top-3 z-30 -translate-x-1/2 lg:hidden">
        <div className="pointer-events-auto flex items-center gap-1 rounded-pill glass p-1 shadow-md">
          {(["itinerary", "map"] as const).map(v => (
            <button
              key={v}
              type="button"
              onClick={() => setMobileView(v)}
              className={cn(
                "relative rounded-pill px-4 py-1.5 text-[13px] font-semibold transition-colors duration-fast",
                mobileView === v ? "text-ink" : "text-ink-3"
              )}
            >
              {mobileView === v ? (
                <motion.span
                  layoutId="ws-view-pill"
                  className="absolute inset-0 rounded-pill bg-surface shadow-sm"
                  transition={{ type: "spring", stiffness: 380, damping: 30 }}
                />
              ) : null}
              <span className="relative capitalize">{v}</span>
            </button>
          ))}
        </div>
      </div>

      <div className="flex h-[calc(100dvh-272px)] min-h-[440px] lg:h-[calc(100dvh-176px)]">
        {/* ── timeline panel ── */}
        <div
          style={panelW != null ? { width: panelW } : undefined}
          className={cn(
            "h-full flex-col overflow-hidden border-r border-border bg-bg lg:flex lg:w-[420px] lg:shrink-0 xl:w-[480px]",
            mobileView === "itinerary" ? "flex w-full" : "hidden lg:flex"
          )}
        >
          {/* panel header + day rail */}
          <div className="border-b border-border px-4 pb-2.5 pt-12 lg:pt-3">
            <div className="mb-2 flex items-center justify-between">
              <span className="type-caption text-ink-3">
                {shortDate(data.trip.startDate)} - {shortDate(data.trip.endDate)}
              </span>
              <div className="flex items-center gap-1.5">
                {/* manual add, first-class, always visible (primary) */}
                <button
                  type="button"
                  onClick={() => openAdd(activeDayId)}
                  className="btn-sheen type-small flex h-8 items-center gap-1.5 rounded-pill bg-brand px-3.5 font-semibold text-brand-ink shadow-sm transition-all duration-fast hover:-translate-y-px hover:bg-brand-strong hover:shadow-md active:scale-[0.97]"
                  title="Browse places and add them to a day yourself"
                >
                  <Plus className="h-4 w-4" strokeWidth={2.25} /> Add places
                </button>
                <button
                  type="button"
                  onClick={e => openDayFill(null, e.currentTarget)}
                  disabled={generatingDay != null}
                  className="type-small flex items-center gap-1.5 rounded-md px-2 py-1 font-semibold text-ink-3 transition-colors duration-fast hover:bg-surface-2 hover:text-brand disabled:opacity-60"
                  title="Append a new day planned by AI"
                >
                  {generatingDay === "new" ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" strokeWidth={1.75} />
                  ) : (
                    <Sparkles className="h-3.5 w-3.5" strokeWidth={1.75} />
                  )}
                  Add AI day
                  {!isVoyager ? (
                    <Crown className="h-3 w-3 text-ochre" strokeWidth={1.75} />
                  ) : null}
                </button>
              </div>
            </div>
            <div className="flex snap-x snap-mandatory gap-2 overflow-x-auto pb-1 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
              <button
                type="button"
                onClick={() => selectDay(null, null)}
                className={cn(
                  "type-small flex shrink-0 snap-start items-center gap-1.5 rounded-pill border px-3 py-1.5 font-semibold transition-all duration-fast",
                  activeDayId == null
                    ? "border-transparent bg-ink text-bg shadow-sm"
                    : "border-border bg-surface text-ink-2 hover:border-border-strong hover:text-ink"
                )}
              >
                <MapIcon className="h-3.5 w-3.5" strokeWidth={1.75} /> All
              </button>
              {groups
                .filter(g => g.day != null)
                .map(g => (
                  <DayPill
                    key={g.key}
                    group={g}
                    active={activeDayId === g.day?.id}
                    isDark={isDark}
                    onClick={() => selectDay(g.day?.id ?? null, g.key)}
                  />
                ))}
            </div>
          </div>

          {/* hotel home-base banner, top of the itinerary panel */}
          <HotelBanner data={data} tripId={tripId} activeDayId={activeDayId} />

          {/* r24-smart K: premium weather advisory banner (renders null when
              the forecast is calm or the user is free) */}
          <WeatherAdvisory data={data} tripId={tripId} isVoyager={isVoyager} />

          {/* scrollable days */}
          <div
            ref={dayListRef}
            className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-4"
          >
            {allEmpty ? (
              /* §1.8 empty state */
              <div className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center">
                <img
                  src="/empty-globe.svg"
                  alt=""
                  className="h-[120px] w-[160px] opacity-90"
                />
                <h3 className="type-h3 text-ink">Day 1 is a blank page</h3>
                <p className="type-body max-w-[38ch] text-ink-2">
                  Start pinning places, the map and timeline fill in together
                  as you plan.
                </p>
                <button
                  type="button"
                  onClick={() => openAdd(orderedDays[0]?.id ?? null)}
                  className="btn-sheen type-small mt-1 flex h-10 items-center gap-2 rounded-pill bg-brand px-5 font-semibold text-brand-ink shadow-sm transition-all duration-fast hover:-translate-y-px hover:bg-brand-strong hover:shadow-md active:scale-[0.97]"
                >
                  <Plus className="h-4 w-4" strokeWidth={2} /> Browse places in{" "}
                  {catalog.city}
                </button>
                <button
                  type="button"
                  onClick={e =>
                    openDayFill(orderedDays[0]?.id ?? null, e.currentTarget)
                  }
                  disabled={generatingDay != null}
                  className="type-small flex h-9 items-center gap-1.5 rounded-pill border border-border px-4 font-semibold text-ink-2 transition-all duration-fast hover:-translate-y-px hover:border-brand hover:text-brand active:scale-[0.97] disabled:opacity-60"
                >
                  {generatingDay != null ? (
                    <Loader2 className="h-4 w-4 animate-spin" strokeWidth={1.75} />
                  ) : (
                    <Sparkles className="h-4 w-4" strokeWidth={1.75} />
                  )}
                  {generatingDay != null
                    ? "Planning your day…"
                    : "Fill Day 1 with AI"}
                  {!isVoyager && generatingDay == null ? (
                    <Crown className="h-3.5 w-3.5 text-ochre" strokeWidth={1.75} />
                  ) : null}
                </button>
              </div>
            ) : (
              <DndContext
                sensors={sensors}
                collisionDetection={closestCorners}
                measuring={{
                  droppable: { strategy: MeasuringStrategy.Always },
                }}
                onDragStart={onDragStart}
                onDragOver={onDragOver}
                onDragEnd={onDragEnd}
                onDragCancel={onDragCancel}
              >
                <div className="space-y-7">
                  {groups.map(g => (
                    <div key={g.key}>
                      <DaySection
                        group={g}
                        tripId={tripId}
                        isDark={isDark}
                        isVoyager={isVoyager}
                        selectedStopId={selectedStopId}
                        flashStopId={flashStopId}
                        modes={modes}
                        days={orderedDays}
                        generating={generatingDay === g.day?.id}
                        optimizing={optimizingDayId === g.day?.id}
                        onSelectStop={selectStop}
                        onEditStop={setEditStop}
                        onDeleteStop={handleDeleteStop}
                        onDuplicateStop={handleDuplicateStop}
                        onMoveStop={moveStop}
                        onFillDay={(dayId, el) => openDayFill(dayId, el)}
                        onCycleMode={pairKey =>
                          setModes(m => {
                            const order: TravelMode[] = [
                              "walking",
                              "transit",
                              "driving",
                              "train",
                            ];
                            const cur =
                              m[pairKey] ??
                              travelModeForDayMode(g.day?.transportMode);
                            const next =
                              order[
                                (order.indexOf(cur) + 1) % order.length
                              ];
                            return { ...m, [pairKey]: next };
                          })
                        }
                        onAddStop={dayId => openAdd(dayId)}
                        onOptimizeDay={dayId => {
                          setActiveDayId(dayId);
                          runOptimizeDay(dayId);
                        }}
                        onClearDay={handleClearDay}
                        registerStopRef={(id, el) => {
                          if (el) stopRefs.current.set(id, el);
                          else stopRefs.current.delete(id);
                        }}
                        registerDayRef={el => {
                          if (el) dayRefs.current.set(g.key, el);
                          else dayRefs.current.delete(g.key);
                        }}
                        currency={homeCurrency}
                        country={legCountry}
                        onPickLeg={pickLeg}
                      />
                    </div>
                  ))}
                </div>

                <DragOverlay
                  dropAnimation={{
                    duration: 200,
                    easing: "cubic-bezier(.22,1,.36,1)",
                  }}
                >
                  {dragStop ? (
                    <div className="w-[min(420px,80vw)]">
                      <StopCardShell
                        overlay
                        stop={dragStop}
                        number={
                          (dragStopGroup?.stops.findIndex(
                            s => s.id === dragStop.id
                          ) ?? 0) + 1
                        }
                        color={dayColor(
                          (dragStopGroup?.index ?? 0) + 1,
                          isDark
                        )}
                      />
                    </div>
                  ) : null}
                </DragOverlay>
              </DndContext>
            )}
          </div>
        </div>

        {/* ── draggable divider ── */}
        <div
          role="separator"
          aria-orientation="vertical"
          onPointerDown={startDividerDrag}
          className="group relative hidden w-2 shrink-0 cursor-col-resize items-center justify-center lg:flex"
        >
          <span
            className="h-full w-px bg-border transition-colors duration-fast group-hover:w-0.5 group-hover:bg-brand group-active:bg-brand"
            aria-hidden
          />
        </div>

        {/* ── map pane ── */}
        <div
          className={cn(
            "relative h-full min-w-0 flex-1",
            mobileView === "map" ? "block" : "hidden lg:block"
          )}
        >
          <MapPane
            days={orderedDays}
            stops={workingStops}
            activeDayId={activeDayId}
            selectedStopId={selectedStopId}
            onSelectStop={selectStop}
            onOpenInTimeline={openInTimeline}
            onDeleteStop={handleDeleteStop}
            center={catalog.center}
            centerZoom={catalog.zoom}
            renumberSeed={renumberSeed}
            onMapReady={setMapInstance}
            onMapContextMenu={setPinDrop}
          >
            {/* live place search, top-left glass overlay */}
            <MapSearchOverlay
              map={mapInstance}
              tripId={tripId}
              days={orderedDays}
              activeDayId={activeDayId}
              destination={data.trip.destination}
            />
            {/* near-me, live Overpass results around the user's location */}
            <NearMeOverlay
              map={mapInstance}
              tripId={tripId}
              days={orderedDays}
              activeDayId={activeDayId}
              destination={data.trip.destination}
            />
            {/* right-click "add place here" popover */}
            {pinDrop ? (
              <AddPlacePinPopover
                key={`${pinDrop.lat.toFixed(6)},${pinDrop.lng.toFixed(6)}`}
                map={mapInstance}
                lat={pinDrop.lat}
                lng={pinDrop.lng}
                destination={data.trip.destination}
                onClose={() => setPinDrop(null)}
              />
            ) : null}
            {/* mobile summary chip - sits under the view toggle / search row
                (top-3 would collide with the Itinerary/Map segmented toggle) */}
            <div className="absolute left-3 top-[104px] z-10 lg:hidden">
              <span className="type-small glass flex items-center gap-1.5 rounded-pill px-3 py-1.5 font-semibold text-ink shadow-md">
                {activeGroup?.day ? dayLabel(activeGroup.index) : "All days"} ·{" "}
                {activeGroup?.stops.length ?? workingStops.length} stops
              </span>
            </div>
            {/* optimize pill, bottom-center hero CTA */}
            <div className="absolute bottom-5 left-1/2 z-10 -translate-x-1/2">
              <OptimizePill
                isVoyager={isVoyager}
                loading={optimizing}
                onRun={() => runOptimize(activeDayId)}
                upsellOpen={upsellOpen}
                onUpsellOpenChange={setUpsellOpen}
              />
            </div>
          </MapPane>
        </div>
      </div>

      <AddPlaceOverlay
        open={addOpen}
        onClose={() => setAddOpen(false)}
        tripId={tripId}
        dayId={addTargetGroup?.day?.id ?? addDayId}
        dayName={
          addTargetGroup?.day ? dayLabel(addTargetGroup.index) : "Unscheduled"
        }
        destination={data.trip.destination}
        centroid={centroid}
      />
      <StopEditDialog
        stop={editStop}
        days={orderedDays}
        tripId={tripId}
        onClose={() => setEditStop(null)}
      />
      <VoyagerUpsellDialog open={aiUpsellOpen} onOpenChange={setAiUpsellOpen} />
      <DayFillOptions
        open={dayFill != null}
        anchorRect={dayFill?.rect ?? null}
        onOpenChange={o => {
          if (!o) setDayFill(null);
        }}
        onConfirm={choice => {
          const target = dayFill;
          setDayFill(null);
          if (target) void runGenerateDay(target.dayId, choice);
        }}
      />
    </div>
  );
}
