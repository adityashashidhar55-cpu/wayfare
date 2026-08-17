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

export const VOYAGER_PRICE = {
  monthly: { cents: 499, label: "$4.99/mo" },
  yearly: { cents: 3999, label: "$39.99/yr" },
} as const;

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
