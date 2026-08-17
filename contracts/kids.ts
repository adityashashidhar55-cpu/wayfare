/**
 * Kid-friendliness model - shared by the API trip generator (candidate
 * ranking, family day rules), the seed script that tags explore_places, and
 * the client (kid badges on stops, suggestion boosts).
 *
 * Everything is a pure function over { name, category, tags } so the same
 * logic classifies explore_places rows, generated stops, and the static
 * suggestion catalog alike. The seeded `kid-friendly` / `kid-partial` /
 * `kid-avoid` tags are honored as a fast path, so classification stays
 * consistent between server and client.
 */

export type KidClass = "kid-friendly" | "kid-partial" | "kid-avoid" | "neutral";
export type AgeFit = "0-4" | "5-9" | "10+" | "all";

export interface KidPlaceLike {
  name?: string | null;
  category?: string | null;
  tags?: (string | null)[] | null;
  /** 1-4 price band; casual eateries (≤2) count as family-easy food stops. */
  priceLevel?: number | null;
}

export const AGE_FIT_LABEL: Record<AgeFit, string> = {
  "0-4": "Ages 0-4",
  "5-9": "Ages 5-9",
  "10+": "Ages 10+",
  all: "All ages",
};

/** Parse a stored "4,7" childAges string into sorted numbers (0-17 only). */
export function parseChildAges(raw?: string | null): number[] {
  if (!raw) return [];
  return raw
    .split(",")
    .map((s) => parseInt(s.trim(), 10))
    .filter((n) => Number.isFinite(n) && n >= 0 && n <= 17)
    .sort((a, b) => a - b);
}

/** Serialize ages for trips.childAges ("4,7"); null when empty. */
export function formatChildAges(ages: number[]): string | null {
  const clean = ages
    .filter((n) => Number.isInteger(n) && n >= 0 && n <= 17)
    .sort((a, b) => a - b);
  return clean.length ? clean.join(",") : null;
}

// ─── Signals ────────────────────────────────────────────────────────────────

/** Explicit tags a place can carry (seeded or curated) that decide the class. */
const FRIENDLY_TAG = "kid-friendly";
const PARTIAL_TAG = "kid-partial";
const AVOID_TAG = "kid-avoid";

/** Tags that make a place a clear win with children. */
const FRIENDLY_TAGS = new Set([
  "family",
  "zoo",
  "aquarium",
  "theme-park",
  "theme park",
  "rides",
  "beach",
  "park",
  "garden",
  "gardens",
  "nature", // OSM leisure=park/garden/nature_reserve maps here
  "forest",
  "playground",
  "viewpoint",
  "views",
  "observatory",
  "tower",
  "castle",
  "fort",
  "cable-car",
  "train",
  "railway",
  "boat",
  "ferry",
  "narrowboats",
  "swimming",
  "snorkel",
  "planetarium",
  "waterfall",
  "farm",
  "picnic",
  "safari",
  "deer",
  "puffins",
  "condors",
  "sculpture-park",
]);

/** Tags that work fine with older kids (shorter, gamified visits). */
const PARTIAL_TAGS = new Set([
  "museum",
  "art",
  "historic",
  "landmark",
  "temple",
  "shrine",
  "church",
  "cathedral",
  "basilica",
  "unesco",
  "ruins",
  "architecture",
  "monument",
  "memorial",
  "culture",
  "history",
  "heritage",
  "religious",
  "ancient",
  "palace",
  "market",
  "street-food",
  "street food",
  "food hall",
  "food-hall",
  "food-court",
  "hawker",
  "souk",
  "bazaar",
  "medina",
  "night-market",
  "neighborhood",
  "old-town",
  "historic-district",
  "library",
  "bookstore",
  "madrasa",
  "monastery",
]);

/** Tags that flag adults-only or drinking-first venues. ("late-night" alone
 *  is NOT avoid - ramen shops and night markets are family-fine.) */
const AVOID_TAGS = new Set([
  "nightlife",
  "cocktails",
  "wine-bar",
  "wine bar",
  "wine",
  "bar",
  "pub",
  "whisky",
  "whiskey",
  "beer hall",
  "mezcal",
  "casino",
  "adult",
]);

/** Compound-tag matcher: catches "theme-park", "monkey park", "water park"… */
const FRIENDLY_TAG_RE = /park|garden|zoo|aquarium|beach|castle|playground|animal/i;

