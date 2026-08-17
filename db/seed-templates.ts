import { and, eq, like } from "drizzle-orm";
import { getDb } from "../api/queries/connection";
import * as schema from "./schema";

/**
 * Seed ~26 ready-made plan templates into trip_templates (idempotent upsert
 * by slug). Each template carries a day-by-day payload of REAL named places.
 *
 * Corpus matching: every stop is verified against explore_places (same city,
 * name LIKE the match hint, curated sources first, then a token-overlap +
 * category sanity check). Matches reuse the corpus' canonical name, coords,
 * category and image; unmatched stops keep hand-researched coordinates.
 *
 * Run: npx tsx db/seed-templates.ts
 */

// ── Spec DSL ────────────────────────────────────────────────────────────────
type StopOpts = {
  match?: string; // corpus search hint (defaults to the stop name)
  city?: string; // corpus city to search (defaults to template city)
  cat?: "activity" | "food" | "shopping"; // expected category (default activity)
  image?: string;
};
type StopSpec = {
  name: string;
  lat: number;
  lng: number;
  durationMin: number;
  description: string;
} & StopOpts;
type DaySpec = { label: string; stops: StopSpec[] };
type TemplateSpec = {
  slug: string;
  title: string;
  destination: string;
  country: string;
  summary: string;
  coverImage: string;
  popularity: number;
  tags: string[];
  city: string; // default corpus city for stop matching
  plan: DaySpec[];
};

function s(
  name: string,
  lat: number,
  lng: number,
  durationMin: number,
  description: string,
  o: StopOpts = {},
): StopSpec {
  return { name, lat, lng, durationMin, description, ...o };
}
function d(label: string, stops: StopSpec[]): DaySpec {
  return { label, stops };
}
const U = (id: string) => `https://images.unsplash.com/${id}?w=1080&q=80&auto=format&fit=crop`;

// ── Templates ───────────────────────────────────────────────────────────────
const TEMPLATES: TemplateSpec[] = [
  {
    slug: "kyoto-5",
    title: "Kyoto in 5 Days",
    destination: "Kyoto",
    country: "Japan",
    summary:
      "Five unhurried days through Japan's old capital, vermilion gates at dawn, bamboo groves, Zen rock gardens and tea houses. Temples are clustered by neighborhood so each day walks one district.",
    coverImage: "/hero-kyoto.jpg",
    popularity: 1240,
    tags: ["historical", "food", "culture", "temples"],
    city: "Kyoto",
    plan: [
      d("Higashiyama essentials", [
        s("Kiyomizu-dera", 34.9949, 135.785, 120, "Start at the wooden stage of the Pure Water Temple for city views; arrive before 9 to beat the crowds.", { match: "Kiyomizu" }),
        s("Sannenzaka & Ninenzaka lanes", 34.9976, 135.7808, 90, "Wander the preserved stone-stepped streets below the temple, lined with teahouses and craft shops."),
        s("Gion (Hanamikoji Street)", 35.0038, 135.7755, 90, "Kyoto's geisha district, machiya townhouses and, at dusk, the chance of spotting a maiko on her way to an engagement.", { match: "Gion" }),
        s("Nishiki Market", 35.0051, 135.7643, 90, "Graze your way down 'Kyoto's Kitchen': tamagoyaki sticks, yuba, matcha sweets and pickles.", { match: "Nishiki", cat: "food" }),
      ]),
      d("Arashiyama & the west", [
        s("Arashiyama Bamboo Grove", 35.017, 135.6713, 90, "Walk the towering bamboo path early, the grove is silent and green-gold before the tour buses arrive.", { match: "Arashiyama" }),
        s("Tenryu-ji Temple", 35.031, 135.6738, 90, "A Zen UNESCO temple whose garden frames the Arashiyama hills like a living painting."),
        s("Togetsukyo Bridge", 35.0129, 135.6776, 60, "The 'Moon Crossing Bridge' over the Katsura River, the classic Arashiyama photo, best with river mist."),
        s("Okochi Sanso Villa", 35.0172, 135.6682, 90, "A silent-film star's hilltop villa garden; the entry ticket includes matcha and a wagashi sweet."),
      ]),
      d("Northern highlights", [
        s("Kinkaku-ji (Golden Pavilion)", 35.0394, 135.7292, 90, "The gold-leaf pavilion mirrored in its pond is Kyoto's most famous image, go at opening time.", { match: "Kinkaku" }),
        s("Ryoan-ji rock garden", 35.0345, 135.7183, 75, "Fifteen stones in raked gravel. Japan's most famous Zen garden rewards ten quiet minutes on the veranda."),
        s("Nijo Castle", 35.0142, 135.7482, 100, "Shogun-era palace with nightingale floors that chirp underfoot and painted sliding screens.", { match: "Nijo" }),
        s("Pontocho Alley", 35.0054, 135.7712, 100, "Lantern-lit riverside alley for dinner, book a kawayuka riverside platform in summer.", { cat: "food" }),
      ]),
      d("Fushimi & Uji", [
        s("Fushimi Inari Shrine", 34.9671, 135.7727, 150, "Hike the mountain trail through 10,000 vermilion torii gates; the upper loop takes ~2 hours and thins out fast.", { match: "Fushimi Inari" }),
        s("Tofuku-ji Temple", 34.9766, 135.7737, 75, "On the way back north, this Zen temple's checkered moss garden and ravine maples are superb in autumn."),
        s("Byodo-in Temple", 34.8893, 135.8077, 90, "Afternoon in Uji: the Phoenix Hall on the ¥10 coin, floating above its reflecting pond.", { match: "Byodo-in" }),
        s("Uji matcha tasting", 34.8879, 135.8066, 60, "Uji is Japan's tea capital, sit for a ceremonial-grade matcha and a bowl of matcha soba by the river.", { cat: "food" }),
      ]),
      d("Philosopher's Path & farewell", [
        s("Ginkaku-ji (Silver Pavilion)", 35.0267, 135.7981, 90, "The understated twin of the Golden Pavilion, with a sculpted sand cone and a hillside stroll."),
        s("Philosopher's Path", 35.0269, 135.7965, 75, "A cherry-tree canal walk linking Ginkaku-ji to Nanzen-ji, cafés and craft shops along the way."),
        s("Nanzen-ji Temple", 35.0112, 135.7938, 90, "Massive Sanmon gate, a brick aqueduct inside a Zen temple, and excellent yudofu (tofu hotpot) nearby."),
        s("Ichiran Ramen", 35.0037, 135.7687, 60, "Slurp a solo-booth tonkotsu ramen on your last night, customize everything down to the garlic.", { match: "Ichiran", cat: "food" }),
      ]),
    ],
  },
  {
    slug: "japan-golden-route-10",
    title: "Japan Golden Route",
    destination: "Tokyo → Osaka",
    country: "Japan",
    summary:
      "The classic first-timer's Japan: neon Tokyo, a night among Hakone's hot springs and Mt Fuji views, temple-rich Kyoto, a deer-filled afternoon in Nara and Osaka's street-food finale. Built for the 7-day JR Pass or a highway car.",
    coverImage: U("photo-1490806843957-31f4c9a91c65"),
    popularity: 1185,
    tags: ["roadtrip", "historical", "food", "culture", "city"],
    city: "Tokyo",
    plan: [
      d("Tokyo: old town east", [
        s("Senso-ji Temple", 35.7148, 139.7967, 90, "Tokyo's oldest temple, enter under the giant Kaminarimon lantern and follow the incense smoke.", { match: "Senso-ji" }),
        s("Nakamise-dori shopping street", 35.7119, 139.7964, 60, "Snack your way down the temple approach: ningyo-yaki cakes, senbei crackers and matcha soft serve.", { cat: "shopping" }),
        s("Tokyo Skytree", 35.7101, 139.8107, 90, "The 450m Tembo Galleria gives a Mt Fuji view on clear winter mornings.", { match: "Skytree" }),
        s("Tsukiji Outer Market", 35.6654, 139.7707, 90, "Street-food lunch at the old fish market: tamagoyaki skewers, uni bowls and knife shops.", { match: "Tsukiji", cat: "food" }),
      ]),
      d("Tokyo: shrines & Shibuya", [
        s("Meiji Shrine", 35.6764, 139.6993, 90, "A forest of 100,000 trees hides this Shinto shrine beside Harajuku, watch for a wedding procession.", { match: "Meiji" }),
        s("Takeshita Street, Harajuku", 35.6715, 139.7031, 60, "Tokyo's youth-fashion petri dish: crepes, cosplay shops and purikura photo booths.", { cat: "shopping" }),
        s("Shibuya Crossing & Hachiko", 35.6595, 139.7005, 60, "The world's busiest scramble, watch one light cycle from the Starbucks above, then dive in."),
        s("Shibuya Sky", 35.6584, 139.7022, 90, "Sunset rooftop 229m above the crossing; book the golden-hour slot ahead.", { match: "Shibuya Sky" }),
      ]),
      d("Tokyo: gardens & future", [
        s("Shinjuku Gyoen National Garden", 35.6852, 139.71, 100, "Three gardens in one (French, English, Japanese), the city's best picnic lawn.", { match: "Shinjuku Gyoen" }),
        s("teamLab Planets Tokyo", 35.6494, 139.7846, 100, "Wade knee-deep through digital koi ponds in this barefoot immersive art museum.", { match: "teamLab" }),
        s("Imperial Palace East Gardens", 35.6848, 139.756, 75, "Free gardens on the old Edo Castle grounds, moats, walls and a quiet breather downtown."),
        s("Omoide Yokocho, Shinjuku", 35.6938, 139.7005, 90, "Tiny post-war yakitori alleys under the tracks, shoulder-to-shoulder skewers and highballs.", { cat: "food" }),
      ]),
      d("Hakone: mountains & onsen", [
        s("Hakone Open-Air Museum", 35.2447, 139.0513, 120, "Sculpture park in a mountain valley with a Picasso pavilion and a stained-glass tower to climb.", { city: "Hakone" }),
        s("Owakudani Valley", 35.2436, 139.02, 75, "Ropeway over a steaming volcanic valley, eat a black sulfur-boiled egg for +7 years of life, they say.", { city: "Hakone" }),
        s("Lake Ashi & Hakone Shrine torii", 35.2047, 139.0256, 90, "Pirate-ship cruise across the lake to the red lakeside torii, with Fuji behind on clear days.", { city: "Hakone" }),
        s("Onsen evening at Hakone-Yumoto", 35.2324, 139.1069, 120, "Check into a ryokan or day onsen, soak in milky volcanic water before a kaiseki dinner.", { city: "Hakone" }),
      ]),
      d("To Kyoto: Fushimi & Gion", [
        s("Fushimi Inari Shrine", 34.9671, 135.7727, 150, "Ride the shinkansen to Kyoto, drop bags, then climb through 10,000 torii gates before the crowds.", { city: "Kyoto", match: "Fushimi Inari" }),
        s("Tofuku-ji Temple", 34.9766, 135.7737, 60, "A short hop north. Zen gardens and the Tsutenkyo bridge over a maple ravine.", { city: "Kyoto" }),
        s("Gion (Hanamikoji Street)", 35.0038, 135.7755, 75, "Dusk in the geisha district, preserved machiya facades and lanterns coming on.", { city: "Kyoto", match: "Gion" }),
        s("Pontocho Alley", 35.0054, 135.7712, 90, "Dinner in the narrow lantern alley along the Kamo River.", { city: "Kyoto", cat: "food" }),
      ]),
      d("Kyoto: Higashiyama", [
        s("Kiyomizu-dera", 34.9949, 135.785, 120, "Morning at the wooden stage temple; drink from the Otowa waterfall streams below.", { city: "Kyoto", match: "Kiyomizu" }),
        s("Sannenzaka & Ninenzaka lanes", 34.9976, 135.7808, 75, "Stone-stepped preserved streets, the loveliest walk in Kyoto with the Yasaka pagoda photobombing.", { city: "Kyoto" }),
        s("Yasaka Pagoda & Kennin-ji", 34.9986, 135.7793, 60, "The five-story Hokan-ji pagoda anchors old-town photos; Kennin-ji's twin-dragon ceiling is next door.", { city: "Kyoto" }),
        s("Nishiki Market", 35.0051, 135.7643, 90, "Late lunch grazing in 'Kyoto's Kitchen', try the tako tamago (candied octopus with a quail egg).", { city: "Kyoto", match: "Nishiki", cat: "food" }),
      ]),
      d("Kyoto: Arashiyama & gold", [
        s("Arashiyama Bamboo Grove", 35.017, 135.6713, 90, "Beat the buses: the bamboo grove before 8am is wind, creaking stalks and green light.", { city: "Kyoto", match: "Arashiyama" }),
        s("Tenryu-ji Temple", 35.031, 135.6738, 75, "UNESCO Zen garden at the grove's north gate, the borrowed-scenery centerpiece of Arashiyama.", { city: "Kyoto" }),
        s("Kinkaku-ji (Golden Pavilion)", 35.0394, 135.7292, 90, "Taxi or bus across town for the gold-leaf pavilion shimmering over its pond.", { city: "Kyoto", match: "Kinkaku" }),
        s("Ichiran Ramen", 35.0037, 135.7687, 60, "Solo-booth tonkotsu ramen downtown, a Kyoto ritual.", { city: "Kyoto", match: "Ichiran", cat: "food" }),
      ]),
      d("Nara day trip → Osaka", [
        s("Nara Deer Park", 34.6851, 135.843, 90, "Bow to the bowing deer (shika senbei crackers in hand) in the park around the great temples.", { city: "Nara", match: "Deer Park" }),
        s("Todai-ji Great Buddha", 34.6889, 135.8398, 90, "The world's largest wooden hall holds a 15m bronze Buddha, try squeezing through the pillar hole.", { city: "Nara", match: "Todai-ji" }),
        s("Kasuga Taisha", 34.6814, 135.8485, 60, "Thousands of mossy stone lanterns line the path to this vermilion shrine.", { city: "Nara", match: "Kasuga" }),
        s("Dotonbori Street Food Crawl", 34.6687, 135.5013, 120, "Evening in Osaka: takoyaki, kushikatsu and crab under the Glico running man.", { city: "Osaka", match: "Dotonbori", cat: "food" }),
      ]),
      d("Osaka: castle & retro town", [
        s("Osaka Castle", 34.6873, 135.5262, 120, "The reconstructed keep rises over moats and stone walls; the 8F lookout frames the skyline.", { city: "Osaka", match: "Osaka Castle" }),
        s("Kuromon Ichiba Market", 34.6654, 135.5065, 90, "'Osaka's kitchen', grilled scallops, wagyu skewers and strawberry daifuku for lunch.", { city: "Osaka", match: "Kuromon", cat: "food" }),
        s("Shinsekai & Tsutenkaku", 34.6525, 135.5063, 90, "Retro Osaka: the 1912 tower, kushikatsu alleys and the Billiken god of good fortune.", { city: "Osaka", match: "Shinsekai" }),
        s("Umeda Sky Building (Kuchu Teien)", 34.7053, 135.4897, 75, "Floating escalator to the open-air rooftop, the city's best sunset panorama.", { city: "Osaka", match: "Umeda Sky" }),
      ]),
      d("Osaka bay & departure", [
        s("Osaka Aquarium Kaiyukan", 34.6545, 135.4289, 150, "One of the world's great aquariums, spiraling down a tank with a whale shark.", { city: "Osaka", match: "Kaiyukan" }),
        s("Sumiyoshi Taisha", 34.613, 135.4933, 60, "One of Japan's oldest shrines, the steep arched Sorihashi bridge is pure postcard.", { city: "Osaka" }),
        s("Shinsaibashi & Amerikamura", 34.6726, 135.4999, 90, "Last-minute shopping in the covered arcade and Osaka's youth quarter before your flight.", { city: "Osaka", cat: "shopping" }),
      ]),
    ],
  },
  {
    slug: "paris-3",
    title: "Paris in 3 Days",
    destination: "Paris",
    country: "France",
    summary:
      "A long-weekend Paris that balances the icons with the neighborhoods: Louvre morning, Left Bank bookshops, a falafel in the Marais and Montmartre at golden hour. Days are walkable loops, not museum marathons.",
    coverImage: U("photo-1502602898657-3e91760cbb34"),
    popularity: 1095,
    tags: ["historical", "food", "art", "city"],
    city: "Paris",
    plan: [
      d("Icons of the Seine", [
        s("Louvre Museum", 48.8606, 2.3376, 180, "Enter via the Carrousel mall to skip the pyramid line; anchor on the Denon wing. Mona Lisa, Winged Victory.", { match: "Louvre" }),
        s("Tuileries Garden", 48.8635, 2.3275, 60, "Stroll the formal gardens toward Place de la Concorde, grab a green chair by the basin."),
        s("Sainte-Chapelle", 48.8554, 2.345, 60, "1,113 stained-glass panels turn the upper chapel into a jewel box, go on a sunny afternoon.", { match: "Sainte-Chapelle" }),
        s("Eiffel Tower Summit", 48.8584, 2.2945, 120, "Book the summit for last light; the tower sparkles for 5 minutes on the hour after dark.", { match: "Eiffel" }),
      ]),
      d("Left Bank & the Marais", [
        s("Musée d'Orsay", 48.86, 2.3266, 150, "Monet, Van Gogh and Degas inside a Beaux-Arts rail station, the clock-face café is a bonus.", { match: "Orsay" }),
        s("Luxembourg Gardens", 48.8462, 2.3372, 75, "Parisians' favorite park: sailboats on the basin, chess players and the Medici fountain."),
        s("Le Marais & Place des Vosges", 48.8556, 2.3655, 90, "Wander medieval lanes to Paris' oldest square, arcades, galleries and the Victor Hugo house."),
        s("L'As du Fallafel", 48.8574, 2.3593, 60, "The Rue des Rosiers institution, get the 'special' with eggplant and eat it on a bench.", { match: "Fallafel", cat: "food" }),
      ]),
      d("Montmartre & grand finale", [
        s("Sacré-Cœur & Montmartre", 48.8867, 2.3431, 120, "Climb to the white basilica for the panorama, then lose yourself in the village lanes behind it.", { match: "Sacré-Cœur" }),
        s("Place du Tertre", 48.8865, 2.3408, 60, "The painters' square, touristy, yes, but the surrounding Rue de l'Abreuvoir is Montmartre's prettiest corner."),
        s("Galeries Lafayette rooftop", 48.8738, 2.332, 60, "Free 7th-floor terrace with a postcard view over the Opéra to the Eiffel Tower.", { cat: "shopping" }),
        s("Seine dinner cruise from Pont Neuf", 48.8573, 2.341, 120, "See the lit-up monuments drift by, an unabashedly romantic last night.", { cat: "food" }),
      ]),
    ],
  },
  {
    slug: "rome-4",
    title: "Rome in 4 Days",
    destination: "Rome",
    country: "Italy",
    summary:
      "Ancient arenas, baroque fountains and four distinct neighborhoods, with a full Vatican morning and evenings in Trastevere and Monti. Built-in espresso and gelato stops keep the pace very Roman.",
    coverImage: U("photo-1552832230-c0197dd311b5"),
    popularity: 1048,
    tags: ["historical", "food", "art", "city"],
    city: "Rome",
    plan: [
      d("Ancient Rome", [
        s("Colosseum", 41.8902, 12.4922, 120, "Book the first timed entry; the arena floor and upper tiers frame the whole ancient city.", { match: "Colosseum" }),
        s("Roman Forum & Palatine Hill", 41.8925, 12.4853, 150, "Walk the Via Sacra among temples and basilicas, then climb the Palatine for the Circus Maximus view."),
        s("Piazza del Campidoglio", 41.8934, 12.4828, 45, "Michelangelo's trapezoid square on the Capitoline, the rear terrace overlooks the Forum for free."),
        s("Roscioli Salumeria con Cucina", 41.8942, 12.4733, 90, "Carbonara inside a deli, book ahead or queue at opening for the counter.", { match: "Roscioli", cat: "food" }),
      ]),
      d("Vatican & Trastevere", [
        s("Vatican Museums & Sistine Chapel", 41.9065, 12.4536, 180, "Go at opening or late entry; the Gallery of Maps and Raphael Rooms build to Michelangelo's ceiling.", { match: "Vatican" }),
        s("St. Peter's Basilica", 41.9022, 12.4539, 90, "Free entry to the world's largest church, climb the dome for the keyhole-square view."),
        s("Castel Sant'Angelo", 41.9031, 12.4663, 90, "Hadrian's tomb turned papal fortress; the terrace looks straight down the angel bridge."),
        s("Trastevere evening", 41.8897, 12.4695, 120, "Golden-hour lanes, aperitivo on Piazza di Santa Maria and dinner in a candlelit osteria.", { cat: "food" }),
      ]),
      d("Centro storico", [
        s("Pantheon", 41.8986, 12.4768, 60, "The 2,000-year-old concrete dome with its open oculus, still the largest of its kind.", { match: "Pantheon" }),
        s("Piazza Navona", 41.8992, 12.4731, 45, "Bernini's Fountain of the Four Rivers anchors Rome's most theatrical square."),
        s("Trevi Fountain", 41.9009, 12.4833, 45, "Toss a coin over your left shoulder to guarantee a return, go early or very late.", { match: "Trevi" }),
        s("Spanish Steps & Pincio Terrace", 41.9059, 12.4823, 75, "Climb the steps, window-shop Via Condotti, then watch sunset over Piazza del Popolo from the Pincio."),
      ]),
      d("Borghese & local Rome", [
        s("Galleria Borghese", 41.9142, 12.4921, 120, "Bernini's Apollo and Daphne and Caravaggios in a villa of marble, the 2-hour slot must be booked ahead."),
        s("Villa Borghese gardens", 41.9125, 12.486, 60, "Rent a rowboat on the little lake or cycle the shaded avenues of Rome's central park."),
        s("Testaccio Market", 41.8789, 12.4754, 90, "Lunch where Romans lunch: supplì, porchetta and trapizzino in a working-class market hall.", { cat: "food" }),
        s("Aperitivo in Monti", 41.8953, 12.4903, 90, "Rome's village-in-the-city, vintage shops, then a spritz on Piazza della Madonna dei Monti.", { cat: "food" }),
      ]),
    ],
  },
];

