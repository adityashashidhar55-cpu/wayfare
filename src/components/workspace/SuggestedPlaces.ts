import { imageForCategory } from "./utils";
import { kidScore } from "@contracts/kids";

export interface SuggestedPlace {
  name: string;
  category: string;
  lat?: number;
  lng?: number;
  address?: string;
  rating?: number;
  durationMin?: number;
  image?: string;
}

export interface PlaceCatalog {
  city: string;
  /** [lng, lat] used to center the map when the trip has no geo stops yet */
  center: [number, number] | null;
  zoom: number;
  suggestions: SuggestedPlace[];
}

const KYOTO: SuggestedPlace[] = [
  {
    name: "Fushimi Inari Shrine",
    category: "activity",
    lat: 34.9671,
    lng: 135.7727,
    address: "68 Fukakusa Yabunouchicho",
    rating: 4.8,
    durationMin: 150,
  },
  {
    name: "Kiyomizu-dera",
    category: "activity",
    lat: 34.9949,
    lng: 135.785,
    address: "1-294 Kiyomizu, Higashiyama",
    rating: 4.7,
    durationMin: 120,
  },
  {
    name: "Arashiyama Bamboo Grove",
    category: "activity",
    lat: 35.017,
    lng: 135.6713,
    address: "Sagaogurayama, Ukyo",
    rating: 4.7,
    durationMin: 90,
  },
  {
    name: "Kinkaku-ji (Golden Pavilion)",
    category: "activity",
    lat: 35.0394,
    lng: 135.7292,
    address: "1 Kinkakujicho, Kita",
    rating: 4.6,
    durationMin: 90,
  },
  {
    name: "Nishiki Market",
    category: "food",
    lat: 35.005,
    lng: 135.7647,
    address: "Nakagyo, Kyoto",
    rating: 4.5,
    durationMin: 90,
  },
  {
    name: "Ichiran Ramen",
    category: "food",
    lat: 35.0037,
    lng: 135.7687,
    address: "Kawaramachi, Nakagyo",
    rating: 4.6,
    durationMin: 60,
  },
  {
    name: "Kissa Master",
    category: "food",
    lat: 35.0095,
    lng: 135.7603,
    address: "Sanjo, Nakagyo",
    rating: 4.9,
    durationMin: 45,
  },
  {
    name: "Hanamikoji Street, Gion",
    category: "activity",
    lat: 35.0037,
    lng: 135.7753,
    address: "Gionmachi, Higashiyama",
    rating: 4.5,
    durationMin: 60,
  },
];

const OSAKA: SuggestedPlace[] = [
  {
    name: "Osaka Castle",
    category: "activity",
    lat: 34.6873,
    lng: 135.5262,
    address: "1-1 Osakajo, Chuo",
    rating: 4.5,
    durationMin: 120,
  },
  {
    name: "Dotonbori",
    category: "activity",
    lat: 34.6687,
    lng: 135.5013,
    address: "Dotonbori, Chuo",
    rating: 4.6,
    durationMin: 120,
  },
  {
    name: "Shinsekai & Tsutenkaku",
    category: "activity",
    lat: 34.6525,
    lng: 135.5063,
    address: "Ebisuhigashi, Naniwa",
    rating: 4.4,
    durationMin: 90,
  },
  {
    name: "Kuromon Ichiba Market",
    category: "food",
    lat: 34.6654,
    lng: 135.5066,
    address: "Nipponbashi, Chuo",
    rating: 4.5,
    durationMin: 90,
  },
  {
    name: "Umeda Sky Building",
    category: "activity",
    lat: 34.7054,
    lng: 135.4897,
    address: "1-1-88 Oyodonaka, Kita",
    rating: 4.5,
    durationMin: 75,
  },
  {
    name: "Sumiyoshi Taisha",
    category: "activity",
    lat: 34.6127,
    lng: 135.4934,
    address: "2-9-89 Sumiyoshi",
    rating: 4.4,
    durationMin: 60,
  },
  {
    name: "Ichiran Ramen Dotonbori",
    category: "food",
    lat: 34.6686,
    lng: 135.501,
    address: "Dotonbori, Chuo",
    rating: 4.6,
    durationMin: 60,
  },
  {
    name: "Nakazakicho vintage lanes",
    category: "shopping",
    lat: 34.7068,
    lng: 135.5055,
    address: "Nakazaki, Kita",
    rating: 4.4,
    durationMin: 90,
  },
];

