import { describe, expect, it } from "vitest";
import { STYLE_TO_TAGS, tagsForStyles } from "./style-map";
import { funCategoryFor, reclassifyStoredRow } from "./classify-place";
import { isParkingLikeName } from "./place-quality";

/** r15-places: adventure mapping, fun categories, market + parking repairs. */

describe("STYLE_TO_TAGS.adventure (r15)", () => {
  it("excludes kids' stuff, no zoo, no family", () => {
    expect(STYLE_TO_TAGS.adventure).not.toContain("zoo");
    expect(STYLE_TO_TAGS.adventure).not.toContain("family");
    const tags = tagsForStyles(["adventure"]);
    expect(tags.has("zoo")).toBe(false);
    expect(tags.has("family")).toBe(false);
    expect(tags.has("playground")).toBe(false);
  });

  it("includes thrill tags", () => {
    for (const t of ["theme-park", "water-park", "rides", "adventure-park", "climbing", "rafting", "zipline", "go-kart", "paintball", "surfing"]) {
      expect(STYLE_TO_TAGS.adventure).toContain(t);
    }
  });

  it("kids' venues stay owned by the family style", () => {
    for (const t of ["zoo", "aquarium", "playground", "family"]) {
      expect(STYLE_TO_TAGS.family).toContain(t);
    }
  });
});

describe("funCategoryFor", () => {
  it("leisure=water_park → waterpark / water-park", () => {
    expect(funCategoryFor({ leisure: "water_park" })).toEqual({ category: "waterpark", tag: "water-park" });
  });
  it("tourism=theme_park → themepark / theme-park", () => {
    expect(funCategoryFor({ tourism: "theme_park" })).toEqual({ category: "themepark", tag: "theme-park" });
  });
  it("games leisure values → games category", () => {
    expect(funCategoryFor({ leisure: "amusement_arcade" })).toEqual({ category: "games", tag: "arcade" });
    expect(funCategoryFor({ leisure: "go_kart" })?.category).toBe("games");
    expect(funCategoryFor({ leisure: "escape_game" })?.tag).toBe("escape-room");
    expect(funCategoryFor({ leisure: "paintball" })?.category).toBe("games");
    expect(funCategoryFor({ leisure: "bowling_alley" })?.category).toBe("games");
  });
  it("unrelated values → null", () => {
    expect(funCategoryFor({ leisure: "park", tourism: "museum" })).toBeNull();
  });
});

describe("isParkingLikeName", () => {
  it("matches parking/rest-area names across languages", () => {
    for (const n of [
      "Shibuya Parking",
      "渋谷駐車場",
      "Parkplatz Zentrum",
      "Parcheggio Centrale",
      "Estacionamiento Norte",
      "Aparcamiento Mayor",
      "Highway Rest Area",
    ]) {
      expect(isParkingLikeName(n)).toBe(true);
    }
  });
  it("leaves real places alone", () => {
    for (const n of ["Central Park", "Park Güell", "Amber Fort", "Maxwell Food Centre"]) {
      expect(isParkingLikeName(n)).toBe(false);
    }
  });
});

describe("reclassifyStoredRow", () => {
  it("vegetable/wholesale markets misfiled as food → shopping (no food tag/style)", () => {
    const r = reclassifyStoredRow({
      name: "Balkhu Vegetable and Fruits Market",
      category: "food",
      tags: ["market", "food", "kid-partial"],
      styles: ["food"],
    });
    expect(r.action).toBe("keep");
    if (r.action !== "keep") return;
    expect(r.category).toBe("shopping");
    expect(r.tags).toContain("market");
    expect(r.tags).toContain("shopping");
    expect(r.tags).not.toContain("food");
    expect(r.styles).not.toContain("food");
  });

  it("prepared-food markets stay food", () => {
    const r = reclassifyStoredRow({
      name: "Maxwell Food Centre",
      category: "food",
      tags: ["market", "food"],
      styles: ["food"],
    });
    expect(r.action).toBe("keep");
    if (r.action !== "keep") return;
    expect(r.category).toBe("food");
  });

  it("Arabic mandi restaurants are NOT markets, untouched", () => {
    const r = reclassifyStoredRow({
      name: "Al-Reem Mandi",
      category: "food",
      tags: ["food", "restaurant"],
      styles: ["food"],
    });
    expect(r.action).toBe("keep");
    if (r.action !== "keep") return;
    expect(r.category).toBe("food");
    expect(r.tags).toContain("food");
  });

  it("water parks tagged family → waterpark category + adventure style", () => {
    const r = reclassifyStoredRow({
      name: "Wonderla Water Park",
      category: "activity",
      tags: ["family"],
      styles: ["family"],
    });
    expect(r.action).toBe("keep");
    if (r.action !== "keep") return;
    expect(r.category).toBe("waterpark");
    expect(r.tags).toContain("water-park");
    expect(r.tags).toContain("rides");
    expect(r.styles).toContain("adventure");
  });

  it("theme parks → themepark category", () => {
    const r = reclassifyStoredRow({
      name: "Imagica Theme Park",
      category: "activity",
      tags: ["family"],
      styles: [],
    });
    expect(r.action).toBe("keep");
    if (r.action !== "keep") return;
    expect(r.category).toBe("themepark");
    expect(r.tags).toContain("theme-park");
    expect(r.styles).toContain("adventure");
  });

  it("go-kart venues → games category, family tag dropped", () => {
    const r = reclassifyStoredRow({
      name: "Torq03 Go-Karting",
      category: "activity",
      tags: ["family"],
      styles: ["adventure"],
    });
    expect(r.action).toBe("keep");
    if (r.action !== "keep") return;
    expect(r.category).toBe("games");
    expect(r.tags).toContain("games");
    expect(r.tags).not.toContain("family");
  });

  it("zoos lose the adventure style and gain family", () => {
    const r = reclassifyStoredRow({
      name: "Bannerghatta Zoo",
      category: "activity",
      tags: ["family"],
      styles: ["adventure"],
    });
    expect(r.action).toBe("keep");
    if (r.action !== "keep") return;
    expect(r.category).toBe("activity");
    expect(r.styles).not.toContain("adventure");
    expect(r.styles).toContain("family");
  });

  it("parking-like rows are deleted", () => {
    expect(
      reclassifyStoredRow({ name: "City Center Parking", category: "activity", tags: [], styles: [] }).action,
    ).toBe("delete");
    expect(
      reclassifyStoredRow({ name: "駐車場", category: "activity", tags: [], styles: [] }).action,
    ).toBe("delete");
  });

  it("ordinary rows pass through unchanged (idempotent no-op)", () => {
    const row = { name: "Amber Fort", category: "activity", tags: ["historic", "architecture"], styles: ["historical"] };
    const r = reclassifyStoredRow(row);
    expect(r.action).toBe("keep");
    if (r.action !== "keep") return;
    expect(r.category).toBe(row.category);
    expect(r.tags).toEqual(row.tags);
    expect(r.styles).toEqual(row.styles);
  });
});
