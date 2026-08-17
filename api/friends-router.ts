/**
 * Friends planning (r12-friends) - Voyager-gated group trip planning.
 *
 * Flow: a Voyager owner creates a session and gets personal invite links
 * (one token per friend - the token IS the credential, no account needed).
 * Everyone submits availability dates + preferences (optionally "let the
 * group decide"). When ≥minAvailable participants align on a date before
 * the deadline, the session flips to 'met' and destination suggestions are
 * computed near the available members' home points from explore_places
 * clusters. The owner then converts the session into a shared trip shell
 * (trip + trip_members) and the group plans in the normal workspace.
 *
 * Privacy: guest-facing responses never expose other participants' tokens,
 * emails or userIds - only names, submission state, home city, date counts.
 */
import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import * as schema from "@db/schema";
import { getDb } from "./queries/connection";
import { authedQuery, createRouter, publicQuery } from "./middleware";
import { getTier } from "./queries/subscriptions";
import { searchPhotonCities } from "./queries/overpass";
import { PREFERENCE_STYLES } from "@contracts/premium";
import type { FriendParticipant, FriendSession } from "@db/schema";

const PRESENCE_COLORS = ["#BC5934", "#44604F", "#6E7FA3", "#A86B8C", "#B98A2E", "#6E9A8B"];

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const LOCATION_PREFS = ["near-me", "region", "anywhere"] as const;
const MIN_PLACES_PER_CITY = 15;
const NEAR_ME_KM = 300;
const IDEAL_KM = 800;

const MAX_PLAN_DATES = 120;

/** r24-social chat: message body cap. */
export const MAX_CHAT_BODY = 2000;

/**
 * Validate a chat message body: trimmed, 1..MAX_CHAT_BODY chars.
 * Returns an error message or null. Pure - exported for tests.
 */
export function chatBodyError(body: string): string | null {
  const t = body.trim();
  if (!t) return "Message can't be empty";
  if (t.length > MAX_CHAT_BODY) return `Keep messages under ${MAX_CHAT_BODY} characters`;
  return null;
}

const prefsSchema = z.object({
  dates: z.array(z.string().regex(ISO_DATE)).max(MAX_PLAN_DATES),
  styles: z.array(z.enum(PREFERENCE_STYLES)).max(PREFERENCE_STYLES.length),
  locationPref: z.enum(LOCATION_PREFS),
  region: z.string().trim().min(1).max(120).optional(),
  useGroupDecision: z.boolean(),
});

export type Suggestion = {
  city: string;
  country: string;
  lat: number;
  lng: number;
  placeCount: number;
  sumKm: number;
  availableCount: number;
  totalParticipants: number;
};

type Prefs = z.infer<typeof prefsSchema>;

