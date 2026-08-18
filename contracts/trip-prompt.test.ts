import { describe, expect, it } from "vitest";
import { parseTripPrompt, extractDestination } from "./trip-prompt";

describe("destination", () => {
  it("reads the obvious ones", () => {
    expect(extractDestination("7-day trip to Japan")).toBe("Japan");
    expect(extractDestination("5 days in Kerala")).toBe("Kerala");
    expect(extractDestination("Bengaluru for 3 days")).toBe("Bengaluru");
  });

  it("prefers the earliest place, not the first preposition we happen to check", () => {
    // Regression: "in December" used to beat "around Rajasthan" and the trip
    // was planned for a destination called December.
    expect(extractDestination("Two weeks around Rajasthan in December")).toBe("Rajasthan");
  });

  it("never returns a month", () => {
    expect(extractDestination("a week in December")).toBeNull();
    expect(extractDestination("going in March")).toBeNull();
  });

  it("never returns an interest word", () => {
    expect(extractDestination("in search of street food")).not.toBe("Search");
  });

  it("handles multi-word and accented names", () => {
    expect(extractDestination("trip to New Zealand")).toBe("New Zealand");
    expect(extractDestination("flying to Río de Janeiro")).toContain("Río");
  });

  it("returns null when nowhere is named", () => {
    expect(extractDestination("somewhere warm with good food")).toBeNull();
  });
});

describe("duration", () => {
  const d = (s: string) => parseTripPrompt(s).durationDays;
  it("reads explicit days and weeks", () => {
    expect(d("5 days in Goa")).toBe(5);
    expect(d("7-day trip")).toBe(7);
    expect(d("2 weeks in Peru")).toBe(14);
  });
  it("reads vague durations", () => {
    expect(d("a week in Rome")).toBe(7);
    expect(d("long weekend in Goa")).toBe(3);
    expect(d("just a weekend")).toBe(2);
    expect(d("two weeks around Spain")).toBe(14);
  });
  it("rejects absurd durations rather than planning a 99-day trip", () => {
    expect(d("99 days in Japan")).toBeNull();
  });
});

describe("negation", () => {
  it("moves a negated interest to avoid, not styles", () => {
    // Regression: negators were substring-matched with a trailing space that
    // at() had already consumed, so EVERY negation silently became a
    // preference - "no museums" ranked museums UP.
    const r = parseTripPrompt("10 days in Bali, beaches, no museums");
    expect(r.avoid).toContain("museums");
    expect(r.styles).not.toContain("museums");
  });

  it("handles the several ways people say it", () => {
    for (const p of ["avoid nightlife", "without nightlife", "skip nightlife",
                     "hate nightlife", "not nightlife", "rather not nightlife"]) {
      expect(parseTripPrompt(`3 days in Berlin, ${p}`).avoid).toContain("nightlife");
    }
  });

  it("does not let a negation leak across a clause boundary", () => {
    const r = parseTripPrompt("no museums, love street food");
    expect(r.avoid).toContain("museums");
    expect(r.styles).toContain("street-food");
    expect(r.avoid).not.toContain("street-food");
  });

  it("treats crowds as something to avoid unless explicitly wanted", () => {
    expect(parseTripPrompt("Japan, avoid crowds").avoid.length).toBeGreaterThan(0);
    expect(parseTripPrompt("Japan, I love the crowds").styles).toContain("historical");
  });

  it("lets avoid win when a style is both wanted and refused", () => {
    const r = parseTripPrompt("temples but no crowded temples");
    expect(r.styles).not.toContain("temples");
  });
});

describe("styles", () => {
  it("prefers the longer phrase", () => {
    const r = parseTripPrompt("Bangkok street food tour");
    expect(r.styles).toContain("street-food");
  });
  it("maps regional vocabulary onto the corpus vocabulary", () => {
    expect(parseTripPrompt("Kerala backwaters").styles).toContain("nature");
    expect(parseTripPrompt("Rajasthan forts and palaces").styles).toContain("architecture");
  });
  it("returns nothing rather than guessing when the sentence has no interests", () => {
    expect(parseTripPrompt("5 days in Oslo").styles).toEqual([]);
  });
});

describe("budget, pace and party", () => {
  it("reads budget", () => {
    expect(parseTripPrompt("cheap trip to Hanoi").budgetBand).toBe("shoestring");
    expect(parseTripPrompt("luxury honeymoon in Bali").budgetBand).toBe("luxury");
  });
  it("reads pace", () => {
    expect(parseTripPrompt("relaxed week in Kyoto").pace).toBe("relaxed");
    expect(parseTripPrompt("packed 3 days, see everything").pace).toBe("packed");
  });
  it("reads the party", () => {
    expect(parseTripPrompt("solo trip to Vietnam").partySize).toBe(1);
    expect(parseTripPrompt("honeymoon in Bali").partySize).toBe(2);
    expect(parseTripPrompt("6 people going to Paris").partySize).toBe(6);
    expect(parseTripPrompt("family trip with kids").withChildren).toBe(true);
  });
});

describe("robustness", () => {
  it("never throws on junk", () => {
    for (const junk of ["", "   ", "!!!", "🙂🙂🙂", "a".repeat(5000), "SELECT * FROM users"]) {
      expect(() => parseTripPrompt(junk)).not.toThrow();
    }
  });
  it("returns an empty-ish intent for an empty prompt", () => {
    const r = parseTripPrompt("");
    expect(r.destination).toBeNull();
    expect(r.styles).toEqual([]);
    expect(r.confidence).toBe(0);
  });
  it("reports confidence so the UI can decide whether to ask a follow-up", () => {
    const rich = parseTripPrompt("7 days in Kyoto in April with my partner, temples and coffee, relaxed, mid-range");
    const bare = parseTripPrompt("somewhere nice");
    expect(rich.confidence).toBeGreaterThan(bare.confidence);
  });
});
