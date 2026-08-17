import { CloudRainWind, Droplet, Info, type LucideIcon } from "lucide-react";
import {
  Cloud,
  CloudDrizzle,
  CloudFog,
  CloudLightning,
  CloudRain,
  CloudSnow,
  CloudSun,
  Sun,
} from "lucide-react";
import { trpc } from "@/providers/trpc";
import { CLIMATE_TOOLTIP } from "./DayWeatherChip";

const WEATHER_ICONS: Record<string, LucideIcon> = {
  sun: Sun,
  "cloud-sun": CloudSun,
  cloud: Cloud,
  "cloud-fog": CloudFog,
  "cloud-drizzle": CloudDrizzle,
  "cloud-rain": CloudRain,
  "cloud-snow": CloudSnow,
  "cloud-showers": CloudRainWind,
  "cloud-lightning": CloudLightning,
};

export type TripWeatherStripVariant = "summary" | "compact" | "full";

/** "Mon, Jan 12" from a YYYY-MM-DD trip-day date (local, locale-formatted). */
function fmtDay(iso: string): string {
  const t = new Date(`${iso}T00:00:00`);
  if (Number.isNaN(t.getTime())) return iso;
  return t.toLocaleDateString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}

/**
 * Trip-subtitle weather - date-range overview ("12–22° · 2 rainy days") plus,
 * when any day sits past the 16-day forecast horizon, a subtle amber "typical
 * climate" notice. Uses the same tripWeather query as the day chips
 * (react-query dedupes). Renders nothing while there is no weather data.
 *
 * Variants:
 * - "summary" (default): the legacy caption line for the trip subtitle.
 * - "compact": a quiet mini-pill for the header insights row.
 * - "full": expanded day-by-day panel content for the insights disclosure.
 */
export default function TripWeatherStrip({
  tripId,
  variant = "summary",
}: {
  tripId: number;
  variant?: TripWeatherStripVariant;
}) {
  const q = trpc.weather.tripWeather.useQuery(
    { tripId },
    { staleTime: 30 * 60_000 }
  );
  const d = q.data;
  if (!d) return null;
  const { summary } = d;
  if (summary.hottestC == null || summary.coldestC == null) return null;

  const anyApproximate = d.rows.some(r => r.available && r.approximate);
  // Icon of the rainiest day (fall back to the first available day).
  const rep =
    [...d.rows]
      .filter(r => r.available)
      .sort((a, b) => (b.precipMm ?? 0) - (a.precipMm ?? 0))[0] ?? null;
  const Icon = rep ? (WEATHER_ICONS[rep.icon ?? "cloud"] ?? Cloud) : Cloud;

  const rangeText = `${anyApproximate ? "~" : ""}${Math.round(
    summary.coldestC
  )}–${Math.round(summary.hottestC)}°`;
  const rainText =
    summary.rainyDays > 0
      ? ` · ${summary.rainyDays} rainy day${summary.rainyDays === 1 ? "" : "s"}`
      : "";

  /* Mini-pill for the consolidated insights row. */
  if (variant === "compact") {
    return (
      <span
        className="type-caption tnum inline-flex shrink-0 items-center gap-1 rounded-pill bg-surface-2 px-2 py-0.5 text-ink-3"
        title={
          anyApproximate ? CLIMATE_TOOLTIP : "Forecast across your trip dates"
        }
      >
        <Icon className="h-3 w-3" strokeWidth={1.75} aria-hidden />
        {rangeText}
        {rainText}
      </span>
    );
  }

  /* Expanded day-by-day breakdown for the insights disclosure. */
  if (variant === "full") {
    const usable = d.rows.filter(
      r => r.available && r.tmaxC != null && r.tminC != null
    );
    return (
      <section>
        <div className="flex items-baseline justify-between gap-2">
          <p className="type-small flex items-center gap-1.5 font-semibold text-ink">
            <Icon className="h-3.5 w-3.5 text-ink-3" strokeWidth={1.75} />
            Weather on your dates
          </p>
          <span className="type-caption tnum shrink-0 text-ink-3">
            {rangeText}
            {rainText}
          </span>
        </div>
        {anyApproximate ? (
          <p className="type-caption mt-1.5 flex items-start gap-1.5 rounded-md bg-ochre-soft px-2.5 py-1.5 text-ochre">
            <Info
              className="mt-0.5 h-3 w-3 shrink-0"
              strokeWidth={1.75}
              aria-hidden
            />
            {CLIMATE_TOOLTIP}
          </p>
        ) : null}
        <ul className="mt-2 space-y-1">
          {usable.map(r => {
            const DayIcon = WEATHER_ICONS[r.icon ?? "cloud"] ?? Cloud;
            return (
              <li
                key={r.dayId}
                className="type-caption flex items-center gap-2 text-ink-2"
              >
                <span className="w-[92px] shrink-0 text-ink-3">
                  {fmtDay(r.date)}
                </span>
                <DayIcon
                  className="h-3.5 w-3.5 shrink-0 text-ink-3"
                  strokeWidth={1.75}
                  aria-hidden
                />
                <span className="min-w-0 flex-1 truncate">
                  {r.label ?? "-"}
                </span>
                <span className="tnum shrink-0">
                  {r.approximate ? "~" : ""}
                  {Math.round(r.tmaxC!)}°/{Math.round(r.tminC!)}°
                </span>
                {(r.precipMm ?? 0) >= 1 ? (
                  <span className="tnum inline-flex w-12 shrink-0 items-center justify-end gap-0.5 text-info">
                    <Droplet
                      className="h-3 w-3"
                      strokeWidth={1.75}
                      aria-hidden
                    />
                    {Math.round(r.precipMm!)}mm
                  </span>
                ) : (
                  <span className="w-12 shrink-0" aria-hidden />
                )}
              </li>
            );
          })}
        </ul>
      </section>
    );
  }

  /* Legacy summary line (default). */
  return (
    <span className="type-caption flex items-center gap-1.5 px-1.5 text-ink-3">
      <span
        className="tnum inline-flex items-center gap-1"
        title={
          anyApproximate
            ? CLIMATE_TOOLTIP
            : "Forecast across your trip dates"
        }
      >
        <Icon className="h-3 w-3" strokeWidth={1.75} aria-hidden />
        {rangeText}
        {rainText}
      </span>
      {anyApproximate ? (
        <span
          className="inline-flex items-center gap-1 rounded-pill bg-ochre-soft px-1.5 py-px text-ochre"
          title={CLIMATE_TOOLTIP}
        >
          <Info className="h-3 w-3" strokeWidth={1.75} aria-hidden />
          Far dates: typical climate shown
        </span>
      ) : null}
    </span>
  );
}
