import { describe, expect, it } from "vitest";
import {
  normalizeName,
  parseGdacs,
  parseStateDept,
  resolveCountryName,
} from "./safety-router";

// Fixtures mirror the real feed shapes (see scripts/verify-safety.mts output).

const STATE_DEPT_XML = `<?xml version="1.0" encoding="UTF-8"?>
<rss xmlns:dc="http://purl.org/dc/elements/1.1/" version="2.0">
  <channel>
    <title>travel.state.gov: Travel Advisories</title>
    <item>
      <title>Japan - Level 1: Exercise Normal Precautions</title>
      <link>https://travel.state.gov/content/travel/en/traveladvisories/traveladvisories/japan-travel-advisory.html</link>
      <pubDate>Mon, 20 Jul 2026</pubDate>
    </item>
    <item>
      <title>Mexico Travel Advisory - Level 2: Exercise Increased Caution</title>
      <link>https://example.com/mexico</link>
      <pubDate>Thu, 21 May 2026</pubDate>
    </item>
    <item>
      <title>Mainland China, Hong Kong &amp; Macau - See Summaries - Level 2: Exercise Increased Caution</title>
      <link>https://example.com/china</link>
      <pubDate>Tue, 07 Jul 2026</pubDate>
    </item>
    <item>
      <title>Syria - Level 4: Do Not Travel</title>
      <link>https://example.com/syria</link>
      <pubDate>Fri, 15 May 2026</pubDate>
    </item>
    <item>
      <title>Switzerland  - Level 1: Exercise Normal Precautions</title>
      <link>https://example.com/ch</link>
      <pubDate>Tue, 14 Oct 2025</pubDate>
    </item>
  </channel>
</rss>`;

const GDACS_XML = `<?xml version="1.0" encoding="utf-8"?>
<rss version="2.0" xmlns:geo="http://www.w3.org/2003/01/geo/wgs84_pos#" xmlns:gdacs="http://www.gdacs.org">
  <channel>
    <item>
      <title>Green earthquake (Magnitude 5.5M, Depth:35km) in Mexico 19/07/2026 17:45 UTC, 440 thousand in MMI IV.</title>
      <link>https://www.gdacs.org/report.aspx?eventtype=EQ&amp;eventid=1552874</link>
      <pubDate>Sun, 19 Jul 2026 18:01:18 GMT</pubDate>
      <geo:Point><geo:lat>14.1592</geo:lat><geo:long>-92.9052</geo:long></geo:Point>
      <gdacs:eventtype>EQ</gdacs:eventtype>
      <gdacs:alertlevel>Green</gdacs:alertlevel>
      <gdacs:fromdate>Sun, 19 Jul 2026 17:45:16 GMT</gdacs:fromdate>
      <gdacs:eventid>1552874</gdacs:eventid>
      <gdacs:severity unit="M" value="5.5">Magnitude 5.5M, Depth:35km</gdacs:severity>
      <gdacs:country>Mexico</gdacs:country>
    </item>
    <item>
      <title>Red tropical cyclone BUALOI 26/07/2026 00:00 UTC.</title>
      <link>https://www.gdacs.org/report.aspx?eventtype=TC&amp;eventid=1001</link>
      <pubDate>Sat, 25 Jul 2026 00:00:00 GMT</pubDate>
      <geo:Point><geo:lat>16.1</geo:lat><geo:long>108.2</geo:long></geo:Point>
      <gdacs:eventtype>TC</gdacs:eventtype>
      <gdacs:alertlevel>Red</gdacs:alertlevel>
      <gdacs:fromdate>Sat, 25 Jul 2026 00:00:00 GMT</gdacs:fromdate>
      <gdacs:eventid>1001</gdacs:eventid>
      <gdacs:severity unit="km/h" value="120">Category 1</gdacs:severity>
      <gdacs:country>Vietnam</gdacs:country>
    </item>
    <item>
      <title>Green earthquake (Magnitude 5.4M) in Mexico 18/07/2026 10:00 UTC.</title>
      <link>https://www.gdacs.org/report.aspx?eventtype=EQ&amp;eventid=1552874</link>
      <pubDate>Sat, 18 Jul 2026 10:00:00 GMT</pubDate>
      <geo:Point><geo:lat>14.1</geo:lat><geo:long>-92.9</geo:long></geo:Point>
      <gdacs:eventtype>EQ</gdacs:eventtype>
      <gdacs:alertlevel>Green</gdacs:alertlevel>
      <gdacs:fromdate>Sat, 18 Jul 2026 10:00:00 GMT</gdacs:fromdate>
      <gdacs:eventid>1552874</gdacs:eventid>
      <gdacs:severity unit="M" value="5.4">Magnitude 5.4M</gdacs:severity>
      <gdacs:country>Mexico</gdacs:country>
    </item>
  </channel>
</rss>`;

