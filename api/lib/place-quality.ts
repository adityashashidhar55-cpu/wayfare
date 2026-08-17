/**
 * Place-name quality + "famous in {city}" scoring (mission r11-quality).
 *
 * Two exports power two features:
 *
 *  1. isGenericName(name) - OSM imports contain placeholder-named places
 *     ("Park", "Central Market", "Sightseeing", "Temple", "CHURCH",
 *     "view point") that look broken on suggestion surfaces. The heuristic
 *     is additive/non-destructive: callers hide such rows from feeds and
 *     group listings, the DB rows stay (dedupe stability, future cleanups).
 *
 *     Rules, in order:
 *       a. whitelist (~40 famous exceptions - "Central Park", "Park Güell",
 *          "Grand Bazaar", …) → keep
 *       b. exact full-name denylist hit (~80 entries across languages:
 *          park/market/temple/…, plus multiword placeholders like
 *          "city center", "view point", "central market") → hide
 *       c. all-significant-words-generic rule: names of ≤2 significant
 *          words where every word is a generic vocabulary word
 *          ("Central Market" = central+market, "City Park", "Public
 *          Garden") → hide. A proper-name signal word ("Meenakshi",
 *          "Güell", "Bondi") saves the name.
 *     Diacritics, case and punctuation are normalized first, so ALL-CAPS
 *     artifacts ("CENTRAL MARKET") land in the same buckets. Landmark
 *     nouns (tower, palace, fort, bridge…) are deliberately NOT generic
 *     words, so "Tower Bridge", "City Palace" survive.
 *
 *  2. matchWorldFamous / fameScoreFor / blurbFor - the "Famous in {city}"
 *     ranking: rating weight × category iconicity × curated world-famous
 *     boost (~270-entry list matched by fuzzy name+city) × own-photo bonus.
 *     Blurbs are blog-style one-liners templated from category+tags+city.
 */

// ─── normalization ──────────────────────────────────────────────────────────

/**
 * Loose, multilingual name key: NFKD-strip diacritics and compatibility
 * ligatures (œ→oe, ﬁ→fi), lowercase, drop apostrophes, collapse every
 * non-letter/number run to one space.
 * "Café  Central-Market!" → "cafe central market". CJK letters survive.
 */
