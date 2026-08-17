/**
 * booking-links.ts (r24-core, feature G) - pure builders for outbound
 * booking deep links. HONEST by design: Wayfare has no in-app booking, these
 * open provider searches in a new tab.
 *
 * AFFILIATE TAGGING. These links previously carried no partner ids at all,
 * so every click sent qualified purchase intent to an OTA for free. Partner
 * ids come from Vite env vars and each one is optional - an unset id simply
 * produces the same untagged link as before, so nothing breaks before you
 * have an account.
 *
 * Rate context (why the ordering below matters): activity/experience programs
 * pay 8-30% of booking value; hotels 3-7%; flights 1-2%. Indian OTAs pay flat
 * per-booking fees (~Rs 90-170) and IRCTC pays nothing at all on train
 * tickets. So surface experiences first.
 *
 * IMPORTANT: rel="noreferrer" at the call site strips the Referer header,
 * which some affiliate programs use for attribution. Query-string tags (what
 * we use here) survive it, but if you add a program that attributes by
 * referrer, switch that call site to rel="noopener" only.
 *
 * Set in .env:
 *   VITE_AFF_GETYOURGUIDE   GetYourGuide partner id
 *   VITE_AFF_VIATOR         Viator / TripAdvisor partner id (pid)
 *   VITE_AFF_KLOOK          Klook aid
 *   VITE_AFF_BOOKING        Booking.com aid
 */

export interface BookingLink {
  key: "viator" | "tripadvisor" | "getyourguide" | "klook" | "booking" | "google";
  label: string;
  url: string;
  /** True when this link carries our partner id (i.e. it can earn). */
  affiliate?: boolean;
}

const enc = encodeURIComponent;

/** Reads a Vite env var, tolerating non-Vite contexts (tests, SSR). */
function affId(name: string): string {
  try {
    return (import.meta as unknown as { env?: Record<string, string> }).env?.[name]?.trim() ?? "";
  } catch {
    return "";
  }
}

/** Appends `params` to `url`, skipping any whose value is empty. */
function withParams(url: string, params: Record<string, string>): { url: string; tagged: boolean } {
  const entries = Object.entries(params).filter(([, v]) => v);
  if (!entries.length) return { url, tagged: false };
  const sep = url.includes("?") ? "&" : "?";
  const qs = entries.map(([k, v]) => `${k}=${enc(v)}`).join("&");
  return { url: `${url}${sep}${qs}`, tagged: true };
}

/** "<name>, <city>" query used across providers; city is optional. */
function query(name: string, city?: string | null): string {
  return city?.trim() ? `${name.trim()} ${city.trim()}` : name.trim();
}

/** Outbound booking search links for one stop/activity. */
export function bookingLinks(
  name: string,
  city?: string | null,
): BookingLink[] {
  const q = enc(query(name, city));

  // Ordered by payout, highest first - experiences pay several times what
  // hotel or flight programs do, and this is the order the user sees.
  const gyg = withParams(`https://www.getyourguide.com/s/?q=${q}`, {
    partner_id: affId("VITE_AFF_GETYOURGUIDE"),
  });
  const viator = withParams(`https://www.viator.com/searchResults/all?text=${q}`, {
    pid: affId("VITE_AFF_VIATOR"),
    mcid: affId("VITE_AFF_VIATOR") ? "42383" : "",
  });
  const klook = withParams(`https://www.klook.com/en-US/search?query=${q}`, {
    aid: affId("VITE_AFF_KLOOK"),
  });
  const tripadvisor = withParams(`https://www.tripadvisor.com/Search?q=${q}`, {
    pid: affId("VITE_AFF_VIATOR"),
  });

  return [
    { key: "getyourguide", label: "GetYourGuide", url: gyg.url, affiliate: gyg.tagged },
    { key: "viator", label: "Viator", url: viator.url, affiliate: viator.tagged },
    { key: "klook", label: "Klook", url: klook.url, affiliate: klook.tagged },
    { key: "tripadvisor", label: "TripAdvisor", url: tripadvisor.url, affiliate: tripadvisor.tagged },
    {
      key: "google",
      label: "Google tickets",
      url: `https://www.google.com/search?q=${q}+tickets`,
      affiliate: false,
    },
  ];
}

/** Outbound stay-booking search link for a city (hotels pay 3-7%). */
export function stayLink(city: string, checkIn?: string | null, checkOut?: string | null): BookingLink {
  const base = `https://www.booking.com/searchresults.html?ss=${enc(city.trim())}`;
  const dated =
    checkIn && checkOut ? `${base}&checkin=${enc(checkIn)}&checkout=${enc(checkOut)}` : base;
  const { url, tagged } = withParams(dated, { aid: affId("VITE_AFF_BOOKING") });
  return { key: "booking", label: "Booking.com", url, affiliate: tagged };
}

/** One-line plain-text summary of a booked item (for copy-to-clipboard). */
export function bookingSummaryLine(item: {
  name: string;
  dayLabel?: string | null;
  booked: boolean;
  bookingUrl?: string | null;
}): string {
  const status = item.booked ? "BOOKED" : "pending";
  const day = item.dayLabel ? ` (${item.dayLabel})` : "";
  const url = item.booked && item.bookingUrl ? ` - ${item.bookingUrl}` : "";
  return `- ${item.name}${day}: ${status}${url}`;
}

/** Full trip bookings summary for clipboard/export. */
export function bookingsSummary(
  tripTitle: string,
  items: Parameters<typeof bookingSummaryLine>[0][],
): string {
  const booked = items.filter((i) => i.booked).length;
  const lines = items.map(bookingSummaryLine);
  return [
    `Wayfare bookings - ${tripTitle}`,
    `${booked} of ${items.length} booked`,
    "",
    ...lines,
    "",
    "Bookings happen on the provider sites; this is a tracking summary.",
  ].join("\n");
}
