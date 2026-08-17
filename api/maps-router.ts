/**
 * maps router (r24-smart, feature I) - the premium in-app Google Maps embed.
 * Free deep links are pure client-side (src/lib/map-links.ts); this router
 * only serves the embed URL, keeps the API key server-side and meters every
 * view against a 100/month cap in api_usage.
 *
 * No key configured (GOOGLE_MAPS_API_KEY absent) -> available:false with a
 * friendly reason; counting logic still applies and is covered by tests with
 * a fake key.
 */
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { authedQuery, createRouter, premiumQuery } from "./middleware";
import { env } from "./lib/env";
import { countMonthlyUsage, recordUsage, MAPS_EMBED_KIND, MAPS_EMBED_MONTHLY_CAP } from "./lib/usage";
import { googleEmbedUrl } from "@contracts/map-links";

const stopInput = z.object({
  name: z.string().min(1).max(255),
  lat: z.number().nullable().optional(),
  lng: z.number().nullable().optional(),
});

export const mapsRouter = createRouter({
  /** Current month's embed usage vs the cap (for the UI's meter). */
  usage: authedQuery.query(async ({ ctx }) => {
    const used = await countMonthlyUsage(ctx.user.id, MAPS_EMBED_KIND);
    return { used, cap: MAPS_EMBED_MONTHLY_CAP, keyConfigured: Boolean(env.googleMapsKey) };
  }),

  /**
   * Premium: embed URL for one place or a day's route. Counts one usage per
   * call; over the cap the client shows the "cap reached, use the free
   * links" state.
   */
  embed: premiumQuery
    .input(z.object({ stops: z.array(stopInput).min(1).max(15) }))
    .mutation(async ({ ctx, input }) => {
      const used = await countMonthlyUsage(ctx.user.id, MAPS_EMBED_KIND);
      if (used >= MAPS_EMBED_MONTHLY_CAP) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "MAPS_CAP_REACHED",
        });
      }
      const url = googleEmbedUrl(env.googleMapsKey, input.stops);
      if (!url) {
        // No key configured: do not count - nothing was served.
        return { available: false as const, reason: "no_key" as const, used, cap: MAPS_EMBED_MONTHLY_CAP };
      }
      await recordUsage(ctx.user.id, MAPS_EMBED_KIND);
      return { available: true as const, url, used: used + 1, cap: MAPS_EMBED_MONTHLY_CAP };
    }),
});
