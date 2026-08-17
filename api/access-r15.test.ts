import { describe, expect, it } from "vitest";
import { TRPCError } from "@trpc/server";
import { safeErrorCause } from "./middleware";

/**
 * r15-access unit tests (pure parts). The DB-level flows - 403 carrying the
 * shareToken, claim-on-login for friend participants - are covered by
 * scripts/verify-access.mts.
 */
describe("safeErrorCause", () => {
  it("passes plain-object causes through (shareToken redirect payload)", () => {
    const cause = { shareToken: "b1111111-2222-4333-8444-555555555555" };
    expect(safeErrorCause(cause)).toEqual(cause);
  });

  it("drops Error causes (DB/driver internals must never leak)", () => {
    expect(safeErrorCause(new Error("duplicate entry for key 'email'"))).toBeUndefined();
    // subclassed errors too
    class DbError extends Error {}
    expect(safeErrorCause(new DbError("nope"))).toBeUndefined();
  });

  it("drops null/undefined causes", () => {
    expect(safeErrorCause(null)).toBeUndefined();
    expect(safeErrorCause(undefined)).toBeUndefined();
  });
});

describe("trips.get FORBIDDEN cause shape", () => {
  it("a TRPCError built with a shareToken cause keeps it on .cause", () => {
    // mirrors api/trip-router.ts get(): the client reads error.data.cause
    // (which the errorFormatter fills from error.cause via safeErrorCause).
    const err = new TRPCError({
      code: "FORBIDDEN",
      message: "Not a member of this trip",
      cause: { shareToken: "tok-123" },
    });
    expect(err.code).toBe("FORBIDDEN");
    expect(safeErrorCause(err.cause)).toEqual({ shareToken: "tok-123" });
  });

  it("a TRPCError without a cause serializes no cause (friendly no-access)", () => {
    const err = new TRPCError({ code: "FORBIDDEN", message: "Not a member of this trip" });
    expect(safeErrorCause(err.cause)).toBeUndefined();
  });
});
