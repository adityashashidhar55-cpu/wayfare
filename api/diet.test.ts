import { describe, expect, it } from "vitest";
import {
  dietBadge,
  dietClass,
  dietConfirmed,
  dietFit,
  isMeatOnly,
  parseDietary,
} from "../contracts/diet";

describe("dietClass", () => {
  it("reads OSM diet tags", () => {
    expect(dietClass({ name: "Green Leaf", category: "food", tags: ["diet:vegetarian=yes"] })).toBe("veg-friendly");
    expect(dietClass({ name: "Green Leaf", category: "food", tags: ["diet:vegetarian=only"] })).toBe("pure-veg");
    expect(dietClass({ name: "Sprout", category: "food", tags: ["diet:vegan=yes"] })).toBe("vegan");
    expect(dietClass({ name: "Sprout", category: "food", tags: ["diet:vegan=only"] })).toBe("vegan");
    expect(dietClass({ name: "Dhaba", category: "food", tags: ["cuisine=vegetarian"] })).toBe("pure-veg");
    expect(dietClass({ name: "Sprout", category: "food", tags: ["cuisine=vegan"] })).toBe("vegan");
    expect(dietClass({ name: "Mixed", category: "food", tags: ["cuisine=indian;vegetarian"] })).toBe("pure-veg");
  });

  it("reads name heuristics", () => {
    expect(dietClass({ name: "Shakahari Bhoj", category: "food" })).toBe("veg-friendly");
    expect(dietClass({ name: "Annapurna Pure Veg", category: "food" })).toBe("pure-veg");
    expect(dietClass({ name: "Maitreya Vegan Kitchen", category: "food" })).toBe("vegan");
    expect(dietClass({ name: "Jain Bhojanalaya", category: "food" })).toBe("veg-friendly");
    expect(dietClass({ name: "Trattoria Roma", category: "food" })).toBe("neutral");
  });

  it("flags obvious meat-only kitchens", () => {
    expect(dietClass({ name: "Big Tex Steakhouse", category: "food" })).toBe("meat-only");
    expect(dietClass({ name: "Smokehouse BBQ", category: "food" })).toBe("meat-only");
    expect(dietClass({ name: "Neptune Seafood", category: "food" })).toBe("meat-only");
    expect(dietClass({ name: "Grill", category: "food", tags: ["cuisine=seafood"] })).toBe("meat-only");
    expect(isMeatOnly({ name: "Big Tex Steakhouse", category: "food" })).toBe(true);
  });

  it("a positive veg tag beats a meat-looking name", () => {
    expect(dietClass({ name: "Steakhouse with Greens", category: "food", tags: ["diet:vegetarian=yes"] })).toBe("veg-friendly");
  });
});

describe("dietFit / dietConfirmed", () => {
  const veganPlace = { name: "Sprout", category: "food", tags: ["diet:vegan=yes"] };
  const pureVeg = { name: "Annapurna Pure Veg", category: "food", country: "India" };
  const vegFriendly = { name: "Green Leaf", category: "food", tags: ["diet:vegetarian=yes"] };
  const steak = { name: "Big Tex Steakhouse", category: "food" };
  const neutral = { name: "Cafe Mocha", category: "food" };

  it("vegan: vegan ideal, veg confirmed, meat/unknown excluded", () => {
    expect(dietFit(veganPlace, "vegan")).toBe(3);
    expect(dietFit(pureVeg, "vegan")).toBe(2);
    expect(dietFit(vegFriendly, "vegan")).toBe(2);
    expect(dietFit(steak, "vegan")).toBe(0);
    expect(dietFit(neutral, "vegan")).toBe(0);
    expect(dietConfirmed(vegFriendly, "vegan")).toBe(true);
    expect(dietConfirmed(neutral, "vegan")).toBe(false);
  });

  it("veg/eggetarian: pure-veg ideal", () => {
    expect(dietFit(pureVeg, "veg")).toBe(3);
    expect(dietFit(veganPlace, "veg")).toBe(3);
    expect(dietFit(vegFriendly, "veg")).toBe(2);
    expect(dietFit(neutral, "veg")).toBe(0);
    expect(dietFit(pureVeg, "eggetarian")).toBe(3);
  });

  it("jain: strictest, jain-signalled ideal, root-veg names excluded", () => {
    expect(dietFit({ name: "Jain Bhojanalaya", category: "food" }, "jain")).toBe(3);
    expect(dietFit(pureVeg, "jain")).toBe(2);
    expect(dietFit(vegFriendly, "jain")).toBe(1);
    expect(dietFit({ name: "The Potato Bar", category: "food", tags: ["diet:vegetarian=only"] }, "jain")).toBe(0);
    expect(dietConfirmed(vegFriendly, "jain")).toBe(false); // fit 1 < 2 → unverified if picked
  });

  it("non-veg: unconstrained", () => {
    expect(dietFit(steak, "non-veg")).toBe(2);
    expect(dietFit(neutral, "non-veg")).toBe(1);
    expect(dietConfirmed(neutral, "non-veg")).toBe(true);
  });
});

describe("dietBadge", () => {
  it("badges food places with known veg signals", () => {
    expect(dietBadge({ name: "Annapurna Pure Veg", category: "food" })).toEqual({ label: "Pure veg", kind: "pure-veg" });
    expect(dietBadge({ name: "Sprout", category: "restaurant", tags: ["diet:vegan=yes"] })).toEqual({ label: "Vegan options", kind: "vegan" });
    expect(dietBadge({ name: "Shakahari Bhoj", category: "food" })).toEqual({ label: "Veg-friendly", kind: "veg-friendly" });
  });

  it("never badges non-food, meat-only, or unknown kitchens", () => {
    expect(dietBadge({ name: "Veg Park", category: "activity" })).toBe(null);
    expect(dietBadge({ name: "Big Tex Steakhouse", category: "food" })).toBe(null);
    expect(dietBadge({ name: "Cafe Mocha", category: "food" })).toBe(null);
  });
});

describe("parseDietary", () => {
  it("normalizes stored values", () => {
    expect(parseDietary("vegan")).toBe("vegan");
    expect(parseDietary("jain")).toBe("jain");
    expect(parseDietary("garbage")).toBe("non-veg");
    expect(parseDietary(null)).toBe("non-veg");
    expect(parseDietary(undefined)).toBe("non-veg");
  });
});
