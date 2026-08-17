import { and, desc, eq, inArray, lt, or, sql } from "drizzle-orm";
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import * as schema from "@db/schema";
import { getDb } from "./queries/connection";
import {
  corpusMatchesForText,
  lookupOsmPlace,
  normPlace,
  suggestPlacesForText,
} from "./queries/place-match";
import { reverseGeocodePoint } from "./queries/overpass";
import { verdictFor } from "./lib/verdict";
import { authedQuery, createRouter, publicQuery } from "./middleware";

type PostWithAuthor = schema.Post & { authorName: string | null; authorAvatar: string | null };

/**
 * Decode a "<likes>:<id>" feed cursor. Anything malformed is treated as no
 * cursor (first page) rather than an error - a stale or hand-edited cursor
 * should show the user the top of the feed, not a 400.
 */
function parseFeedCursor(cursor: string | null | undefined): { likes: number; id: number } | null {
  if (!cursor) return null;
  const m = /^(\d{1,10}):(\d{1,15})$/.exec(cursor);
  if (!m) return null;
  const likes = Number(m[1]);
  const id = Number(m[2]);
  if (!Number.isSafeInteger(likes) || !Number.isSafeInteger(id)) return null;
  return { likes, id };
}

/** Places newly auto-attached on publish - reported back so the editor can note them. */
interface AutoAttachedPlace {
  id: number;
  name: string;
  city: string;
  /** true when the place was just imported into the corpus from OSM */
  imported?: boolean;
}

