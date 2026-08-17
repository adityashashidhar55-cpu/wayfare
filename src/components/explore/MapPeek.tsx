/**
 * Explore map peek (explore.md §S5 + design.md §9): a full-width MapLibre
 * band showing current recommendations as brand dots (pins drop in staggered
 * 30ms on section enter), a left-floating glass card with top places, and an
 * "Open full map" expansion (400ms height spring) with pin↔list hover sync.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import maplibregl from 'maplibre-gl';
import { motion, useInView, useReducedMotion } from 'framer-motion';
import { ChevronDown, MapPin } from 'lucide-react';
import { mapStyleForTheme } from '@/lib/map';
import { cn } from '@/lib/utils';
import { useIsDark } from '@/components/explore/useIsDark';
import type { ExplorePlaceItem } from '@/components/explore/explore-utils';

const EASE_EXPO = [0.22, 1, 0.36, 1] as [number, number, number, number];

/** fit-bounds padding - desktop leaves room for the left-floating card. */
function fitPadding(): maplibregl.PaddingOptions {
  if (typeof window !== 'undefined' && window.innerWidth < 768) {
    return { top: 48, bottom: 220, left: 32, right: 32 };
  }
  return { top: 64, bottom: 64, left: 360, right: 64 };
}

const PIN_STYLES = `
.explore-pin { cursor: pointer; }
.explore-pin-dot {
  display: block; width: 16px; height: 16px; border-radius: 999px;
  background: var(--brand); border: 2.5px solid var(--surface);
  box-shadow: var(--shadow-md);
  transform: scale(0);
  transition: transform 300ms cubic-bezier(.34,1.4,.64,1);
}
.explore-pin.pin-visible .explore-pin-dot { transform: scale(1); }
.explore-pin.pin-active .explore-pin-dot, .explore-pin:hover .explore-pin-dot { transform: scale(1.35); }
@keyframes explore-pin-flash {
  0%, 100% { box-shadow: 0 0 0 0 color-mix(in srgb, var(--brand) 55%, transparent); }
  50% { box-shadow: 0 0 0 14px transparent; }
}
.explore-pin.pin-flash .explore-pin-dot { animation: explore-pin-flash 0.8s ease-out 2; }
`;

interface MapPeekProps {
  places: ExplorePlaceItem[];
  flashId: number | null;
  onFlashDone: () => void;
}

