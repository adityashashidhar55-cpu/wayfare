import { useMemo, useState } from "react";
import { motion } from "framer-motion";
import {
  BedDouble,
  Car,
  CircleDot,
  Crown,
  Mail,
  MoreHorizontal,
  Paperclip,
  Plane,
  Plus,
  Ticket,
  TrainFront,
  Trash2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { Label } from "@/components/ui/label";
import { CURRENCY_SYMBOLS, formatMoney } from "@contracts/fx";
import { trpc } from "@/providers/trpc";
import { cn } from "@/lib/utils";
import { Link } from "react-router";
import BookingEmailImport from "./BookingEmailImport";
import type { TripData, WsMember, WsReservation } from "./utils";
import { useToast } from "./Toasts";

const GROUPS = [
  {
    key: "flight",
    label: "Flights",
    icon: Plane,
    empty: "No flights yet, forward a confirmation or add one.",
  },
  {
    key: "train",
    label: "Trains & buses",
    icon: TrainFront,
    empty: "No train bookings yet, forward a rail confirmation or add one.",
  },
  {
    key: "lodging",
    label: "Stays",
    icon: BedDouble,
    empty: "No stays yet, forward a confirmation or add one.",
  },
  {
    key: "car",
    label: "Cars",
    icon: Car,
    empty: "No cars yet, forward a confirmation or add one.",
  },
  {
    key: "activity",
    label: "Dining & tickets",
    icon: Ticket,
    empty: "No dining or tickets yet, forward a confirmation or add one.",
  },
  { key: "other", label: "Other", icon: CircleDot, empty: "Nothing here yet." },
] as const;

type GroupKey = (typeof GROUPS)[number]["key"];

const FIELD =
  "type-small h-9 w-full rounded-md border border-border-strong bg-surface px-3 text-ink placeholder:text-ink-3 focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/40";

function fmtDate(d: string | null): string | null {
  if (!d) return null;
  return new Date(`${d}T00:00:00`).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
}

function dateRange(start: string | null, end: string | null): string | null {
  const s = fmtDate(start);
  const e = fmtDate(end);
  if (s && e) return `${s} – ${e}`;
  return s ?? e;
}

/* ── one reservation card (§2) ── */

function ReservationCard({
  r,
  payerName,
  onDelete,
}: {
  r: WsReservation;
  payerName: string | null;
  onDelete: () => void;
}) {
  const initials = (r.provider ?? r.title).slice(0, 2).toUpperCase();
  const dates = dateRange(r.startDate, r.endDate);
  return (
    <motion.li
      layout
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -8 }}
      transition={{ duration: 0.28, ease: [0.22, 1, 0.36, 1] }}
      className="group flex items-center gap-3 rounded-lg border border-border bg-surface p-3.5 shadow-sm transition-all duration-fast hover:-translate-y-0.5 hover:shadow-md"
    >
      <span className="type-h4 flex h-12 w-12 shrink-0 items-center justify-center rounded-md bg-surface-2 text-ink-2">
        {initials}
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex flex-wrap items-center gap-2">
          <span className="truncate text-[14px] font-semibold text-ink">
            {r.title}
          </span>
          <span className="type-caption shrink-0 rounded-pill bg-pine-soft px-2 py-0.5 font-semibold text-pine">
            Confirmed
          </span>
          {r.source === "email-import" ? (
            <span className="type-caption inline-flex shrink-0 items-center gap-1 rounded-pill bg-info/10 px-2 py-0.5 font-semibold text-info">
              <Mail className="h-3 w-3" strokeWidth={1.75} />
              Imported
            </span>
          ) : null}
          {payerName ? (
            <span className="type-caption shrink-0 rounded-pill bg-surface-2 px-2 py-0.5 font-semibold text-ink-2">
              Paid by {payerName}
            </span>
          ) : null}
        </span>
        <span className="type-caption mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-ink-3">
          {r.provider ? <span>{r.provider}</span> : null}
          {dates ? <span>· {dates}</span> : null}
          {r.amountCents != null && r.currency ? (
            <span className="tnum font-semibold text-ink-2">
              · {formatMoney(r.amountCents, r.currency)}
            </span>
          ) : null}
          {r.confirmationCode ? (
            <span className="tnum rounded-sm bg-surface-2 px-1.5 py-0.5">
              #{r.confirmationCode}
            </span>
          ) : null}
          {r.details ? (
            <span className="block w-full truncate">{r.details}</span>
          ) : null}
        </span>
      </span>
      <span className="flex shrink-0 items-center gap-1">
        <span
          className="type-caption hidden items-center gap-1 text-ink-3 sm:flex"
          title="Attachments"
        >
          <Paperclip className="h-3.5 w-3.5" strokeWidth={1.75} />
        </span>
        <button
          type="button"
          aria-label={`Delete ${r.title}`}
          onClick={onDelete}
          className="flex h-8 w-8 items-center justify-center rounded-md text-ink-3 opacity-0 transition-all duration-fast hover:bg-danger/10 hover:text-danger group-hover:opacity-100"
        >
          <Trash2 className="h-4 w-4" strokeWidth={1.75} />
        </button>
      </span>
    </motion.li>
  );
}