const NARA: SuggestedPlace[] = [
  {
    name: "Todai-ji",
    category: "activity",
    lat: 34.689,
    lng: 135.8398,
    address: "406-1 Zoshicho",
    rating: 4.8,
    durationMin: 120,
  },
  {
    name: "Nara Park (deer park)",
    category: "activity",
    lat: 34.685,
    lng: 135.843,
    address: "Noboriojicho",
    rating: 4.7,
    durationMin: 120,
  },
  {
    name: "Kasuga Taisha",
    category: "activity",
    lat: 34.6814,
    lng: 135.8485,
    address: "160 Kasuganocho",
    rating: 4.6,
    durationMin: 90,
  },
  {
    name: "Isuien Garden",
    category: "activity",
    lat: 34.6857,
    lng: 135.8372,
    address: "74 Suimoncho",
    rating: 4.6,
    durationMin: 60,
  },
  {
    name: "Naramachi old town",
    category: "shopping",
    lat: 34.6756,
    lng: 135.8314,
    address: "Naramachi",
    rating: 4.4,
    durationMin: 90,
  },
  {
    name: "Nakatanidou mochi",
    category: "food",
    lat: 34.6795,
    lng: 135.8367,
    address: "29 Hashimotocho",
    rating: 4.6,
    durationMin: 30,
  },
  {
    name: "Kofuku-ji",
    category: "activity",
    lat: 34.6829,
    lng: 135.8318,
    address: "48 Noboriojicho",
    rating: 4.5,
    durationMin: 60,
  },
  {
    name: "Mount Wakakusa overlook",
    category: "activity",
    lat: 34.6889,
    lng: 135.8564,
    address: "Zoshicho",
    rating: 4.5,
    durationMin: 90,
  },
];

const TOKYO: SuggestedPlace[] = [
  {
    name: "Senso-ji",
    category: "activity",
    lat: 35.7148,
    lng: 139.7967,
    address: "2-3-1 Asakusa, Taito",
    rating: 4.6,
    durationMin: 120,
  },
  {
    name: "Meiji Shrine",
    category: "activity",
    lat: 35.6764,
    lng: 139.6993,
    address: "1-1 Yoyogikamizonocho",
    rating: 4.6,
    durationMin: 90,
  },
  {
    name: "Shibuya Crossing",
    category: "activity",
    lat: 35.6595,
    lng: 139.7005,
    address: "Shibuya",
    rating: 4.5,
    durationMin: 45,
  },
  {
    name: "teamLab Planets",
    category: "activity",
    lat: 35.6492,
    lng: 139.7898,
    address: "6-1-16 Toyosu, Koto",
    rating: 4.7,
    durationMin: 120,
  },
  {
    name: "Tsukiji Outer Market",
    category: "food",
    lat: 35.6654,
    lng: 139.7707,
    address: "Tsukiji, Chuo",
    rating: 4.5,
    durationMin: 120,
  },
  {
    name: "Shinjuku Gyoen",
    category: "activity",
    lat: 35.6852,
    lng: 139.71,
    address: "11 Naitomachi, Shinjuku",
    rating: 4.6,
    durationMin: 90,
  },
  {
    name: "Tokyo Skytree",
    category: "activity",
    lat: 35.7101,
    lng: 139.8107,
    address: "1-1-2 Oshiage, Sumida",
    rating: 4.5,
    durationMin: 90,
  },
  {
    name: "Takeshita Street, Harajuku",
    category: "shopping",
    lat: 35.6717,
    lng: 139.7031,
    address: "1 Jingumae, Shibuya",
    rating: 4.3,
    durationMin: 60,
  },
];

const LISBON: SuggestedPlace[] = [
  {
    name: "Belém Tower",
    category: "activity",
    lat: 38.6916,
    lng: -9.216,
    address: "Av. Brasília, Belém",
    rating: 4.6,
    durationMin: 90,
  },
  {
    name: "Jerónimos Monastery",
    category: "activity",
    lat: 38.6979,
    lng: -9.206,
    address: "Praça do Império",
    rating: 4.7,
    durationMin: 120,
  },
  {
    name: "Pastéis de Belém",
    category: "food",
    lat: 38.6976,
    lng: -9.2032,
    address: "R. de Belém 84",
    rating: 4.6,
    durationMin: 45,
  },
  {
    name: "Miradouro de Santa Luzia",
    category: "activity",
    lat: 38.7139,
    lng: -9.1304,
    address: "Alfama",
    rating: 4.7,
    durationMin: 45,
  },
  {
    name: "Castelo de São Jorge",
    category: "activity",
    lat: 38.7139,
    lng: -9.1335,
    address: "R. de Santa Cruz",
    rating: 4.6,
    durationMin: 120,
  },
  {
    name: "Time Out Market",
    category: "food",
    lat: 38.7068,
    lng: -9.1459,
    address: "Av. 24 de Julho 49",
    rating: 4.4,
    durationMin: 90,
  },
  {
    name: "Tram 28 ride",
    category: "transport",
    lat: 38.7154,
    lng: -9.1366,
    address: "Martim Moniz",
    rating: 4.4,
    durationMin: 60,
  },
  {
    name: "LX Factory",
    category: "shopping",
    lat: 38.7033,
    lng: -9.1779,
    address: "R. Rodrigues de Faria 103",
    rating: 4.4,
    durationMin: 120,
  },
];

