import {
  mysqlTable,
  mysqlEnum,
  serial,
  varchar,
  text,
  mediumtext,
  timestamp,
  bigint,
  int,
  double,
  boolean,
  json,
  primaryKey,
  uniqueIndex,
  index,
} from "drizzle-orm/mysql-core";

export const users = mysqlTable("users", {
  id: serial("id").primaryKey(),
  unionId: varchar("unionId", { length: 255 }).notNull().unique(),
  name: varchar("name", { length: 255 }),
  email: varchar("email", { length: 320 }),
  passwordHash: varchar("passwordHash", { length: 255 }), // credentials login (admin account)
  avatar: text("avatar"),
  role: mysqlEnum("role", ["user", "admin"]).default("user").notNull(),
  // Referral (r14-linkfix): every user gets a short url-safe code for their
  // /login?ref=<code> invite link; referredById points at the inviter (NULL
  // for organic sign-ups). Codes are backfilled for existing users by
  // db/seed-referral-codes.ts and minted on insert by upsertUser.
  referralCode: varchar("referralCode", { length: 12 }).unique(),
  referredById: bigint("referredById", { mode: "number", unsigned: true }),
  // r25: the user's home IANA zone, reported by the browser on sign-in
  // (Intl.DateTimeFormat().resolvedOptions().timeZone). Used for date
  // boundaries when a trip has no zone of its own.
  timezone: varchar("timezone", { length: 64 }),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt")
    .defaultNow()
    .notNull()
    .$onUpdate(() => new Date()),
  lastSignInAt: timestamp("lastSignInAt").defaultNow().notNull(),
});

export type User = typeof users.$inferSelect;
export type InsertUser = typeof users.$inferInsert;

// ─── Taste profile (onboarding quiz) ─────────────────────────────────────────
export const preferences = mysqlTable("preferences", {
  id: serial("id").primaryKey(),
  userId: bigint("userId", { mode: "number", unsigned: true })
    .notNull()
    .unique(),
  styles: json("styles").$type<string[]>(), // adventure | food | budget | historical | relaxing
  budgetBand: varchar("budgetBand", { length: 32 }).default("mid"),
  pace: varchar("pace", { length: 32 }).default("balanced"),
  interests: json("interests").$type<string[]>(),
  cuisines: json("cuisines").$type<string[]>(),
  dietary: varchar("dietary", { length: 24 }).default("non-veg"), // veg | non-veg | vegan | jain | eggetarian
  companions: varchar("companions", { length: 32 }).default("friends"),
  homeCurrency: varchar("homeCurrency", { length: 3 }).default("USD").notNull(),
  archetype: varchar("archetype", { length: 64 }),
  onboardingDone: boolean("onboardingDone").default(false).notNull(),
  updatedAt: timestamp("updatedAt")
    .defaultNow()
    .notNull()
    .$onUpdate(() => new Date()),
});
export type Preference = typeof preferences.$inferSelect;

// ─── Trips ───────────────────────────────────────────────────────────────────
export const trips = mysqlTable("trips", {
  id: serial("id").primaryKey(),
  ownerId: bigint("ownerId", { mode: "number", unsigned: true }).notNull(),
  title: varchar("title", { length: 255 }).notNull(),
  destination: varchar("destination", { length: 255 }).notNull(),
  coverImage: varchar("coverImage", { length: 512 }),
  startDate: varchar("startDate", { length: 10 }).notNull(), // YYYY-MM-DD
  endDate: varchar("endDate", { length: 10 }).notNull(),
  homeCurrency: varchar("homeCurrency", { length: 3 }).default("USD").notNull(),
  // Amount-based budget (r24-core): 0 = no budget set. budgetCurrency is the
  // currency the traveler typed the budget in (defaults to homeCurrency).
  budgetCents: int("budgetCents").default(0).notNull(),
  budgetCurrency: varchar("budgetCurrency", { length: 3 }).default("USD").notNull(),
  // r24-core inspiration wizard fields (all optional - quick path stays valid)
  originCity: varchar("originCity", { length: 255 }), // "From" location, free text
  adults: int("adults").default(2).notNull(),
  children: int("children").default(0).notNull(),
  intent: text("intent"), // JSON array: adventure | food | shopping | culture | relaxation | nightlife
  flexibility: varchar("flexibility", { length: 16 }), // planned | flexible
  foodPrefs: text("foodPrefs"), // JSON { diets: string[], note: string }
  mustSee: text("mustSee"), // free-text "points to visit / things you want to do"
  // Home base for the trip - set manually or imported from a booking email.
  // Voyager-only feature; day routes can be anchored start/end here.
  hotelName: varchar("hotelName", { length: 255 }),
  hotelAddress: varchar("hotelAddress", { length: 512 }),
  hotelLat: double("hotelLat"),
  hotelLng: double("hotelLng"),
  hotelSource: varchar("hotelSource", { length: 16 }), // manual | email
  // Multi-city road-trip / intercity fields (tripType='roadtrip')
  tripType: varchar("tripType", { length: 16 }).default("city"), // city | roadtrip
  originName: varchar("originName", { length: 255 }),
  originLat: double("originLat"),
  originLng: double("originLng"),
  intercityMode: varchar("intercityMode", { length: 16 }).default("car"), // car | transit
  // Family travel
  withChildren: boolean("withChildren").default(false),
  childAges: varchar("childAges", { length: 64 }), // e.g. "4,7"
  // Public read-only share link (/shared/:token) - NULL = sharing off
  shareToken: varchar("shareToken", { length: 36 }),
  // r25: IANA zone for the DESTINATION (e.g. "Asia/Kolkata"). Every "is today
  // within this trip" question must be answered in the traveller's local zone,
  // not the server's UTC clock - see api/lib/tz.ts. Guessed from the
  // destination on create; NULL falls back to the user's zone, then
  // APP_DEFAULT_TZ.
  timezone: varchar("timezone", { length: 64 }),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt")
    .defaultNow()
    .notNull()
    .$onUpdate(() => new Date()),
});
export type Trip = typeof trips.$inferSelect;

