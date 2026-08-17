import { useState } from "react";
import {
  Activity,
  ChevronDown,
  CloudLightning,
  ExternalLink,
  Flame,
  HeartPulse,
  Mountain,
  ShieldCheck,
  Sun,
  Tornado,
  Waves,
} from "lucide-react";
import { trpc } from "@/providers/trpc";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import type {
  NaturalEvent,
  Tone,
  TravelGuidance,
} from "../../../api/safety-router";

/* ── Tone → color + short label (design tokens: pine/ochre + orange/red) ── */

const TONE_DOT: Record<Tone, string> = {
  normal: "bg-pine",
  caution: "bg-ochre",
  warning: "bg-orange-600",
  avoid: "bg-red-600",
};
const TONE_TEXT: Record<Tone, string> = {
  normal: "text-pine",
  caution: "text-ochre",
  warning: "text-orange-700",
  avoid: "text-red-700",
};
const LEVEL_SHORT: Record<number, string> = {
  1: "Normal precautions",
  2: "Increased caution",
  3: "Reconsider travel",
  4: "Do not travel",
};

const EVENT_ICON: Record<
  NaturalEvent["kind"],
  typeof Activity
> = {
  earthquake: Activity,
  cyclone: Tornado,
  flood: Waves,
  volcano: Mountain,
  drought: Sun,
  wildfire: Flame,
  other: CloudLightning,
};

const SEVERITY_DOT: Record<NaturalEvent["severity"], string> = {
  Red: "bg-red-500",
  Orange: "bg-orange-500",
  Green: "bg-emerald-500",
};

/** "today" / "yesterday" / "5d ago" / ISO fallback for older dates. */
function relDate(iso: string): string {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return iso;
  const d = Math.floor((Date.now() - t) / 86_400_000);
  if (d <= 0) return "today";
  if (d === 1) return "yesterday";
  if (d < 30) return `${d}d ago`;
  return iso;
}

function SectionTitle({
  icon: Icon,
  title,
  source,
}: {
  icon: typeof Activity;
  title: string;
  source: string;
}) {
  return (
    <div className="flex items-baseline justify-between gap-2">
      <p className="type-small flex items-center gap-1.5 font-semibold text-ink">
        <Icon className="h-3.5 w-3.5 text-ink-3" strokeWidth={1.75} />
        {title}
      </p>
      <span className="type-caption shrink-0 text-ink-3">{source}</span>
    </div>
  );
}

function UnavailableLine() {
  return (
    <p className="type-caption mt-1.5 italic text-ink-3">
      temporarily unavailable
    </p>
  );
}

function AdvisorySection({ data }: { data: TravelGuidance }) {
  const down = data.unavailable.includes("US State Dept");
  return (
    <section>
      <SectionTitle icon={ShieldCheck} title="Government advisory" source="US State Dept" />
      {down ? (
        <UnavailableLine />
      ) : data.advisory ? (
        <div className="mt-1.5 rounded-md border border-border bg-surface-2 px-3 py-2.5">
          <div className="flex items-center gap-2">
            <span
              className={cn("h-2.5 w-2.5 shrink-0 rounded-full", TONE_DOT[data.overallTone])}
              aria-hidden
            />
            <span className={cn("type-small font-semibold", TONE_TEXT[data.overallTone])}>
              Level {data.advisory.level} · {data.advisory.levelLabel}
            </span>
          </div>
          <p className="type-caption mt-1 leading-relaxed text-ink-2">
            {data.advisory.summary}
          </p>
          <p className="type-caption mt-1.5 text-ink-3">
            {data.advisory.updated ? `Updated ${data.advisory.updated}` : "Update date unknown"}
            {data.advisory.url ? (
              <>
                {" · "}
                <a
                  href={data.advisory.url}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-0.5 text-brand hover:underline"
                >
                  Full advisory <ExternalLink className="h-3 w-3" />
                </a>
              </>
            ) : null}
          </p>
        </div>
      ) : (
        <p className="type-caption mt-1.5 text-ink-3">
          No advisory published for this destination.
        </p>
      )}
    </section>
  );
}

