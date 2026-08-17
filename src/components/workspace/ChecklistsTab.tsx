import { useMemo, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  Check,
  Luggage,
  ListChecks,
  MoreHorizontal,
  Plus,
  ShoppingBag,
  Sparkles,
  X,
} from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { trpc } from "@/providers/trpc";
import { cn } from "@/lib/utils";
import type { TripData, WsChecklistItem } from "./utils";
import SmartPacking, { GENERATED_PREFIX } from "./SmartPacking";
import { useToast } from "./Toasts";

const LISTS = [
  { key: "packing", label: "Packing", icon: Luggage },
  { key: "todo", label: "To-do", icon: ListChecks },
  { key: "shopping", label: "Shopping", icon: ShoppingBag },
] as const;
type ListKey = (typeof LISTS)[number]["key"];

const BURST_COLORS = ["#BC5934", "#44604F", "#B98A2E", "#6E7FA3"];

/* ── micro pieces ── */

/** 12-dot celebratory burst when a list hits 100% (§3). */
function ConfettiBurst({ seed }: { seed: number }) {
  const dots = useMemo(
    () =>
      Array.from({ length: 12 }, (_, i) => {
        const angle = (i / 12) * Math.PI * 2 + 0.26;
        const dist = 26 + ((i * 37) % 22);
        return {
          x: Math.cos(angle) * dist,
          y: Math.sin(angle) * dist,
          color: BURST_COLORS[i % BURST_COLORS.length],
        };
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [seed]
  );
  if (!seed) return null;
  return (
    <span
      key={seed}
      className="pointer-events-none absolute inset-0"
      aria-hidden
    >
      {dots.map((d, i) => (
        <motion.span
          key={i}
          initial={{ x: 0, y: 0, opacity: 1, scale: 1 }}
          animate={{ x: d.x, y: d.y, opacity: 0, scale: 0.5 }}
          transition={{ duration: 0.7, ease: "easeOut" }}
          className="absolute left-1/2 top-1/2 h-1.5 w-1.5 rounded-full"
          style={{ backgroundColor: d.color }}
        />
      ))}
    </span>
  );
}

/** Progress ring (§10.4): 5px stroke, border track, pine fill, 600ms dash animation. */
function ProgressRing({
  value,
  burstSeed,
}: {
  value: number;
  burstSeed: number;
}) {
  const size = 48;
  const stroke = 5;
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const done = value >= 1;
  return (
    <span
      className="relative inline-flex items-center justify-center"
      style={{ width: size, height: size }}
    >
      <svg width={size} height={size} className="-rotate-90">
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          stroke="var(--border)"
          strokeWidth={stroke}
          fill="none"
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          stroke="var(--pine)"
          strokeWidth={stroke}
          fill="none"
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={c * (1 - Math.min(1, value))}
          style={{
            transition: "stroke-dashoffset 600ms cubic-bezier(.22,1,.36,1)",
          }}
        />
      </svg>
      <span className="absolute inset-0 flex items-center justify-center">
        {done ? (
          <motion.span
            initial={{ scale: 0.4 }}
            animate={{ scale: 1 }}
            transition={{ type: "spring", stiffness: 500, damping: 28 }}
          >
            <Check className="h-4 w-4 text-pine" strokeWidth={2.5} />
          </motion.span>
        ) : (
          <span className="type-caption tnum text-ink-2">
            {Math.round(value * 100)}%
          </span>
        )}
      </span>
      <ConfettiBurst seed={burstSeed} />
    </span>
  );
}

/** Checkbox row with the global check micro-interaction (§7.2). */
function CheckRow({
  item,
  onToggle,
  onDelete,
}: {
  item: WsChecklistItem;
  onToggle: () => void;
  onDelete: () => void;
}) {
  return (
    <motion.li
      layout
      initial={{ opacity: 0, height: 0 }}
      animate={{ opacity: 1, height: "auto" }}
      exit={{ opacity: 0, height: 0 }}
      transition={{ duration: 0.28, ease: [0.22, 1, 0.36, 1] }}
      className="group overflow-hidden"
    >
      <div className="flex items-center gap-2.5 rounded-md px-2 py-1.5 transition-colors duration-fast hover:bg-surface-2">
        <button
          type="button"
          role="checkbox"
          aria-checked={item.done}
          aria-label={item.label}
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
          {item.label}
        </span>
        <button
          type="button"
          aria-label={`Remove ${item.label}`}
          onClick={onDelete}
          className="flex h-6 w-6 shrink-0 items-center justify-center rounded-sm text-ink-3 opacity-0 transition-all duration-fast hover:bg-danger/10 hover:text-danger group-hover:opacity-100"
        >
          <X className="h-3.5 w-3.5" strokeWidth={1.75} />
        </button>
      </div>
    </motion.li>
  );
}

/* ── one list card ── */

function ListCard({
  listKey,
  label,
  icon: Icon,
  items,
  tripId,
}: {
  listKey: ListKey;
  label: string;
  icon: typeof Luggage;
  items: WsChecklistItem[];
  tripId: number;
}) {
  const utils = trpc.useUtils();
  const { push } = useToast();
  const [draft, setDraft] = useState("");
  const [burstSeed, setBurstSeed] = useState(0);
  const doneCount = items.filter(i => i.done).length;
  const ratio = items.length ? doneCount / items.length : 0;
  /* celebrate when the list reaches 100% (render-phase adjust, react.dev) */
  const [prevRatio, setPrevRatio] = useState(ratio);
  if (prevRatio !== ratio) {
    setPrevRatio(ratio);
    if (ratio >= 1 && prevRatio < 1 && items.length > 0) setBurstSeed(s => s + 1);
  }

  const patchCache = (fn: (items: WsChecklistItem[]) => WsChecklistItem[]) =>
    utils.trips.get.setData({ id: tripId }, old =>
      old ? { ...old, checklist: fn(old.checklist) } : old
    );

  const toggle = trpc.trips.toggleChecklistItem.useMutation({
    onError: () => utils.trips.get.invalidate({ id: tripId }),
  });
  const add = trpc.trips.addChecklistItem.useMutation({
    onSettled: () => utils.trips.get.invalidate({ id: tripId }),
    onError: e =>
      push({
        title: "Could not add item",
        description: e.message,
        kind: "danger",
      }),
  });
  const del = trpc.trips.deleteChecklistItem.useMutation({
    onSettled: () => utils.trips.get.invalidate({ id: tripId }),
  });

  const onToggle = (item: WsChecklistItem) => {
    patchCache(list =>
      list.map(i => (i.id === item.id ? { ...i, done: !i.done } : i))
    );
    toggle.mutate({ id: item.id, tripId, done: !item.done });
  };

  const onDelete = (item: WsChecklistItem) => {
    patchCache(list => list.filter(i => i.id !== item.id));
    del.mutate({ id: item.id, tripId });
  };

  const submit = () => {
    const labelText = draft.trim();
    if (!labelText) return;
    const temp: WsChecklistItem = {
      id: -Date.now(),
      tripId,
      list: listKey,
      label: labelText,
      done: false,
      position: items.length,
    };
    patchCache(list => [...list, temp]);
    setDraft("");
    add.mutate({ tripId, list: listKey, label: labelText });
  };

  const clearCompleted = () => {
    items.filter(i => i.done).forEach(i => del.mutate({ id: i.id, tripId }));
    patchCache(list => list.filter(i => i.list !== listKey || !i.done));
  };
  const clearAll = () => {
    items.forEach(i => del.mutate({ id: i.id, tripId }));
    patchCache(list => list.filter(i => i.list !== listKey));
  };

  return (
    <motion.section
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.32, ease: [0.22, 1, 0.36, 1] }}
      className="rounded-lg border border-border bg-surface p-4 shadow-sm"
      aria-label={label}
    >
      <div className="flex items-center gap-2.5">
        <span className="flex h-8 w-8 items-center justify-center rounded-md bg-surface-2 text-ink-2">
          <Icon className="h-4 w-4" strokeWidth={1.75} />
        </span>
        <h4 className="type-h4 flex-1 text-ink">{label}</h4>
        {ratio >= 1 && items.length > 0 ? (
          <motion.span
            initial={{ scale: 0.8, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            transition={{ type: "spring", stiffness: 500, damping: 28 }}
            className="type-caption flex items-center gap-1 rounded-pill bg-pine-soft px-2 py-0.5 font-semibold text-pine"
          >
            <Check className="h-3 w-3" strokeWidth={2.5} /> All set
          </motion.span>
        ) : null}
        <ProgressRing value={ratio} burstSeed={burstSeed} />
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              aria-label={`${label} options`}
              className="flex h-7 w-7 items-center justify-center rounded-md text-ink-3 transition-colors duration-fast hover:bg-surface-2 hover:text-ink"
            >
              <MoreHorizontal className="h-4 w-4" strokeWidth={1.75} />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-44 rounded-lg">
            <DropdownMenuItem
              onClick={clearCompleted}
              disabled={doneCount === 0}
            >
              Clear completed
            </DropdownMenuItem>
            <DropdownMenuItem
              onClick={clearAll}
              disabled={items.length === 0}
              className="text-danger focus:text-danger"
            >
              Clear all
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <ul className="mt-2">
        <AnimatePresence initial={false}>
          {items.map(item => (
            <CheckRow
              key={item.id}
              item={item}
              onToggle={() => onToggle(item)}
              onDelete={() => onDelete(item)}
            />
          ))}
        </AnimatePresence>
        {items.length === 0 ? (
          <li className="type-caption px-2 py-3 text-center text-ink-3">
            Nothing here yet, add your first item below.
          </li>
        ) : null}
      </ul>

      <div className="mt-1 flex items-center gap-2 border-t border-border pt-2.5">
        <Plus className="h-4 w-4 shrink-0 text-ink-3" strokeWidth={1.75} />
        <input
          value={draft}
          onChange={e => setDraft(e.target.value)}
          onKeyDown={e => {
            if (e.key === "Enter") submit();
          }}
          placeholder="Add an item…"
          aria-label={`Add an item to ${label}`}
          className="type-small h-8 w-full bg-transparent text-ink placeholder:text-ink-3 focus:outline-none"
        />
      </div>
    </motion.section>
  );
}

/* ── smart suggestions (§3 right rail) ── */

function suggestionsFor(destination: string): {
  caption: string;
  items: string[];
} {
  if (/kyoto|osaka|nara|tokyo|japan/i.test(destination)) {
    return {
      caption: `Based on ${destination.split(",")[0]} in spring, mild days and light rain`,
      items: [
        "Compact umbrella",
        "Layers",
        "IC transit card",
        "Power adapter (Type A)",
        "Coin pouch",
      ],
    };
  }
  if (/lisbon|portugal/i.test(destination)) {
    return {
      caption: `Based on ${destination.split(",")[0]}, hills, tiles and Atlantic breeze`,
      items: [
        "Comfortable walking shoes",
        "Light jacket",
        "Sunscreen",
        "Power adapter (Type C/F)",
      ],
    };
  }
  return {
    caption: `Based on ${destination.split(",")[0] || "your destination"}`,
    items: [
      "Compact umbrella",
      "Layers",
      "Power adapter",
      "Reusable water bottle",
      "Day bag",
    ],
  };
}

function SmartSuggestions({
  destination,
  tripId,
  packing,
}: {
  destination: string;
  tripId: number;
  packing: WsChecklistItem[];
}) {
  const utils = trpc.useUtils();
  const { caption, items } = useMemo(
    () => suggestionsFor(destination),
    [destination]
  );
  const [added, setAdded] = useState<Set<string>>(new Set());
  const add = trpc.trips.addChecklistItem.useMutation({
    onSettled: () => utils.trips.get.invalidate({ id: tripId }),
  });
  const existing = useMemo(
    () => new Set(packing.map(i => i.label.toLowerCase())),
    [packing]
  );

  return (
    <motion.aside
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.32, ease: [0.22, 1, 0.36, 1], delay: 0.08 }}
      className="h-fit rounded-lg border border-brand/25 bg-brand-soft/40 p-4"
    >
      <p className="type-h4 flex items-center gap-2 text-ink">
        <Sparkles className="h-4 w-4 text-brand" strokeWidth={1.75} /> Smart
        suggestions
      </p>
      <p className="type-caption mt-1 leading-relaxed text-ink-2">{caption}</p>
      <ul className="mt-3 flex flex-wrap gap-2">
        {items.map((labelText, i) => {
          const isAdded =
            added.has(labelText) || existing.has(labelText.toLowerCase());
          return (
            <motion.li
              key={labelText}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{
                delay: 0.08 + i * 0.08,
                duration: 0.28,
                ease: [0.22, 1, 0.36, 1],
              }}
            >
              <button
                type="button"
                disabled={isAdded}
                onClick={() => {
                  setAdded(s => new Set(s).add(labelText));
                  add.mutate({ tripId, list: "packing", label: labelText });
                }}
                className={cn(
                  "type-small flex items-center gap-1.5 rounded-pill border px-3 py-1.5 font-semibold transition-all duration-fast",
                  isAdded
                    ? "border-transparent bg-surface-2 text-ink-3"
                    : "border-border-strong bg-surface text-ink-2 shadow-sm hover:-translate-y-px hover:border-brand hover:text-brand"
                )}
              >
                {isAdded ? (
                  <Check className="h-3.5 w-3.5 text-pine" strokeWidth={2.25} />
                ) : (
                  <Plus className="h-3.5 w-3.5" strokeWidth={2} />
                )}
                {isAdded ? `${labelText} · Added` : labelText}
              </button>
            </motion.li>
          );
        })}
      </ul>
    </motion.aside>
  );
}

