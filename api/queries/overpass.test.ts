import { describe, expect, it } from "vitest";
import { classifyMarketplace, normalizeElement, type OverpassElement } from "./overpass";
import { isStatueLike, styleMatchScore, tagsForStyles } from "../lib/style-map";

/** r11 suggestion-quality classification rules (see r11-apifix mission). */

const node = (id: number, tags: Record<string, string>): OverpassElement => ({
  type: "node",
  id,
  lat: 26.9,
  lon: 75.8,
  tags,
});

describe("classifyMarketplace", () => {
  it("vegetable/produce markets are shopping, not food", () => {
    expect(classifyMarketplace("City Vegetable Market")).toBe("shopping");
    expect(classifyMarketplace("Sabzi Mandi")).toBe("shopping");
    expect(classifyMarketplace("Wholesale Fish Market")).toBe("shopping");
  });

  it("prepared-food markets are food", () => {
    expect(classifyMarketplace("Newton Food Centre")).toBe("food");
    expect(classifyMarketplace("Lau Pa Sat Hawker Centre")).toBe("food");
    expect(classifyMarketplace("Chiang Mai Night Market")).toBe("food");
    expect(classifyMarketplace("Grand Food Hall")).toBe("food");
  });

  it("a cuisine tag signals prepared food", () => {
    expect(classifyMarketplace("Mercado Central", { cuisine: "mexican" })).toBe("food");
  });

  it("ambiguous markets default to shopping", () => {
    expect(classifyMarketplace("Johari Bazaar")).toBe("shopping");
  });
});

describe("normalizeElement classification", () => {
  it("amenity=marketplace vegetable market → category shopping, tags market+shopping", () => {
    const row = normalizeElement(node(1, { amenity: "marketplace", name: "City Vegetable Market" }), "Jaipur", "India");
    expect(row).not.toBeNull();
    expect(row!.category).toBe("shopping");
    expect(row!.tags).toContain("market");
    expect(row!.tags).toContain("shopping");
    expect(row!.styles ?? []).not.toContain("food");
  });

  it("amenity=marketplace hawker centre → category food", () => {
    const row = normalizeElement(node(2, { amenity: "marketplace", name: "Maxwell Food Centre" }), "Singapore", "Singapore");
    expect(row!.category).toBe("food");
    expect(row!.tags).toContain("food");
    expect(row!.styles ?? []).toContain("food");
  });

  it("captures diet:* and cuisine into place tags", () => {
    const row = normalizeElement(
      node(3, { amenity: "restaurant", name: "Anna Mess", "diet:vegetarian": "yes", cuisine: "south_indian" }),
      "Chennai",
      "India",
    );
    expect(row!.tags).toContain("vegetarian");
    expect(row!.tags).toContain("south-indian");
  });

  it("bars get the nightlife style + tag", () => {
    const row = normalizeElement(node(4, { amenity: "bar", name: "Titos Lane Bar" }), "Goa", "India");
    expect(row!.styles ?? []).toContain("nightlife");
    expect(row!.tags).toContain("nightlife");
  });

  it("nightclubs get nightlife + club tags and the nightlife style", () => {
    const row = normalizeElement(node(5, { amenity: "nightclub", name: "Club Cubana" }), "Goa", "India");
    expect(row!.styles ?? []).toContain("nightlife");
    expect(row!.tags).toContain("club");
  });

  it("leisure=water_park → waterpark category + water-park/rides tags + adventure style (r15)", () => {
    const row = normalizeElement(node(9, { leisure: "water_park", name: "Splash World" }), "Goa", "India");
    expect(row).not.toBeNull();
    expect(row!.category).toBe("waterpark");
    expect(row!.tags).toContain("water-park");
    expect(row!.tags).toContain("rides");
    expect(row!.styles ?? []).toContain("adventure");
  });

  it("tourism=theme_park → themepark category, adventure style (r15)", () => {
    const row = normalizeElement(node(10, { tourism: "theme_park", name: "Fun Kingdom" }), "Goa", "India");
    expect(row!.category).toBe("themepark");
    expect(row!.tags).toContain("theme-park");
    expect(row!.styles ?? []).toContain("adventure");
  });

  it("leisure=amusement_arcade → games category (r15)", () => {
    const row = normalizeElement(node(11, { leisure: "amusement_arcade", name: "Pixel Arcade" }), "Tokyo", "Japan");
    expect(row!.category).toBe("games");
    expect(row!.tags).toContain("arcade");
    expect(row!.tags).toContain("games");
  });

  it("tourism=zoo is family, NEVER adventure (r15)", () => {
    const row = normalizeElement(node(12, { tourism: "zoo", name: "City Zoological Gardens" }), "Mysuru", "India");
    expect(row!.styles ?? []).not.toContain("adventure");
    expect(row!.styles ?? []).toContain("family");
    expect(row!.tags).toContain("family");
  });

  it("parking lots and parking-like names are rejected (r15)", () => {
    expect(normalizeElement(node(13, { amenity: "parking", name: "Central Garage" }), "Paris", "France")).toBeNull();
    expect(normalizeElement(node(14, { leisure: "park", name: "Shibuya Parking" }), "Tokyo", "Japan")).toBeNull();
    expect(normalizeElement(node(15, { tourism: "attraction", name: "渋谷駐車場" }), "Tokyo", "Japan")).toBeNull();
    expect(normalizeElement(node(16, { amenity: "restaurant", name: "Parcheggio Trattoria" }), "Rome", "Italy")).toBeNull();
  });

  it("memorials/statues/artworks are tagged statue-like", () => {
    const memorial = normalizeElement(node(6, { historic: "memorial", name: "Soldiers Memorial" }), "Delhi", "India");
    expect(memorial!.tags).toContain("memorial");
    expect(isStatueLike(memorial!)).toBe(true);

    const artwork = normalizeElement(node(7, { tourism: "artwork", name: "Bronze Horse" }), "Delhi", "India");
    expect(artwork!.tags).toContain("artwork");
    expect(isStatueLike(artwork!)).toBe(true);

    const statue = normalizeElement(node(8, { man_made: "statue", name: "Statue of Unity Replica" }), "Kevadia", "India");
    expect(statue!.tags).toContain("statue");
    expect(isStatueLike(statue!)).toBe(true);
  });
});

