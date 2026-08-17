/**
 * seed-prices.ts - fills missing price data on explore_places so users can see
 * "how much it costs": admission fees for attractions (feeCents/feeCurrency/
 * feeNote) and average meal prices for food places (mealCents/mealNote).
 *
 * Two passes, both IDEMPOTENT and both only touching NULL columns (researched
 * curated values are never overwritten):
 *
 *  1. CURATED_OVERRIDES - real 2025-2026 adult ticket prices for world-iconic
 *     attractions, matched by case-insensitive name-contains (+ optional city
 *     guard / exclusion patterns so "Taj Mahal" the Cape Town restaurant or
 *     "Van Gogh Cafe" never match).
 *
 *  2. CITY_COST model - per-city typical prices (currency, attractionBase,
 *     museumBase, mealBase) with country fallbacks. Places still NULL after
 *     pass 1 get a modeled estimate: tag-driven category rules (museums paid,
 *     viewpoints/parks/hikes free, temples in Japan ~¥0-500, spas pricier),
 *     priceLevel multiplier [0.6, 1, 1.8, 3.2] and a DETERMINISTIC ±15% jitter
 *     derived from the row id (stable across runs). Modeled notes always start
 *     with "Avg …" so the UI can label them as estimates.
 *
 * Run:  npx tsx db/seed-prices.ts
 */
import { and, inArray, isNull, sql } from "drizzle-orm";
import { getDb } from "../api/queries/connection";
import * as schema from "./schema";
import { formatMoneyCompact } from "../contracts/fx";

// ─── 1. Curated overrides (2025-2026 researched adult admission) ─────────────
interface Override {
  /** lowercase substring matched against LOWER(name) */
  pattern: string;
  /** optional LOWER(city) equality guard */
  city?: string;
  /** substrings that disqualify a match (restaurants, streets, sub-sights) */
  not?: string[];
  cents: number;
  currency: string;
  note: string;
}