/* ── add-reservation modal (§2): type segmented tabs swapping field sets ── */

function AddReservationModal({
  open,
  onClose,
  tripId,
  members,
  defaultCurrency,
}: {
  open: boolean;
  onClose: () => void;
  tripId: number;
  members: WsMember[];
  defaultCurrency: string;
}) {
  const utils = trpc.useUtils();
  const { push } = useToast();
  const [type, setType] = useState<GroupKey>("flight");
  const [title, setTitle] = useState("");
  const [provider, setProvider] = useState("");
  const [code, setCode] = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [details, setDetails] = useState("");
  const [amount, setAmount] = useState("");
  const [currency, setCurrency] = useState(defaultCurrency);
  const [paidById, setPaidById] = useState<number | null>(null);

  const reset = () => {
    setTitle("");
    setProvider("");
    setCode("");
    setStartDate("");
    setEndDate("");
    setDetails("");
    setAmount("");
    setCurrency(defaultCurrency);
    setPaidById(null);
  };

  /** major-units string → integer cents (undefined when blank/invalid) */
  const amountCents = (() => {
    const n = Number.parseFloat(amount);
    return amount.trim() && Number.isFinite(n) && n >= 0
      ? Math.round(n * 100)
      : undefined;
  })();

  const add = trpc.trips.addReservation.useMutation({
    onSuccess: () => {
      utils.trips.get.invalidate({ id: tripId });
      push({ title: "Reservation added", kind: "success" });
      reset();
      onClose();
    },
    onError: e =>
      push({
        title: "Could not add reservation",
        description: e.message,
        kind: "danger",
      }),
  });

  const typeTabs: { key: GroupKey; label: string; placeholder: string }[] = [
    { key: "flight", label: "Flight", placeholder: "UA 875 · SFO → NRT" },
    { key: "train", label: "Train", placeholder: "Shinkansen · Tokyo → Kyoto" },
    { key: "lodging", label: "Stay", placeholder: "Hotel name" },
    { key: "car", label: "Car", placeholder: "Rental company & class" },
    { key: "other", label: "Other", placeholder: "Reservation title" },
  ];
  const active = typeTabs.find(t => t.key === type)!;

  return (
    <Dialog
      open={open}
      onOpenChange={o => {
        if (!o) onClose();
      }}
    >
      <DialogContent
        className="rounded-xl sm:max-w-md"
        aria-describedby={undefined}
      >
        <DialogHeader>
          <DialogTitle className="type-h3 text-ink">
            Add a reservation
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div className="flex gap-1 rounded-pill bg-surface-2 p-1">
            {typeTabs.map(t => (
              <button
                key={t.key}
                type="button"
                onClick={() => setType(t.key)}
                className={cn(
                  "type-small flex-1 rounded-pill py-1.5 font-semibold transition-all duration-fast",
                  type === t.key
                    ? "bg-surface text-ink shadow-sm"
                    : "text-ink-3 hover:text-ink-2"
                )}
              >
                {t.label}
              </button>
            ))}
          </div>
          <motion.div
            key={type}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.22 }}
            className="space-y-2.5"
          >
            <div className="space-y-1.5">
              <Label className="type-caption text-ink-3">Title</Label>
              <input
                value={title}
                onChange={e => setTitle(e.target.value)}
                placeholder={active.placeholder}
                className={FIELD}
              />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1.5">
                <Label className="type-caption text-ink-3">Provider</Label>
                <input
                  value={provider}
                  onChange={e => setProvider(e.target.value)}
                  placeholder={type === "flight" ? "United" : "Optional"}
                  className={FIELD}
                />
              </div>
              <div className="space-y-1.5">
                <Label className="type-caption text-ink-3">
                  Confirmation #
                </Label>
                <input
                  value={code}
                  onChange={e => setCode(e.target.value)}
                  placeholder="ABC123"
                  className={FIELD}
                />
              </div>
              <div className="space-y-1.5">
                <Label className="type-caption text-ink-3">
                  {type === "lodging" ? "Check-in" : "Start date"}
                </Label>
                <input
                  type="date"
                  value={startDate}
                  onChange={e => setStartDate(e.target.value)}
                  className={FIELD}
                />
              </div>
              <div className="space-y-1.5">
                <Label className="type-caption text-ink-3">
                  {type === "lodging" ? "Check-out" : "End date"}
                </Label>
                <input
                  type="date"
                  value={endDate}
                  onChange={e => setEndDate(e.target.value)}
                  className={FIELD}
                />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label className="type-caption text-ink-3">Details</Label>
              <textarea
                value={details}
                onChange={e => setDetails(e.target.value)}
                rows={2}
                placeholder={
                  type === "flight"
                    ? "Seat 14A · Terminal 3"
                    : "Address, times, notes…"
                }
                className="type-small w-full resize-none rounded-md border border-border-strong bg-surface px-3 py-2 text-ink placeholder:text-ink-3 focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/40"
              />
            </div>
            {/* optional cost + who paid */}
            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1.5">
                <Label className="type-caption text-ink-3">
                  Amount (optional)
                </Label>
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  inputMode="decimal"
                  value={amount}
                  onChange={e => setAmount(e.target.value)}
                  placeholder="0.00"
                  className={cn(FIELD, "tnum")}
                />
              </div>
              <div className="space-y-1.5">
                <Label className="type-caption text-ink-3">Currency</Label>
                <select
                  value={currency}
                  onChange={e => setCurrency(e.target.value)}
                  className={FIELD}
                >
                  {Object.keys(CURRENCY_SYMBOLS).map(c => (
                    <option key={c} value={c}>
                      {c} ({CURRENCY_SYMBOLS[c]})
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <div className="space-y-1.5">
              <Label className="type-caption text-ink-3">
                Paid by (optional)
              </Label>
              <select
                value={paidById ?? ""}
                onChange={e =>
                  setPaidById(e.target.value ? Number(e.target.value) : null)
                }
                className={FIELD}
              >
                <option value="">No one yet</option>
                {members.map(m => (
                  <option key={m.id} value={m.id}>
                    {m.name}
                  </option>
                ))}
              </select>
            </div>
          </motion.div>
          <Button
            className="w-full"
            disabled={!title.trim() || add.isPending}
            onClick={() =>
              add.mutate({
                tripId,
                type,
                title: title.trim(),
                provider: provider.trim() || undefined,
                confirmationCode: code.trim() || undefined,
                startDate: startDate || undefined,
                endDate: endDate || undefined,
                details: details.trim() || undefined,
                amountCents,
                currency: amountCents != null ? currency : undefined,
                paidById: paidById ?? undefined,
              })
            }
          >
            {add.isPending ? "Saving…" : "Save reservation"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/* ── the tab ── */

export default function ReservationsTab({
  data,
  tripId,
}: {
  data: TripData;
  tripId: number;
}) {
  const utils = trpc.useUtils();
  const { push } = useToast();
  const [addOpen, setAddOpen] = useState(false);
  /* set when the import mutation reports UPGRADE_REQUIRED - swaps the panel
     for the same Wanderer upsell free users see */
  const [importBlocked, setImportBlocked] = useState(false);
  const isVoyager = data.tier === "voyager" && !importBlocked;

  const del = trpc.trips.deleteReservation.useMutation({
    onSuccess: () => {
      utils.trips.get.invalidate({ id: tripId });
      push({ title: "Reservation removed", kind: "info" });
    },
    onError: e =>
      push({
        title: "Could not delete",
        description: e.message,
        kind: "danger",
      }),
  });

  const byType = useMemo(() => {
    const map = new Map<GroupKey, WsReservation[]>();
    GROUPS.forEach(g => map.set(g.key, []));
    for (const r of data.reservations) {
      const key = (
        GROUPS.some(g => g.key === r.type) ? r.type : "other"
      ) as GroupKey;
      map.get(key)!.push(r);
    }
    return map;
  }, [data.reservations]);

  /* "other" + "train" groups stay hidden until they have items, keeping the
     default view to the four universal groups */
  const visibleGroups = GROUPS.filter(
    g =>
      (g.key !== "other" && g.key !== "train") ||
      (byType.get(g.key)?.length ?? 0) > 0
  );

  return (
    <div className="mx-auto max-w-[1120px] px-4 py-6 md:px-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <h2 className="type-h2 text-ink">Reservations</h2>
        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="secondary"
            size="sm"
            onClick={() => setAddOpen(true)}
          >
            <Plus className="h-4 w-4" /> Add manually
          </Button>
        </div>
      </div>

      {isVoyager ? (
        /* email import - Voyager feature: forward/paste → parsed → filed and
           laid out on the calendar (trip days) + map (geocoded stops) */
        <BookingEmailImport
          tripId={tripId}
          onUpgradeRequired={() => setImportBlocked(true)}
        />
      ) : (
        /* free tier: import block becomes an upsell card */
        <div className="mt-4 flex flex-wrap items-center gap-3 rounded-lg border border-ochre/30 bg-ochre-soft p-4">
          <span className="flex h-9 w-9 items-center justify-center rounded-full bg-surface text-ochre shadow-sm">
            <Mail className="h-4 w-4" strokeWidth={1.75} />
          </span>
          <div className="min-w-0 flex-1">
            <p className="type-small flex items-center gap-1.5 font-semibold text-ink">
              Auto-import from your inbox{" "}
              <Crown className="h-3.5 w-3.5 text-ochre" strokeWidth={1.75} />
            </p>
            <p className="type-caption mt-0.5 leading-relaxed text-ink-2">
              With Voyager, forward booking confirmations to your personal trip
              address and they’re filed here automatically, flights, trains,
              stays, cars, tickets, and laid out on your calendar and map.
            </p>
          </div>
          <Button variant="premium" size="sm" pill asChild>
            <Link to="/pricing">
              <Crown className="h-3.5 w-3.5" /> Upgrade to Voyager
            </Link>
          </Button>
        </div>
      )}

      <Accordion
        type="multiple"
        defaultValue={visibleGroups.map(g => g.key)}
        className="mt-5 space-y-3"
      >
        {visibleGroups.map(g => {
          const items = byType.get(g.key) ?? [];
          return (
            <AccordionItem
              key={g.key}
              value={g.key}
              className="overflow-hidden rounded-lg border border-border bg-surface"
            >
              <AccordionTrigger className="px-4 py-3 hover:no-underline [&[data-state=open]]:border-b [&[data-state=open]]:border-border">
                <span className="flex items-center gap-2.5">
                  <g.icon
                    className="h-[18px] w-[18px] text-ink-3"
                    strokeWidth={1.75}
                  />
                  <span className="type-h4 text-ink">{g.label}</span>
                  <span className="type-caption rounded-pill bg-surface-2 px-2 py-0.5 text-ink-3">
                    {items.length}
                  </span>
                </span>
              </AccordionTrigger>
              <AccordionContent className="px-3 pb-3 pt-2">
                {items.length ? (
                  <ul className="space-y-2">
                    {items.map(r => (
                      <ReservationCard
                        key={r.id}
                        r={r}
                        payerName={
                          r.paidById != null
                            ? (data.members.find(m => m.id === r.paidById)
                                ?.name ?? null)
                            : null
                        }
                        onDelete={() => del.mutate({ id: r.id, tripId })}
                      />
                    ))}
                  </ul>
                ) : (
                  <button
                    type="button"
                    onClick={() => setAddOpen(true)}
                    className="type-small flex h-12 w-full items-center justify-center gap-2 rounded-md border border-dashed border-border-strong text-ink-3 transition-all duration-fast hover:border-brand hover:text-brand"
                  >
                    <MoreHorizontal className="h-4 w-4" strokeWidth={1.75} />
                    {g.empty}
                  </button>
                )}
              </AccordionContent>
            </AccordionItem>
          );
        })}
      </Accordion>

      <AddReservationModal
        open={addOpen}
        onClose={() => setAddOpen(false)}
        tripId={tripId}
        members={data.members}
        defaultCurrency={data.trip.homeCurrency}
      />
    </div>
  );
}
