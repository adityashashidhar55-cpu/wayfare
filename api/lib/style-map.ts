/**
 * Shared style → corpus mapping ("the style map").
 *
 * Places in explore_places carry two personalization signals:
 *   - `styles`: the canonical PREFERENCE_STYLES vocabulary
 *     (adventure | food | budget | historical | relaxing), plus a few
 *     extended values importers add (e.g. "nightlife"),
 *   - `tags`:   free-form corpus tags (nightlife, bar, pub, live-music,
 *     market, street-food, temple, museum, …).
 *
 * Ranking helpers match the USER's styles against these. The canonical five
 * styles overlap the place styles column directly; extended asks like
 * "nightlife" or "music" never appear in that column for most rows, so
 * without this map a nightlife request ranked by rating alone - and users
 * got statues instead of bars. STYLE_TO_TAGS bridges that gap: it lists the
 * corpus tags that express each style, so a "nightlife" ask boosts places
 * tagged bar|pub|club|nightclub|live-music|… and a "music" ask boosts
 * live-music|theatre|arts venues.
 *
 * OSM grounding (importers map these into the same tag vocabulary):
 *   nightlife → amenity=bar|pub|nightclub|biergarten
 *   music     → amenity=music_venue, amenity/tourism=theatre|arts_centre
 *
 * This module is pure data + helpers - generators/rankers import it; it
 * imports nothing from the API layer.
 */

/** style id (lowercase) → corpus tags that express it. */
export const STYLE_TO_TAGS: Record<string, readonly string[]> = {
  // ── canonical PREFERENCE_STYLES ──────────────────────────────────────────
  // r15-places: adventure = thrills + outdoors. Kids' stuff (zoo/family)
  // belongs ONLY to the family style - its presence here is why adventure
  // trips got children's parks. "deer" (wildlife parks) moved out to nature;
  // "walk" stays (hikes/city walks are soft adventure, and the hiking style
  // leans on it).
  adventure: [
    "adventure", "hike", "hiking", "peak", "waterfall", "nature", "views",
    "viewpoint", "beach", "snorkel", "swimming", "bikes", "glacier", "walk",
    "theme-park", "water-park", "rides", "adventure-park", "climbing",
    "rafting", "zipline", "go-kart", "paintball", "surfing",
  ],
  food: [
    "food", "restaurant", "street-food", "market", "night-market", "bakery",
    "cafe", "coffee", "seafood", "dinner", "lunch", "ramen", "sushi", "tacos",
    "okonomiyaki", "izakaya", "brunch", "tea", "kissaten", "tasting",
    "local-favorite", "casual", "food-court", "hawker", "deli", "bistro",
  ],
  budget: [
    "market", "street-food", "park", "garden", "gardens", "views", "viewpoint",
    "beach", "temple", "historic", "walk", "picnic",
  ],
  historical: [
    "historic", "history", "museum", "art", "temple", "church", "mosque",
    "cathedral", "chapel", "shrine", "synagogue", "gurudwara", "pagoda",
    "buddha", "castle", "palace", "fort", "ruins", "monument", "memorial",
    "architecture", "heritage", "landmark", "culture", "old-town", "statue",
  ],
  relaxing: [
    "park", "garden", "gardens", "nature", "beach", "lake", "river",
    "riverfront", "spa", "hot-spring", "calm", "quiet", "picnic", "views",
    "sunset", "pools", "walk",
  ],

  // ── extended styles (quiz chips, free-form asks) ─────────────────────────
  nightlife: [
    "nightlife", "bar", "pub", "club", "nightclub", "cocktails", "wine-bar",
    "drinks", "late-night", "night", "rooftop", "brewery", "biergarten",
    "live-music", "music", "neon", "mezcal", "whisky",
  ],
  music: [
    "live-music", "music", "performers", "nightlife", "bar", "club",
    "nightclub", "theatre", "arts", "art",
  ],
  culture: [
    "museum", "art", "culture", "theatre", "arts", "historic", "history",
    "heritage", "temple", "church", "old-town", "performers", "design",
  ],
  nature: [
    "nature", "park", "garden", "gardens", "beach", "lake", "river",
    "waterfall", "peak", "hike", "deer", "nature-reserve",
  ],
  shopping: [
    "shopping", "mall", "market", "markets", "souk", "bazaar", "night-market",
    "haggling", "bookshops", "design",
  ],
  photography: [
    "photography", "viewpoint", "views", "sunset", "skyline", "neon",
    "old-town", "nature", "landmark",
  ],
  family: [
    "family", "zoo", "aquarium", "playground", "theme-park", "rides",
    "planetarium", "water-park",
  ],

  // ── interest-level ids (onboarding Q4) when they reach the API as styles ──
  "street-food": ["street-food", "market", "night-market", "food-court", "hawker", "food"],
  coffee: ["coffee", "cafe", "kissaten", "brunch", "tea"],
  "fine-dining": ["dinner", "tasting", "restaurant", "food"],
  hiking: ["hike", "hiking", "peak", "waterfall", "nature", "walk"],
  beaches: ["beach", "beachfront", "seaside", "snorkel", "swimming"],
  museums: ["museum", "art", "gallery", "history"],
  architecture: ["architecture", "heritage", "historic", "landmark", "palace", "fort", "castle"],
  "local-markets": ["market", "markets", "souk", "bazaar", "night-market", "street-food", "haggling"],
  temples: ["temple", "church", "mosque", "shrine", "gurudwara", "synagogue", "pagoda", "buddha"],
  "live-music": ["live-music", "music", "performers", "nightlife", "theatre", "bar", "club"],
  viewpoints: ["viewpoint", "views", "observatory", "skyline", "sunset", "peak"],
};

