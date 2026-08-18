/**
 * trip-prompt.ts (r29) - turn a sentence into a trip intent.
 *
 * WHY THIS EXISTS
 *
 * The landing page has invited people to describe their trip in prose since
 * v1, and the product then threw the sentence away: src/lib/plan-prompt.ts ran
 * two regexes for "to <Place>" / "in <Place>" and discarded everything else.
 * "7-day trip to Japan, love food, avoid crowds" reached the planner as
 * `dest=Japan`. Duration, interests and the negation were lost, so the
 * headline feature of the site did nothing.
 *
 * DELIBERATELY NOT AN LLM
 *
 * There is no model anywhere in this codebase, and adding one to parse a
 * travel sentence would be a poor trade: it costs money per keystroke, adds
 * latency to the first interaction a visitor has, fails closed when the
 * provider is down, and is non-deterministic in a path we want to unit-test.
 * The destination vocabulary we actually rank against is a fixed set of ~20
 * style ids (api/lib/style-map.ts), so the job is phrase -> style id, which a
 * lexicon does exactly and repeatably.
 *
 * The output type is deliberately the same shape an LLM would return, so a
 * model can be layered in later as an ENRICHMENT (fill fields left null)
 * without changing a single caller.
 */

/** Canonical style ids understood by api/lib/style-map.ts. */
export type StyleId =
  | "adventure" | "food" | "budget" | "historical" | "relaxing"
  | "nightlife" | "music" | "culture" | "nature" | "shopping"
  | "photography" | "family" | "street-food" | "coffee" | "fine-dining"
  | "hiking" | "beaches" | "museums" | "architecture" | "local-markets"
  | "temples" | "live-music" | "viewpoints";

export interface TripIntent {
  /** Best guess at where. Null when the sentence names nowhere. */
  destination: string | null;
  /** Nights, when stated or inferable ("a week" -> 7). */
  durationDays: number | null;
  /** 1-12 when a month is named. */
  month: number | null;
  /** Styles to rank UP. */
  styles: StyleId[];
  /** Styles to rank DOWN - "no museums", "avoid nightlife". */
  avoid: StyleId[];
  budgetBand: "shoestring" | "mid" | "comfort" | "luxury" | null;
  pace: "relaxed" | "balanced" | "packed" | null;
  withChildren: boolean;
  partySize: number | null;
  /** Free-text fragments that named nothing we know - shown back as "we ignored". */
  unmatched: string[];
  /** 0-1. How much of the sentence we actually understood. */
  confidence: number;
}

/* ── Lexicons ──────────────────────────────────────────────────────────── */

/**
 * Phrase -> style. Order matters: longer phrases are matched first so
 * "street food" wins over "food". Everything is matched on word boundaries
 * against the lowercased sentence.
 */