export const tripMembers = mysqlTable("trip_members", {
  id: serial("id").primaryKey(),
  tripId: bigint("tripId", { mode: "number", unsigned: true }).notNull(),
  userId: bigint("userId", { mode: "number", unsigned: true }),
  name: varchar("name", { length: 255 }).notNull(),
  email: varchar("email", { length: 320 }),
  role: mysqlEnum("role", ["owner", "editor", "viewer"])
    .default("editor")
    .notNull(),
  presenceColor: varchar("presenceColor", { length: 16 }),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});
export type TripMember = typeof tripMembers.$inferSelect;

export const tripDays = mysqlTable("trip_days", {
  id: serial("id").primaryKey(),
  tripId: bigint("tripId", { mode: "number", unsigned: true }).notNull(),
  date: varchar("date", { length: 10 }).notNull(),
  position: int("position").notNull().default(0),
  // How the traveler moves between stops this day - drives leg time estimates.
  transportMode: varchar("transportMode", { length: 16 }).default("car").notNull(), // walk | car | transit | train
  // Optional per-day lodging (when the trip doesn't keep one hotel throughout)
  hotelName: varchar("hotelName", { length: 255 }),
  hotelAddress: varchar("hotelAddress", { length: 512 }),
  hotelLat: double("hotelLat"),
  hotelLng: double("hotelLng"),
  // r24-smart: marked flexible from the weather advisory ("decide on the day")
  flexible: boolean("flexible").default(false).notNull(),
});
export type TripDay = typeof tripDays.$inferSelect;

export const stops = mysqlTable("stops", {
  id: serial("id").primaryKey(),
  tripId: bigint("tripId", { mode: "number", unsigned: true }).notNull(),
  dayId: bigint("dayId", { mode: "number", unsigned: true }), // null = unscheduled
  name: varchar("name", { length: 255 }).notNull(),
  category: varchar("category", { length: 32 }).default("activity").notNull(),
  address: varchar("address", { length: 512 }),
  lat: double("lat"),
  lng: double("lng"),
  startTime: varchar("startTime", { length: 5 }), // HH:MM
  durationMin: int("durationMin"),
  notes: text("notes"),
  image: varchar("image", { length: 512 }),
  famousEatery: boolean("famousEatery").default(false).notNull(), // stamped from explore_places at insert (r15-eats ★)
  position: int("position").notNull().default(0),
  // r24-core booking tracking: outbound booking happens off-platform (G is
  // honest deep links); the traveler pastes the confirmation URL here.
  bookingUrl: text("bookingUrl"),
  bookedAt: timestamp("bookedAt"), // null = not booked yet
  // r24-core per-leg transport: the leg LEADING to this stop from the
  // previous stop in the same day (walk | transit | train | flight | car).
  transportMode: varchar("transportMode", { length: 16 }),
  transportCents: int("transportCents"), // approx fare in trip home currency
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});
export type Stop = typeof stops.$inferSelect;

