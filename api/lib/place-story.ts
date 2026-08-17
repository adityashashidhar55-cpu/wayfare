/**
 * api/lib/place-story.ts (r18-stories) - place descriptions ("stories").
 *
 * Three sourcing tiers, all funnelled into explore_places.description with
 * descriptionSource provenance (curated | dbpedia | composed | user):
 *
 *   1. DBpedia abstracts - fetchDbpediaAbstract() resolves the DBpedia
 *      resource "{name}, {city}" then "{name}" (plus "{name} Temple"-style
 *      suffix variants when the name already carries a temple/church/mosque/
 *      fort/palace keyword) through dbo:wikiPageRedirects and reads the
 *      English dbo:abstract. Same validation discipline as the photo
 *      suggester (osm-photo.ts): for ≤2-word names a city token must appear
 *      in the label/abstract, so "Victoria Memorial (Chennai)" can't inherit
 *      Kolkata's article. Positive AND negative results cached 30d under
 *      `wikidesc:{namekey}|{citykey}`. DBpedia 502s retry 3× (1s/3s/8s).
 *      (en.wikipedia.org is TCP-blocked from the sandbox - DBpedia only.)
 *
 *   2. Curated stories - agent/owner-authored text imported by
 *      db/import-place-stories.ts (always wins, descriptionSource='curated').
 *
 *   3. Composed fallback - composeDescription() builds an HONEST 1–2
 *      sentence description from structured fields only (category, city,
 *      country, tags, verdict, famousEatery, fee). It NEVER invents dates,
 *      founders, dynasties, events or history - when DBpedia has nothing,
 *      "a historic site in Madurai, India" is the truth we can stand behind.
 *
 * cleanAbstract() prepares a DBpedia abstract for display (whitespace,
 * disambiguation drop, sentence-boundary trim); storyNarrationText() caps
 * any description for narration/TTS reuse.
 */

import { cacheGet, cacheKey, cacheSet } from "./cache";
import { ExternalApiError, fetchJson } from "./http";
import { normalizeNameKey } from "./place-quality";

const DBPEDIA_SPARQL = "https://dbpedia.org/sparql";
const STORY_UA = "Wayfare/1.0 (travel app; place-description suggest; +https://wayfare.app)";
const TTL_30D = 30 * 24 * 60 * 60 * 1000;
const TIMEOUT_MS = 10_000;
const RETRY_BACKOFF_MS = [1_000, 3_000, 8_000]; // DBpedia 502/503/504 → retry 3×

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const storyCacheKey = (name: string, city: string) =>
  cacheKey("wikidesc:", `${normalizeNameKey(name)}|${normalizeNameKey(city)}`);

/** City tokens (≥4 chars, minus administrative junk) present in a normalized haystack? */
function cityTokenIn(haystackKey: string, cityKey: string): boolean {
  const JUNK = new Set([
    "india", "municipal", "corporation", "city", "district", "state",
    "prefecture", "province", "county",
  ]);
  const tokens = cityKey.split(" ").filter((t) => t.length >= 4 && !JUNK.has(t));
  return tokens.length > 0 && tokens.some((t) => haystackKey.includes(t));
}

