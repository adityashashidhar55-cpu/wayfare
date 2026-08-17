/**
 * Place-name detection for journal prose. Extracts candidate names from free
 * text - quoted strings ("…"), capitalized multi-word spans (2–5 words, e.g.
 * "Fushimi Inari Shrine"), and whole-phrase corpus hits - then matches each
 * candidate against the explore_places corpus, falling back to ONE Photon
 * (OSM) lookup per unmatched candidate (bounded).
 *
 * Shared by `journal.suggestPlaces` (editor "Detect places") and the
 * auto-attach-on-publish path in `journal.create` / `journal.update`.
 *
 * Photon data © OpenStreetMap contributors, ODbL.
 */
import type { ExplorePlace } from "@db/schema";
import type { PhotonResponse } from "./overpass";
import { fetchJson } from "../lib/http";

/** Minimal place shape needed for matching (full rows work too). */
export type CorpusPlace = Pick<ExplorePlace, "id" | "name" | "city" | "country">;

export interface PlaceSuggestion {
  key: string;
  name: string;
  placeId: number | null;
  city: string;
  country?: string;
  lat?: number;
  lng?: number;
  source: "corpus" | "osm";
  /** Confident OSM hits carry their identity so callers can import them. */
  osmId?: string; // "node/123" / "way/456" (matches the overpass importers)
  osmKey?: string; // photon osm_key (amenity | tourism | historic | leisure …)
  osmValue?: string; // photon osm_value (restaurant | museum | castle …)
}

export interface Candidate {
  /** Display form as written in the prose. */
  name: string;
  /**
   * True when every word of the candidate is a generic place-type word
   * ("Temple", "Old Market") - kept only on an exact corpus-name match.
   */
  genericOnly: boolean;
}

interface IndexedPlace {
  place: CorpusPlace;
  norm: string;
  words: number;
  genericOnly: boolean;
}

const MAX_SUGGESTIONS = 12;
const MAX_CANDIDATES = 24;
const MAX_PHOTON_LOOKUPS = 5;
const PHOTON_API = "https://photon.komoot.io/api/";
const USER_AGENT = "Wayfare/1.0 (travel app; journal place detection)";

/**
 * Normalize for loose matching: fold diacritics, lowercase, collapse any run
 * of punctuation/whitespace to a single space. Both the prose and the corpus
 * names go through this, so comparisons are accent- and punctuation-insensitive.
 */
export function normPlace(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "") // strip combining marks (U+0300–U+036F)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/** Words that may open a capitalized span without belonging to the place name. */
const LEADING_STOPWORDS = new Set([
  "the", "a", "an", "on", "in", "at", "to", "from", "by", "for", "off", "up",
  "we", "our", "my", "this", "that", "these", "those", "next", "last", "first",
  "then", "after", "before", "today", "yesterday", "tomorrow", "morning",
  "afternoon", "evening", "tonight", "day", "night", "and", "but", "so",
  "with", "into", "over", "back", "later", "finally", "meanwhile",
]);

/** Lowercase words allowed inside a multi-word place name. */
const CONNECTORS = new Set([
  "of", "the", "de", "del", "la", "le", "les", "los", "las", "lo", "di", "da",
  "du", "des", "den", "der", "het", "van", "von", "al", "el", "bin", "ibn",
  "and", "&", "en", "am", "im", "zu", "dos", "das", "do", "ao", "na", "no",
  "della", "delle", "dei", "degli", "au", "aux", "sur", "y", "e",
]);

/**
 * Generic place-type words - fine as part of a name ("Time Out Market") but a
 * span made ONLY of these ("Temple", "Old Town") is not a candidate unless it
 * exactly matches a corpus name.
 */
const GENERIC_WORDS = new Set([
  "temple", "shrine", "market", "museum", "park", "cafe", "coffee",
  "restaurant", "bar", "hotel", "hostel", "ryokan", "station", "beach",
  "garden", "gardens", "castle", "palace", "tower", "bridge", "square",
  "street", "avenue", "church", "cathedral", "mosque", "gallery", "zoo",
  "aquarium", "onsen", "hall", "monument", "memorial", "fountain", "lake",
  "river", "mountain", "mount", "airport", "port", "harbor", "harbour",
  "island", "islands", "district", "old", "town", "city", "viewpoint",
  "lookout", "rooftop", "souk", "medina", "waterfall", "falls", "trail",
  "walk", "food", "central", "grand", "great", "little", "new", "night",
]);

