import { describe, expect, it } from "vitest";
import { parseCaptionStructure } from "./caption-structure";

describe("parseCaptionStructure", () => {
  it("reads a plain day-by-day caption", () => {
    const r = parseCaptionStructure(`3 days in Kyoto!
Day 1: Fushimi Inari, Nishiki Market
Day 2: Arashiyama Bamboo Grove, Tenryu-ji
Day 3: Kiyomizu-dera, Gion`);
    expect(r.hasDayStructure).toBe(true);
    expect(r.days).toHaveLength(3);
    expect(r.days[0]!.text).toContain("Fushimi Inari");
    expect(r.days[1]!.text).toContain("Arashiyama");
    expect(r.days[2]!.text).toContain("Gion");
    expect(r.days[0]!.text).not.toContain("Arashiyama");
  });

  it("handles the punctuation people actually use", () => {
    for (const sep of [":", " -", " |", ".", ")"]) {
      const r = parseCaptionStructure(`Day 1${sep} Louvre\nDay 2${sep} Versailles`);
      expect(r.days, sep).toHaveLength(2);
    }
  });

  it("handles DAY / day / D1 casing and shorthand", () => {
    expect(parseCaptionStructure("DAY 1: a\nday 2: b").days).toHaveLength(2);
    expect(parseCaptionStructure("D1: a\nD2: b").days).toHaveLength(2);
  });

  it("handles circled-number emoji headings", () => {
    const r = parseCaptionStructure("1⃣ Shibuya crossing 2⃣ Meiji Shrine");
    expect(r.hasDayStructure).toBe(true);
    expect(r.days).toHaveLength(2);
  });

  it("reads a stated duration", () => {
    expect(parseCaptionStructure("5 days in Bali, so good").durationDays).toBe(5);
    expect(parseCaptionStructure("a week in Rome").durationDays).toBe(7);
    expect(parseCaptionStructure("long weekend in Goa").durationDays).toBe(3);
  });

  it("infers duration from the day count when the caption never states it", () => {
    const r = parseCaptionStructure("Day 1: a\nDay 2: b\nDay 3: c\nDay 4: d");
    expect(r.durationDays).toBe(4);
  });

  it("does not treat a passing mention of a day as a heading", () => {
    // Regression guard: an unanchored regex turns this into a fake itinerary.
    const r = parseCaptionStructure("we spent a day 3 hours north of the city and it was worth it");
    expect(r.hasDayStructure).toBe(false);
    expect(r.days).toEqual([]);
  });

  it("needs at least two days before claiming structure", () => {
    // "Day 1 of my trip!" with nothing after it is a flourish, not a plan.
    expect(parseCaptionStructure("Day 1 of my Japan trip!!").hasDayStructure).toBe(false);
  });

  it("ignores a repeated day number in hashtags", () => {
    const r = parseCaptionStructure("Day 1: Colosseum\nDay 2: Vatican\n#day2 #rome #travel");
    expect(r.days).toHaveLength(2);
    expect(r.days[1]!.text).toContain("Vatican");
  });

  it("never throws on junk", () => {
    for (const junk of ["", "   ", "🙂", "Day", "Day 99: x\nDay 100: y", "a".repeat(9000)]) {
      expect(() => parseCaptionStructure(junk)).not.toThrow();
    }
  });

  it("rejects absurd day numbers", () => {
    expect(parseCaptionStructure("Day 99: x\nDay 100: y").hasDayStructure).toBe(false);
  });
});

// spreadAcrossDays lives in api/social-router; these cases pin the behaviour
// the caption parser exists to feed.
import { spreadAcrossDays } from "../api/social-router";

describe("spreadAcrossDays", () => {
  const items = (n: number) => Array.from({ length: n }, (_, i) => i + 1);

  it("uses the day count the caption asked for, not places/8", () => {
    // Regression: 11 places + "3 days in Kyoto" used to become 2 days.
    expect(spreadAcrossDays(items(11), 3)).toHaveLength(3);
  });

  it("front-loads the remainder", () => {
    const d = spreadAcrossDays(items(11), 3).map((x) => x.length);
    expect(d).toEqual([4, 4, 3]);
  });

  it("keeps every place", () => {
    const flat = spreadAcrossDays(items(17), 5).flat();
    expect(flat).toHaveLength(17);
    expect(new Set(flat).size).toBe(17);
  });

  it("never makes more days than places", () => {
    expect(spreadAcrossDays(items(2), 9)).toHaveLength(2);
  });

  it("survives an empty list", () => {
    expect(() => spreadAcrossDays([], 3)).not.toThrow();
  });
});
