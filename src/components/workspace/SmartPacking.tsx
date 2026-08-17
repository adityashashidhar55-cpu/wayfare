// SmartPacking.tsx - Voyager smart packing list (r9-packing).
//
// Lives at the top of the Checklists tab. Generates a packing list tuned to
// the trip's dates, weather, destination country, styles and travellers via
// trpc.packing.generatePackingList. Generated checklist rows are marked with
// the "✦ " prefix and carry "Group|Label|Why?" in the label column - this
// component strips all of that, renders grouped sections with checkboxes
// wired to the standard trips.toggleChecklistItem mutation, and shows the
// why as a tooltip. Manual packing items are untouched (and stay in the
// regular Packing list card).

import { useMemo, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  Baby,
  Backpack,
  Crown,
  Droplets,
  FileText,
  HeartPulse,
  Info,
  Loader2,
  Lock,
  Plug,
  RefreshCw,
  Shirt,
  Sparkles,
  Trash2,
  type LucideIcon,
} from "lucide-react";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { VoyagerUpsellDialog } from "@/components/trips/AiTripBuilder";
import { trpc } from "@/providers/trpc";
import { cn } from "@/lib/utils";
import type { TripData, WsChecklistItem } from "./utils";
import { useToast } from "./Toasts";

export const GENERATED_PREFIX = "✦ ";

const GROUP_ORDER = [
  "Clothing",
  "Gear",
  "Documents",
  "Health",
  "Kids",
  "Tech",
  "Toiletries",
] as const;

const GROUP_META: Record<string, { icon: LucideIcon }> = {
  Clothing: { icon: Shirt },
  Gear: { icon: Backpack },
  Documents: { icon: FileText },
  Health: { icon: HeartPulse },
  Kids: { icon: Baby },
  Tech: { icon: Plug },
  Toiletries: { icon: Droplets },
};

type ParsedItem = { group: string; text: string; why?: string };

/** "✦ Group|Label|Why?" → parts; tolerates a bare "✦ Label" too. */
function parseGenerated(rawLabel: string): ParsedItem {
  const body = rawLabel.slice(GENERATED_PREFIX.length);
  const [first, second, third] = body.split("|");
  if (second) return { group: first ?? "", text: second, why: third || undefined };
  return { group: "", text: body };
}

function tripDays(data: TripData): number {
  const start = new Date(data.trip.startDate + "T00:00:00Z").getTime();
  const end = new Date(data.trip.endDate + "T00:00:00Z").getTime();
  return Math.max(1, Math.round((end - start) / 86400000) + 1);
}

/* ── one generated item row ── */

function GeneratedRow({
  item,
  parsed,
  onToggle,
}: {
  item: WsChecklistItem;
  parsed: ParsedItem;
  onToggle: () => void;
}) {
  return (
    <motion.li
      layout
      initial={{ opacity: 0, height: 0 }}
      animate={{ opacity: 1, height: "auto" }}
      exit={{ opacity: 0, height: 0 }}
      transition={{ duration: 0.24, ease: [0.22, 1, 0.36, 1] }}
      className="overflow-hidden"
    >
      <div className="flex items-center gap-2.5 rounded-md px-2 py-1.5 transition-colors duration-fast hover:bg-surface">
        <button
          type="button"
          role="checkbox"
          aria-checked={item.done}
          aria-label={parsed.text}
          onClick={onToggle}
          className={cn(
            "flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-[5px] border transition-colors duration-fast",
            item.done
              ? "border-pine bg-pine"
              : "border-border-strong bg-surface hover:border-pine"
          )}
        >
          <svg viewBox="0 0 12 12" className="h-3 w-3">
            <motion.path
              d="M2.5 6.4l2.3 2.3L9.5 3.4"
              fill="none"
              stroke="#FFFFFF"
              strokeWidth={1.8}
              strokeLinecap="round"
              strokeLinejoin="round"
              initial={false}
              animate={{ pathLength: item.done ? 1 : 0 }}
              transition={{ duration: 0.24 }}
            />
          </svg>
        </button>
        <span
          className="type-small min-w-0 flex-1 truncate"
          style={{
            backgroundImage: "linear-gradient(var(--ink-3), var(--ink-3))",
            backgroundRepeat: "no-repeat",
            backgroundPosition: "0 58%",
            backgroundSize: item.done ? "100% 1px" : "0% 1px",
            color: item.done ? "var(--ink-3)" : "var(--ink)",
            transition:
              "background-size 280ms cubic-bezier(.22,1,.36,1), color 200ms",
          }}
        >
          {parsed.text}
        </span>
        {parsed.why ? (
          <Tooltip>
            <TooltipTrigger asChild>
              <span
                className="flex h-5 w-5 shrink-0 cursor-help items-center justify-center rounded-full text-ink-3 transition-colors duration-fast hover:text-brand"
                aria-label={`Why: ${parsed.why}`}
              >
                <Info className="h-3.5 w-3.5" strokeWidth={1.75} />
              </span>
            </TooltipTrigger>
            <TooltipContent side="top" className="max-w-[220px]">
              {parsed.why}
            </TooltipContent>
          </Tooltip>
        ) : null}
      </div>
    </motion.li>
  );
}

