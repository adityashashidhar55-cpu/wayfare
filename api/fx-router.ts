/**
 * fx-router (r27) - serves live exchange rates to the client.
 *
 * The frontend converts money in half a dozen components (expense previews,
 * budget chips, the cost breakdown) using the static table imported from
 * @contracts/fx. This endpoint lets it use the same daily-refreshed numbers
 * the server persists expenses with, so the preview a user sees before saving
 * matches what actually gets stored.
 *
 * Public on purpose: exchange rates are not user data, and the pricing page
 * needs them before sign-in.
 */
import { createRouter, publicQuery } from "./middleware";
import { getRates, FX_TTL_MS } from "./lib/fx-refresh";

export const fxRouter = createRouter({
  rates: publicQuery.query(async () => {
    const { rates, source } = await getRates();
    return {
      rates,
      source,
      // Lets the client cache for the same window the server considers fresh.
      ttlMs: FX_TTL_MS,
    };
  }),
});
