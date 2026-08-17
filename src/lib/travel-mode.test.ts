import { describe, expect, it } from "vitest";
import {
  detectBehind,
  plannedEndMinutes,
  suggestForCheckIn,
  FAR_FROM_NEXT_M,
  LATE_GRACE_MIN,
  type PlannedStop,
} from "./travel-mode";

const stop = (over: Partial<PlannedStop>): PlannedStop => ({
  id: 1,
  name: "Stop",
  category: "activity",
  startTime: "10:00",
  durationMin: 60,
  lat: 48.86,
  lng: 2.33,
  ...over,
});

describe("plannedEndMinutes", () => {
  it("adds duration to start time", () => {
    expect(plannedEndMinutes(stop({}))).toBe(10 * 60 + 60);
  });
  it("defaults to 60 minutes without a duration", () => {
    expect(plannedEndMinutes(stop({ durationMin: null }))).toBe(11 * 60);
  });
  it("returns null without a start time", () => {
    expect(plannedEndMinutes(stop({ startTime: null }))).toBeNull();
  });
});

describe("detectBehind", () => {
  const today = [
    stop({ id: 1, name: "Museum", startTime: "10:00", durationMin: 90, lat: 48.86, lng: 2.33 }),
    stop({ id: 2, name: "Park", startTime: "12:00", durationMin: 60, lat: 48.87, lng: 2.34 }),
  ];

  it("flags late when past planned end + grace and far from next stop", () => {
    // planned end 11:30; now 12:30 -> 60 late. Position ~2km from Park.
    const r = detectBehind(today, 12 * 60 + 30, { lat: 48.85, lng: 2.3 });
    expect(r.behind).toBe(true);
    expect(r.lateStop?.name).toBe("Museum");
    expect(r.nextStop?.name).toBe("Park");
    expect(r.minutesLate).toBe(60);
    expect(r.distanceToNextM).toBeGreaterThan(FAR_FROM_NEXT_M);
  });

  it("stays quiet inside the grace window", () => {
    const end = 11 * 60 + 30;
    const r = detectBehind(today, end + LATE_GRACE_MIN - 5, { lat: 48.85, lng: 2.3 });
    expect(r.behind).toBe(false);
  });

  it("stays quiet when already near the next stop", () => {
    const r = detectBehind(today, 12 * 60 + 30, { lat: 48.87, lng: 2.34 });
    expect(r.behind).toBe(false);
  });

  it("stays quiet without a position (no false alarms on denied location)", () => {
    const r = detectBehind(today, 12 * 60 + 30, null);
    expect(r.behind).toBe(false);
  });

  it("skips days with no timed stops", () => {
    expect(detectBehind([stop({ startTime: null })], 800, { lat: 0, lng: 0 }).behind).toBe(false);
  });
});

describe("suggestForCheckIn", () => {
  const ctx = {
    remaining: [stop({ id: 1 }), stop({ id: 2 }), stop({ id: 3 }), stop({ id: 4 })],
    nearestCafe: "Cafe Central",
    nearestFamousEatery: "Chez Marie",
  };

  it("low energy: drop later stops + suggest a rest at the nearest cafe", () => {
    const s = suggestForCheckIn({ energy: "low", tags: ["fine"] }, ctx);
    const drop = s.find((x) => x.kind === "drop_stops");
    expect(drop?.stopIds).toEqual([3, 4]);
    expect(s.find((x) => x.kind === "rest")?.text).toContain("Cafe Central");
  });

  it("tired tag behaves like low energy", () => {
    const s = suggestForCheckIn({ energy: "normal", tags: ["tired"] }, ctx);
    expect(s.some((x) => x.kind === "drop_stops")).toBe(true);
    expect(s.some((x) => x.kind === "rest")).toBe(true);
  });

  it("hungry: points at the famous eatery first", () => {
    const s = suggestForCheckIn({ energy: "normal", tags: ["hungry"] }, ctx);
    expect(s.find((x) => x.kind === "eat")?.text).toContain("Chez Marie");
  });

  it("hungry without famous eatery falls back to cafe, then generic", () => {
    const s1 = suggestForCheckIn({ energy: "normal", tags: ["hungry"] }, { ...ctx, nearestFamousEatery: null });
    expect(s1.find((x) => x.kind === "eat")?.text).toContain("Cafe Central");
    const s2 = suggestForCheckIn({ energy: "normal", tags: ["hungry"] }, { remaining: [], nearestCafe: null, nearestFamousEatery: null });
    expect(s2.find((x) => x.kind === "eat")?.text).toContain("map");
  });

  it("unwell leads with care advice", () => {
    const s = suggestForCheckIn({ energy: "normal", tags: ["unwell"] }, ctx);
    expect(s[0]?.kind).toBe("care");
  });

  it("fine + high energy keeps the momentum", () => {
    const s = suggestForCheckIn({ energy: "high", tags: ["fine"] }, ctx);
    expect(s).toHaveLength(1);
    expect(s[0]?.kind).toBe("keep_going");
    expect(s[0]?.text).toContain("energy");
  });

  it("low energy with 2 or fewer stops suggests rest without dropping", () => {
    const s = suggestForCheckIn({ energy: "low", tags: [] }, { ...ctx, remaining: [stop({ id: 1 })] });
    expect(s.find((x) => x.kind === "drop_stops")).toBeUndefined();
    expect(s.some((x) => x.kind === "rest")).toBe(true);
  });
});