// ─── Expenses ────────────────────────────────────────────────────────────────
export const expenses = mysqlTable("expenses", {
  id: serial("id").primaryKey(),
  tripId: bigint("tripId", { mode: "number", unsigned: true }).notNull(),
  paidById: bigint("paidById", { mode: "number", unsigned: true }).notNull(),
  title: varchar("title", { length: 255 }).notNull(),
  category: varchar("category", { length: 32 }).default("other").notNull(),
  amountCents: int("amountCents").notNull(),
  currency: varchar("currency", { length: 3 }).notNull(),
  homeCents: int("homeCents").notNull(), // converted to trip home currency
  date: varchar("date", { length: 10 }).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});
export type Expense = typeof expenses.$inferSelect;

export const expenseSplits = mysqlTable("expense_splits", {
  id: serial("id").primaryKey(),
  expenseId: bigint("expenseId", { mode: "number", unsigned: true }).notNull(),
  memberId: bigint("memberId", { mode: "number", unsigned: true }).notNull(),
  shareCents: int("shareCents").notNull(), // in trip home currency
});

/**
 * r25: settlements - "X actually paid Y back".
 *
 * This was previously component state (`useState<Debt[]>` in BalancesCard),
 * so marking a debt settled vanished on refresh and the other person on the
 * trip never saw it. For a group-expense feature this is THE record that must
 * be durable: it's the moment real money changed hands.
 *
 * Amounts are integer minor units in the trip's home currency, matching
 * expenses.homeCents.
 */
export const settlements = mysqlTable(
  "settlements",
  {
    id: serial("id").primaryKey(),
    tripId: bigint("tripId", { mode: "number", unsigned: true }).notNull(),
    /** tripMembers.id of the payer (the debtor). */
    fromMemberId: bigint("fromMemberId", { mode: "number", unsigned: true }).notNull(),
    /** tripMembers.id of the recipient (the creditor). */
    toMemberId: bigint("toMemberId", { mode: "number", unsigned: true }).notNull(),
    amountCents: int("amountCents").notNull(),
    currency: varchar("currency", { length: 3 }).notNull(),
    note: varchar("note", { length: 255 }),
    /** users.id of whoever recorded it - for the activity trail. */
    recordedById: bigint("recordedById", { mode: "number", unsigned: true }).notNull(),
    settledAt: timestamp("settledAt").defaultNow().notNull(),
  },
  (t) => [index("idx_settlements_trip").on(t.tripId, t.id)],
);
export type Settlement = typeof settlements.$inferSelect;
export type ExpenseSplit = typeof expenseSplits.$inferSelect;

// ─── Reservations / checklists / notes ───────────────────────────────────────
export const reservations = mysqlTable("reservations", {
  id: serial("id").primaryKey(),
  tripId: bigint("tripId", { mode: "number", unsigned: true }).notNull(),
  type: varchar("type", { length: 24 }).notNull(), // flight | lodging | car | activity | other
  title: varchar("title", { length: 255 }).notNull(),
  provider: varchar("provider", { length: 255 }),
  confirmationCode: varchar("confirmationCode", { length: 64 }),
  startDate: varchar("startDate", { length: 10 }),
  endDate: varchar("endDate", { length: 10 }),
  details: text("details"),
  amountCents: int("amountCents"), // ticket/booking price (null = unknown)
  currency: varchar("currency", { length: 3 }),
  paidById: bigint("paidById", { mode: "number", unsigned: true }), // trip member who paid
  source: varchar("source", { length: 24 }).default("manual"), // manual | email-import
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});
export type Reservation = typeof reservations.$inferSelect;

export const checklistItems = mysqlTable("checklist_items", {
  id: serial("id").primaryKey(),
  tripId: bigint("tripId", { mode: "number", unsigned: true }).notNull(),
  list: varchar("list", { length: 24 }).notNull(), // packing | todo | shopping
  label: varchar("label", { length: 255 }).notNull(),
  done: boolean("done").default(false).notNull(),
  position: int("position").notNull().default(0),
});
export type ChecklistItem = typeof checklistItems.$inferSelect;

export const tripNotes = mysqlTable("trip_notes", {
  id: serial("id").primaryKey(),
  tripId: bigint("tripId", { mode: "number", unsigned: true }).notNull(),
  title: varchar("title", { length: 255 }).default("Notes"),
  content: text("content"),
  updatedAt: timestamp("updatedAt")
    .defaultNow()
    .notNull()
    .$onUpdate(() => new Date()),
});
export type TripNote = typeof tripNotes.$inferSelect;

