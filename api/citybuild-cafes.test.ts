/**
 * Cafés group split (r16-culinary) - the CityBuilder buckets food places
 * tagged 'cafe' into their OWN "☕ Cafés & coffee" group, separate from the
 * generic "🍽️ Restaurants & food" group. Guards the r13 tag-matching fix and
 * the importer's cafe-tagged curated inserts (signature-dish coffee places
 * surface under Cafés, not Restaurants).
 */
import { describe, expect, it } from "vitest";
import { CITY_GROUPS, groupKeyFor } from "./citybuild-router";

describe("groupKeyFor, café split", () => {
  it("food places tagged 'cafe' land in the cafés group, not food", () => {
    expect(groupKeyFor({ category: "food", tags: ["cafe"] })).toBe("cafes");
    expect(groupKeyFor({ category: "food", tags: ["restaurant", "coffee"] })).toBe("cafes");
    expect(groupKeyFor({ category: "food", tags: ["Cafe"] })).toBe("cafes"); // case-insensitive
  });

  it("plain restaurants stay in the food group", () => {
    expect(groupKeyFor({ category: "food", tags: ["restaurant"] })).toBe("food");
    expect(groupKeyFor({ category: "food", tags: [] })).toBe("food");
    expect(groupKeyFor({ category: "food", tags: null })).toBe("food");
  });

  it("the cafés group chip exists with the ☕ label", () => {
    const cafes = CITY_GROUPS.find((g) => g.key === "cafes");
    expect(cafes).toBeDefined();
    expect(cafes!.label).toBe("Cafés & coffee");
    expect(cafes!.emoji).toBe("☕");
    expect(cafes!.tags.has("cafe")).toBe(true);
  });
});
