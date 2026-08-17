/**
 * Social import (r19-social): paste an Instagram/TikTok link OR raw caption
 * text → extract the places mentioned → review on a map → create a routed
 * trip. Three procedures:
 *
 *   social.resolveLink          - microlink.io caption fetch (10s timeout,
 *                                 degrades to needsText on any failure; IG's
 *                                 login wall reports a login-wall reason)
 *   social.extractPlaces        — clean caption text → capitalized-span /
 *                                 hashtag candidates → LIKE-prefiltered corpus
 *                                 match + JS rank (hint bias, famous/verdict
 *                                 weights, confidence bands) → bounded Photon
 *                                 geocode fallback for unmatched city-like words
 *   social.createTripFromPlaces — trip + NN+2-opt ordered stops, chunked
 *                                 8/day across trip days (mirrors the AI
 *                                 generator's stop structure), same free-tier
 *                                 trip limit as trips.create
 *
 * Network reality: TikTok/Instagram are unreachable from some deployments —
 * nothing here hard-fails on external calls; Photon data © OSM contributors.
 */
import { and, eq, inArray, like, ne, or, sql } from "drizzle-orm";
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import * as schema from "@db/schema";
import { getDb } from "./queries/connection";
import { authedQuery, createRouter } from "./middleware";
import { getTier } from "./queries/subscriptions";
import { ExternalApiError, fetchJson } from "./lib/http";
import { normalizeNameKey } from "./lib/place-quality";
import type { PhotonResponse } from "./queries/overpass";
import { dateRange, optimizeWithMatrix, slotSchedule } from "./trip-router";
import { TIERS } from "@contracts/premium";

const MAX_TEXT = 5000;
const MAX_CANDIDATES = 24;
const MAX_PLACES = 12;
const MAX_GEOCODE = 6;
const STOPS_PER_DAY = 8;
const PHOTON_API = "https://photon.komoot.io/api/";
const PHOTON_UA = "Wayfare/1.0 (travel app; social import)";

// ─── Platform detection ─────────────────────────────────────────────────────
export type SocialPlatform = "tiktok" | "instagram" | "facebook" | "youtube" | "reddit" | "other";

/** How a platform behaves for import: microlink auto-fetch vs paste caption. */
export type PlatformGroup = "auto" | "paste" | "try-auto";

export function detectPlatform(rawUrl: string): SocialPlatform {
  try {
    const u = new URL(rawUrl);
    const host = u.hostname.toLowerCase().replace(/^www\./, "");
    if (host === "tiktok.com" || host.endsWith(".tiktok.com")) return "tiktok";
    if (host === "instagram.com" || host.endsWith(".instagram.com")) return "instagram";
    if (host === "facebook.com" || host.endsWith(".facebook.com") || host === "fb.watch") return "facebook";
    if (host === "youtu.be" || host === "youtube.com" || host.endsWith(".youtube.com")) return "youtube";
    if (host === "reddit.com" || host.endsWith(".reddit.com") || host === "redd.it") return "reddit";
    return "other";
  } catch {
    return "other";
  }
}

/**
 * r24-social: explicit supported-platform behavior. Instagram/Facebook lock
 * their posts behind a login wall - microlink only ever sees the wall, so we
 * never call it for them and ask for the caption up front. TikTok works,
 * YouTube and Reddit return public title/description metadata (verified
 * against live microlink.io in Aug 2026). Unknown links are worth one try.
 */
export function platformGroup(platform: SocialPlatform): PlatformGroup {
  if (platform === "instagram" || platform === "facebook") return "paste";
  if (platform === "tiktok" || platform === "youtube" || platform === "reddit") return "auto";
  return "try-auto";
}

// ─── Microlink caption fetch ────────────────────────────────────────────────
/**
 * Link resolution goes through microlink.io (https://api.microlink.io?url=…):
 * TikTok's own oEmbed is unreachable from some deployments and Instagram has
 * no open caption API at all, while microlink renders the page and returns
 * { status, data: { title, description, author, image: { url } } }. TikTok
 * descriptions carry the caption (behind a "likes/comments" noise prefix);
 * Instagram returns success with an empty description (login wall), which the
 * caller turns into needsText.
 */
export interface ResolvedCaption {
  text: string;
  author: string | null;
  thumbnailUrl: string | null;
}

const MICROLINK_API = "https://api.microlink.io";

/** TikTok noise prefix: "1.2K likes, 84 comments." ahead of the real caption. */
const TIKTOK_NOISE_RE = /^\d+(?:\.\d+)?[KMB]?\s+likes?,\s+\d+(?:\.\d+)?[KMB]?\s+comments?\.?\s*/i;

/** Strip the TikTok likes/comments prefix; harmless on text without one. */
export function sanitizeSocialCaption(raw: string): string {
  return raw.replace(TIKTOK_NOISE_RE, "").replace(/\s+/g, " ").trim();
}

/** Titles that are just the platform name carry no caption (login walls). */
const GENERIC_TITLES = new Set(["instagram", "tiktok", "youtube"]);

/** Generic logged-out landing text (dead/deleted TikTok videos redirect there). */
const GENERIC_TEXTS = new Set(["browse your favorite items."]);

/**
 * Parse a microlink.io response into caption text; null when there is no
 * usable text (IG login wall, error status, junk payload). Description wins
 * over title; a bare platform-name title is ignored.
 */
