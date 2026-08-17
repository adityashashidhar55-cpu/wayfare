/**
 * Unit tests for the place-name quality heuristic + famous matching
 * (mission r11-quality). Run: npm test
 */
import { describe, expect, it } from "vitest";
import {
  blurbFor,
  fameScoreFor,
  iconicityOf,
  isGenericName,
  matchWorldFamous,
  normalizeNameKey,
} from "./place-quality";

describe("normalizeNameKey", () => {
  it("strips diacritics, case and punctuation", () => {
    expect(normalizeNameKey("Park Güell")).toBe("park guell");
    expect(normalizeNameKey("CENTRAL MARKET")).toBe("central market");
    expect(normalizeNameKey("Sacré-Cœur")).toBe("sacre coeur");
  });
  it("keeps CJK letters", () => {
    expect(normalizeNameKey("新福菜館本店")).toBe("新福菜館本店");
  });
});

describe("isGenericName", () => {
  it("flags single generic words", () => {
    for (const n of ["Park", "Temple", "Church", "Mosque", "Beach", "Museum", "Zoo", "Market", "Sightseeing", "Viewpoint", "Parking", "Playground", "Plaza", "Square", "Stadium", "Garden"]) {
      expect(isGenericName(n), n).toBe(true);
    }
  });
  it("flags multiword placeholder names", () => {
    for (const n of ["Central Market", "City Center", "City Centre", "View Point", "Old Town", "Main Square", "Central Plaza", "Public Park", "Tourist Attraction", "Photo Point", "City Park", "Public Garden", "Grand Park"]) {
      expect(isGenericName(n), n).toBe(true);
    }
  });
  it("flags ALL-CAPS and localized artifacts", () => {
    expect(isGenericName("CENTRAL MARKET")).toBe(true);
    expect(isGenericName("CHURCH")).toBe(true);
    expect(isGenericName("view point")).toBe(true);
    expect(isGenericName("Parque")).toBe(true);
    expect(isGenericName("Mirador")).toBe(true);
    expect(isGenericName("Piazza")).toBe(true);
    expect(isGenericName("Jardin")).toBe(true);
  });
  it("keeps whitelisted famous exceptions", () => {
    for (const n of ["Central Park", "Park Güell", "Hyde Park", "Grand Bazaar", "South Beach", "Red Square", "Mercado Central", "Boston Common", "Millennium Park", "Bondi Beach"]) {
      expect(isGenericName(n), n).toBe(false);
    }
  });
  it("keeps proper names with a signal word", () => {
    for (const n of ["Meenakshi Temple", "Golden Temple", "Hawa Mahal", "Fushimi Inari Shrine", "Tower Bridge", "City Palace Jaipur", "Marine Drive", "Gateway of India", "Bondi Beach", "Amber Fort", "新福菜館本店"]) {
      expect(isGenericName(n), n).toBe(false);
    }
  });
});

describe("matchWorldFamous", () => {
  it("matches by canonical name + city", () => {
    expect(matchWorldFamous("Taj Mahal", "Agra")?.n).toBe("Taj Mahal");
    expect(matchWorldFamous("Eiffel Tower", "Paris")?.n).toBe("Eiffel Tower");
    expect(matchWorldFamous("Marina Bay Sands", "Singapore")?.n).toBe("Marina Bay Sands");
  });
  it("matches aliases and fuzzy variants", () => {
    expect(matchWorldFamous("Amer Fort", "Jaipur")?.n).toBe("Amber Fort");
    expect(matchWorldFamous("Kinkaku-ji (Golden Pavilion)", "Kyoto")?.n).toBe("Kinkaku-ji");
    expect(matchWorldFamous("Fushimi Inari Taisha", "Kyoto")?.n).toBe("Fushimi Inari Shrine");
    expect(matchWorldFamous("Gion (Hanamikoji Street)", "Kyoto")?.n).toBe("Gion");
  });
  it("scopes by city, same name elsewhere does not match", () => {
    expect(matchWorldFamous("City Palace", "Jaipur")).not.toBeNull();
    expect(matchWorldFamous("City Palace", "Berlin")).toBeNull();
    expect(matchWorldFamous("Jantar Mantar", "Delhi")).toBeNull(); // curated under Jaipur
  });
  it("rejects unknown places", () => {
    expect(matchWorldFamous("Kissa Master", "Kyoto")).toBeNull();
  });
});

describe("fame scoring", () => {
  const base = { id: 1, name: "X", category: "activity", tags: [], rating: 4.5, image: null, verdict: null };
  it("world-famous boost dominates", () => {
    const famous = fameScoreFor({ ...base, name: "Amber Fort", tags: ["historic", "iconic"], rating: 4.7, image: "x.jpg" }, "Jaipur");
    const local = fameScoreFor({ ...base, name: "Random Temple", tags: ["temple"], rating: 4.9, image: null }, "Jaipur");
    expect(famous.world?.n).toBe("Amber Fort");
    expect(famous.fame).toBeGreaterThan(local.fame * 3);
  });
  it("category iconicity ranks landmark > restaurant", () => {
    expect(iconicityOf(["landmark"], "activity")).toBeGreaterThan(iconicityOf(["restaurant"], "food"));
  });
  it("own photo adds a bonus", () => {
    const withPhoto = fameScoreFor({ ...base, image: "a.jpg" }, "Nowhere");
    const without = fameScoreFor({ ...base }, "Nowhere");
    expect(withPhoto.fame).toBeGreaterThan(without.fame);
  });
});

describe("blurbFor", () => {
  it("is deterministic and interpolates the city", () => {
    const p = { id: 7, name: "Hawa Mahal", category: "activity", tags: ["landmark", "iconic"], rating: 4.5, image: null, verdict: null };
    const a = blurbFor(p, "Jaipur", true);
    expect(a).toBe(blurbFor(p, "Jaipur", true));
    expect(a).toContain("Jaipur");
    expect(a).not.toContain("{city}");
  });
  it("picks category-appropriate templates", () => {
    const temple = { id: 1, name: "T", category: "activity", tags: ["temple"], rating: 4.5, image: null, verdict: null };
    expect(blurbFor(temple, "Kyoto", true)).toMatch(/sacred|spiritual|devotion/);
    const museum = { id: 2, name: "M", category: "activity", tags: ["museum"], rating: 4.5, image: null, verdict: null };
    expect(blurbFor(museum, "Kyoto", true)).toMatch(/history|collections|museum/);
  });
});