const CURATED_OVERRIDES: Override[] = [
  // Paris
  { pattern: "eiffel tower", city: "paris", cents: 2830, currency: "EUR", note: "Adults €28.30 summit lift · 2nd floor €14.20" },
  { pattern: "louvre", city: "paris", cents: 2200, currency: "EUR", note: "Adults €22 · under 18 free (EU under 26)" },
  { pattern: "orsay", city: "paris", cents: 1600, currency: "EUR", note: "Adults €16 · under 18 free" },
  { pattern: "arc de triomphe", city: "paris", cents: 1600, currency: "EUR", note: "Adults €16 · under 18 free" },
  { pattern: "sainte-chapelle", city: "paris", cents: 1300, currency: "EUR", note: "Adults €13 · under 18 free" },
  { pattern: "panthéon", city: "paris", cents: 1300, currency: "EUR", note: "Adults €13 · under 18 free" },
  { pattern: "catacombs", city: "paris", cents: 3100, currency: "EUR", note: "Adults €31 with audioguide · timed entry" },
  { pattern: "orangerie", city: "paris", cents: 1250, currency: "EUR", note: "Adults €12.50 · under 18 free" },
  { pattern: "sacré-cœur", city: "paris", cents: 0, currency: "EUR", note: "Free · dome climb €7" },
  // Rome / Vatican
  { pattern: "colosseum", city: "rome", cents: 1800, currency: "EUR", note: "Adults €18 incl. Forum & Palatine · under 18 free" },
  { pattern: "vatican", city: "rome", not: ["cafe", "caffè"], cents: 2000, currency: "EUR", note: "Adults €20 + €5 online fee · free last Sun" },
  { pattern: "pantheon", city: "rome", cents: 500, currency: "EUR", note: "Adults €5 · under 18 free" },
  { pattern: "castel sant'angelo", city: "rome", cents: 1600, currency: "EUR", note: "Adults €16 · under 18 free" },
  { pattern: "borghese", city: "rome", not: ["bar", "fontanella"], cents: 1700, currency: "EUR", note: "Adults €17 · reservation required" },
  // Florence / Venice / Milan / Naples area
  { pattern: "uffizi", city: "florence", cents: 2500, currency: "EUR", note: "Adults €25 day-of, €29 advance · under 18 free" },
  { pattern: "accademia", city: "florence", cents: 1600, currency: "EUR", note: "Adults €16 · under 18 free" },
  { pattern: "brunelleschi", city: "florence", cents: 3000, currency: "EUR", note: "Brunelleschi Pass €30 · valid 3 days" },
  { pattern: "palazzo ducale", city: "venice", cents: 3000, currency: "EUR", note: "Adults €30 · St Mark's Square museums incl." },
  { pattern: "doge", city: "venice", cents: 3000, currency: "EUR", note: "Adults €30 · St Mark's Square museums incl." },
  { pattern: "san marco", city: "venice", cents: 300, currency: "EUR", note: "Basilica €3 · museum & terrace extra" },
  { pattern: "campanile", city: "venice", not: ["pizzeria", "ristorante"], cents: 1200, currency: "EUR", note: "Adults €12 · elevator up" },
  { pattern: "gallerie dell'accademia", city: "venice", cents: 1500, currency: "EUR", note: "Adults €15 · under 18 free" },
  { pattern: "last supper", city: "milan", cents: 1500, currency: "EUR", note: "Adults €15 · sells out weeks ahead" },
  { pattern: "cenacolo", city: "milan", cents: 1500, currency: "EUR", note: "Adults €15 · sells out weeks ahead" },
  { pattern: "duomo", city: "milan", not: ["osteria", "caffè"], cents: 1600, currency: "EUR", note: "Terraces €16 · cathedral €5" },
  { pattern: "pompeii", city: "naples", cents: 1800, currency: "EUR", note: "Adults €18 · under 18 free" },
  // Spain / Portugal
  { pattern: "sagrada", city: "barcelona", cents: 2600, currency: "EUR", note: "Adults €26 · towers +€10 · online only" },
  { pattern: "park güell", city: "barcelona", cents: 1000, currency: "EUR", note: "Adults €10 · timed entry" },
  { pattern: "casa batlló", city: "barcelona", cents: 3500, currency: "EUR", note: "Adults from €35 online" },
  { pattern: "casa milà", city: "barcelona", cents: 2800, currency: "EUR", note: "Adults from €28 online" },
  { pattern: "pedrera", city: "barcelona", cents: 2800, currency: "EUR", note: "Adults from €28 online" },
  { pattern: "picasso", city: "barcelona", cents: 1200, currency: "EUR", note: "Adults €12 · free Thu evenings" },
  { pattern: "alhambra", city: "granada", not: ["museo", "coracha", "terrasse"], cents: 1909, currency: "EUR", note: "Adults €19.09 · sells out weeks ahead" },
  { pattern: "museo de la alhambra", city: "granada", cents: 0, currency: "EUR", note: "Free entry" },
  { pattern: "alcázar", city: "seville", cents: 1450, currency: "EUR", note: "Adults €14.50 · under 17 free" },
  { pattern: "giralda", city: "seville", cents: 1200, currency: "EUR", note: "Cathedral + Giralda €12" },
  { pattern: "belém tower", city: "lisbon", cents: 600, currency: "EUR", note: "Adults €6 · under 12 free" },
  { pattern: "torre de belém", city: "lisbon", cents: 600, currency: "EUR", note: "Adults €6 · under 12 free" },
  { pattern: "jerónimos", city: "lisbon", cents: 1200, currency: "EUR", note: "Adults €12 · under 12 free" },
  { pattern: "pena palace", city: "sintra", cents: 1400, currency: "EUR", note: "Adults €14 · park only €7.50" },
  { pattern: "palácio da pena", city: "sintra", cents: 1400, currency: "EUR", note: "Adults €14 · park only €7.50" },
  { pattern: "regaleira", city: "sintra", not: ["café", "cafe"], cents: 1200, currency: "EUR", note: "Adults €12" },
  { pattern: "castelo dos mouros", city: "sintra", cents: 800, currency: "EUR", note: "Adults €8" },
  { pattern: "livraria lello", city: "porto", cents: 800, currency: "EUR", note: "€8 voucher ticket · redeemable on books" },
  { pattern: "clérigos", city: "porto", cents: 800, currency: "EUR", note: "Tower €8 · church free" },
  // Netherlands / Austria / Czechia / Hungary / Poland / Germany
  { pattern: "rijksmuseum", city: "amsterdam", cents: 2500, currency: "EUR", note: "Adults €25 · under 18 free" },
  { pattern: "van gogh museum", city: "amsterdam", cents: 2400, currency: "EUR", note: "Adults €24 · under 18 free" },
  { pattern: "anne frank", city: "amsterdam", cents: 1600, currency: "EUR", note: "Adults €16 · online release only" },
  { pattern: "heineken", city: "amsterdam", cents: 2300, currency: "EUR", note: "Adults €23 · 18+ only" },
  { pattern: "schönbrunn", city: "vienna", cents: 3200, currency: "EUR", note: "Grand Tour €32 · State Apartments €26" },
  { pattern: "belvedere", city: "vienna", cents: 1950, currency: "EUR", note: "Upper Belvedere €19.50" },
  { pattern: "prague castle", city: "prague", cents: 30000, currency: "CZK", note: "Main circuit ≈300 Kč" },
  { pattern: "pražský hrad", city: "prague", cents: 30000, currency: "CZK", note: "Main circuit ≈300 Kč" },
  { pattern: "petřín", city: "prague", cents: 22000, currency: "CZK", note: "Lookout tower 220 Kč" },
  { pattern: "parliament", city: "budapest", cents: 1200000, currency: "HUF", note: "Guided tour ≈12,000 Ft" },
  { pattern: "fisherman", city: "budapest", not: ["catch"], cents: 120000, currency: "HUF", note: "Upper terraces 1,200 Ft · lower free" },
  { pattern: "széchenyi", city: "budapest", not: ["istván"], cents: 940000, currency: "HUF", note: "Day ticket ≈9,400 Ft" },
  { pattern: "wieliczka", city: "krakow", cents: 12900, currency: "PLN", note: "Guided tour 129 zł" },
  { pattern: "fernsehturm", city: "berlin", cents: 2550, currency: "EUR", note: "Adults €25.50 · fast track extra" },
  { pattern: "tv tower", city: "berlin", cents: 2550, currency: "EUR", note: "Adults €25.50 · fast track extra" },
  { pattern: "neuschwanstein", cents: 1800, currency: "EUR", note: "Adults €18 · guided tour only" },
  // UK / Ireland / Denmark
  { pattern: "tower of london", city: "london", cents: 3480, currency: "GBP", note: "Adults £34.80 · under 5 free" },
  { pattern: "westminster abbey", city: "london", cents: 2900, currency: "GBP", note: "Adults £29" },
  { pattern: "london eye", city: "london", cents: 3200, currency: "GBP", note: "Adults from £32 online" },
  { pattern: "british museum", city: "london", cents: 0, currency: "GBP", note: "Free · special exhibitions ticketed" },
  { pattern: "tate modern", city: "london", cents: 0, currency: "GBP", note: "Free · special exhibitions ticketed" },
  { pattern: "national gallery", city: "london", cents: 0, currency: "GBP", note: "Free" },
  { pattern: "sky garden", city: "london", cents: 0, currency: "GBP", note: "Free · book ahead" },
  { pattern: "buckingham", city: "london", cents: 3200, currency: "GBP", note: "State Rooms £32 · summer opening" },
  { pattern: "edinburgh castle", city: "edinburgh", cents: 1950, currency: "GBP", note: "Adults £19.50 online · £23 walk-up" },
  { pattern: "guinness storehouse", city: "dublin", cents: 2600, currency: "EUR", note: "Adults from €26 · includes a pint" },
  { pattern: "book of kells", city: "dublin", cents: 1800, currency: "EUR", note: "Adults from €18" },
  { pattern: "kilmainham", city: "dublin", cents: 800, currency: "EUR", note: "Guided tour €8" },
  { pattern: "tivoli gardens", city: "copenhagen", cents: 18000, currency: "DKK", note: "Entry 180 kr · ride pass extra" },
  { pattern: "rosenborg", city: "copenhagen", cents: 14000, currency: "DKK", note: "Adults 140 kr · crown jewels incl." },
  { pattern: "nyhavn", city: "copenhagen", cents: 0, currency: "DKK", note: "Free · canal tours ≈99 kr" },
  // Greece / Malta / Slovenia / Belgium
  { pattern: "acropolis museum", city: "athens", cents: 1500, currency: "EUR", note: "Adults €15" },
  { pattern: "acropolis", city: "athens", cents: 3000, currency: "EUR", note: "Adults €30 Apr–Oct · €15 Nov–Mar" },
  { pattern: "co-cathedral", city: "valletta", cents: 1500, currency: "EUR", note: "Adults €15 · audioguide incl." },
  { pattern: "ljubljana castle", city: "ljubljana", cents: 1300, currency: "EUR", note: "Castle + funicular €13" },
  { pattern: "atomium", city: "brussels", cents: 1795, currency: "EUR", note: "Adults €17.95" },
  // Turkey
  { pattern: "hagia sophia", city: "istanbul", cents: 2500, currency: "EUR", note: "Upper gallery €25 · prayer hall free" },
  { pattern: "ayasofya", city: "istanbul", cents: 2500, currency: "EUR", note: "Upper gallery €25 · prayer hall free" },
  { pattern: "topkapı", city: "istanbul", cents: 200000, currency: "TRY", note: "Adults ≈₺2,000 · harem incl." },
  { pattern: "topkapi", city: "istanbul", cents: 200000, currency: "TRY", note: "Adults ≈₺2,000 · harem incl." },
  { pattern: "basilica cistern", city: "istanbul", cents: 130000, currency: "TRY", note: "Adults ≈₺1,300" },
  { pattern: "galata tower", city: "istanbul", cents: 100000, currency: "TRY", note: "Adults ≈₺1,000" },
  { pattern: "blue mosque", city: "istanbul", cents: 0, currency: "TRY", note: "Free · donations welcome" },
  // Morocco / Egypt / Jordan
  { pattern: "jardin majorelle", city: "marrakech", cents: 17000, currency: "MAD", note: "Adults 170 DH · online only" },
  { pattern: "bahia palace", city: "marrakech", cents: 10000, currency: "MAD", note: "Adults 100 DH" },
  { pattern: "jardin secret", city: "marrakech", cents: 10000, currency: "MAD", note: "Adults 100 DH · tower +50 DH" },
  { pattern: "jemaa el-fnaa", city: "marrakech", cents: 0, currency: "MAD", note: "Free · tip performers" },
  { pattern: "pyramids", city: "cairo", cents: 70000, currency: "EGP", note: "Adults 700 EGP · pyramid interiors extra" },
  { pattern: "giza", city: "cairo", cents: 70000, currency: "EGP", note: "Adults 700 EGP · pyramid interiors extra" },
  { pattern: "egyptian museum", city: "cairo", cents: 55000, currency: "EGP", note: "Adults 550 EGP" },
  { pattern: "karnak", city: "luxor", cents: 60000, currency: "EGP", note: "Adults 600 EGP" },
  { pattern: "valley of the kings", city: "luxor", cents: 75000, currency: "EGP", note: "Adults 750 EGP · 3 tombs incl." },
  { pattern: "petra", city: "petra", cents: 5000, currency: "JOD", note: "1-day JD 50 · 2-day JD 55" },
  // UAE
  { pattern: "burj khalifa", city: "dubai", cents: 16900, currency: "AED", note: "At The Top L124–125 from AED 169" },
  { pattern: "museum of the future", city: "dubai", cents: 14900, currency: "AED", note: "AED 149 · book ahead" },
  { pattern: "dubai frame", city: "dubai", cents: 5000, currency: "AED", note: "Adults AED 50" },
  { pattern: "sheikh zayed", city: "abu dhabi", cents: 0, currency: "AED", note: "Free · register online" },
  { pattern: "grand mosque", city: "abu dhabi", cents: 0, currency: "AED", note: "Free · register online" },
  { pattern: "qasr al watan", city: "abu dhabi", cents: 6500, currency: "AED", note: "Adults AED 65" },
  // Singapore / Malaysia
  { pattern: "gardens by the bay", city: "singapore", cents: 3200, currency: "SGD", note: "Two conservatories S$32 · outdoor free" },
  { pattern: "skypark", city: "singapore", cents: 3200, currency: "SGD", note: "Adults S$32 observation deck" },
  { pattern: "singapore zoo", city: "singapore", cents: 4800, currency: "SGD", note: "Adults S$48 · tram incl." },
  // Thailand
  { pattern: "grand palace", city: "bangkok", cents: 50000, currency: "THB", note: "Adults ฿500 · Wat Phra Kaew incl." },
  { pattern: "wat pho", city: "bangkok", cents: 30000, currency: "THB", note: "Adults ฿300 · cash" },
  { pattern: "wat arun", city: "bangkok", cents: 20000, currency: "THB", note: "Adults ฿200" },
  { pattern: "doi suthep", city: "chiang mai", cents: 5000, currency: "THB", note: "Foreigners ฿50 · cable car +฿50" },
  { pattern: "elephant nature park", city: "chiang mai", cents: 250000, currency: "THB", note: "Day visit ฿2,500 · book ahead" },
  // Hong Kong / Taiwan / Korea
  { pattern: "peak tram", city: "hong kong", cents: 8800, currency: "HKD", note: "Return HK$88 · Sky Terrace incl." },
  { pattern: "tian tan", city: "hong kong", cents: 0, currency: "HKD", note: "Free · Ngong Ping cable car extra" },
  { pattern: "big buddha", city: "hong kong", cents: 0, currency: "HKD", note: "Free · Ngong Ping cable car extra" },
  { pattern: "taipei 101", city: "taipei", cents: 60000, currency: "TWD", note: "Observatory NT$600" },
  { pattern: "national palace museum", city: "taipei", cents: 35000, currency: "TWD", note: "NT$350 · under 18 free" },
  { pattern: "longshan", city: "taipei", cents: 0, currency: "TWD", note: "Free" },
  { pattern: "gyeongbokgung", city: "seoul", cents: 300000, currency: "KRW", note: "Adults ₩3,000 · free in hanbok" },
  { pattern: "changdeokgung", city: "seoul", cents: 300000, currency: "KRW", note: "Adults ₩3,000 · Secret Garden +₩5,000" },
  { pattern: "n seoul tower", city: "seoul", cents: 2100000, currency: "KRW", note: "Observatory ₩21,000" },
  { pattern: "bukchon", city: "seoul", cents: 0, currency: "KRW", note: "Free" },
  // Japan
  { pattern: "fushimi inari", cents: 0, currency: "JPY", note: "Free · open 24h" },
  { pattern: "arashiyama", cents: 0, currency: "JPY", note: "Free" },
  { pattern: "bamboo grove", city: "kyoto", cents: 0, currency: "JPY", note: "Free" },
  { pattern: "kinkaku", city: "kyoto", cents: 50000, currency: "JPY", note: "Adults ¥500" },
  { pattern: "kiyomizu", city: "kyoto", cents: 50000, currency: "JPY", note: "Adults ¥500" },
  { pattern: "nijō castle", city: "kyoto", cents: 80000, currency: "JPY", note: "Adults ¥800 · Ninomaru Palace +¥500" },
  { pattern: "nijo castle", city: "kyoto", cents: 80000, currency: "JPY", note: "Adults ¥800 · Ninomaru Palace +¥500" },
  { pattern: "kyoto national museum", city: "kyoto", cents: 70000, currency: "JPY", note: "Adults ¥700 · special exhibitions extra" },
  { pattern: "gion", city: "kyoto", not: ["tanto", "cafe", "bar", "restaurant"], cents: 0, currency: "JPY", note: "Free to stroll" },
  { pattern: "senso", city: "tokyo", cents: 0, currency: "JPY", note: "Free" },
  { pattern: "sensō", city: "tokyo", cents: 0, currency: "JPY", note: "Free" },
  { pattern: "meiji", city: "tokyo", not: ["cafe", "restaurant"], cents: 0, currency: "JPY", note: "Free" },
  { pattern: "skytree", city: "tokyo", cents: 210000, currency: "JPY", note: "Adults ¥2,100 · Tembo Galleria +¥1,000" },
  { pattern: "teamlab", city: "tokyo", cents: 380000, currency: "JPY", note: "Adults from ¥3,800 · timed entry" },
  { pattern: "shibuya sky", city: "tokyo", cents: 250000, currency: "JPY", note: "Adults ¥2,500 online" },
  { pattern: "tokyo tower", city: "tokyo", cents: 150000, currency: "JPY", note: "Main Deck ¥1,500" },
  { pattern: "imperial palace", city: "tokyo", cents: 0, currency: "JPY", note: "East Gardens free" },
  { pattern: "osaka castle", city: "osaka", cents: 120000, currency: "JPY", note: "Adults ¥1,200 · grounds free" },
  { pattern: "tsutenkaku", city: "osaka", cents: 90000, currency: "JPY", note: "Observatory ¥900" },
  { pattern: "umeda sky", city: "osaka", cents: 150000, currency: "JPY", note: "Kuchu Teien observatory ¥1,500" },
  { pattern: "todai", city: "nara", cents: 80000, currency: "JPY", note: "Adults ¥800 · museum combo ¥1,200" },
  { pattern: "tōdai", city: "nara", cents: 80000, currency: "JPY", note: "Adults ¥800 · museum combo ¥1,200" },
  { pattern: "deer park", city: "nara", cents: 0, currency: "JPY", note: "Free · senbei crackers ¥200" },
  { pattern: "isuien", city: "nara", cents: 120000, currency: "JPY", note: "Adults ¥1,200" },
  { pattern: "kasuga", city: "nara", cents: 0, currency: "JPY", note: "Grounds free · inner area ¥500" },
  // South Asia
  { pattern: "boudhanath", city: "kathmandu", cents: 40000, currency: "NPR", note: "Foreigners NPR 400" },
  { pattern: "swayambhunath", city: "kathmandu", cents: 20000, currency: "NPR", note: "Foreigners NPR 200" },
  { pattern: "durbar", city: "kathmandu", cents: 100000, currency: "NPR", note: "Foreigners NPR 1,000" },
  { pattern: "pashupatinath", city: "kathmandu", cents: 100000, currency: "NPR", note: "Foreigners NPR 1,000" },
  { pattern: "taj mahal", city: "agra", cents: 130000, currency: "INR", note: "Foreigners ₹1,300 · mausoleum incl." },
  { pattern: "agra fort", city: "agra", cents: 65000, currency: "INR", note: "Foreigners ₹650" },
  { pattern: "red fort", city: "delhi", cents: 65000, currency: "INR", note: "Foreigners ₹650" },
  { pattern: "qutub", city: "delhi", cents: 60000, currency: "INR", note: "Foreigners ₹600" },
  { pattern: "humayun", city: "delhi", cents: 60000, currency: "INR", note: "Foreigners ₹600" },
  { pattern: "india gate", city: "delhi", cents: 0, currency: "INR", note: "Free" },
  { pattern: "amber fort", city: "jaipur", cents: 55000, currency: "INR", note: "Foreigners ₹550" },
  { pattern: "amer fort", city: "jaipur", cents: 55000, currency: "INR", note: "Foreigners ₹550" },
  { pattern: "city palace", city: "jaipur", cents: 100000, currency: "INR", note: "Foreigners ₹1,000" },
  { pattern: "hawa mahal", city: "jaipur", cents: 20000, currency: "INR", note: "Foreigners ₹200" },
  { pattern: "gateway of india", city: "mumbai", cents: 0, currency: "INR", note: "Free" },
  // Southeast Asia (mainland + Indonesia)
  { pattern: "ancient town", city: "hoi an", cents: 12000000, currency: "VND", note: "Old Town ticket 120,000₫ · 5 sights" },
  { pattern: "temple of literature", city: "hanoi", cents: 7000000, currency: "VND", note: "Adults 70,000₫" },
  { pattern: "hoa lo", city: "hanoi", cents: 5000000, currency: "VND", note: "Adults 50,000₫" },
  { pattern: "war remnants", city: "ho chi minh city", cents: 4000000, currency: "VND", note: "Adults 40,000₫" },
  { pattern: "independence palace", city: "ho chi minh city", cents: 4000000, currency: "VND", note: "Adults 40,000₫" },
  { pattern: "angkor", city: "siem reap", not: ["restaurant", "cafe", "hotel"], cents: 3700, currency: "USD", note: "1-day $37 · 3-day $62" },
  { pattern: "kuang si", city: "luang prabang", cents: 2500000, currency: "LAK", note: "Adults ≈25,000₭" },
  { pattern: "monkey forest", city: "ubud", cents: 10000000, currency: "IDR", note: "Adults ≈100,000 Rp" },
  // Americas
  { pattern: "top of the rock", city: "new york", cents: 4000, currency: "USD", note: "Adults from $40" },
  { pattern: "empire state", city: "new york", cents: 4400, currency: "USD", note: "86th floor from $44" },
  { pattern: "metropolitan museum", city: "new york", cents: 3000, currency: "USD", note: "Adults $30 · NY residents pay-what-you-wish" },
  { pattern: "museum of modern art", city: "new york", cents: 3000, currency: "USD", note: "Adults $30" },
  { pattern: "moma", city: "new york", cents: 3000, currency: "USD", note: "Adults $30" },
  { pattern: "statue of liberty", city: "new york", cents: 2450, currency: "USD", note: "Ferry + pedestal ≈$24.50" },
  { pattern: "9/11", city: "new york", cents: 3300, currency: "USD", note: "Museum adults $33 · memorial free" },
  { pattern: "central park", city: "new york", cents: 0, currency: "USD", note: "Free" },
  { pattern: "high line", city: "new york", cents: 0, currency: "USD", note: "Free" },
  { pattern: "brooklyn bridge", city: "new york", cents: 0, currency: "USD", note: "Free" },
  { pattern: "alcatraz", city: "san francisco", cents: 4525, currency: "USD", note: "Day tour ≈$45.25 · ferry incl." },
  { pattern: "golden gate", city: "san francisco", cents: 0, currency: "USD", note: "Free to walk across" },
  { pattern: "skydeck", city: "chicago", cents: 3900, currency: "USD", note: "Adults from $39" },
  { pattern: "art institute", city: "chicago", cents: 3200, currency: "USD", note: "Adults $32" },
  { pattern: "cloud gate", city: "chicago", cents: 0, currency: "USD", note: "Free" },
  { pattern: "getty", city: "los angeles", cents: 0, currency: "USD", note: "Free · timed reservation" },
  { pattern: "griffith observatory", city: "los angeles", cents: 0, currency: "USD", note: "Free" },
  { pattern: "antropología", city: "mexico city", cents: 10000, currency: "MXN", note: "Adults MXN 100 · free Sun for residents" },
  { pattern: "anthropology", city: "mexico city", cents: 10000, currency: "MXN", note: "Adults MXN 100 · free Sun for residents" },
  { pattern: "frida kahlo", city: "mexico city", cents: 32000, currency: "MXN", note: "Adults ≈MXN 320 · book ahead" },
  { pattern: "templo mayor", city: "mexico city", cents: 10000, currency: "MXN", note: "Adults MXN 100" },
  { pattern: "chapultepec", city: "mexico city", not: ["park", "parque"], cents: 10000, currency: "MXN", note: "Castle adults MXN 100" },
  { pattern: "monte albán", city: "oaxaca", cents: 10000, currency: "MXN", note: "Adults MXN 100" },
  { pattern: "santo domingo", city: "oaxaca", cents: 0, currency: "MXN", note: "Church free · cultural museum MXN 100" },
  { pattern: "hierve el agua", city: "oaxaca", cents: 5000, currency: "MXN", note: "Entry ≈MXN 50 · transport extra" },
  { pattern: "sacsayhuamán", city: "cusco", cents: 7000, currency: "PEN", note: "Boleto Turístico partial S/70" },
  { pattern: "qorikancha", city: "cusco", cents: 1500, currency: "PEN", note: "Adults S/15" },
  { pattern: "machu picchu", cents: 15200, currency: "PEN", note: "Adults ≈S/152 · book months ahead" },
  { pattern: "recoleta cemetery", city: "buenos aires", cents: 1000000, currency: "ARS", note: "Foreigners ≈AR$10,000 · check locally" },
  { pattern: "christ the redeemer", city: "rio de janeiro", cents: 9000, currency: "BRL", note: "Cog train ≈R$90 return" },
  { pattern: "cristo redentor", city: "rio de janeiro", cents: 9000, currency: "BRL", note: "Cog train ≈R$90 return" },
  { pattern: "sugarloaf", city: "rio de janeiro", cents: 16000, currency: "BRL", note: "Cable car ≈R$160 return" },
  { pattern: "pão de açúcar", city: "rio de janeiro", cents: 16000, currency: "BRL", note: "Cable car ≈R$160 return" },
  // Africa / Oceania / Iceland
  { pattern: "table mountain", city: "cape town", not: ["cafe"], cents: 40000, currency: "ZAR", note: "Cableway return ≈R400 · free to hike" },
  { pattern: "robben island", city: "cape town", cents: 60000, currency: "ZAR", note: "Ferry + tour R600" },
  { pattern: "kirstenbosch", city: "cape town", not: ["tea"], cents: 24000, currency: "ZAR", note: "Adults R240" },
  { pattern: "opera house", city: "sydney", cents: 4500, currency: "AUD", note: "Guided tour A$45 · forecourt free" },
  { pattern: "capilano", city: "vancouver", cents: 6700, currency: "CAD", note: "Adults ≈C$67" },
  { pattern: "sky lagoon", city: "reykjavik", cents: 999000, currency: "ISK", note: "Pure Pass ≈9,990 ISK" },
  { pattern: "blue lagoon", cents: 1049000, currency: "ISK", note: "Comfort ≈10,490 ISK · book ahead" },
  { pattern: "hallgrímskirkja", city: "reykjavik", cents: 140000, currency: "ISK", note: "Tower ≈1,400 ISK · church free" },
  { pattern: "þingvellir", city: "reykjavik", cents: 0, currency: "ISK", note: "Free · parking ≈1,000 ISK" },
  { pattern: "thingvellir", city: "reykjavik", cents: 0, currency: "ISK", note: "Free · parking ≈1,000 ISK" },
  { pattern: "reykjadalur", city: "reykjavik", cents: 0, currency: "ISK", note: "Free hike" },
  // Italy small towns
  { pattern: "amalfi cathedral", city: "amalfi", cents: 0, currency: "EUR", note: "Free · cloister €3" },
  { pattern: "villa rufolo", city: "ravello", cents: 800, currency: "EUR", note: "Adults €8" },
  { pattern: "path of the gods", city: "positano", cents: 0, currency: "EUR", note: "Free hike" },
  // Argentina - Patagonia trails
  { pattern: "laguna de los tres", city: "el chaltén", cents: 0, currency: "ARS", note: "Free · Los Glaciares NP" },
  { pattern: "laguna torre", city: "el chaltén", cents: 0, currency: "ARS", note: "Free · Los Glaciares NP" },
  { pattern: "chorrillo del salto", city: "el chaltén", cents: 0, currency: "ARS", note: "Free" },
];

