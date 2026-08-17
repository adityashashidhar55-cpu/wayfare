/**
 * Deterministic real-photo fallback for places without their own image.
 *
 * Every explore place should show ITS OWN photo (seeded from Wikipedia via
 * db/seed-images.ts). For the long tail that has no article photo, this
 * module maps the place to a (category group × world region) pool of REAL
 * Unsplash photographs (images.unsplash.com - hotlink-safe per Unsplash
 * guidelines; every URL verified to return HTTP 200 at the exact params
 * below). Both dimensions matter: a church in Thoothukudi should render a
 * South-Indian church, not a Japanese torii gate; a beach in Kerala should
 * render a palm-fringed Indian beach, not a European old town.
 *
 * Resolution: own image → exact `${group}:${region}` pool → `${group}:global`
 * → `generic-attraction:${region}` → `generic-attraction:global` → null
 * (UI keeps its gradient/pin placeholder; also null when the place carries
 * no signal at all - no name/id/tags/category/country/coords).
 *
 * The pick within a pool is a stable FNV-1a hash of the place id/name, so a
 * place always gets the same fallback photo - never a random one.
 */

export interface PlaceImageInput {
  image?: string | null;
  tags?: string[] | null;
  name?: string | null;
  id?: number | string | null;
  category?: string | null;
  city?: string | null;
  country?: string | null;
  lat?: number | null;
  lng?: number | null;
  styles?: string[] | null;
}

// ── taxonomy ─────────────────────────────────────────────────────────────────

export type PlaceCategoryGroup =
  | 'beach'
  | 'cityscape'
  | 'historic'
  | 'temple-hindu'
  | 'temple-buddhist-shinto'
  | 'church'
  | 'mosque'
  | 'synagogue'
  | 'museum'
  | 'park-garden'
  | 'mountain-nature'
  | 'food-restaurant'
  | 'cafe'
  | 'market-shopping'
  | 'viewpoint'
  | 'lodging'
  | 'transport'
  | 'generic-attraction';

export type WorldRegion =
  | 'south-asia'
  | 'east-asia'
  | 'southeast-asia'
  | 'middle-east'
  | 'europe-west'
  | 'europe-east'
  | 'north-america'
  | 'latin-america'
  | 'africa-north'
  | 'africa-sub'
  | 'oceania'
  | 'central-asia';

/** Pool-region: a real region, or 'global' for the region-independent rung. */
type PoolRegion = WorldRegion | 'global';

