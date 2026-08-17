import { trpc } from "@/providers/trpc";

/**
 * Bridge for backend contracts implemented on parallel branches
 * (explore.search / explore.discover and the generateItinerary budget
 * option). The tRPC react client is a runtime proxy, so these procedures
 * resolve at runtime as soon as the backend ships; this module only widens
 * the *types* locally against the agreed wire shapes. Once the backend
 * branches merge, the casts below can be deleted without behavior change.
 */

/* ── explore.search ─────────────────────────────────────────────────────── */

export interface ExplorePlaceResult {
  id: number | null;
  name: string;
  city: string;
  country: string;
  lat: number;
  lng: number;
  category: string;
  address?: string;
  source: "corpus" | "osm";
}

export interface ExploreSearchInput {
  query: string;
  near?: { lat: number; lng: number };
  limit?: number;
}

interface ExploreSearchQuery {
  data: { results: ExplorePlaceResult[] } | undefined;
  isFetching: boolean;
}

/**
 * Live place search (corpus + OpenStreetMap). Debounce/min-length is the
 * caller's job; pass `enabled` to gate the request.
 */
export function useExploreSearch(
  input: ExploreSearchInput,
  opts?: { enabled?: boolean }
): ExploreSearchQuery {
  const api = (
    trpc.explore as unknown as {
      search: {
        useQuery: (i: ExploreSearchInput, o?: { enabled?: boolean }) => ExploreSearchQuery;
      };
    }
  ).search;
  return api.useQuery(input, opts);
}

/* ── explore.discover ───────────────────────────────────────────────────── */

export interface ExploreDiscoverResult {
  inserted: number;
  total: number;
}

interface ExploreDiscoverMutation {
  mutate: (input: { city: string }) => void;
  isPending: boolean;
}

/** Pull fresh places for a city from OpenStreetMap into the corpus. */
export function useExploreDiscover(opts?: {
  onSuccess?: (data: ExploreDiscoverResult, vars: { city: string }) => void;
  onError?: (err: { message: string }) => void;
}): ExploreDiscoverMutation {
  const api = (
    trpc.explore as unknown as {
      discover: {
        useMutation: (o?: {
          onSuccess?: (data: ExploreDiscoverResult, vars: { city: string }) => void;
          onError?: (err: { message: string }) => void;
        }) => ExploreDiscoverMutation;
      };
    }
  ).discover;
  return api.useMutation(opts);
}

/* ── AI itinerary budget (generateItinerary contract extension) ─────────── */

export type BudgetBand = "shoestring" | "mid" | "comfort" | "luxury";

export const BUDGET_BANDS: { value: BudgetBand; label: string }[] = [
  { value: "shoestring", label: "Shoestring" },
  { value: "mid", label: "Mid-range" },
  { value: "comfort", label: "Comfort" },
  { value: "luxury", label: "Luxury" },
];

export function isBudgetBand(v: unknown): v is BudgetBand {
  return BUDGET_BANDS.some(b => b.value === v);
}

export interface DayEstimate {
  date: string;
  feesKnown: number;
  totalCents: number;
  currencies: string[];
}