const STYLE_PHRASES: ReadonlyArray<readonly [string, StyleId]> = [
  // food family
  ["street food", "street-food"], ["streetfood", "street-food"],
  ["food stalls", "street-food"], ["hawker", "street-food"],
  ["night market", "local-markets"], ["local market", "local-markets"],
  ["farmers market", "local-markets"], ["bazaar", "local-markets"], ["souk", "local-markets"],
  ["fine dining", "fine-dining"], ["michelin", "fine-dining"], ["tasting menu", "fine-dining"],
  ["coffee", "coffee"], ["cafe", "coffee"], ["cafes", "coffee"], ["espresso", "coffee"],
  ["foodie", "food"], ["food", "food"], ["eat", "food"], ["eating", "food"],
  ["restaurants", "food"], ["restaurant", "food"], ["cuisine", "food"],
  ["culinary", "food"], ["dishes", "food"], ["breakfast", "food"], ["brunch", "food"],
  // outdoors
  ["hiking", "hiking"], ["hike", "hiking"], ["hikes", "hiking"], ["trek", "hiking"],
  ["trekking", "hiking"], ["treks", "hiking"], ["trails", "hiking"], ["trail", "hiking"],
  ["walks", "hiking"],
  ["backwaters", "nature"], ["waterfall", "nature"], ["waterfalls", "nature"],
  ["wildlife", "nature"], ["safari", "nature"], ["forest", "nature"],
  ["mountains", "nature"], ["lakes", "nature"], ["nature", "nature"], ["outdoors", "nature"],
  ["beach", "beaches"], ["beaches", "beaches"], ["seaside", "beaches"],
  ["snorkel", "beaches"], ["diving", "beaches"], ["island", "beaches"],
  ["adventure", "adventure"], ["adventurous", "adventure"], ["rafting", "adventure"],
  ["scuba", "adventure"], ["surfing", "adventure"], ["ziplin", "adventure"],
  // culture
  ["museum", "museums"], ["museums", "museums"], ["gallery", "museums"],
  ["galleries", "museums"], ["exhibition", "museums"], ["exhibitions", "museums"],
  ["temple", "temples"], ["temples", "temples"], ["shrine", "temples"],
  ["church", "temples"], ["mosque", "temples"], ["monastery", "temples"],
  ["architecture", "architecture"], ["heritage", "architecture"],
  ["palace", "architecture"], ["fort", "architecture"], ["castle", "architecture"],
  ["history", "historical"], ["historical", "historical"], ["historic", "historical"],
  ["ruins", "historical"], ["ancient", "historical"],
  ["culture", "culture"], ["cultural", "culture"], ["art", "culture"], ["theatre", "culture"],
  // night
  ["live music", "live-music"], ["gigs", "live-music"], ["concerts", "live-music"],
  ["nightlife", "nightlife"], ["bars", "nightlife"], ["clubs", "nightlife"],
  ["clubbing", "nightlife"], ["party", "nightlife"], ["partying", "nightlife"],
  ["drinks", "nightlife"], ["pubs", "nightlife"], ["rooftop", "nightlife"],
  ["music", "music"],
  // other
  ["shopping", "shopping"], ["shop", "shopping"], ["boutique", "shopping"],
  ["photography", "photography"], ["photos", "photography"],
  ["instagram", "photography"], ["photogenic", "photography"],
  ["viewpoint", "viewpoints"], ["viewpoints", "viewpoints"], ["sunset", "viewpoints"],
  ["views", "viewpoints"], ["scenic", "viewpoints"], ["skyline", "viewpoints"],
  ["relax", "relaxing"], ["relaxing", "relaxing"], ["chill", "relaxing"],
  ["unwind", "relaxing"], ["spa", "relaxing"], ["quiet", "relaxing"],
  ["peaceful", "relaxing"], ["slow", "relaxing"], ["laid back", "relaxing"],
  ["budget", "budget"], ["cheap", "budget"], ["affordable", "budget"],
  ["backpack", "budget"], ["free things", "budget"],
  ["family", "family"], ["kids", "family"], ["children", "family"], ["toddler", "family"],
];

/** Words that flip the following phrase into `avoid`. */
const NEGATORS = [
  "avoid", "avoiding", "no", "not", "without", "skip", "skipping", "hate", "hates",
  "dislike", "don't want", "dont want", "do not want", "less", "minus", "except",
  "nothing", "away from", "steer clear", "rather not", "prefer not", "sick of",
  "tired of", "fed up with",
];

/** Things people ask to avoid that are not styles - mapped to the nearest one. */
const AVOID_SYNONYMS: ReadonlyArray<readonly [string, StyleId]> = [
  ["crowds", "historical"],   // crowded = the famous landmark circuit
  ["crowded", "historical"],
  ["touristy", "historical"],
  ["tourist traps", "historical"],
  ["queues", "historical"],
  ["lines", "historical"],
];

const MONTHS = ["january","february","march","april","may","june","july",
  "august","september","october","november","december"];

const BUDGET_PHRASES: ReadonlyArray<readonly [string, TripIntent["budgetBand"]]> = [
  ["shoestring", "shoestring"], ["backpacking", "shoestring"], ["dirt cheap", "shoestring"],
  ["cheap", "shoestring"], ["budget", "shoestring"], ["affordable", "mid"],
  ["mid range", "mid"], ["mid-range", "mid"], ["moderate", "mid"],
  ["comfortable", "comfort"], ["nice hotels", "comfort"], ["boutique", "comfort"],
  ["luxury", "luxury"], ["luxurious", "luxury"], ["splurge", "luxury"],
  ["five star", "luxury"], ["5 star", "luxury"], ["high end", "luxury"],
];

const PACE_PHRASES: ReadonlyArray<readonly [string, TripIntent["pace"]]> = [
  ["packed", "packed"], ["jam packed", "packed"], ["see everything", "packed"],
  ["as much as possible", "packed"], ["fast paced", "packed"], ["whirlwind", "packed"],
  ["relaxed", "relaxed"], ["slow", "relaxed"], ["leisurely", "relaxed"],
  ["take it easy", "relaxed"], ["chill", "relaxed"], ["unhurried", "relaxed"],
  ["balanced", "balanced"], ["mix of", "balanced"],
];

