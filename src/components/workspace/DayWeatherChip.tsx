import {
  Cloud,
  CloudDrizzle,
  CloudFog,
  CloudLightning,
  CloudRain,
  CloudRainWind,
  CloudSnow,
  CloudSun,
  Droplet,
  Sun,
  type LucideIcon,
} from "lucide-react";
import { trpc } from "@/providers/trpc";

/** Icon strings emitted by api/lib/weather.ts weatherLabel(). */
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

export const CLIMATE_TOOLTIP =
  "Typical climate for this date, exact forecast available 16 days out";

/**
 * Day-header weather chip - hi/lo temps, rain amount when ≥1 mm. Days past
 * the 16-day forecast horizon show climate normals, prefixed "~" and with a
 * tooltip saying so. Shares the trip-level tripWeather query (deduped by
 * react-query), so a whole itinerary costs one fetch. Renders nothing when
 * the day has no weather data.
 */
export default function DayWeatherChip({
  tripId,
  dayId,
}: {
  tripId: number;
  dayId: number;
}) {
  const q = trpc.weather.tripWeather.useQuery(
    { tripId },
    { staleTime: 30 * 60_000 }
  );
  const row = q.data?.rows.find(r => r.dayId === dayId);
  if (!row?.available || row.tmaxC == null || row.tminC == null) return null;

  const Icon = WEATHER_ICONS[row.icon ?? "cloud"] ?? Cloud;
  const tooltip = row.approximate
    ? CLIMATE_TOOLTIP
    : `${row.label ?? "Weather"} forecast for this date`;

  return (
    <span
      className="type-caption tnum inline-flex shrink-0 items-center gap-1 rounded-pill bg-surface-2 px-2 py-0.5 text-ink-3"
      title={tooltip}
    >
      <Icon className="h-3 w-3" strokeWidth={1.75} aria-hidden />
      <span>
        {row.approximate ? "~" : ""}
        {Math.round(row.tmaxC)}°/{Math.round(row.tminC)}°
      </span>
      {(row.precipMm ?? 0) >= 1 ? (
        <span className="inline-flex items-center gap-0.5">
          <Droplet className="h-3 w-3" strokeWidth={1.75} aria-hidden />
          {Math.round(row.precipMm!)}mm
        </span>
      ) : null}
    </span>
  );
}
