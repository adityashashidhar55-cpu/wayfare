/**
 * Curated famous road-trip routes (r10-routes). When a planned corridor
 * overlaps one of these - endpoints near the route's endpoints and at least
 * two of its waypoint cities lying along the corridor polyline - the plan is
 * tagged ("Following the Golden Route") and intercity legs that stay on the
 * route carry a `routeTag` note in their transfer payload.
 *
 * Waypoint coordinates are approximate city centers; matching uses distance
 * thresholds, so precision to ~1km is plenty. Self-contained (no imports from
 * the router) so it can be unit-tested and reused.
 */

export interface PopularRouteWaypoint {
  name: string;
  lat: number;
  lng: number;
}

export interface PopularRoute {
  slug: string;
  name: string;
  countries: string[];
  blurb: string;
  waypoints: PopularRouteWaypoint[];
}

const w = (name: string, lat: number, lng: number): PopularRouteWaypoint => ({ name, lat, lng });

export const POPULAR_ROUTES: PopularRoute[] = [
  {
    slug: "golden-route-japan",
    name: "Golden Route",
    countries: ["Japan"],
    blurb: "Japan's classic first-timer arc: Tokyo's neon, Hakone's onsen and Mt Fuji views, then the temples of Kyoto, Nara and Osaka's street food.",
    waypoints: [
      w("Tokyo", 35.6762, 139.6503),
      w("Hakone", 35.2324, 139.1069),
      w("Kyoto", 35.0116, 135.7681),
      w("Nara", 34.6851, 135.8048),
      w("Osaka", 34.6937, 135.5023),
    ],
  },
  {
    slug: "amalfi-coast",
    name: "Amalfi Coast",
    countries: ["Italy"],
    blurb: "Lemon groves and cliff-hugging villages from Sorrento to Salerno. Positano's pastel cascade and Amalfi's cathedral are the postcards.",
    waypoints: [
      w("Naples", 40.8518, 14.2681),
      w("Sorrento", 40.6263, 14.3758),
      w("Positano", 40.6281, 14.485),
      w("Amalfi", 40.634, 14.6027),
      w("Ravello", 40.6491, 14.6115),
      w("Salerno", 40.6824, 14.7681),
    ],
  },
  {
    slug: "iceland-ring-road",
    name: "Ring Road",
    countries: ["Iceland"],
    blurb: "Route 1 around the whole island: waterfalls, black-sand beaches, glacier lagoons and the north's volcanic moonscapes.",
    waypoints: [
      w("Reykjavik", 64.1466, -21.9426),
      w("Vik", 63.4186, -19.006),
      w("Höfn", 64.2497, -15.2022),
      w("Egilsstaðir", 65.2669, -14.3948),
      w("Akureyri", 65.6885, -18.0878),
      w("Reykjavik", 64.1466, -21.9426),
    ],
  },
  {
    slug: "route-66",
    name: "Route 66",
    countries: ["United States"],
    blurb: "The Mother Road from Chicago to Santa Monica: diners, neon motels, Cadillac Ranch and the Southwest's desert icons.",
    waypoints: [
      w("Chicago", 41.8781, -87.6298),
      w("St. Louis", 38.627, -90.1994),
      w("Oklahoma City", 35.4676, -97.5164),
      w("Amarillo", 35.222, -101.8313),
      w("Albuquerque", 35.0844, -106.6504),
      w("Flagstaff", 35.1983, -111.6513),
      w("Los Angeles", 34.0522, -118.2437),
    ],
  },
  {
    slug: "garden-route",
    name: "Garden Route",
    countries: ["South Africa"],
    blurb: "Cape Town to Port Elizabeth along lagoons, forests and whale coast. Knysna's heads and Tsitsikamma's storms river.",
    waypoints: [
      w("Cape Town", -33.9249, 18.4241),
      w("Hermanus", -34.4187, 19.2345),
      w("Mossel Bay", -34.1831, 22.146),
      w("Knysna", -34.0351, 23.0465),
      w("Plettenberg Bay", -34.0527, 23.3716),
      w("Port Elizabeth", -33.9608, 25.6022),
    ],
  },
  {
    slug: "great-ocean-road",
    name: "Great Ocean Road",
    countries: ["Australia"],
    blurb: "Victoria's surf-and-limestone classic: Bells Beach, rainforest in the Otways and the Twelve Apostles at sunset.",
    waypoints: [
      w("Melbourne", -37.8136, 144.9631),
      w("Torquay", -38.331, 144.3197),
      w("Lorne", -38.5417, 143.9742),
      w("Apollo Bay", -38.7594, 143.6722),
      w("Port Campbell", -38.619, 142.996),
      w("Warrnambool", -38.3818, 142.488),
    ],
  },
  {
    slug: "atlantic-road-norway",
    name: "Atlantic Ocean Road",
    countries: ["Norway"],
    blurb: "Norway's wave-battered causeway between Kristiansund and Molde, stitched through fjord country to Trondheim and Ålesund.",
    waypoints: [
      w("Trondheim", 63.4305, 10.3951),
      w("Kristiansund", 63.1105, 7.7279),
      w("Molde", 62.7375, 7.1591),
      w("Ålesund", 62.4722, 6.1495),
    ],
  },
  {
    slug: "swiss-grand-tour",
    name: "Grand Tour of Switzerland",
    countries: ["Switzerland"],
    blurb: "The 1,600km alpine loop: lakes Lucerne and Geneva, Interlaken's peaks, Zermatt's Matterhorn and St. Moritz glamour.",
    waypoints: [
      w("Zurich", 47.3769, 8.5417),
      w("Lucerne", 47.0502, 8.3093),
      w("Interlaken", 46.6863, 7.8632),
      w("Zermatt", 46.0207, 7.7491),
      w("St. Moritz", 46.4908, 9.8355),
      w("Lugano", 46.0037, 8.9511),
      w("Geneva", 46.2044, 6.1432),
    ],
  },
  {
    slug: "rajasthan-circuit",
    name: "Rajasthan Circuit",
    countries: ["India"],
    blurb: "The land of kings: Jaipur's pink city, Jodhpur's blue maze, Jaisalmer's desert fort and Udaipur's lake palaces.",
    waypoints: [
      w("Jaipur", 26.9124, 75.7873),
      w("Pushkar", 26.4897, 74.5511),
      w("Jodhpur", 26.2389, 73.0243),
      w("Jaisalmer", 26.9157, 70.9083),
      w("Udaipur", 24.5854, 73.7125),
    ],
  },
  {
    slug: "north-coast-500",
    name: "North Coast 500",
    countries: ["United Kingdom"],
    blurb: "Scotland's highland loop from Inverness. Applecross pass, Assynt's wild coast and the far-north beaches of Durness.",
    waypoints: [
      w("Inverness", 57.4778, -4.2247),
      w("Applecross", 57.4336, -5.8097),
      w("Ullapool", 57.8954, -5.1613),
      w("Durness", 58.5686, -4.7469),
      w("John o' Groats", 58.6373, -3.0689),
      w("Wick", 58.4389, -3.0937),
    ],
  },
  {
    slug: "nz-south-island",
    name: "South Island Circuit",
    countries: ["New Zealand"],
    blurb: "Christchurch to the Southern Alps: Tekapo's turquoise, Queenstown adrenaline, Wanaka's lone tree and the glacier coast.",
    waypoints: [
      w("Christchurch", -43.5321, 172.6362),
      w("Lake Tekapo", -44.0047, 170.4771),
      w("Queenstown", -45.0312, 168.6626),
      w("Wanaka", -44.7032, 169.1321),
      w("Franz Josef", -43.3873, 170.1833),
      w("Nelson", -41.2706, 173.284),
    ],
  },
  {
    slug: "vietnam-reunification-express",
    name: "Reunification Express Corridor",
    countries: ["Vietnam"],
    blurb: "Hanoi to Saigon along the single-track spine: Ninh Binh's karsts, imperial Hue, Hoi An lanterns and Nha Trang's bay.",
    waypoints: [
      w("Hanoi", 21.0278, 105.8342),
      w("Ninh Binh", 20.2506, 105.9745),
      w("Hue", 16.4637, 107.5909),
      w("Hoi An", 15.8801, 108.338),
      w("Nha Trang", 12.2388, 109.1967),
      w("Ho Chi Minh City", 10.8231, 106.6297),
    ],
  },
  {
    slug: "trans-siberian",
    name: "Trans-Siberian",
    countries: ["Russia"],
    blurb: "The longest railway on Earth: Moscow to Vladivostok past the Urals, Novosibirsk and Lake Baikal's shore at Irkutsk.",
    waypoints: [
      w("Moscow", 55.7558, 37.6173),
      w("Kazan", 55.7887, 49.1221),
      w("Yekaterinburg", 56.8389, 60.6057),
      w("Novosibirsk", 55.0084, 82.9357),
      w("Irkutsk", 52.2864, 104.305),
      w("Vladivostok", 43.1155, 131.8855),
    ],
  },
  {
    slug: "pan-american-highlights",
    name: "Pan-American Highlights",
    countries: ["Mexico", "Guatemala", "Panama", "Colombia", "Ecuador", "Peru"],
    blurb: "The Americas' overland spine at its best: Oaxaca's kitchens, Antigua's volcanoes, the Darién hop, Andean Quito and Cusco.",
    waypoints: [
      w("Mexico City", 19.4326, -99.1332),
      w("Oaxaca", 17.0732, -96.7266),
      w("Antigua Guatemala", 14.5586, -90.7295),
      w("Panama City", 8.9824, -79.5199),
      w("Cartagena", 10.391, -75.4794),
      w("Quito", -0.1807, -78.4678),
      w("Cusco", -13.532, -71.9675),
    ],
  },
  {
    slug: "silk-road-uzbekistan",
    name: "Silk Road: Samarkand to Khiva",
    countries: ["Uzbekistan"],
    blurb: "Timurid turquoise domes and desert caravanserais. Samarkand's Registan, Bukhara's old town and Khiva's walled museum-city.",
    waypoints: [
      w("Tashkent", 41.2995, 69.2401),
      w("Samarkand", 39.627, 66.975),
      w("Bukhara", 39.7747, 64.4286),
      w("Khiva", 41.3783, 60.3639),
    ],
  },
  {
    slug: "romantische-strasse",
    name: "Romantische Straße",
    countries: ["Germany"],
    blurb: "Germany's Romantic Road: Würzburg's Residenz, Rothenburg's medieval walls and Neuschwanstein country at Füssen.",
    waypoints: [
      w("Würzburg", 49.7913, 9.9534),
      w("Rothenburg ob der Tauber", 49.3768, 10.1788),
      w("Dinkelsbühl", 49.0695, 10.3192),
      w("Augsburg", 48.3705, 10.8978),
      w("Füssen", 47.5696, 10.7004),
    ],
  },
  {
    slug: "wild-atlantic-way",
    name: "Wild Atlantic Way",
    countries: ["Ireland"],
    blurb: "Ireland's western seaboard: Killarney's lakes, Dingle's pubs, the Cliffs of Moher coast and Donegal's empty headlands.",
    waypoints: [
      w("Cork", 51.8985, -8.4756),
      w("Killarney", 52.0599, -9.5044),
      w("Dingle", 52.1409, -10.2676),
      w("Galway", 53.2707, -9.0568),
      w("Westport", 53.8021, -9.5142),
      w("Donegal", 54.6538, -8.1096),
    ],
  },
  {
    slug: "trolltunga-loop",
    name: "Trolltunga & Hardanger Loop",
    countries: ["Norway"],
    blurb: "Bergen to the fjord interior: the Trolltunga ledge above Ringedalsvatnet, Vøringsfossen falls and Flåm's railway.",
    waypoints: [
      w("Bergen", 60.3913, 5.3221),
      w("Odda", 60.0691, 6.5458),
      w("Trolltunga", 60.1242, 6.74),
      w("Voss", 60.6287, 6.4142),
      w("Flåm", 60.8625, 7.1135),
    ],
  },
  {
    slug: "cappadocia-circuit",
    name: "Cappadocia Circuit",
    countries: ["Turkey"],
    blurb: "Fairy chimneys and cave hotels: Göreme's open-air museum, Uçhisar's castle rock, Avanos pottery and the Ihlara gorge.",
    waypoints: [
      w("Kayseri", 38.7205, 35.4826),
      w("Göreme", 38.6431, 34.83),
      w("Ürgüp", 38.631, 34.912),
      w("Uçhisar", 38.6285, 34.811),
      w("Avanos", 38.7151, 34.8467),
    ],
  },
  {
    slug: "peloponnese-loop",
    name: "Peloponnese Loop",
    countries: ["Greece"],
    blurb: "Mythic Greece around the peninsula: Nafplio's venetian port, Monemvasia's rock, ancient Olympia and Delphi's oracle.",
    waypoints: [
      w("Athens", 37.9838, 23.7275),
      w("Nafplio", 37.5673, 22.8017),
      w("Monemvasia", 36.6876, 23.0561),
      w("Kalamata", 37.0391, 22.1125),
      w("Olympia", 37.6387, 21.63),
      w("Patras", 38.2466, 21.7346),
      w("Delphi", 38.48, 22.4944),
    ],
  },
  {
    slug: "baja-california",
    name: "Baja California Peninsula",
    countries: ["Mexico"],
    blurb: "The Transpeninsular highway: fish tacos in Ensenada, gray-whale lagoons at Guerrero Negro, Loreto's missions and Cabo's arch.",
    waypoints: [
      w("Tijuana", 32.5149, -117.0382),
      w("Ensenada", 31.8667, -116.5964),
      w("Guerrero Negro", 27.9781, -114.0611),
      w("Loreto", 26.0118, -111.3477),
      w("La Paz", 24.1426, -110.3128),
      w("Cabo San Lucas", 22.8905, -109.9167),
    ],
  },
  {
    slug: "cabot-trail",
    name: "Cabot Trail",
    countries: ["Canada"],
    blurb: "Cape Breton's cliff-and-highland loop: Acadian Chéticamp, Skyline Trail moose and Celtic music in Baddeck.",
    waypoints: [
      w("Halifax", 44.6488, -63.5752),
      w("Baddeck", 46.0999, -60.754),
      w("Chéticamp", 46.6375, -61.0147),
      w("Ingonish", 46.64, -60.4029),
      w("Sydney", 46.1368, -60.1831),
    ],
  },
  {
    slug: "karakoram-highway",
    name: "Karakoram Highway",
    countries: ["Pakistan", "China"],
    blurb: "The eighth-wonder road over the Khunjerab Pass: Gilgit's bazaars, Hunza's apricot valleys and Kashgar's old city.",
    waypoints: [
      w("Islamabad", 33.6844, 73.0479),
      w("Gilgit", 35.9208, 74.3144),
      w("Karimabad (Hunza)", 36.3167, 74.65),
      w("Passu", 36.47, 74.89),
      w("Tashkurgan", 37.7753, 75.2281),
      w("Kashgar", 39.4677, 75.9938),
    ],
  },
  {
    slug: "danube-bend",
    name: "Danube Bend",
    countries: ["Hungary", "Slovakia", "Austria"],
    blurb: "The Danube's great curve: Budapest's baths, Szentendre's artists, Esztergom's basilica and on to Bratislava and Vienna.",
    waypoints: [
      w("Budapest", 47.4979, 19.0402),
      w("Szentendre", 47.6692, 19.0756),
      w("Visegrád", 47.732, 18.9709),
      w("Esztergom", 47.7928, 18.7415),
      w("Bratislava", 48.1486, 17.1077),
      w("Vienna", 48.2082, 16.3738),
    ],
  },
  {
    slug: "alsace-wine-route",
    name: "Alsace Wine Route",
    countries: ["France"],
    blurb: "Half-timbered villages under the Vosges: Strasbourg's cathedral, Riquewihr's ramparts and Colmar's Little Venice.",
    waypoints: [
      w("Strasbourg", 48.5734, 7.7521),
      w("Obernai", 48.4624, 7.4817),
      w("Riquewihr", 48.1668, 7.2973),
      w("Colmar", 48.0777, 7.3582),
      w("Eguisheim", 48.0433, 7.3067),
      w("Mulhouse", 47.7508, 7.3359),
    ],
  },
  {
    slug: "douro-valley",
    name: "Douro Valley",
    countries: ["Portugal"],
    blurb: "Terraced port-wine country: Porto's lodges, the Régua–Pinhão river road and quinta viewpoints all the way upriver.",
    waypoints: [
      w("Porto", 41.1579, -8.6291),
      w("Peso da Régua", 41.1649, -7.787),
      w("Pinhão", 41.1916, -7.5467),
      w("Vila Real", 41.3006, -7.7441),
      w("Lamego", 41.0974, -7.8099),
    ],
  },
  {
    slug: "atlas-mountains-loop",
    name: "Atlas Mountains & Sahara Loop",
    countries: ["Morocco"],
    blurb: "Marrakech over the Tizi n'Tichka: Aït Benhaddou's ksar, Dadès gorges, Merzouga's dunes and medieval Fes.",
    waypoints: [
      w("Marrakech", 31.6295, -7.9811),
      w("Aït Benhaddou", 31.047, -7.1319),
      w("Ouarzazate", 30.9335, -6.937),
      w("Boumalne Dades", 31.3667, -5.9833),
      w("Merzouga", 31.0802, -4.0134),
      w("Fes", 34.0181, -5.0078),
    ],
  },
  {
    slug: "yucatan-peninsula",
    name: "Yucatán Peninsula",
    countries: ["Mexico"],
    blurb: "Maya country: Cancún's cenotes, Chichén Itzá, Mérida's mansions, Campeche's walls and Tulum's clifftop ruins.",
    waypoints: [
      w("Cancún", 21.1619, -86.8515),
      w("Valladolid", 20.6896, -88.2011),
      w("Chichén Itzá", 20.6843, -88.5678),
      w("Mérida", 20.9674, -89.5926),
      w("Campeche", 19.8301, -90.5349),
      w("Tulum", 20.2114, -87.4654),
    ],
  },
  {
    slug: "slovenia-emerald-loop",
    name: "Slovenia Emerald Loop",
    countries: ["Slovenia"],
    blurb: "The emerald circuit: Lake Bled's island church, the Soča valley's rapids, Piran's venetian square and Postojna's caves.",
    waypoints: [
      w("Ljubljana", 46.0569, 14.5058),
      w("Lake Bled", 46.3683, 14.1146),
      w("Kobarid", 46.2478, 13.5864),
      w("Piran", 45.5288, 13.5684),
      w("Postojna", 45.7749, 14.2137),
    ],
  },
  {
    slug: "taiwan-round-island",
    name: "Taiwan Round-Island",
    countries: ["Taiwan"],
    blurb: "The huandao loop: Taipei's night markets, Taroko gorge at Hualien, Kenting's beaches and Sun Moon Lake's cycling shore.",
    waypoints: [
      w("Taipei", 25.033, 121.5654),
      w("Hualien", 23.9915, 121.6212),
      w("Taitung", 22.7583, 121.1444),
      w("Kenting", 21.9483, 120.7798),
      w("Kaohsiung", 22.6273, 120.3014),
      w("Sun Moon Lake", 23.8573, 120.9159),
      w("Taichung", 24.1477, 120.6736),
    ],
  },
];