function EventsSection({ data }: { data: TravelGuidance }) {
  const down = data.unavailable.includes("GDACS");
  return (
    <section>
      <SectionTitle icon={CloudLightning} title="Natural events" source="GDACS" />
      {down ? (
        <UnavailableLine />
      ) : data.events.length === 0 ? (
        <p className="type-caption mt-1.5 text-ink-3">
          No significant events in the last 60 days.
        </p>
      ) : (
        <ul className="mt-1.5 space-y-1.5">
          {data.events.slice(0, 5).map((e, i) => {
            const Icon = EVENT_ICON[e.kind] ?? CloudLightning;
            return (
              <li key={`${e.title}-${i}`} className="flex items-start gap-2">
                <Icon className="mt-0.5 h-3.5 w-3.5 shrink-0 text-ink-3" strokeWidth={1.75} />
                <span className="min-w-0 flex-1">
                  <span className="type-caption flex items-center gap-1.5 text-ink">
                    <span
                      className={cn("h-1.5 w-1.5 shrink-0 rounded-full", SEVERITY_DOT[e.severity])}
                      aria-hidden
                    />
                    <span className="truncate" title={e.title}>
                      {e.title}
                    </span>
                  </span>
                  <span className="type-caption text-ink-3">
                    {e.severity} · {relDate(e.date)}
                    {e.distanceKm != null ? ` · ${e.distanceKm} km away` : ""}
                  </span>
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

function HealthSection({ data }: { data: TravelGuidance }) {
  const down = data.unavailable.includes("WHO via ReliefWeb");
  return (
    <section>
      <SectionTitle icon={HeartPulse} title="Health notices" source="WHO via ReliefWeb" />
      {down ? (
        <UnavailableLine />
      ) : data.health.length === 0 ? (
        <p className="type-caption mt-1.5 text-ink-3">
          No recent public-health notices.
        </p>
      ) : (
        <ul className="mt-1.5 space-y-2">
          {data.health.slice(0, 4).map((h, i) => (
            <li key={`${h.title}-${i}`}>
              <p className="type-caption font-medium leading-snug text-ink">
                {h.url ? (
                  <a
                    href={h.url}
                    target="_blank"
                    rel="noreferrer"
                    className="hover:text-brand hover:underline"
                  >
                    {h.title}
                  </a>
                ) : (
                  h.title
                )}
              </p>
              <p className="type-caption text-ink-3">
                {relDate(h.date)} · {h.source}
              </p>
              {h.snippet ? (
                <p className="type-caption mt-0.5 line-clamp-2 leading-snug text-ink-2">
                  {h.snippet}
                </p>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/** Shared body: loading/error states + the three feed sections. */
function GuidanceSections({
  data,
  loading,
  isError,
}: {
  data: TravelGuidance | undefined;
  loading: boolean;
  isError: boolean;
}) {
  if (loading) {
    return (
      <p className="type-caption text-ink-3">Checking official sources…</p>
    );
  }
  if (isError) {
    return (
      <p className="type-caption text-ink-3">
        Travel guidance is temporarily unavailable.
      </p>
    );
  }
  if (!data) return null;
  return (
    <>
      <AdvisorySection data={data} />
      <EventsSection data={data} />
      <HealthSection data={data} />
    </>
  );
}

const SOURCES_FOOTER =
  "Sources: US State Dept, GDACS, WHO via ReliefWeb, always confirm with official government guidance before travel.";

export type SafetyCardVariant = "popover" | "compact" | "full";

/**
 * "Travel guidance" indicator for the workspace header: colored dot by
 * overall tone + the State Dept level, aggregating the official public feeds
 * (US State Dept advisories, GDACS natural events, WHO via ReliefWeb health
 * notices). Every section degrades independently - a blocked feed shows
 * "temporarily unavailable", never invented data.
 *
 * Variants:
 * - "popover" (default): standalone pill that expands into its own popover.
 * - "compact": passive mini-pill (dot + short label) for the consolidated
 *   insights row - expansion is owned by the parent "Details" disclosure.
 * - "full": the complete card rendered inline for the insights disclosure.
 */
export default function SafetyCard({
  tripId,
  variant = "popover",
}: {
  tripId: number;
  variant?: SafetyCardVariant;
}) {
  const [open, setOpen] = useState(false);
  const q = trpc.safety.tripAdvisory.useQuery(
    { tripId },
    { staleTime: 6 * 60 * 60 * 1000, retry: 1, refetchOnWindowFocus: false }
  );

  const data = q.data;
  const loading = q.isLoading;

  // Pill state ------------------------------------------------------------
  let dot = "bg-ink-3/40";
  let label = "Checking guidance…";
  let labelClass = "text-ink-3";
  let shortLabel = label;
  if (!loading && data) {
    if (data.advisory?.level != null) {
      dot = TONE_DOT[data.overallTone];
      const where = data.resolvedCountry ?? data.country;
      const level = `Level ${data.advisory.level} · ${LEVEL_SHORT[data.advisory.level] ?? data.advisory.levelLabel}`;
      // Advisory is issued per COUNTRY - surface it ("Japan - Level 1 · …").
      label = where ? `${where}: ${level}` : level;
      shortLabel = `Level ${data.advisory.level}`;
      labelClass = TONE_TEXT[data.overallTone];
    } else if (data.unavailable.includes("US State Dept")) {
      dot = "bg-ink-3/40";
      label = "Guidance unavailable";
      shortLabel = label;
      labelClass = "text-ink-3";
    } else {
      dot = "bg-pine";
      label = "No advisory found";
      shortLabel = label;
      labelClass = "text-ink-3";
    }
  } else if (q.isError) {
    label = "Guidance unavailable";
    shortLabel = label;
  }

  const dotEl = (
    <span className="relative flex h-2 w-2">
      {loading ? (
        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-ink-3/40" />
      ) : null}
      <span className={cn("relative inline-flex h-2 w-2 rounded-full", dot)} />
    </span>
  );

  /* Passive mini-pill for the consolidated insights row. */
  if (variant === "compact") {
    return (
      <span
        className="inline-flex shrink-0 items-center gap-1.5 rounded-pill bg-surface-2 px-2 py-0.5"
        title={`Travel guidance: ${label}`}
      >
        {dotEl}
        <span className={cn("type-caption font-semibold", labelClass)}>
          {shortLabel}
        </span>
      </span>
    );
  }

  /* Full card rendered inline inside the insights disclosure. */
  if (variant === "full") {
    return (
      <section>
        <div className="flex items-baseline justify-between gap-2">
          <p className="type-small flex items-center gap-1.5 font-semibold text-ink">
            <ShieldCheck
              className="h-3.5 w-3.5 text-ink-3"
              strokeWidth={1.75}
            />
            Travel guidance
          </p>
          {data?.country ? (
            <span className="type-caption shrink-0 text-ink-3">
              {data.country}
            </span>
          ) : null}
        </div>
        <div className="mt-2 space-y-4">
          <GuidanceSections data={data} loading={loading} isError={q.isError} />
        </div>
        <p className="type-caption mt-3 leading-relaxed text-ink-3">
          {SOURCES_FOOTER}
        </p>
      </section>
    );
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label="Travel guidance for this destination"
          className="inline-flex shrink-0 items-center gap-1.5 rounded-pill border border-border bg-surface px-2 py-0.5 transition-colors duration-fast hover:bg-surface-2"
        >
          {dotEl}
          <span className={cn("type-caption font-semibold", labelClass)}>{label}</span>
          <ChevronDown
            className={cn("h-3 w-3 text-ink-3 transition-transform duration-fast", open && "rotate-180")}
          />
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-[380px] rounded-xl p-0">
        <div className="border-b border-border px-4 py-3">
          <p className="type-h4 flex items-center gap-2 text-ink">
            <ShieldCheck className="h-4 w-4 text-ink-3" strokeWidth={1.75} />
            Travel guidance
          </p>
          {data?.resolvedCountry ?? data?.country ? (
            <p className="type-caption mt-0.5 text-ink-3">
              {data.resolvedCountry ?? data.country}
              {data.destinationIsCity ? (
                <span className="italic"> · Countrywide guidance</span>
              ) : null}
            </p>
          ) : null}
        </div>

        <div className="max-h-[55vh] space-y-4 overflow-y-auto px-4 py-3">
          <GuidanceSections data={data} loading={loading} isError={q.isError} />
        </div>

        <div className="border-t border-border px-4 py-2.5">
          <p className="type-caption leading-relaxed text-ink-3">
            {SOURCES_FOOTER}
          </p>
        </div>
      </PopoverContent>
    </Popover>
  );
}
