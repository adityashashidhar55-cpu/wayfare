/**
 * verdict.ts - editorial "can it be skipped?" heuristic for explore_places.
 *
 *   must-see      world-famous landmark (curated table, fuzzy name+city),
 *                 UNESCO/World-Heritage cues, or a very highly rated place in
 *                 an iconic category (castle, temple, museum, …)
 *   skip-if-tight generic stop that isn't clearly well-regarded: memorials,
 *                 statues, sculptures, artworks, fountains, playgrounds,
 *                 convenience stores and generic parks. "Well-regarded" means
 *                 rating ≥ 4.4 - most of the corpus is OSM imports sitting at
 *                 the 4.3 import default, so a generic place at 4.3 carries no
 *                 quality signal (a hard < 4.0 rule would never fire).
 *   worth-it      everything else
 *
 * Pure functions, no I/O - shared by db/seed-verdicts.ts (backfill) and the
 * journal OSM-import path (verdict stamped at insert time). The client-side
 * chip labels live in src/lib/place-meta.ts.
 */
import { normPlace } from "../queries/place-match";

export type PlaceVerdict = "must-see" | "worth-it" | "skip-if-tight";
export const PLACE_VERDICTS: PlaceVerdict[] = ["must-see", "worth-it", "skip-if-tight"];

export interface VerdictInput {
  name: string;
  city?: string | null;
  country?: string | null;
  category?: string | null;
  tags?: string[] | null;
  rating?: number | null;
  description?: string | null;
}

// ─── World-famous table (~250 entries) ──────────────────────────────────────
// name (+ optional city guard). Matching is normalized (case/diacritics
// insensitive): exact name always wins; a contains match needs the city guard
// so "Taj Mahal" the curry house never inherits the marble one's verdict.
interface FamousEntry {
  name: string;
  city?: string;
}
const f = (name: string, city?: string): FamousEntry => ({ name, city });

