import { describe, expect, it } from "vitest";
import { bookingLinks, bookingSummaryLine, bookingsSummary, stayLink } from "./booking-links";

describe("bookingLinks", () => {
  // Order is deliberate: experiences (8-30% of booking value) come before
  // TripAdvisor and the untagged Google fallback.
  it("orders providers by payout, highest first", () => {
    const links = bookingLinks("Colosseum", "Rome");
    expect(links.map((l) => l.key)).toEqual([
      "getyourguide",
      "viator",
      "klook",
      "tripadvisor",
      "google",
    ]);
    for (const l of links) expect(l.url.startsWith("https://")).toBe(true);
  });

  it("URL-encodes the name+city query", () => {
    const [gyg] = bookingLinks("Musée d'Orsay", "Paris");
    expect(gyg.url).toContain(`q=${encodeURIComponent("Musée d'Orsay Paris")}`);
  });

  it("matches the expected provider URL shapes", () => {
    const links = bookingLinks("TeamLab Planets", "Tokyo");
    const q = encodeURIComponent("TeamLab Planets Tokyo");
    expect(links[0].url).toContain(`https://www.getyourguide.com/s/?q=${q}`);
    expect(links[1].url).toContain(`https://www.viator.com/searchResults/all?text=${q}`);
    expect(links[2].url).toContain(`https://www.klook.com/en-US/search?query=${q}`);
    expect(links[3].url).toContain(`https://www.tripadvisor.com/Search?q=${q}`);
    expect(links[4].url).toContain("tickets");
  });

  it("works without a city", () => {
    const [gyg] = bookingLinks("Colosseum");
    expect(gyg.url).toContain(`q=${encodeURIComponent("Colosseum")}`);
  });

  // With no VITE_AFF_* env vars set (the default in test), links must be
  // untagged and clearly marked as non-earning rather than silently
  // pretending to carry a partner id.
  it("degrades to untagged links when no partner ids are configured", () => {
    for (const l of bookingLinks("Colosseum", "Rome")) {
      expect(l.affiliate).toBe(false);
      expect(l.url).not.toContain("partner_id=");
      expect(l.url).not.toContain("pid=");
    }
  });

  it("never emits an empty query parameter", () => {
    for (const l of bookingLinks("Colosseum", "Rome")) {
      expect(l.url).not.toMatch(/[?&][a-z_]+=(&|$)/);
    }
  });
});

describe("stayLink", () => {
  it("builds a Booking.com city search", () => {
    const s = stayLink("Coorg");
    expect(s.key).toBe("booking");
    expect(s.url).toContain("https://www.booking.com/searchresults.html?ss=Coorg");
  });

  it("includes dates when both are supplied", () => {
    const s = stayLink("Coorg", "2026-09-04", "2026-09-06");
    expect(s.url).toContain("checkin=2026-09-04");
    expect(s.url).toContain("checkout=2026-09-06");
  });

  it("omits dates when only one is supplied", () => {
    expect(stayLink("Coorg", "2026-09-04", null).url).not.toContain("checkin=");
  });
});

describe("bookingsSummary", () => {
  it("marks booked vs pending and includes pasted URLs", () => {
    expect(
      bookingSummaryLine({
        name: "Uffizi",
        dayLabel: "Day 2",
        booked: true,
        bookingUrl: "https://confirm.example/abc",
      }),
    ).toBe("- Uffizi (Day 2): BOOKED - https://confirm.example/abc");
    expect(
      bookingSummaryLine({ name: "Duomo", booked: false }),
    ).toBe("- Duomo: pending");
  });

  it("summarizes a whole trip with counts", () => {
    const out = bookingsSummary("Italy", [
      { name: "Uffizi", booked: true, bookingUrl: null },
      { name: "Duomo", booked: false },
    ]);
    expect(out).toContain("Wayfare bookings - Italy");
    expect(out).toContain("1 of 2 booked");
  });
});