// ─── Bucket list ─────────────────────────────────────────────────────────────
export const bucketList = mysqlTable("bucket_list", {
  id: serial("id").primaryKey(),
  userId: bigint("userId", { mode: "number", unsigned: true }).notNull(),
  name: varchar("name", { length: 255 }).notNull(),
  country: varchar("country", { length: 255 }),
  lat: double("lat"),
  lng: double("lng"),
  image: varchar("image", { length: 512 }),
  note: text("note"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});
export type BucketListItem = typeof bucketList.$inferSelect;

// ─── Subscription (premium tiers) ────────────────────────────────────────────
export const subscriptions = mysqlTable("subscriptions", {
  id: serial("id").primaryKey(),
  userId: bigint("userId", { mode: "number", unsigned: true })
    .notNull()
    .unique(),
  tier: mysqlEnum("tier", ["wanderer", "voyager"])
    .default("wanderer")
    .notNull(),
  status: varchar("status", { length: 24 }).default("active").notNull(),
  currentPeriodEnd: varchar("currentPeriodEnd", { length: 10 }),
  updatedAt: timestamp("updatedAt")
    .defaultNow()
    .notNull()
    .$onUpdate(() => new Date()),
});
export type Subscription = typeof subscriptions.$inferSelect;

// ─── Journal posts (travel blogs) ────────────────────────────────────────────
export const posts = mysqlTable("posts", {
  id: serial("id").primaryKey(),
  userId: bigint("userId", { mode: "number", unsigned: true }).notNull(),
  title: varchar("title", { length: 255 }).notNull(),
  content: text("content"),
  coverImage: varchar("coverImage", { length: 512 }),
  placeIds: json("placeIds").$type<number[]>(), // attached explore_places
  status: mysqlEnum("status", ["draft", "published"]).default("draft").notNull(),
  source: varchar("source", { length: 24 }).default("manual"), // manual | wanderlog
  sourceUrl: varchar("sourceUrl", { length: 512 }),
  gallery: json("gallery").$type<string[]>(), // extra image URLs shown as a grid
  likes: int("likes").default(0).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt")
    .defaultNow()
    .notNull()
    .$onUpdate(() => new Date()),
});
export type Post = typeof posts.$inferSelect;

// ─── Explore places (recommendation corpus) ──────────────────────────────────
export const explorePlaces = mysqlTable(
  "explore_places",
  {
  id: serial("id").primaryKey(),
  name: varchar("name", { length: 255 }).notNull(),
  nameLocal: varchar("nameLocal", { length: 255 }), // original local-script name when `name` is the English/Latin form (r19-portal)
  city: varchar("city", { length: 255 }).notNull(),
  country: varchar("country", { length: 255 }).notNull(),
  lat: double("lat"),
  lng: double("lng"),
  category: varchar("category", { length: 32 }).notNull(),
  tags: json("tags").$type<string[]>(),
  styles: json("styles").$type<string[]>(), // preference styles this place matches
  // NULL = we have no rating for this place. Do NOT reintroduce a default:
  // a plausible-looking default gets rendered as a real star rating and then
  // fed back into ranking, which is how ~442k OSM rows all ended up "4.3★".
  rating: double("rating"),
  priceLevel: int("priceLevel"), // 1-4, NULL = unknown (see note above)
  feeCents: int("feeCents"), // researched admission fee in local currency (0 = free, null = unknown)
  feeCurrency: varchar("feeCurrency", { length: 3 }),
  feeNote: varchar("feeNote", { length: 255 }), // e.g. "Adults ¥700 · under 18 free"
  image: varchar("image", { length: 512 }),
  description: text("description"),
  descriptionSource: varchar("descriptionSource", { length: 16 }), // curated | dbpedia | composed | user (NULL = no description provenance)
  hidden: boolean("hidden").default(false).notNull(), // hidden gem flag
  osmId: varchar("osmId", { length: 32 }), // OSM node/way id for dedupe of imported places
  source: varchar("source", { length: 16 }).default("curated"), // curated | osm | user
  addedById: bigint("addedById", { mode: "number", unsigned: true }), // user who submitted a user place
  approved: boolean("approved").default(true).notNull(), // user submissions start false until admin validates
  mealCents: int("mealCents"), // estimated avg meal per person (food places), local currency
  mealNote: varchar("mealNote", { length: 255 }), // e.g. "Mains €14–22 · lunch set €11"
  closedStatus: varchar("closedStatus", { length: 24 }).default("open"), // open | temporarily_closed | permanently_closed
  verdict: varchar("verdict", { length: 16 }), // must-see | worth-it | skip-if-tight (editorial/heuristic)
  photoSource: varchar("photoSource", { length: 32 }), // osm | wikipedia | curated (NULL = pool fallback)
  photoAttribution: varchar("photoAttribution", { length: 255 }), // license/author credit for real photos
  famousEatery: boolean("famousEatery").default(false).notNull(), // "★ Famous pick" - famous eatery per (city,country)
  /**
   * r28: what this row can actually offer a traveller, 0-100.
   *
   * Measured, not guessed: description length and provenance, whether a photo
   * exists, editorial verdict, famous-eatery flag, fee/meal data. Computed
   * once at import by db/import-corpus.ts.
   *
   * This exists because the corpus is 526,142 rows of which only ~1,300 score
   * 40 or above. Without a quality signal the feed treats a two-word OSM node
   * with no photo exactly like a written-up landmark, which is precisely how
   * the old fabricated "4.3 for everything" rating behaved. Ranking on this
   * is what makes a thin corpus feel curated instead of empty.
   */
  qualityScore: int("qualityScore").default(0).notNull(),
  /** Chain outlet (McDonald's, Lidl, TK Maxx). Real place, never a destination. */
  isChain: boolean("isChain").default(false).notNull(),
  /** Infrastructure, not a destination: parking, toilets, benches, ATMs. */
  isJunk: boolean("isJunk").default(false).notNull(),
  },
  (t) => [
    index("idx_explore_city_famous").on(t.city, t.country, t.famousEatery),
    // r22-speed: per-user submission lookups in explore.list (was a full scan)
    index("idx_explore_addedby").on(t.addedById),
    // r25: the index plan-r21.md promised and never shipped. Every bbox query
    // in explore-router (nearby / discoverArea / nearbyFood / matchPricesToStops)
    // was range-scanning the whole ~442k-row corpus for want of this.
    // Apply to an existing DB with: npx tsx db/migrate-r25-honest-data.ts --apply
    index("idx_explore_latlng").on(t.lat, t.lng),
    index("idx_explore_cat_latlng").on(t.category, t.lat, t.lng),
    // r28: city feeds rank by quality; without this every city page sorts
    // 526k rows in a filesort.
    index("idx_explore_city_quality").on(t.city, t.qualityScore),
    // r28: the global "best places" feed sorts the whole corpus by quality.
    // Measured at 79ms without this index on 526k rows, sub-millisecond with.
    index("idx_explore_quality").on(t.qualityScore),
  ],
);
export type ExplorePlace = typeof explorePlaces.$inferSelect;

// ─── Signature dishes per city (r16-culinary) ────────────────────────────────
// "Travel for the food": the dishes a city is known for, each mapped to the
// famous places that serve it. Imported from db/data/signature-dishes-*.json
// by db/import-signature-dishes.ts (idempotent wipe+reinsert per dish).
export const signatureDishes = mysqlTable(
  "signature_dishes",
  {
    id: serial("id").primaryKey(),
    city: varchar("city", { length: 128 }).notNull(),
    country: varchar("country", { length: 128 }).notNull(),
    dish: varchar("dish", { length: 128 }).notNull(),
    blurb: text("blurb"),
    position: int("position").default(0).notNull(),
  },
  (t) => [index("idx_signature_dishes_city").on(t.city, t.country)],
);
export type SignatureDish = typeof signatureDishes.$inferSelect;

export const signatureDishPlaces = mysqlTable(
  "signature_dish_places",
  {
    id: serial("id").primaryKey(),
    dishId: bigint("dishId", { mode: "number", unsigned: true })
      .notNull()
      .references(() => signatureDishes.id, { onDelete: "cascade" }),
    placeId: bigint("placeId", { mode: "number", unsigned: true }), // explore_places link when matched
    name: varchar("name", { length: 191 }).notNull(),
    lat: double("lat"),
    lng: double("lng"),
    why: varchar("why", { length: 255 }),
    position: int("position").default(0).notNull(),
  },
  (t) => [index("idx_signature_dish_places_dish").on(t.dishId)],
);
export type SignatureDishPlace = typeof signatureDishPlaces.$inferSelect;

// ─── Live location sharing between trip participants ─────────────────────────
export const locationShares = mysqlTable(
  "location_shares",
  {
    tripId: bigint("tripId", { mode: "number", unsigned: true }).notNull(),
    userId: bigint("userId", { mode: "number", unsigned: true }).notNull(),
    lat: double("lat"),
    lng: double("lng"),
    sharing: boolean("sharing").default(true).notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().notNull(),
  },
  (t) => [primaryKey({ columns: [t.tripId, t.userId] })],
);
export type LocationShare = typeof locationShares.$inferSelect;

// ─── City AI requests (users ask for AI itineraries in uncovered cities) ─────
export const cityRequests = mysqlTable(
  "city_requests",
  {
    id: serial("id").primaryKey(),
    userId: bigint("userId", { mode: "number", unsigned: true }).notNull(),
    city: varchar("city", { length: 255 }).notNull(),
    country: varchar("country", { length: 255 }),
    message: varchar("message", { length: 255 }),
    status: varchar("status", { length: 16 }).default("pending").notNull(), // pending | done
    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  (t) => [uniqueIndex("city_requests_user_city").on(t.userId, t.city)],
);
export type CityRequest = typeof cityRequests.$inferSelect;

// ─── Community comments on places ────────────────────────────────────────────
export const placeComments = mysqlTable("place_comments", {
  id: serial("id").primaryKey(),
  placeId: bigint("placeId", { mode: "number", unsigned: true }).notNull(),
  userId: bigint("userId", { mode: "number", unsigned: true }).notNull(),
  text: varchar("text", { length: 1000 }).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});
export type PlaceComment = typeof placeComments.$inferSelect;

// ─── Persistent server-side cache for external API responses ────────────────
export const apiCache = mysqlTable("api_cache", {
  k: varchar("k", { length: 191 }).primaryKey(),
  v: mediumtext("v").notNull(),
  expiresAt: timestamp("expiresAt").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

// ─── Support tickets (Voyager help widget → admin queue) ────────────────────
export const supportTickets = mysqlTable("support_tickets", {
  id: serial("id").primaryKey(),
  userId: bigint("userId", { mode: "number", unsigned: true }).notNull(),
  category: varchar("category", { length: 32 }).notNull(), // booking | routes | weather | kids | account | app | bug | other
  message: text("message").notNull(),
  email: varchar("email", { length: 320 }),
  status: varchar("status", { length: 16 }).default("open").notNull(), // open | closed
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});
export type SupportTicket = typeof supportTickets.$inferSelect;

// ─── Ready-made plan templates (clonable curated trips) ─────────────────────
export const tripTemplates = mysqlTable("trip_templates", {
  id: serial("id").primaryKey(),
  slug: varchar("slug", { length: 64 }).notNull().unique(),
  title: varchar("title", { length: 255 }).notNull(),
  destination: varchar("destination", { length: 255 }).notNull(),
  country: varchar("country", { length: 255 }),
  days: int("days").notNull(),
  summary: text("summary"),
  coverImage: varchar("coverImage", { length: 512 }),
  payloadJson: json("payloadJson").notNull(), // [{date offset, stops:[{name,category,lat,lng,durationMin,startTime,description}]}]
  popularity: int("popularity").default(0).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});
export type TripTemplate = typeof tripTemplates.$inferSelect;

// ── Friends planning (r12) ───────────────────────────────────────────────────
// A Voyager-gated group-planning session: the owner invites friends via personal
// links; everyone submits availability dates + preferences (optionally "let the
// group decide"); when ≥minAvailable participants align on a date window before
// the deadline, the app suggests destinations near the available members' home
// points and the owner converts the session into a shared trip.
export const friendSessions = mysqlTable("friend_sessions", {
  id: serial("id").primaryKey(),
  ownerId: bigint("ownerId", { mode: "number", unsigned: true }).notNull(),
  title: varchar("title", { length: 255 }).notNull(),
  status: varchar("status", { length: 16 }).default("voting").notNull(), // voting | met | converted
  deadlineAt: timestamp("deadlineAt").notNull(),
  minAvailable: int("minAvailable").default(2).notNull(),
  tripId: bigint("tripId", { mode: "number", unsigned: true }), // set on convert
  suggestionsJson: text("suggestionsJson"), // cached [{city,country,lat,lng,placeCount,avgKm}]
  // r24-social: optional pooled group budget for the planned trip
  budgetCents: int("budgetCents"),
  budgetCurrency: varchar("budgetCurrency", { length: 3 }).default("USD"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});
export type FriendSession = typeof friendSessions.$inferSelect;

export const friendParticipants = mysqlTable(
  "friend_participants",
  {
    id: serial("id").primaryKey(),
    sessionId: bigint("sessionId", { mode: "number", unsigned: true }).notNull(),
    userId: bigint("userId", { mode: "number", unsigned: true }), // linked when signed in
    token: varchar("token", { length: 36 }).notNull(), // personal invite-link secret
    name: varchar("name", { length: 255 }).notNull(),
    email: varchar("email", { length: 320 }),
    homeName: varchar("homeName", { length: 255 }),
    homeLat: double("homeLat"),
    homeLng: double("homeLng"),
    prefsJson: text("prefsJson"), // {styles:[], locationPref, region?, useGroupDecision}
    datesJson: text("datesJson"), // ["2026-08-14", ...] available dates
    submittedAt: timestamp("submittedAt"),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  (t) => [
    uniqueIndex("uq_fp_token").on(t.token),
    index("idx_fp_session").on(t.sessionId),
  ],
);
export type FriendParticipant = typeof friendParticipants.$inferSelect;

// r24-social: lean internal group chat for a friend planning session.
// Participant-token scoped (same credential model as the rest of friends
// planning); polled by the client, no websockets.
export const friendMessages = mysqlTable(
  "friend_messages",
  {
    id: serial("id").primaryKey(),
    sessionId: bigint("sessionId", { mode: "number", unsigned: true }).notNull(),
    userId: bigint("userId", { mode: "number", unsigned: true }), // null for guests
    name: varchar("name", { length: 255 }).notNull(), // display name at send time
    body: text("body").notNull(),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  (t) => [index("idx_fm_session").on(t.sessionId, t.id)],
);
export type FriendMessage = typeof friendMessages.$inferSelect;

// ── Published trips (r24-social, feature P) ──────────────────────────────────
// Explicit opt-in public page for a trip: /p/:slug shows the itinerary
// read-only plus an owner-posted updates feed; visitors can request to join.
export const publishedTrips = mysqlTable(
  "published_trips",
  {
    id: serial("id").primaryKey(),
    tripId: bigint("tripId", { mode: "number", unsigned: true }).notNull(),
    ownerId: bigint("ownerId", { mode: "number", unsigned: true }).notNull(),
    slug: varchar("slug", { length: 80 }).notNull(),
    title: varchar("title", { length: 255 }).notNull(),
    summary: text("summary"),
    isOpen: boolean("isOpen").default(true).notNull(), // accepting join requests
    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  (t) => [
    uniqueIndex("uq_pt_trip").on(t.tripId),
    uniqueIndex("uq_pt_slug").on(t.slug),
  ],
);
export type PublishedTrip = typeof publishedTrips.$inferSelect;

export const tripJoinRequests = mysqlTable(
  "trip_join_requests",
  {
    id: serial("id").primaryKey(),
    publishedId: bigint("publishedId", { mode: "number", unsigned: true }).notNull(),
    userId: bigint("userId", { mode: "number", unsigned: true }).notNull(),
    message: varchar("message", { length: 500 }),
    status: varchar("status", { length: 16 }).default("pending").notNull(), // pending | accepted | declined
    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  (t) => [
    uniqueIndex("uq_tjr_pub_user").on(t.publishedId, t.userId),
    index("idx_tjr_pub").on(t.publishedId),
  ],
);
export type TripJoinRequest = typeof tripJoinRequests.$inferSelect;

export const tripUpdates = mysqlTable(
  "trip_updates",
  {
    id: serial("id").primaryKey(),
    publishedId: bigint("publishedId", { mode: "number", unsigned: true }).notNull(),
    authorId: bigint("authorId", { mode: "number", unsigned: true }), // null for auto posts
    body: text("body").notNull(),
    kind: varchar("kind", { length: 16 }).default("note").notNull(), // note | booking | milestone
    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  (t) => [index("idx_tu_pub").on(t.publishedId, t.id)],
);
export type TripUpdate = typeof tripUpdates.$inferSelect;

// ─── r24-smart: premium foundation + smart features ──────────────────────────

/** Per-user external API usage metering (maps embeds, etc.) for monthly caps. */
export const apiUsage = mysqlTable(
  "api_usage",
  {
    id: serial("id").primaryKey(),
    userId: bigint("userId", { mode: "number", unsigned: true }).notNull(),
    kind: varchar("kind", { length: 32 }).notNull(), // e.g. "maps_embed"
    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  (t) => [index("idx_apiusage_user_kind").on(t.userId, t.kind, t.createdAt)],
);
export type ApiUsage = typeof apiUsage.$inferSelect;

/** In-app notifications - the delivery channel for weather/travel/wishlist prompts. */
export const notifications = mysqlTable(
  "notifications",
  {
    id: serial("id").primaryKey(),
    userId: bigint("userId", { mode: "number", unsigned: true }).notNull(),
    kind: varchar("kind", { length: 32 }).notNull(), // weather | travel | wishlist | tokens | reward | invite
    title: varchar("title", { length: 255 }).notNull(),
    body: text("body"),
    tripId: bigint("tripId", { mode: "number", unsigned: true }),
    readAt: timestamp("readAt"),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  (t) => [index("idx_notif_user").on(t.userId, t.id)],
);
export type Notification = typeof notifications.$inferSelect;

/** Wishlist trips - unplanned want-to-do destinations. */
export const wishlistTrips = mysqlTable(
  "wishlist_trips",
  {
    id: serial("id").primaryKey(),
    userId: bigint("userId", { mode: "number", unsigned: true }).notNull(),
    title: varchar("title", { length: 255 }).notNull(),
    destination: varchar("destination", { length: 255 }).notNull(),
    notes: text("notes"),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  (t) => [index("idx_wishlist_user").on(t.userId, t.id)],
);
export type WishlistTrip = typeof wishlistTrips.$inferSelect;

/** Token ledger - balance is SUM(amount); eventKey keeps awards idempotent. */
export const tokenEvents = mysqlTable(
  "token_events",
  {
    id: serial("id").primaryKey(),
    userId: bigint("userId", { mode: "number", unsigned: true }).notNull(),
    kind: varchar("kind", { length: 32 }).notNull(), // earn | redeem
    amount: int("amount").notNull(), // signed: earn positive, redeem negative
    eventKey: varchar("eventKey", { length: 128 }).notNull(),
    meta: text("meta"), // JSON extras
    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  (t) => [
    uniqueIndex("uq_token_event_key").on(t.userId, t.eventKey),
    index("idx_token_user").on(t.userId, t.id),
  ],
);
export type TokenEvent = typeof tokenEvents.$inferSelect;

/**
 * r27: one-time password reset tokens.
 *
 * Only the SHA-256 of the token is stored, so a database leak does not hand
 * an attacker working reset links - the same reason passwordHash exists
 * rather than a password column. `usedAt` makes a token single-use; rows are
 * swept opportunistically rather than by cron.
 */
export const passwordResets = mysqlTable(
  "password_resets",
  {
    id: serial("id").primaryKey(),
    userId: bigint("userId", { mode: "number", unsigned: true }).notNull(),
    tokenHash: varchar("tokenHash", { length: 64 }).notNull(),
    expiresAt: timestamp("expiresAt").notNull(),
    usedAt: timestamp("usedAt"),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  (t) => [
    uniqueIndex("uq_password_reset_token").on(t.tokenHash),
    index("idx_password_reset_user").on(t.userId, t.id),
  ],
);
export type PasswordReset = typeof passwordResets.$inferSelect;

/**
 * r27: Razorpay payment records.
 *
 * The subscriptions table holds the CURRENT entitlement; this table is the
 * audit trail of how it got there. Every row starts as `created` when the
 * client asks for an order and only becomes `paid` when a signature-verified
 * webhook (or a signature-verified client handoff) confirms it. Nothing here
 * trusts the browser - the old mock flipped the tier on an unauthenticated
 * client call, which meant anyone could grant themselves Voyager.
 */
export const payments = mysqlTable(
  "payments",
  {
    id: serial("id").primaryKey(),
    userId: bigint("userId", { mode: "number", unsigned: true }).notNull(),
    provider: varchar("provider", { length: 24 }).default("razorpay").notNull(),
    orderId: varchar("orderId", { length: 64 }).notNull(),
    paymentId: varchar("paymentId", { length: 64 }),
    // Integer minor units, matching the rest of the money code.
    amount: int("amount").notNull(),
    currency: varchar("currency", { length: 8 }).notNull(),
    // Named billingInterval, not interval: INTERVAL is a reserved word in
    // MySQL and an unquoted reference in any hand-written SQL would be a
    // syntax error waiting to happen.
    interval: mysqlEnum("billingInterval", ["monthly", "yearly"]).notNull(),
    status: mysqlEnum("status", ["created", "paid", "failed", "refunded"])
      .default("created")
      .notNull(),
    // Full provider payload for reconciliation and disputes.
    raw: text("raw"),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt")
      .defaultNow()
      .notNull()
      .$onUpdate(() => new Date()),
  },
  (t) => [
    uniqueIndex("uq_payment_order").on(t.orderId),
    index("idx_payment_user").on(t.userId, t.id),
  ],
);
export type Payment = typeof payments.$inferSelect;

/**
 * r27: cached FX rates.
 *
 * contracts/fx.ts ships a static table that was converting real money with no
 * refresh path - the INR rate alone drifted far enough to misreport a shared
 * expense. That table stays as the offline fallback; this holds the daily
 * refresh so the server can serve live rates and the client can cache them.
 */
export const fxRates = mysqlTable("fx_rates", {
  code: varchar("code", { length: 8 }).primaryKey(),
  perUsd: double("perUsd").notNull(),
  fetchedAt: timestamp("fetchedAt").defaultNow().notNull(),
});
export type FxRate = typeof fxRates.$inferSelect;

/** Virtual rewards shelf - redeemed against the token balance. */
export const rewardsRedeemed = mysqlTable(
  "rewards_redeemed",
  {
    id: serial("id").primaryKey(),
    userId: bigint("userId", { mode: "number", unsigned: true }).notNull(),
    rewardId: varchar("rewardId", { length: 64 }).notNull(),
    cost: int("cost").notNull(),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  (t) => [index("idx_rewards_user").on(t.userId, t.id)],
);
export type RewardRedeemed = typeof rewardsRedeemed.$inferSelect;
