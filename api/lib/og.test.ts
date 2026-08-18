import { describe, expect, it } from "vitest";
import { injectOg, formatRange, tripCard } from "./og";

const SHELL = `<!doctype html><html><head>
  <meta charset="utf-8">
  <title>Wayfare</title>
  <meta name="description" content="generic">
  <meta property="og:title" content="Wayfare · Every journey">
  <meta property="og:image" content="/og-image.png">
  <meta name="twitter:card" content="summary">
</head><body></body></html>`;

describe("injectOg", () => {
  const card = { title: "Kerala with the lads", description: "6 days", url: "https://w.app/shared/abc", image: "/cover.jpg" };

  it("injects the real title", () => {
    expect(injectOg(SHELL, card, "https://w.app")).toContain('content="Kerala with the lads"');
  });

  it("REMOVES the generic tags rather than leaving duplicates", () => {
    // Two og:title tags in one document and crawlers disagree on which wins;
    // several take the first, which would leave the generic card in place and
    // make this whole module silently pointless.
    const out = injectOg(SHELL, card, "https://w.app");
    expect(out).not.toContain("Wayfare · Every journey");
    expect(out.match(/property="og:title"/g)).toHaveLength(1);
    expect(out.match(/name="twitter:card"/g)).toHaveLength(1);
    expect(out.match(/<title>/g)).toHaveLength(1);
  });

  it("makes relative images absolute - crawlers reject relative og:image", () => {
    expect(injectOg(SHELL, card, "https://w.app")).toContain('content="https://w.app/cover.jpg"');
  });

  it("passes absolute images through untouched", () => {
    const out = injectOg(SHELL, { ...card, image: "https://cdn.x/a.jpg" }, "https://w.app");
    expect(out).toContain('content="https://cdn.x/a.jpg"');
  });

  it("falls back to the brand image when a trip has no cover", () => {
    expect(injectOg(SHELL, { ...card, image: null }, "https://w.app")).toContain("https://w.app/og-image.png");
  });

  it("escapes quotes so a trip title cannot break out of the attribute", () => {
    const nasty = { ...card, title: `Bali "best" trip <script>alert(1)</script>` };
    const out = injectOg(SHELL, nasty, "https://w.app");
    expect(out).not.toContain("<script>alert(1)</script>");
    expect(out).toContain("&quot;best&quot;");
  });

  it("leaves the body untouched so the SPA still boots for humans", () => {
    expect(injectOg(SHELL, card, "https://w.app")).toContain("<body></body>");
  });
});

describe("formatRange", () => {
  it("collapses a same-month range", () => {
    expect(formatRange("2027-03-12", "2027-03-19")).toBe("12-19 Mar 2027");
  });
  it("spans months and years", () => {
    expect(formatRange("2027-03-28", "2027-04-04")).toBe("28 Mar - 4 Apr 2027");
    expect(formatRange("2027-12-28", "2028-01-03")).toBe("28 Dec 2027 - 3 Jan 2028");
  });
  it("returns empty rather than throwing on missing or malformed dates", () => {
    expect(formatRange(null, null)).toBe("");
    expect(formatRange("nonsense", "2027-01-01")).toBe("");
  });
});

describe("tripCard", () => {
  it("reads like a person describing their trip", () => {
    const c = tripCard({ title: "Kerala", destination: "Kerala, India",
      startDate: "2027-03-12", endDate: "2027-03-19", stopCount: 18, memberCount: 4,
      dayCount: 8, url: "https://w.app/p/kerala", joinable: true });
    expect(c.description).toContain("Kerala, India");
    expect(c.description).toContain("12-19 Mar 2027");
    expect(c.description).toContain("18 stops");
    expect(c.description).toContain("4 travellers");
    expect(c.description).toContain("ask to join");
  });
  it("degrades to something sensible with no detail at all", () => {
    const c = tripCard({ title: "My trip", url: "https://w.app/p/x" });
    expect(c.description).toContain("A trip planned on Wayfare");
  });
  it("does not claim one traveller is a group", () => {
    expect(tripCard({ title: "t", memberCount: 1, url: "u" }).description).not.toContain("travellers");
  });
});