const WORLD_FAMOUS: FamousEntry[] = [
  // ── Japan
  f("Fushimi Inari", "Kyoto"), f("Kiyomizu-dera", "Kyoto"), f("Kinkaku-ji", "Kyoto"),
  f("Arashiyama Bamboo Grove", "Kyoto"), f("Nijo Castle", "Kyoto"), f("Gion", "Kyoto"),
  f("Senso-ji", "Tokyo"), f("Meiji Shrine", "Tokyo"), f("Tokyo Tower", "Tokyo"),
  f("Tokyo Skytree", "Tokyo"), f("Shibuya Crossing", "Tokyo"), f("Mount Fuji"),
  f("Itsukushima Shrine"), f("Todai-ji", "Nara"), f("Himeji Castle"),
  f("Osaka Castle", "Osaka"), f("Hiroshima Peace Memorial", "Hiroshima"),
  f("Dotonbori", "Osaka"), f("Kenroku-en", "Kanazawa"), f("Jigokudani Monkey Park"),
  // ── France
  f("Eiffel Tower", "Paris"), f("Louvre", "Paris"), f("Notre-Dame", "Paris"),
  f("Arc de Triomphe", "Paris"), f("Sacré-Cœur", "Paris"), f("Musée d'Orsay", "Paris"),
  f("Sainte-Chapelle", "Paris"), f("Palace of Versailles"), f("Mont Saint-Michel"),
  f("Pont du Gard"), f("Château de Chambord"), f("Champs-Élysées", "Paris"),
  // ── Italy
  f("Colosseum", "Rome"), f("Roman Forum", "Rome"), f("Pantheon", "Rome"),
  f("Trevi Fountain", "Rome"), f("Spanish Steps", "Rome"), f("Vatican Museums"),
  f("St. Peter's Basilica"), f("Sistine Chapel"), f("Florence Cathedral", "Florence"),
  f("Uffizi Gallery", "Florence"), f("Leaning Tower of Pisa", "Pisa"),
  f("Grand Canal", "Venice"), f("St. Mark's Basilica", "Venice"), f("Rialto Bridge", "Venice"),
  f("Milan Cathedral", "Milan"), f("Pompeii"), f("Cinque Terre"), f("Amalfi Cathedral", "Amalfi"),
  // ── Spain / Portugal
  f("Sagrada Família", "Barcelona"), f("Park Güell", "Barcelona"), f("Casa Batlló", "Barcelona"),
  f("Alhambra", "Granada"), f("Mezquita", "Córdoba"), f("Prado Museum", "Madrid"),
  f("Seville Cathedral", "Seville"), f("Alcázar of Seville", "Seville"),
  f("Santiago de Compostela Cathedral"), f("Guggenheim Museum Bilbao", "Bilbao"),
  f("Belém Tower", "Lisbon"), f("Jerónimos Monastery", "Lisbon"), f("Pena Palace", "Sintra"),
  // ── UK / Ireland
  f("Tower of London", "London"), f("Buckingham Palace", "London"), f("Westminster Abbey", "London"),
  f("Big Ben", "London"), f("British Museum", "London"), f("London Eye", "London"),
  f("Tower Bridge", "London"), f("St Paul's Cathedral", "London"), f("Stonehenge"),
  f("Edinburgh Castle", "Edinburgh"), f("Windsor Castle", "Windsor"), f("Roman Baths", "Bath"),
  f("Giant's Causeway"), f("Cliffs of Moher"),
  // ── Central / Northern Europe
  f("Brandenburg Gate", "Berlin"), f("Neuschwanstein Castle"), f("Cologne Cathedral", "Cologne"),
  f("East Side Gallery", "Berlin"), f("Rijksmuseum", "Amsterdam"), f("Van Gogh Museum", "Amsterdam"),
  f("Anne Frank House", "Amsterdam"), f("Keukenhof"), f("Schönbrunn Palace", "Vienna"),
  f("St. Stephen's Cathedral", "Vienna"), f("Belvedere Palace", "Vienna"),
  f("Prague Castle", "Prague"), f("Charles Bridge", "Prague"), f("Prague Astronomical Clock", "Prague"),
  f("Grand Place", "Brussels"), f("Bruges Belfry", "Bruges"), f("Hungarian Parliament", "Budapest"),
  f("Fisherman's Bastion", "Budapest"), f("Buda Castle", "Budapest"), f("Tivoli Gardens", "Copenhagen"),
  f("Vasa Museum", "Stockholm"), f("Geirangerfjord"), f("Blue Lagoon"), f("Gullfoss"),
  f("Geysir"), f("Jökulsárlón"), f("Hallgrímskirkja", "Reykjavik"),
  // ── Greece / Turkey
  f("Acropolis", "Athens"), f("Parthenon", "Athens"), f("Oia", "Santorini"), f("Meteora"),
  f("Hagia Sophia", "Istanbul"), f("Blue Mosque", "Istanbul"), f("Topkapi Palace", "Istanbul"),
  f("Grand Bazaar", "Istanbul"), f("Göreme"), f("Pamukkale"), f("Ephesus"),
  // ── Middle East / Egypt
  f("Pyramids of Giza"), f("Great Sphinx", "Giza"), f("Karnak", "Luxor"),
  f("Valley of the Kings", "Luxor"), f("Abu Simbel"), f("Petra"), f("Western Wall", "Jerusalem"),
  f("Dome of the Rock", "Jerusalem"), f("Masada"), f("Burj Khalifa", "Dubai"),
  f("Sheikh Zayed Grand Mosque", "Abu Dhabi"),
  // ── South / East Asia
  f("Taj Mahal", "Agra"), f("Amber Fort", "Jaipur"), f("Golden Temple", "Amritsar"),
  f("Hawa Mahal", "Jaipur"), f("Mehrangarh Fort", "Jodhpur"), f("Great Wall of China"),
  f("Forbidden City", "Beijing"), f("Temple of Heaven", "Beijing"), f("Summer Palace", "Beijing"),
  f("Terracotta Army", "Xi'an"), f("The Bund", "Shanghai"), f("West Lake", "Hangzhou"),
  f("Potala Palace", "Lhasa"), f("Victoria Peak", "Hong Kong"), f("Gyeongbokgung Palace", "Seoul"),
  f("Grand Palace", "Bangkok"), f("Wat Pho", "Bangkok"), f("Wat Arun", "Bangkok"),
  f("Doi Suthep", "Chiang Mai"), f("Ha Long Bay"), f("Hoi An Ancient Town", "Hoi An"),
  f("Angkor Wat"), f("Bayon Temple"), f("Borobudur"), f("Prambanan"), f("Tanah Lot", "Bali"),
  f("Petronas Towers", "Kuala Lumpur"), f("Batu Caves"), f("Marina Bay Sands", "Singapore"),
  f("Gardens by the Bay", "Singapore"),
  // ── Americas
  f("Statue of Liberty", "New York"), f("Times Square", "New York"), f("Central Park", "New York"),
  f("Empire State Building", "New York"), f("Metropolitan Museum of Art", "New York"),
  f("Brooklyn Bridge", "New York"), f("Grand Central Terminal", "New York"),
  f("National September 11 Memorial", "New York"), f("Grand Canyon"), f("Golden Gate Bridge", "San Francisco"),
  f("Alcatraz", "San Francisco"), f("Yosemite"), f("Yellowstone"), f("Niagara Falls"),
  f("Mount Rushmore"), f("Space Needle", "Seattle"), f("Millennium Park", "Chicago"),
  f("Lincoln Memorial", "Washington"), f("Washington Monument", "Washington"),
  f("United States Capitol", "Washington"), f("French Quarter", "New Orleans"),
  f("Walt Disney World", "Orlando"), f("Disneyland", "Anaheim"), f("Las Vegas Strip", "Las Vegas"),
  f("Antelope Canyon"), f("Hoover Dam"), f("CN Tower", "Toronto"), f("Lake Louise", "Banff"),
  f("Chichen Itza"), f("Teotihuacan"), f("Christ the Redeemer", "Rio de Janeiro"),
  f("Sugarloaf Mountain", "Rio de Janeiro"), f("Iguazu Falls"), f("Machu Picchu"),
  f("Perito Moreno Glacier"), f("Easter Island"), f("Salar de Uyuni"), f("Galápagos Islands"),
  f("Torres del Paine"),
  // ── Africa / Middle East extras
  f("Jemaa el-Fnaa", "Marrakech"), f("Hassan II Mosque", "Casablanca"), f("Chefchaouen"),
  f("Aït Benhaddou"), f("Table Mountain", "Cape Town"), f("Kruger National Park"),
  f("Robben Island", "Cape Town"), f("Victoria Falls"), f("Serengeti"), f("Maasai Mara"),
  f("Mount Kilimanjaro"), f("Ngorongoro"),
  // ── Oceania
  f("Sydney Opera House", "Sydney"), f("Sydney Harbour Bridge", "Sydney"), f("Great Barrier Reef"),
  f("Uluru"), f("Twelve Apostles"), f("Milford Sound"), f("Hobbiton", "Matamata"),
  f("Waitomo Caves"),
  // ── Eastern Europe / Russia
  f("Red Square", "Moscow"), f("St. Basil's Cathedral", "Moscow"), f("Hermitage Museum", "Saint Petersburg"),
  f("Kremlin", "Moscow"), f("Auschwitz-Birkenau"), f("Wawel Castle", "Kraków"),
  f("Dubrovnik City Walls", "Dubrovnik"), f("Plitvice Lakes"), f("Diocletian's Palace", "Split"),
];