/** Strip markdown-lite markers and raw URLs so they don't poison span extraction. */
function cleanProse(content: string): string {
  return content
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1") // links → label
    .replace(/https?:\/\/\S+/g, " ")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/^[-*]\s+/gm, "")
    .replace(/[*_`>]/g, " ");
}

/** Quoted strings: straight + curly double quotes and curly singles, 3–60 chars. */
function extractQuoted(text: string): string[] {
  const out: string[] = [];
  const re = /"([^"\n]{3,60})"|“([^”\n]{3,60})”|‘([^’\n]{3,60})’/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    const v = (m[1] ?? m[2] ?? m[3] ?? "").trim();
    if (v.length >= 3) out.push(v);
  }
  return out;
}

function isCapitalized(w: string): boolean {
  return /^\p{Lu}/u.test(w);
}

/**
 * Capitalized multi-word spans (2–5 words): runs of Capitalized tokens joined
 * by lowercase connectors ("of", "de la", "&", …). Runs longer than 5 words
 * emit overlapping 5-word windows. Sentence-initial stopwords are stripped
 * later, at the candidate level.
 */
function extractCapitalSpans(text: string): string[] {
  const spans: string[] = [];
  const tokens = text
    .split(/\s+/)
    .map((raw) =>
      raw
        .replace(/^[^\p{L}\p{N}&]+/u, "")
        .replace(/[^\p{L}\p{N}&'-]+$/u, ""),
    )
    .filter(Boolean);

  let run: string[] = [];
  const flush = () => {
    while (run.length && CONNECTORS.has(run[run.length - 1]!.toLowerCase())) run.pop();
    while (run.length > 5) {
      const window = run.slice(0, 5);
      if (window.filter(isCapitalized).length >= 2) spans.push(window.join(" "));
      run.shift();
    }
    if (run.length >= 2 && run.filter(isCapitalized).length >= 2) {
      spans.push(run.join(" "));
    }
    run = [];
  };

  for (const w of tokens) {
    if (isCapitalized(w)) run.push(w);
    else if (CONNECTORS.has(w.toLowerCase()) && run.length > 0) run.push(w);
    else flush();
  }
  flush();
  return spans;
}

/** Venue type words that turn a capitalized name into a place mention. */
const TYPE_WORD_RE =
  "(?:restaurant|café|cafe|coffee|hotel|hostel|ryokan|inn|lodge|resort|guesthouse|riads?|izakaya|bistro|brasserie|bakery|eatery|diner|bar|ramen|sushi|pizzeria|taverna|trattoria|osteria|cantina|steakhouse|teahouse|winery|brewery|shrine|temple|mosque|church|cathedral|castle|palace|museum|gallery|market|onsen|spa)";

/**
 * "X Restaurant / Café / Hotel" mentions where the type word is lowercase in
 * prose ("dinner at Kyubey restaurant") - capital spans need TWO capitalized
 * words, so they miss these. Emits "Name Type" (type word title-cased).
 */
function extractTypedNames(text: string): string[] {
  const re = new RegExp(
    `\\b(\\p{Lu}[\\p{L}\\p{N}'&.-]*(?:\\s+(?:of|the|de|del|la|le|di|da|du|van|von|el|al|dos|das|do|e|y|en)\\s+\\p{Lu}[\\p{L}\\p{N}'&.-]*|\\s+\\p{Lu}[\\p{L}\\p{N}'&.-]*){0,3})\\s+(${TYPE_WORD_RE})\\b`,
    "giu",
  );
  const out: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    const type = m[2]!;
    out.push(`${m[1]} ${type.charAt(0).toUpperCase()}${type.slice(1)}`);
  }
  return out;
}

/**
 * Numbered/bulleted list items ("1. Fushimi Inari", "- Sukiyabashi Jiro") -
 * itineraries list one place per line; the leading phrase (up to the first
 * sentence break) is a strong candidate even when it's a single word, which
 * capital spans can't catch. Runs on the ORIGINAL content (cleanProse strips
 * bullet markers). Items must start capitalized to keep prose sentences out.
 */
function extractListItems(content: string): string[] {
  const out: string[] = [];
  const re = /^\s*(?:\d{1,2}[.)]|[-*•])\s+(.{2,80})$/gm;
  let m: RegExpExecArray | null;
  while ((m = re.exec(content))) {
    const item = (m[1] ?? "").split(/[.!?,;:()\[\]–\u2014]/)[0]?.trim() ?? "";
    if (item.length >= 3 && /^\p{Lu}/u.test(item)) out.push(item);
  }
  return out;
}

/**
 * Candidate place names from prose: quoted strings first (highest confidence),
 * then capitalized spans, "Name Restaurant/Café/Hotel" mentions, and
 * numbered/bulleted list items - deduped by normalized form. Leading
 * stopwords are stripped ("The Fushimi Inari Shrine" → "Fushimi Inari
 * Shrine"); corpus names that genuinely start with one still match via the
 * contains tier.
 */