function parseJson<T>(raw: string | null, fallback: T): T {
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function participantDates(p: FriendParticipant): string[] {
  const arr = parseJson<unknown>(p.datesJson, []);
  return Array.isArray(arr) ? arr.filter((d): d is string => typeof d === "string" && ISO_DATE.test(d)) : [];
}

function participantPrefs(p: FriendParticipant): Prefs | null {
  return parseJson<Prefs | null>(p.prefsJson, null);
}

/**
 * Validate availability picks: ISO dates within [today, today + 12 months],
 * at most MAX_PLAN_DATES unique entries. Returns an error message or null.
 */
export function planDateError(dates: string[], now = new Date()): string | null {
  if (dates.length === 0) return "Pick at least one date";
  if (dates.length > MAX_PLAN_DATES) return `Pick at most ${MAX_PLAN_DATES} dates`;
  const today = now.toISOString().slice(0, 10);
  const max = new Date(now);
  max.setUTCFullYear(max.getUTCFullYear() + 1);
  const maxIso = max.toISOString().slice(0, 10);
  for (const d of dates) {
    if (!ISO_DATE.test(d)) return "Dates must be ISO (YYYY-MM-DD)";
    if (d < today) return "Dates must be today or later";
    if (d > maxIso) return "Dates must be within the next 12 months";
  }
  return null;
}

/** Per-date available counts across submitted participants. */
export function tallyDates(participants: FriendParticipant[]): { date: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const p of participants) {
    if (!p.submittedAt) continue;
    for (const d of participantDates(p)) counts.set(d, (counts.get(d) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([date, count]) => ({ date, count }))
    .sort((a, b) => (a.date < b.date ? -1 : 1));
}

/** Earliest date reaching the session's availability threshold, if any. */
export function winningDateOf(tally: { date: string; count: number }[], minAvailable: number): string | null {
  return tally.find((t) => t.count >= minAvailable)?.date ?? null;
}

/** ALL dates reaching the threshold, ascending (tally is pre-sorted). */
export function winningDatesOf(tally: { date: string; count: number }[], minAvailable: number): string[] {
  return tally.filter((t) => t.count >= minAvailable).map((t) => t.date);
}

function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

function dateRange(start: string, end: string): string[] {
  const out: string[] = [];
  const d = new Date(start + "T00:00:00Z");
  const last = new Date(end + "T00:00:00Z");
  let i = 0;
  while (d <= last && i < 60) {
    out.push(d.toISOString().slice(0, 10));
    d.setUTCDate(d.getUTCDate() + 1);
    i++;
  }
  return out;
}

async function loadByToken(token: string) {
  const db = getDb();
  const [me] = await db
    .select()
    .from(schema.friendParticipants)
    .where(eq(schema.friendParticipants.token, token))
    .limit(1);
  if (!me) throw new TRPCError({ code: "NOT_FOUND", message: "Invite link not found" });
  const [session] = await db
    .select()
    .from(schema.friendSessions)
    .where(eq(schema.friendSessions.id, me.sessionId))
    .limit(1);
  if (!session) throw new TRPCError({ code: "NOT_FOUND", message: "Session not found" });
  const participants = await db
    .select()
    .from(schema.friendParticipants)
    .where(eq(schema.friendParticipants.sessionId, session.id));
  return { db, me, session, participants };
}

/**
 * r24-social "not connecting" fix: a participant row linked to a userId is
 * PERSONAL. Anyone else opening that link (a friend who was sent the
 * organizer's own link, or a logged-out viewer of a claimed link) must not
 * silently act as that person - writes used to overwrite the real
 * participant's row, so two people shared one vote and the group never
 * genuinely connected. Returns true when the link is claimed by someone else.
 */
export function claimedByOther(
  me: Pick<FriendParticipant, "userId">,
  viewerId: number | null | undefined,
): boolean {
  return me.userId != null && me.userId !== (viewerId ?? null);
}

/** Throw when the token's participant row belongs to a different account. */
function assertTokenUsable(
  me: Pick<FriendParticipant, "userId">,
  viewerId: number | null | undefined,
) {
  if (claimedByOther(me, viewerId)) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "This invite link belongs to someone else. Sign in with the right account or ask the organizer for your own link.",
    });
  }
}

function ownerParticipant(session: FriendSession, participants: FriendParticipant[]) {
  return participants.find((p) => p.userId === session.ownerId) ?? participants[0]!;
}

/**
 * Load session state by participant token and lazily flip voting → met when
 * the threshold is reached on some date. Shared by the public getters.
 */
async function sessionStateByToken(token: string) {
  const { db, me, session, participants } = await loadByToken(token);
  const tally = tallyDates(participants);
  const winningDates = winningDatesOf(tally, session.minAvailable);
  const winningDate = winningDates[0] ?? null;
  let status = session.status;
  if (status === "voting" && winningDate) {
    status = "met";
    await db
      .update(schema.friendSessions)
      .set({ status: "met" })
      .where(eq(schema.friendSessions.id, session.id));
  }
  return { db, me, session: { ...session, status }, participants, tally, winningDate, winningDates };
}

