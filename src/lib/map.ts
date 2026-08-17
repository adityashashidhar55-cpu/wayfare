import 'maplibre-gl/dist/maplibre-gl.css';
import type { StyleSpecification } from 'maplibre-gl';

/**
 * Shared MapLibre configuration for Wayfare maps (design.md §9).
 * Free, no-key CARTO basemaps; page agents should consume these helpers
 * instead of hardcoding style URLs.
 */

export const MAP_STYLE_LIGHT =
  'https://basemaps.cartocdn.com/gl/positron-gl-style/style.json';
export const MAP_STYLE_DARK =
  'https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json';

/** Pick the basemap style for the current theme. */
export function mapStyleForTheme(isDark: boolean): string {
  return isDark ? MAP_STYLE_DARK : MAP_STYLE_LIGHT;
}

/**
 * Optional basemap upgrades when the backend exposes a Google Maps key
 * (`GET /api/config/public`). "map" is the default CARTO style; streets and
 * satellite are Google raster tile layers (256px, maxzoom 20).
 */
export type BasemapMode = 'map' | 'streets' | 'satellite';

export const BASEMAP_OPTIONS: { value: BasemapMode; label: string }[] = [
  { value: 'map', label: 'Map' },
  { value: 'streets', label: 'Streets' },
  { value: 'satellite', label: 'Satellite' },
];

/** Raster-only MapLibre style backed by Google tiles (no glyphs needed). */
export function googleRasterStyle(
  mode: Exclude<BasemapMode, 'map'>,
  key: string
): StyleSpecification {
  const lyrs = mode === 'satellite' ? 'y' : 'm';
  return {
    version: 8,
    sources: {
      google: {
        type: 'raster',
        tiles: [
          `https://mt0.googleapis.com/vt?lyrs=${lyrs}&x={x}&y={y}&z={z}&key=${key}`,
        ],
        tileSize: 256,
        maxzoom: 20,
        attribution: '© Google',
      },
    },
    layers: [{ id: 'google', type: 'raster', source: 'google' }],
  };
}

/**
 * Itinerary day colors (§3.3) - cycle of 6 for pins, day chips, route lines.
 * `dayColor(n)` is 1-based: day 1 → index 0.
 */
export const DAY_COLORS_LIGHT = [
  '#BC5934', // D1 clay
  '#44604F', // D2 pine
  '#6E7FA3', // D3 slate blue
  '#A86B8C', // D4 mauve
  '#B98A2E', // D5 ochre
  '#6E9A8B', // D6 sage
] as const;

/** Dark mode: each hue lightened ~15%. */
export const DAY_COLORS_DARK = [
  '#D97B54',
  '#82AC92',
  '#93A5C9',
  '#C48FAA',
  '#D9AC55',
  '#8FBFB0',
] as const;

export function dayColor(day: number, isDark = false): string {
  const cycle = isDark ? DAY_COLORS_DARK : DAY_COLORS_LIGHT;
  return cycle[(Math.max(1, day) - 1) % cycle.length];
}

/** Expense category colors (§3.2). */
export const EXPENSE_CATEGORY_COLORS = {
  food: '#C97F45',
  lodging: '#7C8DA6',
  transport: '#6E9A8B',
  activities: '#A86B8C',
  shopping: '#C9A63C',
  other: '#8A8175',
} as const;

export type ExpenseCategory = keyof typeof EXPENSE_CATEGORY_COLORS;