/* ── the tab ── */

export default function ChecklistsTab({
  data,
  tripId,
}: {
  data: TripData;
  tripId: number;
}) {
  const byList = useMemo(() => {
    const map = new Map<ListKey, WsChecklistItem[]>();
    LISTS.forEach(l => map.set(l.key, []));
    for (const item of data.checklist) {
      // Smart-packing rows (✦ prefix) render in the SmartPacking panel
      // instead of the plain Packing card.
      if (item.list === "packing" && item.label.startsWith(GENERATED_PREFIX))
        continue;
      const key = (
        LISTS.some(l => l.key === item.list) ? item.list : "todo"
      ) as ListKey;
      map.get(key)!.push(item);
    }
    for (const arr of map.values()) arr.sort((a, b) => a.position - b.position);
    return map;
  }, [data.checklist]);

  return (
    <div className="mx-auto max-w-[1120px] px-4 py-6 md:px-6">
      <h2 className="type-h2 text-ink">Checklists</h2>
      <div className="mt-5 grid grid-cols-1 gap-4 md:grid-cols-[1fr_300px]">
        <div className="space-y-4">
          <SmartPacking data={data} tripId={tripId} />
          {LISTS.map(l => (
            <ListCard
              key={l.key}
              listKey={l.key}
              label={l.label}
              icon={l.icon}
              items={byList.get(l.key) ?? []}
              tripId={tripId}
            />
          ))}
        </div>
        <SmartSuggestions
          destination={data.trip.destination}
          tripId={tripId}
          packing={byList.get("packing") ?? []}
        />
      </div>
    </div>
  );
}