TEMPLATES.push(
  {
    slug: "italy-classics-9",
    title: "Italy Classics: Rome, Florence & Venice",
    destination: "Rome → Venice",
    country: "Italy",
    summary:
      "Nine days linking Italy's three great art cities by train or car, ancient Rome, Renaissance Florence with a Pisa detour, and canal-laced Venice. Museum-heavy mornings, long lazy lunches, golden-hour viewpoints.",
    coverImage: U("photo-1523906834658-6e24ef2386f9"),
    popularity: 980,
    tags: ["roadtrip", "historical", "food", "art"],
    city: "Rome",
    plan: [
      d("Rome: ancient core", [
        s("Colosseum", 41.8902, 12.4922, 120, "Timed entry to the Flavian Amphitheatre, the upper ring gives the best context over the Forum.", { match: "Colosseum" }),
        s("Roman Forum & Palatine Hill", 41.8925, 12.4853, 150, "The heart of the empire: temples, triumphal arches and the emperors' hilltop palaces."),
        s("Pantheon", 41.8986, 12.4768, 60, "Step under the 2,000-year-old dome. Raphael is buried here.", { match: "Pantheon" }),
        s("Roscioli Salumeria con Cucina", 41.8942, 12.4733, 90, "Deli-counter carbonara worth booking days ahead.", { match: "Roscioli", cat: "food" }),
      ]),
      d("Rome: Vatican", [
        s("Vatican Museums & Sistine Chapel", 41.9065, 12.4536, 180, "Early slot, headphones off, straight to the Sistine before looping back for the Raphael Rooms.", { match: "Vatican" }),
        s("St. Peter's Basilica", 41.9022, 12.4539, 90, "Michelangelo's Pietà and the baldachin, climb the dome if legs allow."),
        s("Castel Sant'Angelo", 41.9031, 12.4663, 75, "Riverside fortress with the angel statue and a rooftop café over the Tiber."),
        s("Trastevere evening", 41.8897, 12.4695, 120, "Cross Ponte Sisto for aperitivo and dinner in Rome's prettiest tangle of lanes.", { cat: "food" }),
      ]),
      d("Rome: fountains & steps", [
        s("Trevi Fountain", 41.9009, 12.4833, 45, "Early morning coin toss before the crowds stack three deep.", { match: "Trevi" }),
        s("Spanish Steps", 41.9059, 12.4823, 45, "The Rococo staircase up to Trinità dei Monti, wisteria season is the dream."),
        s("Piazza Navona", 41.8992, 12.4731, 45, "Bernini vs Borromini in travertine; coffee with a fountain view costs more, worth it once."),
        s("Giolitti", 41.901, 12.4773, 45, "Rome's oldest gelateria, the 'coppa Giolitti' is basically dessert architecture.", { match: "Giolitti", cat: "food" }),
      ]),
      d("Florence: arrival & icons", [
        s("Florence Duomo & Brunelleschi's Dome", 43.7731, 11.256, 120, "Train in, drop bags, climb the 463 steps between the dome's shells for Vasari's frescoes up close.", { city: "Florence", match: "Duomo" }),
        s("Piazza della Signoria", 43.7696, 11.2558, 45, "An open-air sculpture gallery. Neptune, the Loggia dei Lanzi and a David copy guarding Palazzo Vecchio.", { city: "Florence" }),
        s("Ponte Vecchio", 43.768, 11.2531, 45, "The medieval goldsmiths' bridge; walk to Ponte Santa Trinita for the classic photo of it.", { city: "Florence" }),
        s("All'Antico Vinaio", 43.768, 11.2579, 60, "The world's most-queued schiacciata, 'La Favolosa' with cream cheese and porchetta.", { city: "Florence", match: "Vinaio", cat: "food" }),
      ]),
      d("Florence: art day", [
        s("Uffizi Gallery", 43.7678, 11.2553, 150, "Botticelli's Birth of Venus and Primavera in the first hours; terrace coffee over the Piazza.", { city: "Florence", match: "Uffizi" }),
        s("Accademia & Michelangelo's David", 43.7767, 11.2592, 90, "The real David, the Prisoners' unfinished marble straining toward it is half the story.", { city: "Florence" }),
        s("San Lorenzo Market", 43.7764, 11.253, 60, "Leather stalls outside, lampredotto tripe sandwiches upstairs in the Mercato Centrale.", { city: "Florence", cat: "shopping" }),
        s("Piazzale Michelangelo", 43.7629, 11.2651, 75, "Sunset over the Duomo and the Arno, bring a bottle of Chianti and join the steps.", { city: "Florence", match: "Piazzale Michelangelo" }),
      ]),
      d("Pisa detour → Venice", [
        s("Leaning Tower of Pisa", 43.723, 10.3966, 90, "Climb the tilted bell tower, the lean is genuinely unsettling on the spiral steps.", { city: "Pisa" }),
        s("Piazza dei Miracoli & Pisa Cathedral", 43.7228, 10.3955, 60, "The 'Field of Miracles', baptistery acoustics and striped-marble cathedral on the green lawn.", { city: "Pisa" }),
        s("Drive/rail to Venice", 45.4408, 12.3155, 120, "Afternoon transfer across the Apennines and the lagoon causeway, first spritz on arrival.", { city: "Venice" }),
      ]),
      d("Venice: San Marco", [
        s("St. Mark's Basilica", 45.4345, 12.3397, 75, "Gold-mosaic Byzantine interior, book skip-the-line and add the Pala d'Oro.", { city: "Venice" }),
        s("Doge's Palace", 45.4336, 12.3403, 120, "Cross the Bridge of Sighs from the council chambers to the prison cells.", { city: "Venice" }),
        s("Rialto Bridge & Market", 45.438, 12.3358, 75, "Morning fish-and-produce market by the Grand Canal's oldest bridge.", { city: "Venice" }),
        s("Grand Canal vaporetto ride", 45.4361, 12.333, 60, "Line 1 from end to end at golden hour, the cheapest gondola substitute in town.", { city: "Venice" }),
      ]),
      d("Venice: lagoon islands", [
        s("Murano glass workshops", 45.4589, 12.3521, 90, "Watch a master pull a prancing horse from molten glass in 90 seconds.", { city: "Venice" }),
        s("Burano", 45.4854, 12.4174, 120, "Fishermen's cottages in paint-box colors and handmade lace, lunch on risotto di gò.", { city: "Venice" }),
        s("Cannaregio cicchetti crawl", 45.4438, 12.327, 120, "Bacaro-hopping along Fondamenta della Misericordia: spritz and cicchetti standing at the bar.", { city: "Venice", cat: "food" }),
      ]),
      d("Venice: Dorsoduro & farewell", [
        s("Gallerie dell'Accademia", 45.4313, 12.3281, 120, "Venetian masters from Bellini to Titian in a former convent.", { city: "Venice", match: "Accademia" }),
        s("Santa Maria della Salute", 45.4308, 12.3346, 45, "The great baroque dome at the Grand Canal's mouth, the Punta della Dogana view is steps away.", { city: "Venice" }),
        s("Squero di San Trovaso", 45.4305, 12.3256, 45, "Peek into one of the last working gondola boatyards from the Zattere promenade.", { city: "Venice" }),
      ]),
    ],
  },
  {
    slug: "barcelona-4",
    title: "Barcelona in 4 Days",
    destination: "Barcelona",
    country: "Spain",
    summary:
      "Gaudí's dreamscape, Gothic Quarter lanes, market lunches and a beach day with Montjuïc views, four days that move from Eixample grandeur to seaside ease. Evenings are for tapas crawls.",
    coverImage: U("photo-1583422409516-2895a77efded"),
    popularity: 935,
    tags: ["art", "food", "beach", "city"],
    city: "Barcelona",
    plan: [
      d("Gaudí & the Eixample", [
        s("Sagrada Família", 41.4036, 2.1744, 120, "Book the first tower slot, morning light through the nativity-facade glass is unreal.", { match: "Sagrada" }),
        s("Casa Batlló", 41.3916, 2.1649, 90, "The dragon-scaled house on Passeig de Gràcia; the immersive Gaudí Cube finale is a trip.", { match: "Batlló" }),
        s("Casa Milà (La Pedrera)", 41.3953, 2.1619, 75, "The quarry-wave facade and a rooftop of warrior chimneys framing the Sagrada."),
        s("Tapas crawl on Carrer de Blai", 41.3732, 2.1605, 120, "Pintxos for a euro or two each along Poble-sec's best street, hop bars, don't settle.", { cat: "food" }),
      ]),
      d("Gothic Quarter & Born", [
        s("Picasso Museum", 41.3853, 2.1809, 120, "The master's formative years in five medieval palaces, the Las Meninas series is the peak.", { match: "Picasso" }),
        s("Barcelona Cathedral", 41.3839, 2.1762, 60, "Gothic nave, 13 geese in the cloister and a rooftop lift for quarter views."),
        s("Santa Maria del Mar & El Born", 41.3837, 2.182, 75, "The sailors' basilica, then browse the Born's indie boutiques and vermouth bars."),
        s("La Boqueria Market", 41.3817, 2.1718, 90, "Grab a counter stool at El Quim or Bar Pinotxo, the seafood comes straight off the ice.", { match: "Boqueria", cat: "food" }),
      ]),
      d("Park Güell & Gràcia", [
        s("Park Güell", 41.4145, 2.1527, 120, "Timed entry to the mosaic terrace and dragon staircase, walk up through the viaduct paths.", { match: "Güell" }),
        s("Gràcia village squares", 41.4019, 2.1584, 90, "Lunch and a vermouth on Plaça de la Virreina. Barcelona's village-within-the-city.", { cat: "food" }),
        s("Casa Vicens", 41.4035, 2.1506, 60, "Gaudí's first house: Moorish tiles and a palm-leaf iron gate, freshly restored."),
        s("Bunkers del Carmel sunset", 41.4181, 2.1617, 90, "Civil-war bunkers turned sunset amphitheatre: 360° from sea to Collserola. Bring snacks."),
      ]),
      d("Sea & Montjuïc", [
        s("Barceloneta Beach", 41.3784, 2.19, 120, "Morning swim and a walk past the leaning W Hotel sail; coffee on the boardwalk."),
        s("Port Vell & Columbus Monument", 41.3757, 2.1777, 60, "The old harbor with wooden schooners and the Rambla de Mar swing bridge."),
        s("Montjuïc & Magic Fountain", 41.3713, 2.1517, 150, "Cable car to the castle, MNAC's Romanesque frescoes, then the light-and-water fountain show."),
        s("Farewell paella by the beach", 41.3805, 2.1875, 90, "Arroz negro or fideuà with feet almost in the sand, sobremesa included.", { cat: "food" }),
      ]),
    ],
  },
);