export function parseMicrolinkResponse(body: unknown): ResolvedCaption | null {
  if (!body || typeof body !== "object") return null;
  const b = body as Record<string, unknown>;
  if (b.status !== "success") return null;
  const d = b.data as Record<string, unknown> | null | undefined;
  if (!d || typeof d !== "object") return null;
  const str = (v: unknown) => (typeof v === "string" ? v.trim() : "");
  const desc = sanitizeSocialCaption(str(d.description));
  const titleRaw = str(d.title);
  const title = GENERIC_TITLES.has(titleRaw.toLowerCase()) ? "" : sanitizeSocialCaption(titleRaw);
  const text = (desc || title).slice(0, MAX_TEXT);
  if (!text || GENERIC_TEXTS.has(text.toLowerCase())) return null;
  const img = d.image as Record<string, unknown> | null | undefined;
  const logo = d.logo as Record<string, unknown> | null | undefined;
  const rawThumb = str(img?.url) || str(logo?.url) || null;
  const thumbnailUrl = rawThumb && !rawThumb.endsWith("favicon.ico") ? rawThumb : null;
  return { text, author: str(d.author) || null, thumbnailUrl };
}

// ─── Text cleaning ──────────────────────────────────────────────────────────
/**
 * Clean a social caption for place extraction: strip URLs and @mentions,
 * keep hashtag WORDS ("#Kyoto" → "Kyoto"), normalize curly quotes, collapse
 * whitespace. Exported for tests.
 */
export function cleanSocialText(raw: string): string {
  return raw
    .replace(/https?:\/\/\S+|www\.\S+/gi, " ")
    .replace(/@[\p{L}\p{N}_.]+/gu, " ")
    .replace(/#([\p{L}\p{N}_]+)/gu, " $1 ") // keep the tag word
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/\s+/g, " ")
    .trim();
}

/** Raw hashtag words ("#EiffelTower #kyoto" → ["EiffelTower", "kyoto"]). */
export function extractHashtags(raw: string): string[] {
  const out: string[] = [];
  const re = /#([\p{L}\p{N}_]{2,60})/gu;
  let m: RegExpExecArray | null;
  while ((m = re.exec(raw))) out.push(m[1]!);
  return out;
}

// ─── Candidate extraction ───────────────────────────────────────────────────
/** Stopwords dropped as single-word candidates and span edges. */
const STOPWORDS = new Set([
  // days / months (+ common abbreviations)
  "monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday",
  "mon", "tue", "tues", "wed", "thu", "thur", "thurs", "fri", "sat", "sun",
  "january", "february", "march", "april", "may", "june", "july", "august",
  "september", "october", "november", "december",
  "jan", "feb", "mar", "apr", "jun", "jul", "aug", "sep", "sept", "oct", "nov", "dec",
  // travel-generic / social filler
  "day", "days", "trip", "trips", "travel", "travels", "traveling", "travelling",
  "travelgram", "vacation", "vacations", "vacay", "holiday", "holidays",
  "food", "foods", "foodie", "foodies", "foodporn", "love", "loved", "loves",
  "instagood", "photooftheday", "picoftheday", "igdaily", "instadaily",
  "wanderlust", "explore", "exploring", "adventure", "adventures", "vibes",
  "beautiful", "amazing", "awesome", "incredible", "stunning", "best", "top",
  "good", "great", "new", "photo", "photos", "video", "videos", "reel", "reels",
  "tiktok", "instagram", "insta", "youtube", "shorts", "follow", "followme",
  "like", "likes", "share", "subscribe", "link", "bio", "check", "save",
  "fyp", "foryou", "foryoupage", "viral", "duet", "stitch", "caption",
  "comment", "comments", "watch", "full", "out", "now", "vlog", "vlogs",
  "blog", "blogs", "guide", "guides", "tips", "itinerary", "itineraries",
  "bucket", "list", "lists", "must", "hidden", "gems", "gem", "places",
  "place", "things", "thing", "visit", "visiting", "visited", "visits",
  "tour", "tours", "tourism", "tourist", "tourists", "life", "world",
  "city", "cities", "country", "countries",
  // generic english function/descriptor words (capitalized sentence-initials)
  "this", "that", "these", "those", "with", "without", "and", "the", "for",
  "you", "your", "yours", "our", "ours", "my", "mine", "me", "we", "us",
  "it", "its", "of", "in", "on", "at", "to", "from", "by", "a", "an", "is",
  "are", "was", "were", "be", "been", "being", "so", "very", "just", "really",
  "much", "more", "most", "here", "there", "when", "where", "what", "how",
  "why", "who", "all", "any", "some", "no", "not", "yes", "get", "got", "go",
  "going", "goes", "went", "gone", "see", "saw", "seen", "make", "made",
  "take", "took", "come", "came", "do", "did", "done", "one", "two", "three",
  "four", "five", "six", "seven", "eight", "nine", "ten", "first", "last",
  "next", "back", "today", "tomorrow", "yesterday", "tonight", "morning",
  "afternoon", "evening", "night", "week", "weeks", "weekend", "weekends",
  "month", "months", "year", "years", "time", "times", "part", "pt", "ep",
  "episode", "thank", "thanks", "hello", "hi", "hey", "wow", "yes",
]);

/** Words allowed between capitalized tokens of one place name. */
const CONNECTORS = new Set([
  "of", "the", "de", "del", "la", "le", "les", "los", "las", "di", "da", "du",
  "des", "den", "der", "het", "van", "von", "al", "el", "and", "&", "en",
  "am", "im", "zu", "dos", "das", "do", "ao", "na", "no", "sur", "y", "e",
]);

