/**
 * rewards.ts (r24-smart, feature Q) - the virtual rewards catalog. Honest
 * virtual goods unlocked with tokens; nothing here is a real purchase.
 */
export interface Reward {
  id: string;
  name: string;
  description: string;
  cost: number;
  icon: string; // lucide icon hint for the UI
}

export const REWARDS: Reward[] = [
  {
    id: "packing-checklist-pro",
    name: "Packing checklist pro",
    description: "An upgraded packing template with laundry-day math and carry-on-only mode.",
    cost: 60,
    icon: "luggage",
  },
  {
    id: "offline-day-map",
    name: "Offline day map",
    description: "A printer-friendly day card with your route, times and backup stops.",
    cost: 40,
    icon: "map",
  },
  {
    id: "local-phrase-sheet",
    name: "Local phrase sheet",
    description: "Twenty phrases that actually get used: greetings, ordering, directions, thanks.",
    cost: 30,
    icon: "languages",
  },
  {
    id: "airport-lounge-guide",
    name: "Airport lounge guide",
    description: "Which lounges your cards and tickets already unlock at your departure airport.",
    cost: 80,
    icon: "armchair",
  },
  {
    id: "rainy-day-kit",
    name: "Rainy-day kit",
    description: "A ready-made indoor fallback plan for one city on your wishlist.",
    cost: 50,
    icon: "cloud-rain",
  },
];

export function rewardById(id: string): Reward | null {
  return REWARDS.find((r) => r.id === id) ?? null;
}