/* ── the panel ── */

export default function SmartPacking({
  data,
  tripId,
}: {
  data: TripData;
  tripId: number;
}) {
  const isVoyager = data.tier === "voyager";
  const utils = trpc.useUtils();
  const { push } = useToast();
  const [upsellOpen, setUpsellOpen] = useState(false);

  const generated = useMemo(
    () =>
      data.checklist
        .filter(
          i => i.list === "packing" && i.label.startsWith(GENERATED_PREFIX)
        )
        .sort((a, b) => a.position - b.position),
    [data.checklist]
  );

  const sections = useMemo(() => {
    const map = new Map<string, { item: WsChecklistItem; parsed: ParsedItem }[]>();
    for (const item of generated) {
      const parsed = parseGenerated(item.label);
      const key = parsed.group || "Suggested";
      const arr = map.get(key) ?? [];
      arr.push({ item, parsed });
      map.set(key, arr);
    }
    const known = GROUP_ORDER.filter(g => map.has(g)).map(g => [g, map.get(g)!] as const);
    const extra = [...map.keys()]
      .filter(k => !(GROUP_ORDER as readonly string[]).includes(k))
      .map(k => [k, map.get(k)!] as const);
    return [...known, ...extra];
  }, [generated]);

  const doneCount = generated.filter(i => i.done).length;
  const invalidate = () => utils.trips.get.invalidate({ id: tripId });

  const generate = trpc.packing.generatePackingList.useMutation({
    onSuccess: () => invalidate(),
    onError: e => {
      if (e.message.includes("UPGRADE_REQUIRED")) {
        setUpsellOpen(true);
      } else {
        push({
          title: "Could not generate list",
          description: e.message,
          kind: "danger",
        });
      }
    },
  });
  const clear = trpc.packing.clearGenerated.useMutation({
    onSuccess: () => {
      invalidate();
      push({ title: "Generated items cleared", kind: "success" });
    },
    onError: e =>
      push({
        title: "Could not clear items",
        description: e.message,
        kind: "danger",
      }),
  });
  const toggle = trpc.trips.toggleChecklistItem.useMutation({
    onError: () => invalidate(),
  });

  const onToggle = (item: WsChecklistItem) => {
    utils.trips.get.setData({ id: tripId }, old =>
      old
        ? {
            ...old,
            checklist: old.checklist.map(i =>
              i.id === item.id ? { ...i, done: !i.done } : i
            ),
          }
        : old
    );
    toggle.mutate({ id: item.id, tripId, done: !item.done });
  };

  const busy = generate.isPending;

  /* ── Wanderer: locked teaser (same pattern as HotelBanner) ── */
  if (!isVoyager) {
    return (
      <motion.section
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.32, ease: [0.22, 1, 0.36, 1] }}
        className="rounded-lg border border-border bg-surface p-4 shadow-sm"
        aria-label="Smart packing list"
      >
        <div className="flex items-center gap-3">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-ochre-soft text-ochre">
            <Lock className="h-4 w-4" strokeWidth={1.75} />
          </span>
          <span className="min-w-0 flex-1">
            <span className="type-small flex items-center gap-1.5 font-semibold text-ink">
              <Sparkles className="h-3.5 w-3.5 text-brand" strokeWidth={1.75} />
              Smart packing list
            </span>
            <span className="type-caption block text-ink-3">
              Voyager feature, a packing list tuned to your dates, weather and
              travellers.
            </span>
          </span>
          <button
            type="button"
            onClick={() => setUpsellOpen(true)}
            className="type-small flex shrink-0 items-center gap-1.5 rounded-pill bg-ochre-soft px-3 py-1.5 font-semibold text-ochre transition-all duration-fast hover:-translate-y-px hover:shadow-md"
          >
            <Crown className="h-3.5 w-3.5" strokeWidth={1.75} />
            Upgrade
          </button>
        </div>
        <VoyagerUpsellDialog open={upsellOpen} onOpenChange={setUpsellOpen} />
      </motion.section>
    );
  }

  /* ── Voyager ── */
  return (
    <motion.section
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.32, ease: [0.22, 1, 0.36, 1] }}
      className="rounded-lg border border-brand/25 bg-brand-soft/40 p-4"
      aria-label="Smart packing list"
    >
      <div className="flex items-center gap-2.5">
        <span className="flex h-8 w-8 items-center justify-center rounded-md bg-surface text-brand shadow-sm">
          <Sparkles className="h-4 w-4" strokeWidth={1.75} />
        </span>
        <div className="min-w-0 flex-1">
          <h4 className="type-h4 text-ink">Smart packing list</h4>
          <p className="type-caption text-ink-2">
            Tuned to {data.trip.destination.split(",")[0]} · {tripDays(data)}{" "}
            days
            {generated.length > 0
              ? ` · ${doneCount}/${generated.length} packed`
              : " · weather, documents, kids & gear"}
          </p>
        </div>
        {generated.length > 0 ? (
          <>
            <button
              type="button"
              onClick={() => generate.mutate({ tripId })}
              disabled={busy}
              className="type-small flex shrink-0 items-center gap-1.5 rounded-pill border border-border-strong bg-surface px-3 py-1.5 font-semibold text-ink-2 shadow-sm transition-all duration-fast hover:-translate-y-px hover:border-brand hover:text-brand disabled:opacity-60"
            >
              {busy ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" strokeWidth={2} />
              ) : (
                <RefreshCw className="h-3.5 w-3.5" strokeWidth={2} />
              )}
              Regenerate
            </button>
            <button
              type="button"
              onClick={() => clear.mutate({ tripId })}
              disabled={clear.isPending}
              aria-label="Clear generated items"
              title="Clear generated items"
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-ink-3 transition-colors duration-fast hover:bg-danger/10 hover:text-danger disabled:opacity-60"
            >
              <Trash2 className="h-4 w-4" strokeWidth={1.75} />
            </button>
          </>
        ) : (
          <button
            type="button"
            onClick={() => generate.mutate({ tripId })}
            disabled={busy}
            className="type-small flex shrink-0 items-center gap-1.5 rounded-pill bg-brand px-3 py-1.5 font-semibold text-white shadow-sm transition-all duration-fast hover:-translate-y-px hover:shadow-md disabled:opacity-60"
          >
            {busy ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" strokeWidth={2} />
            ) : (
              <Sparkles className="h-3.5 w-3.5" strokeWidth={2} />
            )}
            {busy ? "Generating…" : "Generate smart packing list"}
          </button>
        )}
      </div>

      {generate.isError &&
      !generate.error.message.includes("UPGRADE_REQUIRED") ? (
        <p className="type-caption mt-2 text-danger">
          {generate.error.message}
        </p>
      ) : null}

      {sections.length > 0 ? (
        <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-2">
          {sections.map(([group, rows], gi) => {
            const Icon = GROUP_META[group]?.icon ?? Sparkles;
            const done = rows.filter(r => r.item.done).length;
            return (
              <motion.div
                key={group}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{
                  delay: 0.05 * gi,
                  duration: 0.28,
                  ease: [0.22, 1, 0.36, 1],
                }}
                className="rounded-lg border border-border bg-surface p-3 shadow-sm"
              >
                <div className="flex items-center gap-2 px-1">
                  <Icon className="h-3.5 w-3.5 text-brand" strokeWidth={1.75} />
                  <span className="type-caption flex-1 font-semibold uppercase tracking-[0.08em] text-ink-2">
                    {group}
                  </span>
                  <span className="type-caption tnum text-ink-3">
                    {done}/{rows.length}
                  </span>
                  <span
                    className="type-caption rounded-pill bg-brand-soft px-1.5 py-px font-semibold text-brand"
                    title="Smart suggestion"
                  >
                    ✦
                  </span>
                </div>
                <ul className="mt-1">
                  <AnimatePresence initial={false}>
                    {rows.map(({ item, parsed }) => (
                      <GeneratedRow
                        key={item.id}
                        item={item}
                        parsed={parsed}
                        onToggle={() => onToggle(item)}
                      />
                    ))}
                  </AnimatePresence>
                </ul>
              </motion.div>
            );
          })}
        </div>
      ) : null}

      <VoyagerUpsellDialog open={upsellOpen} onOpenChange={setUpsellOpen} />
    </motion.section>
  );
}