export function extractCandidates(content: string, max = MAX_CANDIDATES): Candidate[] {
  const text = cleanProse(content);
  const raw = [
    ...extractQuoted(text),
    ...extractCapitalSpans(text),
    ...extractTypedNames(text),
    ...extractListItems(content),
  ];
  const out: Candidate[] = [];
  const seen = new Set<string>();
  for (const r of raw) {
    const words = r.split(/\s+/).filter(Boolean);
    let start = 0;
    while (start < words.length - 1 && LEADING_STOPWORDS.has(words[start]!.toLowerCase())) start++;
    const v = words.slice(start).join(" ");
    const n = normPlace(v);
    if (n.length < 3 || n.length > 60 || !/[a-z]/.test(n) || seen.has(n)) continue;
    seen.add(n);
    const genericOnly = n.split(" ").every((w) => GENERIC_WORDS.has(w) || CONNECTORS.has(w));
    out.push({ name: v, genericOnly });
    if (out.length >= max) return out;
  }
  return out;
}

function indexCorpus(corpus: CorpusPlace[]): IndexedPlace[] {
  return corpus.map((place) => {
    const norm = normPlace(place.name);
    const words = norm.split(" ").filter(Boolean);
    return {
      place,
      norm,
      words: words.length,
      genericOnly:
        words.length > 0 && words.every((w) => GENERIC_WORDS.has(w) || CONNECTORS.has(w)),
    };
  });
}

/**
 * Match one candidate against the indexed corpus: normalized exact → corpus
 * name contains candidate → candidate contains corpus name. When `city` is
 * given, a same-city hit wins within its tier.
 */
function matchIndexed(name: string, idx: IndexedPlace[], city?: string): CorpusPlace | null {
  const n = normPlace(name);
  if (n.length < 3) return null;
  const exact: CorpusPlace[] = [];
  const wider: CorpusPlace[] = [];
  const narrower: CorpusPlace[] = [];
  for (const { place, norm } of idx) {
    if (norm === n) exact.push(place);
    else if (n.length > 6 && norm.includes(n)) wider.push(place);
    else if (norm.length >= 8 && n.includes(norm)) narrower.push(place);
  }
  const pool = exact.length ? exact : wider.length ? wider : narrower;
  if (!pool.length) return null;
  const cityN = city ? normPlace(city) : "";
  if (cityN) {
    const inCity = pool.find((p) => normPlace(p.city) === cityN);
    if (inCity) return inCity;
  }
  return pool[0]!;
}

/**
 * Corpus places whose normalized name appears as a whole phrase in the text.
 * Same-named places collapse to one hit - a same-city one when `city` is given.
 * Skips norms that can't be trusted as phrase hits: generic-only names ("Market
 * Hall" - handled by exact candidate matching instead), single short words
 * (often a city/brand coincidence, e.g. a café named "Kyoto"), and CJK names
 * whose Latin fragment is incidental ("大垣書店＆coffee" → "coffee").
 */
function scanIndexed(content: string, idx: IndexedPlace[], city?: string): CorpusPlace[] {
  const textNorm = ` ${normPlace(content)} `;
  const cityN = city ? normPlace(city) : "";
  const byNorm = new Map<string, CorpusPlace[]>();
  for (const { place, norm, words, genericOnly } of idx) {
    if (norm.length < 5 || genericOnly || (words === 1 && norm.length < 8)) continue;
    if (!textNorm.includes(` ${norm} `)) continue;
    const group = byNorm.get(norm) ?? [];
    group.push(place);
    byNorm.set(norm, group);
  }
  const out: CorpusPlace[] = [];
  for (const group of byNorm.values()) {
    const preferred = cityN ? group.find((p) => normPlace(p.city) === cityN) : undefined;
    out.push(preferred ?? group[0]!);
  }
  return out;
}

export interface OsmHit {
  name: string;
  city: string;
  country: string;
  lat: number;
  lng: number;
  osmId?: string; // "node/123" / "way/456" - same shape the overpass importers use
  osmKey?: string;
  osmValue?: string;
}

/** Photon osm_type letters → the "node/way/relation" ids overpass.ts stores. */
const OSM_TYPE_MAP: Record<string, string> = { N: "node", W: "way", R: "relation" };

/**
 * ONE Photon lookup for an unmatched candidate (3s timeout). Accepted only
 * when the top hit's name closely matches the candidate (case-insensitive
 * equality / startsWith / contains, after normalization). Never throws.
 * Exported so wanderlog imports can resolve unmatched names the same way.
 */
