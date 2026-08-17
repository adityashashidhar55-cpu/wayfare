/**
 * useTier (r24-smart) - the canonical client-side premium gate. Reads
 * `users.me` (tier comes from the subscriptions table server-side) so every
 * Voyager gate in the app agrees on one source of truth.
 */
import { trpc } from "@/providers/trpc";

export function useTier() {
  const q = trpc.users.me.useQuery(undefined, {
    staleTime: 60_000,
    retry: false,
  });
  const tier = q.data?.tier ?? "wanderer";
  return {
    tier,
    isPremium: tier === "voyager",
    isLoading: q.isLoading,
  };
}
