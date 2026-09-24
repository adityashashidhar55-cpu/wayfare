import { describe, expect, it } from "vitest";
import { splitByWeights, splitEqually } from "@contracts/split";

const sum = (xs: { shareCents: number }[]) => xs.reduce((a, x) => a + x.shareCents, 0);

describe("splitByWeights", () => {
  it("always sums to the total", () => {
    for (const total of [1, 100, 1001, 99999, 7]) {
      expect(sum(splitByWeights(total, [{ memberId: 1, weight: 1 }, { memberId: 2, weight: 1 }, { memberId: 3, weight: 1 }]))).toBe(total);
      expect(sum(splitByWeights(total, [{ memberId: 1, weight: 50 }, { memberId: 2, weight: 33.3 }, { memberId: 3, weight: 16.7 }]))).toBe(total);
    }
  });
  it("splits proportionally", () => {
    const s = splitByWeights(1000, [{ memberId: 1, weight: 2 }, { memberId: 2, weight: 1 }, { memberId: 3, weight: 1 }]);
    expect(s).toEqual([{ memberId: 1, shareCents: 500 }, { memberId: 2, shareCents: 250 }, { memberId: 3, shareCents: 250 }]);
  });
  it("treats exact amounts as weights", () => {
    const s = splitByWeights(3000, [{ memberId: 1, weight: 2000 }, { memberId: 2, weight: 1000 }]);
    expect(s.map((x) => x.shareCents)).toEqual([2000, 1000]);
  });
  it("drops zero and negative weights, and returns [] when nothing is left", () => {
    expect(splitByWeights(100, [{ memberId: 1, weight: 0 }, { memberId: 2, weight: 1 }])).toEqual([{ memberId: 2, shareCents: 100 }]);
    expect(splitByWeights(100, [{ memberId: 1, weight: 0 }])).toEqual([]);
  });
  it("splitEqually gives the extra cents to the first members", () => {
    expect(splitEqually(100, [1, 2, 3]).map((x) => x.shareCents)).toEqual([34, 33, 33]);
  });
});