TEMPLATES.push(
  {
    slug: "spain-highlights-9",
    title: "Spain Highlights: Madrid to Seville",
    destination: "Madrid → Seville",
    country: "Spain",
    summary:
      "Nine days across Castile and Andalusia, the Prado and royal Madrid, a Toledo day trip, Córdoba's Mezquita, two nights under the Alhambra and flamenco-lit Seville, with white-town Ronda to finish.",
    coverImage: U("photo-1539037116277-4db20889f2d4"),
    popularity: 845,
    tags: ["roadtrip", "historical", "food", "art"],
    city: "Madrid",
    plan: [
      d("Madrid: art & old town", [
        s("Prado Museum", 40.4138, -3.6921, 150, "Velázquez's Las Meninas and Goya's Black Paintings, go at opening, focus on one wing.", { city: "Madrid" }),
        s("Retiro Park", 40.4153, -3.6845, 75, "Rowboats on the Estanque and the glass Palacio de Cristal. Madrid's green lung.", { city: "Madrid" }),
        s("Plaza Mayor & Puerta del Sol", 40.4155, -3.7074, 60, "The Habsburg square, then the bear-and-madroño statue at kilometer zero.", { city: "Madrid" }),
        s("Mercado de San Miguel", 40.4154, -3.7088, 90, "Gourmet tapas hall, croquetas, vermouth on tap and oysters by the dozen.", { city: "Madrid", cat: "food" }),
      ]),
      d("Madrid: royal quarter", [
        s("Royal Palace of Madrid", 40.4179, -3.7143, 120, "3,418 rooms of Bourbon opulence; the armory and Stradivarius quartet are highlights.", { city: "Madrid" }),
        s("Almudena Cathedral", 40.416, -3.7146, 45, "The modern-Gothic cathedral opposite the palace, the crypt is surprisingly lovely.", { city: "Madrid" }),
        s("Gran Vía", 40.4203, -3.7058, 60, "Madrid's Broadway, early skyscrapers, flagship stores and rooftop cocktail bars.", { city: "Madrid", cat: "shopping" }),
        s("Temple of Debod", 40.424, -3.7178, 60, "A 2nd-century BC Egyptian temple, gifted to Spain, glowing at sunset over Casa de Campo.", { city: "Madrid" }),
      ]),
      d("Toledo day trip", [
        s("Toledo Cathedral", 39.857, -4.0236, 90, "Spain's primate cathedral. El Greco's Disrobing of Christ hangs in the sacristy.", { city: "Toledo" }),
        s("Alcázar of Toledo", 39.8581, -4.0206, 75, "The fortress on the city's highest point with the army museum inside.", { city: "Toledo" }),
        s("Jewish Quarter & El Tránsito", 39.8558, -4.0297, 75, "Synagogues and marzipan shops in the lanes that gave Toledo its 'three cultures' fame.", { city: "Toledo" }),
        s("Mirador del Valle", 39.852, -4.0294, 45, "The panorama El Greco painted, the whole walled city across the Tagus.", { city: "Toledo" }),
      ]),
      d("Córdoba", [
        s("Mezquita-Catedral", 37.8789, -4.7794, 120, "A forest of 856 red-and-white arches with a Renaissance nave erupting through the middle.", { city: "Córdoba" }),
        s("Jewish Quarter & Calleja de las Flores", 37.88, -4.778, 60, "Whitewashed lanes, patios spilling geraniums and the famous flower alley framing the bell tower.", { city: "Córdoba" }),
        s("Alcázar de los Reyes Cristianos", 37.877, -4.782, 75, "Mudéjar gardens of fountains and orange trees where Columbus pitched his voyage.", { city: "Córdoba" }),
        s("Salmorejo dinner in the Judería", 37.879, -4.779, 90, "Córdoba's cold tomato cream with jamón, try it with a Montilla-Moriles wine.", { city: "Córdoba", cat: "food" }),
      ]),
      d("Granada: the Alhambra", [
        s("Alhambra & Nasrid Palaces", 37.176, -3.5881, 180, "Book Nasrid entry weeks ahead, the Court of the Lions is the summit of Moorish art.", { city: "Granada", match: "Alhambra" }),
        s("Generalife Gardens", 37.1767, -3.5853, 75, "The sultans' summer palace, water stairs, cypress walks and views back to the Alhambra.", { city: "Granada" }),
        s("Mirador de San Nicolás", 37.1811, -3.5925, 60, "Sunset across the ravine as the Alhambra turns rose-gold with the Sierra Nevada behind.", { city: "Granada" }),
        s("Tapas in the Realejo", 37.1745, -3.5945, 90, "Granada keeps the free-tapa-with-every-drink faith, hop three bars and call it dinner.", { city: "Granada", cat: "food" }),
      ]),
      d("Granada: Albaicín & Sacromonte", [
        s("Granada Cathedral & Royal Chapel", 37.1761, -3.5992, 75, "Isabella and Ferdinand lie here, beside the chapel's Flemish art collection.", { city: "Granada" }),
        s("Albaicín lanes", 37.1794, -3.594, 90, "Get lost in the old Moorish quarter, cármenes, tea houses and sudden Alhambra views.", { city: "Granada" }),
        s("Sacromonte caves & flamenco", 37.1834, -3.5875, 120, "Evening zambra in a whitewashed cave, raw, stamping, unforgettable flamenco.", { city: "Granada" }),
      ]),
      d("Seville: cathedral & Alcázar", [
        s("Seville Cathedral & Giralda", 37.3861, -5.9925, 120, "The world's largest Gothic cathedral; ramp up the Giralda bell tower for the panorama.", { city: "Seville" }),
        s("Real Alcázar of Seville", 37.3838, -5.9903, 150, "Mudéjar patios of lace-like plasterwork and the gardens where Dorne was filmed.", { city: "Seville" }),
        s("Barrio Santa Cruz", 37.3846, -5.99, 75, "Orange-blossom lanes of the old Jewish quarter, aimless wandering is the point.", { city: "Seville" }),
        s("Tapas at El Rinconcillo", 37.3899, -5.9902, 90, "Seville's oldest bar (1670), espinacas con garbanzos standing at the zinc counter.", { city: "Seville", cat: "food" }),
      ]),
      d("Seville: plaza & Triana", [
        s("Plaza de España", 37.3772, -5.9869, 75, "The 1929 expo semicircle, row the canal, then find your province in tiled alcoves.", { city: "Seville" }),
        s("María Luisa Park", 37.3747, -5.9888, 60, "Shady promenades and tiled fountains behind the plaza, perfect siesta terrain.", { city: "Seville" }),
        s("Triana & ceramics quarter", 37.3827, -6.002, 90, "Cross the Isabel II bridge to the potters' barrio, azulejo workshops and riverside bars.", { city: "Seville" }),
        s("Metropol Parasol", 37.3932, -5.9919, 60, "The 'mushrooms' walkway at dusk, then dinner in the market below.", { city: "Seville" }),
      ]),
      d("Ronda & farewell", [
        s("Puente Nuevo, Ronda", 36.7408, -5.1659, 90, "The 120m bridge over El Tajo gorge, walk down to the viewpoint below for the full drama.", { city: "Ronda" }),
        s("Ronda old town & bullring", 36.737, -5.1646, 90, "Spain's oldest bullring (1785) and clifftop gardens of the Ciudad quarter.", { city: "Ronda" }),
        s("Return to Madrid/Seville", 37.3891, -5.9823, 180, "Drive or train back through Andalusian olive country for your flight home.", { city: "Seville" }),
      ]),
    ],
  },
  {
    slug: "portugal-6",
    title: "Portugal: Lisbon to Porto",
    destination: "Lisbon → Porto",
    country: "Portugal",
    summary:
      "Six days through Portugal's two great cities with a fairy-tale Sintra day between them, miradouros and custard tarts in Lisbon, port cellars and river light in Porto. An easy rail or coastal drive link.",
    coverImage: "/cover-lisbon.jpg",
    popularity: 890,
    tags: ["roadtrip", "food", "historical", "city"],
    city: "Lisbon",
    plan: [
      d("Lisbon: Alfama & the castle", [
        s("Castelo de São Jorge", 38.7139, -9.1335, 100, "Start at the Moorish castle walls for the city's defining red-roof panorama.", { match: "Castelo" }),
        s("Alfama Sunrise Walk", 38.7115, -9.1257, 90, "Drift down through Alfama's laundry-strung lanes, fado drifts out of doorways by night.", { match: "Alfama" }),
        s("Lisbon Cathedral (Sé)", 38.7098, -9.1326, 45, "The fortress-like 12th-century cathedral; tram 28 rattles right past the door."),
        s("Time Out Market", 38.7072, -9.1458, 90, "Two dozen of Lisbon's best chefs under one market roof, perfect first-night grazing.", { match: "Time Out", cat: "food" }),
      ]),
      d("Belém", [
        s("Jerónimos Monastery", 38.6979, -9.206, 100, "Manueline stone-lace cloisters. Portugal's Age of Discovery at its most confident.", { match: "Jerónimos" }),
        s("Belém Tower", 38.6916, -9.216, 60, "The river-guard tower where caravels departed, go early to climb the tight spiral stair.", { match: "Belém Tower" }),
        s("Monument to the Discoveries", 38.6936, -9.2057, 45, "The prow of stone navigators; the world-map mosaic below plots every voyage."),
        s("Pastéis de Belém", 38.6979, -9.2032, 60, "The 1837 original, warm custard tarts with cinnamon and icing sugar, eaten standing.", { match: "Pastéis", cat: "food" }),
      ]),
      d("Lisbon: Baixa to Alcântara", [
        s("Praça do Comércio", 38.7075, -9.1364, 45, "The grand riverfront square rebuilt after the 1755 earthquake, coffee at Martinho da Arcada."),
        s("Santa Justa Lift & Chiado", 38.7121, -9.1394, 75, "Eiffel's pupil built this iron elevator; browse Chiado's bookshops and the ruins of Carmo."),
        s("LX Factory", 38.7034, -9.1787, 100, "Industrial-chic creative village under the bridge. Ler Devagar bookstore is a cathedral of print.", { match: "LX Factory", cat: "shopping" }),
        s("Cervejaria Ramiro", 38.7206, -9.1351, 120, "The seafood beer-hall legend: garlic shrimp, scarlet prawns and a steak sandwich to finish.", { match: "Ramiro", cat: "food" }),
      ]),
      d("Sintra day trip", [
        s("Pena Palace", 38.7876, -9.3906, 120, "The Romanticist candy-color palace in the clouds, book the first slot and walk the park.", { city: "Sintra" }),
        s("Moorish Castle, Sintra", 38.7926, -9.3893, 75, "Snake along the 9th-century ramparts with the best view of Pena's turrets.", { city: "Sintra" }),
        s("Quinta da Regaleira", 38.7963, -9.396, 90, "Descend the Initiation Well's spiral into tunnels. Sintra's most magical garden.", { city: "Sintra" }),
        s("Cabo da Roca", 38.7805, -9.499, 60, "Mainland Europe's westernmost point, wind, cliffs and a lighthouse at the edge of the map.", { city: "Sintra", match: "Cabo da Roca" }),
      ]),
      d("Porto: center", [
        s("Livraria Lello", 41.1469, -8.6148, 60, "The neo-Gothic bookshop with the crimson staircase (a Potter inspiration), timed tickets.", { city: "Porto", match: "Lello" }),
        s("Clérigos Tower", 41.1457, -8.6146, 60, "Climb the baroque bell tower's 225 steps for Porto's terracotta sprawl.", { city: "Porto", match: "Clérigos" }),
        s("São Bento Station", 41.1454, -8.6105, 30, "20,000 azulejo tiles turn the vestibule into a blue-and-white history book.", { city: "Porto" }),
        s("Ribeira riverside", 41.1407, -8.6117, 90, "Tumble-down pastel facades, rabelo boats and dinner across the water in Gaia.", { city: "Porto", cat: "food" }),
      ]),
      d("Porto: port wine & viewpoints", [
        s("Caves Cálem Port Cellars", 41.1359, -8.6128, 90, "Cellar tour and tasting in Gaia, learn your ruby from your tawny where it's aged.", { city: "Porto", match: "Cálem" }),
        s("Dom Luís I Bridge", 41.1399, -8.6094, 45, "Walk the upper deck beside the metro for the vertigo-classic Douro view.", { city: "Porto" }),
        s("Serra do Pilar viewpoint", 41.1382, -8.6065, 45, "The monastery terrace is Porto's golden-hour money shot, the whole Ribeira below.", { city: "Porto" }),
        s("Francesinha dinner", 41.1462, -8.613, 90, "Porto's decadent layered sandwich drowned in beer sauce, share one, trust us.", { city: "Porto", cat: "food" }),
      ]),
    ],
  },
  {
    slug: "london-4",
    title: "London in 4 Days",
    destination: "London",
    country: "United Kingdom",
    summary:
      "A first-timer's London in four neighborhood loops. Westminster icons, the City's towers, world-class free museums and the royal parks. Pub lunches and market grazing built in.",
    coverImage: U("photo-1513635269975-59663e0ac1ad"),
    popularity: 872,
    tags: ["historical", "art", "food", "city"],
    city: "London",
    plan: [
      d("Westminster icons", [
        s("Westminster Abbey", 51.4994, -0.1273, 100, "Coronations since 1066 and Poets' Corner, the verger tours are worth it."),
        s("Big Ben & Houses of Parliament", 51.5007, -0.1246, 45, "The Elizabeth Tower from Westminster Bridge, then along Whitehall past Downing Street."),
        s("London Eye", 51.5033, -0.1195, 60, "One slow rotation over the Thames, book ahead; golden hour is the money slot."),
        s("Covent Garden", 51.5117, -0.124, 90, "Street performers in the piazza, Neal's Yard color and dinner in the market building.", { cat: "food" }),
      ]),
      d("The City & the Tower", [
        s("Tower of London", 51.5081, -0.0759, 150, "Yeoman Warder tour, the Crown Jewels and 1,000 years of grim royal history.", { match: "Tower of London" }),
        s("Tower Bridge", 51.5055, -0.0754, 60, "Walk the glass-floored high-level walkways between the Victorian towers."),
        s("St. Paul's Cathedral", 51.5138, -0.0984, 90, "Whisper into the dome's gallery wall, then climb 528 steps to the Golden Gallery."),
        s("Borough Market", 51.5055, -0.091, 90, "Lunch at London's oldest food market, the salt-beef sandwich and a cider at the communal tables.", { match: "Borough", cat: "food" }),
      ]),
      d("Museum mile", [
        s("British Museum", 51.5194, -0.127, 150, "Rosetta Stone, Parthenon marbles and the Sutton Hoo helmet, free, vast, pick two galleries.", { match: "British Museum" }),
        s("National Gallery", 51.5089, -0.1283, 120, "Van Gogh's Sunflowers and Turner's seascapes on Trafalgar Square, free entry."),
        s("Trafalgar Square", 51.508, -0.1281, 30, "Lions, Nelson's Column and the Fourth Plinth's rotating art."),
        s("Dishoom Shoreditch", 51.5246, -0.0774, 100, "Bombay-Irani café nostalgia, the black daal and a bacon naan roll live up to the queue.", { match: "Dishoom", cat: "food" }),
      ]),
      d("Royal London & Notting Hill", [
        s("Buckingham Palace & Changing of the Guard", 51.5014, -0.1419, 90, "Arrive by 10:30 for a front-row view of the guard change (check ceremony days)."),
        s("Hyde Park & Kensington Gardens", 51.5073, -0.1657, 90, "Stroll past the Serpentine to the Albert Memorial and the Italian Gardens."),
        s("Portobello Road Market", 51.5175, -0.2054, 120, "Antiques on Saturdays, vintage every day. Notting Hill's pastel terraces frame it.", { match: "Portobello", cat: "shopping" }),
        s("Farewell pub dinner", 51.5125, -0.1315, 90, "A Sunday roast (any day) and a pint in a Victorian corner local, the proper goodbye.", { cat: "food" }),
      ]),
    ],
  },
);

TEMPLATES.push(
  {
    slug: "scotland-nc500-5",
    title: "Scotland: Highlands & NC500 Lite",
    destination: "Edinburgh → Skye",
    country: "United Kingdom",
    summary:
      "Five days from Edinburgh's castle rock into the Highlands. Loch Ness, the Applecross pass, Skye's alien ridgelines and a Glen Coe finale. A distilled North Coast 500 for drivers short on time.",
    coverImage: U("photo-1506377585622-bedcbb027afc"),
    popularity: 768,
    tags: ["roadtrip", "adventure", "nature", "historical"],
    city: "Edinburgh",
    plan: [
      d("Edinburgh", [
        s("Edinburgh Castle", 55.9486, -3.1999, 120, "The fortress on the volcanic rock. Honours of Scotland and the one o'clock gun.", { match: "Edinburgh Castle" }),
        s("Royal Mile", 55.9505, -3.1883, 90, "Closes, wynds and St Giles' Cathedral down the spine of the Old Town."),
        s("National Museum of Scotland", 55.9469, -3.19, 90, "Free museum. Dolly the sheep, Lewis chessmen and a rooftop terrace.", { match: "National Museum" }),
        s("Makars Mash Bar", 55.9499, -3.1931, 90, "Haggis (or veggie haggis) over gourmet mash. Scottish comfort food done right.", { match: "Makars", cat: "food" }),
      ]),
      d("Edinburgh → Inverness", [
        s("Arthur's Seat", 55.9441, -3.1618, 90, "An extinct volcano in the city center: 45 minutes up for the Firth of Forth panorama.", { match: "Arthur's Seat" }),
        s("Pitlochry & whisky stop", 56.7045, -3.7297, 90, "Break the drive north with a distillery tasting at Blair Athol or a stroll by the dam fish ladder."),
        s("Cairngorms viewpoint", 57.1167, -3.6666, 60, "Stretch your legs among heather moors and ancient Caledonian pines."),
        s("Inverness riverside & castle", 57.4763, -4.2255, 75, "Evening walk along the Ness islands and up to the red-sandstone castle viewpoint."),
      ]),
      d("Loch Ness & the Applecross pass", [
        s("Urquhart Castle, Loch Ness", 57.3243, -4.4245, 90, "Ruined keep on the loch's edge, the classic Nessie-hunting vantage."),
        s("Bealach na Bà (Pass of the Cattle)", 57.4272, -5.728, 90, "Britain's greatest single-track road: hairpins up 626m with Skye views from the top."),
        s("Applecross Inn", 57.4338, -5.8096, 90, "Legendary whitewashed seafood pub, langoustines landed yards away, when the weather allows.", { cat: "food" }),
        s("Over the sea to Skye", 57.274, -5.5162, 120, "Drive to Kyle of Lochalsh and cross the Skye Bridge past Eilean Donan's silhouette."),
      ]),
      d("Isle of Skye", [
        s("Eilean Donan Castle", 57.274, -5.5162, 75, "Scotland's most photographed castle on its tidal islet, go early for the mirror shot."),
        s("Old Man of Storr", 57.5071, -6.1831, 120, "Hike up to the rock pinnacle through Trotternish's landslip amphitheatre."),
        s("Portree harbour", 57.4125, -6.196, 75, "Pastel cottages around the harbor, fish and chips on the pier wall.", { cat: "food" }),
        s("Fairy Pools, Glen Brittle", 57.2506, -6.2581, 90, "Crystal-blue pools and waterfalls under the Black Cuillin, brave souls wild-swim."),
      ]),
      d("Glen Coe & return", [
        s("Glen Coe viewpoint", 56.668, -4.986, 75, "Scotland's most dramatic glen, the Three Sisters loom over the A82 lay-bys."),
        s("Loch Lomond stop", 56.083, -4.566, 90, "Southbound through Loch Lomond & The Trossachs, a final loch-side leg-stretch."),
        s("Return to Edinburgh", 55.9533, -3.1883, 180, "Drive back via Callander for one last Highland coffee before the city lights."),
      ]),
    ],
  },
  {
    slug: "iceland-ring-7",
    title: "Iceland Ring Road in 7 Days",
    destination: "Reykjavik → Ring Road",
    country: "Iceland",
    summary:
      "The full Route 1 loop in a week. Golden Circle geysers, south-coast waterfalls and black beaches, a glacier lagoon, east fjords, the north's volcanic wonderland and a lagoon soak to finish. Summer daylight or winter aurora, same road.",
    coverImage: "/cover-reykjavik.jpg",
    popularity: 912,
    tags: ["roadtrip", "adventure", "nature"],
    city: "Reykjavik",
    plan: [
      d("Reykjavik", [
        s("Hallgrímskirkja Tower", 64.1417, -21.9266, 60, "Ride up the basalt-column church tower for the rainbow-roof city view.", { match: "Hallgrímskirkja" }),
        s("Harpa Concert Hall", 64.1502, -21.9326, 45, "Olafur Eliasson's glass honeycomb on the harbor, free to wander inside."),
        s("Sun Voyager (Sólfar)", 64.1476, -21.9222, 30, "The steel dream-ship sculpture pointing at Mount Esja across the bay."),
        s("Bæjarins Beztu Pylsur", 64.1482, -21.9378, 45, "Iceland's famous hot dog stand, get one 'eina með öllu' (with everything).", { match: "Bæjarins", cat: "food" }),
      ]),
      d("Golden Circle", [
        s("Þingvellir National Park", 64.2559, -21.1299, 90, "Walk between the North American and Eurasian plates where the world's oldest parliament met.", { match: "Þingvellir" }),
        s("Geysir & Strokkur", 64.3104, -20.3024, 60, "Strokkur erupts 20m every 6–10 minutes, stand upwind for the photo, downwind for the shower."),
        s("Gullfoss", 64.3271, -20.1199, 60, "The two-tier 'Golden Falls' thunders into a canyon; rainbows on sunny afternoons."),
        s("Kerið crater", 64.0413, -20.8851, 45, "A 3,000-year-old red volcanic crater with a milky-blue lake, quick loop around the rim."),
      ]),
      d("South coast waterfalls", [
        s("Seljalandsfoss", 63.6156, -19.9886, 60, "The waterfall you can walk behind, waterproofs essential, the path is a shower."),
        s("Skógafoss", 63.5321, -19.5114, 75, "A perfect 60m curtain of water; climb the 527 steps for the highland-river view.", { city: "Vík", match: "Skógafoss" }),
        s("Reynisfjara Black Beach", 63.4055, -19.0708, 75, "Basalt columns and sea stacks on a black-sand beach, respect the sneaker waves, always.", { city: "Vík", match: "Reynisfjara" }),
        s("Dyrhólaey Arch", 63.4028, -19.1265, 60, "The cliff-top arch and puffin lookout (May–Aug) over the endless black coast.", { city: "Vík", match: "Dyrhólaey" }),
      ]),
      d("Glacier lagoon", [
        s("Skaftafell & Svartifoss", 64.0231, -16.9753, 120, "Hike to the basalt-organ waterfall in Vatnajökull National Park; glacier tongues all around."),
        s("Jökulsárlón Glacier Lagoon", 64.0784, -16.2306, 90, "Blue icebergs drift past seals toward the sea, amphibious boat tours run in summer."),
        s("Diamond Beach", 64.0447, -16.1777, 45, "Ice chunks scattered on black sand like scattered crystal, sunrise is magical."),
        s("Höfn langoustine dinner", 64.2538, -15.2122, 90, "Iceland's langoustine capital, the creamy humarsúpa (lobster soup) is the order.", { cat: "food" }),
      ]),
      d("East fjords to the north", [
        s("Seyðisfjörður", 65.2599, -14.0101, 90, "The rainbow-road fjord town of artists and waterfalls, coffee at the blue church."),
        s("Dettifoss", 65.8147, -16.3845, 75, "Europe's most powerful waterfall, the ground literally trembles at the east-bank viewpoint."),
        s("Mývatn Nature Baths", 65.6308, -16.8479, 120, "Soak in milky geothermal water among pseudocraters, the north's Blue Lagoon, minus crowds."),
      ]),
      d("North Iceland", [
        s("Goðafoss", 65.6828, -17.5502, 60, "The 'Waterfall of the Gods', a perfect 30m-wide horseshoe of glacial blue."),
        s("Akureyri", 65.6826, -18.0907, 90, "Iceland's northern capital: botanical gardens, red-heart traffic lights and a harbor lunch.", { cat: "food" }),
        s("Húsavík whale watching", 66.045, -17.3383, 180, "Europe's whale capital, humpbacks bubble-feed in Skjálfandi Bay on traditional oak boats."),
      ]),
      d("Snæfellsnes & farewell soak", [
        s("Kirkjufell", 64.9399, -23.3068, 75, "The 'arrowhead mountain' with its twin waterfalls. Iceland's most photographed peak."),
        s("Drive back to Reykjavik", 64.1466, -21.9426, 210, "Scenic return along the coast with Hraunfossar lava-field waterfalls en route."),
        s("Sky Lagoon", 64.12, -21.93, 150, "Farewell soak in the infinity-edge lagoon, the 7-step ritual ends in the cold North Atlantic mist.", { match: "Sky Lagoon" }),
      ]),
    ],
  },
);

