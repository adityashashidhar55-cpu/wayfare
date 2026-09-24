import { describe, expect, it } from "vitest";
import { boxAround, haversine, samplePoints, type LngLat } from "./roadside";

const line: LngLat[] = Array.from({ length: 101 }, (_, i) => [i, 0]);

describe("samplePoints", () => {
  it("spreads samples along the middle of the route, not the endpoints", () => {
    const pts = samplePoints(line, 5);
    expect(pts).toHaveLength(5);
    expect(pts[0]![0]).toBeGreaterThan(8);
    expect(pts[4]![0]).toBeLessThan(92);
    for (let i = 1; i < pts.length; i++) expect(pts[i]![0]).toBeGreaterThan(pts[i - 1]![0]);
  });
  it("handles degenerate input", () => {
    expect(samplePoints([], 5)).toEqual([]);
    expect(samplePoints([[0, 0]], 5)).toEqual([]);
    expect(samplePoints(line, 0)).toEqual([]);
  });
});

describe("boxAround", () => {
  it("widens longitude away from the equator", () => {
    const eq = boxAround(0, 0, 10);
    const north = boxAround(60, 0, 10);
    expect(north.maxLng - north.minLng).toBeGreaterThan(eq.maxLng - eq.minLng);
    expect(haversine(0, 0, eq.maxLat, 0)).toBeCloseTo(10, 0);
  });
});
