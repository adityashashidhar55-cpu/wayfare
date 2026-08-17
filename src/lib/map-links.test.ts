import { describe, expect, it } from "vitest";
import {
  applePlaceLink,
  appleRouteLink,
  googleEmbedUrl,
  googlePlaceLink,
  googleRouteLink,
  osmPlaceLink,
  osmRouteLink,
  placeLinks,
  routeLinks,
} from "@contracts/map-links";

describe("place deep links", () => {
  const geocoded = { name: "Louvre Museum", lat: 48.8606, lng: 2.3376 };
  const named = { name: "Mong Kok Market, Hong Kong" };

  it("google place link uses coordinates when geocoded", () => {
    expect(googlePlaceLink(geocoded)).toBe(
      "https://www.google.com/maps/search/?api=1&query=48.8606%2C2.3376",
    );
  });

  it("google place link falls back to the encoded name", () => {
    expect(googlePlaceLink(named)).toBe(
      "https://www.google.com/maps/search/?api=1&query=Mong%20Kok%20Market%2C%20Hong%20Kong",
    );
  });

  it("apple place link pins ll= when geocoded and keeps the name", () => {
    expect(applePlaceLink(geocoded)).toBe(
      "https://maps.apple.com/?q=Louvre%20Museum&ll=48.8606,2.3376",
    );
    expect(applePlaceLink(named)).toBe(
      "https://maps.apple.com/?q=Mong%20Kok%20Market%2C%20Hong%20Kong",
    );
  });

  it("osm place link uses mlat/mlon marker at zoom 17, search otherwise", () => {
    expect(osmPlaceLink(geocoded)).toBe(
      "https://www.openstreetmap.org/?mlat=48.8606&mlon=2.3376#map=17/48.8606/2.3376",
    );
    expect(osmPlaceLink(named)).toBe(
      "https://www.openstreetmap.org/search?query=Mong%20Kok%20Market%2C%20Hong%20Kong",
    );
  });

  it("placeLinks returns all three providers", () => {
    const links = placeLinks(geocoded);
    expect(links.google).toContain("google.com/maps/search");
    expect(links.apple).toContain("maps.apple.com");
    expect(links.osm).toContain("openstreetmap.org");
  });
});

describe("day route deep links", () => {
  const stops = [
    { name: "Start Hotel", lat: 1, lng: 2 },
    { name: "Mid Museum" }, // no coords: name used
    { name: "End Cafe", lat: 3, lng: 4 },
  ];

  it("google route link carries origin, destination and waypoints", () => {
    const url = googleRouteLink(stops)!;
    expect(url).toContain("https://www.google.com/maps/dir/?api=1");
    expect(url).toContain("origin=1%2C2");
    expect(url).toContain("destination=3%2C4");
    expect(url).toContain("waypoints=Mid%20Museum");
    expect(url).toContain("travelmode=walking");
  });

  it("apple route link chains daddr", () => {
    const url = appleRouteLink(stops)!;
    expect(url).toContain("saddr=1%2C2");
    expect(url).toContain("daddr=Mid%20Museum+to:3%2C4");
  });

  it("osm route link uses first and last geocoded stops", () => {
    expect(osmRouteLink(stops)).toBe(
      "https://www.openstreetmap.org/directions?from=1%2C2&to=3%2C4#map=14/1/2",
    );
  });

  it("single stop degrades to a place link; empty returns null", () => {
    expect(googleRouteLink([stops[0]!])).toBe(googlePlaceLink(stops[0]!));
    expect(routeLinks([])).toEqual({ google: null, apple: null, osm: null });
  });
});

describe("google embed url (premium)", () => {
  it("returns null without a key (graceful unavailable state)", () => {
    expect(googleEmbedUrl(null, [{ name: "X", lat: 1, lng: 2 }])).toBeNull();
    expect(googleEmbedUrl("", [{ name: "X", lat: 1, lng: 2 }])).toBeNull();
  });

  it("returns null without stops", () => {
    expect(googleEmbedUrl("fake-key", [])).toBeNull();
  });

  it("builds a place embed for one stop", () => {
    expect(googleEmbedUrl("fake-key", [{ name: "Louvre", lat: 48.86, lng: 2.33 }])).toBe(
      "https://www.google.com/maps/embed/v1/place?key=fake-key&q=48.86%2C2.33",
    );
  });

  it("builds a directions embed for a route", () => {
    const url = googleEmbedUrl("fake-key", [
      { name: "A", lat: 1, lng: 2 },
      { name: "B" },
      { name: "C", lat: 3, lng: 4 },
    ])!;
    expect(url).toContain("/maps/embed/v1/directions");
    expect(url).toContain("key=fake-key");
    expect(url).toContain("origin=1%2C2");
    expect(url).toContain("destination=3%2C4");
    expect(url).toContain("waypoints=B");
  });
});
