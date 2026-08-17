/**
 * users router (r24-smart) - the canonical client-facing "who am I, what tier
 * am I on" endpoint. `auth.me` stays the session source; `users.me` adds the
 * subscription tier so every premium gate on the client reads one place.
 */
import { authedQuery, createRouter } from "./middleware";
import { getTier } from "./queries/subscriptions";

export const usersRouter = createRouter({
  me: authedQuery.query(async ({ ctx }) => {
    const tier = await getTier(ctx.user.id);
    return {
      user: {
        id: ctx.user.id,
        name: ctx.user.name,
        email: ctx.user.email,
        avatar: ctx.user.avatar,
        role: ctx.user.role,
      },
      tier,
      isPremium: tier === "voyager",
    };
  }),
});
