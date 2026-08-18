/**
 * caption-structure.ts (r29) - read the itinerary a caption already wrote.
 *
 * Travel reels and carousels are almost always structured. The caption says
 * "Day 1: Fushimi Inari, Nishiki Market / Day 2: Arashiyama..." or "3 days in
 * Kyoto", and that structure IS the itinerary the creator is recommending.
 *
 * The importer discarded all of it. `chunkIntoDays` split the extracted places
 * into groups of eight purely geographically, so a caption that explicitly
 * said what to do on each day produced a trip with the days reshuffled, and a
 * caption that said "3 days" produced a trip whose length came from
 * ceil(places / 8) instead.
 *
 * Pure and dependency-free so it can be unit-tested and run on either side.
 */

export interface CaptionDay {
  /** 1-based day number as written in the caption. */
  day: number;
  /** Optional label: "Day 2 - Arashiyama" -> "Arashiyama". */
  label: string | null;
  /** The caption text belonging to this day, for place extraction. */
  text: string;
}

export interface CaptionStructure {
  /** Days found in the caption, in order. Empty when it is unstructured. */
  days: CaptionDay[];
  /** Total nights if the caption states one ("3 days in Kyoto"). */
  durationDays: number | null;
  /** True when the caption genuinely laid out days rather than us guessing. */
  hasDayStructure: boolean;
}

/**
 * Matches the ways people actually write day headings:
 *   "Day 1:"  "DAY 2 -"  "day 3 |"  "Day 4"  "D1:"  "1️⃣"
 * Deliberately anchored to a line start (or the start of the caption) so a
 * sentence like "we spent a day 3 hours north" cannot masquerade as a heading.
 */
const DAY_RE = /(^|\n)\s*(?:day\s*|d)(\d{1,2})\s*(?:[:\-–—|.)]|\s)\s*([^\n]*)/gi;

/** Circled-number emoji sometimes used instead of "Day N". */
const EMOJI_DAYS = ["1⃣", "2⃣", "3⃣", "4⃣", "5⃣", "6⃣", "7⃣", "8⃣", "9⃣"];

export function parseCaptionStructure(raw: string): CaptionStructure {
  const text = (raw || "").slice(0, 8000);

  // Duration, stated explicitly.
  let durationDays: number | null = null;
  const dm = /(\d{1,2})\s*[- ]?\s*(day|days|night|nights)\b/i.exec(text);
  if (dm) {
    const v = Number(dm[1]);
    if (v >= 1 && v <= 30) durationDays = v;
  } else if (/\ba week\b/i.test(text)) durationDays = 7;
  else if (/\blong weekend\b/i.test(text)) durationDays = 3;
  else if (/\bweekend\b/i.test(text)) durationDays = 2;

  // Normalise emoji day markers into "Day N" so one parser handles both.
  let normalised = text;
  EMOJI_DAYS.forEach((e, i) => {
    normalised = normalised.split(e).join(`\nDay ${i + 1} `);
  });

  const marks: { day: number; label: string; idx: number; len: number }[] = [];
  DAY_RE.lastIndex = 0;
  for (const m of normalised.matchAll(DAY_RE)) {
    const day = Number(m[2]);
    if (!Number.isFinite(day) || day < 1 || day > 30) continue;
    marks.push({
      day,
      label: (m[3] ?? "").trim(),
      idx: (m.index ?? 0) + (m[1]?.length ?? 0),
      len: m[0].length - (m[1]?.length ?? 0),
    });
  }

  // A single "Day 1" with nothing after it is a caption flourish, not a plan.
  const usable = marks.length >= 2;
  if (!usable) {
    return { days: [], durationDays, hasDayStructure: false };
  }

  // Keep the FIRST occurrence of each day number. Creators repeat numbers in
  // hashtags ("#day2") and a second "Day 2" further down would otherwise
  // truncate the real one.
  const seen = new Set<number>();
  const ordered = marks.filter((m) => (seen.has(m.day) ? false : (seen.add(m.day), true)));
  ordered.sort((a, b) => a.idx - b.idx);

  const days: CaptionDay[] = ordered.map((m, i) => {
    const from = m.idx + m.len;
    const to = i + 1 < ordered.length ? ordered[i + 1]!.idx : normalised.length;
    const body = normalised.slice(from, to).trim();
    // The heading tail is ALWAYS content: "Day 1: Fushimi Inari, Nishiki
    // Market" carries the day's places on the heading line itself. Treating a
    // short tail as a label AND dropping it from the text lost every place on
    // single-line captions - the most common shape there is - and produced
    // days with nothing in them.
    const tail = (m.label ?? "").trim();
    const label = tail && tail.length <= 40 ? tail.replace(/[:\-–—|]+$/, "").trim() || null : null;
    return { day: m.day, label, text: [tail, body].filter(Boolean).join("\n").trim() };
  });

  return {
    days,
    // A caption listing 4 days IS a 4-day trip even if it never says "4 days".
    durationDays: durationDays ?? days.length,
    hasDayStructure: true,
  };
}