// ─── 2. City cost model ───────────────────────────────────────────────────────
/** All amounts in CENTS of the local currency. meal = avg casual meal pp. */
interface CityCost {
  currency: string;
  attraction: number; // typical paid attraction/landmark ticket
  museum: number; // typical museum ticket
  meal: number; // avg casual meal per person
}

const CITY_COST: Record<string, CityCost> = {
  // Japan
  Tokyo: { currency: "JPY", attraction: 150000, museum: 120000, meal: 150000 },
  Kyoto: { currency: "JPY", attraction: 80000, museum: 70000, meal: 150000 },
  Osaka: { currency: "JPY", attraction: 100000, museum: 80000, meal: 140000 },
  Nara: { currency: "JPY", attraction: 70000, museum: 60000, meal: 130000 },
  Sapporo: { currency: "JPY", attraction: 100000, museum: 80000, meal: 140000 },
  // Western Europe (EUR)
  Paris: { currency: "EUR", attraction: 1800, museum: 1600, meal: 1800 },
  Rome: { currency: "EUR", attraction: 1600, museum: 1700, meal: 1600 },
  Florence: { currency: "EUR", attraction: 1600, museum: 1800, meal: 1600 },
  Venice: { currency: "EUR", attraction: 1500, museum: 1500, meal: 1800 },
  Milan: { currency: "EUR", attraction: 1400, museum: 1200, meal: 1700 },
  Naples: { currency: "EUR", attraction: 1200, museum: 1200, meal: 1300 },
  Positano: { currency: "EUR", attraction: 1000, museum: 800, meal: 2200 },
  Amalfi: { currency: "EUR", attraction: 1000, museum: 800, meal: 2000 },
  Ravello: { currency: "EUR", attraction: 900, museum: 800, meal: 2000 },
  Barcelona: { currency: "EUR", attraction: 1600, museum: 1200, meal: 1500 },
  Granada: { currency: "EUR", attraction: 1200, museum: 800, meal: 1300 },
  Seville: { currency: "EUR", attraction: 1200, museum: 1000, meal: 1300 },
  Lisbon: { currency: "EUR", attraction: 1000, museum: 1000, meal: 1300 },
  Sintra: { currency: "EUR", attraction: 1200, museum: 1000, meal: 1400 },
  Porto: { currency: "EUR", attraction: 900, museum: 800, meal: 1200 },
  Amsterdam: { currency: "EUR", attraction: 2000, museum: 2100, meal: 1700 },
  Vienna: { currency: "EUR", attraction: 1800, museum: 1700, meal: 1500 },
  Munich: { currency: "EUR", attraction: 1400, museum: 1200, meal: 1500 },
  Berlin: { currency: "EUR", attraction: 1400, museum: 1400, meal: 1300 },
  Athens: { currency: "EUR", attraction: 1200, museum: 1000, meal: 1400 },
  Santorini: { currency: "EUR", attraction: 1000, museum: 800, meal: 2000 },
  Valletta: { currency: "EUR", attraction: 1200, museum: 1000, meal: 1600 },
  Ljubljana: { currency: "EUR", attraction: 1000, museum: 800, meal: 1300 },
  Dublin: { currency: "EUR", attraction: 1600, museum: 1400, meal: 1700 },
  Brussels: { currency: "EUR", attraction: 1400, museum: 1200, meal: 1600 },
  // Central / Northern Europe
  Prague: { currency: "CZK", attraction: 30000, museum: 25000, meal: 25000 },
  Budapest: { currency: "HUF", attraction: 400000, museum: 350000, meal: 450000 },
  Krakow: { currency: "PLN", attraction: 6000, museum: 5000, meal: 5000 },
  Copenhagen: { currency: "DKK", attraction: 13000, museum: 12000, meal: 14000 },
  Reykjavik: { currency: "ISK", attraction: 300000, museum: 250000, meal: 350000 },
  Vík: { currency: "ISK", attraction: 200000, museum: 200000, meal: 380000 },
  // UK
  London: { currency: "GBP", attraction: 2800, museum: 2000, meal: 1800 },
  Edinburgh: { currency: "GBP", attraction: 1800, museum: 1200, meal: 1600 },
  // North America
  "New York": { currency: "USD", attraction: 3500, museum: 2800, meal: 2200 },
  "San Francisco": { currency: "USD", attraction: 3000, museum: 2000, meal: 2200 },
  Chicago: { currency: "USD", attraction: 3000, museum: 2500, meal: 2000 },
  "Los Angeles": { currency: "USD", attraction: 2500, museum: 2000, meal: 2000 },
  Vancouver: { currency: "CAD", attraction: 4000, museum: 2500, meal: 2400 },
  // Middle East
  Dubai: { currency: "AED", attraction: 15000, museum: 8000, meal: 12000 },
  "Abu Dhabi": { currency: "AED", attraction: 10000, museum: 7000, meal: 11000 },
  Istanbul: { currency: "TRY", attraction: 80000, museum: 70000, meal: 35000 },
  Jerusalem: { currency: "ILS", attraction: 6000, museum: 5000, meal: 7000 },
  Petra: { currency: "JOD", attraction: 5000, museum: 3000, meal: 1000 },
  // Africa
  Marrakech: { currency: "MAD", attraction: 10000, museum: 7000, meal: 9000 },
  Fes: { currency: "MAD", attraction: 8000, museum: 5000, meal: 8000 },
  Cairo: { currency: "EGP", attraction: 40000, museum: 35000, meal: 15000 },
  Luxor: { currency: "EGP", attraction: 45000, museum: 30000, meal: 12000 },
  "Cape Town": { currency: "ZAR", attraction: 30000, museum: 15000, meal: 20000 },
  Zanzibar: { currency: "USD", attraction: 1500, museum: 800, meal: 1200 },
  // Asia
  Kathmandu: { currency: "NPR", attraction: 80000, museum: 50000, meal: 70000 },
  Bangkok: { currency: "THB", attraction: 30000, museum: 20000, meal: 15000 },
  "Chiang Mai": { currency: "THB", attraction: 15000, museum: 10000, meal: 12000 },
  "Hoi An": { currency: "VND", attraction: 10000000, museum: 8000000, meal: 10000000 },
  Hanoi: { currency: "VND", attraction: 8000000, museum: 6000000, meal: 9000000 },
  "Ho Chi Minh City": { currency: "VND", attraction: 8000000, museum: 6000000, meal: 9000000 },
  "Siem Reap": { currency: "USD", attraction: 1500, museum: 1200, meal: 800 },
  "Luang Prabang": { currency: "LAK", attraction: 3000000, museum: 2500000, meal: 2500000 },
  Ubud: { currency: "IDR", attraction: 8000000, museum: 6000000, meal: 8000000 },
  Mumbai: { currency: "INR", attraction: 50000, museum: 40000, meal: 40000 },
  Delhi: { currency: "INR", attraction: 50000, museum: 40000, meal: 40000 },
  Jaipur: { currency: "INR", attraction: 50000, museum: 40000, meal: 40000 },
  Agra: { currency: "INR", attraction: 60000, museum: 40000, meal: 40000 },
  "Hong Kong": { currency: "HKD", attraction: 15000, museum: 8000, meal: 9000 },
  Taipei: { currency: "TWD", attraction: 40000, museum: 30000, meal: 10000 },
  Seoul: { currency: "KRW", attraction: 1500000, museum: 1000000, meal: 1200000 },
  Busan: { currency: "KRW", attraction: 1000000, museum: 800000, meal: 1100000 },
  Singapore: { currency: "SGD", attraction: 3500, museum: 2500, meal: 1800 },
  "Kuala Lumpur": { currency: "MYR", attraction: 6000, museum: 3000, meal: 2500 },
  // Latin America
  "Mexico City": { currency: "MXN", attraction: 15000, museum: 10000, meal: 25000 },
  Oaxaca: { currency: "MXN", attraction: 10000, museum: 9000, meal: 20000 },
  Tulum: { currency: "MXN", attraction: 15000, museum: 10000, meal: 30000 },
  Cusco: { currency: "PEN", attraction: 10000, museum: 5000, meal: 6000 },
  "Buenos Aires": { currency: "ARS", attraction: 1500000, museum: 1000000, meal: 1500000 },
  "El Chaltén": { currency: "ARS", attraction: 1000000, museum: 800000, meal: 2000000 },
  "Rio de Janeiro": { currency: "BRL", attraction: 10000, museum: 6000, meal: 8000 },
  // Oceania
  Melbourne: { currency: "AUD", attraction: 3500, museum: 2000, meal: 2200 },
  Sydney: { currency: "AUD", attraction: 4000, museum: 2500, meal: 2400 },
  Queenstown: { currency: "NZD", attraction: 5000, museum: 3000, meal: 2800 },
  Auckland: { currency: "NZD", attraction: 4000, museum: 2500, meal: 2500 },
};

