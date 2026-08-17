import { authRouter } from "./auth-router";
import { tripRouter } from "./trip-router";
import { preferenceRouter } from "./preference-router";
import { exploreRouter } from "./explore-router";
import { billingRouter } from "./billing-router";
import { journalRouter } from "./journal-router";
import { adminRouter } from "./admin-router";
import { geoRouter } from "./geo-router";
import { weatherRouter } from "./weather-router";
import { packingRouter } from "./packing-router";
import { bookingsRouter } from "./bookings-router";
import { roadtripRouter } from "./roadtrip-router";
import { safetyRouter } from "./safety-router";
import { citybuildRouter } from "./citybuild-router";
import { templatesRouter } from "./templates-router";
import { supportRouter } from "./support-router";
import { shareRouter } from "./share-router";
import { friendsRouter } from "./friends-router"; // r12-friends
import { getawaysRouter } from "./getaways-router"; // r13-getaways
import { portalRouter } from "./portal-router"; // r17-portal
import { socialRouter } from "./social-router"; // r19-social
import { publishRouter } from "./publish-router"; // r24-social
import { usersRouter } from "./users-router"; // r24-smart
import { notificationsRouter } from "./notifications-router"; // r24-smart
import { mapsRouter } from "./maps-router"; // r24-smart
import { wishlistRouter } from "./wishlist-router"; // r24-smart
import { tokensRouter } from "./tokens-router"; // r24-smart
import { travelRouter } from "./travel-router"; // r24-smart
import { createRouter, publicQuery } from "./middleware";

export const appRouter = createRouter({
  ping: publicQuery.query(() => ({ ok: true, ts: Date.now() })),
  auth: authRouter,
  trips: tripRouter,
  preferences: preferenceRouter,
  explore: exploreRouter,
  billing: billingRouter,
  journal: journalRouter,
  admin: adminRouter,
  geo: geoRouter,
  weather: weatherRouter,
  packing: packingRouter,
  bookings: bookingsRouter,
  roadtrip: roadtripRouter,
  safety: safetyRouter,
  citybuild: citybuildRouter,
  templates: templatesRouter,
  support: supportRouter,
  share: shareRouter,
  friends: friendsRouter, // r12-friends
  getaways: getawaysRouter, // r13-getaways
  portal: portalRouter, // r17-portal
  social: socialRouter, // r19-social
  publish: publishRouter, // r24-social
  users: usersRouter, // r24-smart
  notifications: notificationsRouter, // r24-smart
  maps: mapsRouter, // r24-smart
  wishlist: wishlistRouter, // r24-smart
  tokens: tokensRouter, // r24-smart
  travel: travelRouter, // r24-smart
});

export type AppRouter = typeof appRouter;
