import { useMemo, useState } from "react";
import { Link, useParams } from "react-router";
import {
  ArrowLeft,
  Check,
  CheckCircle2,
  Copy,
  ExternalLink,
  Printer,
  Wallet,
} from "lucide-react";
import { toast } from "sonner";
import { formatMoney, formatMoneyCompact } from "@contracts/fx";
import { trpc } from "@/providers/trpc";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { bookingsSummary } from "@/lib/booking-links";
import { convertCents } from "@/lib/day-cost";
import { copyText } from "@/components/workspace/WorkspaceHeader";
import { StopBookMenu } from "@/components/workspace/StopCard";
import { cn } from "@/lib/utils";
import type { WsStop } from "@/components/workspace/utils";
import { dayLabel } from "@/components/workspace/utils";

/**
 * r24-core (G): the "Wayfare booking channel" - one honest view of every
 * bookable stop: what is booked (with the pasted confirmation link), what is
 * still pending, approx value vs budget, and copy/print export. Bookings
 * themselves happen on provider sites; Wayfare tracks state, not payments.
 */
export default function TripBookings() {
  const { id: idParam } = useParams();
  const tripId = Number(idParam);
  const { data, isLoading } = trpc.trips.get.useQuery(
    { id: tripId },
    { enabled: Number.isFinite(tripId), retry: 1 }
  );
  const pricesQ = trpc.explore.stopPrices.useQuery(
    { tripId },
    { enabled: Number.isFinite(tripId), staleTime: 60_000 }
  );
  const [copied, setCopied] = useState(false);

  const orderedDays = useMemo(
    () => [...(data?.days ?? [])].sort((a, b) => a.position - b.position),
    [data?.days]
  );
  const dayLabelFor = useMemo(() => {
    const idx = new Map(orderedDays.map((d, i) => [d.id, i]));
    return (s: WsStop) =>
      s.dayId != null && idx.has(s.dayId) ? dayLabel(idx.get(s.dayId)!) : "Unscheduled";
  }, [orderedDays]);

  if (!Number.isFinite(tripId) || (!isLoading && !data)) {
    return (
      <div className="flex min-h-[60dvh] flex-col items-center justify-center gap-3 px-6 text-center">
        <h1 className="type-h2 text-ink">Trip not found</h1>
        <Link to="/trips" className="type-small font-semibold text-brand">
          Back to your trips
        </Link>
      </div>
    );
  }
  if (isLoading || !data) {
    return (
      <div className="mx-auto max-w-[860px] space-y-3 px-4 py-8 md:px-6">
        <Skeleton className="h-8 w-56" />
        <Skeleton className="h-24 w-full rounded-lg" />
        <Skeleton className="h-24 w-full rounded-lg" />
      </div>
    );
  }

  const currency = data.trip.homeCurrency || "USD";
  const stops = [...data.stops].sort((a, b) => {
    const da = a.dayId ?? 1e9;
    const db = b.dayId ?? 1e9;
    return da - db || a.position - b.position;
  });
  const booked = stops.filter(s => s.bookedAt != null);
  const pending = stops.filter(s => s.bookedAt == null);

  /* approx value of booked items (matched prices + chosen legs), home currency */
  const priceByStop = new Map((pricesQ.data?.prices ?? []).map(p => [p.stopId, p]));
  const bookedValueCents = booked.reduce((sum, s) => {
    const p = priceByStop.get(s.id);
    const price =
      p?.category === "food" || s.category === "food"
        ? (p?.mealCents ?? 0)
        : (p?.feeCents ?? 0);
    return (
      sum +
      convertCents(price, p?.feeCurrency ?? currency, currency) +
      (s.transportCents ?? 0)
    );
  }, 0);
  const budgetHome = data.trip.budgetCents
    ? convertCents(data.trip.budgetCents, data.trip.budgetCurrency || currency, currency)
    : 0;

  const exportSummary = async () => {
    const ok = await copyText(
      bookingsSummary(
        data.trip.title,
        stops.map(s => ({
          name: s.name,
          dayLabel: dayLabelFor(s),
          booked: s.bookedAt != null,
          bookingUrl: s.bookingUrl,
        }))
      )
    );
    if (ok) {
      setCopied(true);
      toast.success("Summary copied to clipboard");
      setTimeout(() => setCopied(false), 1600);
    } else {
      toast.error("Could not copy, try selecting the text instead");
    }
  };

  return (
    <div className="mx-auto max-w-[860px] px-4 py-6 md:px-6 print:max-w-none">
      {/* header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <Link
            to={`/trips/${tripId}`}
            aria-label="Back to workspace"
            className="flex h-9 w-9 items-center justify-center rounded-full border border-border text-ink-2 transition-colors duration-fast hover:border-border-strong hover:text-ink print:hidden"
          >
            <ArrowLeft className="h-4 w-4" strokeWidth={1.75} />
          </Link>
          <div className="min-w-0">
            <h1 className="type-h2 truncate text-ink">
              Bookings · {data.trip.title}
            </h1>
            <p className="type-caption text-ink-3">
              Track what is reserved. Booking happens on the provider sites,
              Wayfare keeps the record.
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2 print:hidden">
          <Button variant="ghost" onClick={exportSummary}>
            {copied ? (
              <Check className="h-4 w-4 text-pine" strokeWidth={2} />
            ) : (
              <Copy className="h-4 w-4" strokeWidth={1.75} />
            )}
            Copy summary
          </Button>
          <Button variant="ghost" onClick={() => window.print()}>
            <Printer className="h-4 w-4" strokeWidth={1.75} />
            Print / PDF
          </Button>
        </div>
      </div>

      {/* totals strip */}
      <div className="mt-4 flex flex-wrap items-center gap-2">
        <span className="type-small inline-flex items-center gap-1.5 rounded-pill bg-pine-soft px-3 py-1.5 font-semibold text-pine">
          <CheckCircle2 className="h-4 w-4" strokeWidth={2} />
          {booked.length} of {stops.length} booked
        </span>
        <span className="type-small tnum inline-flex items-center gap-1.5 rounded-pill bg-surface-2 px-3 py-1.5 font-semibold text-ink-2">
          <Wallet className="h-4 w-4" strokeWidth={1.75} />≈{" "}
          {formatMoneyCompact(bookedValueCents, currency)} booked value
          {budgetHome > 0 ? (
            <span className="font-normal text-ink-3">
              {" "}
              of {formatMoneyCompact(budgetHome, currency)} budget
            </span>
          ) : null}
        </span>
      </div>

      {/* booked */}
      <section className="mt-6">
        <h2 className="type-eyebrow text-ink-3">Booked</h2>
        {booked.length === 0 ? (
          <p className="type-small mt-2 rounded-lg border border-dashed border-border p-4 text-ink-3">
            Nothing marked booked yet. Open a stop's Book menu in the workspace
            once you have reserved it.
          </p>
        ) : (
          <ul className="mt-2 space-y-2">
            {booked.map(s => (
              <BookingRow
                key={s.id}
                stop={s}
                dayLabel={dayLabelFor(s)}
                booked
                currency={currency}
              />
            ))}
          </ul>
        )}
      </section>

      {/* pending */}
      <section className="mt-6">
        <h2 className="type-eyebrow text-ink-3">Pending</h2>
        {pending.length === 0 ? (
          <p className="type-small mt-2 rounded-lg border border-dashed border-border p-4 text-ink-3">
            Everything on this trip is booked. Nice.
          </p>
        ) : (
          <ul className="mt-2 space-y-2">
            {pending.map(s => (
              <BookingRow
                key={s.id}
                stop={s}
                dayLabel={dayLabelFor(s)}
                booked={false}
                currency={currency}
              />
            ))}
          </ul>
        )}
      </section>

      <p className="type-caption mt-6 text-ink-3">
        Approx values use average local prices, the confirmation link you paste
        is the source of truth.
      </p>
    </div>
  );
}