/** Guest-safe participant projection - no tokens, emails or userIds. */
function publicParticipant(p: FriendParticipant, winningDate: string | null) {
  return {
    name: p.name,
    submitted: p.submittedAt != null,
    homeName: p.homeName,
    datesCount: participantDates(p).length,
    availableOnWinningDate: winningDate ? participantDates(p).includes(winningDate) : false,
  };
}

export const friendsRouter = createRouter({
  /** Public Photon city search for the home-city combobox on the join form. */
  searchCities: publicQuery
    .input(z.object({ query: z.string().trim().min(2).max(120) }))
    .query(async ({ input }) => {
      return searchPhotonCities(input.query, 5);
    }),

  /** Voyager-only ("at least one needs pro" - the owner is the pro). */
  createSession: authedQuery
    .input(
      z.object({
        title: z.string().trim().min(1).max(255),
        deadlineAt: z.date(),
        minAvailable: z.number().int().min(1).max(50),
        // r24-social: optional pooled group budget
        budgetCents: z.number().int().min(0).max(1_000_000_000).nullable().optional(),
        budgetCurrency: z.string().trim().length(3).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const tier = await getTier(ctx.user.id);
      if (tier !== "voyager") {
        throw new TRPCError({ code: "FORBIDDEN", message: "UPGRADE_REQUIRED" });
      }
      if (input.deadlineAt.getTime() <= Date.now()) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Deadline must be in the future" });
      }
      const db = getDb();
      const result = await db.insert(schema.friendSessions).values({
        ownerId: ctx.user.id,
        title: input.title,
        deadlineAt: input.deadlineAt,
        minAvailable: input.minAvailable,
        status: "voting",
        budgetCents: input.budgetCents && input.budgetCents > 0 ? input.budgetCents : null,
        budgetCurrency: (input.budgetCurrency ?? "USD").toUpperCase(),
      });
      const sessionId = Number(result[0].insertId);
      const ownerToken = crypto.randomUUID();
      await db.insert(schema.friendParticipants).values({
        sessionId,
        userId: ctx.user.id,
        token: ownerToken,
        name: ctx.user.name ?? "Organizer",
        email: ctx.user.email ?? null,
      });
      const [session] = await db
        .select()
        .from(schema.friendSessions)
        .where(eq(schema.friendSessions.id, sessionId))
        .limit(1);
      return { session: session!, ownerToken, invitePath: `/friends/${ownerToken}` };
    }),

  /** Sessions the signed-in user owns or participates in (own token only). */
  mySessions: authedQuery.query(async ({ ctx }) => {
    const db = getDb();
    const mine = await db
      .select()
      .from(schema.friendParticipants)
      .where(eq(schema.friendParticipants.userId, ctx.user.id));
    if (!mine.length) return { sessions: [] };
    const out = [];
    for (const p of mine) {
      const [s] = await db
        .select()
        .from(schema.friendSessions)
        .where(eq(schema.friendSessions.id, p.sessionId))
        .limit(1);
      if (!s) continue;
      out.push({
        id: s.id,
        title: s.title,
        status: s.status,
        deadlineAt: s.deadlineAt,
        minAvailable: s.minAvailable,
        tripId: s.tripId,
        budgetCents: s.budgetCents,
        budgetCurrency: s.budgetCurrency,
        role: s.ownerId === ctx.user.id ? ("owner" as const) : ("participant" as const),
        token: p.token,
        path: `/friends/${p.token}`,
      });
    }
    out.sort((a, b) => b.id - a.id);
    return { sessions: out };
  }),

  /**
   * Owner-only: mint a fresh personal invite link (a placeholder participant
   * row the guest "claims" via joinByToken). The new token is returned here
   * only - it never appears in getSessionByToken responses.
   */
  createInvite: publicQuery
    .input(z.object({ token: z.string().min(8).max(36) }))
    .mutation(async ({ input }) => {
      const { db, me, session } = await loadByToken(input.token);
      if (me.userId !== session.ownerId) {
        throw new TRPCError({ code: "FORBIDDEN", message: "Only the organizer can invite friends" });
      }
      if (session.status === "converted") {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Session already converted to a trip" });
      }
      const token = crypto.randomUUID();
      await db.insert(schema.friendParticipants).values({
        sessionId: session.id,
        token,
        name: "Invited friend",
      });
      return { token, path: `/friends/${token}` };
    }),

  /** Public session view + tally. Lazily flips voting → met. */
  getSessionByToken: publicQuery
    .input(z.object({ token: z.string().min(8).max(36) }))
    .query(async ({ input, ctx }) => {
      const { db, me, session, participants, tally, winningDate, winningDates } = await sessionStateByToken(input.token);
      // Link a signed-in visitor to their participant row once.
      if (ctx.user && me.userId == null) {
        await db
          .update(schema.friendParticipants)
          .set({ userId: ctx.user.id, email: me.email ?? ctx.user.email ?? null })
          .where(eq(schema.friendParticipants.id, me.id));
        me.userId = ctx.user.id;
      }
      const owner = ownerParticipant(session, participants);
      const claimed = claimedByOther(me, ctx.user?.id);
      return {
        session: {
          id: session.id,
          title: session.title,
          status: session.status,
          deadlineAt: session.deadlineAt,
          minAvailable: session.minAvailable,
          tripId: session.tripId,
          createdAt: session.createdAt,
          budgetCents: session.budgetCents,
          budgetCurrency: session.budgetCurrency,
        },
        me, // the caller's own row - full, for the form
        isOwner: !claimed && me.id === owner.id,
        /** r24-social: this link is already claimed by a different account -
         *  the UI must explain instead of letting the visitor overwrite them. */
        claimedByOther: claimed,
        ownerName: owner.name,
        participants: participants.map((p) => publicParticipant(p, winningDate)),
        tally,
        winningDate,
        winningDates,
        suggestions:
          session.status !== "voting" ? parseJson<Suggestion[]>(session.suggestionsJson, []) : [],
      };
    }),

  /**
   * Claim/update the caller's participant row: name + home city (coords from
   * Photon). Anonymous guests may leave an email so a LATER account with the
   * same email claims the participation on login (r15-access) - and, if the
   * session was converted, becomes a member of the resulting trip.
   */
  joinByToken: publicQuery
    .input(
      z.object({
        token: z.string().min(8).max(36),
        name: z.string().trim().min(1).max(255),
        homeName: z.string().trim().min(1).max(255),
        homeLat: z.number().min(-90).max(90),
        homeLng: z.number().min(-180).max(180),
        email: z.string().trim().email().max(320).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const { db, me } = await loadByToken(input.token);
      assertTokenUsable(me, ctx.user?.id);
      await db
        .update(schema.friendParticipants)
        .set({
          name: input.name,
          homeName: input.homeName,
          homeLat: input.homeLat,
          homeLng: input.homeLng,
          ...(ctx.user && me.userId == null
            ? { userId: ctx.user.id, email: me.email ?? ctx.user.email ?? null }
            : {}),
          ...(!ctx.user && input.email ? { email: input.email.toLowerCase() } : {}),
        })
        .where(eq(schema.friendParticipants.id, me.id));
      return { ok: true };
    }),

  /** Submit availability dates + preferences (or "let the group decide"). */
  submitPlan: publicQuery
    .input(z.object({ token: z.string().min(8).max(36) }).and(prefsSchema))
    .mutation(async ({ ctx, input }) => {
      const { db, me } = await loadByToken(input.token);
      assertTokenUsable(me, ctx.user?.id);
      if (input.locationPref === "region" && !input.useGroupDecision && !input.region) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Name the region you prefer" });
      }
      const dates = [...new Set(input.dates)].sort();
      const dateError = planDateError(dates);
      if (dateError) throw new TRPCError({ code: "BAD_REQUEST", message: dateError });
      const prefs: Prefs = {
        dates,
        styles: input.useGroupDecision ? [] : input.styles,
        locationPref: input.useGroupDecision ? "anywhere" : input.locationPref,
        region: input.useGroupDecision ? undefined : input.region,
        useGroupDecision: input.useGroupDecision,
      };
      await db
        .update(schema.friendParticipants)
        .set({
          prefsJson: JSON.stringify(prefs),
          datesJson: JSON.stringify(dates),
          submittedAt: new Date(),
          ...(ctx.user && me.userId == null
            ? { userId: ctx.user.id, email: me.email ?? ctx.user.email ?? null }
            : {}),
        })
        .where(eq(schema.friendParticipants.id, me.id));
      return { ok: true, datesCount: dates.length };
    }),

  /**
   * Destination suggestions once the threshold is met: candidate cities are
   * explore_places clusters (≥15 places); scoring prefers rich cities close
   * to the available members' homes. Cached in session.suggestionsJson.
   */
  suggestDestinations: publicQuery
    .input(z.object({ token: z.string().min(8).max(36) }))
    .query(async ({ input }) => {
      const { db, session, participants, winningDate } = await sessionStateByToken(input.token);
      if (session.status === "voting" || !winningDate) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Threshold not met yet" });
      }
      const available = participants.filter(
        (p) => p.submittedAt && participantDates(p).includes(winningDate),
      );
      const homes = available.filter((p) => p.homeLat != null && p.homeLng != null);
      if (!available.length || !homes.length) return { suggestions: [], winningDate };

      const cached = parseJson<Suggestion[]>(session.suggestionsJson, []);
      if (cached.length) return { suggestions: cached, winningDate };

      const cities = await db
        .select({
          city: schema.explorePlaces.city,
          country: schema.explorePlaces.country,
          count: sql<number>`count(*)`.mapWith(Number),
          lat: sql<number>`avg(${schema.explorePlaces.lat})`.mapWith(Number),
          lng: sql<number>`avg(${schema.explorePlaces.lng})`.mapWith(Number),
        })
        .from(schema.explorePlaces)
        .where(and(eq(schema.explorePlaces.approved, true), sql`${schema.explorePlaces.lat} IS NOT NULL`))
        .groupBy(schema.explorePlaces.city, schema.explorePlaces.country)
        .having(sql`count(*) >= ${MIN_PLACES_PER_CITY}`);

      // Majority location preference of the available group steers candidates.
      const prefs = available
        .map((p) => participantPrefs(p))
        .filter((x): x is Prefs => x != null);
      const prefCount = (k: (typeof LOCATION_PREFS)[number]) =>
        prefs.filter((p) => p.locationPref === k).length;
      const nearMeMajority = prefCount("near-me") > available.length / 2;
      const regionMajority = prefCount("region") > available.length / 2;
      const regionText = regionMajority
        ? (prefs.find((p) => p.locationPref === "region" && p.region)?.region ?? "").toLowerCase()
        : "";

      const median = (xs: number[]) => {
        const s = [...xs].sort((a, b) => a - b);
        return s[Math.floor(s.length / 2)]!;
      };
      const medianHome = {
        lat: median(homes.map((h) => h.homeLat!)),
        lng: median(homes.map((h) => h.homeLng!)),
      };

      let candidates = cities.map((c) => {
        const sumKm = homes.reduce((acc, h) => acc + haversineKm(c.lat, c.lng, h.homeLat!, h.homeLng!), 0);
        const kmFromMedian = haversineKm(c.lat, c.lng, medianHome.lat, medianHome.lng);
        // Some corpus rows store the country in the city field ("Kochi, India") - strip it.
        const city = c.city.endsWith(`, ${c.country}`) ? c.city.slice(0, -(c.country.length + 2)) : c.city;
        return { ...c, city, sumKm: Math.round(sumKm), kmFromMedian };
      });

      const inRegion = regionText
        ? candidates.filter(
            (c) =>
              c.city.toLowerCase().includes(regionText) ||
              c.country.toLowerCase().includes(regionText),
          )
        : [];
      if (regionMajority && inRegion.length) candidates = inRegion;
      const nearby = candidates.filter((c) => c.kmFromMedian <= NEAR_ME_KM);
      if (nearMeMajority && nearby.length) candidates = nearby;

      const suggestions: Suggestion[] = candidates
        .map((c) => ({
          city: c.city,
          country: c.country,
          lat: Math.round(c.lat * 1000) / 1000,
          lng: Math.round(c.lng * 1000) / 1000,
          placeCount: c.count,
          sumKm: c.sumKm,
          availableCount: available.length,
          totalParticipants: participants.length,
          // Richness × proximity decay: cities within ~IDEAL_KM of the group
          // score well; far clusters need a much bigger corpus to compete.
          score: c.count * Math.exp(-c.sumKm / homes.length / (IDEAL_KM / 2)),
        }))
        .sort((a, b) => b.score - a.score)
        .slice(0, 6)
        .map(({ score: _score, ...rest }) => rest);

      await db
        .update(schema.friendSessions)
        .set({ suggestionsJson: JSON.stringify(suggestions) })
        .where(eq(schema.friendSessions.id, session.id));
      return { suggestions, winningDate };
    }),

  /**
   * Owner-only (owner's participant token is the credential): convert the
   * session into a shared trip shell - trip row + trip_days + trip_members
   * (owner + every participant linked to a userId as editor). The itinerary
   * is generated later in the normal workspace.
   */
  convert: publicQuery
    .input(
      z.object({
        token: z.string().min(8).max(36),
        city: z.string().trim().min(1).max(255),
        country: z.string().trim().min(1).max(255),
        startDate: z.string().regex(ISO_DATE),
        days: z.number().int().min(2).max(7),
      }),
    )
    .mutation(async ({ input }) => {
      const { db, me, session, participants, winningDate } = await sessionStateByToken(input.token);
      if (me.userId !== session.ownerId) {
        throw new TRPCError({ code: "FORBIDDEN", message: "Only the organizer can start the trip" });
      }
      if (session.status === "converted" && session.tripId) return { tripId: session.tripId };
      if (session.status === "voting") {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Threshold not met yet" });
      }
      const [ownerUser] = await db
        .select()
        .from(schema.users)
        .where(eq(schema.users.id, session.ownerId))
        .limit(1);
      const start = new Date(input.startDate + "T00:00:00Z");
      const end = new Date(start);
      end.setUTCDate(end.getUTCDate() + input.days - 1);
      const endDate = end.toISOString().slice(0, 10);

      const result = await db.insert(schema.trips).values({
        ownerId: session.ownerId,
        title: session.title,
        destination: `${input.city}, ${input.country}`,
        startDate: input.startDate,
        endDate,
        homeCurrency: "USD",
        // r24-social: the pooled group budget carries over to the shared trip.
        budgetCents: session.budgetCents ?? 0,
        budgetCurrency: session.budgetCurrency ?? "USD",
      });
      const tripId = Number(result[0].insertId);
      await db.insert(schema.tripMembers).values({
        tripId,
        userId: session.ownerId,
        name: ownerUser?.name ?? me.name,
        email: ownerUser?.email ?? null,
        role: "owner",
        presenceColor: PRESENCE_COLORS[0],
      });
      let color = 1;
      for (const p of participants) {
        if (p.userId == null || p.userId === session.ownerId) continue;
        await db.insert(schema.tripMembers).values({
          tripId,
          userId: p.userId,
          name: p.name,
          email: p.email ?? null,
          role: "editor",
          presenceColor: PRESENCE_COLORS[color++ % PRESENCE_COLORS.length],
        });
      }
      const dates = dateRange(input.startDate, endDate);
      if (dates.length) {
        await db.insert(schema.tripDays).values(dates.map((date, i) => ({ tripId, date, position: i })));
      }
      await db
        .update(schema.friendSessions)
        .set({ status: "converted", tripId })
        .where(eq(schema.friendSessions.id, session.id));
      // r24-smart Q: +25 tokens for completing a friend session (once).
      {
        const { awardTokens } = await import("./lib/tokens");
        await awardTokens(session.ownerId, "friend_session", `friends:${session.id}`, { tripId });
      }
      return { tripId, winningDate };
    }),

  /**
   * r24-social: owner-only pooled budget for the session (settable any time
   * before/after convert; null clears it). Owner token is the credential.
   */
  setBudget: publicQuery
    .input(
      z.object({
        token: z.string().min(8).max(36),
        budgetCents: z.number().int().min(0).max(1_000_000_000).nullable(),
        budgetCurrency: z.string().trim().length(3).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const { db, me, session } = await loadByToken(input.token);
      assertTokenUsable(me, ctx.user?.id);
      if (me.userId !== session.ownerId) {
        throw new TRPCError({ code: "FORBIDDEN", message: "Only the organizer can set the budget" });
      }
      await db
        .update(schema.friendSessions)
        .set({
          budgetCents: input.budgetCents && input.budgetCents > 0 ? input.budgetCents : null,
          ...(input.budgetCurrency ? { budgetCurrency: input.budgetCurrency.toUpperCase() } : {}),
        })
        .where(eq(schema.friendSessions.id, session.id));
      return { ok: true };
    }),

  /**
   * r24-social internal group chat. Lean polling model: the client lists with
   * a since-id watermark every few seconds and sends via the participant
   * token (the same credential as voting). Bodies are plain text, 1..2000
   * chars after trimming.
   */
  listMessages: publicQuery
    .input(
      z.object({
        token: z.string().min(8).max(36),
        sinceId: z.number().int().min(0).default(0),
      }),
    )
    .query(async ({ input }) => {
      const { db, me, session } = await loadByToken(input.token);
      const rows = await db
        .select()
        .from(schema.friendMessages)
        .where(
          and(
            eq(schema.friendMessages.sessionId, session.id),
            sql`${schema.friendMessages.id} > ${input.sinceId}`,
          ),
        )
        .orderBy(schema.friendMessages.id)
        .limit(200);
      return {
        messages: rows.map((m) => ({
          id: m.id,
          name: m.name,
          body: m.body,
          createdAt: m.createdAt,
          // "mine" without leaking userIds: match the linked account, else
          // fall back to the sender name on this participant row.
          mine: m.userId != null && me.userId != null ? m.userId === me.userId : m.name === me.name,
        })),
      };
    }),

  sendMessage: publicQuery
    .input(
      z.object({
        token: z.string().min(8).max(36),
        body: z.string().max(MAX_CHAT_BODY * 2), // hard cap; real limit checked post-trim
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const { db, me, session } = await loadByToken(input.token);
      assertTokenUsable(me, ctx.user?.id);
      const err = chatBodyError(input.body);
      if (err) throw new TRPCError({ code: "BAD_REQUEST", message: err });
      const body = input.body.trim();
      // Guests must at least have named themselves (join form) before chatting.
      const name = me.name && me.name !== "Invited friend" ? me.name : null;
      if (!name) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Join the plan with your name first" });
      }
      const res = await db.insert(schema.friendMessages).values({
        sessionId: session.id,
        userId: me.userId ?? ctx.user?.id ?? null,
        name,
        body,
      });
      return { ok: true, id: Number(res[0].insertId) };
    }),
});