export default function MapPeek({ places, flashId, onFlashDone }: MapPeekProps) {
  const isDark = useIsDark();
  const reduced = useReducedMotion();
  const wrapRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const markersRef = useRef(new Map<number, maplibregl.Marker>());
  const fittedRef = useRef(false);
  const [mapReady, setMapReady] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [hoverId, setHoverId] = useState<number | null>(null);

  const inView = useInView(wrapRef, { once: true, margin: '-80px' });

  const mappable = useMemo(() => places.filter((p) => p.lat != null && p.lng != null), [places]);

  // ── create map once ───────────────────────────────────────────────────────
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    const map = new maplibregl.Map({
      container: containerRef.current,
      style: mapStyleForTheme(document.documentElement.classList.contains('dark')),
      center: [20, 30],
      zoom: 1.4,
      attributionControl: { compact: true },
    });
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right');
    map.on('load', () => setMapReady(true));
    mapRef.current = map;
    return () => {
      map.remove();
      mapRef.current = null;
    };
  }, []);

  // ── theme switch (warm-charcoal variant) ──────────────────────────────────
  useEffect(() => {
    const map = mapRef.current;
    if (map && mapReady) map.setStyle(mapStyleForTheme(isDark));
  }, [isDark, mapReady]);

  // ── sync markers with current recommendations ────────────────────────────
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;

    for (const marker of markersRef.current.values()) marker.remove();
    markersRef.current.clear();

    const bounds = new maplibregl.LngLatBounds();
    for (const place of mappable) {
      const el = document.createElement('div');
      el.className = 'explore-pin';
      const dot = document.createElement('span');
      dot.className = 'explore-pin-dot';
      el.appendChild(dot);
      el.addEventListener('mouseenter', () => setHoverId(place.id));
      el.addEventListener('mouseleave', () => setHoverId((h) => (h === place.id ? null : h)));

      const marker = new maplibregl.Marker({ element: el })
        .setLngLat([place.lng!, place.lat!])
        .addTo(map);
      markersRef.current.set(place.id, marker);
      bounds.extend([place.lng!, place.lat!]);
    }

    // pins drop in, staggered 30ms (skipped under reduced motion)
    const els = [...markersRef.current.values()].map((m) => m.getElement());
    els.forEach((el, i) => {
      el.style.transitionDelay = reduced ? '0ms' : `${i * 30}ms`;
    });
    if (inView) {
      requestAnimationFrame(() => els.forEach((el) => el.classList.add('pin-visible')));
    }

    if (!fittedRef.current && mappable.length > 0 && !bounds.isEmpty()) {
      fittedRef.current = true;
      map.fitBounds(bounds, { padding: fitPadding(), maxZoom: 10, duration: 0 });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mappable, mapReady, inView, reduced]);

  // ── reveal pins when the section scrolls into view ───────────────────────
  useEffect(() => {
    if (!inView) return;
    for (const marker of markersRef.current.values()) {
      marker.getElement().classList.add('pin-visible');
    }
  }, [inView]);

  // ── hover sync pin ↔ list row ─────────────────────────────────────────────
  useEffect(() => {
    for (const [id, marker] of markersRef.current) {
      marker.getElement().classList.toggle('pin-active', id === hoverId);
    }
  }, [hoverId]);

  // ── "View on map" pin flash ───────────────────────────────────────────────
  useEffect(() => {
    const map = mapRef.current;
    if (!map || flashId == null) return;
    const place = mappable.find((p) => p.id === flashId);
    const marker = markersRef.current.get(flashId);
    if (!place || !marker) {
      onFlashDone();
      return;
    }
    map.easeTo({ center: [place.lng!, place.lat!], zoom: Math.max(map.getZoom(), 9), duration: 500 });
    const el = marker.getElement();
    el.classList.add('pin-flash');
    const t = setTimeout(() => {
      el.classList.remove('pin-flash');
      onFlashDone();
    }, 1700);
    return () => {
      clearTimeout(t);
      el.classList.remove('pin-flash');
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [flashId]);

  function fitAll() {
    const map = mapRef.current;
    if (!map || mappable.length === 0) return;
    const bounds = new maplibregl.LngLatBounds();
    mappable.forEach((p) => bounds.extend([p.lng!, p.lat!]));
    map.fitBounds(bounds, { padding: fitPadding(), maxZoom: 10, duration: 450 });
  }

  const rows = expanded ? mappable : mappable.slice(0, 3);

  return (
    <div ref={wrapRef} className="relative">
      <style>{PIN_STYLES}</style>
      <motion.div
        initial={false}
        animate={{ height: expanded ? '80vh' : 480 }}
        transition={{ duration: 0.4, ease: EASE_EXPO }}
        onAnimationComplete={() => mapRef.current?.resize()}
        className="relative w-full overflow-hidden max-md:!h-[360px]"
        style={{ height: 480 }}
      >
        <div ref={containerRef} className="h-full w-full" />

        {/* floating glass card */}
        <div
          className={cn(
            'glass-strong absolute z-10 rounded-lg border border-border p-4 shadow-lg',
            'max-md:inset-x-3 max-md:bottom-3 md:left-4 md:top-4 md:w-[320px]',
            expanded && 'md:bottom-4 md:flex md:flex-col',
          )}
        >
          <h4 className="type-h4 text-ink">See it on the map</h4>
          <ul className={cn('mt-2.5 space-y-1', expanded && 'md:min-h-0 md:flex-1 md:overflow-y-auto')}>
            {rows.map((p, i) => (
              <li key={p.id}>
                <button
                  type="button"
                  onMouseEnter={() => setHoverId(p.id)}
                  onMouseLeave={() => setHoverId((h) => (h === p.id ? null : h))}
                  onClick={() => {
                    const map = mapRef.current;
                    if (map && p.lat != null && p.lng != null) {
                      map.easeTo({ center: [p.lng, p.lat], zoom: Math.max(map.getZoom(), 9), duration: 450 });
                    }
                  }}
                  className={cn(
                    'flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-left transition-colors duration-fast',
                    hoverId === p.id ? 'bg-surface-2' : 'hover:bg-surface-2',
                  )}
                >
                  <span className="type-numeral flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-brand-soft font-serif text-[11px] font-semibold text-brand">
                    {i + 1}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="type-small block truncate font-semibold text-ink">{p.name}</span>
                    <span className="type-caption block text-ink-3">{p.city}</span>
                  </span>
                </button>
              </li>
            ))}
            {rows.length === 0 && (
              <li className="type-small flex items-center gap-2 px-2 py-3 text-ink-3">
                <MapPin className="h-4 w-4" strokeWidth={1.75} />
                No places to pin right now
              </li>
            )}
          </ul>
          <button
            type="button"
            onClick={() => {
              setExpanded((e) => {
                if (!e) setTimeout(fitAll, 420);
                return !e;
              });
            }}
            className="type-small mt-3 flex w-full items-center justify-center gap-1.5 rounded-md border border-border-strong bg-surface px-3 py-2 font-semibold text-ink transition-all duration-fast hover:-translate-y-px hover:bg-surface-2 hover:shadow-md"
          >
            {expanded ? 'Show less' : 'Open full map'}
            <ChevronDown
              className={cn('h-4 w-4 transition-transform duration-base', expanded && 'rotate-180')}
              strokeWidth={1.75}
            />
          </button>
        </div>
      </motion.div>
    </div>
  );
}
