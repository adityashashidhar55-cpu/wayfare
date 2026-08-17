/**
 * r15-eats generator tests: the fame boost nudges famous eateries into meal
 * slots, but dietary suitability ALWAYS outranks fame (r11-diet stays first).
 */
import { describe, expect, it } from "vitest";
import { buildDayPicks } from "./trip-router";

type PlaceRow = Parameters<typeof buildDayPicks>[0]["ranked"][number];

function place(p: {
  id: number;
  name: string;
  category: string;
  tags?: string[];
  rating?: number;
  famousEatery?: boolean;
}): PlaceRow {
  return {
    city: "Testville",
    country: "Testland",
    lat: null,
    lng: null,
    tags: [],
    styles: [],
    priceLevel: 2,
    rating: 4.5,
    hidden: false,
    approved: true,
    famousEatery: false,
    ...p,
  } as unknown as PlaceRow;
}

const ACT = place({ id: 1, name: "City Palace", category: "activity", tags: ["museum"], rating: 4.6 });

async function foodPick(ranked: PlaceRow[], dietary: "veg" | "non-veg") {
  const picks = await buildDayPicks({ ranked, used: new Set(), slots: 2, dietary });
  return picks.find((p) => p.slot === 1)?.place ?? null;
}

describe("buildDayPicks, famous-eatery boost vs dietary priority", () => {
  it("fame nudges: a famous eatery beats a slightly higher-ranked ordinary one", async () => {
    const ordinary = place({ id: 2, name: "Trattoria Roma", category: "food", tags: ["dinner"] });
    const famous = place({ id: 3, name: "Bistro Verde", category: "food", tags: ["lunch"], famousEatery: true });
    // ranked order puts the ordinary place AHEAD - only the fame boost can flip it
    const pick = await foodPick([ACT, ordinary, famous], "non-veg");
    expect(pick?.id).toBe(3);
  });

  it("control: without the flag the higher-ranked place wins", async () => {
    const ahead = place({ id: 2, name: "Trattoria Roma", category: "food", tags: ["dinner"] });
    const behind = place({ id: 3, name: "Bistro Verde", category: "food", tags: ["lunch"] });
    const pick = await foodPick([ACT, ahead, behind], "non-veg");
    expect(pick?.id).toBe(2);
  });

  it("dietary priority: a famous meat-only kitchen NEVER beats a veg fit for veg diets", async () => {
    const famousMeat = place({
      id: 2,
      name: "Big Tex Steakhouse",
      category: "food",
      tags: ["dinner"],
      rating: 4.8,
      famousEatery: true,
    });
    const vegFit = place({ id: 3, name: "Annapurna Pure Veg", category: "food", tags: ["lunch"] });
    // famous + higher-ranked + higher-rated - and it still must lose
    const pick = await foodPick([ACT, famousMeat, vegFit], "veg");
    expect(pick?.id).toBe(3);
  });
});
