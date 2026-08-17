/**
 * place-meta.ts - shared client helpers for the r11 place metadata:
 *
 *   verdictChip(verdict)     → chip label/classes for "can it be skipped?"
 *                              (must-see / worth-it / skip-if-tight)
 *   closedLabel(closedStatus) → banner/chip copy for reported closures
 *   useDietBadgeFn()          → guarded access to the sibling-provided
 *                              src/lib/diet.ts badge helper: resolves it when
 *                              that module exists in the build, returns null
 *                              otherwise (badges are simply skipped).
 *
 * PlaceDetailDialog and the journal place cards use these; any other surface
 * (city builder cards, rails) can import the same helpers so copy + styling
 * stay consistent.
 */
import { useEffect, useState } from 'react';

// ── verdict chip ────────────────────────────────────────────────────────────
export type PlaceVerdictId = 'must-see' | 'worth-it' | 'skip-if-tight';

export interface VerdictChipMeta {
  label: string;
  className: string;
  title: string;
}

export function verdictChip(verdict: string | null | undefined): VerdictChipMeta | null {
  switch (verdict) {
    case 'must-see':
      return {
        label: 'Must-see',
        className: 'bg-ochre-soft text-ochre',
        title: 'A world icon, worth planning the day around',
      };
    case 'worth-it':
      return {
        label: 'Worth it',
        className: 'bg-pine-soft text-pine',
        title: 'A solid stop if it fits the day',
      };
    case 'skip-if-tight':
      return {
        label: 'Skippable if tight',
        className: 'bg-surface-2 text-ink-3',
        title: 'Fine to drop when the schedule is tight',
      };
    default:
      return null;
  }
}

// ── closed status ───────────────────────────────────────────────────────────
export interface ClosedMeta {
  /** short chip label, e.g. "Permanently closed" */
  label: string;
  /** prominent banner copy, e.g. "Reported permanently closed" */
  banner: string;
  tone: 'amber' | 'red';
  bannerClass: string;
  chipClass: string;
}

export function closedLabel(closedStatus: string | null | undefined): ClosedMeta | null {
  if (closedStatus === 'temporarily_closed') {
    return {
      label: 'Temporarily closed',
      banner: 'Reported temporarily closed, check before you go',
      tone: 'amber',
      bannerClass: 'bg-ochre-soft text-ochre',
      chipClass: 'bg-ochre-soft text-ochre',
    };
  }
  if (closedStatus === 'permanently_closed') {
    return {
      label: 'Permanently closed',
      banner: 'Reported permanently closed',
      tone: 'red',
      bannerClass: 'bg-danger/10 text-danger',
      chipClass: 'bg-danger/10 text-danger',
    };
  }
  return null;
}

// ── diet badges (sibling-provided helper, guarded) ──────────────────────────
export type DietBadgeFn = (place: { tags?: string[] | null; name?: string }) => string[];

/**
 * Globbed so the build succeeds whether or not src/lib/diet.ts (owned by a
 * sibling agent) has landed yet - an empty map simply means "no badges".
 */
const dietLoaders = import.meta.glob('/src/lib/diet.ts');

function pickDietFn(mod: unknown): DietBadgeFn | null {
  const m = mod as Record<string, unknown>;
  const candidate =
    m.dietBadgesFor ?? m.dietaryBadges ?? m.dietBadges ?? m.badgesForPlace ?? m.default;
  if (typeof candidate !== 'function') return null;
  const fn = candidate as (p: { tags?: string[] | null; name?: string }) => unknown;
  return (place) => {
    try {
      const out = fn(place);
      return Array.isArray(out) ? out.filter((b): b is string => typeof b === 'string') : [];
    } catch {
      return [];
    }
  };
}

/**
 * Resolve the diet badge helper once per mount. Returns null while loading,
 * when the module is absent, or when it exports no recognizable helper.
 */
export function useDietBadgeFn(): DietBadgeFn | null {
  const [badgeFn, setBadgeFn] = useState<DietBadgeFn | null>(null);
  useEffect(() => {
    let alive = true;
    const loader = dietLoaders['/src/lib/diet.ts'];
    if (!loader) return undefined;
    loader()
      .then((mod) => {
        if (!alive) return;
        const fn = pickDietFn(mod);
        if (fn) setBadgeFn(() => fn);
      })
      .catch(() => {
        /* module failed to load\u2014 badges stay hidden */
      });
    return () => {
      alive = false;
    };
  }, []);
  return badgeFn;
}