function BookingRow({
  stop,
  dayLabel: day,
  booked,
  currency,
}: {
  stop: WsStop;
  dayLabel: string;
  booked: boolean;
  currency: string;
}) {
  return (
    <li className="flex items-center gap-3 rounded-lg border border-border bg-surface p-3">
      <span
        className={cn(
          "flex h-8 w-8 shrink-0 items-center justify-center rounded-full",
          booked ? "bg-pine-soft text-pine" : "bg-surface-2 text-ink-3"
        )}
      >
        {booked ? (
          <CheckCircle2 className="h-4 w-4" strokeWidth={2} />
        ) : (
          <ExternalLink className="h-4 w-4" strokeWidth={1.75} />
        )}
      </span>
      <span className="min-w-0 flex-1">
        <span className="type-small block truncate font-semibold text-ink">
          {stop.name}
        </span>
        <span className="type-caption flex flex-wrap items-center gap-1.5 text-ink-3">
          {day}
          {stop.bookingUrl ? (
            <a
              href={stop.bookingUrl}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 font-semibold text-brand hover:underline"
            >
              confirmation
              <ExternalLink className="h-3 w-3" strokeWidth={1.75} />
            </a>
          ) : null}
          {stop.transportCents ? (
            <span className="tnum">
              · leg ≈ {formatMoney(stop.transportCents, currency)}
            </span>
          ) : null}
        </span>
      </span>
      <StopBookMenu stop={stop} />
    </li>
  );
}