const FRIENDLY_NAME_RE =
  /\b(playground|play park|kids|children('?s)?|zoo|aquarium|safari|legoland|disney|amusement|theme park|water ?park|petting|monkey park|park|gardens?|beach|castle)\b/i;
const AVOID_NAME_RE =
  /\b(bar|pub|nightclub|night club|casino|cocktail|wine bar|whisky|whiskey|brewery|brewpub|distillery|winery|strip club|adults? only|lounge)\b/i;
const TRAIN_MUSEUM_NAME_RE =
  /\b(railway|rail|tram|train|transport|locomotive|subway|metro|cable car)\b/i;
const SCIENCE_MUSEUM_NAME_RE =
  /\b(science|interactive|children('?s)?|kids|natural history|technology|discovery|planetarium|experiment)\b/i;
const BOAT_NAME_RE = /\b(boat|ferry|cruise|gondola|water bus|duck tour)\b/i;

function tagsOf(p: KidPlaceLike): string[] {
  return (p.tags ?? []).filter((t): t is string => !!t).map((t) => t.toLowerCase());
}

function nameOf(p: KidPlaceLike): string {
  return (p.name ?? "").trim();
}

function isMuseumish(tags: string[], name: string): boolean {
  return tags.includes("museum") || tags.includes("art") || /museum|gallery/i.test(name);
}

/** Classify one place. Seeded kid-* tags win; then name/category/tag heuristics. */
export function kidClass(p: KidPlaceLike): KidClass {
  const tags = tagsOf(p);
  const name = nameOf(p);
  if (tags.includes(FRIENDLY_TAG)) return "kid-friendly";
  if (tags.includes(AVOID_TAG)) return "kid-avoid";
  if (tags.includes(PARTIAL_TAG)) return "kid-partial";

  // Adults-only venues are excluded even if they also look attractive.
  if (tags.some((t) => AVOID_TAGS.has(t)) || AVOID_NAME_RE.test(name)) return "kid-avoid";

  // Train/tram + science/interactive/children museums are kid-friendly,
  // unlike fine-art or history museums (partial).
  if (isMuseumish(tags, name) && (TRAIN_MUSEUM_NAME_RE.test(name) || SCIENCE_MUSEUM_NAME_RE.test(name))) {
    return "kid-friendly";
  }
  if (tags.some((t) => FRIENDLY_TAGS.has(t) || FRIENDLY_TAG_RE.test(t))) return "kid-friendly";
  if (FRIENDLY_NAME_RE.test(name) || BOAT_NAME_RE.test(name)) return "kid-friendly";
  if (tags.some((t) => PARTIAL_TAGS.has(t))) return "kid-partial";
  // Casual food (cheap, quick, no ceremony) is fine with kids; upscale
  // dining stays neutral so it doesn't crowd out family picks.
  if ((p.category ?? "").toLowerCase() === "food") {
    if (tags.some((t) => ["fine-dining", "tasting-menu", "steakhouse"].includes(t))) return "neutral";
    if (p.priceLevel != null && p.priceLevel <= 2) return "kid-partial";
  }
  return "neutral";
}

/** 0-100 suitability score used for ranking boosts. */
export function kidScore(p: KidPlaceLike): number {
  const cls = kidClass(p);
  if (cls === "kid-avoid") return 0;
  if (cls === "kid-friendly") {
    const name = nameOf(p);
    return /playground|zoo|aquarium|theme park|amusement/i.test(name) ? 95 : 88;
  }
  if (cls === "kid-partial") return 60;
  const cat = (p.category ?? "").toLowerCase();
  return cat === "food" ? 35 : cat === "shopping" ? 30 : 45;
}

/** Age band a place fits best - drives the client badge chip. */
export function ageFit(p: KidPlaceLike): AgeFit {
  const tags = tagsOf(p);
  const name = nameOf(p);
  if (/playground|play park/i.test(name)) return "0-4";
  if (isMuseumish(tags, name)) {
    if (TRAIN_MUSEUM_NAME_RE.test(name) || SCIENCE_MUSEUM_NAME_RE.test(name)) return "5-9";
    return "10+";
  }
  if (
    tags.some((t) => ["castle", "fort", "market", "street-food", "street food", "souk", "bazaar", "medina"].includes(t)) ||
    /castle|fort|market/i.test(name)
  ) {
    return "5-9";
  }
  if (
    tags.some((t) => ["temple", "shrine", "church", "cathedral", "historic", "ruins", "memorial", "monument"].includes(t)) ||
    /temple|shrine|cathedral|ruins/i.test(name)
  ) {
    return "10+";
  }
  return "all";
}

/** Recharge-stop detector: parks, playgrounds, gardens, beaches - the
 *  mid-day downtime break a family day needs. */
export function isKidRecharge(p: KidPlaceLike): boolean {
  const tags = tagsOf(p);
  const name = nameOf(p);
  if (kidClass(p) === "kid-avoid") return false;
  if (/playground|play park/i.test(name)) return true;
  return tags.some((t) =>
    ["park", "garden", "gardens", "playground", "beach", "nature", "forest", "picnic", "lake"].includes(t),
  );
}

/** One-line "why kids love it" - template driven by category/tags/name. */
export function kidReason(p: KidPlaceLike, ages?: number[]): string | null {
  const cls = kidClass(p);
  if (cls === "neutral") return null;
  const tags = tagsOf(p);
  const name = nameOf(p);

  let reason: string;
  if (cls === "kid-avoid") {
    reason = "Better after bedtime, adults-only vibe.";
  } else if (/zoo|safari|animal|petting|monkey/i.test(name) || tags.some((t) => ["zoo", "family", "deer", "puffins", "safari"].includes(t))) {
    reason = "Animals up close, a guaranteed win with ages 3-10.";
  } else if (/aquarium/i.test(name) || tags.includes("aquarium")) {
    reason = "Tanks and tunnels, mesmerizing even for toddlers.";
  } else if (/theme park|amusement|legoland|disney/i.test(name) || tags.some((t) => ["theme-park", "theme park", "rides"].includes(t))) {
    reason = "Rides and shows, make this the day's big reward.";
  } else if (/playground|play park/i.test(name)) {
    reason = "Let them burn energy while you regroup.";
  } else if (/beach/i.test(name) || tags.includes("beach")) {
    reason = "Sand and water, low-effort, high-joy.";
  } else if (isMuseumish(tags, name) && TRAIN_MUSEUM_NAME_RE.test(name)) {
    reason = "Trains up close, a small-kid superpower.";
  } else if (isMuseumish(tags, name) && SCIENCE_MUSEUM_NAME_RE.test(name)) {
    reason = "Hands-on exhibits built for curious minds.";
  } else if (isMuseumish(tags, name)) {
    reason = "Best with older kids, pick one gallery, not five.";
  } else if (/castle|fort/i.test(name) || tags.some((t) => ["castle", "fort"].includes(t))) {
    reason = "Instant adventure, turn the visit into a quest.";
  } else if (tags.some((t) => ["park", "garden", "gardens", "nature", "forest", "picnic"].includes(t)) || /\bpark\b|garden/i.test(name)) {
    reason = "Room to run, a natural reset between sights.";
  } else if (tags.some((t) => ["viewpoint", "views", "tower", "observatory"].includes(t)) || /tower|observatory|viewpoint|lookout/i.test(name)) {
    reason = "The ride up, plus a spotting game from the top.";
  } else if (BOAT_NAME_RE.test(name) || tags.some((t) => ["boat", "ferry", "cable-car", "narrowboats"].includes(t))) {
    reason = "The ride IS the activity, sit down and enjoy it.";
  } else if (tags.some((t) => ["temple", "shrine", "church", "cathedral", "historic", "ruins"].includes(t)) || /temple|shrine|cathedral/i.test(name)) {
    reason = "Short visit works: make it a spot-the-detail game.";
  } else if (tags.some((t) => ["market", "street-food", "street food", "souk", "bazaar", "food-hall", "food hall", "hawker"].includes(t)) || /market/i.test(name)) {
    reason = "Graze as you go, picky eaters choose for themselves.";
  } else if ((p.category ?? "").toLowerCase() === "food") {
    reason = "Easy family stop, casual, quick, kid-welcoming.";
  } else if (cls === "kid-friendly") {
    reason = "An easy win with kids in tow.";
  } else {
    reason = "Fine with kids, keep it short and make it a game.";
  }

  // Age-fit caveat: little ones at a 10+ place get a pacing note instead.
  if (cls === "kid-partial" && ages?.length && Math.max(...ages) < 10 && ageFit(p) === "10+") {
    reason = "Better for older kids, with little ones, keep it short and playful.";
  }
  return reason;
}