/** Great-circle distance in km (haversine) - import dedupe radius checks. */
function kmBetween(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const R = 6371;
  const dLat = ((bLat - aLat) * Math.PI) / 180;
  const dLng = ((bLng - aLng) * Math.PI) / 180;
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((aLat * Math.PI) / 180) * Math.cos((bLat * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

// ─── OSM import (blog places keep enriching the corpus) ─────────────────────

export interface OsmDraft {
  name: string;
  city?: string;
  country?: string;
  lat?: number;
  lng?: number;
  osmId?: string;
  osmKey?: string;
  osmValue?: string;
}

const OSM_FOOD_AMENITIES = new Set([
  "restaurant", "cafe", "bar", "fast_food", "food_court", "marketplace",
  "ice_cream", "pub", "biergarten",
]);

/** Map Photon osm_key/osm_value onto our category/tags/styles vocabulary. */
function osmKindMeta(osmKey?: string, osmValue?: string): {
  category: string;
  tags: string[];
  styles: string[];
} {
  if (osmKey === "amenity" && osmValue && OSM_FOOD_AMENITIES.has(osmValue)) {
    if (osmValue === "cafe") return { category: "food", tags: ["coffee"], styles: ["food"] };
    if (osmValue === "bar" || osmValue === "pub" || osmValue === "biergarten") {
      return { category: "food", tags: ["drinks", "nightlife"], styles: ["food"] };
    }
    if (osmValue === "marketplace") return { category: "food", tags: ["market", "food"], styles: ["food"] };
    return { category: "food", tags: ["food"], styles: ["food"] };
  }
  if (osmKey === "tourism") {
    switch (osmValue) {
      case "museum": return { category: "activity", tags: ["museum"], styles: ["historical"] };
      case "gallery": return { category: "activity", tags: ["art", "museum"], styles: ["historical"] };
      case "viewpoint": return { category: "activity", tags: ["views"], styles: ["adventure"] };
      case "zoo": case "aquarium": case "theme_park":
        return { category: "activity", tags: ["family"], styles: ["adventure"] };
      case "artwork": return { category: "activity", tags: ["art"], styles: [] };
      case "hotel": case "hostel": case "guest_house":
        return { category: "lodging", tags: [], styles: [] };
      default: return { category: "activity", tags: ["landmark"], styles: [] };
    }
  }
  if (osmKey === "historic") {
    if (osmValue === "castle" || osmValue === "palace" || osmValue === "fort") {
      return { category: "activity", tags: ["castle", "historic"], styles: ["historical"] };
    }
    if (osmValue === "ruins" || osmValue === "archaeological_site") {
      return { category: "activity", tags: ["ruins", "historic"], styles: ["historical"] };
    }
    return { category: "activity", tags: ["historic", "landmark"], styles: ["historical"] };
  }
  if (osmKey === "leisure") return { category: "activity", tags: ["nature"], styles: ["relaxing"] };
  if (osmKey === "amenity" && osmValue === "place_of_worship") {
    return { category: "activity", tags: ["historic"], styles: ["historical"] };
  }
  return { category: "activity", tags: [], styles: [] };
}

/**
 * Persist a confident OSM/Photon hit into explore_places (source 'osm',
 * approved, verdict stamped) so blog ingestion keeps enriching the corpus.
 * Idempotent: dedupes on osmId first, then on normalized name within 0.3 km;
 * an existing row is returned as-is. Null when the hit lacks coordinates.
 */
export async function importOsmPlace(draft: OsmDraft): Promise<{ id: number; name: string; city: string } | null> {
  if (draft.lat == null || draft.lng == null) return null;
  const db = getDb();
  if (draft.osmId) {
    const [byOsm] = await db
      .select({ id: schema.explorePlaces.id, name: schema.explorePlaces.name, city: schema.explorePlaces.city })
      .from(schema.explorePlaces)
      .where(eq(schema.explorePlaces.osmId, draft.osmId))
      .limit(1);
    if (byOsm) return byOsm;
  }
  const nameKey = draft.name.trim().replace(/\s+/g, " ").toLowerCase();
  const sameName = await db
    .select({
      id: schema.explorePlaces.id,
      name: schema.explorePlaces.name,
      city: schema.explorePlaces.city,
      lat: schema.explorePlaces.lat,
      lng: schema.explorePlaces.lng,
    })
    .from(schema.explorePlaces)
    .where(sql`LOWER(TRIM(${schema.explorePlaces.name})) = ${nameKey}`);
  const near = sameName.find(
    (p) => p.lat != null && p.lng != null && kmBetween(p.lat, p.lng, draft.lat!, draft.lng!) <= 0.3,
  );
  if (near) return { id: near.id, name: near.name, city: near.city };

  let city = (draft.city ?? "").trim();
  let country = (draft.country ?? "").trim();
  if (!city || !country) {
    const geo = await reverseGeocodePoint(draft.lat, draft.lng);
    city = city || geo?.city || "";
    country = country || geo?.country || "";
  }
  const meta = osmKindMeta(draft.osmKey, draft.osmValue);
  const verdict = verdictFor({
    name: draft.name,
    city,
    country,
    category: meta.category,
    tags: meta.tags,
    // r25: OSM carries no rating. Was 4.3 here too - see overpass.ts/coverage.ts.
    rating: null,
  });
  const result = await db.insert(schema.explorePlaces).values({
    name: draft.name.slice(0, 255),
    city,
    country,
    lat: draft.lat,
    lng: draft.lng,
    category: meta.category,
    tags: meta.tags.slice(0, 3),
    styles: meta.styles.slice(0, 2),
    // r25: this import path was still writing the fabricated constants after
    // overpass.ts and coverage.ts had been fixed, which would have quietly
    // reintroduced 4.3-rated rows the migration script had just purged.
    rating: null,
    priceLevel: null,
    osmId: draft.osmId ?? null,
    source: "osm",
    approved: true,
    hidden: false,
    verdict,
  });
  return { id: Number(result[0].insertId), name: draft.name, city };
}

/** Corpus rows minus permanently-closed places (demoted out of suggestions). */
async function openCorpus() {
  const all = await getDb().select({
    id: schema.explorePlaces.id,
    name: schema.explorePlaces.name,
    city: schema.explorePlaces.city,
    country: schema.explorePlaces.country,
    closedStatus: schema.explorePlaces.closedStatus,
  }).from(schema.explorePlaces);
  return all.filter((p) => p.closedStatus !== "permanently_closed");
}

/**
 * Place detection over title+content. Corpus matches attach directly; the
 * full pipeline (bounded Photon lookups) runs too, and confident OSM hits are
 * IMPORTED into explore_places before attaching - blogs keep enriching the
 * cache. Returns the merged placeIds (existing preserved, matched appended,
 * capped at 20) and the newly added ones. Re-runs union without duplicating.
 */
async function autoAttachPlaces(
  text: string,
  existing: number[],
): Promise<{ placeIds: number[]; autoAttached: AutoAttachedPlace[] }> {
  const open = await openCorpus();
  const matched = corpusMatchesForText(open, text);
  const placeIds = [...existing];
  const autoAttached: AutoAttachedPlace[] = [];
  const push = (p: { id: number; name: string; city: string }, imported: boolean) => {
    if (placeIds.length >= 20 || placeIds.includes(p.id)) return;
    placeIds.push(p.id);
    autoAttached.push({ id: p.id, name: p.name, city: p.city, imported });
  };
  for (const p of matched) push(p, false);
  const suggestions = await suggestPlacesForText(open, text);
  for (const s of suggestions) {
    if (placeIds.length >= 20) break;
    if (s.source !== "osm") continue;
    const place = await importOsmPlace(s);
    if (place) push(place, true);
  }
  return { placeIds, autoAttached };
}

/** Gallery images: absolute URLs or site-relative paths, max 8 per post. */
const galleryInput = z.array(z.string().url().or(z.string().startsWith("/"))).max(8).optional();

async function withAuthors(rows: schema.Post[]): Promise<PostWithAuthor[]> {
  if (!rows.length) return [];
  const db = getDb();
  const userIds = [...new Set(rows.map((p) => p.userId))];
  const users = await db.select().from(schema.users).where(inArray(schema.users.id, userIds));
  const byId = new Map(users.map((u) => [u.id, u]));
  return rows.map((p) => ({
    ...p,
    authorName: byId.get(p.userId)?.name ?? "Traveler",
    authorAvatar: byId.get(p.userId)?.avatar ?? null,
  }));
}

// ─── Wanderlog import helpers ────────────────────────────────────────────────
function extractJsonLdNames(html: string): string[] {
  const names: string[] = [];
  const blocks = html.match(/<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi) ?? [];
  for (const block of blocks) {
    const json = block.replace(/<script[^>]*>/i, "").replace(/<\/script>/i, "").trim();
    try {
      const data = JSON.parse(json);
      const items = Array.isArray(data) ? data : [data];
      const walk = (node: unknown) => {
        if (!node || typeof node !== "object") return;
        const n = node as Record<string, unknown>;
        const type = n["@type"];
        const types = Array.isArray(type) ? type : [type];
        if (
          types.some((t) => typeof t === "string" && /touristattraction|place|restaurant|lodging|pointofinterest/i.test(t)) &&
          typeof n.name === "string"
        ) {
          names.push(n.name);
        }
        for (const key of ["itemListElement", "item", "containsPlace", "containedInPlace"]) {
          const child = n[key];
          if (Array.isArray(child)) child.forEach(walk);
          else walk(child);
        }
      };
      items.forEach(walk);
    } catch { /* malformed JSON-LD\u2014 skip */ }
  }
  return [...new Set(names)].slice(0, 40);
}

function extractEmbeddedNames(html: string): string[] {
  // Wanderlog pages embed POI data in JS state blobs - catch "name":"X" near poi-ish keys
  const names: string[] = [];
  const re = /"(?:poi|place|attraction|spot)"[^}]{0,200}?"name"\s*:\s*"([^"\\]{3,60})"/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) && names.length < 60) names.push(m[1]);
  const re2 = /"name"\s*:\s*"([^"\\]{3,60})"[^}]{0,200}?"(?:lat|latitude|lng|longitude)"/gi;
  while ((m = re2.exec(html)) && names.length < 90) names.push(m[1]);
  return [...new Set(names)].slice(0, 40);
}