describe("style map", () => {
  it("nightlife style maps to bar/club/live-music tags", () => {
    const tags = tagsForStyles(["nightlife"]);
    expect(tags.has("bar")).toBe(true);
    expect(tags.has("pub")).toBe(true);
    expect(tags.has("nightclub")).toBe(true);
    expect(tags.has("live-music")).toBe(true);
  });

  it("a nightlife ask scores a bar far above a statue", () => {
    const styles = new Set(["nightlife", "music"]);
    const bar = { styles: ["food"], tags: ["nightlife", "bar"] };
    const statue = { styles: ["historical"], tags: ["historic", "memorial"] };
    expect(styleMatchScore(bar, styles)).toBeGreaterThan(styleMatchScore(statue, styles));
  });

  it("canonical styles still score via the styles column", () => {
    const score = styleMatchScore({ styles: ["historical"], tags: [] }, new Set(["historical"]));
    expect(score).toBe(10);
  });
});

// r13-photos: real-photo capture from OSM tags at import time.
describe("r13-photos: OSM photo capture in normalizeElement", () => {
  it("image=<https url> is used as-is with photoSource 'osm'", () => {
    const row = normalizeElement(
      node(20, {
        tourism: "attraction",
        name: "Hawa Mahal",
        image: "https://upload.wikimedia.org/wikipedia/commons/9/9f/Hawa_Mahal_2011.jpg",
      }),
      "Jaipur",
      "India",
    );
    expect(row!.image).toBe("https://upload.wikimedia.org/wikipedia/commons/9/9f/Hawa_Mahal_2011.jpg");
    expect(row!.photoSource).toBe("osm");
  });

  it("non-http image values are ignored", () => {
    const row = normalizeElement(
      node(21, { tourism: "museum", name: "City Museum", image: "File:Foo.jpg" }),
      "Jaipur",
      "India",
    );
    expect(row!.image).toBeNull();
    expect(row!.photoSource).toBeNull();
  });

  it("wikimedia_commons=File:… becomes a Special:FilePath width=800 URL", () => {
    const row = normalizeElement(
      node(22, {
        historic: "palace",
        name: "Amber Palace",
        wikimedia_commons: "File:Amber Fort main entrance.jpg",
      }),
      "Jaipur",
      "India",
    );
    expect(row!.image).toBe(
      "https://commons.wikimedia.org/wiki/Special:FilePath/Amber_Fort_main_entrance.jpg?width=800",
    );
    expect(row!.photoSource).toBe("osm");
  });

  it("wikimedia_commons=Category:… is skipped (not a single photo)", () => {
    const row = normalizeElement(
      node(23, { historic: "fort", name: "Nahargarh Fort", wikimedia_commons: "Category:Nahargarh Fort" }),
      "Jaipur",
      "India",
    );
    expect(row!.image).toBeNull();
    expect(row!.photoSource).toBeNull();
  });

  it("no photo tags → image NULL (stock-pool fallback)", () => {
    const row = normalizeElement(node(24, { leisure: "park", name: "Central Park" }), "New York", "United States");
    expect(row!.image).toBeNull();
    expect(row!.photoSource).toBeNull();
  });
});

describe("isPlausiblePlaceQuery (junk-string guard, r19-friends-fix)", () => {
  it("rejects route paths, slashes, control chars and letter-less strings", async () => {
    const { isPlausiblePlaceQuery } = await import("./overpass");
    expect(isPlausiblePlaceQuery("/friends")).toBe(false);
    expect(isPlausiblePlaceQuery("/city/trips")).toBe(false);
    expect(isPlausiblePlaceQuery("a/b")).toBe(false);
    expect(isPlausiblePlaceQuery("back\\slash")).toBe(false);
    expect(isPlausiblePlaceQuery("123 456")).toBe(false);
    expect(isPlausiblePlaceQuery("!!!")).toBe(false);
    expect(isPlausiblePlaceQuery("x")).toBe(false);
    expect(isPlausiblePlaceQuery("")).toBe(false);
  });

  it("accepts real city names incl. spaces, hyphens, apostrophes, non-Latin", async () => {
    const { isPlausiblePlaceQuery } = await import("./overpass");
    expect(isPlausiblePlaceQuery("New York City")).toBe(true);
    expect(isPlausiblePlaceQuery("Winston-Salem")).toBe(true);
    expect(isPlausiblePlaceQuery("N'Djamena")).toBe(true);
    expect(isPlausiblePlaceQuery("São Paulo")).toBe(true);
    expect(isPlausiblePlaceQuery("北京市")).toBe(true);
    expect(isPlausiblePlaceQuery("الرياض")).toBe(true);
  });
});
