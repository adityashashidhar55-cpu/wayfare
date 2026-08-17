/**
 * Image-pool integrity (r16-culinary).
 *
 * The r16 audit downloaded every pool image and removed iconic
 * single-landmark shots (Eiffel Tower, Colosseum, St Basil's, Sydney Opera
 * House, Machu Picchu, Taj Mahal, …) plus a few wrong-content entries from
 * the generic/region pools - a random place must never be illustrated by one
 * specific world-famous landmark. These tests pin that: none of the removed
 * Unsplash IDs may reappear in ANY pool, every pool stays non-empty, and all
 * IDs keep the expected format.
 */
import { describe, expect, it } from "vitest";
import { IMAGE_POOL_IDS } from "./place-images";

/** Iconic/wrong-content Unsplash photo IDs removed in the r16 audit. */
const REMOVED_ICONIC_IDS = [
  // europe - churches
  "photo-1474690870753-1b92efa1f2d8", // Hallgrímskirkja, Reykjavík
  "photo-1520106212299-d99c443e4568", // St Basil's Cathedral
  "photo-1513326738677-b964603b136d", // St Basil's Cathedral
  "photo-1512495039889-52a3b799c9bc", // St Basil's Cathedral
  "photo-1558618666-fcd25c85cd64", // camera operator (wrong content)
  "photo-1509840841025-9088ba78a826", // Plaza de España (wrong continent)
  // europe - cityscape/historic/museum
  "photo-1502602898657-3e91760cbb34", // Eiffel Tower
  "photo-1547448415-e9f5b28e570d", // Red Square winter
  "photo-1531572753322-ad063cecc140", // St Peter's Square, Vatican
  "photo-1553508978-314fe7d8cf77", // Leaning Tower of Pisa
  "photo-1514539079130-25950c84af65", // Eltz Castle
  "photo-1536419598693-94435e7f9757", // Vatican Museums spiral staircase
  // global pools
  "photo-1552832230-c0197dd311b5", // Colosseum
  "photo-1555993539-1732b0258235", // Parthenon
  "photo-1490004531003-9bda21d243db", // Flatiron Building
  "photo-1496442226666-8d4d0e62e6e9", // Times Square
  "photo-1495292312634-1531ba4dc949", // Battersea Power Station
  // other regions
  "photo-1506973035872-a4ec16b8e8d9", // Sydney Opera House (in north-america!)
  "photo-1513635269975-59663e0ac1ad", // Tower Bridge (in north-america!)
  "photo-1523482580672-f109ba8cb9be", // Sydney Opera House
  "photo-1506374322094-6021fc3926f1", // Sydney Opera House
  "photo-1518684079-3c830dcef090", // Burj Al Arab
  "photo-1574227492706-f65b24c3688a", // Marina Bay Sands
  "photo-1503177119275-0aa32b3a9368", // Pyramids of Giza
  "photo-1504217051514-96afa06398be", // Machu Picchu (in africa-sub!)
  "photo-1516834611397-8d633eaec5d0", // Alhambra (in latin-america!)
  "photo-1522451056252-3fa650a3b8bf", // Machu Picchu
  "photo-1526392060635-9d6019884377", // Machu Picchu
  "photo-1516496636080-14fb876e029d", // Gardens by the Bay Supertrees
  "photo-1602642977157-b7c8b8003afd", // Angkor Wat
  "photo-1628640816547-b7927d8638da", // Pyramids of Giza
  "photo-1503187680590-525b6e7a793f", // Chichén Itzá
  "photo-1501085928709-6e5c3b86ad9c", // Chichén Itzá
  "photo-1587135941948-670b381f08ce", // Taj Mahal
  "photo-1564769625905-50e93615e769", // Kaaba
];

describe("image pool integrity (r16 de-iconification)", () => {
  it("no removed iconic ID appears in any pool", () => {
    const all = Object.entries(IMAGE_POOL_IDS).flatMap(([key, ids]) =>
      ids.map((id) => ({ key, id })),
    );
    for (const removed of REMOVED_ICONIC_IDS) {
      const hits = all.filter((e) => e.id === removed);
      expect(hits, `${removed} still present in ${hits.map((h) => h.key)}`).toEqual([]);
    }
  });

  it("every pool is non-empty with well-formed IDs", () => {
    for (const [key, ids] of Object.entries(IMAGE_POOL_IDS)) {
      expect(ids.length, `${key} must not be empty`).toBeGreaterThan(0);
      for (const id of ids) {
        expect(id, `${key}: ${id}`).toMatch(/^photo-\d+-[0-9a-f]+$/);
      }
    }
  });

  it("europe pools keep regional depth after de-iconification", () => {
    // the europe pools the audit rewrote must keep ≥2 entries each so the
    // hash pick still varies per place
    for (const key of [
      "church:europe-east",
      "church:europe-west",
      "cityscape:europe-east",
      "cityscape:europe-west",
      "historic:europe-west",
      "museum:europe-west",
      "generic-attraction:europe-west",
    ] as const) {
      expect(
        IMAGE_POOL_IDS[key]?.length ?? 0,
        `${key} too thin`,
      ).toBeGreaterThanOrEqual(2);
    }
  });
});
