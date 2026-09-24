/**
 * r34: look at a road trip before it becomes a trip.
 *
 * `roadtrip.previewRoute` (r29) returned the route, the corridor cities and
 * their best places without writing anything, and nothing called it. This is
 * the screen: a route sketch, distance and drive time, the stops in order, and
 * the roadside places between cities that the planner itself never surfaced.
 *
 * The sketch is plain SVG projected from the polyline, not a map widget: it
 * loads instantly inside the dialog, needs no tiles and works offline.
 */
import { useMemo } from 'react';
import { ArrowLeft, Clock, Loader2, MapPin, Mountain, Route, TriangleAlert } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

type Place = {
  id: number;
  name: string;
  category: string;
  description: string | null;
  image: string | null;
};

export type RoutePreviewData = {
  origin: { name: string; lat: number; lng: number };
  dest: { name: string; lat: number; lng: number };
  via: { name: string; lat: number; lng: number }[];
  totalKm: number;
  driveHours: number | null;
  routeEstimated: boolean;
  polyline: [number, number][];
  cities: { name: string; country: string; lat: number; lng: number; routeProgress: number; places: Place[] }[];
  alongTheWay?: (Place & { lat: number; lng: number; detourKm: number })[];
  stylesUsed: string[];
  warnings: string[];
};

const W = 480;
const H = 220;
const PAD = 22;

function useProjection(data: RoutePreviewData) {
  return useMemo(() => {
    const pts = data.polyline.length >= 2 ? data.polyline : [[data.origin.lng, data.origin.lat], [data.dest.lng, data.dest.lat]] as [number, number][];
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (const [lng, lat] of pts) {
      minX = Math.min(minX, lng); maxX = Math.max(maxX, lng);
      minY = Math.min(minY, lat); maxY = Math.max(maxY, lat);
    }
    // Longitude shrinks with latitude; correct so the route is not squashed.
    const k = Math.cos((((minY + maxY) / 2) * Math.PI) / 180) || 1;
    const spanX = Math.max(1e-6, (maxX - minX) * k);
    const spanY = Math.max(1e-6, maxY - minY);
    const scale = Math.min((W - PAD * 2) / spanX, (H - PAD * 2) / spanY);
    const offX = (W - spanX * scale) / 2;
    const offY = (H - spanY * scale) / 2;
    const project = (lng: number, lat: number) => ({
      x: offX + (lng - minX) * k * scale,
      y: H - (offY + (lat - minY) * scale),
    });
    const step = Math.max(1, Math.floor(pts.length / 400));
    const d = pts
      .filter((_, i) => i % step === 0 || i === pts.length - 1)
      .map(([lng, lat], i) => {
        const p = project(lng, lat);
        return `${i === 0 ? 'M' : 'L'}${p.x.toFixed(1)},${p.y.toFixed(1)}`;
      })
      .join(' ');
    return { project, d };
  }, [data]);
}

function Sketch({ data }: { data: RoutePreviewData }) {
  const { project, d } = useProjection(data);
  const o = project(data.origin.lng, data.origin.lat);
  const t = project(data.dest.lng, data.dest.lat);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full rounded-lg border border-border bg-surface-2" role="img"
      aria-label={`Route from ${data.origin.name} to ${data.dest.name}`}>
      <path d={d} fill="none" stroke="var(--brand)" strokeWidth={3} strokeLinecap="round" strokeLinejoin="round"
        strokeDasharray={data.routeEstimated ? '6 6' : undefined} />
      {(data.alongTheWay ?? []).map((p) => {
        const q = project(p.lng, p.lat);
        return <circle key={`r${p.id}`} cx={q.x} cy={q.y} r={3.5} fill="var(--pine)" opacity={0.85} />;
      })}
      {data.cities.map((c) => {
        const q = project(c.lng, c.lat);
        return (
          <g key={`c${c.name}`}>
            <circle cx={q.x} cy={q.y} r={4.5} fill="var(--surface)" stroke="var(--ink)" strokeWidth={1.5} />
            <text x={q.x + 7} y={q.y - 6} fontSize={10} fill="var(--ink-2)">{c.name}</text>
          </g>
        );
      })}
      {[{ p: o, n: data.origin.name }, { p: t, n: data.dest.name }].map(({ p, n }) => (
        <g key={`e${n}`}>
          <circle cx={p.x} cy={p.y} r={7} fill="var(--brand)" stroke="var(--surface)" strokeWidth={2} />
          <text x={p.x + 10} y={p.y + 4} fontSize={12} fontWeight={600} fill="var(--ink)">{n}</text>
        </g>
      ))}
    </svg>
  );
}

const cap = (t: string) => t.charAt(0).toUpperCase() + t.slice(1);