export async function lookupOsmPlace(candidate: string): Promise<OsmHit | null> {
  try {
    const url = new URL(PHOTON_API);
    url.searchParams.set("q", candidate);
    url.searchParams.set("limit", "1");
    url.searchParams.set("lang", "en"); // prose is English-ish; without this OSM prefers local names
    const data = await fetchJson<PhotonResponse>(url, {
      timeoutMs: 3000,
      userAgent: USER_AGENT,
      service: "photon",
    });
    const f = Array.isArray(data.features) ? data.features[0] : undefined;
    if (!f) return null;
    const name = (f.properties.name ?? "").trim();
    if (!name) return null;
    const hn = normPlace(name);
    const n = normPlace(candidate);
    // hn may collapse to nothing for CJK-only names - then it can't be verified
    if (hn.length < 3) return null;
    if (!(hn === n || hn.startsWith(n) || hn.includes(n) || n.includes(hn))) return null;
    const [lng, lat] = f.geometry.coordinates;
    if (typeof lat !== "number" || typeof lng !== "number") return null;
    const p = f.properties;
    const city = (p.city ?? p.town ?? p.village ?? p.district ?? "").split(" (")[0]!.trim();
    const osmType = p.osm_type ? (OSM_TYPE_MAP[p.osm_type] ?? p.osm_type.toLowerCase()) : undefined;
    return {
      name: name.slice(0, 255),
      city,
      country: p.country ?? "",
      lat,
      lng,
      osmId: p.osm_id != null && osmType ? `${osmType}/${p.osm_id}` : undefined,
      osmKey: p.osm_key ?? undefined,
      osmValue: p.osm_value ?? undefined,
    };
  } catch {
    return null;
  }
}

/**
 * Full detection pipeline: whole-phrase corpus scan → candidate spans matched
 * against the corpus → bounded Photon fallback for the rest. Corpus matches
 * first, deduped, capped at 12.
 */
export async function suggestPlacesForText(
  corpus: CorpusPlace[],
  content: string,
  city?: string,
): Promise<PlaceSuggestion[]> {
  const idx = indexCorpus(corpus);
  const suggestions: PlaceSuggestion[] = [];
  const seenIds = new Set<number>();
  const seenNames = new Set<string>();

  const pushCorpus = (p: CorpusPlace) => {
    if (suggestions.length >= MAX_SUGGESTIONS || seenIds.has(p.id)) return;
    const nn = normPlace(p.name);
    if (seenNames.has(nn)) return;
    seenIds.add(p.id);
    seenNames.add(nn);
    suggestions.push({
      key: `corpus:${p.id}`,
      name: p.name,
      placeId: p.id,
      city: p.city,
      country: p.country,
      source: "corpus",
    });
  };

  for (const p of scanIndexed(content, idx, city)) pushCorpus(p);

  const unmatched: Candidate[] = [];
  for (const c of extractCandidates(content)) {
    if (suggestions.length >= MAX_SUGGESTIONS) break;
    if (seenNames.has(normPlace(c.name))) continue;
    const hit = matchIndexed(c.name, idx, city);
    if (hit && (!c.genericOnly || normPlace(hit.name) === normPlace(c.name))) {
      pushCorpus(hit);
    } else if (!c.genericOnly && !hit) {
      unmatched.push(c);
    }
  }

  /* Only maximal spans go to Photon - a candidate contained in a longer
   * unmatched candidate is a fragment of it (windowing artifact). */
  const maximal = unmatched.filter(
    (c, i) =>
      !unmatched.some((d, j) => j !== i && normPlace(d.name).includes(normPlace(c.name))),
  );
  const lookups = maximal.slice(0, MAX_PHOTON_LOOKUPS);
  const osmResults = await Promise.all(lookups.map((c) => lookupOsmPlace(c.name)));
  for (const hit of osmResults) {
    if (suggestions.length >= MAX_SUGGESTIONS) break;
    if (!hit) continue;
    const nn = normPlace(hit.name);
    if (seenNames.has(nn)) continue;
    seenNames.add(nn);
    suggestions.push({
      key: `osm:${nn}`,
      name: hit.name,
      placeId: null,
      city: hit.city,
      country: hit.country || undefined,
      lat: hit.lat,
      lng: hit.lng,
      source: "osm",
      osmId: hit.osmId,
      osmKey: hit.osmKey,
      osmValue: hit.osmValue,
    });
  }

  return suggestions.slice(0, MAX_SUGGESTIONS);
}

/**
 * Corpus-only matching over arbitrary text (title + content) - no external
 * calls. Used to auto-attach mentioned places on publish.
 */
export function corpusMatchesForText(corpus: CorpusPlace[], text: string): CorpusPlace[] {
  const idx = indexCorpus(corpus);
  const out: CorpusPlace[] = [];
  const seen = new Set<number>();
  const push = (p: CorpusPlace) => {
    if (seen.has(p.id)) return;
    seen.add(p.id);
    out.push(p);
  };
  for (const p of scanIndexed(text, idx)) push(p);
  for (const c of extractCandidates(text)) {
    const hit = matchIndexed(c.name, idx);
    if (hit && (!c.genericOnly || normPlace(hit.name) === normPlace(c.name))) push(hit);
  }
  return out;
}
