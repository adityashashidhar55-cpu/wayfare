import { describe, expect, it } from "vitest";
import { cleanAbstract, composeDescription, storyNarrationText } from "./place-story";

/**
 * r18-stories - pure-function tests for the place-story pipeline. No live
 * DBpedia/network here: fetchDbpediaAbstract is exercised by the seeders,
 * these pin the honesty + trimming guarantees the seeders rely on.
 */

describe("cleanAbstract", () => {
  it("collapses whitespace", () => {
    const text =
      "The  Meenakshi   Temple\n\nis a historic\thindu temple   on the southern bank of the Vaigai River.";
    const cleaned = cleanAbstract(text);
    expect(cleaned).toBe(
      "The Meenakshi Temple is a historic hindu temple on the southern bank of the Vaigai River.",
    );
  });

  it("drops disambiguation pages ('may refer to' / 'can refer to')", () => {
    expect(cleanAbstract("Victoria Memorial may refer to several things including a long enough list here."))
      .toBeNull();
    expect(
      cleanAbstract("Springfield can refer to a number of places in the world and this sentence is long enough."),
    ).toBeNull();
  });

  it("returns null when the result is under 80 chars", () => {
    expect(cleanAbstract("A temple in Madurai.")).toBeNull();
    expect(cleanAbstract("   ")).toBeNull();
  });

  it("trims at the last sentence boundary before the cap", () => {
    const s1 = "This is the first sentence of a fairly long abstract about a place.";
    const s2 = "This is the second sentence with more detail about the same place.";
    const s3 = "This final sentence would cross the cap and must be dropped entirely.";
    const raw = `${s1} ${s2} ${s3}`;
    const cap = s1.length + 1 + s2.length + 20; // cap lands mid-s3
    const cleaned = cleanAbstract(raw, cap);
    expect(cleaned).toBe(`${s1} ${s2}`);
    expect(cleaned!.length).toBeLessThanOrEqual(cap);
  });

  it("accepts ! and ? as sentence boundaries", () => {
    const s1 = "What a remarkable fortress this is!";
    const s2 = "It stands on a hill above the old town near the river and the market.";
    const s3 = "Extra detail that overflows the cap should be cut away now.";
    const raw = `${s1} ${s2} ${s3}`;
    const cap = s1.length + 1 + s2.length + 10;
    expect(cleanAbstract(raw, cap)).toBe(`${s1} ${s2}`);
  });

  it("keeps the full text when it fits within the cap", () => {
    const raw =
      "The Thanumalayan Temple is a temple dedicated to Shiva, Vishnu and Brahma in Suchindram, Tamil Nadu.";
    expect(cleanAbstract(raw, 900)).toBe(raw);
  });
});