/** "Meenakshi Amman Temple" → http://dbpedia.org/resource/Meenakshi_Amman_Temple */
function dbpediaIri(title: string): string | null {
  const t = title.trim().replace(/\s+/g, "_");
  if (!t || /["<>{}|^`\\]/.test(t)) return null;
  const encoded = Array.from(t)
    .map((ch) => (/[A-Za-z0-9_\-.,'()!~&;=:@$*+]/.test(ch) || ch.charCodeAt(0) > 127 ? ch : encodeURIComponent(ch)))
    .join("");
  return `http://dbpedia.org/resource/${encoded}`;
}

/** Suffix variants worth trying ("… Temple") when the name carries a monument keyword. */
const SUFFIX_KEYWORDS: [RegExp, string][] = [
  [/\btemple\b/i, "Temple"],
  [/\bchurch\b/i, "Church"],
  [/\bmosque\b/i, "Mosque"],
  [/\bfort\b/i, "Fort"],
  [/\bpalace\b/i, "Palace"],
];

/** Candidate resource titles, in priority order. */
function candidateTitles(name: string, city: string): string[] {
  const titles = [`${name}, ${city}`, name];
  for (const [re, suffix] of SUFFIX_KEYWORDS) {
    if (re.test(name)) titles.push(`${name} ${suffix}`);
  }
  return titles;
}

interface SparqlBinding {
  label: { value: string };
  abs: { value: string };
}

/** One SPARQL round for one candidate IRI, with gateway-error retries. */
async function queryDbpedia(iri: string): Promise<SparqlBinding[]> {
  const query = `SELECT ?label ?abs WHERE {
  <${iri}> <http://dbpedia.org/ontology/wikiPageRedirects>{0,1} ?target .
  ?target <http://dbpedia.org/ontology/abstract> ?abs .
  ?target <http://www.w3.org/2000/01/rdf-schema#label> ?label .
  FILTER(lang(?abs) = 'en')
  FILTER(lang(?label) = 'en')
}`;
  const url = `${DBPEDIA_SPARQL}?query=${encodeURIComponent(query)}&format=${encodeURIComponent("application/sparql-results+json")}`;
  let lastErr: unknown = null;
  for (let attempt = 0; attempt <= RETRY_BACKOFF_MS.length; attempt++) {
    try {
      const data = await fetchJson<{ results?: { bindings?: SparqlBinding[] } }>(url, {
        userAgent: STORY_UA,
        service: "dbpedia",
        timeoutMs: TIMEOUT_MS,
        headers: { Accept: "application/sparql-results+json" },
      });
      return data.results?.bindings ?? [];
    } catch (e) {
      lastErr = e;
      const status = e instanceof ExternalApiError ? e.status : null;
      const retryable = status !== null && status >= 500 && status < 600;
      if (!retryable || attempt === RETRY_BACKOFF_MS.length) break;
      await sleep(RETRY_BACKOFF_MS[attempt]!);
    }
  }
  throw lastErr;
}

/**
 * Fetch the English DBpedia abstract for a place. Returns null when no
 * candidate resolves to a validated match. Positive and negative results
 * are cached 30d so seeders and portal suggests never re-ask for a miss.
 */
export async function fetchDbpediaAbstract(
  name: string,
  city: string,
): Promise<{ abstract: string; title: string } | null> {
  const key = storyCacheKey(name, city);
  const cached = await cacheGet<{ abstract: string | null; title?: string }>(key);
  if (cached) {
    return cached.abstract ? { abstract: cached.abstract, title: cached.title ?? "" } : null;
  }

  const nameKey = normalizeNameKey(name);
  const cityKey = normalizeNameKey(city);
  let hit: { abstract: string; title: string } | null = null;

  for (const title of candidateTitles(name, city)) {
    const iri = dbpediaIri(title);
    if (!iri) continue;
    let bindings: SparqlBinding[];
    try {
      bindings = await queryDbpedia(iri);
    } catch {
      continue; // network/timeout - try the next candidate
    }
    if (!bindings.length) continue;
    const label = bindings[0]!.label.value;
    const abs = bindings[0]!.abs.value;
    const labelKey = normalizeNameKey(label);
    const absKey = normalizeNameKey(abs).slice(0, 4000); // token check needs the head, not the novel
    if (nameKey.length >= 4 && !labelKey.includes(nameKey) && !nameKey.includes(labelKey)) {
      continue;
    }
    if (nameKey.split(" ").length <= 2 && !cityTokenIn(`${labelKey} ${absKey}`, cityKey)) {
      continue;
    }
    hit = { abstract: abs, title: label };
    break;
  }

  await cacheSet(key, hit ? { abstract: hit.abstract, title: hit.title } : { abstract: null }, TTL_30D);
  return hit;
}

// ─── text preparation ────────────────────────────────────────────────────────

/** Disambiguation pages are never a place story. */
const DISAMBIG_RE = /\b(?:may|can) refer to\b/i;

/**
 * Trim `text` to ≤ maxChars at the last sentence boundary (`. ! ?` followed
 * by a space) before the cap. Falls back to a word boundary when no sentence
 * ends in range. Returns "" when nothing usable fits.
 */
function trimAtSentenceBoundary(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  const window = text.slice(0, maxChars + 1); // allow a boundary ending exactly at the cap
  let cut = -1;
  for (const m of window.matchAll(/[.!?](?=\s)/g)) {
    cut = m.index! + 1;
  }
  if (cut > 0) return text.slice(0, cut);
  const space = window.lastIndexOf(" ", maxChars);
  return space > 0 ? text.slice(0, space) : "";
}

/**
 * Clean a raw DBpedia abstract for display: collapse whitespace, drop
 * disambiguation phrasing ("may refer to" / "can refer to"), trim to
 * ≤ maxChars at a sentence boundary. Returns null when the result is too
 * short to be a real story (< 80 chars).
 */
export function cleanAbstract(raw: string, maxChars = 900): string | null {
  const text = raw.replace(/\s+/g, " ").trim();
  if (DISAMBIG_RE.test(text)) return null;
  const trimmed = trimAtSentenceBoundary(text, maxChars).trim();
  return trimmed.length >= 80 ? trimmed : null;
}

/**
 * Cap any description for narration/TTS: collapse whitespace and trim at a
 * sentence boundary. (No length floor - short input passes through as-is.)
 */
export function storyNarrationText(description: string, maxChars = 2500): string {
  const text = description.replace(/\s+/g, " ").trim();
  return trimAtSentenceBoundary(text, maxChars).trim();
}

// ─── honest composed fallback ────────────────────────────────────────────────

export interface ComposeInput {
  name: string;
  category: string;
  city: string;
  country: string;
  tags?: string[] | null;
  rating?: number | null;
  verdict?: string | null;
  famousEatery?: boolean | null;
  feeCents?: number | null;
  feeCurrency?: string | null;
  // r21-desc: signature dish name from the signature_dishes join
  // (signature_dish_places.placeId) when one exists for a famous eatery.
  signatureDish?: string | null;
}

const CATEGORY_PHRASES: Record<string, string> = {
  food: "restaurant",
  cafe: "café",
  activity: "attraction",
  adventure: "outdoor adventure spot",
  natural: "natural spot",
  shopping: "shopping stop",
  nightlife: "nightlife spot",
  hotel: "place to stay",
  museum: "museum",
  park: "park",
  landmark: "landmark",
  beach: "beach",
  market: "market",
};

const articleFor = (phrase: string) => (/^[aeiou]/i.test(phrase) ? "an" : "a");
const cap1 = (s: string) => (s ? s[0]!.toUpperCase() + s.slice(1) : s);

/**
 * Deterministic variant picker: the same place always gets the same phrasing
 * (idempotent re-runs) while the corpus as a whole varies its openers.
 */
function variantIndex(name: string, mod: number): number {
  let h = 0;
  for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return mod > 0 ? h % mod : 0;
}

// --- r21-desc: richer historic/cultural + famous-eatery phrasing -----------
// These templates only use fields that actually exist on explore_places rows:
// category, city, country, tags (the capped 4-tag list written at import),
// verdict, famousEatery, feeCents and, for famous eateries, an optional
// signature dish name looked up from signature_dishes. OSM import keeps no
// dates, architects, religions or heritage registers, so the templates weave
// texture from tags only and never state a date, builder or dynasty.

/**
 * Specific worship kinds, checked in order. The importer tags every place of
 * worship with "temple", so the more specific mosque/church/etc. tags must be
 * tested first or every mosque would be called a temple.
 */
const WORSHIP_KINDS: [string, string][] = [
  ["cathedral", "cathedral"],
  ["mosque", "mosque"],
  ["church", "church"],
  ["chapel", "chapel"],
  ["gurudwara", "gurudwara"],
  ["gurdwara", "gurudwara"],
  ["synagogue", "synagogue"],
  ["monastery", "monastery"],
  ["pagoda", "pagoda"],
  ["shrine", "shrine"],
  ["temple", "temple"],
];

/** Specific historic kinds, checked in order after the worship kinds. */
const HISTORIC_KINDS: [string, string][] = [
  ["memorial", "memorial"],
  ["ruins", "ruin"],
  ["fort", "fort"],
  ["palace", "palace"],
  ["castle", "castle"],
  ["monument", "monument"],
];

const tagSetOf = (tags: string[]) => new Set(tags.map((t) => t.toLowerCase()));

interface HistoricPlan {
  kind: string; // noun phrase, e.g. "temple" | "historic site"
  worship: boolean;
  memorial: boolean;
  ruins: boolean;
  museum: boolean;
  landmark: boolean;
  architecture: boolean;
  historic: boolean;
}

/**
 * Decide how a historic/cultural row should be introduced. Worship and the
 * specific historic kinds outrank the generic "historic site"; when the kind
 * word already appears in the place name ("Gingee Fort is a fort...") we fall
 * back to "historic site" so the sentence does not stutter.
 */
function planHistoric(name: string, category: string, tags: string[]): HistoricPlan | null {
  const set = tagSetOf(tags);
  const nameL = name.toLowerCase();
  const worshipHit = WORSHIP_KINDS.find(([tag]) => set.has(tag));
  const historicHit = HISTORIC_KINDS.find(([tag]) => set.has(tag));
  const genericHistoric =
    set.has("historic") ||
    set.has("heritage") ||
    category.toLowerCase() === "historic" ||
    !!historicHit;
  const museum = set.has("museum") || category.toLowerCase() === "museum";
  const landmark = set.has("landmark") || category.toLowerCase() === "landmark";

  let kind: string | null = null;
  let worship = false;
  if (worshipHit) {
    kind = worshipHit[1];
    worship = true;
  } else if (historicHit && !nameL.includes(historicHit[1])) {
    kind = historicHit[1];
  } else if (genericHistoric) {
    kind = "historic site";
  } else if (museum) {
    kind = "museum";
  } else if (landmark) {
    kind = "landmark";
  }
  if (!kind) return null;
  return {
    kind,
    worship,
    memorial: set.has("memorial"),
    ruins: set.has("ruins"),
    museum,
    landmark,
    architecture: set.has("architecture"),
    historic: genericHistoric,
  };
}

/** Honest follow-up sentences, woven only from texture present in the tags. */
function historicTextureSentences(plan: HistoricPlan, cityShort: string, vi: number): string[] {
  const out: string[] = [];
  if (plan.worship) {
    out.push(
      [
        "It remains an active place of worship.",
        "It still serves as a place of worship.",
        "It is revered above all as a place of worship.",
      ][vi % 3]!,
    );
  }
  if (plan.memorial) out.push("It stands as a place of remembrance.");
  if (plan.ruins) out.push("What survives offers a direct glimpse of the area's past.");
  if (plan.landmark && cityShort) {
    out.push(
      [`It is one of ${cityShort}'s landmark sights.`, `It counts among ${cityShort}'s landmark sights.`][vi % 2]!,
    );
  }
  if (plan.architecture) out.push("It is noted for its historic architecture.");
  if (out.length === 0 && plan.museum && cityShort) {
    out.push(`It is one of ${cityShort}'s cultural stops.`);
  }
  if (out.length === 0 && plan.historic) {
    out.push(
      cityShort
        ? [`It is part of ${cityShort}'s historic fabric.`, `It forms part of ${cityShort}'s historic fabric.`][vi % 2]!
        : "It is part of the area's historic fabric.",
    );
  }
  return out;
}

/** Cuisine/diet texture for famous eateries, only when the tags say so. */
const EATERY_KIND_TAGS: [string, string][] = [
  ["bakery", "bakery"],
  ["ice-cream", "ice-cream shop"],
  ["pizza", "pizzeria"],
  ["cafe", "café"],
];

function composeHistoric(
  p: ComposeInput,
  ctx: { name: string; cityShort: string; where: string },
  plan: HistoricPlan,
): string {
  const { name, cityShort, where } = ctx;
  const vi = variantIndex(name.toLowerCase(), 97);
  const art = articleFor(plan.kind);

  // Sentence 1: vary the opener while keeping the same facts.
  const landmarkInline = plan.landmark && cityShort && !plan.worship;
  const openers: string[] = [
    `${name} is ${art} ${plan.kind}${where}.`,
    `${name} stands${where}, ${art} ${plan.kind}${
      plan.worship ? " revered as a place of worship" : landmarkInline ? ` and one of ${cityShort}'s landmark sights` : ""
    }.`,
    `${cap1(art)} ${plan.kind}${where}, ${name} ${
      plan.worship
        ? "welcomes worshippers and visitors alike"
        : plan.memorial
          ? "invites quiet remembrance"
          : plan.ruins
            ? "survives as a fragment of the area's past"
            : `is part of ${cityShort ? `${cityShort}'s` : "the area's"} story`
    }.`,
  ];
  const first = openers[vi % openers.length]!;

  const sentences = [first];
  for (const s of historicTextureSentences(plan, cityShort, vi)) {
    // skip a texture sentence that repeats what the opener already said
    if (first.includes("place of worship") && s.includes("place of worship")) continue;
    if (first.includes("landmark sights") && s.includes("landmark sights")) continue;
    if (first.includes("remembrance") && s.includes("remembrance")) continue;
    if (first.includes("past") && s.includes("past")) continue;
    sentences.push(s);
  }
  if (p.verdict === "must-see") sentences.push("It is considered a must-see.");
  else if (p.verdict === "worth-it") sentences.push("It is well worth a visit.");
  if (p.feeCents === 0) sentences.push("Entry is free.");
  return sentences.slice(0, 4).join(" ");
}

function composeFamousEatery(
  p: ComposeInput,
  ctx: { name: string; category: string; cityShort: string; where: string; tags: string[] },
): string {
  const { name, category, cityShort, where, tags } = ctx;
  const set = tagSetOf(tags);
  const vi = variantIndex(name.toLowerCase(), 89);

  let kind = CATEGORY_PHRASES[category.toLowerCase()] ?? category.toLowerCase();
  if (!kind) kind = "eatery";
  const special = EATERY_KIND_TAGS.find(([tag]) => set.has(tag));
  if (special) kind = special[1];
  else if (set.has("vegetarian") && kind === "restaurant") kind = "vegetarian restaurant";
  else if (set.has("vegan") && kind === "restaurant") kind = "vegan restaurant";
  const art = articleFor(kind);

  const famousPhrase = cityShort ? `one of ${cityShort}'s best-known eateries` : "one of the area's best-known eateries";
  const openers: string[] = [
    `${name} is ${art} ${kind}${where}, ${famousPhrase}.`,
    `${name} is ${famousPhrase}, ${art} ${kind}${where}.`,
  ];
  const sentences = [openers[vi % openers.length]!];

  const dish = (p.signatureDish ?? "").trim();
  if (dish) {
    sentences.push(
      [`It is best known for its ${dish}.`, `The ${dish} is the thing to order here.`][vi % 2]!,
    );
  }
  if (p.verdict === "must-see") sentences.push("It is considered a must-visit.");
  else if (p.verdict === "worth-it") sentences.push("It is well worth the stop.");
  return sentences.slice(0, 4).join(" ");
}

/**
 * Build an HONEST 1-4 sentence description using ONLY the given structured
 * fields. Never invents dates, founders, dynasties, events or history - if
 * all we know is "historic site in Madurai", that is exactly what we say.
 * r21-desc: historic/cultural rows and famous eateries get richer, varied
 * phrasing woven from the tags, verdict and signature dish on the row.
 */
export function composeDescription(p: ComposeInput): string {
  // Sanitize source fields: OSM names sometimes contain em dashes (U+2014)
  // which must never leak into generated prose. Written as an escape so
  // codemods cannot mangle it.
  const clean = (s: string | null | undefined) =>
    (s ?? "")
      .replaceAll(` ${"\u2014"} `, ", ")
      .replaceAll("\u2014", "-")
      .replace(/\s{2,}/g, " ")
      .trim();
  const name = clean(p.name);
  const category = clean(p.category);
  const city = clean(p.city);
  const country = clean(p.country);
  const tags = (p.tags ?? []).filter(Boolean);

  if (!category && !city) {
    return `${name} is a place awaiting a fuller description.`;
  }

  // Location phrase. Some rows store city as "Leh, India" with country
  // "India" - never stutter "in Leh, India, India".
  const cityHasCountry = country !== "" && city.toLowerCase().includes(country.toLowerCase());
  const where =
    city && country && !cityHasCountry
      ? ` in ${city}, ${country}`
      : city
        ? ` in ${city}`
        : country
          ? ` in ${country}`
          : "";
  // Possessive-friendly city form: "Lucknow, India" -> "Lucknow".
  const cityShort = city.includes(",") ? city.split(",")[0]!.trim() : city;
  const ctx = { name, category, city, cityShort, country, where, tags };

  // r21-desc: famous eateries get the signature-dish / verdict treatment.
  if (p.famousEatery && (category.toLowerCase() === "food" || category.toLowerCase() === "cafe")) {
    return composeFamousEatery(p, ctx);
  }

  // r21-desc: historic/cultural rows get tag-textured, varied phrasing.
  const historicPlan = planHistoric(name, category, tags);
  if (historicPlan) {
    return composeHistoric(p, ctx, historicPlan);
  }

  // Phrase: fall back to the category word for everything else.
  const phrase = category
    ? CATEGORY_PHRASES[category.toLowerCase()] ?? category.toLowerCase()
    : "place";

  const qualifiers: string[] = [];
  if (p.verdict === "must-see") qualifiers.push("considered a must-see");

  let first = `${name} is ${articleFor(phrase)} ${phrase}${where}`;
  if (qualifiers.length) first += `, ${qualifiers.join(" and ")}`;
  first += ".";

  const sentences = [first];
  if (p.feeCents === 0) sentences.push("Entry is free.");
  return sentences.join(" ");
}