// ── country → region (normalized lowercase English names + alternates) ──────
const COUNTRY_REGION: Record<string, WorldRegion> = {
  // south asia
  india: 'south-asia',
  pakistan: 'south-asia',
  bangladesh: 'south-asia',
  'sri lanka': 'south-asia',
  srilanka: 'south-asia',
  nepal: 'south-asia',
  bhutan: 'south-asia',
  maldives: 'south-asia',
  'the maldives': 'south-asia',
  afghanistan: 'south-asia',
  // east asia
  china: 'east-asia',
  "people's republic of china": 'east-asia',
  prc: 'east-asia',
  japan: 'east-asia',
  'south korea': 'east-asia',
  korea: 'east-asia',
  'republic of korea': 'east-asia',
  'north korea': 'east-asia',
  taiwan: 'east-asia',
  'hong kong': 'east-asia',
  hongkong: 'east-asia',
  macau: 'east-asia',
  macao: 'east-asia',
  // southeast asia
  indonesia: 'southeast-asia',
  bali: 'southeast-asia',
  thailand: 'southeast-asia',
  vietnam: 'southeast-asia',
  'viet nam': 'southeast-asia',
  malaysia: 'southeast-asia',
  singapore: 'southeast-asia',
  philippines: 'southeast-asia',
  'the philippines': 'southeast-asia',
  cambodia: 'southeast-asia',
  laos: 'southeast-asia',
  'lao pdr': 'southeast-asia',
  myanmar: 'southeast-asia',
  burma: 'southeast-asia',
  brunei: 'southeast-asia',
  'brunei darussalam': 'southeast-asia',
  'timor-leste': 'southeast-asia',
  'east timor': 'southeast-asia',
  // middle east
  'united arab emirates': 'middle-east',
  uae: 'middle-east',
  emirates: 'middle-east',
  'saudi arabia': 'middle-east',
  qatar: 'middle-east',
  kuwait: 'middle-east',
  bahrain: 'middle-east',
  oman: 'middle-east',
  yemen: 'middle-east',
  iraq: 'middle-east',
  iran: 'middle-east',
  'iran (islamic republic of)': 'middle-east',
  jordan: 'middle-east',
  lebanon: 'middle-east',
  syria: 'middle-east',
  'syrian arab republic': 'middle-east',
  israel: 'middle-east',
  palestine: 'middle-east',
  'state of palestine': 'middle-east',
  turkey: 'middle-east',
  türkiye: 'middle-east',
  turkiye: 'middle-east',
  cyprus: 'middle-east',
  'northern cyprus': 'middle-east',
  // western europe (incl. nordics + southern europe)
  'united kingdom': 'europe-west',
  uk: 'europe-west',
  'great britain': 'europe-west',
  britain: 'europe-west',
  england: 'europe-west',
  scotland: 'europe-west',
  wales: 'europe-west',
  'northern ireland': 'europe-west',
  ireland: 'europe-west',
  'republic of ireland': 'europe-west',
  france: 'europe-west',
  germany: 'europe-west',
  netherlands: 'europe-west',
  'the netherlands': 'europe-west',
  holland: 'europe-west',
  belgium: 'europe-west',
  luxembourg: 'europe-west',
  austria: 'europe-west',
  switzerland: 'europe-west',
  liechtenstein: 'europe-west',
  italy: 'europe-west',
  sicily: 'europe-west',
  sardinia: 'europe-west',
  spain: 'europe-west',
  'canary islands': 'europe-west',
  portugal: 'europe-west',
  madeira: 'europe-west',
  azores: 'europe-west',
  'the azores': 'europe-west',
  greece: 'europe-west',
  crete: 'europe-west',
  malta: 'europe-west',
  denmark: 'europe-west',
  sweden: 'europe-west',
  norway: 'europe-west',
  finland: 'europe-west',
  iceland: 'europe-west',
  'faroe islands': 'europe-west',
  monaco: 'europe-west',
  andorra: 'europe-west',
  'san marino': 'europe-west',
  vatican: 'europe-west',
  'vatican city': 'europe-west',
  'holy see': 'europe-west',
  gibraltar: 'europe-west',
  jersey: 'europe-west',
  guernsey: 'europe-west',
  'isle of man': 'europe-west',
  greenland: 'europe-west',
  corsica: 'europe-west',
  // eastern europe + caucasus
  poland: 'europe-east',
  czechia: 'europe-east',
  'czech republic': 'europe-east',
  slovakia: 'europe-east',
  hungary: 'europe-east',
  romania: 'europe-east',
  bulgaria: 'europe-east',
  croatia: 'europe-east',
  slovenia: 'europe-east',
  serbia: 'europe-east',
  'bosnia and herzegovina': 'europe-east',
  bosnia: 'europe-east',
  montenegro: 'europe-east',
  'north macedonia': 'europe-east',
  macedonia: 'europe-east',
  albania: 'europe-east',
  kosovo: 'europe-east',
  estonia: 'europe-east',
  latvia: 'europe-east',
  lithuania: 'europe-east',
  belarus: 'europe-east',
  ukraine: 'europe-east',
  russia: 'europe-east',
  'russian federation': 'europe-east',
  moldova: 'europe-east',
  'republic of moldova': 'europe-east',
  georgia: 'europe-east',
  armenia: 'europe-east',
  azerbaijan: 'europe-east',
  // north america
  'united states': 'north-america',
  'united states of america': 'north-america',
  usa: 'north-america',
  'u.s.a.': 'north-america',
  us: 'north-america',
  'u.s.': 'north-america',
  america: 'north-america',
  canada: 'north-america',
  bermuda: 'north-america',
  // latin america + caribbean
  mexico: 'latin-america',
  méxico: 'latin-america',
  guatemala: 'latin-america',
  belize: 'latin-america',
  honduras: 'latin-america',
  'el salvador': 'latin-america',
  nicaragua: 'latin-america',
  'costa rica': 'latin-america',
  panama: 'latin-america',
  panamá: 'latin-america',
  cuba: 'latin-america',
  jamaica: 'latin-america',
  haiti: 'latin-america',
  'dominican republic': 'latin-america',
  'puerto rico': 'latin-america',
  bahamas: 'latin-america',
  'the bahamas': 'latin-america',
  barbados: 'latin-america',
  'trinidad and tobago': 'latin-america',
  grenada: 'latin-america',
  'saint lucia': 'latin-america',
  'st lucia': 'latin-america',
  'saint vincent and the grenadines': 'latin-america',
  'saint kitts and nevis': 'latin-america',
  'antigua and barbuda': 'latin-america',
  dominica: 'latin-america',
  aruba: 'latin-america',
  curacao: 'latin-america',
  curaçao: 'latin-america',
  'bonaire': 'latin-america',
  'british virgin islands': 'latin-america',
  'u.s. virgin islands': 'latin-america',
  'virgin islands': 'latin-america',
  'cayman islands': 'latin-america',
  'turks and caicos islands': 'latin-america',
  'turks and caicos': 'latin-america',
  martinique: 'latin-america',
  guadeloupe: 'latin-america',
  'saint martin': 'latin-america',
  'sint maarten': 'latin-america',
  anguilla: 'latin-america',
  montserrat: 'latin-america',
  brazil: 'latin-america',
  brasil: 'latin-america',
  argentina: 'latin-america',
  chile: 'latin-america',
  peru: 'latin-america',
  perú: 'latin-america',
  colombia: 'latin-america',
  venezuela: 'latin-america',
  ecuador: 'latin-america',
  bolivia: 'latin-america',
  paraguay: 'latin-america',
  uruguay: 'latin-america',
  guyana: 'latin-america',
  suriname: 'latin-america',
  'french guiana': 'latin-america',
  'falkland islands': 'latin-america',
  'galapagos islands': 'latin-america',
  galapagos: 'latin-america',
  // north africa
  morocco: 'africa-north',
  algeria: 'africa-north',
  tunisia: 'africa-north',
  libya: 'africa-north',
  egypt: 'africa-north',
  sudan: 'africa-north',
  'western sahara': 'africa-north',
  // sub-saharan africa
  'south africa': 'africa-sub',
  nigeria: 'africa-sub',
  ghana: 'africa-sub',
  kenya: 'africa-sub',
  tanzania: 'africa-sub',
  'united republic of tanzania': 'africa-sub',
  zanzibar: 'africa-sub',
  uganda: 'africa-sub',
  rwanda: 'africa-sub',
  burundi: 'africa-sub',
  ethiopia: 'africa-sub',
  eritrea: 'africa-sub',
  djibouti: 'africa-sub',
  somalia: 'africa-sub',
  senegal: 'africa-sub',
  mali: 'africa-sub',
  'burkina faso': 'africa-sub',
  niger: 'africa-sub',
  chad: 'africa-sub',
  cameroon: 'africa-sub',
  gabon: 'africa-sub',
  'equatorial guinea': 'africa-sub',
  congo: 'africa-sub',
  'republic of the congo': 'africa-sub',
  'democratic republic of the congo': 'africa-sub',
  'dr congo': 'africa-sub',
  drc: 'africa-sub',
  angola: 'africa-sub',
  zambia: 'africa-sub',
  zimbabwe: 'africa-sub',
  mozambique: 'africa-sub',
  malawi: 'africa-sub',
  botswana: 'africa-sub',
  namibia: 'africa-sub',
  lesotho: 'africa-sub',
  eswatini: 'africa-sub',
  swaziland: 'africa-sub',
  madagascar: 'africa-sub',
  mauritius: 'africa-sub',
  seychelles: 'africa-sub',
  comoros: 'africa-sub',
  'cape verde': 'africa-sub',
  'cabo verde': 'africa-sub',
  guinea: 'africa-sub',
  'guinea-bissau': 'africa-sub',
  'sierra leone': 'africa-sub',
  liberia: 'africa-sub',
  'ivory coast': 'africa-sub',
  "côte d'ivoire": 'africa-sub',
  "cote d'ivoire": 'africa-sub',
  togo: 'africa-sub',
  benin: 'africa-sub',
  mauritania: 'africa-sub',
  gambia: 'africa-sub',
  'the gambia': 'africa-sub',
  'central african republic': 'africa-sub',
  'south sudan': 'africa-sub',
  'sao tome and principe': 'africa-sub',
  'são tomé and príncipe': 'africa-sub',
  reunion: 'africa-sub',
  réunion: 'africa-sub',
  mayotte: 'africa-sub',
  // oceania
  australia: 'oceania',
  'new zealand': 'oceania',
  'aotearoa': 'oceania',
  fiji: 'oceania',
  'papua new guinea': 'oceania',
  samoa: 'oceania',
  'american samoa': 'oceania',
  tonga: 'oceania',
  vanuatu: 'oceania',
  'solomon islands': 'oceania',
  micronesia: 'oceania',
  palau: 'oceania',
  'marshall islands': 'oceania',
  kiribati: 'oceania',
  nauru: 'oceania',
  tuvalu: 'oceania',
  'new caledonia': 'oceania',
  'french polynesia': 'oceania',
  tahiti: 'oceania',
  'bora bora': 'oceania',
  guam: 'oceania',
  'cook islands': 'oceania',
  'northern mariana islands': 'oceania',
  'norfolk island': 'oceania',
  niue: 'oceania',
  // central asia
  kazakhstan: 'central-asia',
  uzbekistan: 'central-asia',
  turkmenistan: 'central-asia',
  kyrgyzstan: 'central-asia',
  tajikistan: 'central-asia',
  mongolia: 'central-asia',
};

