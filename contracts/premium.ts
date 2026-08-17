// Premium tier constants shared by client + server.
export const TIERS = {
  wanderer: {
    name: "Wanderer",
    maxTrips: 3,
    maxCollaborators: 3, // collaborators beyond the owner
    optimizeRoute: false,
    emailImport: false,
    offlineExport: false,
  },
  voyager: {
    name: "Voyager",
    maxTrips: Infinity,
    maxCollaborators: Infinity,
    optimizeRoute: true,
    emailImport: true,
    offlineExport: true,
  },
} as const;

export type TierName = keyof typeof TIERS;

/**
 * Voyager pricing, per currency.
 *
 * r25: INR is priced for India, not converted from USD. The single USD price
 * worked out at roughly ₹3,400/year — Wanderlog's exact US price — in a market
 * where Netflix Mobile is ₹149/month and where the two nearest competitors
 * (ixigo, MakeMyTrip) charge nothing at all because they monetise the booking.
 * A straight FX conversion is the wrong instrument here; these are separate
 * price points chosen per market.
 *
 * `cents` is always minor units of that currency (paise for INR).
 */
export const PRICES = {
  USD: {
    currency: "USD",
    monthly: { cents: 499, label: "$4.99/mo" },
    yearly: { cents: 3999, label: "$39.99/yr" },
  },
  INR: {
    currency: "INR",
    monthly: { cents: 9900, label: "₹99/mo" },
    yearly: { cents: 79900, label: "₹799/yr" },
  },
} as const;

export type PriceCurrency = keyof typeof PRICES;

/** Default/legacy price table. Prefer priceFor(currency). */
export const VOYAGER_PRICE = PRICES.USD;

/** Markets that get rupee pricing (by IANA timezone). */
const INR_TIMEZONES = new Set(["Asia/Kolkata", "Asia/Calcutta"]);

/**
 * Pick a price table. Resolution order: explicit currency -> timezone ->
 * browser locale -> USD. Kept dependency-free so client and server agree.
 */
export function priceFor(opts?: {
  currency?: string | null;
  timezone?: string | null;
  locale?: string | null;
}): (typeof PRICES)[PriceCurrency] {
  const cur = opts?.currency?.toUpperCase();
  if (cur && cur in PRICES) return PRICES[cur as PriceCurrency];
  if (opts?.timezone && INR_TIMEZONES.has(opts.timezone)) return PRICES.INR;
  if (opts?.locale && /-IN$/i.test(opts.locale)) return PRICES.INR;
  return PRICES.USD;
}

/** Client-side convenience: infer the market from the browser itself. */
export function priceForBrowser(): (typeof PRICES)[PriceCurrency] {
  try {
    return priceFor({
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      locale: typeof navigator !== "undefined" ? navigator.language : null,
    });
  } catch {
    return PRICES.USD;
  }
}

export const EXPENSE_CATEGORIES = [
  "food",
  "lodging",
  "transport",
  "activities",
  "shopping",
  "other",
] as const;
export type ExpenseCategory = (typeof EXPENSE_CATEGORIES)[number];

export const STOP_CATEGORIES = [
  "food",
  "lodging",
  "transport",
  "activity",
  "shopping",
  "other",
] as const;

export const PREFERENCE_STYLES = [
  "adventure",
  "food",
  "budget",
  "historical",
  "relaxing",
] as const;
export type PreferenceStyle = (typeof PREFERENCE_STYLES)[number];