/** Country fallback for cities not listed above (keyed by DB country value). */
const COUNTRY_COST: Record<string, CityCost> = {
  Japan: CITY_COST.Kyoto!, "日本": CITY_COST.Kyoto!,
  France: CITY_COST.Paris!, Italy: CITY_COST.Rome!, Spain: CITY_COST.Barcelona!,
  Portugal: CITY_COST.Lisbon!, Netherlands: CITY_COST.Amsterdam!,
  Austria: CITY_COST.Vienna!, Germany: CITY_COST.Berlin!, Greece: CITY_COST.Athens!,
  Malta: CITY_COST.Valletta!, Slovenia: CITY_COST.Ljubljana!, Ireland: CITY_COST.Dublin!,
  Belgium: CITY_COST.Brussels!, Czechia: CITY_COST.Prague!, Hungary: CITY_COST.Budapest!,
  Poland: CITY_COST.Krakow!, Denmark: CITY_COST.Copenhagen!, Iceland: CITY_COST.Reykjavik!,
  "United Kingdom": CITY_COST.London!,
  "United States": CITY_COST["New York"]!, USA: CITY_COST["New York"]!,
  Canada: CITY_COST.Vancouver!,
  "United Arab Emirates": CITY_COST.Dubai!, UAE: CITY_COST.Dubai!,
  Turkey: CITY_COST.Istanbul!, "Türkiye": CITY_COST.Istanbul!,
  Israel: CITY_COST.Jerusalem!, Jordan: CITY_COST.Petra!,
  Morocco: CITY_COST.Marrakech!, Egypt: CITY_COST.Cairo!,
  "South Africa": CITY_COST["Cape Town"]!, Tanzania: CITY_COST.Zanzibar!,
  Nepal: CITY_COST.Kathmandu!, Thailand: CITY_COST.Bangkok!, Vietnam: CITY_COST.Hanoi!,
  Cambodia: CITY_COST["Siem Reap"]!, Laos: CITY_COST["Luang Prabang"]!,
  Indonesia: CITY_COST.Ubud!, India: CITY_COST.Delhi!,
  China: CITY_COST["Hong Kong"]!, "Hong Kong": CITY_COST["Hong Kong"]!,
  Taiwan: CITY_COST.Taipei!, "South Korea": CITY_COST.Seoul!,
  Singapore: CITY_COST.Singapore!, Malaysia: CITY_COST["Kuala Lumpur"]!,
  Mexico: CITY_COST["Mexico City"]!, Peru: CITY_COST.Cusco!,
  Argentina: CITY_COST["Buenos Aires"]!, Brazil: CITY_COST["Rio de Janeiro"]!,
  Australia: CITY_COST.Sydney!, "New Zealand": CITY_COST.Queenstown!,
};