export function normalizeNameKey(name: string): string {
  return name
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    // ligatures/special letters with no Unicode decomposition (œ, æ, ß…)
    .replace(/œ/g, "oe")
    .replace(/æ/g, "ae")
    .replace(/ß/g, "ss")
    .replace(/ø/g, "o")
    .replace(/ł/g, "l")
    .replace(/[đð]/g, "d")
    .replace(/þ/g, "th")
    .replace(/[''ʼ`]/g, "")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .replace(/\s+/g, " ");
}

/** Same but with spaces removed - catches "Machupicchu"-style compactions. */
function compactKey(key: string): string {
  return key.replace(/ /g, "");
}

// ─── generic-name vocabulary ────────────────────────────────────────────────

/**
 * Generic vocabulary words (multilingual). A name whose significant words
 * ALL come from this set is a placeholder ("Central Market", "City Park").
 * Deliberately excludes landmark nouns (tower, palace, fort, castle, gate,
 * bridge, memorial, fountain, statue) - "Tower Bridge" and "City Palace"
 * are real names; single-word "Tower"/"Palace" rows are caught by the
 * full-name denylist below instead.
 */
const GENERIC_WORDS = new Set([
  // english
  "park", "market", "central", "center", "centre", "city", "town", "square",
  "plaza", "garden", "gardens", "beach", "temple", "church", "mosque",
  "museum", "zoo", "stadium", "ground", "grounds", "parking", "playground",
  "viewpoint", "view", "point", "sightseeing", "sight", "seeing", "old",
  "new", "main", "public", "municipal", "national", "common", "bazaar",
  "souk", "souq", "north", "south", "east", "west", "upper", "lower",
  "grand",
  // romance languages
  "parque", "parc", "parco", "mercado", "mercat", "marche", "ville",
  "ciudad", "piazza", "praca", "jardin", "jardim", "giardino", "playa",
  "plage", "praia", "templo", "iglesia", "igreja", "eglise", "chiesa",
  "mezquita", "mesquita", "mosquee", "museo", "musee", "museu", "estadio",
  // germanic / nordic
  "markt", "platz", "garten", "tempel", "kirche", "moschee", "strand",
  "stade", "staden", "torget", "torg",
  // viewpoint synonyms
  "mirador", "miradouro", "aussichtspunkt", "uitzichtpunt",
]);

/**
 * Exact full-name denylist (normalized). Includes every single generic
 * word above plus the multiword placeholder names OSM is famous for.
 * Anything whitelisted below is removed at build time - whitelist wins.
 */
const GENERIC_FULL_NAMES = new Set<string>([
  ...GENERIC_WORDS,
  // multiword english placeholders
  "central market", "central plaza", "central square", "central garden",
  "central gardens", "city center", "city centre", "town center",
  "town centre", "town square", "main square", "main plaza", "main street",
  "high street", "downtown", "old town", "old city", "city park",
  "public park", "public garden", "public gardens", "national park",
  "memorial park", "amusement park", "theme park", "water park",
  "skate park", "dog park",
  "view point", "view-point", "scenic viewpoint", "scenic view",
  "observation point", "observation deck", "lookout", "scenic lookout",
  "photo point", "photo spot", "selfie point",
  "sight seeing", "sight-seeing", "tourist attraction", "tourist spot",
  "attraction", "landmark",
  "parking lot", "car park", "parking garage", "park and ride",
  "clock tower", "war memorial", "community center", "community centre",
  "cultural center", "cultural centre", "convention center",
  "exhibition center", "sports complex", "sports ground", "cricket ground",
  "football stadium", "botanical garden", "botanic garden",
  "botanical gardens", "botanic gardens", "night market", "food market",
  "fish market", "flower market", "central bazaar", "street market",
  "village", "station", "mall", "shopping", "shopping center",
  "shopping centre", "shopping mall", "tower", "palace", "fort", "castle",
  "gate", "monument", "statue", "fountain", "bridge", "memorial",
  "hindu temple", "buddhist temple", "jain temple", "shinto shrine",
  "catholic church", "orthodox church", "shrine", "cathedral", "chapel",
  "monastery", "pagoda", "synagogue", "gurudwara", "gurdwara",
  "old mosque", "grand mosque", "big mosque", "small mosque",
  "sandy beach", "public beach", "city beach",
]);

/**
 * Famous exceptions that must NOT be filtered even though every word is
 * generic ("Central Park") or the full name sits on the denylist
 * ("Grand Bazaar"). ~40 entries, checked before the denylist.
 * Name-only (no city) per spec - "Central Park" stays everywhere.
 */
const KEEP_NAMES = new Set<string>(
  [
    "central park", "park guell", "parc guell", "hyde park", "millennium park",
    "golden gate park", "griffith park", "regents park", "regent's park",
    "kings park", "stanley park", "vondelpark", "retiro park",
    "parque del retiro", "el retiro", "phoenix park", "ibirapuera park",
    "chapultepec park", "lumpini park", "lumphini park", "ueno park",
    "yoyogi park", "balboa park", "grant park", "olympic park", "gorky park",
    "boston common", "mercado central", "grand bazaar", "south beach",
    "red square", "grand central", "grand central terminal", "grand place",
    "plaza mayor", "dam square", "times square", "union square",
    "trafalgar square", "covent garden", "borough market",
    "queen victoria market", "bondi beach", "copacabana",
  ].map(normalizeNameKey),
);
for (const keep of KEEP_NAMES) GENERIC_FULL_NAMES.delete(keep);

// ─── parking / rest-area rejection (r15-places) ─────────────────────────────

/**
 * Parking-like names across the languages our corpus covers (Japanese
 * 駐車場/パーキング, English, German Parkplatz, Italian parcheggio, Spanish
 * estacionamiento/aparcamiento, French stationnement). Parking lots, rest
 * areas and service plazas are never places to visit - importers skip them
 * and suggestion surfaces filter them out (r14 cleaned the DB rows; this is
 * the classifier-side guard).
 */
export const PARKING_NAME_RE =
  /駐車場|パーキング|parking|parkplatz|parcheggio|estacionamiento|aparcamiento|stationnement|rest[\s-]?area|service[\s-]?area|highway[\s-]?oasis/i;

/** True when a place name reads as a parking lot / highway rest area. */
export function isParkingLikeName(name: string | null | undefined): boolean {
  return !!name && PARKING_NAME_RE.test(name);
}

/** Function words that carry no proper-name signal ("of", "the", …). */
const STOPWORDS = new Set([
  "of", "the", "a", "an", "de", "del", "la", "le", "les", "di", "da", "du",
  "des", "el", "al", "en", "et", "y", "e", "o", "au", "aux", "von", "van",
  "der", "den", "het", "il", "lo", "und", "do", "das", "dos", "na", "no",
]);

/**
 * True when a place name looks like an OSM placeholder rather than a real
 * proper name. Non-destructive: callers hide such rows from suggestion
 * surfaces; rows are never deleted.
 */
export function isGenericName(name: string): boolean {
  const key = normalizeNameKey(name);
  if (!key) return true;
  if (KEEP_NAMES.has(key)) return false;
  if (GENERIC_FULL_NAMES.has(key)) return true;
  const words = key.split(" ").filter((w) => !STOPWORDS.has(w) && !/^\p{N}+$/u.test(w));
  // All-significant-words-generic rule, capped at 2 significant words so
  // longer descriptive names ("Temple of the Emerald Buddha") never match.
  if (words.length > 0 && words.length <= 2 && words.every((w) => GENERIC_WORDS.has(w))) {
    return true;
  }
  return false;
}

// ─── curated world-famous list (~270 entries, fuzzy name+city match) ───────

export interface FamousEntry {
  /** canonical display name */
  n: string;
  /** city the entry is scoped to (prevents cross-city name collisions) */
  c: string;
  /** aliases the corpus might use instead of the canonical name */
  aka?: string[];
}

/* Keep entries alphabetized-ish by region for maintenance. Names match
 * corpus/OSM naming; `aka` covers common alternates. */
export const WORLD_FAMOUS: FamousEntry[] = [
  // ── Europe ────────────────────────────────────────────────────────────
  { n: "Eiffel Tower", c: "Paris", aka: ["Tour Eiffel", "La Tour Eiffel"] },
  { n: "Louvre Museum", c: "Paris", aka: ["Louvre", "Musée du Louvre"] },
  { n: "Notre-Dame Cathedral", c: "Paris", aka: ["Notre-Dame", "Notre Dame de Paris", "Cathédrale Notre-Dame de Paris"] },
  { n: "Arc de Triomphe", c: "Paris" },
  { n: "Sacré-Cœur Basilica", c: "Paris", aka: ["Sacré-Cœur", "Sacre-Coeur", "Basilique du Sacré-Cœur"] },
  { n: "Musée d'Orsay", c: "Paris", aka: ["Musee d'Orsay", "Orsay Museum"] },
  { n: "Sainte-Chapelle", c: "Paris", aka: ["La Sainte-Chapelle"] },
  { n: "Palace of Versailles", c: "Versailles", aka: ["Château de Versailles", "Versailles"] },
  { n: "Colosseum", c: "Rome", aka: ["Colosseo", "Flavian Amphitheatre"] },
  { n: "Vatican Museums", c: "Rome", aka: ["Musei Vaticani", "Vatican Museum"] },
  { n: "St. Peter's Basilica", c: "Rome", aka: ["Saint Peter's Basilica", "Basilica di San Pietro"] },
  { n: "Pantheon", c: "Rome", aka: ["Pantheon Rome"] },
  { n: "Trevi Fountain", c: "Rome", aka: ["Fontana di Trevi"] },
  { n: "Roman Forum", c: "Rome", aka: ["Foro Romano"] },
  { n: "Spanish Steps", c: "Rome", aka: ["Scalinata di Trinità dei Monti"] },
  { n: "Sagrada Família", c: "Barcelona", aka: ["Sagrada Familia", "La Sagrada Familia", "Basílica de la Sagrada Família"] },
  { n: "Park Güell", c: "Barcelona", aka: ["Park Guell", "Parc Güell"] },
  { n: "Casa Batlló", c: "Barcelona", aka: ["Casa Batllo"] },
  { n: "Casa Milà", c: "Barcelona", aka: ["La Pedrera", "Casa Mila"] },
  { n: "Alhambra", c: "Granada", aka: ["Alhambra Palace", "La Alhambra"] },
  { n: "Mezquita de Córdoba", c: "Córdoba", aka: ["Mezquita", "Mosque-Cathedral of Córdoba", "Great Mosque of Córdoba", "Mezquita-Catedral"] },
  { n: "Prado Museum", c: "Madrid", aka: ["Museo del Prado", "Museo Nacional del Prado"] },
  { n: "Retiro Park", c: "Madrid", aka: ["Parque del Retiro", "El Retiro"] },
  { n: "Plaza Mayor", c: "Madrid" },
  { n: "Royal Palace of Madrid", c: "Madrid", aka: ["Palacio Real", "Palacio Real de Madrid"] },
  { n: "Seville Cathedral", c: "Seville", aka: ["Catedral de Sevilla", "Sevilla Cathedral"] },
  { n: "Alcázar of Seville", c: "Seville", aka: ["Real Alcázar", "Alcazar", "Real Alcázar de Sevilla"] },
  { n: "Big Ben", c: "London", aka: ["Elizabeth Tower"] },
  { n: "Tower Bridge", c: "London" },
  { n: "Tower of London", c: "London" },
  { n: "Buckingham Palace", c: "London" },
  { n: "British Museum", c: "London", aka: ["The British Museum"] },
  { n: "Westminster Abbey", c: "London" },
  { n: "London Eye", c: "London" },
  { n: "St Paul's Cathedral", c: "London", aka: ["St. Paul's Cathedral", "Saint Paul's Cathedral"] },
  { n: "Hyde Park", c: "London" },
  { n: "Edinburgh Castle", c: "Edinburgh" },
  { n: "Brandenburg Gate", c: "Berlin", aka: ["Brandenburger Tor"] },
  { n: "Reichstag Building", c: "Berlin", aka: ["Reichstag"] },
  { n: "Neuschwanstein Castle", c: "Schwangau", aka: ["Schloss Neuschwanstein"] },
  { n: "Cologne Cathedral", c: "Cologne", aka: ["Kölner Dom", "Kolner Dom"] },
  { n: "Anne Frank House", c: "Amsterdam", aka: ["Anne Frank Huis"] },
  { n: "Rijksmuseum", c: "Amsterdam" },
  { n: "Van Gogh Museum", c: "Amsterdam" },
  { n: "Charles Bridge", c: "Prague", aka: ["Karlův most", "Karluv most"] },
  { n: "Prague Castle", c: "Prague", aka: ["Pražský hrad", "Prazsky hrad"] },
  { n: "Schönbrunn Palace", c: "Vienna", aka: ["Schonbrunn Palace", "Schloss Schönbrunn"] },
  { n: "St. Stephen's Cathedral", c: "Vienna", aka: ["Stephansdom", "St Stephen's Cathedral"] },
  { n: "Belvedere Palace", c: "Vienna", aka: ["Belvedere", "Schloss Belvedere"] },
  { n: "Acropolis of Athens", c: "Athens", aka: ["Acropolis", "Parthenon", "Akropolis"] },
  { n: "Meteora", c: "Kalambaka", aka: ["Meteora Monasteries"] },
  { n: "Duomo di Milano", c: "Milan", aka: ["Milan Cathedral", "Duomo", "Milan Duomo"] },
  { n: "Leaning Tower of Pisa", c: "Pisa", aka: ["Torre di Pisa", "Torre Pendente di Pisa"] },
  { n: "St. Mark's Basilica", c: "Venice", aka: ["Basilica di San Marco", "Saint Mark's Basilica", "St Mark's Basilica"] },
  { n: "St. Mark's Square", c: "Venice", aka: ["Piazza San Marco", "St Mark's Square"] },
  { n: "Rialto Bridge", c: "Venice", aka: ["Ponte di Rialto"] },
  { n: "Grand Canal", c: "Venice", aka: ["Canal Grande"] },
  { n: "Doge's Palace", c: "Venice", aka: ["Palazzo Ducale"] },
  { n: "Florence Cathedral", c: "Florence", aka: ["Duomo di Firenze", "Santa Maria del Fiore", "Il Duomo"] },
  { n: "Uffizi Gallery", c: "Florence", aka: ["Uffizi", "Galleria degli Uffizi"] },
  { n: "Ponte Vecchio", c: "Florence" },
  { n: "Pompeii", c: "Pompeii", aka: ["Pompeii Archaeological Park", "Scavi di Pompei"] },
  { n: "Belém Tower", c: "Lisbon", aka: ["Torre de Belém", "Belem Tower"] },
  { n: "Jerónimos Monastery", c: "Lisbon", aka: ["Jeronimos Monastery", "Mosteiro dos Jerónimos"] },
  { n: "Pena Palace", c: "Sintra", aka: ["Palácio da Pena", "Palacio da Pena"] },
  { n: "Dom Luís I Bridge", c: "Porto", aka: ["Ponte Dom Luís I", "Dom Luis I Bridge", "Ponte Luís I"] },
  { n: "Nyhavn", c: "Copenhagen" },
  { n: "The Little Mermaid", c: "Copenhagen", aka: ["Den Lille Havfrue", "Little Mermaid Statue", "Little Mermaid"] },
  { n: "Tivoli Gardens", c: "Copenhagen", aka: ["Tivoli"] },
  { n: "Vasa Museum", c: "Stockholm", aka: ["Vasamuseet"] },
  { n: "Hallgrímskirkja", c: "Reykjavik", aka: ["Hallgrimskirkja"] },
  { n: "Blue Lagoon", c: "Grindavik", aka: ["Blue Lagoon Iceland"] },
  { n: "Hungarian Parliament Building", c: "Budapest", aka: ["Budapest Parliament", "Országház"] },
  { n: "Fisherman's Bastion", c: "Budapest", aka: ["Halászbástya", "Halaszbastya"] },
  { n: "Buda Castle", c: "Budapest", aka: ["Budapest Castle"] },
  { n: "Széchenyi Thermal Bath", c: "Budapest", aka: ["Szechenyi Baths", "Széchenyi Baths"] },
  { n: "Wawel Castle", c: "Kraków", aka: ["Wawel Royal Castle", "Wawel"] },
  { n: "Red Square", c: "Moscow" },
  { n: "Saint Basil's Cathedral", c: "Moscow", aka: ["St. Basil's Cathedral", "St Basil's Cathedral"] },
  { n: "Moscow Kremlin", c: "Moscow", aka: ["Kremlin", "The Kremlin"] },
  { n: "Hermitage Museum", c: "Saint Petersburg", aka: ["State Hermitage Museum", "Winter Palace", "The Hermitage"] },
  { n: "Hagia Sophia", c: "Istanbul", aka: ["Ayasofya", "Hagia Sophia Grand Mosque", "Aya Sofya"] },
  { n: "Blue Mosque", c: "Istanbul", aka: ["Sultan Ahmed Mosque", "Sultanahmet Camii"] },
  { n: "Topkapi Palace", c: "Istanbul", aka: ["Topkapı Palace", "Topkapı Sarayı"] },
  { n: "Grand Bazaar", c: "Istanbul", aka: ["Kapalıçarşı", "Kapalicarsi"] },
  { n: "Basilica Cistern", c: "Istanbul", aka: ["Yerebatan Sarnıcı", "Yerebatan Sarnici"] },
  { n: "Galata Tower", c: "Istanbul", aka: ["Galata Kulesi"] },
  { n: "Guinness Storehouse", c: "Dublin" },
  { n: "Matterhorn", c: "Zermatt" },
  { n: "Chillon Castle", c: "Montreux", aka: ["Château de Chillon"] },
  { n: "Lake Bled", c: "Bled", aka: ["Bled Lake"] },
  { n: "Plitvice Lakes", c: "Plitvice", aka: ["Plitvice Lakes National Park", "Plitvička Jezera", "Plitvicka Jezera"] },
  { n: "Dubrovnik Old Town", c: "Dubrovnik", aka: ["Walls of Dubrovnik", "Dubrovnik City Walls"] },
  { n: "Bran Castle", c: "Bran", aka: ["Dracula's Castle"] },
  { n: "Keukenhof", c: "Lisse" },
  // ── Middle East & Africa ──────────────────────────────────────────────
  { n: "Burj Khalifa", c: "Dubai" },
  { n: "Dubai Mall", c: "Dubai", aka: ["The Dubai Mall"] },
  { n: "Palm Jumeirah", c: "Dubai" },
  { n: "Burj Al Arab", c: "Dubai" },
  { n: "Dubai Fountain", c: "Dubai", aka: ["The Dubai Fountain"] },
  { n: "Sheikh Zayed Grand Mosque", c: "Abu Dhabi", aka: ["Sheikh Zayed Mosque", "Grand Mosque Abu Dhabi"] },
  { n: "Louvre Abu Dhabi", c: "Abu Dhabi" },
  { n: "Petra", c: "Wadi Musa", aka: ["Al-Khazneh", "The Treasury", "Petra Archaeological Park"] },
  { n: "Wadi Rum", c: "Wadi Rum", aka: ["Wadi Rum Protected Area"] },
  { n: "Western Wall", c: "Jerusalem", aka: ["Wailing Wall", "Kotel"] },
  { n: "Dome of the Rock", c: "Jerusalem" },
  { n: "Church of the Holy Sepulchre", c: "Jerusalem", aka: ["Holy Sepulchre"] },
  { n: "Masada", c: "Masada" },
  { n: "Museum of Islamic Art", c: "Doha" },
  { n: "Souq Waqif", c: "Doha" },
  { n: "Sultan Qaboos Grand Mosque", c: "Muscat" },
  { n: "Pyramids of Giza", c: "Giza", aka: ["Great Pyramid of Giza", "Giza Pyramids", "The Pyramids"] },
  { n: "Great Sphinx of Giza", c: "Giza", aka: ["Sphinx", "The Sphinx", "Great Sphinx"] },
  { n: "Egyptian Museum", c: "Cairo", aka: ["The Egyptian Museum"] },
  { n: "Khan el-Khalili", c: "Cairo", aka: ["Khan el Khalili"] },
  { n: "Karnak", c: "Luxor", aka: ["Karnak Temple", "Karnak Temple Complex"] },
  { n: "Valley of the Kings", c: "Luxor" },
  { n: "Luxor Temple", c: "Luxor" },
  { n: "Abu Simbel", c: "Aswan", aka: ["Abu Simbel Temples"] },
  { n: "Jemaa el-Fnaa", c: "Marrakech", aka: ["Jemaa el-Fna", "Djemaa el-Fna", "Jamaa el Fna"] },
  { n: "Jardin Majorelle", c: "Marrakech", aka: ["Majorelle Garden", "Majorelle Gardens"] },
  { n: "Bahia Palace", c: "Marrakech" },
  { n: "Koutoubia Mosque", c: "Marrakech", aka: ["Koutoubia"] },
  { n: "Hassan II Mosque", c: "Casablanca" },
  { n: "Fes el Bali", c: "Fez", aka: ["Fes Medina", "Medina of Fez", "Fes el-Bali"] },
  { n: "Chefchaouen", c: "Chefchaouen", aka: ["Chefchaouen Medina", "Blue City"] },
  { n: "Table Mountain", c: "Cape Town", aka: ["Table Mountain National Park"] },
  { n: "V&A Waterfront", c: "Cape Town", aka: ["Victoria & Alfred Waterfront", "Victoria and Alfred Waterfront"] },
  { n: "Robben Island", c: "Cape Town" },
  { n: "Boulders Beach", c: "Cape Town", aka: ["Boulders Penguin Colony"] },
  { n: "Cape of Good Hope", c: "Cape Town" },
  { n: "Stone Town", c: "Zanzibar", aka: ["Zanzibar Stone Town"] },
  { n: "Victoria Falls", c: "Victoria Falls", aka: ["Mosi-oa-Tunya"] },
  { n: "Avenue of the Baobabs", c: "Morondava", aka: ["Baobab Avenue"] },
  // ── Indian subcontinent ───────────────────────────────────────────────
  { n: "Taj Mahal", c: "Agra" },
  { n: "Agra Fort", c: "Agra", aka: ["Red Fort of Agra"] },
  { n: "Fatehpur Sikri", c: "Fatehpur Sikri" },
  { n: "India Gate", c: "Delhi", aka: ["All India War Memorial"] },
  { n: "Qutub Minar", c: "Delhi", aka: ["Qutb Minar", "Qutab Minar"] },
  { n: "Red Fort", c: "Delhi", aka: ["Lal Qila", "Lal Qila (Red Fort)"] },
  { n: "Humayun's Tomb", c: "Delhi", aka: ["Humayun Tomb"] },
  { n: "Lotus Temple", c: "Delhi", aka: ["Bahai House of Worship", "Bahá'í House of Worship"] },
  { n: "Jama Masjid", c: "Delhi" },
  { n: "Akshardham", c: "Delhi", aka: ["Swaminarayan Akshardham", "Akshardham Temple"] },
  { n: "Hawa Mahal", c: "Jaipur", aka: ["Palace of Winds"] },
  { n: "Amber Fort", c: "Jaipur", aka: ["Amer Fort", "Amber Palace", "Amer Palace", "Amer Fort (Amber Fort)"] },
  { n: "City Palace", c: "Jaipur", aka: ["City Palace Jaipur"] },
  { n: "Jantar Mantar", c: "Jaipur", aka: ["Jantar Mantar Jaipur"] },
  { n: "Nahargarh Fort", c: "Jaipur" },
  { n: "Jal Mahal", c: "Jaipur", aka: ["Water Palace"] },
  { n: "Jaigarh Fort", c: "Jaipur", aka: ["Jaighar Fort"] },
  { n: "City Palace", c: "Udaipur", aka: ["City Palace Udaipur"] },
  { n: "Lake Pichola", c: "Udaipur" },
  { n: "Jag Mandir", c: "Udaipur" },
  { n: "Mehrangarh Fort", c: "Jodhpur", aka: ["Mehrangarh"] },
  { n: "Umaid Bhawan Palace", c: "Jodhpur" },
  { n: "Jaisalmer Fort", c: "Jaisalmer", aka: ["Sonar Quila", "Golden Fort"] },
  { n: "Gateway of India", c: "Mumbai" },
  { n: "Marine Drive", c: "Mumbai", aka: ["Queen's Necklace", "Netaji Subhash Chandra Bose Road"] },
  { n: "Chhatrapati Shivaji Terminus", c: "Mumbai", aka: ["Victoria Terminus", "CST", "Chhatrapati Shivaji Maharaj Terminus"] },
  { n: "Elephanta Caves", c: "Mumbai" },
  { n: "Bandra-Worli Sea Link", c: "Mumbai", aka: ["Bandra Worli Sea Link"] },
  { n: "Golden Temple", c: "Amritsar", aka: ["Harmandir Sahib", "Sri Harmandir Sahib", "Darbar Sahib"] },
  { n: "Jallianwala Bagh", c: "Amritsar" },
  { n: "Wagah Border", c: "Amritsar", aka: ["Wagah", "Attari-Wagah Border"] },
  { n: "Mysore Palace", c: "Mysuru", aka: ["Mysuru Palace", "Amba Vilas Palace"] },
  { n: "Virupaksha Temple", c: "Hampi" },
  { n: "Vittala Temple", c: "Hampi", aka: ["Vitthala Temple", "Vijaya Vittala Temple"] },
  { n: "Charminar", c: "Hyderabad" },
  { n: "Golconda Fort", c: "Hyderabad", aka: ["Golkonda", "Golkonda Fort"] },
  { n: "Meenakshi Temple", c: "Madurai", aka: ["Meenakshi Amman Temple", "Meenakshi Sundareswarar Temple", "Arulmigu Meenakshi Sundareshwarar Temple"] },
  { n: "Brihadeeswarar Temple", c: "Thanjavur", aka: ["Brihadisvara Temple", "Big Temple", "Rajarajeswaram", "Peruvudaiyar Kovil"] },
  { n: "Ramanathaswamy Temple", c: "Rameswaram", aka: ["Rameshwaram Temple"] },
  { n: "Kashi Vishwanath Temple", c: "Varanasi", aka: ["Kashi Vishwanath", "Kashi Vishwanath Mandir"] },
  { n: "Dashashwamedh Ghat", c: "Varanasi" },
  { n: "Sarnath", c: "Varanasi", aka: ["Sarnath Stupa", "Dhamek Stupa"] },
  { n: "Mahabodhi Temple", c: "Bodh Gaya", aka: ["Mahabodhi Mahavihara"] },
  { n: "Khajuraho", c: "Khajuraho", aka: ["Khajuraho Temples", "Khajuraho Group of Monuments", "Western Group of Temples"] },
  { n: "Ajanta Caves", c: "Aurangabad" },
  { n: "Ellora Caves", c: "Aurangabad", aka: ["Kailasa Temple", "Kailasanatha Temple"] },
  { n: "Konark Sun Temple", c: "Konark", aka: ["Sun Temple Konark", "Konark Temple", "Sun Temple"] },
  { n: "Jagannath Temple", c: "Puri", aka: ["Shree Jagannatha Temple", "Jagannath Puri"] },
  { n: "Basilica of Bom Jesus", c: "Goa", aka: ["Bom Jesus Basilica"] },
  { n: "Palolem Beach", c: "Goa" },
  { n: "Shore Temple", c: "Mahabalipuram", aka: ["Mamallapuram Shore Temple"] },
  { n: "Victoria Memorial", c: "Kolkata", aka: ["Victoria Memorial Hall"] },
  { n: "Howrah Bridge", c: "Kolkata", aka: ["Rabindra Setu"] },
  { n: "Dakshineswar Kali Temple", c: "Kolkata", aka: ["Dakshineswar", "Dakshineshwar Temple"] },
  { n: "Dal Lake", c: "Srinagar" },
  { n: "Pangong Lake", c: "Leh", aka: ["Pangong Tso"] },
  { n: "Thiksey Monastery", c: "Leh", aka: ["Thikse Monastery", "Thiksey Gompa"] },
  { n: "Shanti Stupa", c: "Leh" },
  { n: "Tiger's Nest", c: "Paro", aka: ["Paro Taktsang", "Taktsang Monastery", "Tigers Nest"] },
  { n: "Venkateswara Temple", c: "Tirupati", aka: ["Tirumala Temple", "Tirupati Balaji", "Tirumala Venkateswara Temple"] },
  { n: "Vivekananda Rock Memorial", c: "Kanyakumari", aka: ["Vivekananda Rock"] },
  { n: "Statue of Unity", c: "Kevadia" },
  { n: "Cellular Jail", c: "Port Blair" },
  { n: "Promenade Beach", c: "Puducherry", aka: ["Rock Beach"] },
  { n: "Auroville", c: "Puducherry", aka: ["Matrimandir"] },
  { n: "Alleppey Backwaters", c: "Alappuzha", aka: ["Alleppey", "Punnamada Lake"] },
  { n: "Galle Face Green", c: "Colombo" },
  { n: "Sigiriya", c: "Sigiriya", aka: ["Lion Rock", "Sigiriya Rock Fortress"] },
  { n: "Temple of the Tooth", c: "Kandy", aka: ["Sri Dalada Maligawa", "Temple of the Sacred Tooth Relic"] },
  { n: "Galle Fort", c: "Galle", aka: ["Dutch Fort Galle"] },
  { n: "Nine Arch Bridge", c: "Ella" },
  { n: "Dambulla Cave Temple", c: "Dambulla", aka: ["Golden Temple of Dambulla", "Dambulla Royal Cave Temple"] },
  { n: "Boudhanath", c: "Kathmandu", aka: ["Boudhanath Stupa", "Boudha", "Boudha Stupa"] },
  { n: "Swayambhunath", c: "Kathmandu", aka: ["Monkey Temple", "Swayambhu", "Swayambhunath Stupa"] },
  { n: "Pashupatinath Temple", c: "Kathmandu", aka: ["Pashupatinath"] },
  { n: "Kathmandu Durbar Square", c: "Kathmandu", aka: ["Durbar Square", "Basantapur Durbar Square"] },
  { n: "Phewa Lake", c: "Pokhara" },
  // ── East & Southeast Asia ─────────────────────────────────────────────
  { n: "Fushimi Inari Shrine", c: "Kyoto", aka: ["Fushimi Inari Taisha", "Fushimi Inari-taisha", "Fushimi Inari"] },
  { n: "Kiyomizu-dera", c: "Kyoto", aka: ["Kiyomizu Temple", "Kiyomizudera"] },
  { n: "Kinkaku-ji", c: "Kyoto", aka: ["Golden Pavilion", "Kinkakuji", "Kinkaku-ji (Golden Pavilion)"] },
  { n: "Arashiyama Bamboo Grove", c: "Kyoto", aka: ["Arashiyama Bamboo Forest", "Sagano Bamboo Forest", "Bamboo Grove"] },
  { n: "Nijo Castle", c: "Kyoto", aka: ["Nijō Castle", "Nijo-jo"] },
  { n: "Gion", c: "Kyoto", aka: ["Hanamikoji Street", "Gion (Hanamikoji Street)"] },
  { n: "Byodo-in", c: "Kyoto", aka: ["Byodoin", "Byodo-in Temple", "Byōdō-in"] },
  { n: "Ryoan-ji", c: "Kyoto", aka: ["Ryoanji"] },
  { n: "Philosopher's Path", c: "Kyoto", aka: ["Tetsugaku-no-michi", "Philosophers Path"] },
  { n: "Senso-ji", c: "Tokyo", aka: ["Sensoji", "Asakusa Kannon Temple", "Asakusa Temple"] },
  { n: "Meiji Shrine", c: "Tokyo", aka: ["Meiji Jingu", "Meiji-jingu"] },
  { n: "Shibuya Crossing", c: "Tokyo", aka: ["Shibuya Scramble", "Shibuya Scramble Crossing"] },
  { n: "Tokyo Tower", c: "Tokyo" },
  { n: "Tokyo Skytree", c: "Tokyo" },
  { n: "Imperial Palace", c: "Tokyo", aka: ["Tokyo Imperial Palace"] },
  { n: "Tsukiji Outer Market", c: "Tokyo", aka: ["Tsukiji Market"] },
  { n: "Osaka Castle", c: "Osaka" },
  { n: "Dotonbori", c: "Osaka", aka: ["Dotonbori Street"] },
  { n: "Todai-ji", c: "Nara", aka: ["Todaiji", "Great Buddha Hall", "Tōdai-ji"] },
  { n: "Nara Park", c: "Nara" },
  { n: "Itsukushima Shrine", c: "Miyajima", aka: ["Itsukushima-jinja", "Miyajima Shrine"] },
  { n: "Hiroshima Peace Memorial", c: "Hiroshima", aka: ["Atomic Bomb Dome", "A-Bomb Dome", "Genbaku Dome"] },
  { n: "Mount Fuji", c: "Fujiyoshida", aka: ["Mt Fuji", "Mt. Fuji", "Fuji-san"] },
  { n: "Nikko Toshogu", c: "Nikko", aka: ["Toshogu Shrine", "Nikkō Tōshō-gū"] },
  { n: "Great Wall of China", c: "Beijing", aka: ["Mutianyu Great Wall", "Badaling Great Wall", "Badaling", "Mutianyu", "The Great Wall"] },
  { n: "Forbidden City", c: "Beijing", aka: ["Palace Museum", "The Forbidden City"] },
  { n: "Temple of Heaven", c: "Beijing", aka: ["Tiantan"] },
  { n: "Summer Palace", c: "Beijing", aka: ["Yiheyuan"] },
  { n: "Tiananmen Square", c: "Beijing", aka: ["Tian'anmen Square"] },
  { n: "The Bund", c: "Shanghai", aka: ["Waitan", "Bund"] },
  { n: "Oriental Pearl Tower", c: "Shanghai", aka: ["Oriental Pearl TV Tower"] },
  { n: "Yu Garden", c: "Shanghai", aka: ["Yuyuan Garden", "Yu Yuan"] },
  { n: "Terracotta Army", c: "Xi'an", aka: ["Terracotta Warriors", "Museum of Qin Terracotta Warriors", "Terracotta Warriors Museum"] },
  { n: "Giant Panda Breeding Research Base", c: "Chengdu", aka: ["Chengdu Panda Base", "Panda Base"] },
  { n: "Victoria Peak", c: "Hong Kong", aka: ["The Peak", "Victoria Peak (The Peak)"] },
  { n: "Tian Tan Buddha", c: "Hong Kong", aka: ["Big Buddha", "Big Buddha (Tian Tan Buddha)"] },
  { n: "Star Ferry", c: "Hong Kong", aka: ["Star Ferry Pier"] },
  { n: "Taipei 101", c: "Taipei" },
  { n: "National Palace Museum", c: "Taipei" },
  { n: "Gyeongbokgung Palace", c: "Seoul", aka: ["Gyeongbokgung", "Gyeongbok Palace"] },
  { n: "N Seoul Tower", c: "Seoul", aka: ["Namsan Tower", "Seoul Tower"] },
  { n: "Bukchon Hanok Village", c: "Seoul" },
  { n: "Changdeokgung", c: "Seoul", aka: ["Changdeokgung Palace", "Changdeok Palace"] },
  { n: "Grand Palace", c: "Bangkok", aka: ["The Grand Palace"] },
  { n: "Wat Phra Kaew", c: "Bangkok", aka: ["Temple of the Emerald Buddha", "Emerald Buddha Temple"] },
  { n: "Wat Pho", c: "Bangkok", aka: ["Temple of the Reclining Buddha", "Wat Phra Chetuphon"] },
  { n: "Wat Arun", c: "Bangkok", aka: ["Temple of Dawn", "Wat Arun Ratchawararam"] },
  { n: "Chatuchak Weekend Market", c: "Bangkok", aka: ["Chatuchak Market", "JJ Market", "Chatuchak"] },
  { n: "Doi Suthep", c: "Chiang Mai", aka: ["Wat Phra That Doi Suthep", "Wat Doi Suthep"] },
  { n: "Ayutthaya Historical Park", c: "Ayutthaya", aka: ["Ayutthaya"] },
  { n: "Marina Bay Sands", c: "Singapore", aka: ["MBS", "Marina Bay Sands Hotel"] },
  { n: "Gardens by the Bay", c: "Singapore", aka: ["Gardens by the Bay Singapore"] },
  { n: "Merlion", c: "Singapore", aka: ["Merlion Park", "The Merlion"] },
  { n: "Sentosa", c: "Singapore", aka: ["Sentosa Island"] },
  { n: "Singapore Botanic Gardens", c: "Singapore", aka: ["Botanic Gardens"] },
  { n: "Petronas Towers", c: "Kuala Lumpur", aka: ["Petronas Twin Towers", "KLCC", "Petronas Towers (KLCC)"] },
  { n: "Batu Caves", c: "Kuala Lumpur" },
  { n: "Kek Lok Si Temple", c: "Penang", aka: ["Kek Lok Si"] },
  { n: "Angkor Wat", c: "Siem Reap", aka: ["Angkor Wat Temple"] },
  { n: "Bayon Temple", c: "Siem Reap", aka: ["Bayon", "The Bayon"] },
  { n: "Ta Prohm", c: "Siem Reap", aka: ["Tomb Raider Temple", "Ta Prohm Temple"] },
  { n: "Uluwatu Temple", c: "Bali", aka: ["Pura Luhur Uluwatu"] },
  { n: "Tanah Lot", c: "Bali", aka: ["Tanah Lot Temple", "Pura Tanah Lot"] },
  { n: "Tegallalang Rice Terraces", c: "Bali", aka: ["Tegalalang Rice Terrace", "Tegallalang Rice Terrace"] },
  { n: "Sacred Monkey Forest", c: "Bali", aka: ["Ubud Monkey Forest", "Monkey Forest", "Monkey Forest Sanctuary"] },
  { n: "Mount Batur", c: "Bali", aka: ["Gunung Batur"] },
  { n: "Borobudur", c: "Yogyakarta", aka: ["Borobudur Temple"] },
  { n: "Prambanan", c: "Yogyakarta", aka: ["Prambanan Temple", "Candi Prambanan"] },
  { n: "Ha Long Bay", c: "Ha Long", aka: ["Halong Bay", "Vinh Ha Long"] },
  { n: "Hoi An Ancient Town", c: "Hoi An", aka: ["Hoi An Old Town", "Ancient Town"] },
  { n: "Japanese Covered Bridge", c: "Hoi An", aka: ["Chua Cau", "Japanese Bridge", "Chùa Cầu"] },
  { n: "Golden Bridge", c: "Da Nang", aka: ["Golden Hand Bridge", "Cau Vang", "Cầu Vàng"] },
  { n: "Marble Mountains", c: "Da Nang", aka: ["The Marble Mountains"] },
  { n: "Imperial City", c: "Hue", aka: ["Hue Citadel", "The Citadel", "Hue Imperial City"] },
  { n: "Hoan Kiem Lake", c: "Hanoi", aka: ["Sword Lake", "Ho Guom"] },
  { n: "Temple of Literature", c: "Hanoi", aka: ["Van Mieu", "Văn Miếu"] },
  { n: "Ben Thanh Market", c: "Ho Chi Minh City", aka: ["Ben Thanh", "Cho Ben Thanh"] },
  { n: "Cu Chi Tunnels", c: "Ho Chi Minh City", aka: ["Cu Chi Tunnel"] },
  { n: "Notre-Dame Cathedral of Saigon", c: "Ho Chi Minh City", aka: ["Saigon Notre-Dame Cathedral", "Notre-Dame Cathedral Saigon", "Notre Dame Cathedral"] },
  { n: "Kuang Si Falls", c: "Luang Prabang", aka: ["Kuang Si Waterfall", "Kuang Xi Falls"] },
  { n: "Pha That Luang", c: "Vientiane", aka: ["That Luang"] },
  { n: "Intramuros", c: "Manila" },
  { n: "Monas", c: "Jakarta", aka: ["National Monument", "Monumen Nasional"] },
  // ── Americas ──────────────────────────────────────────────────────────
  { n: "Statue of Liberty", c: "New York", aka: ["Lady Liberty"] },
  { n: "Times Square", c: "New York" },
  { n: "Central Park", c: "New York" },
  { n: "Empire State Building", c: "New York" },
  { n: "Brooklyn Bridge", c: "New York" },
  { n: "Metropolitan Museum of Art", c: "New York", aka: ["The Met", "Met Museum", "The Metropolitan Museum of Art"] },
  { n: "High Line", c: "New York", aka: ["The High Line"] },
  { n: "Grand Central Terminal", c: "New York", aka: ["Grand Central Station", "Grand Central"] },
  { n: "9/11 Memorial", c: "New York", aka: ["National September 11 Memorial", "9/11 Memorial & Museum", "September 11 Memorial"] },
  { n: "White House", c: "Washington", aka: ["The White House"] },
  { n: "Lincoln Memorial", c: "Washington" },
  { n: "Washington Monument", c: "Washington" },
  { n: "United States Capitol", c: "Washington", aka: ["US Capitol", "Capitol Building", "The Capitol"] },
  { n: "National Air and Space Museum", c: "Washington", aka: ["Air and Space Museum", "Smithsonian Air and Space Museum"] },
  { n: "Niagara Falls", c: "Niagara Falls" },
  { n: "Millennium Park", c: "Chicago" },
  { n: "Cloud Gate", c: "Chicago", aka: ["The Bean", "Cloud Gate (The Bean)"] },
  { n: "Willis Tower", c: "Chicago", aka: ["Sears Tower"] },
  { n: "Navy Pier", c: "Chicago" },
  { n: "Art Institute of Chicago", c: "Chicago", aka: ["The Art Institute"] },
  { n: "Golden Gate Bridge", c: "San Francisco" },
  { n: "Alcatraz", c: "San Francisco", aka: ["Alcatraz Island"] },
  { n: "Fisherman's Wharf", c: "San Francisco", aka: ["Fishermans Wharf", "Pier 39"] },
  { n: "Golden Gate Park", c: "San Francisco" },
  { n: "Painted Ladies", c: "San Francisco", aka: ["The Painted Ladies"] },
  { n: "Lombard Street", c: "San Francisco" },
  { n: "Hollywood Sign", c: "Los Angeles" },
  { n: "Hollywood Walk of Fame", c: "Los Angeles", aka: ["Walk of Fame"] },
  { n: "Griffith Observatory", c: "Los Angeles" },
  { n: "Santa Monica Pier", c: "Los Angeles", aka: ["Santa Monica Pier (Pacific Park)"] },
  { n: "Getty Center", c: "Los Angeles", aka: ["The Getty", "Getty Museum"] },
  { n: "Las Vegas Strip", c: "Las Vegas", aka: ["The Strip"] },
  { n: "Bellagio Fountains", c: "Las Vegas", aka: ["Fountains of Bellagio", "Bellagio Fountain"] },
  { n: "Grand Canyon", c: "Grand Canyon", aka: ["Grand Canyon National Park", "Grand Canyon South Rim", "Mather Point"] },
  { n: "South Beach", c: "Miami", aka: ["Miami Beach", "SoBe"] },
  { n: "Wynwood Walls", c: "Miami" },
  { n: "French Quarter", c: "New Orleans", aka: ["Vieux Carré", "Bourbon Street"] },
  { n: "Space Needle", c: "Seattle" },
  { n: "Pike Place Market", c: "Seattle", aka: ["Pike Place"] },
  { n: "Balboa Park", c: "San Diego" },
  { n: "Waikiki Beach", c: "Honolulu", aka: ["Waikiki"] },
  { n: "Pearl Harbor", c: "Honolulu", aka: ["Pearl Harbor National Memorial", "USS Arizona Memorial"] },
  { n: "Diamond Head", c: "Honolulu", aka: ["Diamond Head Crater", "Lēʻahi"] },
  { n: "Zócalo", c: "Mexico City", aka: ["Zocalo", "Plaza de la Constitución"] },
  { n: "Chapultepec Castle", c: "Mexico City", aka: ["Castillo de Chapultepec"] },
  { n: "Frida Kahlo Museum", c: "Mexico City", aka: ["Casa Azul", "La Casa Azul"] },
  { n: "Palacio de Bellas Artes", c: "Mexico City", aka: ["Bellas Artes"] },
  { n: "Teotihuacan", c: "Teotihuacan", aka: ["Pyramid of the Sun", "Pirámide del Sol", "Teotihuacán"] },
  { n: "Chichen Itza", c: "Chichen Itza", aka: ["Chichén Itzá", "El Castillo"] },
  { n: "Tulum Ruins", c: "Tulum", aka: ["Tulum Archaeological Zone", "Zona Arqueológica de Tulum", "Tulum"] },
  { n: "Malecón", c: "Havana", aka: ["El Malecón", "Havana Malecon", "Malecon"] },
  { n: "Old Havana", c: "Havana", aka: ["Habana Vieja", "La Habana Vieja"] },
  { n: "Panama Canal", c: "Panama City", aka: ["Miraflores Locks", "Canal de Panamá"] },
  { n: "Casco Viejo", c: "Panama City", aka: ["Casco Antiguo"] },
  { n: "Cartagena Walled City", c: "Cartagena", aka: ["Walled City", "Ciudad Amurallada", "Old Town Cartagena"] },
  { n: "Monserrate", c: "Bogotá", aka: ["Mount Monserrate", "Cerro de Monserrate"] },
  { n: "Comuna 13", c: "Medellín", aka: ["Comuna 13 Graffitour"] },
  { n: "Machu Picchu", c: "Machu Picchu", aka: ["Machupicchu", "Machu Picchu Citadel"] },
  { n: "Plaza de Armas", c: "Cusco", aka: ["Plaza de Armas de Cusco", "Cusco Main Square"] },
  { n: "Salar de Uyuni", c: "Uyuni", aka: ["Uyuni Salt Flats"] },
  { n: "La Boca", c: "Buenos Aires", aka: ["Caminito", "La Boca (Caminito)"] },
  { n: "Recoleta Cemetery", c: "Buenos Aires", aka: ["Cementerio de la Recoleta", "La Recoleta Cemetery"] },
  { n: "Teatro Colón", c: "Buenos Aires", aka: ["Teatro Colon", "Colon Theatre"] },
  { n: "Obelisco", c: "Buenos Aires", aka: ["Obelisco de Buenos Aires", "Obelisk"] },
  { n: "Iguazu Falls", c: "Puerto Iguazú", aka: ["Cataratas del Iguazú", "Iguazú Falls", "Iguacu Falls"] },
  { n: "Iguaçu Falls", c: "Foz do Iguaçu", aka: ["Cataratas do Iguaçu", "Iguazu Falls Brazil"] },
  { n: "Perito Moreno Glacier", c: "El Calafate", aka: ["Perito Moreno", "Glaciar Perito Moreno"] },
  { n: "Christ the Redeemer", c: "Rio de Janeiro", aka: ["Cristo Redentor", "Christ the Redeemer Statue"] },
  { n: "Sugarloaf Mountain", c: "Rio de Janeiro", aka: ["Pão de Açúcar", "Pao de Acucar"] },
  { n: "Copacabana Beach", c: "Rio de Janeiro", aka: ["Copacabana"] },
  { n: "Ipanema Beach", c: "Rio de Janeiro", aka: ["Ipanema"] },
  { n: "Selarón Steps", c: "Rio de Janeiro", aka: ["Escadaria Selarón", "Selaron Steps", "Lapa Steps"] },
  { n: "Maracanã", c: "Rio de Janeiro", aka: ["Maracana", "Estádio do Maracanã", "Maracanã Stadium"] },
  { n: "Pelourinho", c: "Salvador", aka: ["Pelourinho Salvador"] },
  { n: "Ahu Tongariki", c: "Easter Island", aka: ["Tongariki"] },
  { n: "Valle de la Luna", c: "San Pedro de Atacama", aka: ["Valley of the Moon"] },
  // ── Oceania ───────────────────────────────────────────────────────────
  { n: "Sydney Opera House", c: "Sydney", aka: ["Opera House"] },
  { n: "Sydney Harbour Bridge", c: "Sydney", aka: ["Harbour Bridge"] },
  { n: "Bondi Beach", c: "Sydney", aka: ["Bondi"] },
  { n: "Darling Harbour", c: "Sydney" },
  { n: "Great Barrier Reef", c: "Cairns" },
  { n: "Uluru", c: "Uluru", aka: ["Ayers Rock"] },
  { n: "Twelve Apostles", c: "Port Campbell", aka: ["The Twelve Apostles", "12 Apostles"] },
  { n: "Federation Square", c: "Melbourne", aka: ["Fed Square"] },
  { n: "Queen Victoria Market", c: "Melbourne", aka: ["Queen Vic Market", "Vic Market"] },
  { n: "Surfers Paradise", c: "Gold Coast", aka: ["Surfers Paradise Beach"] },
  { n: "Sky Tower", c: "Auckland" },
  { n: "Milford Sound", c: "Milford Sound", aka: ["Piopiotahi"] },
  { n: "Hobbiton", c: "Matamata", aka: ["Hobbiton Movie Set"] },
  { n: "Te Puia", c: "Rotorua", aka: ["Te Puia (Whakarewarewa)"] },
  { n: "MONA", c: "Hobart", aka: ["Museum of Old and New Art", "Mona Museum"] },
  { n: "Kings Park", c: "Perth", aka: ["Kings Park and Botanic Garden"] },
];

// ── famous matching ─────────────────────────────────────────────────────

interface NormFamous {
  entry: FamousEntry;
  city: string; // normalized city key
  cityCompact: string;
  names: string[]; // normalized canonical + alias keys
}

const NORM_FAMOUS: NormFamous[] = WORLD_FAMOUS.map((entry) => {
  const city = normalizeNameKey(entry.c);
  return {
    entry,
    city,
    cityCompact: compactKey(city),
    names: [entry.n, ...(entry.aka ?? [])].map(normalizeNameKey),
  };
});

function cityMatches(placeCityKey: string, entryCity: string, entryCityCompact: string): boolean {
  if (!placeCityKey) return false;
  if (placeCityKey === entryCity) return true;
  // compact equality: "Machupicchu" vs "Machu Picchu"
  if (compactKey(placeCityKey) === entryCityCompact) return true;
  // containment with a length floor ("Mexico City" vs "Mexico", "Old Goa" vs "Goa")
  if (entryCity.length >= 4 && placeCityKey.includes(entryCity)) return true;
  if (placeCityKey.length >= 4 && entryCity.includes(placeCityKey)) return true;
  return false;
}

/**
 * Match a corpus place against the curated world-famous list by fuzzy
 * name + city. Name match: exact normalized key, or containment either way
 * with a ≥6-char floor on the shorter side (so "Kinkaku-ji" matches
 * "Kinkaku-ji (Golden Pavilion)" but "Gion" can't match "Legion").
 */
export function matchWorldFamous(name: string, city: string): FamousEntry | null {
  const nk = normalizeNameKey(name);
  if (nk.length < 3) return null;
  const ck = normalizeNameKey(city);
  for (const f of NORM_FAMOUS) {
    if (!cityMatches(ck, f.city, f.cityCompact)) continue;
    for (const en of f.names) {
      if (nk === en) return f.entry;
      if (en.length >= 6 && nk.includes(en)) return f.entry;
      if (nk.length >= 6 && en.includes(nk)) return f.entry;
    }
  }
  return null;
}

// ─── fame scoring ───────────────────────────────────────────────────────

export interface FamePlace {
  id: number;
  name: string;
  category: string;
  tags?: string[] | null;
  rating?: number | null;
  image?: string | null;
  verdict?: string | null;
}

/** Category iconicity - landmark/museum/viewpoint outrank restaurants. */
export function iconicityOf(tags: string[], category: string): number {
  const t = new Set(tags.map((x) => x.toLowerCase()));
  const has = (...xs: string[]) => xs.some((x) => t.has(x));
  if (has("iconic", "landmark", "monument", "palace", "castle", "fort", "tower", "arch", "ruins", "unesco")) return 1.0;
  if (has("museum", "gallery", "art")) return 0.9;
  if (has("temple", "shrine", "church", "mosque", "cathedral", "basilica", "buddha", "synagogue", "gurudwara", "monastery", "pagoda")) return 0.9;
  if (has("viewpoint", "views", "photography", "sunset", "observatory", "skyline")) return 0.85;
  if (has("historic", "heritage", "memorial", "architecture", "history")) return 0.85;
  if (has("garden", "gardens", "park", "nature", "lake", "waterfall")) return 0.7;
  if (has("beach", "beachfront", "seaside")) return 0.7;
  if (has("market", "markets", "souk", "bazaar", "shopping", "night-market")) return 0.6;
  if (category.toLowerCase() === "food" || has("food", "restaurant", "cafe", "coffee", "bar", "nightlife", "street-food")) return 0.35;
  return 0.55;
}

/** World-famous multiplier. */
export const WORLD_FAMOUS_BOOST = 5;
/** Own-photo bonus multiplier (a place with its own photo reads as real). */
export const OWN_PHOTO_BONUS = 1.15;

/**
 * fame = rating weight × category iconicity × curated world-famous boost ×
 * has-own-photo bonus, scaled ×100 for display-friendly integers.
 * rating weight maps 3.0→0.05 … 5.0→1.0 linearly (unrated → 4.2 default).
 */
export function fameScoreFor(place: FamePlace, city: string): { fame: number; world: FamousEntry | null } {
  const world = matchWorldFamous(place.name, city);
  const rating = place.rating ?? 4.2;
  const ratingW = Math.min(1, Math.max(0.05, (rating - 3) / 2));
  const iconicity = iconicityOf(place.tags ?? [], place.category);
  const fame = ratingW * iconicity * (world ? WORLD_FAMOUS_BOOST : 1) * (place.image ? OWN_PHOTO_BONUS : 1) * 100;
  return { fame: Math.round(fame * 10) / 10, world };
}

// ─── blog-style blurbs (template-driven by category+tags+city) ──────────

const BLURB_BUCKETS: { match: (tags: Set<string>, cat: string) => boolean; lines: string[] }[] = [
  {
    match: (t) => ["viewpoint", "views", "photography", "sunset", "skyline"].some((x) => t.has(x)),
    lines: ["The postcard shot of {city}", "The view that launched a thousand {city} photos"],
  },
  {
    match: (t) => ["iconic", "landmark", "monument", "tower", "arch"].some((x) => t.has(x)),
    lines: ["The postcard shot of {city}", "{city}'s most photographed icon", "The sight every {city} itinerary starts with"],
  },
  {
    match: (t) => ["palace", "castle", "fort", "ruins", "historic", "heritage", "architecture"].some((x) => t.has(x)),
    lines: ["Centuries of history in one complex", "Where {city}'s past is carved in stone", "A masterpiece from {city}'s golden age"],
  },
  {
    match: (t) => ["temple", "shrine", "church", "mosque", "cathedral", "basilica", "buddha", "monastery", "pagoda", "synagogue", "gurudwara"].some((x) => t.has(x)),
    lines: ["A sacred icon at the heart of {city}", "The spiritual heart of {city}", "Centuries of devotion under one roof"],
  },
  {
    match: (t) => ["museum", "gallery", "art"].some((x) => t.has(x)),
    lines: ["Centuries of history in one complex", "World-class collections under one roof", "The museum every {city} visitor should see"],
  },
  {
    match: (t) => ["beach", "beachfront", "seaside"].some((x) => t.has(x)),
    lines: ["The beach every {city} postcard starts with", "{city}'s legendary stretch of sand"],
  },
  {
    match: (t) => ["garden", "gardens", "park", "nature", "lake", "waterfall"].some((x) => t.has(x)),
    lines: ["{city}'s most beloved green escape", "Nature's grand stage inside {city}"],
  },
  {
    match: (t) => ["market", "markets", "souk", "bazaar", "shopping", "night-market"].some((x) => t.has(x)),
    lines: ["The market that defines {city}'s street life", "{city}'s most storied bazaar"],
  },
  {
    match: (t, cat) => cat === "food" || ["food", "restaurant", "cafe", "street-food"].some((x) => t.has(x)),
    lines: ["The table every visitor to {city} tries to book", "A {city} institution on every food map"],
  },
];

const BLURB_FALLBACK = ["A signature {city} experience", "One of {city}'s defining sights"];

/**
 * One-line blog-style "why it's famous" blurb. Deterministic per place id
 * so re-renders never reshuffle the copy and listicle rows vary.
 */
export function blurbFor(place: FamePlace, city: string, _worldFamous = false): string {
  const tags = new Set((place.tags ?? []).map((x) => x.toLowerCase()));
  const cat = place.category.toLowerCase();
  const bucket = BLURB_BUCKETS.find((b) => b.match(tags, cat));
  const lines = bucket?.lines ?? BLURB_FALLBACK;
  const idx = Math.abs(place.id) % lines.length;
  return lines[idx]!.replace("{city}", city);
}
