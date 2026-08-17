/**
 * entitlement.test.ts (r27) - billing period arithmetic.
 *
 * The old billing code wrote currentPeriodEnd with
 * `periodEnd.setMonth(getMonth() + 1)` and then never read the column, so the
 * bug was invisible. Now that getTier() actually enforces the date, this
 * arithmetic decides whether a paying customer keeps access - and JS date
 * rolling has a nasty edge: 31 Jan + 1 month is 3 March, not 28 February.
 */
import { describe, expect, it } from "vitest";
import { __test } from "./entitlement";

const { addPeriod, laterOf } = __test;

describe("addPeriod", () => {
  it("adds a month", () => {
    expect(addPeriod("2027-03-12", "monthly")).toBe("2027-04-12");
  });

  it("adds a year", () => {
    expect(addPeriod("2027-03-12", "yearly")).toBe("2028-03-12");
  });

  it("rolls December into the next January", () => {
    expect(addPeriod("2027-12-05", "monthly")).toBe("2028-01-05");
  });

  it("clamps 31 Jan to the end of February instead of overflowing into March", () => {
    // Plain Date arithmetic returns 2027-03-03 here, silently handing the
    // customer three days they didn't buy - and breaking the invariant that
    // the renewal day is stable.
    expect(addPeriod("2027-01-31", "monthly")).toBe("2027-02-28");
  });

  it("clamps to 29 February in a leap year", () => {
    expect(addPeriod("2028-01-31", "monthly")).toBe("2028-02-29");
  });

  it("clamps 31 May to 30 June", () => {
    expect(addPeriod("2027-05-31", "monthly")).toBe("2027-06-30");
  });

  it("handles a yearly renewal from 29 February", () => {
    expect(addPeriod("2028-02-29", "yearly")).toBe("2029-02-28");
  });

  it("always returns a zero-padded YYYY-MM-DD", () => {
    expect(addPeriod("2027-08-05", "monthly")).toBe("2027-09-05");
    expect(addPeriod("2027-01-01", "monthly")).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});

describe("laterOf", () => {
  it("extends from the existing period end when the user renews early", () => {
    // Renewing with time left must ADD to the remaining period, not throw it
    // away - otherwise an early renewal silently costs the customer days.
    expect(laterOf("2027-06-30", "2027-03-12")).toBe("2027-06-30");
  });

  it("starts from today when the subscription has already lapsed", () => {
    expect(laterOf("2026-01-01", "2027-03-12")).toBe("2027-03-12");
  });

  it("starts from today for a first-time subscriber", () => {
    expect(laterOf(null, "2027-03-12")).toBe("2027-03-12");
  });
});

describe("renewal chain", () => {
  it("twelve monthly renewals land on the same day of the month", () => {
    let date = "2027-01-15";
    for (let i = 0; i < 12; i++) date = addPeriod(date, "monthly");
    expect(date).toBe("2028-01-15");
  });

  it("never goes backwards", () => {
    let date = "2027-01-31";
    for (let i = 0; i < 24; i++) {
      const next = addPeriod(date, "monthly");
      expect(next > date).toBe(true);
      date = next;
    }
  });
});
