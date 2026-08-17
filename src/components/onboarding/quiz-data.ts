/**
 * Onboarding Taste Profile quiz - option definitions and archetype logic
 * (onboarding.md). Canonical styles follow PREFERENCE_STYLES from the
 * contracts (adventure | food | budget | historical | relaxing); the extra
 * quiz chips feed into their closest canonical style so Explore scoring
 * stays meaningful.
 */
import {
  Backpack,
  BedDouble,
  Camera,
  Landmark,
  MoonStar,
  Mountain,
  Palette,
  Palmtree,
  PiggyBank,
  ShoppingBag,
  Sparkles,
  Trees,
  Utensils,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import type { Dietary } from '@contracts/diet';

// ── Q1 · travel styles ──────────────────────────────────────────────────────
export interface StyleChipDef {
  id: string;
  label: string;
  icon: LucideIcon;
  /** canonical PREFERENCE_STYLES value this chip contributes */
  style: string;
}

export const STYLE_CHIPS: StyleChipDef[] = [
  { id: 'adventure', label: 'Adventure', icon: Mountain, style: 'adventure' },
  { id: 'food', label: 'Food & drink', icon: Utensils, style: 'food' },
  { id: 'budget', label: 'Budget-friendly', icon: PiggyBank, style: 'budget' },
  { id: 'historical', label: 'Historical', icon: Landmark, style: 'historical' },
  { id: 'relaxing', label: 'Relaxing', icon: Palmtree, style: 'relaxing' },
  { id: 'culture', label: 'Culture & art', icon: Palette, style: 'historical' },
  { id: 'nightlife', label: 'Nightlife', icon: MoonStar, style: 'food' },
  { id: 'nature', label: 'Nature', icon: Trees, style: 'adventure' },
  { id: 'shopping', label: 'Shopping', icon: ShoppingBag, style: 'budget' },
  { id: 'photography', label: 'Photography', icon: Camera, style: 'relaxing' },
];

/** Canonical PREFERENCE_STYLES values for a set of selected chip ids. */
export function stylesForChips(chips: string[]): string[] {
  const out: string[] = [];
  for (const chip of STYLE_CHIPS) {
    if (chips.includes(chip.id) && !out.includes(chip.style)) out.push(chip.style);
  }
  return out;
}

// ── Q2 · budget posture ─────────────────────────────────────────────────────
export interface BudgetOption {
  id: string;
  /** persisted budgetBand value (shoestring | mid | comfort | luxury) */
  band: string;
  title: string;
  blurb: string;
  icon: LucideIcon;
}

export const BUDGET_OPTIONS: BudgetOption[] = [
  { id: 'shoestring', band: 'shoestring', title: 'Shoestring', blurb: 'Hostels, street food, free museums', icon: Backpack },
  { id: 'comfort', band: 'comfort', title: 'Comfort', blurb: 'Nice dinners, well-located stays', icon: BedDouble },
  { id: 'splurge', band: 'mid', title: 'Occasional splurge', blurb: 'Save on days, splurge on moments', icon: Sparkles },
];

// ── Q3 · pace ───────────────────────────────────────────────────────────────
export const PACE_DETENTS: { id: string; caption: string }[] = [
  { id: 'slow', caption: '≈ 2 stops a day, café-hopping between.' },
  { id: 'easy', caption: '≈ 3 stops a day, unhurried mornings.' },
  { id: 'balanced', caption: '≈ 4 stops a day, long lunches.' },
  { id: 'full', caption: '≈ 5–6 stops a day, golden-hour finishes.' },
  { id: 'packed', caption: '≈ 7 stops a day, sunrise starts.' },
];

// ── Q4 · interests ──────────────────────────────────────────────────────────
export const MAX_INTERESTS = 6;

export const INTEREST_OPTIONS: { id: string; label: string }[] = [
  { id: 'street-food', label: 'Street food' },
  { id: 'coffee', label: 'Coffee' },
  { id: 'fine-dining', label: 'Fine dining' },
  { id: 'hiking', label: 'Hiking' },
  { id: 'beaches', label: 'Beaches' },
  { id: 'museums', label: 'Museums' },
  { id: 'architecture', label: 'Architecture' },
  { id: 'local-markets', label: 'Local markets' },
  { id: 'temples', label: 'Temples & shrines' },
  { id: 'live-music', label: 'Live music' },
  { id: 'viewpoints', label: 'Viewpoints' },
  { id: 'hidden-gems', label: 'Hidden gems' },
];

// ── Q5 · companions, currency & diet ────────────────────────────────────────
/** Dietary choices (persisted to preferences.dietary) - single-select card row. */
export const DIET_OPTIONS: { id: Dietary; label: string; emoji: string }[] = [
  { id: 'veg', label: 'Vegetarian', emoji: '🌱' },
  { id: 'vegan', label: 'Vegan', emoji: '🥗' },
  { id: 'non-veg', label: 'Non-veg', emoji: '🍗' },
  { id: 'eggetarian', label: 'Eggetarian', emoji: '🧀' },
  { id: 'jain', label: 'Jain', emoji: '🌿' },
];

export const COMPANION_OPTIONS: { id: string; label: string }[] = [
  { id: 'solo', label: 'Solo' },
  { id: 'partner', label: 'Partner' },
  { id: 'friends', label: 'Friends' },
  { id: 'family', label: 'Family (kids)' },
];

export const CURRENCY_OPTIONS: { code: string; label: string }[] = [
  { code: 'USD', label: 'US Dollar' },
  { code: 'EUR', label: 'Euro' },
  { code: 'GBP', label: 'British Pound' },
  { code: 'JPY', label: 'Japanese Yen' },
  { code: 'AUD', label: 'Australian Dollar' },
  { code: 'CAD', label: 'Canadian Dollar' },
  { code: 'KRW', label: 'South Korean Won' },
  { code: 'THB', label: 'Thai Baht' },
  { code: 'MXN', label: 'Mexican Peso' },
  { code: 'MAD', label: 'Moroccan Dirham' },
  { code: 'DKK', label: 'Danish Krone' },
  { code: 'INR', label: 'Indian Rupee' },
];

// ── Archetype ───────────────────────────────────────────────────────────────
const COMBO_ARCHETYPES: { needs: [string, string]; name: string }[] = [
  { needs: ['food', 'adventure'], name: 'Flavor Cartographer' },
  { needs: ['adventure', 'budget'], name: 'Backpack Minimalist' },
  { needs: ['relaxing', 'historical'], name: 'Slow Culture Seeker' },
  { needs: ['food', 'budget'], name: 'Street-Food Scout' },
  { needs: ['food', 'historical'], name: 'Feast & Folklore Hunter' },
  { needs: ['adventure', 'historical'], name: 'Ruins Rambler' },
  { needs: ['adventure', 'relaxing'], name: 'Peaks & Stillness Seeker' },
  { needs: ['food', 'relaxing'], name: 'Leisurely Gourmand' },
  { needs: ['budget', 'historical'], name: 'Thrifty Time Traveler' },
  { needs: ['budget', 'relaxing'], name: 'Hammock Economist' },
];

const SOLO_ARCHETYPES: Record<string, string> = {
  adventure: 'Wild Horizon Chaser',
  food: 'Food-Forward Explorer',
  budget: 'Savvy Voyager',
  historical: 'Heritage Hunter',
  relaxing: 'Slow Wanderer',
};

/** Compose a fitting archetype name from the canonical taste styles. */
export function computeArchetype(styles: string[]): string {
  const set = new Set(styles);
  for (const combo of COMBO_ARCHETYPES) {
    if (combo.needs.every((n) => set.has(n))) return combo.name;
  }
  for (const style of styles) {
    const name = SOLO_ARCHETYPES[style];
    if (name) return name;
  }
  return 'Curious Wanderer';
}