TEMPLATES.push(
  {
    slug: "norway-fjords-7",
    title: "Norway Fjords in 7 Days",
    destination: "Bergen → Ålesund",
    country: "Norway",
    summary:
      "A week among the western fjords. Bergen's wharf, the Flåm railway, Geiranger's hairpin viewpoints, Trollstigen's curves and Ålesund's Art Nouveau turrets. Ferries and tunnels make it a seamless loop.",
    coverImage: U("photo-1516571748831-5d81767b788d"),
    popularity: 733,
    tags: ["roadtrip", "adventure", "nature"],
    city: "Bergen",
    plan: [
      d("Bergen", [
        s("Bryggen Wharf", 60.3973, 5.3233, 90, "UNESCO Hanseatic warehouses leaning over the harbor, duck into the crooked alleyways."),
        s("Fløibanen & Mount Fløyen", 60.3944, 5.3283, 90, "Funicular to the 320m summit, the whole fjord-framed city lies below."),
        s("Bergen Fish Market (Fisketorget)", 60.3954, 5.3267, 90, "Lunch on the quay: fish soup, whale salami for the curious, and fresh shrimp by the bag.", { cat: "food" }),
      ]),
      d("Hardangerfjord", [
        s("Steinsdalsfossen", 60.3766, 6.02, 45, "Walk behind the curtain of this roadside waterfall near Norheimsund."),
        s("Eidfjord & Hardangerfjord", 60.4673, 7.0697, 90, "Drive the orchard-lined fjord, in May the hillsides are white with apple blossom."),
        s("Vøringsfossen", 60.4272, 7.2506, 75, "A 182m plunge into the Måbødalen canyon with a new stepped viewing bridge."),
      ]),
      d("Flåm & the Nærøyfjord", [
        s("Flåm Railway (Flåmsbana)", 60.8635, 7.1133, 120, "One of the world's steepest rail lines: 20km of waterfalls down from Myrdal."),
        s("Stegastein Viewpoint", 60.9079, 7.2122, 60, "The 30m platform jutting 650m above the Aurlandsfjord."),
        s("Nærøyfjord cruise to Gudvangen", 60.8452, 7.0297, 120, "Silent-electric ferry down the UNESCO fjord: 1,700m walls on either side."),
      ]),
      d("To Geiranger", [
        s("Loen Skylift", 61.8994, 6.8422, 90, "Cable car to 1,011m above the Nordfjord, suspension bridge and via ferrata up top."),
        s("Jostedalsbreen glacier arm", 61.6456, 7.1067, 90, "Walk to the blue ice of Briksdalsbreen or Nigardsbreen, arms of mainland Europe's largest glacier."),
        s("Geirangerfjord arrival", 62.1049, 7.0752, 75, "Descend the Eagle Road (Ørnevegen) hairpins into Geiranger as cruise ships twinkle below."),
      ]),
      d("Geirangerfjord", [
        s("Flydalsjuvet", 62.1163, 7.192, 45, "The classic cliff-edge photo over the fjord and its tiny cruise ships."),
        s("Geirangerfjord waterfall cruise", 62.1094, 7.0947, 120, "Sail past the Seven Sisters and the Suitor, waterfalls on a cathedral scale."),
        s("Dalsnibba & Geiranger Skywalk", 62.0487, 7.2689, 90, "At 1,500m, Europe's highest fjord viewpoint from a road, snow poles line the route."),
      ]),
      d("Trollstigen & Ålesund", [
        s("Trollstigen (Troll's Ladder)", 62.4559, 7.6692, 90, "Eleven hairpins up the cliff beside the Stigfossen falls, the viewing platform floats over the drop."),
        s("Ålesund Art Nouveau walk", 62.4722, 6.1495, 90, "Rebuilt in Jugendstil after the 1904 fire, turrets and dragons on every facade."),
        s("Aksla viewpoint", 62.4745, 6.1641, 60, "418 steps from the town park to the classic Ålesund-and-islands panorama at sunset."),
      ]),
      d("Atlantic Ocean Road & farewell", [
        s("Atlanterhavsvegen (Atlantic Ocean Road)", 63.017, 7.355, 90, "Eight bridges hopping islets at the ocean's edge, storm-watching or summer sparkle."),
        s("Kristiansund harbor", 63.1105, 7.7279, 75, "Clipfish (bacalao) lunch in the old cod-drying port, the Sundbåten ferry has run since 1876.", { cat: "food" }),
        s("Return to Bergen", 60.3913, 5.3221, 240, "Coastal drive back south (or one-way rental to Ålesund airport) for your flight home."),
      ]),
    ],
  },
  {
    slug: "swiss-alps-6",
    title: "Swiss Alps in 6 Days",
    destination: "Zurich → Zermatt",
    country: "Switzerland",
    summary:
      "Six days from lake cities to the high Alps. Lucerne's wooden bridges, Pilatus and the Jungfrau region's waterfall valley, ending under the Matterhorn in car-free Zermatt. A Swiss Travel Pass covers every leg.",
    coverImage: U("photo-1527668752968-14dc70a27c95"),
    popularity: 701,
    tags: ["adventure", "nature", "relaxing"],
    city: "Zurich",
    plan: [
      d("Zurich", [
        s("Zurich Old Town & Lindenhof", 47.373, 8.541, 90, "Roman hilltop square, guild houses and the twin towers of the Grossmünster."),
        s("Lake Zurich promenade", 47.366, 8.541, 75, "Swans, swimmers and the Alps on the horizon, join locals for a lakeside stroll."),
        s("Bahnhofstrasse & Confiserie Sprüngli", 47.3758, 8.5391, 60, "Window-shop the grand avenue, then Luxemburgerli macarons at the 1836 confectioner.", { cat: "shopping" }),
        s("Fondue dinner in the Old Town", 47.3723, 8.5428, 100, "A caquelon of molten Gruyère and Vacherin, the only correct first night in Switzerland.", { cat: "food" }),
      ]),
      d("Lucerne", [
        s("Chapel Bridge (Kapellbrücke)", 47.0517, 8.3075, 60, "The 14th-century covered bridge with painted roof panels, beside the octagonal Water Tower.", { city: "Lucerne" }),
        s("Lion Monument", 47.0583, 8.3106, 45, "The dying lion carved into sandstone. Mark Twain called it the world's saddest sculpture.", { city: "Lucerne" }),
        s("Lake Lucerne cruise", 47.05, 8.31, 120, "Paddle-steamer past Wagner's villa and fjord-like bays to Alpnachstad.", { city: "Lucerne" }),
        s("Musegg Wall towers", 47.0557, 8.3014, 60, "Walk the medieval ramparts, climb the Zyt tower for roofs-and-lake views.", { city: "Lucerne" }),
      ]),
      d("Mount Pilatus", [
        s("Pilatus Golden Round Trip", 46.979, 8.2546, 240, "Boat, world's-steepest cogwheel up 2,073m, dragon-trail summit paths, then cable car down to Kriens.", { city: "Lucerne" }),
        s("Fräkmüntegg alpine fun", 46.9885, 8.24, 90, "Switzerland's longest summer toboggan run and a rope park halfway down the mountain.", { city: "Lucerne" }),
        s("Old Town dinner, Lucerne", 47.0533, 8.3047, 90, "Rösti and local Älplermagronen in a frescoed guild hall.", { city: "Lucerne", cat: "food" }),
      ]),
      d("Interlaken & Lake Brienz", [
        s("Harder Kulm", 46.6976, 7.8501, 90, "Interlaken's home mountain, the Two-Lakes Bridge viewing platform over the Brienzersee.", { city: "Interlaken" }),
        s("Höhematte & Interlaken town", 46.6863, 7.8632, 60, "The grand meadow where paragliders land between two emerald lakes.", { city: "Interlaken" }),
        s("Giessbach Falls & Lake Brienz cruise", 46.7353, 8.0247, 120, "Cruise the turquoise lake to the 500m cascade beside the grand 1874 hotel.", { city: "Interlaken" }),
      ]),
      d("Lauterbrunnen valley", [
        s("Staubbach Falls", 46.592, 7.9088, 45, "A 297m free-falling veil right at the valley's edge, climb the path behind the spray.", { city: "Lauterbrunnen" }),
        s("Trümmelbach Falls", 46.569, 7.9147, 90, "Ten glacier-fed waterfalls thundering inside the mountain, reached by tunnel lift.", { city: "Lauterbrunnen" }),
        s("Mürren car-free village", 46.5594, 7.8922, 90, "Cable car up to the cliff-edge hamlet facing the Eiger, Mönch and Jungfrau.", { city: "Lauterbrunnen" }),
        s("Schilthorn (Piz Gloria)", 46.5572, 7.8352, 120, "The revolving Bond restaurant at 2,970m with a 200-peak panorama.", { city: "Lauterbrunnen" }),
      ]),
      d("Zermatt & the Matterhorn", [
        s("Gornergrat railway", 45.9833, 7.7847, 180, "Cogwheel to 3,089m, the Matterhorn fills the window while 29 four-thousanders ring the horizon.", { city: "Zermatt" }),
        s("Matterhorn Glacier Paradise", 45.9384, 7.7299, 120, "Europe's highest cable-car station (3,883m) with an ice palace inside the glacier.", { city: "Zermatt" }),
        s("Zermatt village & Hinterdorf", 46.0207, 7.7491, 75, "Wander the old larch-wood barns on stone mushrooms, then raclette for a farewell dinner.", { city: "Zermatt", cat: "food" }),
      ]),
    ],
  },
);