const DEFAULT_COST: CityCost = { currency: "USD", attraction: 2000, museum: 1500, meal: 2000 };

/** priceLevel 1-4 multipliers on the city base price. */
const PL_MULT = [0.6, 1, 1.8, 3.2];

function costFor(city: string, country: string): CityCost {
  return CITY_COST[city] ?? COUNTRY_COST[country] ?? DEFAULT_COST;
}

/** Deterministic ±15% jitter from the row id - stable across runs. */
function jitter(id: number): number {
  const h = (id * 2654435761) >>> 0; // knuth multiplicative hash
  return 0.85 + ((h % 1000) / 1000) * 0.3;
}

/** Round modeled prices to locally "nice" amounts (in cents). */
function niceRound(cents: number, currency: string): number {
  const step =
    currency === "JPY" || currency === "ISK" || currency === "HUF" || currency === "NPR" ? 10000 :
    currency === "KRW" ? 50000 :
    currency === "VND" || currency === "IDR" ? 500000 :
    currency === "LAK" ? 500000 :
    currency === "INR" ? 5000 :
    currency === "CZK" || currency === "EGP" || currency === "MAD" ? 1000 :
    currency === "TRY" || currency === "ARS" ? 500 :
    50;
  return Math.max(step, Math.round(cents / step) * step);
}