function normalizeCountryName(country: string): string {
  return country
    .trim()
    .toLowerCase()
    .replace(/[.,;]+/g, '')
    .replace(/\s+/g, ' ')
    .replace(/^the\s+(?!bahamas|gambia|maldives|netherlands|philippines)/, '');
}

/**
 * World region for a country name (any common English form). Returns null
 * when the country is missing or unrecognized - callers should then try
 * lat/lng banding before giving up to 'global'.
 */
export function regionOfCountry(country?: string | null): WorldRegion | null {
  if (!country) return null;
  const n = normalizeCountryName(country);
  if (!n) return null;
  const direct = COUNTRY_REGION[n];
  if (direct) return direct;
  // "City, Country" slips through occasionally - try the last comma part.
  const comma = n.lastIndexOf(',');
  if (comma >= 0) {
    const tail = n.slice(comma + 1).trim();
    const hit = COUNTRY_REGION[tail];
    if (hit) return hit;
  }
  return null;
}

/**
 * Rough world-region from coordinates - last resort when the place has no
 * usable country string. Continental bands only; intentionally crude.
 */
export function regionFromLatLng(lat?: number | null, lng?: number | null): WorldRegion | null {
  if (lat == null || lng == null || !Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  if (lat > 78 || lat < -58) return null; // polar - no reliable flavor
  if (lng <= -155 && lat >= 18 && lat <= 23.5) return 'north-america'; // Hawaiʻi
  if (lng < -30) return lat >= 23.5 ? 'north-america' : 'latin-america';
  if (lng < 22) {
    if (lat >= 35.5) return 'europe-west';
    if (lat >= 12) return 'africa-north';
    return 'africa-sub';
  }
  if (lng < 33) {
    if (lat >= 44) return 'europe-east';
    if (lat >= 35.5) return 'europe-west';
    if (lat >= 12) return 'africa-north';
    return 'africa-sub';
  }
  if (lng < 62) {
    if (lat >= 41) return lng >= 46 && lat < 55 ? 'central-asia' : 'europe-east';
    if (lat >= 12) return 'middle-east';
    return 'africa-sub';
  }
  if (lng < 97) return lat >= 37 ? 'central-asia' : 'south-asia';
  if (lng < 110) {
    if (lat >= 37) return 'central-asia';
    if (lat >= 20) return 'east-asia';
    if (lat <= -10) return 'oceania';
    return 'southeast-asia';
  }
  if (lng < 145) {
    if (lat <= -10) return 'oceania';
    if (lat >= 20) return 'east-asia';
    return 'southeast-asia';
  }
  return lat < 0 ? 'oceania' : 'east-asia';
}

/** Best-effort region for a place: country table → lat/lng band → 'global'. */
function regionOfPlace(place: PlaceImageInput): PoolRegion {
  return regionOfCountry(place.country) ?? regionFromLatLng(place.lat, place.lng) ?? 'global';
}

// ── classification (category + tags + name cues → category group) ────────────

/** tag vocab → group; checked before name regexes (exact, cheap). */
const TAG_GROUPS: Record<string, PlaceCategoryGroup> = {
  // worship - specific religions first
  mosque: 'mosque',
  masjid: 'mosque',
  synagogue: 'synagogue',
  shul: 'synagogue',
  church: 'church',
  cathedral: 'church',
  basilica: 'church',
  chapel: 'church',
  abbey: 'church',
  monastery: 'church',
  convent: 'church',
  minster: 'church',
  kovil: 'temple-hindu',
  mandir: 'temple-hindu',
  hindu: 'temple-hindu',
  'hindu-temple': 'temple-hindu',
  buddhist: 'temple-buddhist-shinto',
  shinto: 'temple-buddhist-shinto',
  buddha: 'temple-buddhist-shinto',
  'emerald-buddha': 'temple-buddhist-shinto',
  'reclining-buddha': 'temple-buddhist-shinto',
  pagoda: 'temple-buddhist-shinto',
  stupa: 'temple-buddhist-shinto',
  zen: 'temple-buddhist-shinto',
  wat: 'temple-buddhist-shinto',
  chedi: 'temple-buddhist-shinto',
  'golden-chedi': 'temple-buddhist-shinto',
  prang: 'temple-buddhist-shinto',
  jinja: 'temple-buddhist-shinto',
  taisha: 'temple-buddhist-shinto',
  // generic worship tags (temple, shrine, religious, place_of_worship) are
  // NOT in this map - classifyPlace resolves them via world region.
  madrasa: 'mosque',

  beach: 'beach',
  beachfront: 'beach',
  seaside: 'beach',
  swimming: 'beach',
  snorkel: 'beach',
  snorkeling: 'beach',
  surf: 'beach',
  surfing: 'beach',
  seawall: 'beach',

  museum: 'museum',
  'house museum': 'museum',
  gallery: 'museum',
  antiquities: 'museum',

  cafe: 'cafe',
  cafes: 'cafe',
  coffee: 'cafe',
  kissaten: 'cafe',
  tearoom: 'cafe',
  'tea-house': 'cafe',

  market: 'market-shopping',
  markets: 'market-shopping',
  'night-market': 'market-shopping',
  'flea market': 'market-shopping',
  souk: 'market-shopping',
  bazaar: 'market-shopping',
  hawker: 'market-shopping',
  'street-food': 'market-shopping',
  'street food': 'market-shopping',
  'food-hall': 'market-shopping',
  'food hall': 'market-shopping',
  'food-court': 'market-shopping',
  shopping: 'market-shopping',
  mall: 'market-shopping',
  souvenirs: 'market-shopping',
  handicrafts: 'market-shopping',
  antiques: 'market-shopping',
  spices: 'market-shopping',
  haggling: 'market-shopping',

  park: 'park-garden',
  garden: 'park-garden',
  gardens: 'park-garden',
  'cherry-blossom': 'park-garden',
  orchard: 'park-garden',
  orchids: 'park-garden',
  conservatories: 'park-garden',
  'sculpture-park': 'park-garden',
  'ethnobotanic-garden': 'park-garden',
  botanical: 'park-garden',
  courtyard: 'park-garden',
  picnic: 'park-garden',
  supertrees: 'park-garden',

  views: 'viewpoint',
  viewpoint: 'viewpoint',
  observatory: 'viewpoint',
  sunset: 'viewpoint',
  rooftop: 'viewpoint',
  'photo-spot': 'viewpoint',
  photogenic: 'viewpoint',
  photography: 'viewpoint',
  panorama: 'viewpoint',
  lookout: 'viewpoint',
  skydeck: 'viewpoint',

  nature: 'mountain-nature',
  waterfall: 'mountain-nature',
  forest: 'mountain-nature',
  mountain: 'mountain-nature',
  mountains: 'mountain-nature',
  lake: 'mountain-nature',
  river: 'mountain-nature',
  glacier: 'mountain-nature',
  volcano: 'mountain-nature',
  rainforest: 'mountain-nature',
  cenote: 'mountain-nature',
  'hot-spring': 'mountain-nature',
  'ice cave': 'mountain-nature',
  geothermal: 'mountain-nature',
  canyon: 'mountain-nature',
  desert: 'mountain-nature',
  safari: 'mountain-nature',
  wildlife: 'mountain-nature',
  hike: 'mountain-nature',
  hiking: 'mountain-nature',
  climb: 'mountain-nature',
  island: 'mountain-nature',
  basalt: 'mountain-nature',
  'petrified-waterfall': 'mountain-nature',
  'tectonic-rift': 'mountain-nature',
  'golden-circle': 'mountain-nature',
  'south-coast': 'mountain-nature',
  'cliff path': 'mountain-nature',
  puffins: 'mountain-nature',
  condors: 'mountain-nature',
  'whale-shark': 'mountain-nature',
  deer: 'mountain-nature',
  rainbow: 'mountain-nature',
  lagoon: 'mountain-nature',
  reef: 'mountain-nature',

  historic: 'historic',
  history: 'historic',
  unesco: 'historic',
  ruins: 'historic',
  castle: 'historic',
  palace: 'historic',
  ancient: 'historic',
  medieval: 'historic',
  amphitheatre: 'historic',
  memorial: 'historic',
  heritage: 'historic',
  fortress: 'historic',
  fort: 'historic',
  'historic-site': 'historic',
  'historic-district': 'historic',
  'old-town': 'historic',
  'old-city': 'historic',
  'old-quarter': 'historic',
  'gothic quarter': 'historic',
  cemetery: 'historic',
  prison: 'historic',
  tunnels: 'historic',
  shogun: 'historic',
  pyramid: 'historic',
  citadel: 'historic',
  medina: 'historic',

  skyline: 'cityscape',
  landmark: 'cityscape',
  tower: 'cityscape',
  bridge: 'cityscape',
  statues: 'cityscape',
  fountain: 'cityscape',
  square: 'cityscape',
  piazza: 'cityscape',
  arch: 'cityscape',
  monument: 'cityscape',
  'clock tower': 'cityscape',
  downtown: 'cityscape',
  riverfront: 'cityscape',
  waterfront: 'cityscape',
  harbor: 'cityscape',
  harbour: 'cityscape',
  canals: 'cityscape',
  'canal district': 'cityscape',

  hotel: 'lodging',
  lodging: 'lodging',
  hostel: 'lodging',
  resort: 'lodging',
  ryokan: 'lodging',
  riad: 'lodging',
  guesthouse: 'lodging',

  train: 'transport',
  railway: 'transport',
  metro: 'transport',
  subway: 'transport',
  station: 'transport',
  airport: 'transport',
  ferry: 'transport',
  'cable-car': 'transport',
  funicular: 'transport',
  tram: 'transport',

  // r15-places: thrill venues (waterpark / themepark / games categories) -
  // reuse the generic-attraction pools (activity photos) until dedicated
  // pools exist.
  'theme-park': 'generic-attraction',
  themepark: 'generic-attraction',
  'water-park': 'generic-attraction',
  waterpark: 'generic-attraction',
  rides: 'generic-attraction',
  amusement: 'generic-attraction',
  games: 'generic-attraction',
  arcade: 'generic-attraction',
  'go-kart': 'generic-attraction',
  paintball: 'generic-attraction',
  bowling: 'generic-attraction',
  'escape-room': 'generic-attraction',
  'laser-tag': 'generic-attraction',
  'adventure-park': 'generic-attraction',

  food: 'food-restaurant',
  restaurant: 'food-restaurant',
  ramen: 'food-restaurant',
  sushi: 'food-restaurant',
  dinner: 'food-restaurant',
  lunch: 'food-restaurant',
  brunch: 'food-restaurant',
  breakfast: 'food-restaurant',
  bakery: 'food-restaurant',
  pastry: 'food-restaurant',
  pastries: 'food-restaurant',
  tapas: 'food-restaurant',
  tacos: 'food-restaurant',
  burritos: 'food-restaurant',
  seafood: 'food-restaurant',
  steakhouse: 'food-restaurant',
  parrilla: 'food-restaurant',
  izakaya: 'food-restaurant',
  okonomiyaki: 'food-restaurant',
  takoyaki: 'food-restaurant',
  kushikatsu: 'food-restaurant',
  'chicken-rice': 'food-restaurant',
  'pastel-de-nata': 'food-restaurant',
  sourdough: 'food-restaurant',
  'lobster soup': 'food-restaurant',
  'hot-dog': 'food-restaurant',
  falafel: 'food-restaurant',
  carbonara: 'food-restaurant',
  'pizza al taglio': 'food-restaurant',
  'solo-dining': 'food-restaurant',
  'fine-dining': 'food-restaurant',
  'tasting-menu': 'food-restaurant',
  'wood-fired': 'food-restaurant',
  'farm-to-table': 'food-restaurant',
  casual: 'food-restaurant',
  sandwiches: 'food-restaurant',
  deli: 'food-restaurant',
  institution: 'food-restaurant',
  mexican: 'food-restaurant',
  peruvian: 'food-restaurant',
  indian: 'food-restaurant',
  czech: 'food-restaurant',
  'local-favorite': 'food-restaurant',
  traditional: 'food-restaurant',
};

/** DB category column ('activity' | 'food' | 'lodging' | 'transport' | …). */
const CATEGORY_GROUPS: Record<string, PlaceCategoryGroup> = {
  food: 'food-restaurant',
  restaurant: 'food-restaurant',
  dining: 'food-restaurant',
  cafe: 'cafe',
  coffee: 'cafe',
  beach: 'beach',
  museum: 'museum',
  hotel: 'lodging',
  lodging: 'lodging',
  accommodation: 'lodging',
  stay: 'lodging',
  transport: 'transport',
  transit: 'transport',
  shopping: 'market-shopping',
  market: 'market-shopping',
  park: 'park-garden',
  garden: 'park-garden',
  nature: 'mountain-nature',
  viewpoint: 'viewpoint',
  landmark: 'cityscape',
  nightlife: 'cityscape',
  bar: 'cityscape',
  historic: 'historic',
  activity: 'generic-attraction',
  sight: 'generic-attraction',
  attraction: 'generic-attraction',
  // r15-places: the new fun categories reuse the activity pools.
  waterpark: 'generic-attraction',
  themepark: 'generic-attraction',
  games: 'generic-attraction',
  adventure: 'generic-attraction',
};

/**
 * Classify a place into a display category group from its DB category, tag
 * vocabulary and name cues. Religion-specific worship wins over generic
 * "temple"/"shrine", which is resolved by world region (south-asia → hindu;
 * east/southeast-asia → buddhist/shinto; elsewhere → historic ruins).
 */
export function classifyPlace(place: PlaceImageInput): PlaceCategoryGroup {
  const tags = (place.tags ?? []).map((t) => t.toLowerCase().trim());
  const name = (place.name ?? '').toLowerCase();
  const cat = (place.category ?? '').toLowerCase().trim();
  const region = regionOfPlace(place);

  // 1. exact tag hits - place tag ORDER must not matter, so collect all
  //    matches and resolve by fixed priority (worship > practical > scenery).
  const GROUP_PRIORITY: PlaceCategoryGroup[] = [
    'mosque',
    'synagogue',
    'church',
    'temple-hindu',
    'temple-buddhist-shinto',
    'lodging',
    'transport',
    'cafe',
    'beach',
    'museum',
    'food-restaurant',
    'market-shopping',
    'park-garden',
    'viewpoint',
    'mountain-nature',
    'historic',
    'cityscape',
  ];
  const hits = new Set<PlaceCategoryGroup>();
  let genericTemple = false;
  for (const t of tags) {
    if (t === 'temple' || t === 'religious' || t === 'place_of_worship') {
      genericTemple = true;
      continue;
    }
    if (t === 'shrine') {
      if (region === 'east-asia' || region === 'southeast-asia' || region === 'global') {
        hits.add('temple-buddhist-shinto');
      } else genericTemple = true;
      continue;
    }
    const g = TAG_GROUPS[t];
    if (g) hits.add(g);
  }
  for (const g of GROUP_PRIORITY) {
    if (hits.has(g)) return g;
  }
  if (genericTemple) return genericTempleGroup(region);

  // 2. name cues (specific religions → generic worship → everything else)
  if (/mosque|masjid|mezquita|moschee|\bcamii\b|\bjami\b/.test(name)) return 'mosque';
  if (/synagogue|\bshul\b/.test(name)) return 'synagogue';
  if (/church|cathedral|chapel|basilica|\babbey\b|minster|monastery|convent|iglesia|[eé]glise|kirche|duomo|\bkirke\b|\bkerk\b/.test(name))
    return 'church';
  if (/kovil|mandir|mandhir|hindu/.test(name)) return 'temple-hindu';
  if (/buddhist|shinto|buddha|pagoda|stupa|\bwat\b|jinja|taisha|\bzen\b|chedi/.test(name))
    return 'temple-buddhist-shinto';
  if (/temple|\bshrine\b/.test(name)) return genericTempleGroup(region);

  if (/beach|playa|plage|praia|\bstrand\b/.test(name)) return 'beach';
  if (/museum|museo|mus[eé]e|\bgallery\b|galleria/.test(name)) return 'museum';
  if (/caf[eé]|coffee|espresso|tea\s?house|tearoom|kissaten/.test(name)) return 'cafe';
  if (/restaurant|ristorante|trattoria|taverna|bistro|brasserie|eatery|\bdiner\b|ramen|sushi|tacos|pizzeria|\bgrill\b|\bkitchen\b|bakery/.test(name))
    return 'food-restaurant';
  // r15-places: thrill venues before the generic `\bpark\b` rule - a "water
  // park" is an activity venue, not a park-garden photo.
  if (/theme\s?park|amusement|water\s?park|aqua\s?park|funfair|go[-\s]?kart|paintball|bowling|escape\s?room|laser\s?tag/.test(name))
    return 'generic-attraction';
  if (/market|bazaar|souk|souq|\bmall\b|shopping|\barcade\b|souvenir/.test(name)) return 'market-shopping';
  if (/\bpark\b|garden|jardin|giardino|botanic/.test(name)) return 'park-garden';
  if (/viewpoint|lookout|observatory|skydeck|belvedere|mirador|panorama|overlook/.test(name)) return 'viewpoint';
  if (/waterfall|\bfalls\b|\bmount\b|\bmt\.|volcano|glacier|canyon|valley|\blake\b|forest|\btrail\b|\bpeak\b|safari|desert|oasis|geyser|lagoon|\breef\b/.test(name))
    return 'mountain-nature';
  if (/castle|palace|\bfort\b|fortress|ruins|citadel|acropolis|old\s?town|medina|colosseum|amphitheat/.test(name))
    return 'historic';
  if (/tower\b|bridge\b|square\b|plaza\b|piazza\b|monument|statue|\barch\b|downtown|skyline/.test(name))
    return 'cityscape';
  if (/hotel|hostel|ryokan|resort|guesthouse|\blodge\b|\binn\b|\briad\b/.test(name)) return 'lodging';
  if (/station\b|airport|ferry|terminal|railway|\bmetro\b|funicular|cable\s?car/.test(name)) return 'transport';

  // 3. coarse DB category
  const g = CATEGORY_GROUPS[cat];
  if (g) return g;

  return 'generic-attraction';
}

function genericTempleGroup(region: PoolRegion): PlaceCategoryGroup {
  if (region === 'south-asia') return 'temple-hindu';
  if (region === 'east-asia' || region === 'southeast-asia') return 'temple-buddhist-shinto';
  if (region === 'global') return 'temple-buddhist-shinto';
  return 'historic'; // "temple" in Europe/ME/Americas usually means ancient ruins
}

// ── deterministic pick ───────────────────────────────────────────────────────
/** FNV-1a 32-bit + splitmix32 finalizer - stable across runs/renders.
 *  The finalizer fixes low-bit clustering: sequential numeric ids from bulk
 *  OSM imports ("2351823", "2351824"…) FNV-hash to values that collide mod
 *  small pool sizes, handing whole import batches the same photo. */
function hash32(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  h = Math.imul(h ^ (h >>> 16), 0x21f0aaad);
  h = Math.imul(h ^ (h >>> 15), 0x735a2d97);
  return (h ^ (h >>> 15)) >>> 0;
}

// ── verified photo pool manifest (Unsplash images.unsplash.com IDs) ─────────
// Every ID below returns HTTP 200 at the exact params baked into `imgUrl`
// (verified by scripts/verify-place-images.ts at commit time). Photos, not
// renders, chosen so that BOTH the category group and the world region read
// correctly (e.g. 'church:south-asia' holds South-Indian churches, not
// European cathedrals; 'beach:southeast-asia' holds Thai/Balinese strands).
//
// Coverage: beach / cityscape / historic / food-restaurant × all 12 regions;
// worship groups × the regions where they are common (+ always a `:global`
// pool); sparse groups share `generic-attraction:<region>` via the chain
// documented at the top of this file.

/** Hotlink-safe Unsplash CDN URL for a pool photo (640px, auto-format). */
function imgUrl(id: string): string {
  return `https://images.unsplash.com/${id}?w=640&q=60&auto=format&fit=crop`;
}

type PoolKey = `${PlaceCategoryGroup}:${PoolRegion}`;

// __POOLS_START__
// exported for tests/scripts (r16 pool-integrity audit)
export const IMAGE_POOL_IDS: Record<string, readonly string[]> = {
  'beach:africa-sub': [
    'photo-1454391304352-2bf4678b1a7a', 'photo-1517480448885-d5c53555ba8c', 'photo-1579258754590-45287513efe7', 'photo-1627913945498-8a3075dcbdd6',
  ],
  'beach:east-asia': [
    'photo-1590050752117-238cb0fb12b1',
  ],
  'beach:europe-west': [
    'photo-1599953068727-4e98147352f0', 'photo-1464790719320-516ecd75af6c',
  ],
  'beach:global': [
    'photo-1507525428034-b723cf961d3e', 'photo-1512343879784-a960bf40e7f2', 'photo-1519046904884-53103b34b206', 'photo-1546708973-b339540b5162', 'photo-1488462237308-ecaa28b729d7',
  ],
  'beach:latin-america': [
    'photo-1483729558449-99ef09a8c325',
  ],
  'beach:north-america': [
    'photo-1514214246283-d427a95c5d2f',
  ],
  'beach:oceania': [
    'photo-1514282401047-d79a71a590e8', 'photo-1573843981267-be1999ff37cd', 'photo-1516091877740-fde016699f2c',
  ],
  'beach:south-asia': [
    'photo-1512100356356-de1b84283e18', 'photo-1543731068-7e0f5beff43a', 'photo-1499793983690-e29da59ef1c2',
  ],
  'beach:southeast-asia': [
    'photo-1559494007-9f5847c49d94', 'photo-1501785888041-af3ef285b470', 'photo-1540541338287-41700207dee6', 'photo-1582719508461-905c673771fd', 'photo-1502784444187-359ac186c5bb',
  ],
  'cafe:global': [
    'photo-1445116572660-236099ec97a0', 'photo-1501339847302-ac426a4a7cbb', 'photo-1554118811-1e0d58224f24', 'photo-1510279931157-4ca63af8a363', 'photo-1503236823255-94609f598e71', 'photo-1561327712-2e0c75a1a6e6', 'photo-1485182708500-e8f1f318ba72', 'photo-1775936785130-b50d01815834',
  ],
  // De-iconified (r16): dropped 3× St Basil's Cathedral + a camera-operator
  // stock shot (wrong content); generic proven churches from church:global.
  'church:europe-east': [
    'photo-1438032005730-c779502df39b', 'photo-1465830014217-b962ea10c996',
  ],
  // De-iconified (r16): dropped Hallgrímskirkja (Reykjavík's landmark).
  'church:europe-west': [
    'photo-1548625149-fc4a29cf7092', 'photo-1465826758852-5c5727495ed9',
  ],
  'church:global': [
    'photo-1438032005730-c779502df39b', 'photo-1465830014217-b962ea10c996', 'photo-1531215304442-a45f5ddb0404',
  ],
  // De-iconified (r16): dropped Plaza de España (Seville) - wrong continent.
  'church:south-asia': [
    'photo-1503916066807-f13ceba21b0b', 'photo-1473177104440-ffee2f376098',
  ],
  'cityscape:africa-north': [
    'photo-1503075131240-fe4b3a7fa473', 'photo-1518105779142-d975f22f1b0a',
  ],
  'cityscape:africa-sub': [
    'photo-1580060839134-75a5edca2e99',
  ],
  // De-iconified (r14): dropped Chicago (wrong continent).
  'cityscape:east-asia': [
    'photo-1480796927426-f609979314bd', 'photo-1542051841857-5f90071e7989', 'photo-1513407030348-c983a97b98d8',
  ],
  // De-iconified (r16): dropped Red Square / St Basil's winter shot.
  'cityscape:europe-east': [
    'photo-1565115164386-01c287236aac', 'photo-1541447271487-09612b3f49f7',
  ],
  // De-iconified (r16): dropped the Eiffel Tower; added a proven generic
  // half-timbered street so Germany/France aren't all Mediterranean shots.
  'cityscape:europe-west': [
    'photo-1570077188670-e3a8d69ac5ff', 'photo-1499856871958-5b9627545d1a', 'photo-1516483638261-f4dbaf036963', 'photo-1533105079780-92b9be482077', 'photo-1467269204594-9661b134dd2b',
  ],
  // De-iconified (r16): dropped Flatiron, Times Square, Battersea Power Station.
  'cityscape:global': [
    'photo-1737183616956-7da135f9a41d', 'photo-1587825293361-a1c114a39e8d',
  ],
  'cityscape:latin-america': [
    'photo-1546178806-764c688238c0',
  ],
  // De-iconified (r16): dropped Burj Al Arab.
  'cityscape:middle-east': [
    'photo-1449824913935-59a10b8d2000', 'photo-1512453979798-5ea266f8880c',
  ],
  // De-iconified (r16): dropped Sydney Opera House + Tower Bridge aerial
  // (both wrong continent AND iconic single landmarks).
  'cityscape:north-america': [
    'photo-1480714378408-67cf0d13bc1b', 'photo-1514565131-fce0801e5785', 'photo-1519501025264-65ba15a82390',
  ],
  // De-iconified (r16): dropped 2× Sydney Opera House.
  'cityscape:oceania': [
    'photo-1613059487993-29fa9791f016',
  ],
  // cityscape:south-asia intentionally empty - every entry was an iconic
  // Mumbai landmark (Sea Link, Marine Drive, Gateway) which read as WRONG on
  // other cities. Falls back to cityscape:global.
  // De-iconified (r16): dropped Marina Bay Sands.
  'cityscape:southeast-asia': [
    'photo-1739952342769-6ec6163d6dee',
  ],
  'food-restaurant:east-asia': [
    'photo-1528360983277-13d401cdc186', 'photo-1600289031464-74d374b64991', 'photo-1563245372-f21724e3856d',
  ],
  'food-restaurant:global': [
    'photo-1414235077428-338989a2e8c0', 'photo-1517248135467-4c7edcad34c4', 'photo-1521017432531-fbd92d768814', 'photo-1555396273-367ea4eb4db5', 'photo-1547592166-23ac45744acd', 'photo-1549488344-1f9b8d2bd1f3', 'photo-1610192244261-3f33de3f55e4', 'photo-1540189549336-e6e99c3679fe',
  ],
  'food-restaurant:latin-america': [
    'photo-1504674900247-0877df9cc836',
  ],
  'food-restaurant:middle-east': [
    'photo-1504754524776-8f4f37790ca0',
  ],
  'food-restaurant:north-america': [
    'photo-1490645935967-10de6ba17061', 'photo-1525351484163-7529414344d8',
  ],
  'food-restaurant:south-asia': [
    'photo-1563379091339-03b21ab4a4f8', 'photo-1589301760014-d929f3979dbc', 'photo-1576092768241-dec231879fc3', 'photo-1596797038530-2c107229654b', 'photo-1668236543090-82eba5ee5976',
  ],
  'food-restaurant:southeast-asia': [
    'photo-1476224203421-9ac39bcb3327',
  ],
  // De-iconified (r16): dropped the Pyramids of Giza; proven generic
  // north-African square instead.
  'generic-attraction:africa-north': [
    'photo-1572252009286-268acec5ca0a',
  ],
  // De-iconified (r16): dropped Machu Picchu (wrong continent!); proven
  // generic sub-Saharan wildlife instead.
  'generic-attraction:africa-sub': [
    'photo-1546182990-dffeafbe841d',
  ],
  'generic-attraction:central-asia': [
    'photo-1605649487212-47bdab064df7',
  ],
  // De-iconified (r14): no Mount Fuji or Great Wall on random East-Asian places.
  'generic-attraction:east-asia': [
    'photo-1540959733332-eab4deabeeaf', 'photo-1480796927426-f609979314bd', 'photo-1545569341-9eb8b30979d9',
  ],
  'generic-attraction:europe-west': [
    'photo-1501532349-1c215c24f718', 'photo-1499856871958-5b9627545d1a', 'photo-1467269204594-9661b134dd2b',
    'photo-1548625149-fc4a29cf7092', 'photo-1469796466635-455ede028aca',
  ],
  'generic-attraction:global': [
    'photo-1433878455169-4698e60005b1', 'photo-1518156959312-07a5380c1261', 'photo-1626621341517-bbf3d9990a23', 'photo-1491555103944-7c647fd857e6', 'photo-1505142468610-359e7d316be0', 'photo-1581337204873-ef36aa186caa',
  ],
  // De-iconified (r16): dropped 2× Machu Picchu + the Alhambra (wrong
  // continent); keeps the region-generic coastal/colonial city shots.
  'generic-attraction:latin-america': [
    'photo-1546178806-764c688238c0', 'photo-1483729558449-99ef09a8c325',
  ],
  'generic-attraction:north-america': [
    'photo-1546436836-07a91091f160', 'photo-1480714378408-67cf0d13bc1b', 'photo-1469854523086-cc02fe5d8800',
    'photo-1565197215033-233f616a7374', 'photo-1514214246283-d427a95c5d2f',
  ],
  'generic-attraction:oceania': [
    'photo-1518098268026-4e89f1a2cd8e', 'photo-1464037866556-6812c9d1c72e',
  ],
  'generic-attraction:south-asia': [
    'photo-1593693397690-362cb9666fc2', 'photo-1544735716-392fe2489ffa', 'photo-1582510003544-4d00b7f74220',
    'photo-1595815771614-ade9d652a65d', 'photo-1602216056096-3b40cc0c9944',
  ],
  // De-iconified (r16): dropped Angkor Wat, Marina Bay Sands + Gardens by
  // the Bay Supertrees; keeps generic islands/karsts.
  'generic-attraction:southeast-asia': [
    'photo-1516690561799-46d8f74f9abf', 'photo-1501785888041-af3ef285b470',
  ],
  // De-iconified (r16): dropped the Pyramids; proven generic historic
  // north-African square + minaret instead.
  'historic:africa-north': [
    'photo-1572252009286-268acec5ca0a', 'photo-1597212618440-806262de4f6b',
  ],
  // De-iconified (r14): swapped the Great Wall for a region-generic dusk pagoda.
  'historic:east-asia': [
    'photo-1614555383820-941c466f1b52', 'photo-1545569341-9eb8b30979d9', 'photo-1657461821555-492764a6940a',
  ],
  // De-iconified (r16): dropped St Peter's Square, the Leaning Tower of
  // Pisa + Eltz Castle; added a proven generic historic street.
  'historic:europe-west': [
    'photo-1467269204594-9661b134dd2b', 'photo-1501532349-1c215c24f718',
  ],
  // De-iconified (r16): dropped the Colosseum + Parthenon; generic
  // historic streets (proven in the europe pools) instead.
  'historic:global': [
    'photo-1729872527247-f1b3c6086a72', 'photo-1467269204594-9661b134dd2b', 'photo-1501532349-1c215c24f718',
  ],
  // De-iconified (r16): dropped Machu Picchu + 2× Chichén Itzá; proven
  // region-generic city shots instead.
  'historic:latin-america': [
    'photo-1546178806-764c688238c0', 'photo-1483729558449-99ef09a8c325',
  ],
  'historic:north-america': [
    'photo-1565197215033-233f616a7374', 'photo-1719339837887-cfa3987bc322',
  ],
  'historic:oceania': [
    'photo-1562774053-701939374585',
  ],
  'historic:south-asia': [
    'photo-1582510003544-4d00b7f74220', 'photo-1595815771614-ade9d652a65d', 'photo-1602216056096-3b40cc0c9944',
  ],
  'lodging:east-asia': [
    'photo-1618237586696-d3690dad22e3',
  ],
  'lodging:global': [
    'photo-1520250497591-112f2f40a3f4', 'photo-1566073771259-6a8506099945', 'photo-1571896349842-33c89424de2d', 'photo-1512917774080-9991f1c4c750', 'photo-1578683010236-d716f9a3f461', 'photo-1582719478250-c89cae4dc85b', 'photo-1596394516093-501ba68a0ba6',
  ],
  'market-shopping:east-asia': [
    'photo-1504805402391-d11b68988fd2', 'photo-1485622204874-8ee4a42c4969', 'photo-1480944657103-7fed22359e1d',
  ],
  'market-shopping:global': [
    'photo-1580793241553-e9f1cce181af', 'photo-1544383835-bda2bc66a55d', 'photo-1460661419201-fd4cecdf8a8b',
  ],
  'market-shopping:south-asia': [
    'photo-1596040033229-a9821ebd058d',
  ],
  'mosque:africa-north': [
    'photo-1572252009286-268acec5ca0a', 'photo-1597212618440-806262de4f6b',
  ],
  'mosque:global': [
    'photo-1558494949-ef010cbdcc31', 'photo-1542816417-0983c9c9ad53',
  ],
  // De-iconified (r16): dropped the Kaaba.
  'mosque:middle-east': [
    'photo-1512632578888-169bbbc64f33', 'photo-1591604129939-f1efa4d9f7fa',
  ],
  // De-iconified (r16): dropped the Taj Mahal; proven generic mosque
  // shots from mosque:global instead.
  'mosque:south-asia': [
    'photo-1558494949-ef010cbdcc31', 'photo-1542816417-0983c9c9ad53',
  ],
  'mosque:southeast-asia': [
    'photo-1519817650390-64a93db51149',
  ],
  'mountain-nature:africa-north': [
    'photo-1457264635001-828d0cbd483e',
  ],
  'mountain-nature:africa-sub': [
    'photo-1546182990-dffeafbe841d',
  ],
  'mountain-nature:central-asia': [
    'photo-1519397165361-ec1538bfd9eb',
  ],
  // De-iconified (r14): no Mount Fuji on every Japanese hill/waterfall -
  // region-neutral misty ranges + high peaks instead.
  'mountain-nature:east-asia': [
    'photo-1506744038136-46273834b3fb', 'photo-1454496522488-7a8e488e8606', 'photo-1544735716-392fe2489ffa',
  ],
  'mountain-nature:global': [
    'photo-1439066615861-d1af74d74000', 'photo-1441974231531-c6227db76b6e', 'photo-1447752875215-b2761acb3c5d', 'photo-1454496522488-7a8e488e8606', 'photo-1464822759023-fed622ff2c3b', 'photo-1470071459604-3b5ec3a7fe05', 'photo-1472214103451-9374bd1c798e', 'photo-1506905925346-21bda4d32df4',
  ],
  'mountain-nature:middle-east': [
    'photo-1604156789095-3348604c0f43',
  ],
  'mountain-nature:north-america': [
    'photo-1469854523086-cc02fe5d8800', 'photo-1629985692757-48648f4f1fc1', 'photo-1488441770602-aed21fc49bd5', 'photo-1470165301023-58dab8118cc9',
  ],
  'mountain-nature:oceania': [
    'photo-1434907652076-85f8401482c3',
  ],
  'mountain-nature:south-asia': [
    'photo-1544735716-392fe2489ffa', 'photo-1595815771614-ade9d652a65d', 'photo-1602216056096-3b40cc0c9944',
  ],
  'mountain-nature:southeast-asia': [
    'photo-1470058869958-2a77ade41c02',
  ],
  // De-iconified (r16): dropped the Vatican Museums spiral staircase;
  // proven generic museum shots from museum:global instead.
  'museum:europe-west': [
    'photo-1524995997946-a1c2e315a42f', 'photo-1554907984-15263bfd63bd', 'photo-1569143955568-8a0a706d0297',
  ],
  'museum:global': [
    'photo-1524995997946-a1c2e315a42f', 'photo-1569143955568-8a0a706d0297', 'photo-1554907984-15263bfd63bd', 'photo-1585036156171-384164a8c675',
  ],
  'park-garden:east-asia': [
    'photo-1554735616-2b7ebad756cc',
  ],
  'park-garden:global': [
    'photo-1585320806297-9794b3e4eeae', 'photo-1501084291732-13b1ba8f0ebc', 'photo-1584973854893-35a3e7c9666a',
  ],
  // De-iconified (r16): dropped Gardens by the Bay Supertrees.
  'park-garden:southeast-asia': [
    'photo-1558005530-a7958896ec60',
  ],
  // De-iconified (r14): dropped Kinkaku-ji (Golden Pavilion) - wrong on any
  // temple that isn't Kinkaku-ji itself.
  'temple-buddhist-shinto:east-asia': [
    'photo-1493976040374-85c8e12f0c0e', 'photo-1545569341-9eb8b30979d9', 'photo-1526481280693-3bfa7568e0f3', 'photo-1649129683265-15a9aaf99f49',
  ],
  'temple-buddhist-shinto:global': [
    'photo-1573322420067-20b6228d9158', 'photo-1534104275488-7ba96ed1a2f6', 'photo-1502919280275-1bed9aca68ab',
  ],
  // De-iconified (r16): dropped Angkor Wat.
  'temple-buddhist-shinto:southeast-asia': [
    'photo-1606231140504-b6ec6cbbbf6b', 'photo-1619870973878-e953baf30700',
  ],
  'temple-hindu:south-asia': [
    'photo-1582510003544-4d00b7f74220', 'photo-1595815771614-ade9d652a65d',
  ],
  'temple-hindu:southeast-asia': [
    'photo-1537953773345-d172ccf13cf1', 'photo-1537996194471-e657df975ab4',
  ],
  'transport:europe-east': [
    'photo-1517309524618-acd6583eaa28',
  ],
  'transport:global': [
    'photo-1474487548417-781cb71495f3', 'photo-1544620347-c4fd4a3d5957', 'photo-1551814360-3c38192c5688',
  ],
  'transport:north-america': [
    'photo-1559943098-e6eee2d2c3c2',
  ],
  'transport:south-asia': [
    'photo-1523509433743-6f42a58221df',
  ],
  'viewpoint:africa-sub': [
    'photo-1503104538136-7491acef4d5d', 'photo-1576485375217-d6a95e34d043',
  ],
  'viewpoint:europe-west': [
    'photo-1664112115778-0ed2f2da97e2', 'photo-1469796466635-455ede028aca', 'photo-1571406761717-16a4756722bc',
  ],
  'viewpoint:global': [
    'photo-1516342670828-3d0fc9b945be', 'photo-1553603227-2358aabe821e', 'photo-1530122037265-a5f1f91d3b99',
  ],
};
// __POOLS_END__

/** `${group}:${region}` → full-URL pool, same keys as IMAGE_POOL_IDS. */
export const IMAGE_POOLS: Record<string, readonly string[]> = Object.fromEntries(
  Object.entries(IMAGE_POOL_IDS).map(([key, ids]) => [key, ids.map(imgUrl)]),
);

function resolvePool(group: PlaceCategoryGroup, region: PoolRegion): readonly string[] | null {
  const exact = IMAGE_POOLS[`${group}:${region}`];
  if (exact?.length) return exact;
  const catGlobal = IMAGE_POOLS[`${group}:global`];
  if (catGlobal?.length) return catGlobal;
  const regionGeneric = IMAGE_POOLS[`generic-attraction:${region}`];
  if (regionGeneric?.length) return regionGeneric;
  const globalGeneric = IMAGE_POOLS['generic-attraction:global'];
  if (globalGeneric?.length) return globalGeneric;
  return null;
}

/**
 * The place's own photo when present; otherwise a stable pick from its
 * (category group × world region) pool with the documented fallback chain;
 * otherwise null (UI keeps its gradient/pin placeholder).
 */
export function placeImageFor(place: PlaceImageInput): string | null {
  const own = place.image?.trim();
  if (own) return own;
  return poolImageFor(place);
}

/** Pool/gradient image only - ignores the place's own photo. Used by
 *  <PlaceImg> as the onError fallback when a real photo 404s. */
export function poolImageFor(place: PlaceImageInput): string | null {
  const hasSignal =
    place.id != null ||
    !!place.name?.trim() ||
    (place.tags?.length ?? 0) > 0 ||
    !!place.category?.trim() ||
    !!place.country?.trim() ||
    (place.lat != null && place.lng != null);
  if (!hasSignal) return null; // nothing to classify - keep the gradient

  const group = classifyPlace(place);
  const region = regionOfPlace(place);
  const pool = resolvePool(group, region);
  if (!pool?.length) return null;
  const seed = String(place.id ?? place.name ?? `${group}:${region}`);
  return pool[hash32(seed) % pool.length]!;
}

/** Exported for scripts/tests: which pool key would serve this place. */
export function poolKeyForPlace(place: PlaceImageInput): PoolKey {
  const group = classifyPlace(place);
  const region = regionOfPlace(place);
  if (IMAGE_POOLS[`${group}:${region}`]?.length) return `${group}:${region}`;
  if (IMAGE_POOLS[`${group}:global`]?.length) return `${group}:global`;
  if (IMAGE_POOLS[`generic-attraction:${region}`]?.length) return `generic-attraction:${region}`;
  return 'generic-attraction:global';
}
