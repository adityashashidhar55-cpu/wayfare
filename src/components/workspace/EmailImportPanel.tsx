import { useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  BedDouble,
  Car,
  Check,
  CircleDot,
  Copy,
  Crown,
  Loader2,
  Mail,
  Plane,
  Ticket,
} from "lucide-react";
import { formatMoney } from "@contracts/fx";
import { Button } from "@/components/ui/button";
import { trpc } from "@/providers/trpc";
import { copyText } from "./WorkspaceHeader";
import { isUpgradeRequired } from "./utils";
import type { WsMember } from "./utils";
import { useToast } from "./Toasts";

const SAMPLE_EMAIL = `Subject: Your United Airlines flight confirmation
Confirmation code: X7KQP2
Flight UA 875 · SFO -> KIX
Depart 11:40 Arrive 15:05
Date: 2026-08-07
Total charged: USD 1,284.00`;

const TYPE_META: Record<string, { icon: typeof Plane; label: string }> = {
  flight: { icon: Plane, label: "Flights" },
  lodging: { icon: BedDouble, label: "Stays" },
  car: { icon: Car, label: "Cars" },
  activity: { icon: Ticket, label: "Dining & tickets" },
  other: { icon: CircleDot, label: "Other" },
};

function fmtDate(d: string | null): string | null {
  if (!d) return null;
  return new Date(`${d}T00:00:00`).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
}

/**
 * "Import from email" panel (trip-workspace §2, Voyager): paste a forwarded
 * booking confirmation, optionally name who paid, and the server parses +
 * files it as a reservation. Success shows the extracted fields with a calm
 * check pop; UPGRADE_REQUIRED bubbles up so the tab can swap to the upsell.
 */
