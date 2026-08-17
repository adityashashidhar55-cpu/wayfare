import { describe, expect, it } from "vitest";
import {
  joinRequestError,
  makePublishSlug,
  slugifyTitle,
  slugSuffix,
  updateBodyError,
} from "./publish-router";

describe("slugifyTitle", () => {
  it("lowercases, strips accents/punctuation, hyphenates", () => {
    expect(slugifyTitle("Monsoon Escape with the Gang!")).toBe("monsoon-escape-with-the-gang");
    expect(slugifyTitle("Cafés & Crêpes à Paris")).toBe("cafes-crepes-a-paris");
  });
  it("returns empty for unusable titles and caps length", () => {
    expect(slugifyTitle("!!!")).toBe("");
    expect(slugifyTitle("x".repeat(200)).length).toBeLessThanOrEqual(48);
  });
});

describe("makePublishSlug", () => {
  it("appends a 4-char suffix and falls back to 'trip'", () => {
    const seq = () => 0.5; // deterministic rand
    expect(makePublishSlug("Japan in Spring", seq)).toMatch(/^japan-in-spring-[a-z0-9]{4}$/);
    expect(makePublishSlug("!!!", seq)).toMatch(/^trip-[a-z0-9]{4}$/);
  });
  it("suffix is url-safe and deterministic for a fixed rand", () => {
    expect(slugSuffix(() => 0)).toBe("0000");
    expect(slugSuffix(() => 0.999999)).toMatch(/^[a-z0-9]{4}$/);
  });
});

describe("joinRequestError", () => {
  const base: Parameters<typeof joinRequestError>[0] = { isOpen: true, isOwner: false, isMember: false, existingStatus: null };
  it("allows a fresh request on an open trip", () => {
    expect(joinRequestError(base)).toBeNull();
  });
  it("blocks the owner, members and closed trips", () => {
    expect(joinRequestError({ ...base, isOwner: true })).toMatch(/own this trip/);
    expect(joinRequestError({ ...base, isMember: true })).toMatch(/already on this trip/);
    expect(joinRequestError({ ...base, isOpen: false })).toMatch(/isn't accepting/);
  });
  it("blocks duplicate pending/accepted requests, allows re-request after decline", () => {
    expect(joinRequestError({ ...base, existingStatus: "pending" })).toMatch(/already waiting/);
    expect(joinRequestError({ ...base, existingStatus: "accepted" })).toMatch(/already accepted/);
    expect(joinRequestError({ ...base, existingStatus: "declined" })).toBeNull();
  });
});

describe("updateBodyError", () => {
  it("trims, requires non-empty, caps at 2000", () => {
    expect(updateBodyError("  ")).toMatch(/empty/);
    expect(updateBodyError("Booked the ryokan!")).toBeNull();
    expect(updateBodyError("x".repeat(2000))).toBeNull();
    expect(updateBodyError("x".repeat(2001))).toMatch(/2000/);
  });
});
