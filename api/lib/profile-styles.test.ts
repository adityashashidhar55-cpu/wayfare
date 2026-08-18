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

  it("widens the tag set when the interest brings genuinely new tags", () => {
    // museums contributes museum/art/gallery/history, none of which food has.
    const coarse = tagsForStyles(profileStyles({ styles: ["food"] }));
    const sharp = tagsForStyles(profileStyles({ styles: ["food"], interests: ["museums"] }));
    expect(sharp.size).toBeGreaterThan(coarse.size);
    expect(sharp.has("gallery")).toBe(true);
  });

  it("helps via style OVERLAP even when the interest adds no new tags", () => {
    // street-food's tags are a strict SUBSET of food's, so the tag set does
    // not grow. The gain is in styleMatchScore, which counts how many of the
    // user's styles a place matches: a place tagged street-food matches one
    // style for a plain food lover and two for someone who named the
    // interest, which is worth +10 in the ranker. Asserting tag-set growth
    // here would be asserting the wrong mechanism - and did, until CI caught
    // it.
    const base = profileStyles({ styles: ["food"] });
    const sharp = profileStyles({ styles: ["food"], interests: ["street-food"] });
    expect(sharp.size).toBeGreaterThan(base.size);
    expect(sharp.has("street-food")).toBe(true);

    const placeStyles = ["street-food"];
    const overlapBase = placeStyles.filter((s) => base.has(s)).length;
    const overlapSharp = placeStyles.filter((s) => sharp.has(s)).length;
    expect(overlapSharp).toBeGreaterThan(overlapBase);
  });

  it("every interest id in the quiz has a tag mapping", () => {
    // If onboarding adds a chip without a STYLE_TO_TAGS entry it silently does
    // nothing - this test makes that failure loud.
    const QUIZ_INTERESTS = ["street-food", "coffee", "fine-dining", "hiking", "beaches",
      "museums", "architecture", "local-markets", "temples", "live-music", "viewpoints"];
    for (const id of QUIZ_INTERESTS) expect(STYLE_TO_TAGS[id], id).toBeDefined();
  });
});
