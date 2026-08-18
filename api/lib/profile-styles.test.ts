import { describe, expect, it } from "vitest";
import { profileStyles, STYLE_TO_TAGS, tagsForStyles } from "./style-map";

describe("profileStyles", () => {
  it("keeps the coarse styles", () => {
    expect([...profileStyles({ styles: ["food", "adventure"] })]).toEqual(
      expect.arrayContaining(["food", "adventure"]),
    );
  });

  it("folds in interests - the whole point of this function", () => {
    // Regression: preferences.interests was collected by onboarding Q4 and read
    // by NOTHING. STYLE_TO_TAGS already had entries for these ids, added with a
    // comment saying "when they reach the API as styles". They never did.
    const out = profileStyles({ styles: ["food"], interests: ["street-food", "museums", "viewpoints"] });
    expect(out.has("street-food")).toBe(true);
    expect(out.has("museums")).toBe(true);
    expect(out.has("viewpoints")).toBe(true);
  });

  it("drops interests we cannot express as corpus tags", () => {
    // An unmapped id would add a style that matches nothing and dilutes the
    // overlap count, making the profile actively worse than ignoring it.
    const out = profileStyles({ interests: ["street-food", "not-a-real-interest"] });
    expect(out.has("street-food")).toBe(true);
    expect(out.has("not-a-real-interest")).toBe(false);
  });

  it("treats a stated cuisine as a food signal", () => {
    expect(profileStyles({ cuisines: ["japanese"] }).has("food")).toBe(true);
  });

  it("survives null, undefined and empty profiles", () => {
    expect(profileStyles(null).size).toBe(0);
    expect(profileStyles(undefined).size).toBe(0);
    expect(profileStyles({}).size).toBe(0);
    expect(profileStyles({ styles: null, interests: null, cuisines: null }).size).toBe(0);
  });

  it("actually widens the tag set the ranker uses", () => {
    const coarse = tagsForStyles(profileStyles({ styles: ["food"] }));
    const sharp = tagsForStyles(profileStyles({ styles: ["food"], interests: ["street-food"] }));
    expect(sharp.size).toBeGreaterThan(coarse.size);
    expect(sharp.has("hawker")).toBe(true);
  });

  it("every interest id in the quiz has a tag mapping", () => {
    // If onboarding adds a chip without a STYLE_TO_TAGS entry it silently does
    // nothing - this test makes that failure loud.
    const QUIZ_INTERESTS = ["street-food", "coffee", "fine-dining", "hiking", "beaches",
      "museums", "architecture", "local-markets", "temples", "live-music", "viewpoints"];
    for (const id of QUIZ_INTERESTS) expect(STYLE_TO_TAGS[id], id).toBeDefined();
  });
});