/** Wanderlog embeds the whole trip as JSON in window.__MOBX_STATE__. */
function extractMobxPlaces(html: string): { name: string; lat?: number; lng?: number }[] {
  const marker = "window.__MOBX_STATE__ = ";
  const i = html.indexOf(marker);
  if (i === -1) return [];
  const start = i + marker.length;
  // balance-brace parse the JSON object
  let depth = 0;
  let end = -1;
  for (let k = start; k < html.length && k < start + 3_000_000; k++) {
    const ch = html[k];
    if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) {
        end = k + 1;
        break;
      }
    }
  }
  if (end === -1) return [];
  try {
    const data = JSON.parse(html.slice(start, end));
    const out: { name: string; lat?: number; lng?: number }[] = [];
    const walk = (node: unknown) => {
      if (!node || typeof node !== "object" || out.length >= 80) return;
      if (Array.isArray(node)) {
        node.forEach(walk);
        return;
      }
      const n = node as Record<string, unknown>;
      const name = (n.name ?? n.poiName ?? n.title) as string | undefined;
      const lat = (n.lat ?? n.latitude) as number | undefined;
      const lng = (n.lng ?? n.lon ?? n.longitude) as number | undefined;
      if (typeof name === "string" && name.length >= 3 && name.length <= 80 && typeof lat === "number" && typeof lng === "number") {
        out.push({ name, lat, lng });
      }
      for (const v of Object.values(n)) {
        if (v && typeof v === "object") walk(v);
      }
    };
    walk(data);
    // dedupe by name
    const seen = new Set<string>();
    return out.filter((p) => (seen.has(p.name) ? false : (seen.add(p.name), true))).slice(0, 40);
  } catch {
    return [];
  }
}