TEMPLATES.push(
  {
    slug: "greece-athens-islands-8",
    title: "Greece: Athens & the Islands",
    destination: "Athens → Crete",
    country: "Greece",
    summary:
      "Eight days of antiquity and Aegean blue, the Acropolis at opening time, a ferry to Santorini's caldera villages, then Crete's Minoan palaces and pink-sand lagoons. Ferries double as sightseeing.",
    coverImage: U("photo-1613395877344-13d4a8e0d49e"),
    popularity: 825,
    tags: ["historical", "beach", "food", "relaxing"],
    city: "Athens",
    plan: [
      d("Athens: the Acropolis", [
        s("Acropolis of Athens", 37.9715, 23.7267, 150, "Enter at 8am through the Propylaea, the Parthenon glows honey-colored before the heat and crowds.", { match: "Acropolis of Athens" }),
        s("Acropolis Museum", 37.9685, 23.7284, 120, "The glass-floored museum facing the rock, the Parthenon Gallery reunites the frieze.", { match: "Acropolis Museum" }),
        s("Ancient Agora & Temple of Hephaestus", 37.975, 23.7224, 90, "Socrates' stomping ground with Greece's best-preserved Doric temple."),
        s("O Thanasis", 37.9754, 23.7268, 75, "Monastiraki institution for pork gyros and kebabs, fast, loud, perfect.", { match: "Thanasis", cat: "food" }),
      ]),
      d("Athens: city & sunset", [
        s("National Archaeological Museum", 37.9891, 23.732, 150, "The Mask of Agamemnon and the Antikythera mechanism, the world's greatest Greek collection.", { match: "National Archaeological" }),
        s("Plaka & Anafiotika", 37.9722, 23.7276, 90, "Island-style whitewashed lanes hidden on the Acropolis' north slope."),
        s("Syntagma & Changing of the Guard", 37.9754, 23.7348, 45, "Evzones in pom-pom clogs perform the slow-motion ceremony before the Parliament."),
        s("Lycabettus Hill", 37.9838, 23.743, 75, "Funicular or zigzag path to Athens' highest point, sunset over a sea of rooftops to the Saronic Gulf."),
      ]),
      d("Ferry to Santorini", [
        s("Morning ferry, Athinios arrival", 36.386, 25.427, 180, "Sail the caldera route, the first view of the white villages stacked on black cliffs is from the deck."),
        s("Fira caldera walk", 36.4166, 25.4324, 90, "Cliff-path from Fira toward Imerovigli, blue domes at every turn."),
        s("Ammoudi Bay", 36.4616, 25.3719, 90, "300 steps below Oia, cliff-jumpers, red rock and fish tavernas at water level.", { cat: "food" }),
        s("Oia Village sunset", 36.4618, 25.3753, 90, "The famous sunset from the castle ruins, stake out a spot by 6pm.", { city: "Santorini", match: "Oia" }),
      ]),
      d("Santorini: south coast", [
        s("Akrotiri Archaeological Site", 36.3513, 25.4037, 90, "The 'Minoan Pompeii', a 3,600-year-old town preserved in volcanic ash.", { city: "Santorini", match: "Akrotiri" }),
        s("Red Beach", 36.3486, 25.3965, 90, "Crimson cliffs over dark sand, a short scramble from Akrotiri.", { city: "Santorini", match: "Red Beach" }),
        s("Santo Wines caldera terrace", 36.3847, 25.4423, 90, "Assyrtiko tasting flight on the island's biggest cliff-edge winery terrace.", { cat: "food" }),
        s("Perissa black sand beach", 36.3562, 25.4688, 120, "Afternoon swim under the Mesa Vouno rock, beach bars with loungers for the price of a drink."),
      ]),
      d("Santorini: villages & catamaran", [
        s("Imerovigli & Skaros Rock", 36.4327, 25.423, 90, "Scramble onto the fortress rock for the caldera's quietest panorama."),
        s("Pyrgos village", 36.3829, 25.4496, 75, "The island's old capital, monastery views and lanes untouched by the cruise crowds."),
        s("Caldera catamaran cruise", 36.394, 25.443, 300, "Half-day sail to the hot springs and volcano with a grilled-seafood lunch aboard at sunset."),
      ]),
      d("Crete: Knossos & Heraklion", [
        s("Palace of Knossos", 35.2979, 25.1631, 120, "Ferry/flight to Crete, then the Minoan labyrinth of the Minotaur legend, go early.", { city: "Heraklion" }),
        s("Heraklion Archaeological Museum", 35.3382, 25.1369, 90, "The Phaistos Disc and bull-leaping frescoes, essential context for Knossos.", { city: "Heraklion" }),
        s("Heraklion harbor & Koules fortress", 35.3447, 25.1369, 60, "Venetian arsenal and fortress guarding the old port, seaside taverna dinner after.", { city: "Heraklion", cat: "food" }),
      ]),
      d("Crete: Chania", [
        s("Old Venetian Harbor, Chania", 35.5195, 24.0167, 90, "The lighthouse curve and dockside cafés. Crete's prettiest harbor.", { city: "Chania" }),
        s("Chania Old Town lanes", 35.5138, 24.018, 90, "Leather workshops and bougatsa bakeries in the Venetian and Ottoman quarters.", { city: "Chania", cat: "shopping" }),
        s("Balos Lagoon", 35.5797, 23.5888, 240, "Day trip to the turquoise lagoon where three seas meet, boat from Kissamos or the dirt-road hike.", { city: "Chania" }),
      ]),
      d("Return to Athens", [
        s("Fly/ferry back to Athens", 37.9838, 23.7275, 180, "Morning crossing or short hop back to the mainland."),
        s("Monastiraki flea market", 37.9764, 23.7252, 75, "Rummage for komboloi beads, vinyl and icons in the lanes off Avissynias Square.", { cat: "shopping" }),
        s("Rooftop dinner with Acropolis view", 37.975, 23.7255, 120, "Moussaka and a carafe of retsina as the Parthenon lights up, the Greek farewell.", { cat: "food" }),
      ]),
    ],
  },
  {
    slug: "croatia-7",
    title: "Croatia: Split to Dubrovnik",
    destination: "Split → Dubrovnik",
    country: "Croatia",
    summary:
      "Seven days island-hopping down Dalmatia. Diocletian's palace-living city, Hvar's lavender light, Korčula's little-Dubrovnik lanes and oyster stops on the Pelješac before the walled finale. Ferries or a coastal drive.",
    coverImage: U("photo-1555990793-da11153b2473"),
    popularity: 689,
    tags: ["roadtrip", "beach", "historical", "food"],
    city: "Split",
    plan: [
      d("Split: the living palace", [
        s("Diocletian's Palace", 43.5081, 16.4402, 150, "A Roman emperor's retirement palace that IS the old town, peristyle, cellars and Jupiter's temple."),
        s("Riva promenade", 43.5075, 16.4394, 60, "Coffee on the palm-lined waterfront watching ferries slide in and out."),
        s("Marjan Hill viewpoints", 43.511, 16.4225, 90, "Pine-shaded stairs to the Telegrin lookout over the palace roofs and islands."),
        s("Konoba dinner in Varoš", 43.509, 16.4392, 90, "Peka (slow-baked octopus under the iron bell) in a stone-walled tavern, order ahead.", { cat: "food" }),
      ]),
      d("Krka & Trogir day trip", [
        s("Krka National Park (Skradinski Buk)", 43.8046, 15.965, 150, "Boardwalks over a staircase of travertine waterfalls an hour inland."),
        s("Trogir old town", 43.5167, 16.2517, 90, "A tiny UNESCO island-town. Romanesque cathedral portal and gelato on the riva."),
      ]),
      d("Hvar", [
        s("Hvar Fortica (Spanish Fortress)", 43.173, 16.44, 90, "Morning climb to the citadel over the harbor, the Pakleni Islands scatter below."),
        s("Hvar town square & arsenal", 43.1725, 16.4411, 75, "One of Europe's oldest public theaters inside the arsenal on the marble piazza."),
        s("Pakleni Islands swim", 43.1642, 16.41, 180, "Water-taxi to Palmižana's pine-backed coves for an afternoon of Adriatic swimming."),
      ]),
      d("Korčula", [
        s("Korčula old town", 42.9587, 17.135, 120, "A herringbone-planned mini-Dubrovnik on a peninsula, climb the Revelin tower."),
        s("Marco Polo house & St. Mark's Cathedral", 42.9602, 17.1356, 60, "The explorer's alleged birthplace beside the Gothic-Renaissance cathedral."),
        s("Lumbarda beach & GRK wine", 42.923, 17.17, 150, "Sandy bay and the white GRK grape that grows only here, tasting at a family winery.", { cat: "food" }),
      ]),
      d("Pelješac peninsula & Ston", [
        s("Ston city walls", 42.8386, 17.6961, 90, "The 'European Great Wall': 5.5km of 14th-century fortifications over the salt pans."),
        s("Ston oyster tasting", 42.8378, 17.6975, 75, "Oysters farmed in Mali Ston Bay since Roman times, pulled out and shucked for you.", { cat: "food" }),
        s("Dingač wine road", 42.85, 17.55, 90, "Plavac Mali vines on 45° slopes plunging to the sea, stop at any roadside konoba cellar.", { cat: "food" }),
      ]),
      d("Dubrovnik: the walls", [
        s("Dubrovnik City Walls", 42.6408, 18.1082, 150, "The full 2km circuit right at 8am opening, terracotta roofs on one side, open Adriatic on the other."),
        s("Fort Lovrijenac", 42.6404, 18.1041, 60, "The 37m cliff fort guarding the western approach. King's Landing exterior shots."),
        s("Stradun & Old Port", 42.641, 18.1104, 90, "The limestone main street from Pile Gate to the Rector's Palace and harbor."),
        s("Buža cliff bar", 42.6393, 18.1072, 75, "Drinks through a hole in the wall on rocks above the sea, sunset swimmers below.", { cat: "food" }),
      ]),
      d("Dubrovnik: heights & islands", [
        s("Mount Srđ cable car", 42.6492, 18.11, 90, "The war-history museum and the classic Old Town panorama from 412m."),
        s("Lokrum island", 42.6276, 18.1197, 180, "Fifteen minutes by boat, peacocks, a dead-sea salt lake and monastery ruins."),
        s("Banje Beach", 42.6413, 18.1163, 90, "Final swim with the city walls as your backdrop, the postcard earned."),
      ]),
    ],
  },
);

TEMPLATES.push(
  {
    slug: "turkey-8",
    title: "Turkey: Istanbul & Cappadocia",
    destination: "Istanbul → Cappadocia",
    country: "Turkey",
    summary:
      "Eight days from minaret-studded Istanbul to Cappadocia's fairy chimneys. Hagia Sophia and bazaars, a Bosphorus cruise, then balloons at dawn over lunar valleys and a night in a cave hotel.",
    coverImage: U("photo-1570939274717-7eda259b50ed"),
    popularity: 812,
    tags: ["historical", "food", "adventure"],
    city: "Istanbul",
    plan: [
      d("Sultanahmet icons", [
        s("Hagia Sophia Grand Mosque", 41.0086, 28.98, 100, "1,500 years of church-mosque-museum history under the floating dome.", { match: "Hagia Sophia" }),
        s("Blue Mosque", 41.0054, 28.9768, 60, "Six minarets and 20,000 İznik tiles, visit outside prayer times."),
        s("Basilica Cistern (Yerebatan Sarnıcı)", 41.0082, 28.9781, 60, "336 columns and two Medusa heads in the cathedral-like Byzantine reservoir.", { match: "Basilica Cistern" }),
        s("Topkapi Palace", 41.0115, 28.9834, 150, "Ottoman sultans' home for 400 years, the Harem and the Bosphorus-view terrace.", { match: "Topkapi" }),
      ]),
      d("Bazaars & mosques", [
        s("Grand Bazaar", 41.0107, 28.968, 120, "4,000 shops under painted vaults, haggle for ceramics, then tea at a hani courtyard.", { cat: "shopping" }),
        s("Süleymaniye Mosque", 41.0161, 28.9639, 60, "Sinan's masterpiece with the city's most peaceful courtyard view over the Golden Horn."),
        s("Spice Bazaar (Mısır Çarşısı)", 41.0165, 28.9706, 75, "Pyramids of saffron, Turkish delight and pistachios, sample before you buy.", { match: "Spice Bazaar", cat: "food" }),
        s("Karaköy Güllüoğlu", 41.0246, 28.9773, 60, "Istanbul's baklava benchmark, get the pistachio with kaymak cream.", { match: "Güllüoğlu", cat: "food" }),
      ]),
      d("Bosphorus", [
        s("Dolmabahçe Palace", 41.0391, 29.0005, 120, "The sultans' 19th-century European fantasy, a 4.5-ton crystal staircase on the Bosphorus."),
        s("Ortaköy", 41.0472, 29.0269, 75, "Kumpir (stuffed baked potato) by the water under the first Bosphorus bridge.", { cat: "food" }),
        s("Bosphorus cruise", 41.0253, 28.9747, 120, "Public ferry to the second bridge and back. Ottoman yalı mansions drift by on both shores."),
        s("Galata Tower & Istiklal", 41.0256, 28.9744, 90, "Up the 1348 Genoese tower, then down the nostalgic-tram avenue for meze dinner."),
      ]),
      d("Asian side → Cappadocia", [
        s("Kadıköy market", 40.9902, 29.0244, 120, "Ferry to Asia for the food market, pickles, olives, cheese and the legendary Çiya kebaps.", { cat: "food" }),
        s("Maiden's Tower from Üsküdar", 41.0211, 29.0041, 60, "Tea on the Salacak seawall with the little tower island floating mid-Bosphorus."),
        s("Fly to Cappadocia", 38.7704, 35.4954, 180, "Evening flight to Kayseri/Nevşehir and transfer to your Göreme cave hotel."),
        s("Göreme sunset point", 38.6435, 34.8303, 60, "First fairy-chimney panorama as the valleys turn rose and gold.", { city: "Göreme" }),
      ]),
      d("Cappadocia: balloons & Göreme", [
        s("Hot air balloon sunrise", 38.6431, 34.8289, 180, "A hundred balloons lifting into dawn over the valleys, book for your FIRST morning as backup.", { city: "Göreme" }),
        s("Göreme Open-Air Museum", 38.6397, 34.8458, 120, "Byzantine cave churches with 1,000-year-old frescoes cut into the rock.", { city: "Göreme" }),
        s("Uçhisar Castle", 38.631, 34.8053, 75, "Climb the region's highest fairy chimney for the 360° moonscape.", { city: "Göreme" }),
        s("Avanos pottery workshop", 38.715, 34.8467, 90, "Kick-wheel pottery from red Kızılırmak clay, try a pot, ship the result home.", { city: "Göreme", cat: "shopping" }),
      ]),
      d("Cappadocia: valleys", [
        s("Pasabag (Monks Valley)", 38.6575, 34.8581, 75, "The most surreal mushroom-capped fairy chimneys, with hermit cells inside.", { city: "Göreme" }),
        s("Devrent (Imagination) Valley", 38.665, 34.895, 60, "Spot the camel, the dolphin and Napoleon in wind-sculpted rock."),
        s("Love Valley hike", 38.6594, 34.807, 120, "Afternoon walk among the giant stone pillars, trailhead near Göreme.", { city: "Göreme" }),
        s("Testi kebab dinner", 38.643, 34.829, 90, "Clay-pot kebab cracked open at your table in a Göreme garden restaurant.", { city: "Göreme", cat: "food" }),
      ]),
      d("Underground cities", [
        s("Kaymaklı Underground City", 38.4607, 34.7522, 90, "Descend eight levels into a city that sheltered thousands, mind the low tunnels."),
        s("Ihlara Valley hike", 38.245, 34.3, 150, "A green canyon walk past rock-cut churches along the Melendiz River."),
        s("Selime Monastery", 38.3, 34.27, 75, "The cathedral-sized cave complex at the canyon's end. Star Wars terrain (almost filmed here)."),
      ]),
      d("Return to Istanbul", [
        s("Fly back to Istanbul", 41.0082, 28.9784, 180, "Morning flight back for a final Ottoman afternoon."),
        s("Arasta Bazaar", 41.003, 28.977, 60, "Calmer artisan shopping behind the Blue Mosque, ceramics and textiles without the crush.", { cat: "shopping" }),
        s("Farewell hammam & rooftop dinner", 41.0056, 28.9779, 150, "Steam and scrub in a historic hammam, then meze overlooking the lit minarets.", { cat: "food" }),
      ]),
    ],
  },
  {
    slug: "egypt-6",
    title: "Egypt: Cairo & Luxor",
    destination: "Cairo → Luxor",
    country: "Egypt",
    summary:
      "Six days through 5,000 years, the Giza pyramids and the Grand Egyptian Museum, medieval Cairo's bazaars and citadel, then Luxor's temple avenues and the Valley of the Kings at dawn.",
    coverImage: U("photo-1503177119275-0aa32b3a9368"),
    popularity: 655,
    tags: ["historical", "adventure", "food"],
    city: "Cairo",
    plan: [
      d("Giza", [
        s("Pyramids of Giza & the Sphinx", 29.9792, 31.1342, 180, "Khufu, Khafre and Menkaure with the Sphinx guarding the plateau, go at opening, camel photo optional.", { match: "Pyramids of Giza" }),
        s("Grand Egyptian Museum", 30.0089, 31.1197, 180, "Tutankhamun's full treasure in the world's largest archaeology museum, a mile from the pyramids.", { match: "Grand Egyptian" }),
        s("Koshary Abou Tarek", 30.0502, 31.2384, 60, "Egypt's beloved carb mountain, rice, lentils, pasta and crispy onions in spicy tomato sauce.", { match: "Koshary", cat: "food" }),
      ]),
      d("Islamic Cairo", [
        s("Khan el-Khalili", 30.0477, 31.2622, 120, "The 600-year-old bazaar, brass lamps, spices and mint tea at El Fishawy café.", { match: "Khan el-Khalili" }),
        s("Citadel & Muhammad Ali Mosque", 30.0287, 31.2599, 120, "Saladin's fortress with the alabaster mosque and a haze-of-minarets city panorama."),
        s("Al-Azhar Park", 30.041, 31.265, 75, "Cairo's green miracle on a former dump, lakeside walk at golden hour."),
        s("Zooba (Zamalek)", 30.0634, 31.2215, 75, "Elevated Egyptian street food, ta'ameya, hawawshi and hibiscus everything.", { match: "Zooba", cat: "food" }),
      ]),
      d("Old Cairo & the Nile", [
        s("Egyptian Museum, Tahrir", 30.0478, 31.2336, 150, "The pink 1902 palace of pharaonic overflow, royal mummies and Yuya & Thuyu's gold."),
        s("Coptic Cairo & Hanging Church", 30.0059, 31.2301, 90, "Churches and a synagogue over the Roman Babylon Fort. Cairo's oldest quarter."),
        s("Nile felucca at sunset", 30.039, 31.229, 90, "A lateen-sailed boat drifting past the Corniche as the city turns amber."),
      ]),
      d("Luxor: east bank", [
        s("Fly to Luxor", 25.6872, 32.6396, 120, "One-hour morning flight south, check in near the corniche."),
        s("Karnak Temple Complex", 25.7188, 32.6573, 150, "The Great Hypostyle Hall's 134 papyrus columns, the largest religious site ever built.", { city: "Luxor", match: "Karnak" }),
        s("Luxor Temple", 25.6995, 32.6391, 90, "Ramses II's colossi and the avenue of sphinxes, floodlit and magical after dark.", { city: "Luxor", match: "Luxor Temple" }),
        s("Al-Sahaby Lane Restaurant", 25.7012, 32.6394, 75, "Rooftop tagines beside the temple, the Sahaby family has run it for generations.", { city: "Luxor", match: "Sahaby", cat: "food" }),
      ]),
      d("Luxor: west bank", [
        s("Hot air balloon over the west bank", 25.719, 32.632, 150, "Dawn flight over temples and tomb valleys as the Nile turns silver below.", { city: "Luxor" }),
        s("Valley of the Kings", 25.7402, 32.6014, 150, "Descend into three painted royal tombs, add Tutankhamun's or Seti I's for the full wow.", { city: "Luxor", match: "Valley of the Kings" }),
        s("Temple of Hatshepsut", 25.7382, 32.6065, 90, "The female pharaoh's terraced temple carved against the Theban cliffs.", { city: "Luxor" }),
        s("Colossi of Memnon", 25.7206, 32.6105, 30, "Two 18m seated guardians alone in the fields, free, five minutes, thousand-yard stares.", { city: "Luxor" }),
      ]),
      d("Nile south: Edfu & Aswan", [
        s("Edfu Temple", 24.978, 32.8734, 90, "Drive south to Egypt's best-preserved temple, the falcon god Horus in full Ptolemaic glory."),
        s("Kom Ombo Temple", 24.4521, 32.9283, 75, "The double temple of Sobek and Horus over the Nile, with mummified crocodiles in the museum."),
        s("Philae Temple, Aswan", 24.0253, 32.8843, 120, "Boat out to the island temple of Isis, rescued stone by stone from the rising lake."),
        s("Fly back to Cairo", 30.0444, 31.2357, 150, "Evening flight north, final pyramids-at-distance glimpse from the window seat."),
      ]),
    ],
  },
);