const FAMOUS_INDEX = WORLD_FAMOUS.map((e) => ({
  name: normPlace(e.name),
  city: e.city ? normPlace(e.city) : null,
}));

/**
 * Fuzzy world-famous match. Exact normalized name always qualifies; a
 * substring match (either direction, min 6 chars on the shorter side) needs
 * the city guard so replicas and same-named businesses don't inherit the
 * verdict.
 */
export function isWorldFamous(name: string, city?: string | null): boolean {
  const n = normPlace(name);
  if (n.length < 3) return false;
  const c = city ? normPlace(city) : "";
  for (const e of FAMOUS_INDEX) {
    if (e.name === n) return true;
    if (!e.city || !c || e.city !== c) continue;
    if (e.name.length >= 6 && n.includes(e.name)) return true;
    if (n.length >= 6 && e.name.includes(n)) return true;
  }
  return false;
}

/** Tags that mark an iconic category when paired with a top rating. */
const ICONIC_TAGS = new Set([
  "iconic", "landmark", "temple", "shrine", "castle", "palace", "cathedral",
  "church", "mosque", "museum", "tower", "arch", "ruins", "monument", "buddha",
  "viewpoint",
]);

/** Name cues for "generic stop you can drop when the day is tight". */
const SKIP_NAME_RE =
  /\b(statue|memorial|artwork|sculpture|playground|plaque|mural|bust|fountain|convenience|rest stop|viewing platform)\b/i;
/** "Riverside Park"-style generic green space: name ends in Park/Playground. */
const GENERIC_PARK_RE = /\b(park|playground|pocket park|dog park)$/i;
/**
 * Tags that give a park substance (deer, hikes, gardens, views). An OSM park
 * import gets nothing but the generic 'nature' tag - those are the skippable
 * ones.
 */
const PARK_SUBSTANCE_TAGS = new Set([
  ...["iconic", "landmark", "temple", "shrine", "castle", "palace", "cathedral"],
  ...["museum", "tower", "arch", "ruins", "monument", "buddha", "viewpoint"],
  ...["deer", "hike", "views", "garden", "gardens", "family", "waterfall", "lake"],
]);

/** Below this a place carries no "clearly well-regarded" signal. */
const WELL_REGARDED = 4.4;

export function verdictFor(p: VerdictInput): PlaceVerdict {
  const rating = p.rating ?? null;
  const tags = p.tags ?? [];

  // 1) world-famous table
  if (isWorldFamous(p.name, p.city)) return "must-see";

  // 2) UNESCO / World Heritage cues in name or description
  if (/\b(unesco|world heritage)\b/i.test(`${p.name} ${p.description ?? ""}`)) return "must-see";

  // 3) top-rated iconic category
  if (rating != null && rating >= 4.6 && tags.some((t) => ICONIC_TAGS.has(t))) {
    return "must-see";
  }

  // 4) generic stops with no quality signal - unrated, or below
  // "clearly well-regarded" (the OSM import default 4.3 is not a signal).
  if (rating == null || rating < WELL_REGARDED) {
    if (SKIP_NAME_RE.test(p.name)) return "skip-if-tight";
    if (GENERIC_PARK_RE.test(p.name) && !tags.some((t) => PARK_SUBSTANCE_TAGS.has(t))) {
      return "skip-if-tight";
    }
    if ((p.category ?? "") === "shopping") return "skip-if-tight";
  }

  return "worth-it";
}