function stripHtml(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s{2,}/g, " ");
}

function og(html: string, prop: string): string | null {
  const m =
    html.match(new RegExp(`<meta[^>]*property=["']og:${prop}["'][^>]*content=["']([^"']+)["']`, "i")) ??
    html.match(new RegExp(`<meta[^>]*content=["']([^"']+)["'][^>]*property=["']og:${prop}["']`, "i"));
  return m?.[1] ?? null;
}

export const journalRouter = createRouter({
  /** My posts (all statuses) + community feed (published, everyone). */
  list: authedQuery.query(async ({ ctx }) => {
    const db = getDb();
    const mine = await db
      .select()
      .from(schema.posts)
      .where(eq(schema.posts.userId, ctx.user.id))
      .orderBy(desc(schema.posts.updatedAt));
    const community = await db
      .select()
      .from(schema.posts)
      .where(eq(schema.posts.status, "published"))
      .orderBy(desc(schema.posts.updatedAt));
    return {
      mine: await withAuthors(mine),
      community: await withAuthors(community),
    };
  }),

  /**
   * Public community feed - published posts only, most-loved first.
   *
   * r27: PAGINATED. This used to select every published post with no LIMIT at
   * all and hydrate an author for each one, so the response grew without bound
   * with the community and the page got slower for everyone on every new post.
   *
   * Keyset pagination on (likes DESC, id DESC) rather than OFFSET: it stays
   * O(page) as the table grows, and it doesn't skip or duplicate rows when
   * someone likes a post between two page loads the way OFFSET does.
   *
   * `cursor` is opaque to the client - pass back whatever nextCursor was.
   */
  feed: publicQuery
    // Not `.optional()`: tRPC's useInfiniteQuery infers the page param from a
    // top-level `cursor` key, and wrapping the whole object in optional()
    // hides it from that inference.
    .input(
      z.object({
        limit: z.number().int().min(1).max(50).default(20),
        cursor: z.string().max(64).nullish(),
      }),
    )
    .query(async ({ input }) => {
      const db = getDb();
      const limit = input.limit;
      const after = parseFeedCursor(input.cursor);

      const rows = await db
        .select()
        .from(schema.posts)
        .where(
          after
            ? and(
                eq(schema.posts.status, "published"),
                // Strictly "after" the cursor in (likes DESC, id DESC) order.
                or(
                  lt(schema.posts.likes, after.likes),
                  and(eq(schema.posts.likes, after.likes), lt(schema.posts.id, after.id)),
                ),
              )
            : eq(schema.posts.status, "published"),
        )
        .orderBy(desc(schema.posts.likes), desc(schema.posts.id))
        // One extra row tells us whether another page exists without a
        // second COUNT query.
        .limit(limit + 1);

      const hasMore = rows.length > limit;
      const page = hasMore ? rows.slice(0, limit) : rows;
      const last = page[page.length - 1];
      return {
        posts: await withAuthors(page),
        nextCursor: hasMore && last ? `${last.likes}:${last.id}` : null,
      };
    }),

  /**
   * Public read: published posts are viewable by anyone (signed-in or not);
   * drafts remain visible to their owner only.
   */
  get: publicQuery.input(z.object({ id: z.number() })).query(async ({ ctx, input }) => {
    const db = getDb();
    const [post] = await db.select().from(schema.posts).where(eq(schema.posts.id, input.id)).limit(1);
    if (!post) throw new TRPCError({ code: "NOT_FOUND" });
    const isAuthor = ctx.user != null && post.userId === ctx.user.id;
    if (post.status !== "published" && !isAuthor) {
      throw new TRPCError({ code: "NOT_FOUND" });
    }
    const [enriched] = await withAuthors([post]);
    const ids = post.placeIds ?? [];
    const places = ids.length
      ? await db.select().from(schema.explorePlaces).where(inArray(schema.explorePlaces.id, ids))
      : [];
    return { post: enriched, places, isAuthor };
  }),

  /** Public like - one increment per call; published posts only. */
  like: publicQuery.input(z.object({ id: z.number() })).mutation(async ({ input }) => {
    const db = getDb();
    const [post] = await db
      .select({ id: schema.posts.id })
      .from(schema.posts)
      .where(and(eq(schema.posts.id, input.id), eq(schema.posts.status, "published")))
      .limit(1);
    if (!post) throw new TRPCError({ code: "NOT_FOUND" });
    await db
      .update(schema.posts)
      .set({ likes: sql`${schema.posts.likes} + 1` })
      .where(eq(schema.posts.id, input.id));
    const [row] = await db
      .select({ likes: schema.posts.likes })
      .from(schema.posts)
      .where(eq(schema.posts.id, input.id))
      .limit(1);
    return { likes: row?.likes ?? 0 };
  }),

  create: authedQuery
    .input(
      z.object({
        title: z.string().min(1).max(255).default("Untitled journal"),
        content: z.string().max(50000).default(""),
        coverImage: z.string().max(512).optional(),
        gallery: galleryInput,
        placeIds: z.array(z.number()).max(60).optional(),
        status: z.enum(["draft", "published"]).default("draft"),
        autoAttach: z.boolean().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      // Publishing right away? Detect mentioned places and merge them in.
      let placeIds = input.placeIds ?? [];
      let autoAttached: AutoAttachedPlace[] = [];
      if (input.status === "published" && input.autoAttach !== false) {
        const merged = await autoAttachPlaces(`${input.title}\n${input.content}`, placeIds);
        placeIds = merged.placeIds;
        autoAttached = merged.autoAttached;
      }
      const result = await getDb().insert(schema.posts).values({
        userId: ctx.user.id,
        title: input.title,
        content: input.content,
        coverImage: input.coverImage ?? null,
        gallery: input.gallery ?? [],
        placeIds,
        status: input.status,
      });
      return { id: Number(result[0].insertId), autoAttached };
    }),

  update: authedQuery
    .input(
      z.object({
        id: z.number(),
        title: z.string().min(1).max(255).optional(),
        content: z.string().max(50000).optional(),
        coverImage: z.string().max(512).nullable().optional(),
        gallery: galleryInput,
        placeIds: z.array(z.number()).max(60).optional(),
        status: z.enum(["draft", "published"]).optional(),
        autoAttach: z.boolean().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const { id, autoAttach, ...patch } = input;
      const db = getDb();
      const [post] = await db.select().from(schema.posts).where(eq(schema.posts.id, id)).limit(1);
      if (!post || post.userId !== ctx.user.id) throw new TRPCError({ code: "FORBIDDEN" });
      let autoAttached: AutoAttachedPlace[] = [];
      // attachOnPublish: merge corpus matches for mentioned places into placeIds
      if (patch.status === "published" && autoAttach !== false) {
        const merged = await autoAttachPlaces(
          `${patch.title ?? post.title}\n${patch.content ?? post.content ?? ""}`,
          patch.placeIds ?? post.placeIds ?? [],
        );
        patch.placeIds = merged.placeIds;
        autoAttached = merged.autoAttached;
      }
      await db.update(schema.posts).set(patch).where(eq(schema.posts.id, id));
      return { ok: true, autoAttached };
    }),

  /**
   * Detect place names in journal prose: quoted strings, capitalized
   * multi-word spans, "Name Restaurant/Café/Hotel" mentions, numbered/bulleted
   * list items, and whole-phrase corpus hits are matched against the explore
   * corpus (city hint breaks ties); unmatched candidates get one bounded
   * Photon/OSM lookup each - and confident OSM hits are imported into
   * explore_places so they come back attachable (placeId set). Corpus matches
   * first, max 12. Permanently closed places are demoted out of the corpus.
   */
  suggestPlaces: authedQuery
    .input(
      z.object({
        content: z.string().min(1).max(50000),
        city: z.string().max(255).optional(),
      }),
    )
    .mutation(async ({ input }) => {
      const open = await openCorpus();
      const suggestions = await suggestPlacesForText(open, input.content, input.city);
      for (const s of suggestions) {
        if (s.source !== "osm" || s.placeId != null) continue;
        const place = await importOsmPlace(s);
        if (place) s.placeId = place.id;
      }
      return { suggestions };
    }),

  remove: authedQuery.input(z.object({ id: z.number() })).mutation(async ({ ctx, input }) => {
    const db = getDb();
    const [post] = await db.select().from(schema.posts).where(eq(schema.posts.id, input.id)).limit(1);
    if (!post || post.userId !== ctx.user.id) throw new TRPCError({ code: "FORBIDDEN" });
    await db.delete(schema.posts).where(eq(schema.posts.id, input.id));
    return { ok: true };
  }),

  /**
   * Import a public Wanderlog trip/guide URL: fetch server-side, extract the
   * title, cover, and place names, match names against our place corpus, and
   * create a draft journal with matched places attached.
   */
  importWanderlog: authedQuery
    .input(
      z.object({
        url: z.string().url().max(512).optional(),
        text: z.string().min(20).max(100000).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      if (!input.url && !input.text) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Paste a Wanderlog link or the page text." });
      }
      let html = "";
      let plainText = "";
      if (input.url) {
        // SSRF guard. `host.includes("wanderlog.com")` was a SUBSTRING test, so
        // https://wanderlog.com.attacker.example/ passed it and the server then
        // fetched whatever that attacker-controlled DNS name resolved to -
        // including private/internal addresses. Match the hostname exactly.
        let host: string;
        let scheme: string;
        try {
          const parsed = new URL(input.url);
          host = parsed.hostname.toLowerCase();
          scheme = parsed.protocol;
        } catch {
          throw new TRPCError({ code: "BAD_REQUEST", message: "That doesn't look like a valid link." });
        }
        const allowed = host === "wanderlog.com" || host.endsWith(".wanderlog.com");
        if (scheme !== "https:" || !allowed) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "Please paste an https wanderlog.com link." });
        }
        try {
          const resp = await fetch(input.url, {
            headers: { "user-agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36" },
            signal: AbortSignal.timeout(10000),
          });
          html = await resp.text();
        } catch {
          throw new TRPCError({ code: "BAD_REQUEST", message: "Could not reach that link. Check it's public, or paste the page text instead." });
        }
        plainText = stripHtml(html);
      } else {
        plainText = input.text!;
        html = input.text!;
      }

      const title =
        og(html, "title")?.replace(/\s*[|–-]\s*Wanderlog.*$/i, "").trim() ||
        html.match(/<title[^>]*>([^<]+)<\/title>/i)?.[1]?.replace(/\s*[|–-]\s*Wanderlog.*$/i, "").trim() ||
        plainText.match(/^(.{6,70})\n/)?.[1]?.trim() ||
        "Imported from Wanderlog";
      const cover = og(html, "image");
      const blurb = og(html, "description") ?? "";

      // Candidate names: MobX state → JSON-LD → embedded blobs → corpus scan
      const db = getDb();
      const all = await db.select().from(schema.explorePlaces);
      const norm = normPlace; // shared matcher - also powers journal place detection
      let names = extractMobxPlaces(html).map((p) => p.name);
      if (!names.length) names = extractJsonLdNames(html);
      if (!names.length) names = extractEmbeddedNames(html);

      const matched: schema.ExplorePlace[] = [];
      const unmatched: string[] = [];
      const tryMatch = (name: string) => {
        const n = norm(name);
        return (
          all.find((p) => norm(p.name) === n) ??
          all.find((p) => n.length > 6 && norm(p.name).includes(n)) ??
          all.find((p) => n.length > 6 && n.includes(norm(p.name)))
        );
      };
      for (const name of names) {
        const hit = tryMatch(name);
        if (hit && !matched.some((m) => m.id === hit.id)) matched.push(hit);
        else if (!hit) unmatched.push(name);
      }
      // Corpus scan over the raw text - catches anything the parsers missed
      const textNorm = norm(plainText);
      for (const p of all) {
        if (matched.some((m) => m.id === p.id)) continue;
        const pn = norm(p.name);
        if (pn.length >= 6 && textNorm.includes(pn)) matched.push(p);
      }

      // Unmatched names: bounded Photon lookups; confident hits are imported
      // into explore_places (osm dedupe, source 'osm', approved) and attached
      // - every imported blog keeps enriching the cache.
      const MAX_IMPORT_LOOKUPS = 8;
      const importedNames: string[] = [];
      const stillUnmatched: string[] = [];
      for (const name of unmatched.slice(0, MAX_IMPORT_LOOKUPS)) {
        const hit = await lookupOsmPlace(name);
        const place = hit ? await importOsmPlace(hit) : null;
        if (!place) {
          stillUnmatched.push(name);
          continue;
        }
        const [row] = await db
          .select()
          .from(schema.explorePlaces)
          .where(eq(schema.explorePlaces.id, place.id))
          .limit(1);
        if (row && !matched.some((m) => m.id === row.id)) {
          matched.push(row);
          importedNames.push(row.name);
        }
      }
      stillUnmatched.push(...unmatched.slice(MAX_IMPORT_LOOKUPS));

      const lines: string[] = [];
      if (blurb) lines.push(blurb, "");
      if (matched.length) {
        lines.push("**Places pulled in:**");
        for (const p of matched) lines.push(`- ${p.name}, ${p.city}, ${p.country}`);
        lines.push("");
      }
      if (importedNames.length) {
        lines.push("**New to our atlas (imported from OpenStreetMap):**");
        for (const n of importedNames) lines.push(`- ${n}`);
        lines.push("");
      }
      if (stillUnmatched.length) {
        lines.push("**Also on the original list (not in our atlas yet):**");
        for (const n of stillUnmatched.slice(0, 20)) lines.push(`- ${n}`);
        lines.push("");
      }
      lines.push(`Imported from [Wanderlog](${input.url}).`);

      const result = await db.insert(schema.posts).values({
        userId: ctx.user.id,
        title,
        content: lines.join("\n"),
        coverImage: cover ?? null,
        placeIds: matched.map((p) => p.id),
        status: "draft",
        source: "wanderlog",
        sourceUrl: input.url ?? null,
      });
      return {
        id: Number(result[0].insertId),
        matched: matched.length,
        imported: importedNames.length,
        total: names.length || matched.length,
      };
    }),
});