TEMPLATES.push(
  {
    slug: "morocco-7",
    title: "Morocco: Marrakech & the Sahara",
    destination: "Marrakech → Merzouga",
    country: "Morocco",
    summary:
      "Seven days from the red city's souks over the High Atlas to the Sahara. Aït Benhaddou's mud-brick ksar, Todra's canyon and a night in an Erg Chebbi desert camp under ridiculous stars.",
    coverImage: "/cover-marrakech.jpg",
    popularity: 745,
    tags: ["roadtrip", "adventure", "food", "historical"],
    city: "Marrakech",
    plan: [
      d("Marrakech medina", [
        s("Ben Youssef Madrasa", 31.6322, -7.9861, 75, "The 14th-century Quranic college, cedar, stucco and zellij around a mirror-still courtyard.", { match: "Ben Youssef" }),
        s("Medina Spice Souk", 31.6295, -7.986, 75, "Pyramids of cumin and ras el hanout in Rahba Kedima square, smell your way through.", { match: "Spice Souk", cat: "shopping" }),
        s("Bahia Palace", 31.6214, -7.9825, 75, "The grand vizier's 19th-century palace of painted ceilings and orange-tree courtyards.", { match: "Bahia" }),
        s("Jemaa el-Fnaa at Dusk", 31.6258, -7.9891, 120, "The great square ignites: drummers, storytellers and a hundred grills, eat at stall 31.", { match: "Jemaa el-Fnaa" }),
      ]),
      d("Marrakech gardens & coffee", [
        s("Jardin Majorelle", 31.6417, -8.0033, 90, "Cobalt-blue villa and cactus garden restored by Yves Saint Laurent, first slot of the day.", { match: "Majorelle" }),
        s("Saadian Tombs", 31.6171, -7.9887, 60, "The gilded 16th-century necropolis hidden behind the Kasbah mosque for 300 years."),
        s("Bacha Coffee House", 31.6314, -7.9945, 75, "1910 palace serving 200 coffees in silver pots, the queue is part of the theatre.", { match: "Bacha", cat: "food" }),
        s("Nomad Rooftop", 31.6316, -7.9866, 90, "Modern Moroccan lunch over the spice square, the lamb burger and date cake.", { match: "Nomad", cat: "food" }),
      ]),
      d("Atlas Mountains: Ourika", [
        s("Ourika Valley", 31.35, -7.7833, 120, "An hour into the High Atlas, walnut groves and Berber villages along the river."),
        s("Setti Fatma waterfalls", 31.2989, -7.6883, 150, "Scramble up the seven falls with a local guide, pools for a bracing dip."),
        s("Berber village lunch", 31.32, -7.75, 90, "Tagine and mint tea on a riverside terrace. Monday's souk fills the whole village.", { cat: "food" }),
      ]),
      d("Over the Tizi n'Tichka", [
        s("Aït Benhaddou", 31.047, -7.1319, 120, "The UNESCO mud-brick ksar on the old caravan route. Gladiator and Game of Thrones both filmed here."),
        s("Atlas Studios, Ouarzazate", 30.9335, -6.8969, 75, "Tour the sets of 'Hollywood of Africa'. Egyptian temples and Tibetan palaces in the desert."),
        s("Skoura palm oasis", 31.06, -6.57, 75, "Kasbah Amridil rising from 300,000 date palms, the postcard on the 50-dirham note."),
      ]),
      d("Dades & Todra gorges", [
        s("Dades Gorges switchbacks", 31.514, -5.995, 75, "The famous 'monkey fingers' rock and hairpin road, stop at the top viewpoint café."),
        s("Todra Gorge", 31.59, -5.592, 90, "Walk the canyon floor between 300m orange walls that narrow to 10m apart."),
        s("Drive to Merzouga", 31.08, -4.01, 180, "East across the Tafilalet as the first dunes of Erg Chebbi glow on the horizon."),
      ]),
      d("Sahara: Erg Chebbi", [
        s("Camel trek into the dunes", 31.145, -3.98, 180, "Sunset caravan into the 150m dunes, silence, sand and a sky on fire."),
        s("Sandboarding & 4x4 dune tour", 31.15, -3.97, 120, "Board down the big dune, visit a nomad family and hunt fossils in the hamada."),
        s("Desert camp night", 31.16, -3.96, 240, "Drumming around the fire, Berber tagine and the Milky Way from your tent's doorstep."),
      ]),
      d("Return to Marrakech", [
        s("Draa Valley & Agdz", 30.695, -6.447, 90, "Back west along Morocco's longest river, kasbahs above a ribbon of palms."),
        s("Cross the Atlas", 31.286, -7.38, 240, "The Tizi n'Tichka pass (2,260m) one more time, coffee at the summit cooperative."),
        s("Final night in the medina", 31.6258, -7.9891, 120, "Last mint tea on a rooftop as Jemaa el-Fnaa fires up below, ma'a salama, Morocco.", { cat: "food" }),
      ]),
    ],
  },
  {
    slug: "jordan-5",
    title: "Jordan: Petra & Wadi Rum",
    destination: "Amman → Aqaba",
    country: "Jordan",
    summary:
      "Five days down the King's Highway. Amman's citadel and Jerash's colonnades, a float in the Dead Sea, a full day inside Petra's rose-red canyons and a Bedouin night under Wadi Rum's stars.",
    coverImage: U("photo-1576016770956-debb63d92058"),
    popularity: 598,
    tags: ["historical", "adventure", "roadtrip"],
    city: "Amman",
    plan: [
      d("Amman", [
        s("Amman Citadel (Jabal al-Qal'a)", 31.9544, 35.9343, 90, "Hercules' temple and Umayyad palace above the downtown amphitheater, the city spreads below."),
        s("Roman Theater", 31.9517, 35.9393, 60, "The 6,000-seat theater carved into the hillside in the 2nd century AD."),
        s("Rainbow Street", 31.9511, 35.9242, 75, "Cafés, galleries and rooftop views in Jabal Amman, good for a sunset stroll."),
        s("Hashem Restaurant", 31.9507, 35.9335, 60, "The legendary 24-hour falafel and hummus joint, kings and taxi drivers at the same tables.", { cat: "food" }),
      ]),
      d("Jerash & the Dead Sea", [
        s("Jerash (Gerasa)", 32.2747, 35.8914, 150, "Rome's best-preserved provincial city, the oval plaza, cardo and Hadrian's arch."),
        s("Mount Nebo", 31.7683, 35.7256, 60, "Moses' view of the Promised Land, mosaics in the memorial church."),
        s("Dead Sea float", 31.559, 35.4732, 120, "Bob like a cork in 34% salinity at 430m below sea level, mud pack included."),
      ]),
      d("Petra", [
        s("Petra – Siq & Treasury", 30.3225, 35.4517, 240, "Walk the 1.2km slot canyon as the Treasury reveals itself slice by rose-red slice.", { city: "Petra", match: "Siq" }),
        s("Royal Tombs & the Street of Facades", 30.3285, 35.451, 120, "Urn, Silk and Palace tombs carved into the eastern cliffs above the colonnaded street.", { city: "Petra" }),
        s("Ad-Deir (the Monastery)", 30.3379, 35.4297, 180, "850 steps up to Petra's largest facade, tea at the viewpoint over Wadi Araba.", { city: "Petra" }),
        s("Petra by Night", 30.3225, 35.4517, 120, "The Siq by 1,500 candles with Bedouin music before the Treasury (Mon/Wed/Thu).", { city: "Petra", match: "Petra by Night" }),
      ]),
      d("Wadi Rum", [
        s("Wadi Rum 4x4 desert tour", 29.576, 35.419, 240, "Jeep across the 'Valley of the Moon'. Lawrence's desert of rock bridges and red dunes."),
        s("Lawrence's Spring & Khazali Canyon", 29.585, 35.4, 90, "Water seeping from the cliff and Thamudic inscriptions in a narrow siq."),
        s("Bedouin camp & stargazing", 29.6, 35.43, 240, "Zarb cooked underground, sweet sage tea and the desert's silent planetarium sky."),
      ]),
      d("Aqaba & farewell", [
        s("Red Sea snorkel, Aqaba", 29.5267, 35.0077, 150, "Coral gardens right off the beach, the Japanese Garden site teems with life."),
        s("Aqaba Fort & old town", 29.5208, 35.0018, 60, "The Mamluk castle where Lawrence of Arabia's Arab Revolt won a key victory."),
        s("Return to Amman / depart", 31.7224, 35.9933, 240, "Desert Highway north to the airport, shawarma stop on the way out.", { cat: "food" }),
      ]),
    ],
  },
);

TEMPLATES.push(
  {
    slug: "south-africa-garden-10",
    title: "South Africa: Cape Town & Garden Route",
    destination: "Cape Town → Gqeberha",
    country: "South Africa",
    summary:
      "Ten days from Table Mountain to the Eastern Cape, penguins at Boulders, Cape Point's cliffs, Stellenbosch wine valleys, Hermanus whales and the Garden Route's lagoons, ending with elephants in Addo.",
    coverImage: U("photo-1580060839134-75a5edca2e99"),
    popularity: 524,
    tags: ["roadtrip", "adventure", "nature", "food"],
    city: "Cape Town",
    plan: [
      d("Cape Town: the mountain", [
        s("Table Mountain Aerial Cableway", -33.948, 18.4031, 150, "Rotating cable car to the 1,085m plateau, go the first clear morning, clouds move fast.", { match: "Table Mountain" }),
        s("V&A Waterfront", -33.9036, 18.4205, 90, "Harbor-side shops and seals lazing by the swing bridge with the mountain behind."),
        s("Time Out Market Cape Town", -33.9052, 18.4197, 90, "The city's best kitchens in one dockside hall, bobotie to bunny chow.", { match: "Time Out", cat: "food" }),
      ]),
      d("Cape Peninsula", [
        s("Boulders Beach Penguin Colony", -34.1973, 18.4515, 90, "African penguins waddle past your beach towel at this sheltered cove.", { match: "Boulders" }),
        s("Cape of Good Hope & Cape Point", -34.3568, 18.474, 150, "The continent's southwestern tip, funicular to the lighthouse over two oceans."),
        s("Chapman's Peak Drive", -34.1, 18.36, 60, "114 curves carved into 600m cliffs, the world's most cinematic toll road."),
        s("Kalk Bay harbor", -34.128, 18.449, 75, "Fish and chips at the working harbor while seals beg scraps off the boats.", { cat: "food" }),
      ]),
      d("Cape Town: history & flavor", [
        s("Robben Island", -33.8067, 18.3704, 240, "Ferry to Mandela's prison island, tours led by former political prisoners.", { match: "Robben Island" }),
        s("Bo-Kaap", -33.9207, 18.4148, 60, "Candy-colored Cape Malay houses on cobbled slopes, samosas from a corner café."),
        s("District Six Museum", -33.9284, 18.4236, 75, "Moving memorial to the community erased under apartheid."),
        s("Gold Restaurant", -33.9134, 18.407, 120, "14-dish pan-African feast with drumming and djembe lessons between courses.", { match: "Gold Restaurant", cat: "food" }),
      ]),
      d("Cape Winelands", [
        s("Stellenbosch wine estates", -33.9321, 18.8602, 150, "Cape Dutch gables and oak-lined streets, tasting flight at Spier or Tokara."),
        s("Franschhoek", -33.912, 19.1214, 120, "The French corner: Huguenot monument, wine tram and South Africa's foodie capital.", { cat: "food" }),
        s("Boschendal estate", -33.874, 18.973, 90, "Picnic under 300-year-old oaks on one of the Cape's oldest farms.", { cat: "food" }),
      ]),
      d("Hermanus", [
        s("Cliff Path whale watching", -34.4187, 19.2345, 120, "Southern right whales breach meters offshore (Jun–Nov) along the 12km cliff walk."),
        s("Hemel-en-Aarde wine valley", -34.39, 19.22, 90, "Cool-climate Pinot Noir and Chardonnay in the 'heaven and earth' valley.", { cat: "food" }),
        s("Grotto Beach", -34.405, 19.28, 90, "Blue Flag sweep of sand backed by fynbos dunes, sunset walk before dinner."),
      ]),
      d("To the Garden Route", [
        s("Swellendam", -34.021, 20.44, 75, "Cape Dutch third-oldest town, coffee and a drostdy museum stop on Route 62."),
        s("Wilderness & Map of Africa", -33.997, 22.587, 90, "The Kaaimans river bends into Africa's silhouette below the viewpoint."),
        s("Knysna Heads", -34.08, 23.06, 75, "Sandstone cliffs guarding the lagoon mouth, drive to the east-head viewpoint."),
      ]),
      d("Knysna & Plettenberg Bay", [
        s("Knysna lagoon cruise", -34.048, 23.04, 120, "Oyster-tasting cruise across the lagoon to Featherbed nature reserve.", { cat: "food" }),
        s("Plettenberg Bay beaches", -34.05, 23.37, 120, "Lookout Beach's sandbar and dolphin-spotting from the dunes."),
        s("Robberg Nature Reserve", -34.101, 23.388, 150, "The peninsula loop hike, seals barking below the cliffs and a tombolo sand spit."),
      ]),
      d("Tsitsikamma", [
        s("Storms River Mouth suspension bridge", -33.973, 23.925, 150, "Walk the 77m bridge over the river mouth where the Indian Ocean explodes through the gorge."),
        s("Bloukrans Bridge bungee / viewpoint", -33.968, 23.645, 90, "World's highest commercial bridge bungee (216m), or just watch from the edge. Your call."),
        s("Nature's Valley", -33.975, 23.555, 90, "Lagoon-meets-beach hamlet in the forest, the quiet end of the Otter Trail."),
      ]),
      d("Addo elephants", [
        s("Addo Elephant National Park", -33.483, 25.75, 300, "Self-drive among 600+ elephants, plus lions, buffalo and the flightless dung beetle."),
        s("Port Elizabeth (Gqeberha) boardwalk", -33.978, 25.655, 90, "Farewell seafood dinner on the promenade over Hobie Beach.", { cat: "food" }),
      ]),
      d("Departure", [
        s("Route 67 art walk", -33.962, 25.62, 75, "67 public artworks celebrating Mandela's 67 years of service through the old town."),
        s("Fly out from Gqeberha", -33.985, 25.6173, 120, "Drop the car and connect home via Johannesburg, or keep going to the Wild Coast."),
      ]),
    ],
  },
  {
    slug: "nyc-4",
    title: "New York City in 4 Days",
    destination: "New York",
    country: "United States",
    summary:
      "Four days across Manhattan's greatest hits. Midtown's towers, Lady Liberty and the Brooklyn Bridge, Central Park's museums and the High Line's west side. Subway-and-sneakers pacing with deli fuel.",
    coverImage: U("photo-1496442226666-8d4d0e62e6e9"),
    popularity: 858,
    tags: ["city", "art", "food"],
    city: "New York",
    plan: [
      d("Midtown icons", [
        s("Times Square", 40.758, -73.9855, 45, "The crossroads of the world, most fun at night when the billboards outshout each other."),
        s("Museum of Modern Art (MoMA)", 40.7616, -73.9775, 150, "Starry Night, Campbell's Soup and the sculpture garden. Friday evenings are lively.", { match: "MoMA" }),
        s("Top of the Rock", 40.7594, -73.9794, 90, "70 floors up 30 Rock, the only skyline view that INCLUDES the Empire State Building."),
        s("Grand Central Terminal", 40.7527, -73.9772, 60, "The celestial ceiling and whispering gallery, oysters in the 1913 bar downstairs.", { cat: "food" }),
      ]),
      d("Downtown & Brooklyn Bridge", [
        s("Statue of Liberty & Ellis Island", 40.6893, -74.0445, 240, "First ferry out, pedestal access if booked ahead, then the moving immigration halls of Ellis.", { match: "Statue of Liberty" }),
        s("9/11 Memorial & Museum", 40.7115, -74.0134, 120, "The twin reflecting pools in the towers' footprints; the museum below is devastating and essential."),
        s("Brooklyn Bridge walk", 40.7061, -73.9969, 75, "Walk the 1883 promenade toward Brooklyn at golden hour, skyline behind you all the way."),
        s("Katz's Delicatessen", 40.7223, -73.9874, 75, "The 1888 pastrami cathedral, take a ticket, tip the cutter, order the pastrami on rye.", { match: "Katz's", cat: "food" }),
      ]),
      d("Central Park & museums", [
        s("The Metropolitan Museum of Art", 40.7794, -73.9634, 180, "Two million objects, pick three wings (Egyptian Temple of Dendur is non-negotiable).", { match: "Metropolitan Museum" }),
        s("Central Park (Bethesda Terrace)", 40.7742, -73.9711, 90, "Bow Bridge, Bethesda Fountain and the Ramble, the backyard of 8 million people.", { match: "Bethesda" }),
        s("American Museum of Natural History", 40.7813, -73.974, 150, "The blue whale, T. rex and the Rose Center planetarium across from the park."),
        s("Upper West Side dinner", 40.787, -73.9754, 90, "Neighborhood bistros along Amsterdam Avenue, classic New York night out.", { cat: "food" }),
      ]),
      d("High Line & Village", [
        s("The High Line", 40.748, -74.0048, 90, "The elevated rail-trail park from Hudson Yards to the Meatpacking District, art and wild plantings."),
        s("Chelsea Market", 40.7421, -74.0049, 75, "Oreo's birthplace turned food hall, tacos at Los Tacos No.1 and a browse below.", { match: "Chelsea Market", cat: "food" }),
        s("Greenwich Village & Washington Square", 40.7308, -73.9973, 90, "Buskers under the arch, Bob Dylan's old haunts on MacDougal, comedy cellar for late shows."),
        s("Brooklyn Heights Promenade", 40.696, -73.993, 60, "The skyline money shot across the East River, farewell panorama at dusk."),
      ]),
    ],
  },
);

