/**
 * r12-routeui: lightweight client-side mirror of the curated famous routes
 * (canonical data + corridor matching lives server-side in
 * api/lib/popular-routes.ts). The planner form only needs name matching to
 * show a "this looks like the Golden Route" hint and quick-start chips, so a
 * small curated subset with endpoint city names is enough - the server does
 * the authoritative geographic match when the plan runs.
 */

export interface PopularRouteHint {
  slug: string;
  name: string;
  blurb: string;
  /** Lowercased city names along the route (matching is substring-based). */
  cities: string[];
  /** Suggested form fill: [origin, destination]. */
  suggested: [string, string];
}

export const POPULAR_ROUTE_HINTS: PopularRouteHint[] = [
  {
    slug: "golden-route-japan",
    name: "Golden Route",
    blurb: "Tokyo, Hakone, Kyoto, Nara and Osaka. Japan's classic first-timer arc.",
    cities: ["tokyo", "hakone", "kyoto", "nara", "osaka"],
    suggested: ["Kyoto", "Tokyo"],
  },
  {
    slug: "amalfi-coast",
    name: "Amalfi Coast",
    blurb: "Cliff-hugging villages from Sorrento to Salerno.",
    cities: ["naples", "sorrento", "positano", "amalfi", "ravello", "salerno"],
    suggested: ["Naples", "Salerno"],
  },
  {
    slug: "iceland-ring-road",
    name: "Ring Road",
    blurb: "Route 1 around Iceland: waterfalls, glaciers, black-sand beaches.",
    cities: ["reykjavik", "vik", "höfn", "egilsstaðir", "akureyri"],
    suggested: ["Reykjavik", "Akureyri"],
  },
  {
    slug: "route-66",
    name: "Route 66",
    blurb: "The Mother Road from Chicago to Santa Monica.",
    cities: ["chicago", "st. louis", "oklahoma city", "amarillo", "albuquerque", "flagstaff", "los angeles"],
    suggested: ["Chicago", "Los Angeles"],
  },
  {
    slug: "garden-route",
    name: "Garden Route",
    blurb: "Cape Town to Port Elizabeth along lagoons and whale coast.",
    cities: ["cape town", "hermanus", "mossel bay", "knysna", "plettenberg bay", "port elizabeth"],
    suggested: ["Cape Town", "Port Elizabeth"],
  },
  {
    slug: "great-ocean-road",
    name: "Great Ocean Road",
    blurb: "Victoria's surf-and-limestone classic out of Melbourne.",
    cities: ["melbourne", "torquay", "lorne", "apollo bay", "port campbell", "warrnambool"],
    suggested: ["Melbourne", "Warrnambool"],
  },
];

/** "Mumbai, India" → "mumbai" (the part users actually type). */
function cityKey(text: string): string {
  return text.split(",")[0]!.trim().toLowerCase();
}

/**
 * Both endpoints set and each naming a different city on the same curated
 * route → that route (server confirms with real corridor geometry later).
 */
export function matchRouteHint(from: string, to: string): PopularRouteHint | null {
  const a = cityKey(from);
  const b = cityKey(to);
  if (!a || !b) return null;
  for (const r of POPULAR_ROUTE_HINTS) {
    const hitA = r.cities.some((c) => a.includes(c) || c.includes(a));
    const hitB = r.cities.some((c) => b.includes(c) || c.includes(b));
    if (hitA && hitB && a !== b) return r;
  }
  return null;
}