// ── Matching ─────────────────────────────────────────────────────────────────
type LatLng = { lat: number; lng: number };

function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number) {
  const R = 6371;
  const toRad = (v: number) => (v * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

/** Km from `p` to the segment a→b (planar approximation, fine ≤ a few °). */
function segmentKm(p: LatLng, a: LatLng, b: LatLng): number {
  const lat0 = (a.lat + b.lat + p.lat) / 3;
  const kx = 111.32 * Math.cos((lat0 * Math.PI) / 180);
  const ky = 110.574;
  const px = p.lng * kx;
  const py = p.lat * ky;
  const ax = a.lng * kx;
  const ay = a.lat * ky;
  const bx = b.lng * kx;
  const by = b.lat * ky;
  const dx = bx - ax;
  const dy = by - ay;
  const len2 = dx * dx + dy * dy;
  let t = len2 ? ((px - ax) * dx + (py - ay) * dy) / len2 : 0;
  t = Math.max(0, Math.min(1, t));
  const cx = ax + t * dx;
  const cy = ay + t * dy;
  return Math.hypot(px - cx, py - cy);
}

/** Min km from `p` to the piecewise-linear chain through `pts`. */
function chainKm(p: LatLng, pts: LatLng[]): number {
  if (!pts.length) return Infinity;
  let best = Infinity;
  for (let i = 0; i < pts.length; i++) {
    const d =
      i < pts.length - 1
        ? segmentKm(p, pts[i]!, pts[i + 1]!)
        : haversineKm(p.lat, p.lng, pts[i]!.lat, pts[i]!.lng);
    if (d < best) best = d;
  }
  return best;
}

export interface PopularRouteMatch {
  route: PopularRoute;
  /** Route waypoints lying within 80km of the planned corridor. */
  matchedWaypoints: PopularRouteWaypoint[];
}

const MATCH_KM = 80;

/**
 * Match a planned corridor against the curated routes. A route matches when
 * the trip's endpoints sit near the route's own endpoints (either direction -
 * for loop routes, one endpoint near the loop anchor and the other near any
 * waypoint) AND at least two of its waypoint cities lie within 80km of the
 * corridor polyline. The highest-overlap route wins.
 */
export function matchPopularRoute(
  polyline: [number, number][], // [lng, lat] pairs
  origin: LatLng,
  dest: LatLng,
): PopularRouteMatch | null {
  if (polyline.length < 2) return null;
  // Downsample long polylines - matching only needs ~10km resolution.
  const stride = Math.max(1, Math.ceil(polyline.length / 240));
  const pts: LatLng[] = [];
  for (let i = 0; i < polyline.length; i += stride) {
    pts.push({ lat: polyline[i]![1], lng: polyline[i]![0] });
  }
  pts.push({ lat: polyline[polyline.length - 1]![1], lng: polyline[polyline.length - 1]![0] });

  const nearCorridor = (p: LatLng) => chainKm(p, pts);

  let best: PopularRouteMatch | null = null;
  for (const route of POPULAR_ROUTES) {
    const wps = route.waypoints;
    if (wps.length < 2) continue;
    const first = wps[0]!;
    const last = wps[wps.length - 1]!;
    const isLoop = haversineKm(first.lat, first.lng, last.lat, last.lng) <= 20;
    const near = (a: LatLng, b: LatLng) => haversineKm(a.lat, a.lng, b.lat, b.lng) <= MATCH_KM;

    let endpointHit = (near(origin, first) && near(dest, last)) || (near(origin, last) && near(dest, first));
    if (!endpointHit && isLoop) {
      // Loop route: one trip endpoint at the anchor, the other anywhere on the loop.
      const nearAny = (p: LatLng) => wps.some((x) => near(p, x));
      endpointHit = (near(origin, first) && nearAny(dest)) || (near(dest, first) && nearAny(origin));
    }
    if (!endpointHit) continue;

    const matched = wps.filter((x) => nearCorridor(x) <= MATCH_KM);
    // Dedupe loop anchors (first == last appears twice).
    const seen = new Set<string>();
    const unique = matched.filter((x) => (seen.has(x.name) ? false : (seen.add(x.name), true)));
    if (unique.length < 2) continue;
    if (!best || unique.length > best.matchedWaypoints.length) {
      best = { route, matchedWaypoints: unique };
    }
  }
  return best;
}

/**
 * Does an intercity leg (from→to) follow the matched route? Both endpoints
 * within 80km of the route's waypoint chain (segments between waypoints, so
 * in-between cities like Nagoya on the Golden Route still qualify).
 */
export function legFollowsRoute(match: PopularRouteMatch, from: LatLng, to: LatLng): boolean {
  const chain = match.route.waypoints.map((x) => ({ lat: x.lat, lng: x.lng }));
  return chainKm(from, chain) <= MATCH_KM && chainKm(to, chain) <= MATCH_KM;
}