/* ── Helpers ───────────────────────────────────────────────────────────── */

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Word-boundary test that tolerates the trailing space in phrases like "no ". */
function has(hay: string, needle: string): boolean {
  const n = needle.trim();
  if (!n) return false;
  return new RegExp(`(^|[^a-z0-9])${esc(n)}([^a-z0-9]|$)`, "i").test(hay);
}

/** Index of a phrase, or -1. */
function at(hay: string, needle: string): number {
  const m = new RegExp(`(^|[^a-z0-9])(${esc(needle.trim())})([^a-z0-9]|$)`, "i").exec(hay);
  return m ? m.index : -1;
}

/**
 * True when `phrase` sits inside a negated span. We look backwards from the
 * phrase for a negator within NEG_WINDOW characters and check no comma or
 * "but"/"and" resets the clause in between - so "no museums, love food"
 * negates museums but not food.
 */
const NEG_WINDOW = 28;
function isNegated(text: string, phraseIdx: number): boolean {
  if (phraseIdx < 0) return false;
  const before = text.slice(Math.max(0, phraseIdx - NEG_WINDOW), phraseIdx);
  const reset = Math.max(before.lastIndexOf(","), before.lastIndexOf(";"),
    before.lastIndexOf(" but "), before.lastIndexOf(" and "));
  const scope = reset >= 0 ? before.slice(reset) : before;
  // Word-boundary match, not substring: at() returns the index INCLUDING the
  // leading boundary character, so "no museums" leaves scope ending "..., no"
  // with no trailing space. A naive scope.includes("no ") therefore never
  // fired and every negation in the product silently became a preference.
  return NEGATORS.some((n) =>
    new RegExp(`(^|[^a-z0-9])${esc(n)}([^a-z0-9]|$)`, "i").test(scope));
}

/** "a week" / "10 days" / "long weekend" -> nights. */
function parseDuration(t: string): number | null {
  const n = /(\d{1,2})\s*[- ]?\s*(day|days|night|nights|d\b)/i.exec(t);
  if (n) { const v = Number(n[1]); if (v >= 1 && v <= 60) return v; }
  const w = /(\d{1,2})\s*[- ]?\s*(week|weeks)/i.exec(t);
  if (w) { const v = Number(w[1]) * 7; if (v <= 60) return v; }
  if (has(t, "long weekend")) return 3;
  if (has(t, "weekend")) return 2;
  if (has(t, "fortnight")) return 14;
  if (/\ba week\b/i.test(t)) return 7;
  if (/\btwo weeks\b/i.test(t)) return 14;
  if (/\ba month\b/i.test(t)) return 30;
  return null;
}

function parseMonth(t: string): number | null {
  for (let i = 0; i < MONTHS.length; i++) {
    const full = MONTHS[i]!;
    if (has(t, full) || has(t, full.slice(0, 3))) return i + 1;
  }
  return null;
}

function parseParty(t: string): { withChildren: boolean; partySize: number | null } {
  const withChildren = has(t, "kids") || has(t, "children") || has(t, "toddler") ||
    has(t, "family") || /\bwith (my )?(son|daughter)\b/i.test(t);
  let partySize: number | null = null;
  const n = /(\d{1,2})\s*(people|of us|adults|friends|travellers|travelers|pax)/i.exec(t);
  if (n) partySize = Number(n[1]);
  else if (has(t, "solo") || has(t, "by myself") || has(t, "alone")) partySize = 1;
  else if (has(t, "couple") || has(t, "honeymoon") || has(t, "my partner") ||
           has(t, "girlfriend") || has(t, "boyfriend") || has(t, "wife") || has(t, "husband")) partySize = 2;
  return { withChildren, partySize };
}

/**
 * Destination. Improves on the old two-regex version by trying more
 * prepositions, stopping at clause boundaries, and rejecting matches that are
 * really an interest ("in search of food").
 */
const DEST_STOPWORDS = new Set(["Search", "The", "A", "An", "My", "Our", "Some", "Any",
  "Day", "Days", "Week", "Weeks", "Night", "Nights", "Trip", "Holiday", "Vacation",
  "Budget", "Food", "Nature", "Culture", "Adventure", "Summer", "Winter", "Spring", "Autumn"]);