export default function EmailImportPanel({
  tripId,
  members,
  importAddress,
  onUpgradeRequired,
}: {
  tripId: number;
  members: WsMember[];
  importAddress: string;
  onUpgradeRequired: () => void;
}) {
  const utils = trpc.useUtils();
  const { push } = useToast();
  const [text, setText] = useState("");
  const [paidById, setPaidById] = useState<number | null>(null);

  const importEmail = trpc.trips.importEmail.useMutation({
    onSuccess: () => {
      utils.trips.get.invalidate({ id: tripId });
      setText("");
      push({ title: "Reservation imported", kind: "success" });
    },
    onError: e => {
      if (isUpgradeRequired(e)) {
        onUpgradeRequired();
      } else {
        push({
          title: "Could not import that email",
          description: e.message,
          kind: "danger",
        });
      }
    },
  });

  const parsed = importEmail.data?.parsed ?? null;
  const meta = parsed ? (TYPE_META[parsed.type] ?? TYPE_META.other)! : null;
  const payerName = parsed
    ? (members.find(m => m.id === importEmail.variables?.paidById)?.name ?? null)
    : null;
  const dates = parsed
    ? ([fmtDate(parsed.startDate), fmtDate(parsed.endDate)]
        .filter(Boolean)
        .join(" – ") || null)
    : null;

  return (
    <div className="glass mt-4 rounded-lg border border-border p-4 shadow-sm">
      <div className="flex flex-wrap items-center gap-2">
        <Mail className="h-4 w-4 shrink-0 text-ink-3" strokeWidth={1.75} />
        <span className="type-h4 text-ink">Import from email</span>
        <span className="type-caption flex items-center gap-1 rounded-pill bg-ochre-soft px-2 py-0.5 font-semibold text-ochre">
          <Crown className="h-3 w-3" strokeWidth={2} /> Voyager
        </span>
        <span className="ml-auto flex items-center gap-1.5">
          <code className="type-caption tnum text-ink-3">{importAddress}</code>
          <button
            type="button"
            aria-label="Copy import address"
            onClick={async () => {
              const ok = await copyText(importAddress);
              push(
                ok
                  ? { title: "Import address copied", kind: "success" }
                  : { title: "Copy failed", kind: "danger" }
              );
            }}
            className="rounded-sm p-1 text-ink-3 transition-colors duration-fast hover:bg-surface-2 hover:text-ink"
          >
            <Copy className="h-3.5 w-3.5" strokeWidth={1.75} />
          </button>
        </span>
      </div>
      <p className="type-caption mt-1 text-ink-3">
        Forward confirmations to your import address, or paste one here and
        we’ll file it automatically.
      </p>

      <textarea
        value={text}
        onChange={e => {
          setText(e.target.value);
          if (importEmail.data) importEmail.reset();
        }}
        rows={4}
        placeholder="Paste a forwarded confirmation email…"
        aria-label="Paste a forwarded confirmation email"
        className="type-small mt-3 w-full resize-none rounded-md border border-border-strong bg-surface px-3 py-2 text-ink placeholder:text-ink-3 focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/40"
      />

      <div className="mt-2.5 flex flex-wrap items-center gap-2">
        <select
          value={paidById ?? ""}
          onChange={e =>
            setPaidById(e.target.value ? Number(e.target.value) : null)
          }
          aria-label="Who paid"
          className="type-small h-9 rounded-md border border-border-strong bg-surface px-2.5 text-ink focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/40"
        >
          <option value="">Who paid? (optional)</option>
          {members.map(m => (
            <option key={m.id} value={m.id}>
              {m.name}
            </option>
          ))}
        </select>
        <Button
          size="sm"
          disabled={text.trim().length < 20 || importEmail.isPending}
          onClick={() =>
            importEmail.mutate({
              tripId,
              text: text.trim(),
              paidById: paidById ?? undefined,
            })
          }
        >
          {importEmail.isPending ? (
            <Loader2 className="h-4 w-4 animate-spin" strokeWidth={2} />
          ) : (
            <Mail className="h-4 w-4" strokeWidth={1.75} />
          )}
          {importEmail.isPending ? "Parsing…" : "Import"}
        </Button>
        <button
          type="button"
          onClick={() => {
            setText(SAMPLE_EMAIL);
            if (importEmail.data) importEmail.reset();
          }}
          className="type-small font-semibold text-brand transition-colors duration-fast hover:text-brand-strong"
        >
          Try a sample
        </button>
      </div>

      {/* parsed result, calm check pop, fields exactly as filed */}
      <AnimatePresence>
        {parsed && meta && (
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.28, ease: [0.22, 1, 0.36, 1] }}
            className="mt-3 flex items-center gap-3 rounded-md border border-pine/30 bg-pine-soft p-3"
          >
            <motion.span
              initial={{ scale: 0.4 }}
              animate={{ scale: 1 }}
              transition={{ type: "spring", stiffness: 500, damping: 28 }}
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-surface text-pine shadow-sm"
            >
              <Check className="h-4 w-4" strokeWidth={2.5} />
            </motion.span>
            <span className="min-w-0 flex-1">
              <span className="flex flex-wrap items-center gap-2">
                <meta.icon
                  className="h-4 w-4 shrink-0 text-ink-3"
                  strokeWidth={1.75}
                />
                <span className="truncate text-[14px] font-semibold text-ink">
                  {parsed.title}
                </span>
                {parsed.confirmationCode ? (
                  <span className="type-caption tnum rounded-sm bg-surface px-1.5 py-0.5 text-ink-2">
                    #{parsed.confirmationCode}
                  </span>
                ) : null}
              </span>
              <span className="type-caption mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-ink-3">
                {parsed.provider ? <span>{parsed.provider}</span> : null}
                {dates ? <span>· {dates}</span> : null}
                {parsed.amountCents != null && parsed.currency ? (
                  <span className="tnum font-semibold text-ink-2">
                    · {formatMoney(parsed.amountCents, parsed.currency)}
                  </span>
                ) : null}
                {payerName ? <span>· Paid by {payerName}</span> : null}
              </span>
            </span>
            <span className="type-caption shrink-0 rounded-pill bg-surface px-2 py-0.5 font-semibold text-pine">
              Filed in {meta.label}
            </span>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
