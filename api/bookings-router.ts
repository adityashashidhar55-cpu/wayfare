/**
 * Bookings router (r9-bookings): "forward your bookings by email" pipeline.
 *
 * Two entry points share one engine:
 *  - `bookings.parseBookingEmails` (tRPC) - paste one or more confirmation
 *    emails in the Reservations tab; each is classified (flight / train /
 *    lodging / car / activity), parsed, inserted as a reservation
 *    (source="email-import"), and - for lodging/activity/car/train items with
 *    a geocodable name - laid out on the trip calendar (a stop on the matching
 *    trip day, nearest in-range day when the date falls outside the trip) and
 *    the map (Photon geocoding biased to the trip destination).
 *  - POST /api/inbound/:token (Hono route in boot.ts) - SendGrid Inbound
 *    Parse / Mailgun compatible webhook that runs the same engine against the
 *    token owner's most-recent active trip (creating a trip from the booking
 *    dates when none exists). Token = `${userId}.${HMAC-SHA256(userId)}`.
 *
 * The parser is defensive: garbage in never throws, it produces a per-email
 * failure entry with a human reason.
 */
import { createHmac, timingSafeEqual } from "node:crypto";
import { and, asc, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import * as schema from "@db/schema";
import { getDb } from "./queries/connection";
import { authedQuery, createRouter } from "./middleware";
import { getTier } from "./queries/subscriptions";
import { geocodeCity, searchPhoton } from "./queries/overpass";
import { TIERS } from "@contracts/premium";
import { env } from "./lib/env";

// ─── Shared parser types ─────────────────────────────────────────────────────

export type BookingKind =
  "flight" | "train" | "lodging" | "car" | "activity" | "other";

export interface ParsedBooking {
  kind: BookingKind;
  type: string; // reservations.type
  title: string;
  provider: string | null;
  confirmationCode: string | null;
  startDate: string | null; // YYYY-MM-DD
  endDate: string | null;
  startTime: string | null; // HH:MM - used for the placed stop
  details: string | null; // raw snippet of the source email
  amountCents: number | null;
  currency: string | null;
  placeName: string | null; // geocodable name (property / venue / station)
  address: string | null;
  city: string | null;
  fromCode: string | null; // IATA / station code when known
  toCode: string | null;
}

// ─── Small text utilities ────────────────────────────────────────────────────

const MONTHS: Record<string, string> = {
  jan: "01",
  feb: "02",
  mar: "03",
  apr: "04",
  may: "05",
  jun: "06",
  jul: "07",
  aug: "08",
  sep: "09",
  oct: "10",
  nov: "11",
  dec: "12",
};

/** Parse a date out of free text → YYYY-MM-DD (ISO, "14 Aug 2026", "Aug 14, 2026", "08/14/2026"). */
function parseDateFrom(text: string): string | null {
  const iso = text.match(/\b(20\d{2})-(\d{2})-(\d{2})\b/);
  if (iso) return iso[0];
  const m1 = text.match(
    /\b(\d{1,2})(?:st|nd|rd|th)?\s*(?:of\s+)?(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*[\s,]+(20\d{2})\b/i
  );
  if (m1)
    return `${m1[3]}-${MONTHS[m1[2]!.slice(0, 3).toLowerCase()]}-${m1[1]!.padStart(2, "0")}`;
  const m2 = text.match(
    /\b(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s+(\d{1,2})(?:st|nd|rd|th)?[\s,]+(20\d{2})\b/i
  );
  if (m2)
    return `${m2[3]}-${MONTHS[m2[1]!.slice(0, 3).toLowerCase()]}-${m2[2]!.padStart(2, "0")}`;
  const m3 = text.match(/\b(\d{1,2})\/(\d{1,2})\/(20\d{2})\b/);
  if (m3) {
    const [a, b] = [Number(m3[1]), Number(m3[2])];
    const [mm, dd] = a > 12 ? [b, a] : [a, b];
    if (mm < 1 || mm > 12 || dd < 1 || dd > 31) return null;
    return `${m3[3]}-${String(mm).padStart(2, "0")}-${String(dd).padStart(2, "0")}`;
  }
  return null;
}

/** Parse a time → "HH:MM" (24h), handling AM/PM suffixes. */
function parseTimeFrom(text: string): string | null {
  const m = text.match(
    /\b([01]?\d|2[0-3]):([0-5]\d)\s*(a\.?m\.?|p\.?m\.?)?\b/i
  );
  if (!m) return null;
  let h = Number(m[1]);
  const ap = m[3]?.replace(/\./g, "").toLowerCase();
  if (ap === "pm" && h < 12) h += 12;
  if (ap === "am" && h === 12) h = 0;
  return `${String(h).padStart(2, "0")}:${m[2]}`;
}

const CURRENCY_CODES =
  "USD|EUR|GBP|JPY|CAD|AUD|KRW|CNY|HKD|SGD|THB|CHF|SEK|NOK|DKK|NZD|INR|MXN|BRL|AED|TWD";

function parseAmount(
  text: string
): { amountCents: number; currency: string } | null {
  const m =
    text.match(
      new RegExp(
        `\\b(${CURRENCY_CODES})\\b\\s*[$€£¥]?\\s*([\\d,]+(?:\\.\\d{2})?)`
      )
    ) ?? text.match(/([$€£¥])\s*([\d,]+(?:\.\d{2})?)/);
  if (!m) return null;
  const symMap: Record<string, string> = {
    $: "USD",
    "€": "EUR",
    "£": "GBP",
    "¥": "JPY",
  };
  const currency = /^[A-Z]{3}$/.test(m[1]!) ? m[1]! : (symMap[m[1]!] ?? "USD");
  const amountCents = Math.round(parseFloat(m[2]!.replace(/,/g, "")) * 100);
  if (!Number.isFinite(amountCents) || amountCents <= 0) return null;
  return { amountCents, currency };
}

/** Labeled confirmation/reference code - requires at least one digit so label words don't match. */
function parseConfirmationCode(text: string): string | null {
  const m = text.match(
    /(?:confirmation|booking|record locator|pnr|reservation|itinerary|reference)\s*(?:code|number|#|no\.?|ref(?:erence)?)?\s*[:#]?\s*\b((?=[A-Z0-9-]*\d)[A-Z0-9-]{5,12})\b/i
  );
  return m?.[1] ? m[1].toUpperCase().replace(/-/g, "").slice(0, 64) : null;
}

/** "Label: value" extraction from line-structured text (value stops at line/sentence end). */
function labeled(text: string, labels: string, max = 80): string | null {
  const m = text.match(
    new RegExp(
      `(?:^|\\n)\\s*(?:${labels})\\s*[:\\-–]\\s*([^\\n]{2,${max}})`,
      "i"
    )
  );
  const v = m?.[1]?.trim();
  return v ? v : null;
}

function cleanName(s: string): string {
  return s
    .replace(/\s+/g, " ")
    .split(/\s+[\u2014–]\s+/)[0]!
    .replace(
      /\s*(?:confirmation|booking|reservation)\s*(?:number|code|#).*$/i,
      ""
    )
    .replace(/[.,;:!]+$/, "")
    .trim();
}

/** Station/place value from a labeled line - rejects email headers like "From: a@b.c". */
function placeValue(v: string | null, max = 80): string | null {
  if (!v || /@|<|>/.test(v)) return null;
  const cleaned = cleanName(v).slice(0, max);
  return cleaned.length >= 2 ? cleaned : null;
}

/** Like `labeled`, but scans every match and returns the first real place (skips mail headers). */
function labeledPlace(text: string, labels: string, max = 80): string | null {
  const re = new RegExp(
    `(?:^|\\n)\\s*(?:${labels})\\s*[:\\-–]\\s*([^\\n]{2,${max}})`,
    "gi"
  );
  for (const m of text.matchAll(re)) {
    const v = placeValue(m[1] ?? null, max);
    if (v) return v;
  }
  return null;
}

function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function dateRange(start: string, end: string): string[] {
  const out: string[] = [];
  const d = new Date(start + "T00:00:00Z");
  const last = new Date(end + "T00:00:00Z");
  let i = 0;
  while (d <= last && i < 60) {
    out.push(d.toISOString().slice(0, 10));
    d.setUTCDate(d.getUTCDate() + 1);
    i++;
  }
  return out;
}

// ─── Flight ──────────────────────────────────────────────────────────────────

const AIRLINES = [
  "United",
  "Delta",
  "American Airlines",
  "ANA",
  "JAL",
  "Japan Airlines",
  "British Airways",
  "Lufthansa",
  "Emirates",
  "Qatar Airways",
  "Air France",
  "KLM",
  "Singapore Airlines",
  "Qantas",
  "Cathay Pacific",
  "Turkish Airlines",
  "Iberia",
  "Air Canada",
  "JetBlue",
  "Southwest",
  "Alaska Airlines",
  "Hawaiian Airlines",
  "Korean Air",
  "Asiana",
  "EVA Air",
  "Air New Zealand",
  "Aer Lingus",
  "Finnair",
  "SAS",
  "Swiss",
  "Austrian Airlines",
  "easyJet",
  "Ryanair",
  "Norwegian",
  "Vueling",
  "Peach Aviation",
  "ZIPAIR",
  "Jetstar",
];

function parseFlightEmail(flat: string): ParsedBooking | null {
  const lower = flat.toLowerCase();
  const airline = AIRLINES.find(a => lower.includes(a.toLowerCase())) ?? null;

  // Route: "SFO → NRT", "(SFO) … (NRT)", or "SFO to NRT".
  let fromCode: string | null = null;
  let toCode: string | null = null;
  const arrow = flat.match(/\b([A-Z]{3})\s*(?:→|->|\u2014|–|»|>)\s*([A-Z]{3})\b/);
  if (arrow) {
    fromCode = arrow[1]!;
    toCode = arrow[2]!;
  } else {
    const parens = [...flat.matchAll(/\(([A-Z]{3})\)/g)].map(m => m[1]!);
    if (parens.length >= 2 && parens[0] !== parens[1]) {
      fromCode = parens[0]!;
      toCode = parens[1]!;
    }
  }
  if (!fromCode) {
    const toM = flat.match(/\b([A-Z]{3})\s+to\s+([A-Z]{3})\b/);
    if (toM) {
      fromCode = toM[1]!;
      toCode = toM[2]!;
    }
  }

  const flightNoM =
    flat.match(
      /\bflight\s*(?:no\.?|number|#)?\s*[:.-]?\s*([A-Z]{2})\s?(\d{1,4}[A-Z]?)\b/i
    ) ?? (airline ? flat.match(/\b([A-Z]{2})\s?(\d{1,4})\b/) : null);
  const eticket = /\be-?ticket\b/i.test(flat);
  const flightWord = /\bflights?\b/i.test(flat);
  const pnrLabel = /(record locator|pnr|confirmation\s*(code|number|#))/i.test(
    flat
  );
  if (
    !airline &&
    !eticket &&
    !(flightWord && (flightNoM != null || pnrLabel || fromCode != null))
  ) {
    return null;
  }

  const departCtx =
    flat.match(/depart\w*\s*[:\-–]?\s*([^\n;|]{0,60})/i)?.[1] ?? "";
  const arriveCtx =
    flat.match(/arriv\w*\s*[:\-–]?\s*([^\n;|]{0,60})/i)?.[1] ?? "";
  const startDate = parseDateFrom(departCtx) ?? parseDateFrom(flat);
  const startTime = parseTimeFrom(departCtx) ?? parseTimeFrom(flat);
  const arriveTime = parseTimeFrom(arriveCtx);

  const flightNo = flightNoM
    ? `${flightNoM[1]!.toUpperCase()} ${flightNoM[2]!.toUpperCase()}`
    : null;
  const title = [
    flightNo ?? airline ?? "Flight",
    fromCode && toCode ? `${fromCode} → ${toCode}` : null,
  ]
    .filter(Boolean)
    .join(" · ");
  const times =
    startTime && arriveTime
      ? `Departs ${startTime} · Arrives ${arriveTime}`
      : null;

  return {
    kind: "flight",
    type: "flight",
    title,
    provider: airline,
    confirmationCode: null,
    startDate,
    endDate: null,
    startTime,
    details: times,
    amountCents: null,
    currency: null,
    placeName: null,
    address: null,
    city: null,
    fromCode,
    toCode,
  };
}

// ─── Train / rail ────────────────────────────────────────────────────────────

const RAIL_PROVIDERS: { re: RegExp; name: (m: RegExpMatchArray) => string }[] =
  [
    {
      re: /\bJR[-\s]?(East|West|Central|Kyushu|Hokkaido|Shikoku)\b/i,
      name: m => `JR ${m[1]![0]!.toUpperCase()}${m[1]!.slice(1).toLowerCase()}`,
    },
    { re: /\b(?:Japan Rail|JR)\s+Pass\b/i, name: () => "JR Pass" },
    { re: /\bShinkansen\b/i, name: () => "JR" },
    { re: /\bEurail\b/i, name: () => "Eurail" },
    { re: /\bInterrail\b/i, name: () => "Interrail" },
    { re: /\bAmtrak\b/i, name: () => "Amtrak" },
    {
      re: /\b(?:Deutsche Bahn|DB Bahn|DB Fernverkehr)\b/i,
      name: () => "Deutsche Bahn",
    },
    { re: /\bEurostar\b/i, name: () => "Eurostar" },
    { re: /\bSNCF\b|\bTGV\b/i, name: () => "SNCF" },
    { re: /\bRenfe\b/i, name: () => "Renfe" },
    { re: /\b(?:OEBB|ÖBB)\b/i, name: () => "ÖBB" },
    { re: /\bBrightline\b/i, name: () => "Brightline" },
    { re: /\bItalo\b/i, name: () => "Italo" },
    { re: /\bLNER\b/i, name: () => "LNER" },
  ];

function parseTrainEmail(text: string, flat: string): ParsedBooking | null {
  let provider: string | null = null;
  for (const p of RAIL_PROVIDERS) {
    const m = flat.match(p.re);
    if (m) {
      provider = p.name(m);
      break;
    }
  }
  const railWord = /\b(train|rail|railway|shinkansen|bullet\s+train)\b/i.test(
    flat
  );
  const seatCar =
    /\bcar(?:riage)?\s*(?:no\.?\s*)?\d{1,2}\b/i.test(flat) &&
    /\bseat\s*(?:no\.?\s*)?[A-Z0-9]{1,4}\b/i.test(flat);
  const bookingWord = /(reserv|confirm|book|e-?ticket)\w*/i.test(flat);
  if (!provider && !(railWord && bookingWord) && !(seatCar && bookingWord)) {
    return null;
  }

  // Stations: labeled lines (email "From:" headers rejected via placeValue),
  // then a capitalized "A → B" route.
  let from =
    labeledPlace(text, "departure(?:\\s+station)?|origin") ??
    labeledPlace(text, "from");
  let to =
    labeledPlace(text, "arrival(?:\\s+station)?|destination") ??
    labeledPlace(text, "to");
  if (!from || !to) {
    const route = flat.match(
      /([A-Z][A-Za-zÀ-ÿ'.-]{1,30}(?:\s+[A-Z][A-Za-zÀ-ÿ'.-]{1,30}){0,2})\s*(?:→|->|\u2014|–)\s*([A-Z][A-Za-zÀ-ÿ'.-]{1,30}(?:\s+[A-Z][A-Za-zÀ-ÿ'.-]{1,30}){0,2})/
    );
    if (route) {
      from = from ?? route[1]!.trim();
      to = to ?? route[2]!.trim();
    }
  }

  const dateCtx =
    flat.match(
      /(?:travel|departure|journey)\s+date\s*[:\-–]?\s*([^\n.;]{2,60})/i
    )?.[1] ??
    flat.match(/depart\w*\s*[:\-–]?\s*([^\n;|]{0,60})/i)?.[1] ??
    "";
  const startDate = parseDateFrom(dateCtx) ?? parseDateFrom(flat);
  const startTime = parseTimeFrom(dateCtx) ?? parseTimeFrom(flat);

  const seat =
    flat.match(/\bcar(?:riage)?\s*(?:no\.?\s*)?(\d{1,2})\b/i)?.[0] ?? null;
  const title = [provider ?? "Train", from && to ? `${from} → ${to}` : null]
    .filter(Boolean)
    .join(" · ");

  // Geocodable departure station ("Tokyo" → "Tokyo Station" helps Photon).
  let placeName: string | null = from;
  if (placeName && !/station/i.test(placeName) && placeName.length <= 30) {
    placeName = `${placeName} Station`;
  }

  return {
    kind: "train",
    type: "train",
    title,
    provider,
    confirmationCode: null,
    startDate,
    endDate: null,
    startTime,
    details: seat,
    amountCents: null,
    currency: null,
    placeName,
    address: null,
    city: to,
    fromCode: from,
    toCode: to,
  };
}

// ─── Lodging ─────────────────────────────────────────────────────────────────

const LODGING_PROVIDERS: { re: RegExp; name: string }[] = [
  { re: /booking\.com/i, name: "Booking.com" },
  { re: /agoda/i, name: "Agoda" },
  { re: /airbnb/i, name: "Airbnb" },
  { re: /hotels\.com/i, name: "Hotels.com" },
  { re: /expedia/i, name: "Expedia" },
  { re: /vrbo/i, name: "Vrbo" },
  { re: /hostelworld/i, name: "Hostelworld" },
  { re: /marriott/i, name: "Marriott" },
  { re: /hilton/i, name: "Hilton" },
  { re: /hyatt/i, name: "Hyatt" },
  { re: /\bihg\b/i, name: "IHG" },
  { re: /accor/i, name: "Accor" },
];

function parseLodgingEmail(text: string, flat: string): ParsedBooking | null {
  const provider = LODGING_PROVIDERS.find(p => p.re.test(flat))?.name ?? null;

  // Name: labeled lines → sender phrasing → proper-noun fallback
  // (same heuristic family as trip-router's extractHotelFromEmail).
  let name: string | null = null;
  const labeledName =
    text.match(
      /(?:^|\n)\s*(?:hotel|property|accommodation|lodging|stay)\s*(?:name)?\s*[:\-–]\s*([^\n]{3,120})/i
    ) ?? text.match(/check[- ]in\s+at\s*[:-]?\s*([^\n]{3,120})/i);
  if (labeledName?.[1]) name = cleanName(labeledName[1]);
  if (!name) {
    const phrased =
      text.match(
        /your\s+booking\s+at\s+([^\n,.]{3,120}?)\s+(?:is|has\s+been)\s+confirmed/i
      ) ??
      text.match(/booking\s+confirmation\s*[:\-–]\s*([^\n]{3,120})/i) ??
      text.match(/hotel\s+reservation\s+at\s+([^\n,.]{3,120})/i) ??
      text.match(/you(?:'|’)re\s+staying\s+at\s+([^\n,.]{3,120})/i) ?? // airbnb body
      text.match(/your\s+(?:stay|reservation)\s+at\s+([^\n,.]{3,120})/i) ??
      text.match(/you(?:'|’)re\s+going\s+to\s+([^\n,.]{3,120})/i); // airbnb subject (dest only)
    if (phrased?.[1]) name = cleanName(phrased[1]);
  }
  if (!name) {
    const proper = text.match(
      /\b((?:[A-Z][A-Za-z0-9'&.-]*\s+){0,4}[A-Z][A-Za-z0-9'&.-]*\s+(?:Hotel|Ryokan|Resort|Hostel|Suites|Inn|Lodge))\b/
    );
    if (proper?.[1]) name = cleanName(proper[1]);
  }
  const bookingWord =
    /(check[- ]?in|check[- ]?out|nights?|guests?|confirm|reserv|book)/i.test(
      flat
    );
  if (!name || (!provider && !bookingWord)) return null;

  // City: label, "<name> … in <City>", or trailing ", City".
  let city: string | null = null;
  const cityM =
    text.match(
      /(?:^|\n)\s*(?:city|destination)\s*[:\-–]\s*([A-Za-zÀ-ÿ' -]{2,60})/i
    ) ??
    text.match(
      new RegExp(
        `${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}[^\\n]{0,40}?\\bin\\s+([A-Z][A-Za-zÀ-ÿ' -]{1,40})`,
        "i"
      )
    ) ??
    text.match(/\bin\s+([A-Z][A-Za-zÀ-ÿ'-]{2,40})\s*[,\n]/);
  if (cityM?.[1]) city = cleanName(cityM[1]).slice(0, 60);
  const comma = name.match(/^([^,]{3,80}),\s*([A-Za-zÀ-ÿ' -]{2,40})$/);
  if (comma) {
    name = cleanName(comma[1]!);
    city = city ?? cleanName(comma[2]!);
  }

  const ciCtx =
    flat.match(/check[- ]?in(?:\s+date)?\s*[:\-–]?\s*([^\n.;]{2,60})/i)?.[1] ??
    "";
  const coCtx =
    flat.match(/check[- ]?out(?:\s+date)?\s*[:\-–]?\s*([^\n.;]{2,60})/i)?.[1] ??
    "";
  const startDate = parseDateFrom(ciCtx) ?? parseDateFrom(flat);
  let endDate = parseDateFrom(coCtx);
  if (!endDate && startDate) {
    const nights = flat.match(/\b(\d{1,2})\s+nights?\b/i);
    if (nights) endDate = addDays(startDate, Number(nights[1]));
  }
  if (!endDate) {
    const isoDates = [...flat.matchAll(/\b20\d{2}-\d{2}-\d{2}\b/g)].map(
      m => m[0]
    );
    endDate = isoDates.find(d => d !== startDate) ?? null;
  }
  const startTime = parseTimeFrom(ciCtx);
  const address = labeled(text, "address", 140)?.slice(0, 512) ?? null;

  return {
    kind: "lodging",
    type: "lodging",
    title: name,
    provider,
    confirmationCode: null,
    startDate,
    endDate,
    startTime,
    details: address,
    amountCents: null,
    currency: null,
    placeName: name,
    address,
    city,
    fromCode: null,
    toCode: null,
  };
}

// ─── Car rental ──────────────────────────────────────────────────────────────

const CAR_PROVIDERS: { re: RegExp; name: string }[] = [
  { re: /\bhertz\b/i, name: "Hertz" },
  { re: /\bavis\b/i, name: "Avis" },
  { re: /\beuropcar\b/i, name: "Europcar" },
  { re: /\benterprise\b/i, name: "Enterprise" },
  { re: /\bsixt\b/i, name: "Sixt" },
  { re: /\bbudget\b/i, name: "Budget" },
  { re: /\balamo\b/i, name: "Alamo" },
  { re: /\bnational\b/i, name: "National" },
  { re: /\bthrifty\b/i, name: "Thrifty" },
  { re: /\bdollar\b/i, name: "Dollar" },
  { re: /\bturo\b/i, name: "Turo" },
];

function parseCarEmail(text: string, flat: string): ParsedBooking | null {
  const provider = CAR_PROVIDERS.find(p => p.re.test(flat))?.name ?? null;
  const rentalWord =
    /\b(rental car|car rental|rental confirmation|vehicle rental|rental agreement)\b/i.test(
      flat
    );
  if (!provider && !rentalWord) return null;

  const pickup =
    labeledPlace(text, "pick[- ]?up\\s+(?:location|branch|office)", 120) ??
    labeledPlace(text, "rental\\s+(?:location|branch|office)", 120) ??
    labeledPlace(text, "pick[- ]?up", 120);
  const carClass =
    text
      .match(
        /(?:^|\n)\s*(?:car\s+)?(?:class|category|group)\s*[:\-–]\s*([A-Za-z][A-Za-z -]{1,24})/i
      )?.[1]
      ?.trim() ?? null;
  const puCtx =
    flat.match(
      /pick[- ]?up\s+(?:date|date\/time)\s*[:\-–]?\s*([^\n.;]{2,60})/i
    )?.[1] ?? "";
  const retCtx =
    flat.match(
      /(?:return|drop[- ]?off)\s+(?:date|date\/time)\s*[:\-–]?\s*([^\n.;]{2,60})/i
    )?.[1] ?? "";
  const startDate = parseDateFrom(puCtx) ?? parseDateFrom(flat);
  let endDate = parseDateFrom(retCtx);
  if (!endDate) {
    const isoDates = [...flat.matchAll(/\b20\d{2}-\d{2}-\d{2}\b/g)].map(
      m => m[0]
    );
    endDate = isoDates.find(d => d !== startDate) ?? null;
  }
  const startTime = parseTimeFrom(puCtx);
  const placeName = pickup ? cleanName(pickup).slice(0, 120) : null;

  return {
    kind: "car",
    type: "car",
    title: [provider ?? "Rental car", carClass].filter(Boolean).join(" · "),
    provider,
    confirmationCode: null,
    startDate,
    endDate,
    startTime,
    details: placeName ? `Pick-up: ${placeName}` : null,
    amountCents: null,
    currency: null,
    placeName,
    address: null,
    city: null,
    fromCode: null,
    toCode: null,
  };
}

// ─── Activity / tour ─────────────────────────────────────────────────────────

const ACTIVITY_PROVIDERS: { re: RegExp; name: string }[] = [
  { re: /getyourguide/i, name: "GetYourGuide" },
  { re: /viator/i, name: "Viator" },
  { re: /klook/i, name: "Klook" },
  { re: /tiqets/i, name: "Tiqets" },
  { re: /\bfever\b/i, name: "Fever" },
  { re: /headout/i, name: "Headout" },
  { re: /musement/i, name: "Musement" },
];

function cleanSubject(s: string): string {
  return s
    .replace(
      /\s*(?:booking|reservation|ticket[s]?)\s*(?:is)?\s*confirm(?:ed|ation)\s*[!.]*/gi,
      ""
    )
    .replace(/^your\s+/i, "")
    .replace(/[.,;:!]+$/, "")
    .trim();
}

function parseActivityEmail(text: string, flat: string): ParsedBooking | null {
  const provider = ACTIVITY_PROVIDERS.find(p => p.re.test(flat))?.name ?? null;
  const activityWord =
    /\b(tour|activity|tickets?|admission|entry ticket|experience|excursion|guided visit|museum pass|city pass)\b/i.test(
      flat
    );
  const bookingWord = /(confirm|book|reserv)\w*/i.test(flat);
  if (!provider && !(activityWord && bookingWord)) return null;

  const title =
    labeled(text, "tour|activity|experience|event|attraction") ??
    (text.match(/subject\s*:\s*([^\n]{3,100})/i)?.[1]
      ? cleanSubject(text.match(/subject\s*:\s*([^\n]{3,100})/i)![1]!)
      : null) ??
    flat.match(
      /\b((?:[A-Z][A-Za-z0-9'&.-]*\s+){0,5}(?:Tour|Experience|Excursion))\b/
    )?.[1] ??
    (provider ? `${provider} booking` : "Activity booking");
  const venue =
    labeled(text, "venue|meeting point|location|departure point", 120) ??
    labeled(text, "address", 120);
  const dateCtx =
    flat.match(
      /(?:tour|visit|activity|event)\s+date\s*[:\-–]?\s*([^\n.;]{2,60})/i
    )?.[1] ??
    flat.match(/(?:^|\s)date\s*[:\-–]\s*([^\n.;]{2,60})/i)?.[1] ??
    "";
  const startDate = parseDateFrom(dateCtx) ?? parseDateFrom(flat);
  const startTime =
    parseTimeFrom(
      flat.match(
        /(?:start|tour|meeting)\s+time\s*[:\-–]?\s*([^\n.;]{2,40})/i
      )?.[1] ?? ""
    ) ?? parseTimeFrom(flat);

  return {
    kind: "activity",
    type: "activity",
    title: cleanName(title).slice(0, 120),
    provider,
    confirmationCode: null,
    startDate,
    endDate: null,
    startTime,
    details: venue,
    amountCents: null,
    currency: null,
    placeName: venue ? cleanName(venue).slice(0, 120) : null,
    address: null,
    city: null,
    fromCode: null,
    toCode: null,
  };
}

// ─── Generic fallback (weak but real confirmation signals) ──────────────────

function parseGenericConfirmation(
  text: string,
  flat: string
): ParsedBooking | null {
  const bookingWord = /(confirm|reserv|book|ticket|order)\w*/i.test(flat);
  if (!bookingWord) return null;
  const code = parseConfirmationCode(flat);
  const date = parseDateFrom(flat);
  if (!code && !date) return null;
  const subj = text.match(/subject\s*:\s*([^\n]{3,100})/i)?.[1];
  return {
    kind: "other",
    type: "other",
    title: (subj ? cleanSubject(subj) : "") || "Imported booking",
    provider: null,
    confirmationCode: code,
    startDate: date,
    endDate: null,
    startTime: null,
    details: null,
    amountCents: null,
    currency: null,
    placeName: null,
    address: null,
    city: null,
    fromCode: null,
    toCode: null,
  };
}

/**
 * Classify + parse one confirmation email. Returns null when nothing
 * booking-like is found (caller files a per-email failure). Never throws.
 */
export function parseBookingEmail(raw: string): ParsedBooking | null {
  try {
    if (!raw || raw.trim().length < 20) return null;
    const text = raw
      .replace(/\r\n?/g, "\n")
      .replace(/\t/g, " ")
      .replace(/\u00a0/g, " ");
    const flat = text.replace(/\n+/g, " ").replace(/ {2,}/g, " ").trim();
    const parsed =
      parseFlightEmail(flat) ??
      parseTrainEmail(text, flat) ??
      parseLodgingEmail(text, flat) ??
      parseCarEmail(text, flat) ??
      parseActivityEmail(text, flat) ??
      parseGenericConfirmation(text, flat);
    if (!parsed) return null;
    if (!parsed.confirmationCode) {
      parsed.confirmationCode = parseConfirmationCode(flat);
    }
    if (parsed.amountCents == null) {
      const amt = parseAmount(flat);
      if (amt) {
        parsed.amountCents = amt.amountCents;
        parsed.currency = amt.currency;
      }
    }
    // details = raw snippet (kept short; UI truncates anyway).
    const snippet = flat.slice(0, 300);
    parsed.details = parsed.details
      ? `${parsed.details}, ${snippet}`.slice(0, 500)
      : snippet;
    parsed.title =
      parsed.title
        .trim()
        .replace(/\s{2,}/g, " ")
        .slice(0, 255) || "Imported booking";
    return parsed;
  } catch {
    return null;
  }
}

// ─── Import engine (parse → reservations rows → calendar/map layout) ────────

/** Stop category used when laying each kind out on the trip days. */
const STOP_CATEGORY_FOR_KIND: Partial<Record<BookingKind, string>> = {
  lodging: "lodging",
  activity: "activity",
  car: "transport",
  train: "transport",
};

export interface ImportedBooking {
  index: number;
  kind: BookingKind;
  title: string;
  date: string | null;
  placed: boolean; // on the calendar (stop on a trip day)
  geocoded: boolean; // on the map (lat/lng found or pre-existing)
  dayDate: string | null; // trip day the stop landed on
  nearestDay: boolean; // true when the booking date is outside the trip range
  reservationId: number;
  stopId: number | null;
}

export interface FailedBooking {
  index: number;
  reason: string;
}

export interface BookingImportReport {
  tripId: number;
  imported: ImportedBooking[];
  failed: FailedBooking[];
}

function pickDay(
  days: schema.TripDay[],
  startDate: string | null
): { day: schema.TripDay; nearest: boolean } | null {
  if (!days.length || !startDate) return null;
  const exact = days.find(d => d.date === startDate);
  if (exact) return { day: exact, nearest: false };
  // Outside the trip range → attach to the nearest in-range day (flagged).
  let best = days[0]!;
  let bestDist = Number.POSITIVE_INFINITY;
  for (const d of days) {
    const dist = Math.abs(Date.parse(d.date) - Date.parse(startDate));
    if (dist < bestDist) {
      best = d;
      bestDist = dist;
    }
  }
  return { day: best, nearest: true };
}

/**
 * Parse each email, insert a reservation per successfully parsed text, then
 * auto-lay-out placeable kinds onto trip days (+ geocode). One bad email
 * never sinks the batch - it lands in `failed` with a reason.
 */
export async function importBookingEmails(
  trip: schema.Trip,
  texts: string[]
): Promise<BookingImportReport> {
  const db = getDb();
  const [days, existingStops] = await Promise.all([
    db
      .select()
      .from(schema.tripDays)
      .where(eq(schema.tripDays.tripId, trip.id))
      .orderBy(asc(schema.tripDays.position)),
    db.select().from(schema.stops).where(eq(schema.stops.tripId, trip.id)),
  ]);
  const destCity = trip.destination.split(",")[0]!.trim();
  const stopNames = new Set(
    existingStops.map(s => s.name.trim().toLowerCase())
  );
  const nextPosInDay = new Map<number, number>();
  for (const s of existingStops) {
    if (s.dayId != null) {
      nextPosInDay.set(
        s.dayId,
        Math.max(nextPosInDay.get(s.dayId) ?? -1, s.position) + 1
      );
    }
  }

  let near: { lat: number; lng: number } | null | undefined; // lazy bias point
  const imported: ImportedBooking[] = [];
  const failed: FailedBooking[] = [];

  for (const [index, raw] of texts.entries()) {
    let parsed: ParsedBooking | null = null;
    try {
      parsed = parseBookingEmail(raw);
    } catch {
      parsed = null;
    }
    if (!parsed) {
      failed.push({
        index,
        reason:
          "Unrecognized, no flight, train, stay, car or activity confirmation found",
      });
      continue;
    }

    try {
      const res = await db.insert(schema.reservations).values({
        tripId: trip.id,
        type: parsed.type,
        title: parsed.title,
        provider: parsed.provider,
        confirmationCode: parsed.confirmationCode,
        startDate: parsed.startDate,
        endDate: parsed.endDate,
        details: parsed.details,
        amountCents: parsed.amountCents,
        currency: parsed.currency,
        source: "email-import",
      });
      const reservationId = Number(res[0].insertId);

      // ── Auto-layout: same-name stop reuse, else create on the right day ──
      let placed = false;
      let geocoded = false;
      let dayDate: string | null = null;
      let nearestDay = false;
      let stopId: number | null = null;
      const category = STOP_CATEGORY_FOR_KIND[parsed.kind] ?? null;
      const placeName =
        parsed.placeName ?? (parsed.kind === "activity" ? parsed.title : null);
      if (category && (placeName ?? parsed.address)) {
        const stopName = (placeName ?? parsed.address)!.slice(0, 255);
        const normName = stopName.trim().toLowerCase();
        if (stopNames.has(normName)) {
          const existing = existingStops.find(
            s => s.name.trim().toLowerCase() === normName
          );
          placed = true;
          geocoded = existing?.lat != null && existing?.lng != null;
          stopId = existing?.id ?? null;
          dayDate = parsed.startDate;
        } else {
          const dayPick = pickDay(days, parsed.startDate);
          if (dayPick) {
            // Geocode with Photon, biased toward the trip destination.
            let lat: number | null = null;
            let lng: number | null = null;
            let geoAddress: string | null = null;
            if (near === undefined) {
              near = await geocodeCity(destCity).catch(() => null);
            }
            const queries = [
              [stopName, parsed.city ?? destCity].filter(Boolean).join(" "),
              [stopName, destCity].filter(Boolean).join(" "),
              stopName,
            ];
            for (const q of [...new Set(queries)]) {
              try {
                const hits = await searchPhoton(q, near ?? undefined, 3);
                if (hits.length) {
                  lat = hits[0]!.lat;
                  lng = hits[0]!.lng;
                  geoAddress =
                    [hits[0]!.address, hits[0]!.city, hits[0]!.country]
                      .filter(Boolean)
                      .join(", ")
                      .slice(0, 512) || null;
                  break;
                }
              } catch {
                // Photon down/rate-limited → stay ungeocoded, still placed.
              }
            }
            const position = nextPosInDay.get(dayPick.day.id) ?? 0;
            const notes = [
              parsed.provider,
              parsed.confirmationCode ? `#${parsed.confirmationCode}` : null,
              "Imported from email",
            ]
              .filter(Boolean)
              .join(" · ");
            const ins = await db.insert(schema.stops).values({
              tripId: trip.id,
              dayId: dayPick.day.id,
              name: stopName,
              category,
              address: parsed.address ?? geoAddress,
              lat,
              lng,
              startTime: parsed.startTime,
              durationMin: null,
              notes,
              image: null,
              position,
            });
            stopId = Number(ins[0].insertId);
            stopNames.add(normName);
            nextPosInDay.set(dayPick.day.id, position + 1);
            placed = true;
            geocoded = lat != null && lng != null;
            dayDate = dayPick.day.date;
            nearestDay = dayPick.nearest;
          }
        }
      }

      imported.push({
        index,
        kind: parsed.kind,
        title: parsed.title,
        date: parsed.startDate,
        placed,
        geocoded,
        dayDate,
        nearestDay,
        reservationId,
        stopId,
      });
    } catch (e) {
      failed.push({
        index,
        reason: `Import error: ${e instanceof Error ? e.message.slice(0, 120) : "unknown"}`,
      });
    }
  }
  return { tripId: trip.id, imported, failed };
}

// ─── Inbound-email tokens + webhook engine ──────────────────────────────────

function inboundSecret(): string {
  return env.appSecret || process.env.SESSION_SECRET || "wayfare-inbound-dev";
}

/** Deterministic per-user inbound token: `${userId}.${HMAC-SHA256(userId)[0:32]}`. */
export function inboundTokenForUser(userId: number): string {
  const mac = createHmac("sha256", inboundSecret())
    .update(`wayfare-inbound:${userId}`)
    .digest("hex")
    .slice(0, 32);
  return `${userId}.${mac}`;
}

/** Verify an inbound token → userId (constant-time compare), null when bogus. */
export function userIdFromInboundToken(token: string): number | null {
  const m = token.match(/^(\d{1,12})\.([a-f0-9]{32})$/);
  if (!m) return null;
  const id = Number(m[1]);
  const expected = inboundTokenForUser(id).split(".")[1]!;
  const a = Buffer.from(m[2]!);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b) ? id : null;
}

function stripHtml(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(?:p|div|tr|td|li|h[1-6])>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&quot;/gi, '"')
    .replace(/[ \t]{2,}/g, " ")
    .replace(/\n{3,}/g, "\n\n");
}

/** Common IATA → city, for naming trips created from forwarded flight emails. */
const IATA_CITY: Record<string, string> = {
  SFO: "San Francisco",
  LAX: "Los Angeles",
  JFK: "New York",
  EWR: "New York",
  ORD: "Chicago",
  ATL: "Atlanta",
  DFW: "Dallas",
  DEN: "Denver",
  SEA: "Seattle",
  BOS: "Boston",
  MIA: "Miami",
  HNL: "Honolulu",
  NRT: "Tokyo",
  HND: "Tokyo",
  KIX: "Osaka",
  NGO: "Nagoya",
  FUK: "Fukuoka",
  CTS: "Sapporo",
  ICN: "Seoul",
  HKG: "Hong Kong",
  SIN: "Singapore",
  BKK: "Bangkok",
  TPE: "Taipei",
  PEK: "Beijing",
  PVG: "Shanghai",
  LHR: "London",
  CDG: "Paris",
  AMS: "Amsterdam",
  FRA: "Frankfurt",
  MAD: "Madrid",
  BCN: "Barcelona",
  FCO: "Rome",
  ZRH: "Zurich",
  VIE: "Vienna",
  CPH: "Copenhagen",
  ARN: "Stockholm",
  DUB: "Dublin",
  LIS: "Lisbon",
  SYD: "Sydney",
  MEL: "Melbourne",
  AKL: "Auckland",
  YVR: "Vancouver",
  YYZ: "Toronto",
  MEX: "Mexico City",
  DXB: "Dubai",
  DOH: "Doha",
  DEL: "Delhi",
};

async function mostRecentActiveTrip(
  userId: number
): Promise<schema.Trip | null> {
  const db = getDb();
  const memberships = await db
    .select()
    .from(schema.tripMembers)
    .where(eq(schema.tripMembers.userId, userId));
  const ids = memberships.map(m => m.tripId);
  if (!ids.length) return null;
  const rows = await db
    .select()
    .from(schema.trips)
    .where(inArray(schema.trips.id, ids));
  const today = new Date().toISOString().slice(0, 10);
  const active = rows
    .filter(t => t.endDate >= today)
    .sort((a, b) => Number(b.id) - Number(a.id));
  return active[0] ?? null;
}

/** Create a minimal trip from parsed booking dates (mirrors trips.create rows). */
async function createTripFromBooking(
  user: schema.User,
  parsed: ParsedBooking
): Promise<schema.Trip> {
  const db = getDb();
  const start = parsed.startDate!;
  const end = parsed.endDate ?? addDays(start, 4);
  const dest =
    parsed.city ??
    (parsed.toCode ? IATA_CITY[parsed.toCode] : null) ??
    parsed.toCode ??
    "Somewhere";
  const result = await db.insert(schema.trips).values({
    ownerId: user.id,
    title: `Trip to ${dest}`.slice(0, 255),
    destination: dest.slice(0, 255),
    startDate: start,
    endDate: end,
    homeCurrency: "USD",
    budgetCents: 0,
  });
  const tripId = Number(result[0].insertId);
  await db.insert(schema.tripMembers).values({
    tripId,
    userId: user.id,
    name: user.name ?? "You",
    email: user.email ?? null,
    role: "owner",
    presenceColor: "#BC5934",
  });
  const dates = dateRange(start, end);
  if (dates.length) {
    await db
      .insert(schema.tripDays)
      .values(dates.map((date, i) => ({ tripId, date, position: i })));
  }
  const [trip] = await db
    .select()
    .from(schema.trips)
    .where(eq(schema.trips.id, tripId))
    .limit(1);
  return trip!;
}

export interface InboundEmailPayload {
  text?: string;
  html?: string;
  subject?: string;
  from?: string;
}

export interface InboundResult {
  status: 200 | 400 | 404;
  body: Record<string, unknown>;
}

/**
 * POST /api/inbound/:token engine: resolve the token owner, run the same
 * parse+insert+layout pipeline against their most-recent active trip (or a
 * freshly created trip from the booking dates), always answering 200 with a
 * summary so providers don't retry-and-duplicate. 404 only for bogus tokens.
 */
export async function handleInboundEmail(
  token: string,
  payload: InboundEmailPayload
): Promise<InboundResult> {
  const userId = userIdFromInboundToken(token);
  if (userId == null) {
    return { status: 404, body: { error: "unknown token" } };
  }
  try {
    const db = getDb();
    const [user] = await db
      .select()
      .from(schema.users)
      .where(eq(schema.users.id, userId))
      .limit(1);
    if (!user) return { status: 404, body: { error: "unknown token" } };

    const body =
      payload.text && payload.text.trim().length >= 20
        ? payload.text
        : stripHtml(payload.html ?? "");
    const combined = [
      payload.subject ? `Subject: ${payload.subject}` : "",
      payload.from ? `From: ${payload.from}` : "",
      body,
    ]
      .filter(Boolean)
      .join("\n")
      .trim();
    if (combined.length < 20) {
      return {
        status: 200,
        body: { imported: 0, failed: 1, reason: "empty email" },
      };
    }

    const parsed = parseBookingEmail(combined);
    let trip = await mostRecentActiveTrip(user.id);
    let tripCreated = false;
    if (!trip) {
      if (!parsed?.startDate) {
        return {
          status: 200,
          body: {
            imported: 0,
            failed: 1,
            reason: parsed
              ? "no active trip and no booking date to create one"
              : "unrecognized email and no active trip",
          },
        };
      }
      trip = await createTripFromBooking(user, parsed);
      tripCreated = true;
    }

    const report = await importBookingEmails(trip, [combined]);
    return {
      status: 200,
      body: {
        imported: report.imported.length,
        failed: report.failed.length,
        tripId: trip.id,
        tripCreated,
      },
    };
  } catch (e) {
    console.error("[inbound] handling failed:", e);
    return {
      status: 200,
      body: { imported: 0, failed: 1, reason: "internal" },
    };
  }
}

// ─── tRPC router ─────────────────────────────────────────────────────────────

async function requireMembership(tripId: number, userId: number) {
  const db = getDb();
  const rows = await db
    .select()
    .from(schema.tripMembers)
    .where(
      and(
        eq(schema.tripMembers.tripId, tripId),
        eq(schema.tripMembers.userId, userId)
      )
    )
    .limit(1);
  const member = rows[0];
  if (!member) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "Not a member of this trip",
    });
  }
  return member;
}

export const bookingsRouter = createRouter({
  /**
   * Bulk "Import from email": parse each pasted confirmation, insert
   * reservations (source="email-import"), and lay placeable items out on the
   * trip calendar + map. Voyager-gated like trips.importEmail.
   */
  parseBookingEmails: authedQuery
    .input(
      z.object({
        tripId: z.number(),
        texts: z.array(z.string().min(20).max(50000)).min(1).max(25),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const member = await requireMembership(input.tripId, ctx.user.id);
      if (member.role === "viewer") {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "Viewers cannot edit this trip",
        });
      }
      const db = getDb();
      const [trip] = await db
        .select()
        .from(schema.trips)
        .where(eq(schema.trips.id, input.tripId))
        .limit(1);
      if (!trip) throw new TRPCError({ code: "NOT_FOUND" });
      const ownerTier = await getTier(trip.ownerId);
      if (!TIERS[ownerTier].emailImport) {
        throw new TRPCError({ code: "FORBIDDEN", message: "UPGRADE_REQUIRED" });
      }
      return importBookingEmails(trip, input.texts);
    }),

  /**
   * The user's unique forwarding address. Real forwarding activates once an
   * inbound-email provider (SendGrid Inbound Parse / Mailgun routes) points
   * the in.wayfare.app MX at POST /api/inbound/:token; pasting works today.
   */
  myInboundEmail: authedQuery.query(({ ctx }) => ({
    address: `trip+${inboundTokenForUser(ctx.user.id)}@in.wayfare.app`,
    note: "Forwarding works once inbound email (SendGrid/Mailgun MX) is pointed at /api/inbound, paste below works today.",
  })),
});