const FREE_TAGS = new Set([
  "viewpoint", "views", "walk", "hike", "nature", "beach", "waterfall", "lake",
  "river", "park", "harbor", "old-town", "square", "piazza", "sunset", "picnic",
  "easy-walk", "deer", "forest", "coast", "promenade", "canals", "photography",
  "memorial",
]);
const RELIGIOUS_TAGS = new Set(["temple", "church", "cathedral", "religious", "buddha", "mosque", "monastery", "shrine", "pagoda", "wat"]);
const SPA_TAGS = new Set(["spa", "geothermal", "hot-spring", "onsen", "pools"]);
const FAMILY_TAGS = new Set(["family", "rides", "zoo", "aquarium"]);
const GARDEN_TAGS = new Set(["garden", "gardens"]);
const PAID_MONUMENT_TAGS = new Set(["castle", "palace", "tower", "monument", "ruins", "observatory"]);

/** OSM tags often miss religion - catch it in the name ("Shah Wajid Mosque"). */
const RELIGIOUS_NAME = /\b(mosque|masjid|temple|church|cathedral|chapel|shrine|synagogue|gurdwara|basilica|minster|abbey|monastery|pagoda|jinja)\b/i;
/** Outdoor memorials are virtually always free to visit. */
const MEMORIAL_NAME = /\bmemorial\b/i;

