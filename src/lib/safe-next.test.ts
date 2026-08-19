import { describe, it, expect } from "vitest";
import { safeNextPath } from "./safe-next";

const ORIGIN = "https://wayfare.app";

describe("safeNextPath", () => {
  it("keeps an ordinary in-app path", () => {
    expect(safeNextPath("/p/kyoto-in-bloom", ORIGIN)).toBe("/p/kyoto-in-bloom");
  });
  it("keeps query and hash", () => {
    expect(safeNextPath("/trips?new=1#top", ORIGIN)).toBe("/trips?new=1#top");
  });

  // The actual bug: every one of these passed `startsWith("/")`.
  it("rejects a protocol-relative URL", () => {
    expect(safeNextPath("//evil.example", ORIGIN)).toBe("/trips");
  });
  it("rejects a protocol-relative URL with a path", () => {
    expect(safeNextPath("//evil.example/login", ORIGIN)).toBe("/trips");
  });
  it("rejects backslash variants browsers normalise to //", () => {
    expect(safeNextPath("/\\evil.example", ORIGIN)).toBe("/trips");
    expect(safeNextPath("\\\\evil.example", ORIGIN)).toBe("/trips");
  });

  it("rejects an absolute URL to another origin", () => {
    expect(safeNextPath("https://evil.example/x", ORIGIN)).toBe("/trips");
  });
  it("rejects a different port on the same host", () => {
    expect(safeNextPath("https://wayfare.app:8443/x", ORIGIN)).toBe("/trips");
  });
  it("rejects http when the origin is https", () => {
    expect(safeNextPath("http://wayfare.app/x", ORIGIN)).toBe("/trips");
  });
  it("rejects a javascript: URL", () => {
    expect(safeNextPath("javascript:alert(1)", ORIGIN)).toBe("/trips");
  });
  it("rejects a data: URL", () => {
    expect(safeNextPath("data:text/html,<script>1</script>", ORIGIN)).toBe("/trips");
  });
  it("rejects a lookalike host", () => {
    expect(safeNextPath("https://wayfare.app.evil.example/x", ORIGIN)).toBe("/trips");
  });

  it("falls back when absent", () => {
    expect(safeNextPath(null, ORIGIN)).toBe("/trips");
    expect(safeNextPath("", ORIGIN)).toBe("/trips");
    expect(safeNextPath(undefined, ORIGIN)).toBe("/trips");
  });
  it("keeps an absolute URL that IS the same origin", () => {
    expect(safeNextPath("https://wayfare.app/explore", ORIGIN)).toBe("/explore");
  });
});