/** All corpus tags relevant to the given styles (deduped set). */
export function tagsForStyles(styles: Iterable<string>): Set<string> {
  const out = new Set<string>();
  for (const s of styles) {
    const entry = STYLE_TO_TAGS[s.trim().toLowerCase()];
    if (entry) for (const t of entry) out.add(t);
  }
  return out;
}

/**
 * Personalization score for ranking helpers: canonical style-column overlap
 * (10 pts each - the historic weight) PLUS tag overlap via STYLE_TO_TAGS
 * (4 pts per matching tag, capped at 3 tags) so extended styles like
 * "nightlife"/"music" steer ranking even though they never appear in most
 * rows' styles column. Returns 0 when the user picked no styles.
 */
// r21-perf: tagsForStyles(userStyles) is constant for a whole scoring pass,
// but styleMatchScore runs once per corpus row (~390k times per feed load).
// Memoize per userStyles Set object (WeakMap: no leak, one entry per request).
const wantedCache = new WeakMap<ReadonlySet<string>, Set<string>>();

export function styleMatchScore(
  place: { styles?: string[] | null; tags?: string[] | null },
  userStyles: ReadonlySet<string>,
): number {
  if (!userStyles.size) return 0;
  const styleOverlap = (place.styles ?? []).filter((s) => userStyles.has(s)).length;
  let score = styleOverlap * 10;
  let wanted = wantedCache.get(userStyles);
  if (!wanted) {
    wanted = tagsForStyles(userStyles);
    wantedCache.set(userStyles, wanted);
  }
  if (wanted.size) {
    let tagHits = 0;
    for (const t of place.tags ?? []) {
      if (wanted.has(t.toLowerCase())) tagHits++;
    }
    score += Math.min(tagHits, 3) * 4;
  }
  return score;
}

// ─── statue/memorial/artwork deprioritization ────────────────────────────────

/**
 * Statue-like places: historic=memorial|statue, tourism=artwork,
 * man_made=statue (importers tag these "statue"/"memorial"/"artwork"), or a
 * name that says so. Real attractions keep ranking above these - travelers
 * asking for "things to do" rarely mean three statues a day.
 */
const STATUE_TAGS = new Set(["statue", "memorial", "artwork"]);
const STATUE_NAME_RE = /\b(statue|memorial|cenotaph|bust)\b/i;

export function isStatueLike(p: { name?: string | null; tags?: string[] | null }): boolean {
  for (const t of p.tags ?? []) {
    if (STATUE_TAGS.has(t.toLowerCase())) return true;
  }
  return p.name != null && STATUE_NAME_RE.test(p.name);
}

/** Ranking penalty for statue-like places (deprioritize, don't exclude). */
export const STATUE_PENALTY = 3;

/**
 * r29: fold a saved taste profile into the style set the rankers consume.
 *
 * `preferences.interests` (onboarding Q4: street-food, museums, viewpoints,
 * temples, hiking...) has been collected since the quiz shipped and read by
 * NOTHING. STYLE_TO_TAGS above already carries an entry for every one of those
 * interest ids, added with the comment "when they reach the API as styles" -
 * they never did. So the most specific thing a user told us about themselves
 * was the one thing ranking ignored.
 *
 * `cuisines` is folded in the same way: a stated cuisine implies the food
 * style, which is weaker than the cuisine itself but strictly better than the
 * current behaviour of discarding it.
 *
 * Interests are appended, not substituted: `styles` stays the coarse signal
 * and interests sharpen it.
 */
export function profileStyles(pref: {
  styles?: string[] | null;
  interests?: string[] | null;
  cuisines?: string[] | null;
} | null | undefined): Set<string> {
  const out = new Set<string>();
  for (const s of pref?.styles ?? []) if (s) out.add(s);
  for (const i of pref?.interests ?? []) {
    if (!i) continue;
    // Only ids we can actually express as corpus tags; an unknown interest
    // would otherwise contribute a style that matches nothing and dilutes
    // the overlap count.
    if (i in STYLE_TO_TAGS) out.add(i);
  }
  if ((pref?.cuisines?.length ?? 0) > 0) out.add("food");
  return out;
}
