import { describe, expect, it } from "vitest";
import type { FriendParticipant } from "@db/schema";
import {
  planDateError,
  tallyDates,
  winningDateOf,
  winningDatesOf,
} from "./friends-router";

/** Minimal participant fixture - tallyDates only reads these two columns. */
function participant(dates: string[], submitted = true): FriendParticipant {
  return {
    datesJson: JSON.stringify(dates),
    submittedAt: submitted ? new Date("2026-07-01T00:00:00Z") : null,
  } as FriendParticipant;
}

const D = (n: number) => `2026-08-${String(n).padStart(2, "0")}`;

describe("tallyDates", () => {
  it("counts every picked date across participants (not just a start/end)", () => {
    const tally = tallyDates([
      participant([D(3), D(1), D(8)]), // unsorted input
      participant([D(8), D(3)]),
      participant([D(3)]),
    ]);
    expect(tally).toEqual([
      { date: D(1), count: 1 },
      { date: D(3), count: 3 },
      { date: D(8), count: 2 },
    ]);
  });

  it("is sorted ascending and skips participants who never submitted", () => {
    const tally = tallyDates([
      participant([D(10), D(2)]),
      participant([D(2)], false), // not submitted - ignored
      participant([]),
    ]);
    expect(tally).toEqual([
      { date: D(2), count: 1 },
      { date: D(10), count: 1 },
    ]);
  });

  it("ignores malformed entries in datesJson", () => {
    const tally = tallyDates([participant([D(4), "not-a-date", "2026-8-01"])]);
    expect(tally).toEqual([{ date: D(4), count: 1 }]);
  });
});

describe("winningDates / winningDate", () => {
  const tally = [
    { date: D(1), count: 3 },
    { date: D(8), count: 3 },
    { date: D(15), count: 2 },
    { date: D(22), count: 1 },
  ];

  it("returns ALL dates meeting the threshold, ascending", () => {
    expect(winningDatesOf(tally, 2)).toEqual([D(1), D(8), D(15)]);
    expect(winningDatesOf(tally, 3)).toEqual([D(1), D(8)]);
  });

  it("keeps winningDate as the earliest qualifying date (back-compat)", () => {
    expect(winningDateOf(tally, 3)).toBe(D(1));
    expect(winningDateOf(tally, 2)).toBe(D(1));
  });

  it("orders ties earliest-first", () => {
    // Both Aug 1 and Aug 8 have 3 votes - Aug 1 must come first.
    const wins = winningDatesOf(tally, 3);
    expect(wins[0]).toBe(D(1));
    expect(wins[1]).toBe(D(8));
  });

  it("returns nothing on a threshold miss (session stays voting)", () => {
    expect(winningDatesOf(tally, 4)).toEqual([]);
    expect(winningDateOf(tally, 4)).toBeNull();
  });
});

describe("planDateError (submitPlan validation)", () => {
  const now = new Date("2026-07-15T12:00:00Z"); // window: 2026-07-15 .. 2027-07-15

  it("accepts dates well beyond the old 60-day cap (up to 12 months)", () => {
    expect(planDateError(["2027-05-01"], now)).toBeNull(); // ~290 days out
    expect(planDateError(["2026-07-15", "2027-07-15"], now)).toBeNull(); // today + exact max
  });

  it("rejects past dates", () => {
    expect(planDateError(["2026-07-14"], now)).toMatch(/today or later/);
    expect(planDateError(["2027-01-01", "2020-01-01"], now)).toMatch(/today or later/);
  });

  it("rejects dates beyond 12 months", () => {
    expect(planDateError(["2027-07-16"], now)).toMatch(/12 months/);
  });

  it("accepts up to 120 dates and rejects 121", () => {
    const ok: string[] = [];
    const d = new Date("2026-07-15T00:00:00Z");
    for (let i = 0; i < 120; i++) {
      ok.push(d.toISOString().slice(0, 10));
      d.setUTCDate(d.getUTCDate() + 1);
    }
    expect(planDateError(ok, now)).toBeNull();
    expect(planDateError([...ok, "2027-07-15"], now)).toMatch(/at most 120/);
  });

  it("requires at least one date and ISO format", () => {
    expect(planDateError([], now)).toMatch(/at least one/);
    expect(planDateError(["15/07/2026"], now)).toMatch(/ISO/);
  });
});

// ─── r24-social: chat validation + invite-claim guard ──────────────────────
import { chatBodyError, claimedByOther, MAX_CHAT_BODY } from "./friends-router";

describe("chatBodyError", () => {
  it("rejects empty / whitespace-only bodies", () => {
    expect(chatBodyError("")).toMatch(/empty/);
    expect(chatBodyError("   \n  ")).toMatch(/empty/);
  });
  it("accepts a normal message and exactly 2000 chars", () => {
    expect(chatBodyError("See you at the airport!")).toBeNull();
    expect(chatBodyError("x".repeat(MAX_CHAT_BODY))).toBeNull();
  });
  it("rejects over-cap messages (after trimming)", () => {
    expect(chatBodyError("x".repeat(MAX_CHAT_BODY + 1))).toMatch(/2000/);
    expect(chatBodyError(`  ${"y".repeat(MAX_CHAT_BODY + 5)}  `)).toMatch(/2000/);
  });
});

describe("claimedByOther (not-connecting fix)", () => {
  it("an unclaimed placeholder row is usable by anyone", () => {
    expect(claimedByOther({ userId: null }, null)).toBe(false);
    expect(claimedByOther({ userId: null }, 42)).toBe(false);
  });
  it("a row linked to the viewer is usable", () => {
    expect(claimedByOther({ userId: 7 }, 7)).toBe(false);
  });
  it("a row linked to someone else is blocked - logged in or not", () => {
    expect(claimedByOther({ userId: 7 }, 8)).toBe(true);
    expect(claimedByOther({ userId: 7 }, null)).toBe(true);
    expect(claimedByOther({ userId: 7 }, undefined)).toBe(true);
  });
});