function PlaceChip({ p, meta }: { p: Place; meta?: string }) {
  return (
    <li className="flex items-center gap-2.5 rounded-md border border-border bg-surface p-2">
      {p.image ? (
        <img src={p.image} alt="" loading="lazy" className="h-10 w-10 shrink-0 rounded object-cover"
          onError={(e) => { (e.currentTarget as HTMLImageElement).style.visibility = 'hidden'; }} />
      ) : (
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded bg-surface-2 text-ink-3">
          <MapPin className="h-4 w-4" strokeWidth={1.75} />
        </span>
      )}
      <span className="min-w-0 flex-1">
        <span className="type-small block truncate font-semibold text-ink">{p.name}</span>
        <span className="type-caption block truncate text-ink-3">{cap(meta ?? p.category)}</span>
      </span>
    </li>
  );
}

export default function RoutePreview({
  data,
  loading,
  error,
  onBack,
  onPlan,
  days,
  modeLabel,
}: {
  data: RoutePreviewData | null;
  loading: boolean;
  error: string | null;
  onBack: () => void;
  onPlan: () => void;
  days: number;
  modeLabel: string;
}) {
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center gap-2 border-b border-border px-6 py-4">
        <button type="button" onClick={onBack} aria-label="Back to the form"
          className="flex h-8 w-8 items-center justify-center rounded-md text-ink-2 hover:bg-surface-2">
          <ArrowLeft className="h-4 w-4" strokeWidth={1.75} />
        </button>
        <h3 className="type-h3 truncate text-ink">
          {data ? `${data.origin.name} → ${data.dest.name}` : 'Previewing your route'}
        </h3>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
        {loading && (
          <div className="flex flex-col items-center gap-3 py-16 text-ink-2">
            <Loader2 className="h-6 w-6 animate-spin" />
            <p className="type-small">Routing the corridor and finding stops along the way…</p>
          </div>
        )}
        {error && !loading && (
          <p className="type-small rounded-md bg-danger/10 p-3 text-danger" role="alert">{error}</p>
        )}
        {data && !loading && (
          <div className="space-y-5">
            <Sketch data={data} />
            <div className="flex flex-wrap gap-2">
              <span className="type-caption flex items-center gap-1.5 rounded-pill bg-surface-2 px-3 py-1 font-semibold text-ink-2">
                <Route className="h-3.5 w-3.5" /> {data.totalKm.toLocaleString()} km
              </span>
              {data.driveHours != null && (
                <span className="type-caption flex items-center gap-1.5 rounded-pill bg-surface-2 px-3 py-1 font-semibold text-ink-2">
                  <Clock className="h-3.5 w-3.5" /> ~{data.driveHours} h driving
                </span>
              )}
              <span className="type-caption rounded-pill bg-surface-2 px-3 py-1 font-semibold text-ink-2">
                {data.cities.length} {data.cities.length === 1 ? 'city' : 'cities'} on the way
              </span>
              {data.routeEstimated && (
                <span className="type-caption rounded-pill bg-ochre-soft px-3 py-1 font-semibold text-ink-2">
                  Straight-line estimate, road routing unavailable
                </span>
              )}
            </div>

            {data.warnings.length > 0 && (
              <ul className="space-y-1">
                {data.warnings.map((w) => (
                  <li key={w} className="type-caption flex items-start gap-1.5 text-ink-2">
                    <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0 text-ochre" /> {w}
                  </li>
                ))}
              </ul>
            )}

            {(data.alongTheWay?.length ?? 0) > 0 && (
              <section>
                <h4 className="type-h4 flex items-center gap-2 text-ink">
                  <Mountain className="h-4 w-4 text-pine" strokeWidth={1.75} /> Worth pulling over for
                </h4>
                <p className="type-caption mt-0.5 text-ink-3">Between the cities, a short detour off the route.</p>
                <ul className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2">
                  {data.alongTheWay!.map((p) => (
                    <PlaceChip key={p.id} p={p} meta={`${p.category} · ${p.detourKm} km off route`} />
                  ))}
                </ul>
              </section>
            )}

            {data.cities.map((c, i) => (
              <section key={c.name}>
                <h4 className="type-h4 text-ink">
                  <span className="type-caption mr-2 inline-flex h-5 w-5 items-center justify-center rounded-full bg-ink text-surface">{i + 1}</span>
                  {c.name}
                  <span className="type-caption ml-1.5 text-ink-3">{c.country}</span>
                </h4>
                <ul className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2">
                  {c.places.slice(0, 4).map((p) => <PlaceChip key={p.id} p={p} />)}
                </ul>
              </section>
            ))}
            {data.cities.length === 0 && (
              <p className="type-small text-ink-2">
                No stopover cities with places yet on this corridor. Planning will still build the route and pull places in as it goes.
              </p>
            )}
            {data.stylesUsed.length > 0 && (
              <p className="type-caption text-ink-3">Ranked for your taste: {data.stylesUsed.slice(0, 6).join(', ')}.</p>
            )}
          </div>
        )}
      </div>

      <div className="flex items-center justify-between gap-3 border-t border-border px-6 py-4">
        <span className="type-caption text-ink-3">{days} days · {modeLabel}</span>
        <Button onClick={onPlan} size="lg" pill disabled={loading} className={cn('min-w-[170px]')}>
          <Route className="h-4 w-4" strokeWidth={1.75} /> Plan this route
        </Button>
      </div>
    </div>
  );
}
