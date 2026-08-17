/**
 * fx-refresh.test.ts (r27) - the sanity guard on live rates.
 *
 * This is the only thing standing between a malformed or hostile upstream
 * response and a user's trip budget. A rates API that starts returning cents
 * instead of units, or an empty object, or a string, must not be allowed to
 * multiply somebody's hotel bill.
 */
import { describe, expect, it } from "vitest";
import { FX_PER_USD } from "@contracts/fx";
import { __test } from "./fx-refresh";

const { isSaneRate } = __test;

describe("isSaneRate", () => {
  it("accepts a rate close to the static baseline", () => {
    expect(isSaneRate("INR", 88.2)).toBe(true);
    expect(isSaneRate("EUR", 0.95)).toBe(true);
  });

  it("accepts genuine long-run drift within the band", () => {
    // The rupee could plausibly reach 120/USD over years; that must not be
    // rejected as garbage.
    expect(isSaneRate("INR", 120)).toBe(true);
  });

  it("rejects a rate off by a factor of 100 - the classic units mistake", () => {
    expect(isSaneRate("INR", FX_PER_USD.INR! * 100)).toBe(false);
    expect(isSaneRate("INR", FX_PER_USD.INR! / 100)).toBe(false);
  });

  it("rejects zero and negative rates, which would divide by zero downstream", () => {
    expect(isSaneRate("EUR", 0)).toBe(false);
    expect(isSaneRate("EUR", -1)).toBe(false);
  });

  it("rejects NaN and Infinity from a bad parse", () => {
    expect(isSaneRate("EUR", Number.NaN)).toBe(false);
    expect(isSaneRate("EUR", Number.POSITIVE_INFINITY)).toBe(false);
  });

  it("accepts any positive rate for a currency with no baseline to compare against", () => {
    expect(isSaneRate("XYZ", 7.5)).toBe(true);
    expect(isSaneRate("XYZ", -7.5)).toBe(false);
  });

  it("holds the band at exactly 10x either way", () => {
    const base = FX_PER_USD.EUR!;
    expect(isSaneRate("EUR", base * 10)).toBe(true);
    expect(isSaneRate("EUR", base * 10.1)).toBe(false);
    expect(isSaneRate("EUR", base / 10)).toBe(true);
    expect(isSaneRate("EUR", base / 10.1)).toBe(false);
  });
});
