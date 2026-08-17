/**
 * Explore helpers - tRPC result types, style metadata, filter predicates,
 * and ready-made plan composition (explore.md).
 */
import type { inferRouterOutputs } from '@trpc/server';
import {
  Landmark,
  Mountain,
  Palmtree,
  PiggyBank,
  Sparkles,
  Utensils,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import type { AppRouter } from '../../../api/router';

export type RouterOutputs = inferRouterOutputs<AppRouter>;
export type ExplorePlaceItem = RouterOutputs['explore']['list']['places'][number];
export type ExploreCity = RouterOutputs['explore']['cities'][number];
export type TripListItem = RouterOutputs['trips']['list']['trips'][number];

// ── preference style metadata ───────────────────────────────────────────────
export interface StyleMeta {
  label: string;
  /** lowercase word used in "Matches your … taste" lines */
  taste: string;
  icon: LucideIcon;
}

export const STYLE_META: Record<string, StyleMeta> = {
  adventure: { label: 'Adventure', taste: 'adventure', icon: Mountain },
  food: { label: 'Food & drink', taste: 'food', icon: Utensils },
  budget: { label: 'Budget-friendly', taste: 'budget', icon: PiggyBank },
  historical: { label: 'Historical', taste: 'history', icon: Landmark },
  relaxing: { label: 'Relaxing', taste: 'slow travel', icon: Palmtree },
};

function prettify(id: string): string {
  return id
    .split('-')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

export function styleMeta(style: string): StyleMeta {
  return STYLE_META[style] ?? { label: prettify(style), taste: prettify(style).toLowerCase(), icon: Sparkles };
}

/** "food & history" style phrase from up to two styles. */
export function tastePhrase(styles: string[]): string {
  const words = styles.slice(0, 2).map((s) => styleMeta(s).taste);
  if (words.length === 0) return '';
  if (words.length === 1) return words[0]!;
  return `${words[0]} & ${words[1]}`;
}

// ── category filter predicates (S2 filter rail) ─────────────────────────────
function hasTag(p: ExplorePlaceItem, tags: string[]): boolean {
  const t = p.tags ?? [];
  return tags.some((tag) => t.includes(tag));
}

const NATURE_TAGS = ['nature', 'hike', 'beach', 'pools', 'garden', 'deer', 'spa', 'viewpoint', 'views'];
const MUSEUM_TAGS = ['museum', 'art'];
const CAFE_TAGS = ['coffee', 'cafe', 'kissaten'];
const NIGHT_TAGS = ['nightlife', 'cocktails'];

export interface CategoryFilter {
  id: string;
  label: string;
  match: (p: ExplorePlaceItem) => boolean;
}

export const CATEGORY_FILTERS: CategoryFilter[] = [
  { id: 'all', label: 'All', match: () => true },
  { id: 'food', label: 'Food', match: (p) => p.category === 'food' && !hasTag(p, CAFE_TAGS) && !hasTag(p, NIGHT_TAGS) },
  { id: 'sights', label: 'Sights', match: (p) => p.category === 'activity' && !hasTag(p, NATURE_TAGS) && !hasTag(p, MUSEUM_TAGS) },
  { id: 'cafes', label: 'Cafés', match: (p) => hasTag(p, CAFE_TAGS) },
  { id: 'nature', label: 'Nature', match: (p) => hasTag(p, NATURE_TAGS) },
  { id: 'nightlife', label: 'Nightlife', match: (p) => hasTag(p, NIGHT_TAGS) },
  { id: 'museums', label: 'Museums', match: (p) => hasTag(p, MUSEUM_TAGS) },
];

export function categoryLabel(p: ExplorePlaceItem): string {
  if (hasTag(p, CAFE_TAGS)) return 'Café';
  if (hasTag(p, MUSEUM_TAGS)) return 'Museum';
  if (hasTag(p, NIGHT_TAGS)) return 'Nightlife';
  switch (p.category) {
    case 'food':
      return 'Food';
    case 'activity':
      return 'Sights';
    case 'shopping':
      return 'Shopping';
    case 'lodging':
      return 'Lodging';
    case 'transport':
      return 'Transport';
    default:
      return 'Place';
  }
}

// ── ready-made plans (S4 / S6) ──────────────────────────────────────────────
export function planDaysFor(count: number): number {
  return Math.min(5, Math.max(2, Math.ceil(count / 3)));
}

const PLAN_AUDIENCE: Record<string, string> = {
  food: 'food lovers',
  adventure: 'adventurers',
  historical: 'history buffs',
  relaxing: 'slow travelers',
  budget: 'shoestring travelers',
};

export function planTitle(city: ExploreCity, styles: string[]): string {
  const audience = PLAN_AUDIENCE[styles[0] ?? ''] ?? 'curious travelers';
  return `${planDaysFor(city.count)}-day ${city.city} for ${audience}`;
}

/** Deterministic "by the editors" avatar set for plan cards. */
export const EDITOR_AVATARS = ['/avatar-2.png', '/avatar-3.png', '/avatar-4.png'];
export const EDITOR_NAMES = ['Daniel', 'Priya', 'Leo'];

/** First sentence of a place description - the "local tip" on gem cards. */
export function localTip(description: string | null): string {
  if (!description) return '';
  const first = description.split(/(?<=[.!?\u2014])\s/)[0] ?? description;
  return first.length > 90 ? `${first.slice(0, 87).trimEnd()}…` : first;
}