/** Spans made ONLY of these ("Old Town", "Night Market") need an exact hit. */
const GENERIC_WORDS = new Set([
  "temple", "shrine", "market", "museum", "park", "cafe", "coffee",
  "restaurant", "bar", "hotel", "hostel", "station", "beach", "garden",
  "gardens", "castle", "palace", "tower", "bridge", "square", "street",
  "avenue", "church", "cathedral", "mosque", "gallery", "zoo", "hall",
  "monument", "memorial", "fountain", "lake", "river", "mountain", "mount",
  "island", "islands", "district", "old", "town", "viewpoint", "lookout",
  "rooftop", "night", "central", "grand", "great", "little", "new",
]);

/** Sentence-initial words stripped from the front of a span. */
const LEADING_STRIP = new Set([
  "the", "a", "an", "my", "our", "your", "this", "that", "these", "those",
  "next", "last", "first", "day",
]);

const isCap = (w: string) => /^\p{Lu}/u.test(w);

function cleanToken(raw: string): string {
  return raw
    .replace(/^[^\p{L}\p{N}&]+/u, "")
    .replace(/[^\p{L}\p{N}&'’-]+$/u, "")
    .replace(/['’]s$/i, "");
}

/** Capitalized multi-word spans (2–4 words), lowercase connectors allowed. */
function extractCapitalSpans(cleaned: string): string[] {
  const spans: string[] = [];
  const tokens = cleaned.split(/\s+/).map(cleanToken).filter(Boolean);
  let run: string[] = [];
  const flush = () => {
    while (run.length && CONNECTORS.has(run[run.length - 1]!.toLowerCase())) run.pop();
    while (run.length > 4) {
      const win = run.slice(0, 4);
      if (win.filter(isCap).length >= 2) spans.push(win.join(" "));
      run.shift();
    }
    if (run.length >= 2 && run.filter(isCap).length >= 2) spans.push(run.join(" "));
    run = [];
  };
  for (const w of tokens) {
    if (isCap(w)) run.push(w);
    else if (CONNECTORS.has(w.toLowerCase()) && run.length > 0) run.push(w);
    else flush();
  }
  flush();
  return spans;
}

/** Single capitalized words ≥4 letters (stopwords dropped). */
function extractSingleWords(cleaned: string): string[] {
  const out: string[] = [];
  for (const raw of cleaned.split(/\s+/)) {
    const w = cleanToken(raw);
    if (w.length < 4 || !isCap(w)) continue;
    if (!/^[\p{L}][\p{L}'’-]*$/u.test(w)) continue; // letters only
    if (STOPWORDS.has(w.toLowerCase())) continue;
    out.push(w);
  }
  return out;
}

export interface SocialCandidate {
  /** Display form as written in the caption. */
  name: string;
  /** Came from a #hashtag — intentional mention, ranks higher. */
  hashtag: boolean;
  /** Every word is a generic place-type word — exact corpus match only. */
  genericOnly: boolean;
}

/**
 * Candidate place names from a social caption: hashtag words (any case),
 * capitalized 2–4 word spans, single capitalized words ≥4 letters — deduped
 * by normalized form, stopwords dropped, capped at MAX_CANDIDATES.
 */
export function extractSocialCandidates(raw: string, max = MAX_CANDIDATES): SocialCandidate[] {
  const hashtags = extractHashtags(raw).map((h) => h.replace(/_/g, " ").trim()).filter(Boolean);
  const cleaned = cleanSocialText(raw);
  const rawList: { name: string; hashtag: boolean }[] = [
    ...hashtags.map((name) => ({ name, hashtag: true })),
    ...extractCapitalSpans(cleaned).map((name) => ({ name, hashtag: false })),
    ...extractSingleWords(cleaned).map((name) => ({ name, hashtag: false })),
  ];
  const out: SocialCandidate[] = [];
  const seen = new Set<string>();
  for (const { name, hashtag } of rawList) {
    const words = name.split(/\s+/).filter(Boolean);
    let start = 0;
    while (start < words.length - 1 && LEADING_STRIP.has(words[start]!.toLowerCase())) start++;
    const v = words.slice(start).join(" ").replace(/^#+/, "").trim();
    const n = normalizeNameKey(v);
    if (n.length < 3 || n.length > 60 || !/\p{L}/u.test(n)) continue;
    if (n.split(" ").every((w) => STOPWORDS.has(w))) continue;
    const existing = seen.has(n);
    if (!existing) {
      seen.add(n);
      const genericOnly = n.split(" ").every((w) => GENERIC_WORDS.has(w) || CONNECTORS.has(w));
      out.push({ name: v, hashtag, genericOnly });
      if (out.length >= max) return out;
    } else if (hashtag) {
      const cand = out.find((c) => normalizeNameKey(c.name) === n);
      if (cand) cand.hashtag = true;
    }
  }
  return out;
}

// ─── Corpus matching + ranking ──────────────────────────────────────────────
export interface SocialCorpusRow {
  id: number;
  name: string;
  city: string;
  country: string;
  lat: number | null;
  lng: number | null;
  category?: string | null;
  rating?: number | null;
  verdict?: string | null;
  famousEatery?: boolean | null;
}

export type Confidence = "high" | "medium" | "low";

export interface SocialPlace {
  name: string;
  city: string;
  country: string;
  lat: number;
  lng: number;
  confidence: Confidence;
  placeId: number | null;
  source: "corpus" | "geocode";
  matchedOn: "exact" | "contains" | "contained" | "city";
  /** internal ranking score — kept on the row for tests/debugging */
  score: number;
}

export interface RankHints {
  hintCity?: string;
  hintCountry?: string;
  /** City names mentioned in the caption (normalized inside). */
  mentionedCities?: string[];
}

const SCORE_EXACT = 100;
const SCORE_CONTAINS = 70; // corpus name contains the candidate
const SCORE_CONTAINED = 60; // candidate contains the corpus name
const SCORE_MIN = 60;
const HIGH_AT = 110;
const MEDIUM_AT = 85;

export function confidenceFor(score: number): Confidence {
  return score >= HIGH_AT ? "high" : score >= MEDIUM_AT ? "medium" : "low";
}

/**
 * Rank candidates against the (LIKE-prefiltered) corpus. Pure — the procedure
 * assembles the corpus subset from MySQL, tests pass fixtures.
 *
 * Scoring: exact normalized-name match 100 · corpus name ⊇ candidate 70 ·
 * candidate ⊇ corpus name 60, then bonuses: hashtag +15, hintCity +20,
 * hintCountry +10, city mentioned in the caption +15, rating ±10 around 4.5,
 * famousEatery +8, verdict must-see +8 / worth-it +4.
 * Bands: ≥110 high · ≥85 medium · ≥60 low (below 60 dropped). Low confidence
 * survives only on corroboration (exact tier, hashtag, or a hinted/mentioned
 * city) so a lone substring hit can't pin junk on the map. Same-name rows
 * dedupe to the highest-scoring one (famous/hinted city wins).
 */
export function rankCorpusMatches(
  candidates: SocialCandidate[],
  corpus: SocialCorpusRow[],
  hints: RankHints = {},
  max = MAX_PLACES,
): SocialPlace[] {
  const hintCityKey = hints.hintCity ? normalizeNameKey(hints.hintCity) : "";
  const hintCountryKey = hints.hintCountry ? normalizeNameKey(hints.hintCountry) : "";
  const mentioned = new Set((hints.mentionedCities ?? []).map(normalizeNameKey));
  const bestByName = new Map<string, SocialPlace>();

  for (const cand of candidates) {
    const ck = normalizeNameKey(cand.name);
    if (ck.length < 3) continue;
    for (const row of corpus) {
      if (row.lat == null || row.lng == null) continue;
      const rk = normalizeNameKey(row.name);
      if (rk.length < 3) continue;
      let base = 0;
      let matchedOn: SocialPlace["matchedOn"] = "exact";
      if (rk === ck) {
        base = SCORE_EXACT;
        matchedOn = "exact";
      } else if (ck.length >= 6 && rk.includes(ck)) {
        base = SCORE_CONTAINS;
        matchedOn = "contains";
      } else if (rk.length >= 8 && ck.includes(rk)) {
        base = SCORE_CONTAINED;
        matchedOn = "contained";
      } else {
        continue;
      }
      if (cand.genericOnly && matchedOn !== "exact") continue;
      const cityKey = normalizeNameKey(row.city);
      /* Locality prior: single-word non-hashtag candidates ("Ramen", "Ichiran")
       * only pin in the captioned/hinted city when a city context exists —
       * otherwise "#kyoto … ramen" would pin a café named "Ramen" in Osaka. */
      if (
        !cand.name.includes(" ") &&
        !cand.hashtag &&
        mentioned.size > 0 &&
        !mentioned.has(cityKey) &&
        !(hintCityKey && cityKey === hintCityKey)
      ) {
        continue;
      }

      let score = base;
      if (cand.hashtag) score += 15;
      if (hintCityKey && cityKey === hintCityKey) score += 20;
      if (hintCountryKey && normalizeNameKey(row.country) === hintCountryKey) score += 10;
      if (mentioned.has(cityKey)) score += 15;
      score += Math.round(((row.rating ?? 4.5) - 4.5) * 10);
      if (row.famousEatery) score += 8;
      if (row.verdict === "must-see") score += 8;
      else if (row.verdict === "worth-it") score += 4;
      if (score < SCORE_MIN) continue;

      const confidence = confidenceFor(score);
      const corroborated =
        matchedOn === "exact" || cand.hashtag || mentioned.has(cityKey) || (hintCityKey && cityKey === hintCityKey);
      if (confidence === "low" && !corroborated) continue;

      const prev = bestByName.get(rk);
      if (prev && prev.score >= score) continue;
      bestByName.set(rk, {
        name: row.name,
        city: row.city,
        country: row.country,
        lat: row.lat,
        lng: row.lng,
        confidence,
        placeId: row.id,
        source: "corpus",
        matchedOn,
        score,
      });
    }
  }

  return [...bestByName.values()]
    .sort((a, b) => b.score - a.score || a.name.localeCompare(b.name))
    .slice(0, max);
}

/**
 * Split candidates into: city-word candidates ("#Kyoto" where Kyoto is a
 * corpus city — geocode to the city center, never a coincidental same-named
 * place), country-word candidates ("#japan" — context only, not a pin), and
 * the rest, which go through place matching.
 */
export function partitionCandidates(
  candidates: SocialCandidate[],
  mentionedCities: string[],
  mentionedCountries: string[],
): { cityWords: SocialCandidate[]; countryWords: SocialCandidate[]; placeCands: SocialCandidate[] } {
  const cityKeys = new Set(mentionedCities.map(normalizeNameKey));
  const countryKeys = new Set(mentionedCountries.map(normalizeNameKey));
  const cityWords: SocialCandidate[] = [];
  const countryWords: SocialCandidate[] = [];
  const placeCands: SocialCandidate[] = [];
  for (const c of candidates) {
    const key = normalizeNameKey(c.name);
    if (!c.name.includes(" ") && cityKeys.has(key)) cityWords.push(c);
    else if (!c.name.includes(" ") && countryKeys.has(key)) countryWords.push(c);
    else placeCands.push(c);
  }
  return { cityWords, countryWords, placeCands };
}

/** Normalized keys of candidates that produced at least one corpus match. */
export function matchedCandidateKeys(candidates: SocialCandidate[], corpus: SocialCorpusRow[]): Set<string> {
  const keys = new Set<string>();
  const rowKeys = corpus.map((r) => normalizeNameKey(r.name)).filter((k) => k.length >= 3);
  for (const cand of candidates) {
    const ck = normalizeNameKey(cand.name);
    if (ck.length < 3) continue;
    for (const rk of rowKeys) {
      if (rk === ck || (ck.length >= 6 && rk.includes(ck)) || (rk.length >= 8 && ck.includes(rk))) {
        keys.add(ck);
        break;
      }
    }
  }
  return keys;
}

// ─── Photon geocode fallback (unmatched city-like candidates) ───────────────
export interface GeocodeHit {
  name: string;
  city: string;
  country: string;
  lat: number;
  lng: number;
}

/**
 * ONE Photon lookup for an unmatched candidate (6s timeout, limit=1, lang en).
 * Accepted when the hit's name OR city relates to the candidate after
 * normalization (city mentions like "Kyoto" resolve to the city center).
 * Never throws — Photon data © OpenStreetMap contributors, ODbL.
 */
export async function geocodeCandidate(candidate: string): Promise<GeocodeHit | null> {
  try {
    const url = new URL(PHOTON_API);
    url.searchParams.set("q", candidate);
    url.searchParams.set("limit", "1");
    url.searchParams.set("lang", "en");
    const data = await fetchJson<PhotonResponse>(url, {
      timeoutMs: 6000,
      service: "photon",
      userAgent: PHOTON_UA,
    });
    const f = Array.isArray(data.features) ? data.features[0] : undefined;
    if (!f) return null;
    const [lng, lat] = f.geometry.coordinates;
    if (typeof lat !== "number" || typeof lng !== "number") return null;
    const p = f.properties;
    const name = ((p.name ?? "").trim() || candidate).slice(0, 255);
    const city = (p.city ?? p.town ?? p.village ?? p.district ?? "").split(" (")[0]!.trim();
    const n = normalizeNameKey(candidate);
    const rel = (s: string) => s.length >= 3 && (s === n || s.includes(n) || n.includes(s));
    if (!rel(normalizeNameKey(name)) && !rel(normalizeNameKey(city))) return null;
    return { name, city, country: p.country ?? "", lat, lng };
  } catch {
    return null;
  }
}

// ─── Trip creation helpers ──────────────────────────────────────────────────
/** Trips whose end date is today or later — the trips.create limit counts these. */
export function countActiveTrips(owned: { endDate: string }[], today: string): number {
  return owned.filter((t) => t.endDate >= today).length;
}

/**
 * Order places for the itinerary: nearest-neighbor + 2-opt on the haversine
 * matrix (the trip-router optimizer with no OSRM matrix), first place anchored.
 */
export function orderPlacesByRoute<T extends { lat: number; lng: number }>(places: T[]): T[] {
  if (places.length <= 2) return places;
  const pts = places.map((p, i) => ({ id: i, lat: p.lat, lng: p.lng }));
  return optimizeWithMatrix(pts, null).map((pt) => places[pt.id]!);
}

/** Consecutive chunks of size n over the optimized order (geographic chunking). */
export function chunkIntoDays<T>(ordered: T[], perDay = STOPS_PER_DAY): T[][] {
  const days: T[][] = [];
  for (let i = 0; i < ordered.length; i += perDay) days.push(ordered.slice(i, i + perDay));
  return days;
}

// ─── Router ─────────────────────────────────────────────────────────────────
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Escape LIKE wildcards so caption text can't smuggle % / _ patterns. */
const likeEsc = (s: string) => s.replace(/[\\%_]/g, (m) => `\\${m}`);

/** LIKE terms for one candidate: itself + adjacent word bigrams (catches
 *  "Eiffel Tower at Night" → corpus row "Eiffel Tower"). */
function likeTerms(cand: SocialCandidate): string[] {
  const terms = [cand.name];
  const words = cand.name.split(/\s+/).filter(Boolean);
  if (words.length >= 3) {
    for (let i = 0; i + 1 < words.length; i++) terms.push(`${words[i]} ${words[i + 1]}`);
  }
  return terms.map((t) => t.trim()).filter((t) => t.length >= 3);
}

interface CityRow {
  city: string;
  country: string;
  n: number;
}

export interface ExtractInput {
  text: string;
  hintCity?: string;
  hintCountry?: string;
}

/**
 * The full extraction pipeline (shared by extractPlaces and extractFromText):
 * clean -> candidates -> LIKE-prefiltered corpus rank -> Photon fallback ->
 * proximity dedupe -> dominant city.
 */
async function runExtraction(input: ExtractInput) {
      const db = getDb();
      const resolvedText = cleanSocialText(input.text);
      const candidates = extractSocialCandidates(input.text);

      const empty = { places: [] as SocialPlace[], unmatched: [] as string[], resolvedText };
      if (!candidates.length) return { ...empty, unmatched: [] };

      // 1) LIKE prefilter: rows whose name contains a candidate (or a bigram
      //    of a long candidate). One bounded query, ranked in JS.
      const terms = [...new Set(candidates.flatMap(likeTerms))].slice(0, 96);
      const corpus: SocialCorpusRow[] = terms.length
        ? await db
            .select({
              id: schema.explorePlaces.id,
              name: schema.explorePlaces.name,
              city: schema.explorePlaces.city,
              country: schema.explorePlaces.country,
              lat: schema.explorePlaces.lat,
              lng: schema.explorePlaces.lng,
              category: schema.explorePlaces.category,
              rating: schema.explorePlaces.rating,
              verdict: schema.explorePlaces.verdict,
              famousEatery: schema.explorePlaces.famousEatery,
            })
            .from(schema.explorePlaces)
            .where(
              and(
                ne(schema.explorePlaces.closedStatus, "permanently_closed"),
                or(...terms.map((t) => like(schema.explorePlaces.name, `%${likeEsc(t)}%`))),
              ),
            )
            .limit(500)
        : [];

      // 2) City mentions: single-word candidates that ARE corpus city names
      //    (strong signal — biases ranking and feeds the geocode fallback).
      const wordCands = [
        ...new Set(
          candidates
            .filter((c) => !c.name.includes(" "))
            .map((c) => c.name)
            .filter((w) => w.length >= 3),
        ),
      ].slice(0, 24);
      const cityRows: CityRow[] = wordCands.length
        ? await db
            .select({
              city: schema.explorePlaces.city,
              country: schema.explorePlaces.country,
              n: sql<number>`count(*)`,
            })
            .from(schema.explorePlaces)
            .where(
              and(
                ne(schema.explorePlaces.closedStatus, "permanently_closed"),
                inArray(schema.explorePlaces.city, wordCands),
              ),
            )
            .groupBy(schema.explorePlaces.city, schema.explorePlaces.country)
            .limit(24)
        : [];
      const candWordKeys = new Set(wordCands.map(normalizeNameKey));
      const mentionedCityRows = cityRows
        .filter((r) => candWordKeys.has(normalizeNameKey(r.city)))
        .sort((a, b) => b.n - a.n);
      const mentionedCities = mentionedCityRows.map((r) => r.city);
      const mentionedCountries = [...new Set(mentionedCityRows.map((r) => r.country))];

      /* City/country word candidates ("#Kyoto", "#japan") are context, not
       * places — split them out so "#Kyoto" can't pin a café named "Kyoto"
       * in San Francisco. City words geocode to the city center instead. */
      const { cityWords, countryWords, placeCands } = partitionCandidates(
        candidates,
        mentionedCities,
        mentionedCountries,
      );

      // 3) Rank corpus matches (pure).
      const places = rankCorpusMatches(placeCands, corpus, {
        hintCity: input.hintCity,
        hintCountry: input.hintCountry,
        mentionedCities,
      });

      // 4) Unmatched high-signal candidates → bounded Photon geocode.
      const matchedKeys = matchedCandidateKeys(placeCands, corpus);
      const cityKeySet = new Set(mentionedCities.map(normalizeNameKey));
      const unmatchedCands = placeCands.filter((c) => !matchedKeys.has(normalizeNameKey(c.name)));
      const geocodeQueue = [
        ...cityWords,
        ...unmatchedCands
          .filter((c) => !c.genericOnly)
          .sort((a, b) => {
            const rank = (c: SocialCandidate) => (c.hashtag ? -1 : 0) + (c.name.includes(" ") ? 0 : 1);
            return rank(a) - rank(b);
          }),
      ].slice(0, MAX_GEOCODE);
      const hits = await Promise.all(geocodeQueue.map((c) => geocodeCandidate(c.name)));
      const seenNames = new Set(places.map((p) => normalizeNameKey(p.name)));
      const geocoded: { cand: SocialCandidate; hit: GeocodeHit }[] = [];
      hits.forEach((hit, i) => {
        if (!hit || places.length + geocoded.length >= MAX_PLACES) return;
        const key = normalizeNameKey(hit.name);
        if (seenNames.has(key)) return;
        seenNames.add(key);
        geocoded.push({ cand: geocodeQueue[i]!, hit });
      });
      for (const { cand, hit } of geocoded) {
        const isCity = cityKeySet.has(normalizeNameKey(cand.name));
        places.push({
          name: hit.name,
          city: hit.city,
          country: hit.country,
          lat: hit.lat,
          lng: hit.lng,
          confidence: isCity || cand.hashtag ? "high" : "medium",
          placeId: null,
          source: "geocode",
          matchedOn: isCity ? "city" : "exact",
          score: isCity ? 100 : 80,
        });
      }

      // 4b) Proximity dedupe: same place arriving from corpus AND geocode
      // (e.g. "Kinkaku-ji" + "Kinkaku-ji (Golden Pavilion)" 30m apart) must
      // not appear twice. Drop the lower-priority of a near-identical pair:
      // corpus beats geocode, then higher score, then longer name loses.
      {
        const dropIdx = new Set<number>();
        const keyOf = (n: string) => normalizeNameKey(n).replace(/\([^)]*\)/g, "").trim();
        const near = (a: SocialPlace, b: SocialPlace) => {
          const dLat = (a.lat - b.lat) * 111_000;
          const dLng = (a.lng - b.lng) * 111_000 * Math.cos(((a.lat + b.lat) / 2) * (Math.PI / 180));
          return dLat * dLat + dLng * dLng < 150 * 150;
        };
        for (let i = 0; i < places.length; i++) {
          if (dropIdx.has(i)) continue;
          for (let j = i + 1; j < places.length; j++) {
            if (dropIdx.has(j)) continue;
            const a = places[i];
            const b = places[j];
            const ka = keyOf(a.name);
            const kb = keyOf(b.name);
            if (!ka || !kb || ka.length < 4 || kb.length < 4) continue;
            const related = ka.startsWith(kb) || kb.startsWith(ka);
            if (!related || !near(a, b)) continue;
            const rank = (p: SocialPlace) => (p.source === "corpus" ? 10_000 : 0) + (p.score ?? 0);
            dropIdx.add(rank(a) >= rank(b) ? j : i);
            if (dropIdx.has(i)) break;
          }
        }
        if (dropIdx.size) {
          for (const i of [...dropIdx].sort((x, y) => y - x)) places.splice(i, 1);
        }
      }

      // 5) Unmatched list + dominant city.
      const geocodedKeys = new Set(geocoded.map(({ cand }) => normalizeNameKey(cand.name)));
      const unmatched = [...unmatchedCands, ...countryWords, ...cityWords]
        .filter((c) => !geocodedKeys.has(normalizeNameKey(c.name)))
        .map((c) => c.name)
        .slice(0, 10);

      const cityCounts = new Map<string, { city: string; country: string; n: number }>();
      for (const p of places) {
        if (!p.city) continue;
        const key = `${normalizeNameKey(p.city)}|${normalizeNameKey(p.country)}`;
        const cur = cityCounts.get(key) ?? { city: p.city, country: p.country, n: 0 };
        cur.n += 1;
        cityCounts.set(key, cur);
      }
      const ranked = [...cityCounts.values()].sort((a, b) => b.n - a.n);
      const dominantCity =
        !input.hintCity && ranked[0] && ranked[0].n >= 2 && (!ranked[1] || ranked[0].n >= ranked[1].n * 2)
          ? `${ranked[0].city}, ${ranked[0].country}`
          : undefined;

      return { places, unmatched, resolvedText, ...(dominantCity ? { dominantCity } : {}) };
}

export const socialRouter = createRouter({
  /**
   * Resolve a pasted social link via microlink.io (10s timeout). Success with
   * caption text → { ok:true, platform, text, author, thumbnailUrl }. Empty
   * caption (IG login wall), unreachable page, or any failure →
   * { ok:false, needsText:true } so the client asks for the caption text
   * instead - never hard-fails.
   */
  resolveLink: authedQuery
    .input(z.object({ url: z.string().min(1).max(2048) }))
    .query(async ({ input }) => {
      const raw = input.url.trim();
      let parsed: URL;
      try {
        parsed = new URL(raw);
        if (parsed.protocol !== "http:" && parsed.protocol !== "https:") throw new Error("bad protocol");
      } catch {
        throw new TRPCError({ code: "BAD_REQUEST", message: "That doesn't look like a valid link." });
      }
      const detected = detectPlatform(raw);
      const group = platformGroup(detected);
      // r24-social: IG/FB are login-walled - skip the doomed microlink call
      // entirely and ask for the caption immediately (fast + honest).
      if (group === "paste") {
        return {
          ok: false as const,
          platform: detected,
          needsText: true as const,
          reason: "login-wall",
        };
      }
      try {
        const apiUrl = `${MICROLINK_API}?url=${encodeURIComponent(raw)}`;
        const body = await fetchJson<unknown>(apiUrl, { timeoutMs: 10_000, service: "microlink" });
        const caption = parseMicrolinkResponse(body);
        if (!caption) {
          return {
            ok: false as const,
            platform: detected,
            needsText: true as const,
            reason: "no-caption-found",
          };
        }
        return { ok: true as const, platform: detected, ...caption };
      } catch (e) {
        const reason =
          e instanceof ExternalApiError ? `fetch-failed:${e.status ?? "network"}` : "fetch-failed";
        return { ok: false as const, platform: detected, needsText: true as const, reason };
      }
    }),

  /**
   * Extract places from caption text: clean → candidates → LIKE-prefiltered
   * corpus rank → Photon fallback for unmatched city-like words. Returns up
   * to 12 places with confidence bands, the unmatched candidate names, the
   * cleaned text, and a dominantCity when one city clearly dominates.
   */
  extractPlaces: authedQuery
    .input(
      z.object({
        text: z.string().min(1).max(MAX_TEXT),
        hintCity: z.string().max(255).optional(),
        hintCountry: z.string().max(255).optional(),
      }),
    )
    .query(({ input }) => runExtraction(input)),

  /**
   * r24-social: explicit free-text entry point (pasted IG/FB caption from the
   * login-wall fallback). Identical pipeline to extractPlaces - kept as a
   * separate, self-documenting procedure so clients don't have to know that
   * extractPlaces accepts raw text.
   */
  extractFromText: authedQuery
    .input(
      z.object({
        text: z.string().min(1).max(MAX_TEXT),
        hintCity: z.string().max(255).optional(),
        hintCountry: z.string().max(255).optional(),
      }),
    )
    .query(({ input }) => runExtraction(input)),

  /**
   * Create a routed trip from reviewed places: corpus ids + ad-hoc geocoded
   * pins. Same free-tier active-trip limit as trips.create. Stops are
   * NN+2-opt ordered (first place anchored) and chunked 8/day across trip
   * days with the generator's slot schedule.
   */
  createTripFromPlaces: authedQuery
    .input(
      z.object({
        title: z.string().max(255).optional(),
        placeIds: z.array(z.number().int().positive()).max(24).default([]),
        extraPlaces: z
          .array(
            z.object({
              name: z.string().min(1).max(255),
              lat: z.number().min(-90).max(90),
              lng: z.number().min(-180).max(180),
              city: z.string().max(255).optional(),
              country: z.string().max(255).optional(),
            }),
          )
          .max(24)
          .default([]),
        startDate: z.string().regex(DATE_RE).optional(),
        endDate: z.string().regex(DATE_RE).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const db = getDb();

      // Free-tier limit — identical rule to trips.create.
      const tier = await getTier(ctx.user.id);
      const owned = await db.select().from(schema.trips).where(eq(schema.trips.ownerId, ctx.user.id));
      const today = new Date().toISOString().slice(0, 10);
      if (countActiveTrips(owned, today) >= TIERS[tier].maxTrips) {
        throw new TRPCError({ code: "FORBIDDEN", message: "UPGRADE_REQUIRED" });
      }

      // Resolve corpus ids (input order preserved), then append ad-hoc pins.
      const rows = input.placeIds.length
        ? await db
            .select()
            .from(schema.explorePlaces)
            .where(inArray(schema.explorePlaces.id, input.placeIds))
        : [];
      const byId = new Map(rows.map((r) => [r.id, r]));
      type Unified = {
        name: string;
        city: string;
        country: string;
        lat: number;
        lng: number;
        category: string;
        description: string | null;
        image: string | null;
        famousEatery: boolean;
      };
      const unified: Unified[] = [];
      for (const id of input.placeIds) {
        const r = byId.get(id);
        if (!r || r.lat == null || r.lng == null) continue;
        unified.push({
          name: r.name,
          city: r.city,
          country: r.country,
          lat: r.lat,
          lng: r.lng,
          category: r.category,
          description: r.description,
          image: r.image,
          famousEatery: r.famousEatery,
        });
      }
      for (const e of input.extraPlaces) {
        unified.push({
          name: e.name,
          city: e.city ?? "",
          country: e.country ?? "",
          lat: e.lat,
          lng: e.lng,
          category: "activity",
          description: null,
          image: null,
          famousEatery: false,
        });
      }
      // Dedupe (name + city) — review UI can double-submit corpus + geocode rows.
      const seen = new Set<string>();
      const unique = unified.filter((p) => {
        const key = `${normalizeNameKey(p.name)}|${normalizeNameKey(p.city)}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
      if (!unique.length) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "No places with coordinates to route." });
      }

      const ordered = orderPlacesByRoute(unique);
      const dayChunks = chunkIntoDays(ordered, STOPS_PER_DAY);

      // Destination: the city most places sit in (else first place's).
      const cityVotes = new Map<string, { city: string; country: string; n: number }>();
      for (const p of ordered) {
        if (!p.city) continue;
        const key = `${normalizeNameKey(p.city)}|${normalizeNameKey(p.country)}`;
        const cur = cityVotes.get(key) ?? { city: p.city, country: p.country, n: 0 };
        cur.n += 1;
        cityVotes.set(key, cur);
      }
      const topCity = [...cityVotes.values()].sort((a, b) => b.n - a.n)[0];
      const destination = topCity
        ? topCity.country
          ? `${topCity.city}, ${topCity.country}`
          : topCity.city
        : `${ordered[0]!.name}`;

      // Dates: explicit range wins, but always long enough for the chunks.
      const start = input.startDate ?? today;
      let dates = dateRange(start, input.endDate && input.endDate >= start ? input.endDate : start);
      if (!dates.length) dates = [start];
      while (dates.length < dayChunks.length) {
        const d = new Date(`${dates[dates.length - 1]!}T00:00:00Z`);
        d.setUTCDate(d.getUTCDate() + 1);
        dates.push(d.toISOString().slice(0, 10));
      }

      const title = input.title?.trim() || `${destination} · social picks`;
      const tripRes = await db.insert(schema.trips).values({
        ownerId: ctx.user.id,
        title: title.slice(0, 255),
        destination: destination.slice(0, 255),
        startDate: dates[0]!,
        endDate: dates[dates.length - 1]!,
        coverImage: ordered.find((p) => p.image)?.image ?? null,
        homeCurrency: "USD",
        budgetCents: 0,
      });
      const tripId = Number(tripRes[0].insertId);
      await db.insert(schema.tripMembers).values({
        tripId,
        userId: ctx.user.id,
        name: ctx.user.name ?? "You",
        email: ctx.user.email ?? null,
        role: "owner",
        presenceColor: "#BC5934", // PRESENCE_COLORS[0] in trip-router
      });

      let stopsCreated = 0;
      let position = 0;
      for (let d = 0; d < dates.length; d++) {
        const dayRes = await db.insert(schema.tripDays).values({ tripId, date: dates[d]!, position: d });
        const dayId = Number(dayRes[0].insertId);
        const chunk = dayChunks[d] ?? [];
        if (!chunk.length) continue;
        const { times, durations } = slotSchedule(chunk.length);
        for (let i = 0; i < chunk.length; i++) {
          const p = chunk[i]!;
          await db.insert(schema.stops).values({
            tripId,
            dayId,
            name: p.name,
            category: p.category,
            address: p.city && p.country ? `${p.city}, ${p.country}` : p.city || p.country || null,
            lat: p.lat,
            lng: p.lng,
            startTime: times[i] ?? null,
            durationMin: durations[i] ?? null,
            notes: p.description,
            image: p.image,
            famousEatery: p.famousEatery,
            position: position++,
          });
          stopsCreated++;
        }
      }

      return { tripId, stopsCreated, orderedNames: ordered.map((p) => p.name) };
    }),
});