type FeeKind = { kind: "free" } | { kind: "paid"; base: number };

/** Decide how an activity row should be priced from its name + tags. */
function classifyActivity(name: string, tags: string[], cost: CityCost, priceLevel: number, country: string): FeeKind {
  const t = new Set(tags.map((x) => x.toLowerCase()));
  const has = (s: Set<string>) => [...s].some((x) => t.has(x));
  if (t.has("museum") || t.has("art") || t.has("history")) return { kind: "paid", base: cost.museum };
  if (has(SPA_TAGS)) return { kind: "paid", base: cost.attraction * 2 };
  if (has(RELIGIOUS_TAGS) || RELIGIOUS_NAME.test(name)) {
    // Temples & shrines in Japan typically charge ¥0–500; most religious sites elsewhere are free
    if (country === "Japan" || country === "日本") return priceLevel >= 2 ? { kind: "paid", base: 40000 } : { kind: "free" };
    return { kind: "free" };
  }
  if (has(FAMILY_TAGS)) return { kind: "paid", base: cost.attraction * 1.2 };
  if (has(GARDEN_TAGS)) return priceLevel >= 2 ? { kind: "paid", base: cost.museum * 0.6 } : { kind: "free" };
  if (has(FREE_TAGS) || MEMORIAL_NAME.test(name)) return { kind: "free" };
  if (has(PAID_MONUMENT_TAGS)) return { kind: "paid", base: cost.attraction };
  // landmark / historic / architecture / iconic / culture / default → paid attraction
  return { kind: "paid", base: cost.attraction };
}