describe("parseStateDept", () => {
  it("extracts level, label, country and updated date from real feed shapes", () => {
    const rows = parseStateDept(STATE_DEPT_XML);
    const byCountry = new Map(rows.map((r) => [r.country, r]));
    expect(rows).toHaveLength(5);
    expect(byCountry.get("Japan")?.level).toBe(1);
    expect(byCountry.get("Japan")?.levelLabel).toBe("Exercise Normal Precautions");
    expect(byCountry.get("Japan")?.updated).toBe("2026-07-20");
    // "Mexico Travel Advisory - Level 2: …" → country normalized to "Mexico"
    expect(byCountry.get("Mexico")?.level).toBe(2);
    // extra "See Summaries" segment is tolerated
    expect(byCountry.get("Mainland China, Hong Kong & Macau")?.level).toBe(2);
    expect(byCountry.get("Syria")?.level).toBe(4);
    expect(byCountry.get("Syria")?.levelLabel).toBe("Do Not Travel");
  });

  it("returns zero rows for the empty legacy TAs.xml channel", () => {
    const empty = `<?xml version="1.0"?><rss version="2.0"><channel><title>x</title></channel></rss>`;
    expect(parseStateDept(empty)).toHaveLength(0);
  });
});

describe("parseGdacs", () => {
  it("parses kind, severity, coordinates and dedupes by event id", () => {
    const events = parseGdacs(GDACS_XML);
    expect(events).toHaveLength(2);
    const eq = events.find((e) => e.kind === "earthquake");
    expect(eq?.severity).toBe("Green");
    expect(eq?.lat).toBeCloseTo(14.1592);
    expect(eq?.lng).toBeCloseTo(-92.9052);
    expect(eq?.date).toBe("2026-07-19");
    expect(eq?.severityDetail).toContain("Magnitude 5.5M");
    const tc = events.find((e) => e.kind === "cyclone");
    expect(tc?.severity).toBe("Red");
    expect(tc?.country).toBe("Vietnam");
  });
});

describe("country normalization", () => {
  const feedCountries = [
    "Japan",
    "Switzerland",
    "The Bahamas",
    "Burma",
    "Kingdom of Denmark",
    "Côte d’Ivoire",
    "Democratic Republic of the Congo",
  ];

  it("matches exact country names and City, Country destinations", () => {
    expect(resolveCountryName("Japan", feedCountries)).toBe("Japan");
    expect(resolveCountryName("Kyoto, Japan", feedCountries)).toBe("Japan");
    expect(resolveCountryName("Switzerland", feedCountries)).toBe("Switzerland");
  });

  it("uses the alias table for cities and alternate country names", () => {
    expect(resolveCountryName("Kyoto", feedCountries)).toBe("Japan");
    expect(resolveCountryName("Copenhagen, Denmark", feedCountries)).toBe("Kingdom of Denmark");
    expect(resolveCountryName("Myanmar", feedCountries)).toBe("Burma");
    expect(resolveCountryName("Ivory Coast", feedCountries)).toBe("Côte d’Ivoire");
    expect(resolveCountryName("Bahamas", feedCountries)).toBe("The Bahamas");
  });

  it("falls back to substring matching against the feed list", () => {
    expect(resolveCountryName("Democratic Republic of the Congo (DRC)", feedCountries)).toBe(
      "Democratic Republic of the Congo",
    );
  });

  it("normalizeName strips diacritics and punctuation", () => {
    expect(normalizeName("Côte d’Ivoire")).toBe("cote d ivoire");
    expect(normalizeName("São Tomé and Príncipe")).toBe("sao tome and principe");
  });

  it("returns null when nothing matches", () => {
    expect(resolveCountryName("Atlantis", feedCountries)).toBeNull();
  });
});