export function extractDestination(prompt: string): string | null {
  const place = "([A-Z][\\p{L}'’.-]+(?:\\s+(?:of|de|del|la|le|el|da|do|and|&)\\s+[A-Z\\p{L}][\\p{L}'’.-]*|\\s+[A-Z][\\p{L}'’.-]+){0,3})";
  // Earliest match in the sentence wins, not first preposition in our list -
  // otherwise "two weeks around Rajasthan in December" resolves to December.
  let best: { idx: number; hit: string } | null = null;
  for (const prep of ["to", "in", "around", "across", "through", "visiting", "explore", "exploring", "at"]) {
    const re = new RegExp(`\\b${prep}\\s+${place}`, "u");
    const m = re.exec(prompt);
    const hit = m?.[1]?.trim().replace(/[.,;:!?]+$/, "");
    if (!hit || m == null) continue;
    if (isRejectedDestination(hit)) continue;
    if (!best || m.index < best.idx) best = { idx: m.index, hit };
  }
  if (best) return best.hit;
  // Bare leading proper noun: "Kerala for 5 days"
  const lead = new RegExp(`^\\s*${place}\\b`, "u").exec(prompt);
  const hit = lead?.[1]?.trim();
  if (hit && !isRejectedDestination(hit)) return hit;
  return null;
}

/** A month, a filler noun, or a style word is never a destination. */
function isRejectedDestination(hit: string): boolean {
  const first = hit.split(/\s+/)[0] ?? "";
  if (DEST_STOPWORDS.has(first)) return true;
  const low = hit.toLowerCase();
  if (MONTHS.includes(low) || MONTHS.some((m) => m.slice(0, 3) === low)) return true;
  // "in search of street food" - the captured span is an interest, not a place.
  return STYLE_PHRASES.some(([phrase]) => phrase === low);
}

/* ── The parser ────────────────────────────────────────────────────────── */

export function parseTripPrompt(raw: string): TripIntent {
  const prompt = (raw || "").slice(0, 2000);
  const t = prompt.toLowerCase();

  const styles = new Set<StyleId>();
  const avoid = new Set<StyleId>();
  const matchedSpans: string[] = [];

  // Longest phrases first so "street food" beats "food".
  const ordered = [...STYLE_PHRASES].sort((a, b) => b[0].length - a[0].length);
  for (const [phrase, style] of ordered) {
    const idx = at(t, phrase);
    if (idx < 0) continue;
    matchedSpans.push(phrase);
    if (isNegated(t, idx)) avoid.add(style); else styles.add(style);
  }
  for (const [phrase, style] of AVOID_SYNONYMS) {
    const idx = at(t, phrase);
    if (idx < 0) continue;
    matchedSpans.push(phrase);
    // "crowds" is almost always something people want LESS of; only treat it
    // as a positive when they explicitly say they like it.
    if (/\b(love|like|want|enjoy)\s+(the\s+)?crowds?\b/i.test(t)) styles.add(style);
    else avoid.add(style);
  }
  // A style asked for and avoided in the same sentence: the avoid wins, since
  // "temples but no crowded temples" should not rank temples up.
  for (const s of avoid) styles.delete(s);

  let budgetBand: TripIntent["budgetBand"] = null;
  for (const [phrase, band] of BUDGET_PHRASES) {
    if (has(t, phrase)) { budgetBand = band; matchedSpans.push(phrase); break; }
  }
  let pace: TripIntent["pace"] = null;
  for (const [phrase, p] of PACE_PHRASES) {
    if (has(t, phrase)) { pace = p; matchedSpans.push(phrase); break; }
  }

  const durationDays = parseDuration(t);
  const month = parseMonth(t);
  const { withChildren, partySize } = parseParty(t);
  const destination = extractDestination(prompt);

  // Confidence: what fraction of the signals we look for did we actually find.
  const signals = [destination, durationDays, month, budgetBand, pace,
    styles.size > 0 ? "s" : null, avoid.size > 0 ? "a" : null, partySize];
  const found = signals.filter((v) => v !== null && v !== undefined).length;
  const confidence = Math.round((found / signals.length) * 100) / 100;

  // Words we never used - surfaced so the UI can say what it ignored rather
  // than silently dropping half the sentence the way the old code did.
  const consumed = new Set(matchedSpans.flatMap((p) => p.split(/\s+/)));
  const unmatched = t
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 3 && !consumed.has(w) && !FILLER.has(w))
    .slice(0, 12);

  return { destination, durationDays, month, styles: [...styles], avoid: [...avoid],
    budgetBand, pace, withChildren, partySize, unmatched, confidence };
}

const FILLER = new Set(["want","would","like","love","really","some","with","from","that","this",
  "there","where","when","going","want","trip","travel","visit","plan","planning","holiday",
  "vacation","days","day","week","weeks","night","nights","time","place","places","things",
  "something","around","about","also","just","need","looking","take","make","good","great",
  "best","nice","have","been","were","will","then","than","into","over","near","more","most",
  "very","much","many","them","they","their"]);