const PARIS: SuggestedPlace[] = [
  {
    name: "Eiffel Tower",
    category: "activity",
    lat: 48.8584,
    lng: 2.2945,
    address: "Champ de Mars",
    rating: 4.7,
    durationMin: 150,
  },
  {
    name: "Louvre Museum",
    category: "activity",
    lat: 48.8606,
    lng: 2.3376,
    address: "Rue de Rivoli",
    rating: 4.8,
    durationMin: 180,
  },
  {
    name: "Musée d'Orsay",
    category: "activity",
    lat: 48.86,
    lng: 2.3266,
    address: "1 Rue de la Légion d’Honneur",
    rating: 4.7,
    durationMin: 150,
  },
  {
    name: "Montmartre & Sacré-Cœur",
    category: "activity",
    lat: 48.8867,
    lng: 2.3431,
    address: "35 Rue du Chevalier de la Barre",
    rating: 4.6,
    durationMin: 150,
  },
  {
    name: "Le Marais walk",
    category: "activity",
    lat: 48.859,
    lng: 2.3622,
    address: "Le Marais",
    rating: 4.5,
    durationMin: 90,
  },
  {
    name: "Du Pain et des Idées",
    category: "food",
    lat: 48.8716,
    lng: 2.3631,
    address: "34 Rue Yves Toudic",
    rating: 4.7,
    durationMin: 30,
  },
  {
    name: "Luxembourg Gardens",
    category: "activity",
    lat: 48.8462,
    lng: 2.3372,
    address: "75006 Paris",
    rating: 4.6,
    durationMin: 75,
  },
  {
    name: "Shakespeare and Company",
    category: "shopping",
    lat: 48.8526,
    lng: 2.347,
    address: "37 Rue de la Bûcherie",
    rating: 4.5,
    durationMin: 45,
  },
];

const GENERIC: SuggestedPlace[] = [
  { name: "Old town walk", category: "activity", durationMin: 90 },
  { name: "Central market", category: "food", durationMin: 75 },
  { name: "Main museum", category: "activity", durationMin: 120 },
  { name: "City viewpoint", category: "activity", durationMin: 45 },
  { name: "Local café stop", category: "food", durationMin: 40 },
  { name: "Botanical garden / park", category: "activity", durationMin: 90 },
  { name: "Craft & souvenir street", category: "shopping", durationMin: 60 },
  { name: "Sunset riverside stroll", category: "activity", durationMin: 60 },
];

const CATALOGS: {
  test: RegExp;
  city: string;
  center: [number, number];
  zoom: number;
  places: SuggestedPlace[];
}[] = [
  {
    test: /kyoto/i,
    city: "Kyoto",
    center: [135.7681, 35.0116],
    zoom: 12,
    places: KYOTO,
  },
  {
    test: /osaka/i,
    city: "Osaka",
    center: [135.5023, 34.6937],
    zoom: 12,
    places: OSAKA,
  },
  {
    test: /nara/i,
    city: "Nara",
    center: [135.8317, 34.6851],
    zoom: 13,
    places: NARA,
  },
  {
    test: /tokyo|japan/i,
    city: "Tokyo",
    center: [139.767, 35.6814],
    zoom: 11,
    places: TOKYO,
  },
  {
    test: /lisbon|lisboa|portugal/i,
    city: "Lisbon",
    center: [-9.1393, 38.7223],
    zoom: 12,
    places: LISBON,
  },
  {
    test: /paris|france/i,
    city: "Paris",
    center: [2.3522, 48.8566],
    zoom: 12,
    places: PARIS,
  },
];

/** Pick a small built-in suggestion catalog by fuzzy-matching the trip destination. */
export function catalogForDestination(destination: string, kids = false): PlaceCatalog {
  for (const c of CATALOGS) {
    if (c.test.test(destination)) {
      return {
        city: c.city,
        center: c.center,
        zoom: c.zoom,
        // Kids mode: stable-sort suggestions by kid-friendliness (parks,
        // castles and zoos first, generic restaurants last).
        suggestions: kids
          ? c.places
              .map((p, i) => ({ p, i }))
              .sort((a, b) => kidScore(b.p) - kidScore(a.p) || a.i - b.i)
              .map(({ p }) => p)
          : c.places,
      };
    }
  }
  return {
    city: destination.split(",")[0] || "your destination",
    center: null,
    zoom: 11,
    suggestions: GENERIC,
  };
}

export function suggestionImage(p: SuggestedPlace): string {
  return p.image ?? imageForCategory(p.category);
}