TEMPLATES.push(
  {
    slug: "india-golden-triangle-6",
    title: "India Golden Triangle",
    destination: "Delhi → Jaipur",
    country: "India",
    summary:
      "Six days through India's classic circuit. Old Delhi's forts and food lanes, a Taj Mahal sunrise from across the Yamuna, Fatehpur Sikri's ghost city and Jaipur's pink palaces and bazaars.",
    coverImage: U("photo-1564507592333-c60657eea523"),
    popularity: 690,
    tags: ["roadtrip", "historical", "food", "adventure"],
    city: "Delhi",
    plan: [
      d("Old Delhi", [
        s("Red Fort", 28.6562, 77.241, 120, "Shah Jahan's red-sandstone palace-fortress, the Lahori Gate and the Diwan-i-Am's marble canopy.", { match: "Red Fort" }),
        s("Jama Masjid", 28.6507, 77.2334, 60, "India's largest mosque, climb the southern minaret for the Old Delhi sprawl."),
        s("Chandni Chowk rickshaw ride", 28.6506, 77.2303, 90, "Cycle-rickshaw through the 17th-century bazaar, spice market on Khari Baoli and the paratha gali."),
        s("Karim's", 28.6497, 77.2323, 75, "The 1913 Mughlai institution in the lanes by Jama Masjid, mutton korma and roomali roti.", { match: "Karim", cat: "food" }),
      ]),
      d("New Delhi", [
        s("Humayun's Tomb", 28.5933, 77.2507, 100, "The Mughal garden-tomb that inspired the Taj, red sandstone and white marble in perfect symmetry.", { match: "Humayun" }),
        s("Qutub Minar", 28.5245, 77.1855, 90, "The 73m 12th-century victory tower and the rust-proof Iron Pillar in its courtyard.", { match: "Qutub" }),
        s("India Gate & Rajpath", 28.6129, 77.2295, 60, "The 42m war memorial arch at the ceremonial axis, best at dusk with an ice cream from a vendor."),
        s("Connaught Place dinner", 28.6315, 77.2167, 90, "Colonnaded Georgian circles, butter chicken at a Delhi institution like United Coffee House.", { cat: "food" }),
      ]),
      d("To Agra", [
        s("Drive Delhi → Agra (Yamuna Expressway)", 27.8974, 78.088, 210, "Smooth morning expressway run, chai stop en route, hotel check-in by lunch."),
        s("Agra Fort", 27.1795, 78.0211, 120, "The red-sandstone Mughal citadel where Shah Jahan was imprisoned with a view of his Taj.", { city: "Agra", match: "Agra Fort" }),
        s("Itimad-ud-Daulah (Baby Taj)", 27.1924, 78.0301, 75, "The delicate marble jewel-box tomb that previews the Taj's pietra dura inlay.", { city: "Agra", match: "Baby Taj" }),
        s("Mehtab Bagh at sunset", 27.181, 78.038, 75, "The moonlight garden across the Yamuna, the Taj Mahal perfectly framed at golden hour.", { city: "Agra" }),
      ]),
      d("Taj Mahal → Jaipur", [
        s("Taj Mahal at sunrise", 27.1751, 78.0421, 150, "East-gate queue by 5:30am, the marble shifts from grey to rose to blazing white as the sun rises.", { city: "Agra", match: "Taj Mahal" }),
        s("Pinch of Spice", 27.1613, 78.0433, 75, "Agra's best north-Indian lunch, rich murg mussalam and garlic naan.", { city: "Agra", match: "Pinch of Spice", cat: "food" }),
        s("Fatehpur Sikri", 27.0909, 77.6612, 120, "Akbar's abandoned red-sandstone capital en route west, the Buland Darwaza is 54m of triumph."),
        s("Arrive Jaipur", 26.9124, 75.7873, 150, "Evening check-in in the Pink City, lassi and a rooftop view of the old walls."),
      ]),
      d("Jaipur: fort & palace", [
        s("Amer Fort", 26.9855, 75.8513, 150, "Ride up (jeep, not elephant) to the hill fort, the Sheesh Mahal's mirror work outglitters everything.", { city: "Jaipur", match: "Amer" }),
        s("Hawa Mahal", 26.9239, 75.8267, 60, "The 953-window 'Palace of Winds', the view FROM its tiny jharokha balconies over the bazaar.", { city: "Jaipur", match: "Hawa Mahal" }),
        s("City Palace Jaipur", 26.9258, 75.8237, 120, "The royal family's still-inhabited palace, the four painted season doorways of Pritam Niwas.", { city: "Jaipur", match: "City Palace" }),
        s("Laxmi Misthan Bhandar (LMB)", 26.9191, 75.827, 60, "Jaipur's legendary sweet house, ghewar, paneer ghewar and a proper Rajasthani thali.", { city: "Jaipur", match: "LMB", cat: "food" }),
      ]),
      d("Jaipur: science & bazaars", [
        s("Jantar Mantar", 26.9247, 75.8246, 75, "The world's largest stone sundial and 18 other massive 18th-century instruments, accurate to seconds.", { city: "Jaipur" }),
        s("Johari Bazaar", 26.92, 75.826, 90, "The jewelers' bazaar, block-print textiles, blue pottery and gemstones; haggle cheerfully.", { city: "Jaipur", cat: "shopping" }),
        s("Nahargarh Fort at sunset", 26.9375, 75.8157, 90, "The tiger fort above the city, the whole Pink City lights up below the ramparts.", { city: "Jaipur" }),
        s("Chokhi Dhani", 26.7654, 75.8453, 180, "The mock-village cultural evening, folk dances, camel rides and a bottomless Rajasthani thali.", { city: "Jaipur", match: "Chokhi Dhani", cat: "food" }),
      ]),
    ],
  },
  {
    slug: "rajasthan-8",
    title: "Rajasthan: Forts & the Thar Desert",
    destination: "Jaipur → Udaipur",
    country: "India",
    summary:
      "Eight days across the land of kings. Jaipur's pink palaces, Pushkar's sacred lake, Jodhpur's blue maze, a camel night in the Thar at Jaisalmer and Udaipur's white marble on Lake Pichola.",
    coverImage: U("photo-1599661046289-e31897846e41"),
    popularity: 545,
    tags: ["roadtrip", "historical", "adventure", "food"],
    city: "Jaipur",
    plan: [
      d("Jaipur: the icons", [
        s("Amer Fort", 26.9855, 75.8513, 150, "The hill fort's mirror palace and elephant-gate frescoes above Maota Lake.", { match: "Amer" }),
        s("Hawa Mahal", 26.9239, 75.8267, 60, "The pink five-story honeycomb facade, climb inside for the jharokha view.", { match: "Hawa Mahal" }),
        s("City Palace Jaipur", 26.9258, 75.8237, 120, "Chandra and Mubarak Mahals with the famous peacock gates.", { match: "City Palace" }),
        s("Laxmi Misthan Bhandar (LMB)", 26.9191, 75.827, 60, "Ghewar and thali at the old city's legendary sweet house.", { match: "LMB", cat: "food" }),
      ]),
      d("Jaipur: observatory & bazaars", [
        s("Jantar Mantar", 26.9247, 75.8246, 75, "Giant 18th-century astronomical instruments still accurate to the second."),
        s("Bapu Bazaar", 26.918, 75.824, 90, "Mojari shoes, block prints and lac bangles, the locals' market, best prices in town.", { cat: "shopping" }),
        s("Nahargarh Fort at sunset", 26.9375, 75.8157, 90, "Sundowners on the ramparts as Jaipur glitters below."),
        s("Chokhi Dhani", 26.7654, 75.8453, 180, "Rajasthani village evening, folk music, puppet shows and unlimited thali.", { match: "Chokhi Dhani", cat: "food" }),
      ]),
      d("Pushkar", [
        s("Drive to Pushkar", 26.4897, 74.5511, 180, "West into the desert state, the highway passes mustard fields and camel carts."),
        s("Pushkar Lake ghats", 26.4897, 74.5511, 90, "One of Hinduism's holiest lakes: 52 ghats where pilgrims bathe at sunset aarti."),
        s("Brahma Temple", 26.487, 74.546, 60, "One of the world's few temples to Lord Brahma, red spire and silver turtles."),
        s("Savitri Temple ropeway", 26.482, 74.54, 90, "Cable car to the hilltop temple for the desert-and-lake panorama at dusk."),
      ]),
      d("Jodhpur", [
        s("Mehrangarh Fort", 26.298, 73.0186, 150, "Rudyard Kipling called it 'the work of giants': 120m above the blue city with cannon-scarred gates.", { city: "Jodhpur" }),
        s("Jaswant Thada", 26.3033, 73.0252, 60, "The white-marble royal cenotaph glowing beside the fort.", { city: "Jodhpur" }),
        s("Clock Tower & Sardar Market", 26.2957, 73.024, 90, "Spice pyramids and glass bangles in the old city's bustling heart, try the mirchi vada.", { city: "Jodhpur", cat: "food" }),
        s("Blue city walk, Navchokiya", 26.2946, 73.0195, 75, "Wander the indigo-washed lanes below the fort as evening aarti echoes.", { city: "Jodhpur" }),
      ]),
      d("Jaisalmer: the golden fort", [
        s("Drive to Jaisalmer", 26.9157, 70.9083, 300, "Long Thar crossing, break at Pokhran's fort en route."),
        s("Jaisalmer Fort (Sonar Quila)", 26.9127, 70.9126, 120, "The living 12th-century sandstone fort: 4,000 people still live inside its golden walls.", { city: "Jaisalmer" }),
        s("Patwon-ki-Haveli", 26.918, 70.914, 75, "Five carved sandstone mansions, lace in stone, Jaisalmer's finest facades.", { city: "Jaisalmer" }),
        s("Gadisar Lake", 26.906, 70.916, 60, "Temples and ghats around the old reservoir, golden hour turns everything to honey.", { city: "Jaisalmer" }),
      ]),
      d("Thar Desert", [
        s("Kuldhara abandoned village", 26.84, 70.78, 60, "The ghost village abandoned overnight 200 years ago, eerie roofless lanes.", { city: "Jaisalmer" }),
        s("Sam Sand Dunes camel safari", 26.84, 70.52, 180, "Camel caravan into the dunes for sunset, the desert turns copper then violet.", { city: "Jaisalmer" }),
        s("Desert camp night", 26.85, 70.53, 240, "Kalbeliya dancers around the fire, dal baati churma and a sky thick with stars.", { city: "Jaisalmer" }),
      ]),
      d("To Udaipur", [
        s("Drive Jaisalmer → Udaipur (or via Jodhpur flight)", 26.23, 73.02, 300, "Full travel day south. Ranakpur's 1,444-pillar Jain temple breaks the journey."),
        s("Ranakpur Jain Temple", 25.116, 73.472, 90, "No two of the 1,444 carved marble pillars alike, light and silence in perfect measure."),
        s("Lake Pichola evening", 24.571, 73.679, 90, "Arrive in the white city, boat past the Lake Palace as the ghats light up.", { city: "Udaipur" }),
      ]),
      d("Udaipur", [
        s("City Palace Udaipur", 24.576, 73.683, 150, "Rajasthan's largest palace complex, balconies, mirrors and miniature paintings over the lake.", { city: "Udaipur" }),
        s("Jagdish Temple", 24.5797, 73.6835, 45, "The 1651 Indo-Aryan temple with its black-stone Vishnu and carved elephant friezes.", { city: "Udaipur" }),
        s("Saheliyon-ki-Bari", 24.602, 73.689, 60, "The 'Garden of the Maidens', lotus pools and marble elephants made for royal ladies.", { city: "Udaipur" }),
        s("Monsoon Palace (Sajjangarh)", 24.594, 73.647, 90, "The hilltop palace at sunset, all of Udaipur's lakes laid out like mirrors.", { city: "Udaipur" }),
      ]),
    ],
  },
);