// ─── Apply helpers ────────────────────────────────────────────────────────────
interface UpdateGroup {
  set: Partial<typeof schema.explorePlaces.$inferInsert>;
  guard: "fee" | "meal";
  ids: number[];
}

async function flushGroups(db: ReturnType<typeof getDb>, groups: Map<string, UpdateGroup>): Promise<number> {
  let updated = 0;
  for (const g of groups.values()) {
    for (let i = 0; i < g.ids.length; i += 400) {
      const chunk = g.ids.slice(i, i + 400);
      await db
        .update(schema.explorePlaces)
        .set(g.set)
        .where(
          and(
            inArray(schema.explorePlaces.id, chunk),
            g.guard === "fee" ? isNull(schema.explorePlaces.feeCents) : isNull(schema.explorePlaces.mealCents),
          ),
        );
      updated += chunk.length;
    }
  }
  return updated;
}

function groupPush(groups: Map<string, UpdateGroup>, guard: "fee" | "meal", set: UpdateGroup["set"], id: number) {
  const key = guard + JSON.stringify(set);
  let g = groups.get(key);
  if (!g) {
    g = { set, guard, ids: [] };
    groups.set(key, g);
  }
  g.ids.push(id);
}

async function main() {
  const db = getDb();
  console.log("[seed-prices] starting, never overwrites non-NULL values");

  // ── Pass 1: curated overrides ──
  let overrideHits = 0;
  const overrideRows: { id: number; name: string; city: string }[] = [];
  for (const o of CURATED_OVERRIDES) {
    const conds = [
      isNull(schema.explorePlaces.feeCents),
      sql`LOWER(${schema.explorePlaces.name}) LIKE ${"%" + o.pattern + "%"}`,
    ];
    if (o.city) conds.push(sql`LOWER(${schema.explorePlaces.city}) = ${o.city}`);
    for (const n of o.not ?? []) {
      conds.push(sql`LOWER(${schema.explorePlaces.name}) NOT LIKE ${"%" + n + "%"}`);
    }
    const rows = await db
      .select({ id: schema.explorePlaces.id, name: schema.explorePlaces.name, city: schema.explorePlaces.city })
      .from(schema.explorePlaces)
      .where(and(...conds));
    if (!rows.length) continue;
    await db
      .update(schema.explorePlaces)
      .set({ feeCents: o.cents, feeCurrency: o.currency, feeNote: o.note })
      .where(and(inArray(schema.explorePlaces.id, rows.map((r) => r.id)), isNull(schema.explorePlaces.feeCents)));
    overrideHits += rows.length;
    overrideRows.push(...rows);
  }
  console.log(`[seed-prices] pass 1: ${overrideHits} rows priced from ${CURATED_OVERRIDES.length} curated overrides`);
  for (const r of overrideRows.slice(0, 80)) console.log(`    · ${r.name} (${r.city})`);
  if (overrideRows.length > 80) console.log(`    … and ${overrideRows.length - 80} more`);

  // ── Pass 2: modeled city-cost fill ──
  const rows = await db
    .select({
      id: schema.explorePlaces.id,
      name: schema.explorePlaces.name,
      city: schema.explorePlaces.city,
      country: schema.explorePlaces.country,
      category: schema.explorePlaces.category,
      tags: schema.explorePlaces.tags,
      priceLevel: schema.explorePlaces.priceLevel,
      feeCents: schema.explorePlaces.feeCents,
      mealCents: schema.explorePlaces.mealCents,
    })
    .from(schema.explorePlaces)
    .where(sql`${schema.explorePlaces.feeCents} IS NULL OR (${schema.explorePlaces.category} = 'food' AND ${schema.explorePlaces.mealCents} IS NULL)`);

  const groups = new Map<string, UpdateGroup>();
  const perCity = new Map<string, { fees: number; meals: number }>();
  const bump = (city: string, k: "fees" | "meals") => {
    const c = perCity.get(city) ?? { fees: 0, meals: 0 };
    c[k]++;
    perCity.set(city, c);
  };

  for (const r of rows) {
    const cost = costFor(r.city, r.country);
    const pl = Math.min(4, Math.max(1, r.priceLevel ?? 2));
    const mult = PL_MULT[pl - 1]!;
    const j = jitter(r.id);
    if (r.category === "food") {
      if (r.mealCents != null) continue;
      const meal = niceRound(cost.meal * mult * j, cost.currency);
      groupPush(groups, "meal", {
        mealCents: meal,
        mealNote: `Avg meal ≈ ${formatMoneyCompact(meal, cost.currency)} pp`,
        feeCurrency: cost.currency,
      }, r.id);
      bump(r.city, "meals");
    } else if (r.category === "shopping") {
      if (r.feeCents != null) continue;
      groupPush(groups, "fee", { feeCents: 0, feeCurrency: cost.currency, feeNote: "Free to browse" }, r.id);
      bump(r.city, "fees");
    } else {
      if (r.feeCents != null) continue;
      const cls = classifyActivity(r.name, r.tags ?? [], cost, pl, r.country);
      if (cls.kind === "free") {
        groupPush(groups, "fee", { feeCents: 0, feeCurrency: cost.currency, feeNote: "Free entry (avg)" }, r.id);
      } else {
        const fee = niceRound(cls.base * mult * j, cost.currency);
        groupPush(groups, "fee", {
          feeCents: fee,
          feeCurrency: cost.currency,
          feeNote: `Avg adult ticket ≈ ${formatMoneyCompact(fee, cost.currency)}`,
        }, r.id);
      }
      bump(r.city, "fees");
    }
  }

  const updated = await flushGroups(db, groups);
  const totalMeals = [...perCity.values()].reduce((a, c) => a + c.meals, 0);
  const totalFees = [...perCity.values()].reduce((a, c) => a + c.fees, 0);
  console.log(`[seed-prices] pass 2: modeled ${totalFees} admission fees + ${totalMeals} meal prices across ${perCity.size} cities`);
  const sorted = [...perCity.entries()].sort((a, b) => b[1].fees + b[1].meals - (a[1].fees + a[1].meals));
  for (const [city, c] of sorted) console.log(`    ${city.padEnd(22)} fees ${String(c.fees).padStart(4)} · meals ${String(c.meals).padStart(4)}`);
  console.log(`[seed-prices] done, ${overrideHits + updated} row updates issued (guards skip any concurrent writes)`);
  process.exit(0);
}

main().catch((e) => {
  console.error("[seed-prices] failed:", e);
  process.exit(1);
});
