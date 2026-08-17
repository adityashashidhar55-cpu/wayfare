import { useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  AlertTriangle,
  BedDouble,
  CalendarCheck2,
  CalendarClock,
  Car,
  CircleDot,
  Copy,
  Crown,
  Inbox,
  Loader2,
  Mail,
  MapPin,
  Plane,
  Ticket,
  TrainFront,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { trpc } from "@/providers/trpc";
import { copyText } from "./WorkspaceHeader";
import { isUpgradeRequired } from "./utils";
import { useToast } from "./Toasts";

const SAMPLE_EMAILS = `Subject: Your United Airlines flight confirmation
United Airlines eTicket Itinerary
Confirmation code: X7KQP2
Flight UA 875
Departs: San Francisco (SFO) 11:40 AM, Friday, August 7, 2026
Arrives: Osaka Kansai (KIX) 3:05 PM
Total charged: USD 1,284.00
---
Subject: Reservation confirmed - You're going to Kyoto!
You're staying at Machiya Guesthouse Rojiura
Address: 541-2 Gojocho, Shimogyo Ward, Kyoto, Japan
Check-in: August 7, 2026 3:00 PM
Check-out: August 12, 2026 11:00 AM
Confirmation code: HMKX9TQ4WD`;

const KIND_META: Record<string, { icon: typeof Plane; label: string }> = {
  flight: { icon: Plane, label: "Flight" },
  train: { icon: TrainFront, label: "Train" },
  lodging: { icon: BedDouble, label: "Stay" },
  car: { icon: Car, label: "Car" },
  activity: { icon: Ticket, label: "Activity" },
  other: { icon: CircleDot, label: "Other" },
};

/** Split a bulk paste into individual emails on lines of 3+ dashes. */
function splitEmails(raw: string): string[] {
  return raw
    .split(/^\s*-{3,}\s*$/m)
    .map(s => s.trim())
    .filter(s => s.length >= 20);
}

function fmtDate(d: string | null): string | null {
  if (!d) return null;
  return new Date(`${d}T00:00:00`).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
}

const CHIP =
  "type-caption inline-flex shrink-0 items-center gap-1 rounded-pill px-2 py-0.5 font-semibold";

/**
 * "Import from email" (Voyager): paste one or many forwarded booking
 * confirmations (flight / train / stay / car / activity), and the server
 * files them as reservations AND lays stays/cars/activities out on the trip
 * calendar (trip days) and map (geocoded stops). The forwarding address card
 * shows the user's unique inbound address for real email forwarding.
 */
export default function BookingEmailImport({
  tripId,
  onUpgradeRequired,
}: {
  tripId: number;
  onUpgradeRequired: () => void;
}) {
  const utils = trpc.useUtils();
  const { push } = useToast();
  const [text, setText] = useState("");
  const inbound = trpc.bookings.myInboundEmail.useQuery();

  const importEmails = trpc.bookings.parseBookingEmails.useMutation({
    onSuccess: data => {
      utils.trips.get.invalidate({ id: tripId });
      if (data.imported.length) {
        push({
          title: `Imported ${data.imported.length} booking${data.imported.length > 1 ? "s" : ""}`,
          kind: "success",
        });
      }
      setText("");
    },
    onError: e => {
      if (isUpgradeRequired(e)) {
        onUpgradeRequired();
      } else {
        push({
          title: "Could not import those emails",
          description: e.message,
          kind: "danger",
        });
      }
    },
  });

  const result = importEmails.data ?? null;
  const emailCount = splitEmails(text).length;

  return (
    <>
      {/* ── forwarding address card ── */}
      <div className="mt-4 flex flex-wrap items-center gap-3 rounded-lg border border-border bg-surface p-4 shadow-sm">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-surface-2 text-ink-2">
          <Inbox className="h-4 w-4" strokeWidth={1.75} />
        </span>
        <div className="min-w-0 flex-1">
          <p className="type-small font-semibold text-ink">
            Your forwarding address
          </p>
          <p className="type-caption mt-0.5 leading-relaxed text-ink-3">
            {inbound.data?.note ??
              "Forward confirmations here and they appear on this trip."}
          </p>
        </div>
        <span className="flex items-center gap-1.5">
          <code className="type-caption tnum truncate rounded-md bg-surface-2 px-2.5 py-1.5 text-ink">
            {inbound.data?.address ?? "…"}
          </code>
          <button
            type="button"
            aria-label="Copy forwarding address"
            disabled={!inbound.data}
            onClick={async () => {
              if (!inbound.data) return;
              const ok = await copyText(inbound.data.address);
              push(
                ok
                  ? { title: "Forwarding address copied", kind: "success" }
                  : { title: "Copy failed", kind: "danger" }
              );
            }}
            className="rounded-sm p-1.5 text-ink-3 transition-colors duration-fast hover:bg-surface-2 hover:text-ink"
          >
            <Copy className="h-3.5 w-3.5" strokeWidth={1.75} />
          </button>
        </span>
      </div>

      {/* ── bulk paste import card ── */}
      <div className="glass mt-3 rounded-lg border border-border p-4 shadow-sm">
        <div className="flex flex-wrap items-center gap-2">
          <Mail className="h-4 w-4 shrink-0 text-ink-3" strokeWidth={1.75} />
          <span className="type-h4 text-ink">Import from email</span>
          <span className="type-caption flex items-center gap-1 rounded-pill bg-ochre-soft px-2 py-0.5 font-semibold text-ochre">
            <Crown className="h-3 w-3" strokeWidth={2} /> Voyager
          </span>
        </div>
        <p className="type-caption mt-1 leading-relaxed text-ink-3">
          Paste one or more forwarded confirmations, flights, trains, stays,
          cars, tours. Separate multiple emails with a line of{" "}
          <code className="tnum text-ink-2">---</code>. Stays, cars and
          activities also land on your calendar and map.
        </p>

        <textarea
          value={text}
          onChange={e => {
            setText(e.target.value);
            if (importEmails.data) importEmails.reset();
          }}
          rows={6}
          placeholder={
            "Subject: Your flight confirmation\n…\n---\nSubject: Reservation confirmed\n…"
          }
          aria-label="Paste one or more forwarded confirmation emails"
          className="type-small mt-3 w-full resize-none rounded-md border border-border-strong bg-surface px-3 py-2 text-ink placeholder:text-ink-3 focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/40"
        />

        <div className="mt-2.5 flex flex-wrap items-center gap-2">
          <Button
            size="sm"
            disabled={emailCount === 0 || importEmails.isPending}
            onClick={() =>
              importEmails.mutate({ tripId, texts: splitEmails(text) })
            }
          >
            {importEmails.isPending ? (
              <Loader2 className="h-4 w-4 animate-spin" strokeWidth={2} />
            ) : (
              <Mail className="h-4 w-4" strokeWidth={1.75} />
            )}
            {importEmails.isPending
              ? "Parsing…"
              : emailCount > 1
                ? `Parse & import ${emailCount} emails`
                : "Parse & import"}
          </Button>
          <button
            type="button"
            onClick={() => {
              setText(SAMPLE_EMAILS);
              if (importEmails.data) importEmails.reset();
            }}
            className="type-small font-semibold text-brand transition-colors duration-fast hover:text-brand-strong"
          >
            Try samples
          </button>
        </div>

        {/* results: imported items with placement chips + failures w/ reasons */}
        <AnimatePresence>
          {result && (
            <motion.ul
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -4 }}
              transition={{ duration: 0.28, ease: [0.22, 1, 0.36, 1] }}
              className="mt-3 space-y-2"
            >
              {result.imported.map(item => {
                const meta = KIND_META[item.kind] ?? KIND_META.other!;
                return (
                  <motion.li
                    key={`ok-${item.index}`}
                    initial={{ opacity: 0, y: 6 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="flex items-center gap-3 rounded-md border border-pine/30 bg-pine-soft p-3"
                  >
                    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-surface text-pine shadow-sm">
                      <meta.icon className="h-4 w-4" strokeWidth={1.75} />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[14px] font-semibold text-ink">
                        {item.title}
                      </span>
                      <span className="type-caption text-ink-3">
                        {meta.label}
                        {item.date ? ` · ${fmtDate(item.date)}` : ""}
                      </span>
                    </span>
                    <span className="flex shrink-0 flex-wrap items-center justify-end gap-1">
                      {item.placed ? (
                        item.nearestDay ? (
                          <span
                            className={`${CHIP} bg-ochre-soft text-ochre`}
                            title="Booking date is outside the trip range, placed on the nearest trip day"
                          >
                            <CalendarClock
                              className="h-3 w-3"
                              strokeWidth={2}
                            />
                            Nearest day
                          </span>
                        ) : (
                          <span className={`${CHIP} bg-surface text-pine`}>
                            <CalendarCheck2
                              className="h-3 w-3"
                              strokeWidth={2}
                            />
                            On calendar
                          </span>
                        )
                      ) : null}
                      {item.geocoded ? (
                        <span className={`${CHIP} bg-info/10 text-info`}>
                          <MapPin className="h-3 w-3" strokeWidth={2} />
                          On map
                        </span>
                      ) : null}
                      {!item.placed && !item.geocoded ? (
                        <span className={`${CHIP} bg-surface-2 text-ink-3`}>
                          Listed only
                        </span>
                      ) : null}
                    </span>
                  </motion.li>
                );
              })}
              {result.failed.map(f => (
                <li
                  key={`fail-${f.index}`}
                  className="flex items-center gap-3 rounded-md border border-danger/30 bg-danger/5 p-3"
                >
                  <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-surface text-danger shadow-sm">
                    <AlertTriangle className="h-4 w-4" strokeWidth={1.75} />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-[14px] font-semibold text-ink">
                      Email {f.index + 1} couldn't be imported
                    </span>
                    <span className="type-caption text-ink-3">{f.reason}</span>
                  </span>
                </li>
              ))}
            </motion.ul>
          )}
        </AnimatePresence>
      </div>
    </>
  );
}