TEMPLATES.push(
  {
    slug: "thailand-9",
    title: "Thailand: Bangkok, Chiang Mai & Islands",
    destination: "Bangkok → Phuket",
    country: "Thailand",
    summary:
      "Nine days from Bangkok's golden wats and Chinatown street food to Chiang Mai's mountain temple, then south to Railay's karst cliffs and Phi Phi's lagoons. Temples north, beaches south, pad thai everywhere.",
    coverImage: U("photo-1552465011-b4e21bf6e79a"),
    popularity: 915,
    tags: ["beach", "food", "adventure", "historical"],
    city: "Bangkok",
    plan: [
      d("Bangkok: the royal island", [
        s("Grand Palace & Wat Phra Kaew", 13.75, 100.4913, 150, "The Emerald Buddha and gold-chedi splendor of the former royal residence, shoulders/knees covered.", { match: "Grand Palace" }),
        s("Wat Pho (Temple of the Reclining Buddha)", 13.7463, 100.4927, 75, "The 46m gold reclining Buddha and Thailand's original massage school, book a foot rub.", { match: "Wat Pho" }),
        s("Wat Arun (Temple of Dawn)", 13.7437, 100.4889, 60, "Cross the river by 4-baht ferry to climb the porcelain-encrusted prang at sunset.", { match: "Wat Arun" }),
        s("Yaowarat Road (Bangkok Chinatown)", 13.74, 100.5094, 120, "The world's best street-food strip after dark, peppery crab, mango sticky rice, bird's nest if brave.", { match: "Yaowarat", cat: "food" }),
      ]),
      d("Bangkok: city & canals", [
        s("Jim Thompson House", 13.749, 100.528, 75, "The silk magnate's teak house-museum hidden in a jungle garden by the khlong."),
        s("Chatuchak Weekend Market", 13.8003, 100.5511, 150, "15,000 stalls (Sat/Sun), vintage, plants, ceramics and coconut ice cream; weekdays swap for MBK.", { match: "Chatuchak", cat: "shopping" }),
        s("Lumphini Park", 13.7314, 100.5414, 60, "Monitor lizards and tai chi at dawn in Bangkok's green lung."),
        s("Rooftop bar over the Chao Phraya", 13.723, 100.513, 90, "Sundowner high above the river bend. Wat Arun lights up across the water.", { cat: "food" }),
      ]),
      d("Ayutthaya day trip", [
        s("Wat Mahathat, Ayutthaya", 14.3569, 100.5674, 75, "The Buddha head cradled in banyan roots. Siam's fallen capital's most haunting image.", { city: "Ayutthaya" }),
        s("Wat Phra Si Sanphet", 14.355, 100.558, 75, "The three iconic chedis of the old royal temple.", { city: "Ayutthaya" }),
        s("Wat Chaiwatthanaram", 14.342, 100.542, 60, "Riverside Khmer-style prangs, the Ayutthaya postcard, especially at dusk.", { city: "Ayutthaya" }),
        s("Boat noodles by the river", 14.357, 100.565, 60, "Tiny bowls of dark, rich kuay teow ruea, order three at a time.", { city: "Ayutthaya", cat: "food" }),
      ]),
      d("Chiang Mai: old city", [
        s("Fly to Chiang Mai", 18.7668, 98.9626, 180, "Morning hop north, check in inside the moated old city."),
        s("Wat Chedi Luang", 18.787, 98.9867, 75, "The ruined 14th-century brick chedi that once held the Emerald Buddha.", { city: "Chiang Mai", match: "Chedi Luang" }),
        s("Wat Phra Singh", 18.7885, 98.9818, 60, "Lanna architecture at its richest, the gold-leaf Phra Singh Buddha and scripture library.", { city: "Chiang Mai" }),
        s("Chiang Mai Sunday Walking Street", 18.788, 98.988, 120, "Sunday market filling Ratchadamnoen, hill-tribe crafts, khao soi stalls and foot massages in the road.", { city: "Chiang Mai", match: "Walking Street", cat: "shopping" }),
      ]),
      d("Chiang Mai: mountain & elephants", [
        s("Wat Phra That Doi Suthep", 18.8049, 98.9216, 120, "The golden chedi on the mountain: 306 naga steps (or funicular) to the city panorama.", { city: "Chiang Mai", match: "Doi Suthep" }),
        s("Elephant Nature Park", 18.952, 98.86, 240, "Ethical sanctuary visit, feed and walk with rescued elephants, no riding.", { city: "Chiang Mai" }),
        s("Night Bazaar", 18.787, 99.001, 90, "Khao soi dinner then browsing the nightly craft market on Chang Klan Road.", { city: "Chiang Mai", cat: "food" }),
      ]),
      d("South: Railay & Krabi", [
        s("Fly to Krabi → Railay Beach", 8.011, 98.838, 210, "Longtail boat to the car-free peninsula walled by limestone karsts."),
        s("Railay West & viewpoint lagoon", 8.012, 98.837, 120, "Rock climbers overhead, powder sand underfoot, the steep lagoon scramble for the fit."),
        s("Phra Nang Cave Beach", 8.003, 98.835, 120, "The princess cave shrine and the prettiest swim in Thailand under the karst overhang."),
        s("Sunset at Ao Nang", 8.03, 98.82, 90, "Beach-road seafood and fire shows as the cliffs turn pink.", { cat: "food" }),
      ]),
      d("Phi Phi", [
        s("Maya Bay, Phi Phi Leh", 7.678, 98.765, 120, "'The Beach' itself, early boat to beat the flotillas; swimming rules vary by season."),
        s("Pileh Lagoon", 7.683, 98.764, 90, "An emerald swimming pool ringed by 100m cliffs, jump off the longtail."),
        s("Snorkel & viewpoint, Phi Phi Don", 7.74, 98.778, 150, "Reef sharks at Shark Point, then the sweaty 20-minute climb to the twin-bay viewpoint at sunset."),
      ]),
      d("Phuket", [
        s("Big Buddha Phuket", 7.827, 98.313, 90, "The 45m white-marble Buddha on Nakkerd Hill, island-wide views to Kata."),
        s("Old Phuket Town", 7.885, 98.389, 120, "Sino-Portuguese shophouses on Thalang Road. Sunday walking-street market if you time it.", { cat: "shopping" }),
        s("Kata or Patong sunset", 7.896, 98.296, 90, "Final beach afternoon and a seafood barbecue on the sand.", { cat: "food" }),
      ]),
      d("Phang Nga Bay & farewell", [
        s("James Bond Island (Khao Phing Kan)", 8.276, 98.501, 150, "Longtail among the bay's limestone towers to the nail-shaped rock from 'The Man with the Golden Gun'."),
        s("Sea canoe into the hongs", 8.25, 98.52, 120, "Paddle through tidal caves into hidden lagoons open to the sky."),
        s("Farewell beach dinner", 8.03, 98.822, 90, "Grilled snapper and a Chang as longtails silhouette the sunset, kop khun ka, Thailand.", { cat: "food" }),
      ]),
    ],
  },
  {
    slug: "vietnam-12",
    title: "Vietnam North to South",
    destination: "Hanoi → Ho Chi Minh City",
    country: "Vietnam",
    summary:
      "Twelve days down the S-curve. Hanoi's old quarter and Ha Long's karsts, imperial Hue, lantern-lit Hoi An, then Saigon's war history and the Mekong's floating world. Trains or short hops between bases.",
    coverImage: U("photo-1528127269322-539801943592"),
    popularity: 640,
    tags: ["roadtrip", "food", "historical", "adventure"],
    city: "Hanoi",
    plan: [
      d("Hanoi: the old quarter", [
        s("Hanoi Old Quarter", 21.0351, 105.8507, 120, "36 guild streets of tube houses and sidewalk kitchens, dive into the beautiful chaos.", { match: "Old Quarter" }),
        s("Hoan Kiem Lake & Ngoc Son Temple", 21.0287, 105.8525, 60, "The red Huc bridge to the turtle temple, tai chi at dawn, locals' living room all day."),
        s("Train Street", 21.0245, 105.843, 60, "Coffee inches from the tracks as the twice-daily train squeezes through (check times/access)."),
        s("Bun cha lunch", 21.03, 105.849, 60, "Obama's pick: smoky grilled pork patties in sweet-sour broth with herbs and rice noodles.", { cat: "food" }),
      ]),
      d("Hanoi: history", [
        s("Temple of Literature (Van Mieu)", 21.0277, 105.8355, 90, "Vietnam's first university (1070), stelae on stone turtles honor the doctor laureates.", { match: "Temple of Literature" }),
        s("Ho Chi Minh Mausoleum complex", 21.0367, 105.8347, 90, "The solemn mausoleum, Uncle Ho's stilt house and the One Pillar Pagoda."),
        s("Hoa Lo Prison Museum", 21.0255, 105.8464, 75, "The 'Hanoi Hilton'. French colonial cells and the American POW wing.", { match: "Hoa Lo" }),
        s("Thang Long water puppet theatre", 21.029, 105.853, 60, "1,000-year-old art form, dragons and farmers dancing on water to live folk music."),
      ]),
      d("Ha Long Bay", [
        s("Drive to Ha Long, board overnight cruise", 20.9101, 107.1839, 240, "Transfer to the bay and sail among 1,600 limestone islands as the sun drops."),
        s("Sung Sot (Surprise) Cave", 20.845, 107.099, 90, "The bay's grandest cavern, two chambers of floodlit stalactites."),
        s("Kayak the karsts", 20.86, 107.11, 90, "Paddle into hidden lagoons where macaques watch from the cliffs."),
        s("Squid fishing off the deck", 20.87, 107.12, 60, "Night ritual on the cruise, jig for squid under the stars, cook your catch."),
      ]),
      d("Ha Long → Ninh Binh", [
        s("Ti Top island viewpoint", 20.823, 107.087, 75, "Morning climb for the 360° bay panorama before brunch aboard."),
        s("Trang An boat tour", 20.252, 105.921, 150, "Rowed by foot through cave tunnels and valley temples, 'Ha Long on land'."),
        s("Mua Cave (Hang Mua) viewpoint", 20.243, 105.919, 90, "500 steps to the dragon ridge over the Tam Coc rice paddies at golden hour."),
      ]),
      d("Hue: the imperial city", [
        s("Fly/train to Hue", 16.4637, 107.5909, 180, "Hop south to the Nguyen dynasty capital on the Perfume River."),
        s("Imperial City (Citadel)", 16.4693, 107.5777, 150, "The moated forbidden city. Thai Hoa Palace's lacquered columns and the queen mothers' residences."),
        s("Thien Mu Pagoda", 16.454, 107.545, 60, "The seven-story octagonal tower above the river. Hue's symbol since 1601."),
        s("Dong Ba Market", 16.47, 107.583, 75, "Bun bo Hue at the source, the spicy lemongrass beef noodle soup in its hometown.", { cat: "food" }),
      ]),
      d("Hue: royal tombs → Hoi An", [
        s("Tomb of Khai Dinh", 16.399, 107.59, 75, "The emperor's baroque-Vietnamese fantasy, blackened stone outside, insane mosaic inside."),
        s("Tomb of Tu Duc", 16.433, 107.561, 90, "Poet-emperor's lakeside retreat of pavilions and pine forests."),
        s("Hai Van Pass to Hoi An", 16.19, 108.06, 180, "The 'Ocean Cloud Pass'. Top Gear's favorite coastal road down to the ancient port.", { city: "Da Nang" }),
        s("Hoi An lanterns at dusk", 15.876, 108.327, 90, "First evening in the old town, silk lanterns reflect on the Thu Bon River.", { city: "Hoi An" }),
      ]),
      d("Hoi An ancient town", [
        s("Japanese Covered Bridge", 15.877, 108.326, 60, "The 400-year-old bridge-temple that linked the Japanese and Chinese quarters.", { city: "Hoi An" }),
        s("Old Town & assembly halls", 15.8772, 108.3278, 120, "Tan Ky merchant house and the Fujian assembly hall, buy the old-town ticket, wander slowly.", { city: "Hoi An" }),
        s("An Bang Beach", 15.889, 108.347, 150, "Cycle 4km to the sand, beach clubs with loungers and grilled squid.", { city: "Hoi An" }),
        s("Lantern boat on the river", 15.8755, 108.3268, 60, "Release a candle lantern from a sampan as the old town glows.", { city: "Hoi An" }),
      ]),
      d("My Son & tailoring", [
        s("My Son Sanctuary", 15.765, 108.112, 150, "The Cham kingdom's Hindu temple valley (4th–13th c.) in jungle hills, early to dodge heat.", { city: "Hoi An" }),
        s("Hoi An Central Market", 15.879, 108.331, 75, "Cao lau noodles (only made here) and a bargain fruit mountain.", { city: "Hoi An", cat: "food" }),
        s("Get measured at a tailor", 15.877, 108.33, 90, "Hoi An's famous trade, a custom suit or ao dai ready in 24 hours.", { city: "Hoi An", cat: "shopping" }),
      ]),
      d("To Saigon", [
        s("Fly Da Nang → Ho Chi Minh City", 10.8231, 106.6297, 180, "Morning hop south, check in around District 1."),
        s("War Remnants Museum", 10.7795, 106.6922, 120, "Confronting, essential account of the American War, give yourself time.", { city: "Ho Chi Minh City", match: "War Remnants" }),
        s("Independence Palace (Reunification Palace)", 10.777, 106.6954, 90, "The 1960s time-capsule palace where the tank crashed the gates in 1975.", { city: "Ho Chi Minh City", match: "Independence Palace" }),
        s("Ben Thanh Market", 10.7722, 106.6981, 90, "Pho and banh mi in the food court, then the nightly street market outside.", { city: "Ho Chi Minh City", match: "Ben Thanh", cat: "food" }),
      ]),
      d("Saigon: old quarter & tunnels", [
        s("Notre-Dame Cathedral & Central Post Office", 10.7798, 106.699, 60, "The 1880 cathedral square and Gustave Eiffel's vaulted post office.", { city: "Ho Chi Minh City" }),
        s("Cu Chi Tunnels (Ben Dinh)", 11.1423, 106.4533, 210, "Crawl the widened sections of the 250km tunnel network, sobering ingenuity.", { city: "Ho Chi Minh City", match: "Cu Chi" }),
        s("Bánh Mì Huỳnh Hoa", 10.7697, 106.6918, 45, "Saigon's heavyweight banh mi, pâté, cold cuts and chili heat in a crispy baguette.", { city: "Ho Chi Minh City", match: "Huỳnh Hoa", cat: "food" }),
        s("Nguyen Hue walking street", 10.7748, 106.704, 75, "Evening promenade past the People's Committee building to the river.", { city: "Ho Chi Minh City" }),
      ]),
      d("Mekong Delta", [
        s("My Tho boat tour", 10.36, 106.36, 240, "Sampans through palm canals to island orchards and honey-tea farms."),
        s("Coconut candy workshop", 10.37, 106.37, 60, "Watch keo dua pulled and wrapped by hand, warm pieces off the press.", { cat: "food" }),
        s("Vinh Trang Pagoda", 10.3633, 106.3517, 60, "The Mekong's grandest temple, giant laughing Buddha among bonsai gardens."),
      ]),
      d("Farewell Saigon", [
        s("Jade Emperor Pagoda", 10.791, 106.698, 60, "Incense-clouded Taoist temple of carved deities and the turtle pond."),
        s("Café apartment, 42 Nguyen Hue", 10.773, 106.7, 75, "A mid-century block stacked with indie cafés, egg coffee with a balcony view.", { cat: "food" }),
        s("Fly home from Tan Son Nhat", 10.8188, 106.652, 120, "Last banh mi at the airport. Vietnam stays with you."),
      ]),
    ],
  },
);

TEMPLATES.push(
  {
    slug: "bali-6",
    title: "Bali in 6 Days",
    destination: "Ubud → Uluwatu",
    country: "Indonesia",
    summary:
      "Six days across the Island of the Gods. Ubud's monkey forest and rice terraces, a Mount Batur sunrise hike, waterfall swims and the cliff temples of the Bukit, ending with a Nusa Penida day trip.",
    coverImage: U("photo-1537996194471-e657df975ab4"),
    popularity: 778,
    tags: ["beach", "relaxing", "adventure", "food"],
    city: "Ubud",
    plan: [
      d("Ubud town", [
        s("Sacred Monkey Forest Sanctuary", -8.5188, 115.2589, 90, "700 long-tailed macaques among mossy temples, zip your bag, they know zippers.", { match: "Monkey Forest" }),
        s("Ubud Palace & Saraswati Temple", -8.5069, 115.2625, 60, "The royal palace across from the lotus-pond water temple. Legong dance some evenings."),
        s("Ubud Art Market", -8.5068, 115.2622, 75, "Rattan bags, sarongs and woodcarvings, haggle to ~60% of the opening price.", { cat: "shopping" }),
        s("Warung Babi Guling Ibu Oka", -8.5062, 115.262, 60, "Bali's famous suckling pig plate, crispy skin, lawar and sambal on the side.", { match: "Ibu Oka", cat: "food" }),
      ]),
      d("Terraces & temples", [
        s("Tegalalang Rice Terrace", -8.4318, 115.2789, 90, "The amphitheater of emerald paddies, swing over the valley if that's your photo.", { match: "Tegalalang" }),
        s("Tirta Empul Temple", -8.4154, 115.3153, 90, "Join the purification queue under 13 holy spring spouts (sarong provided).", { match: "Tirta Empul" }),
        s("Gunung Kawi", -8.4232, 115.308, 75, "10m shrines carved into the cliff face among rice fields: 300 steps down, worth every one."),
        s("Bebek Bengil (Dirty Duck Diner)", -8.5177, 115.2636, 75, "Crispy duck by the rice paddies. Ubud's signature dish since 1990.", { match: "Bebek Bengil", cat: "food" }),
      ]),
      d("Waterfalls & ridge walk", [
        s("Tegenungan Waterfall", -8.575, 115.288, 90, "The big crowd-pleaser falls, swim in the plunge pool before the midday rush."),
        s("Tibumana Waterfall", -8.561, 115.287, 75, "A quieter curtain in a fern-walled amphitheater, the swim is yours alone."),
        s("Campuhan Ridge Walk", -8.503, 115.254, 90, "Golden-hour grass ridge between two river valleys. Ubud's gentlest, loveliest walk."),
        s("Smoothie bowl & gelato night", -8.512, 115.26, 60, "Dragonfruit bowls and artisan gelato on Jalan Goutama. Ubud's healthy streak.", { cat: "food" }),
      ]),
      d("Mount Batur sunrise", [
        s("Mount Batur sunrise hike", -8.242, 115.375, 240, "2am pickup, headlamps up the volcano, sunrise over Lake Batur and Mount Agung."),
        s("Batur natural hot springs", -8.246, 115.378, 90, "Soak aching calves in the lakeside hot pools right after the descent."),
        s("Kintamani coffee plantation", -8.26, 115.33, 75, "Luwak coffee and ginger tea tasting on a terrace over the caldera.", { cat: "food" }),
      ]),
      d("Uluwatu & the Bukit", [
        s("Uluwatu Temple", -8.8291, 115.0849, 90, "The sea temple on a 70m cliff, stay for the fire-lit Kecak dance at sunset."),
        s("Padang Padang Beach", -8.8111, 115.1038, 120, "Through the rock crevice to the 'Eat Pray Love' cove, small, perfect, busy."),
        s("Jimbaran Bay seafood", -8.78, 115.167, 120, "Toes-in-sand grilled snapper and clams as planes glide into the sunset.", { cat: "food" }),
      ]),
      d("Nusa Penida day trip", [
        s("Kelingking Beach viewpoint", -8.751, 115.473, 120, "Fast boat to Penida, then the T-rex headland, the most famous cliff in Indonesia."),
        s("Angel's Billabong & Broken Beach", -8.725, 115.45, 90, "A natural infinity pool and the sea-arch lagoon around the corner."),
        s("Seminyak sunset finale", -8.691, 115.168, 120, "Back on the mainland, beanbags, a Bintang and one last Bali sunset.", { cat: "food" }),
      ]),
    ],
  },
);

// ── Corpus matching ─────────────────────────────────────────────────────────
type CorpusRow = typeof schema.explorePlaces.$inferSelect;

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();

/** Significant tokens of a name (len ≥ 4, or exact short words like "sky"). */
function tokens(s: string): string[] {
  return norm(s)
    .split(" ")
    .filter((t) => t.length >= 3);
}

/**
 * Find a corpus match for a stop: same city, name LIKE the hint, then verify
 * in JS - the corpus name must contain the hint (normalized) or share ≥60% of
 * the hint's significant tokens, and (when the stop declares a category) the
 * category must agree. Curated rows are preferred over OSM imports.
 */
async function matchCorpus(
  stop: StopSpec,
  defaultCity: string,
): Promise<{ row: CorpusRow | null; matched: boolean }> {
  const db = getDb();
  const city = stop.city ?? defaultCity;
  const hint = stop.match ?? stop.name;
  const candidates = await db
    .select()
    .from(schema.explorePlaces)
    .where(
      and(
        eq(schema.explorePlaces.city, city),
        eq(schema.explorePlaces.hidden, false),
        eq(schema.explorePlaces.approved, true),
        like(schema.explorePlaces.name, `%${hint.replace(/[%_]/g, "")}%`),
      ),
    )
    .limit(6);
  if (!candidates.length) return { row: null, matched: false };
  const hintNorm = norm(hint);
  const hintTokens = tokens(hint);
  const wantCat = stop.cat ?? "activity";
  const scored = candidates
    .map((row) => {
      const rn = norm(row.name);
      const contains = rn.includes(hintNorm) || hintNorm.includes(rn);
      const overlap = hintTokens.length
        ? hintTokens.filter((t) => rn.includes(t)).length / hintTokens.length
        : 0;
      const catOk = row.category === wantCat;
      return { row, contains, overlap, catOk, curated: row.source === "curated" };
    })
    .filter((c) => c.catOk && (c.contains || c.overlap >= 0.6))
    .sort((a, b) => Number(b.curated) - Number(a.curated) || b.overlap - a.overlap);
  const best = scored[0];
  return { row: best?.row ?? null, matched: !!best };
}

// ── Build payload + upsert ──────────────────────────────────────────────────
async function buildPayload(t: TemplateSpec) {
  const days: {
    label: string;
    stops: {
      name: string;
      category: string;
      address: string;
      lat: number;
      lng: number;
      durationMin: number;
      description: string;
      image: string | null;
    }[];
  }[] = [];
  let matched = 0;
  let total = 0;
  for (const day of t.plan) {
    const stops = [];
    for (const stop of day.stops) {
      total++;
      const { row, matched: hit } = await matchCorpus(stop, t.city);
      if (hit && row) matched++;
      const city = stop.city ?? t.city;
      stops.push({
        name: hit && row ? row.name : stop.name,
        category: hit && row ? row.category : (stop.cat ?? "activity"),
        address: hit && row ? `${row.city}, ${row.country}` : `${city}, ${t.country}`,
        lat: hit && row?.lat != null ? row.lat : stop.lat,
        lng: hit && row?.lng != null ? row.lng : stop.lng,
        durationMin: stop.durationMin,
        description: stop.description,
        image: (hit && row?.image) || stop.image || null,
      });
    }
    days.push({ label: day.label, stops });
  }
  return { payload: { tags: t.tags, days }, matched, total };
}

async function main() {
  const db = getDb();
  let totalMatched = 0;
  let totalStops = 0;
  for (const t of TEMPLATES) {
    const { payload, matched, total } = await buildPayload(t);
    totalMatched += matched;
    totalStops += total;
    const daysCount = payload.days.length;
    await db
      .insert(schema.tripTemplates)
      .values({
        slug: t.slug,
        title: t.title,
        destination: t.destination,
        country: t.country,
        days: daysCount,
        summary: t.summary,
        coverImage: t.coverImage,
        payloadJson: payload,
        popularity: t.popularity,
      })
      .onDuplicateKeyUpdate({
        set: {
          title: t.title,
          destination: t.destination,
          country: t.country,
          days: daysCount,
          summary: t.summary,
          coverImage: t.coverImage,
          payloadJson: payload,
          popularity: t.popularity,
        },
      });
    console.log(
      `[seed-templates] upserted ${t.slug} (${t.title}), ${daysCount} days, ${total} stops, corpus-matched ${matched}/${total}`,
    );
  }
  console.log(
    `[seed-templates] done: ${TEMPLATES.length} templates, ${totalStops} stops, corpus matches ${totalMatched}/${totalStops} (${Math.round((totalMatched / totalStops) * 100)}%)`,
  );
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("[seed-templates] failed:", err);
    process.exit(1);
  });