describe("composeDescription", () => {
  it("uses worship tags, location and must-see verdict, and invents nothing", () => {
    const out = composeDescription({
      name: "Meenakshi Temple",
      category: "activity",
      city: "Madurai",
      country: "India",
      tags: ["temple", "historic"],
      verdict: "must-see",
    });
    expect(out).toContain("Meenakshi Temple");
    expect(out).toContain("place of worship");
    expect(out).toContain("in Madurai, India");
    expect(out).toContain("considered a must-see");
    // Zero fabrication: no dates/years/numbers appear that were not input.
    expect(out).not.toMatch(/\d/);
  });

  it("maps historic tags to 'historic site'", () => {
    const out = composeDescription({
      name: "Gingee Fort",
      category: "activity",
      city: "Villupuram",
      country: "India",
      tags: ["fort", "heritage"],
    });
    expect(out).toContain("historic site");
    expect(out).not.toMatch(/\d/);
  });

  it("names the city when calling out a famous food place", () => {
    const out = composeDescription({
      name: "Murugan Idli Shop",
      category: "food",
      city: "Madurai",
      country: "India",
      famousEatery: true,
    });
    expect(out).toContain("restaurant");
    expect(out).toContain("one of Madurai's best-known eateries");
  });

  it("does not call a non-food place an eatery even when famousEatery is set", () => {
    const out = composeDescription({
      name: "Hill Viewpoint",
      category: "natural",
      city: "Munnar",
      country: "India",
      famousEatery: true,
    });
    expect(out).toContain("natural spot");
    expect(out).not.toContain("eatery");
  });

  it("mentions free entry only when feeCents is exactly 0", () => {
    const base = { name: "City Museum", category: "museum", city: "Jaipur", country: "India" };
    expect(composeDescription({ ...base, feeCents: 0 })).toContain("Entry is free.");
    expect(composeDescription({ ...base, feeCents: 20000, feeCurrency: "INR" })).not.toContain("free");
    expect(composeDescription(base)).not.toContain("free");
  });

  it("falls back to the raw category word for unmapped categories", () => {
    const out = composeDescription({
      name: "Rail Museum",
      category: "gallery",
      city: "Mysuru",
      country: "India",
    });
    expect(out).toContain("gallery");
  });

  it("returns a single plain sentence when category and city are missing", () => {
    const out = composeDescription({ name: "Mystery Spot", category: "", city: "", country: "" });
    expect(out).toBe("Mystery Spot is a place awaiting a fuller description.");
    expect(out).not.toMatch(/\d/);
  });

  it("handles city without country and vice versa", () => {
    expect(
      composeDescription({ name: "Old Fort", category: "landmark", city: "Jaipur", country: "", tags: ["fort"] }),
    ).toContain("in Jaipur");
    expect(
      composeDescription({ name: "Hill Fort", category: "activity", city: "", country: "India", tags: ["fort"] }),
    ).toContain("in India");
  });

  // ─── r21-desc: richer historic + famous-eatery templates ──────────────────

  it("calls a mosque a mosque even when the importer also tags it 'temple'", () => {
    const out = composeDescription({
      name: "Mosquée Alia",
      category: "activity",
      city: "Conakry",
      country: "Guinea",
      tags: ["mosque", "temple"],
    });
    expect(out).toContain("mosque");
    expect(out).not.toContain(" is a temple");
    expect(out).toContain("place of worship");
  });

  it("weaves landmark texture for landmark-tagged historic places", () => {
    const out = composeDescription({
      name: "Sung Wong Toi relic",
      category: "activity",
      city: "Hong Kong",
      country: "China",
      tags: ["historic", "landmark"],
      verdict: "worth-it",
    });
    expect(out).toContain("one of Hong Kong's landmark sights");
    expect(out).toContain("well worth a visit");
  });

  it("gives memorials remembrance phrasing and ruins a survival note", () => {
    const memorial = composeDescription({
      name: "Sami Frashëri",
      category: "activity",
      city: "Pristina",
      country: "Kosovo",
      tags: ["historic", "landmark", "memorial"],
    });
    expect(memorial).toMatch(/remembrance/);
    const ruins = composeDescription({
      name: "Zangenstein",
      category: "historic",
      city: "Nuremberg",
      country: "Germany",
      tags: ["ruins", "historic"],
    });
    expect(ruins).toContain("ruin");
    expect(ruins).toMatch(/survives|survive/);
  });

  it("varies openers across places instead of starting every one the same way", () => {
    const shapes = new Set<string>();
    const names = ["Alpha Fort", "Beta Fort", "Gamma Fort", "Delta Fort", "Epsilon Fort", "Zeta Fort", "Eta Fort"];
    for (const name of names) {
      const out = composeDescription({
        name,
        category: "activity",
        city: "Jaipur",
        country: "India",
        tags: ["fort", "historic"],
      });
      if (out.startsWith(`${name} is `)) shapes.add("is");
      else if (out.startsWith(`${name} stands`)) shapes.add("stands");
      else shapes.add("led-in");
    }
    expect(shapes.size).toBeGreaterThan(1);
  });

  it("is deterministic per place so re-runs are idempotent", () => {
    const input = {
      name: "Amber Watchtower",
      category: "activity" as const,
      city: "Jaipur",
      country: "India",
      tags: ["historic", "landmark"],
      verdict: "worth-it" as const,
    };
    expect(composeDescription(input)).toBe(composeDescription(input));
  });

  it("weaves a signature dish and verdict into famous-eatery descriptions", () => {
    const out = composeDescription({
      name: "Du Pain et des Idées",
      category: "food",
      city: "Paris",
      country: "France",
      tags: ["bakery", "food"],
      famousEatery: true,
      verdict: "worth-it",
      signatureDish: "Croissant",
    });
    expect(out).toContain("bakery");
    expect(out).toMatch(/Croissant/);
    expect(out).toContain("well worth the stop");
    expect(out).toContain("best-known eateries");
  });

  it("degrades gracefully for a famous eatery with no verdict, dish or city", () => {
    const out = composeDescription({
      name: "Roadside Dhaba",
      category: "food",
      city: "",
      country: "India",
      famousEatery: true,
    });
    expect(out).toContain("one of the area's best-known eateries");
    expect(out).not.toContain("undefined");
    expect(out.split(". ").length).toBeLessThanOrEqual(4);
  });

  it("does not stutter when the city field already carries the country", () => {
    const out = composeDescription({
      name: "Summer Harvest",
      category: "food",
      city: "Leh, India",
      country: "India",
      tags: ["food", "restaurant", "vegetarian"],
      famousEatery: true,
    });
    expect(out).toContain("in Leh, India");
    expect(out).not.toContain("India, India");
    expect(out).toContain("one of Leh's best-known eateries");
    expect(out).toContain("vegetarian restaurant");
  });

  it("emits zero em dashes across 50 generated descriptions", () => {
    const samples: Parameters<typeof composeDescription>[0][] = [];
    const cities = ["Madurai", "Jaipur", "Paris", "Rome", "Cairo", "Kyoto", "Cusco", "Petra", "Lisbon", "Berlin"];
    const tagSets = [
      ["temple", "historic"],
      ["mosque", "temple"],
      ["church", "temple"],
      ["historic", "landmark", "memorial"],
      ["ruins", "historic"],
      ["museum"],
      ["fort", "heritage"],
      ["historic", "architecture"],
      ["landmark"],
      ["food", "restaurant"],
    ];
    for (let i = 0; i < 50; i++) {
      samples.push({
        name: `Sample Place ${i}`,
        category: i % 5 === 0 ? "food" : "activity",
        city: cities[i % cities.length]!,
        country: "Testland",
        tags: tagSets[i % tagSets.length],
        famousEatery: i % 5 === 0,
        verdict: i % 3 === 0 ? "must-see" : i % 3 === 1 ? "worth-it" : null,
        feeCents: i % 7 === 0 ? 0 : null,
        signatureDish: i % 5 === 0 ? "Test Dish" : null,
      });
    }
    for (const s of samples) {
      const out = composeDescription(s);
      expect(out).not.toContain("\u2014");
      expect(out.length).toBeGreaterThan(10);
    }
  });

  it("never emits digits that were not present in the input", () => {
    const inputs = [
      { name: "Blue Cafe", category: "cafe", city: "Pondicherry", country: "India" },
      {
        name: "Night Bazaar",
        category: "shopping",
        city: "Chiang Mai",
        country: "Thailand",
        verdict: "worth-it" as const,
      },
      {
        name: "Club 7",
        category: "nightlife",
        city: "Goa",
        country: "India",
        tags: ["bar"],
        rating: 4.2,
      },
    ];
    for (const input of inputs) {
      const out = composeDescription(input);
      const inputDigits = JSON.stringify(input).replace(/\D/g, "");
      for (const d of out.replace(/\D/g, "")) {
        expect(inputDigits).toContain(d);
      }
    }
  });
});

describe("storyNarrationText", () => {
  it("collapses whitespace", () => {
    expect(storyNarrationText("A  story\nwith\tgaps.")).toBe("A story with gaps.");
  });

  it("caps at a sentence boundary", () => {
    const s1 = "First sentence of the narration.";
    const s2 = "Second sentence of the narration.";
    const s3 = "Third sentence that would overflow.";
    const text = `${s1} ${s2} ${s3}`;
    const cap = s1.length + 1 + s2.length + 5;
    const out = storyNarrationText(text, cap);
    expect(out).toBe(`${s1} ${s2}`);
    expect(out.length).toBeLessThanOrEqual(cap);
  });

  it("passes short text through unchanged", () => {
    const text = "A short honest description.";
    expect(storyNarrationText(text)).toBe(text);
  });
});
