import { describe, expect, it } from "vitest";
import { and } from "drizzle-orm";
import { drizzle } from "drizzle-orm/mysql2";
import * as schema from "@db/schema";
import type { User } from "@db/schema";
import type { TrpcContext } from "./context";
import {
  adminRouter,
  bulkDeleteByFilterSchema,
  bulkDeleteConditions,
  escapeLike,
  hasBulkCriteria,
  placeCreateSchema,
  placePatchSchema,
  placeSearchConditions,
  toPlacePatch,
} from "./admin-router";

const fakeUser = (role: "user" | "admin") =>
  ({ id: role === "admin" ? 20233941 : 7, role }) as unknown as User;

const ctxFor = (user?: User): TrpcContext => ({
  req: new Request("http://localhost/api/trpc"),
  resHeaders: new Headers(),
  user,
});

describe("admin places console, role guard", () => {
  it("rejects non-admin callers with FORBIDDEN before touching the DB", async () => {
    const caller = adminRouter.createCaller(ctxFor(fakeUser("user")));
    await expect(caller.places.search({})).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(caller.places.stats()).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(caller.places.get({ id: 1 })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(caller.places.update({ id: 1, patch: { name: "x" } })).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    await expect(caller.places.bulkDelete({ ids: [1] })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(
      caller.places.bulkDeleteByFilter({ nameLike: "%駐車場%", confirm: true }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("rejects anonymous callers with UNAUTHORIZED", async () => {
    const caller = adminRouter.createCaller(ctxFor(undefined));
    await expect(caller.places.search({})).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    await expect(caller.places.stats()).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });
});

describe("placePatchSchema validation", () => {
  it("accepts a valid patch, including clearing verdict/image with null", () => {
    const parsed = placePatchSchema.parse({
      name: "Kiyomizu-dera",
      category: "temple",
      lat: 34.9949,
      lng: 135.785,
      rating: 4.7,
      verdict: null,
      tags: ["historic", "views"],
      image: null,
      photoAttribution: null,
    });
    expect(parsed.verdict).toBeNull();
    expect(parsed.tags).toEqual(["historic", "views"]);
  });

  it("rejects out-of-range and over-long fields", () => {
    expect(() => placePatchSchema.parse({ category: "x".repeat(33) })).toThrow();
    expect(() => placePatchSchema.parse({ rating: 5.5 })).toThrow();
    expect(() => placePatchSchema.parse({ rating: -1 })).toThrow();
    expect(() => placePatchSchema.parse({ lat: 91 })).toThrow();
    expect(() => placePatchSchema.parse({ lat: -91 })).toThrow();
    expect(() => placePatchSchema.parse({ lng: 181 })).toThrow();
    expect(() => placePatchSchema.parse({ verdict: "amazing" })).toThrow();
    expect(() => placePatchSchema.parse({ name: "" })).toThrow();
    expect(() => placePatchSchema.parse({ name: "x".repeat(256) })).toThrow();
  });
});

describe("placeCreateSchema validation", () => {
  const base = {
    name: "Fushimi Inari Taisha",
    category: "shrine",
    city: "Kyoto",
    country: "Japan",
    lat: 34.9671,
    lng: 135.7727,
  };

  it("requires name, category, city, country, lat and lng", () => {
    expect(placeCreateSchema.parse(base).name).toBe(base.name);
    for (const key of ["name", "category", "city", "country", "lat", "lng"] as const) {
      const incomplete = { ...base } as Record<string, unknown>;
      delete incomplete[key];
      expect(() => placeCreateSchema.parse(incomplete)).toThrow();
    }
  });

  it("enforces coordinate bounds", () => {
    expect(() => placeCreateSchema.parse({ ...base, lat: 120 })).toThrow();
    expect(() => placeCreateSchema.parse({ ...base, lng: -200 })).toThrow();
  });
});

describe("toPlacePatch", () => {
  it("keeps only provided keys and preserves explicit nulls (clear verdict/image)", () => {
    const patch = toPlacePatch({ verdict: null, image: null, rating: 4.2 });
    expect(patch).toEqual({ verdict: null, image: null, rating: 4.2 });
    expect("name" in patch).toBe(false);
    expect("tags" in patch).toBe(false);
  });

  it("normalizes blank image/attribution strings to null", () => {
    expect(toPlacePatch({ image: "   ", photoAttribution: "" })).toEqual({
      image: null,
      photoAttribution: null,
    });
    expect(toPlacePatch({ image: " https://img " }).image).toBe("https://img");
  });
});

describe("bulkDeleteByFilter", () => {
  it("requires confirm to be literally true", () => {
    expect(() => bulkDeleteByFilterSchema.parse({ nameLike: "%駐車場%" })).toThrow();
    expect(() => bulkDeleteByFilterSchema.parse({ nameLike: "%駐車場%", confirm: false })).toThrow();
    expect(() => bulkDeleteByFilterSchema.parse({ nameLike: "%駐車場%", confirm: "true" })).toThrow();
    expect(bulkDeleteByFilterSchema.parse({ nameLike: "%駐車場%", confirm: true }).confirm).toBe(true);
  });

  it("rejects a filter-less wipe at the resolver level (BAD_REQUEST, no DB touched)", async () => {
    const caller = adminRouter.createCaller(ctxFor(fakeUser("admin")));
    await expect(caller.places.bulkDeleteByFilter({ confirm: true })).rejects.toMatchObject({
      code: "BAD_REQUEST",
    });
  });

  it("detects whether any narrowing filter is present", () => {
    expect(hasBulkCriteria({})).toBe(false);
    expect(hasBulkCriteria({ nameLike: "%駐車場%" })).toBe(true);
    expect(hasBulkCriteria({ city: "Kyoto" })).toBe(true);
    expect(hasBulkCriteria({ country: "Japan", category: "parking" })).toBe(true);
  });

  it("builds a WHERE that matches only the requested rows", () => {
    const db = drizzle.mock({ schema, mode: "planetscale" });
    const whereFor = (filters: Parameters<typeof bulkDeleteConditions>[0]) => {
      const conditions = bulkDeleteConditions(filters);
      return db
        .select({ id: schema.explorePlaces.id })
        .from(schema.explorePlaces)
        .where(conditions.length ? and(...conditions) : undefined)
        .toSQL();
    };

    const parking = whereFor({ nameLike: "%駐車場%" });
    expect(parking.sql).toContain("`explore_places`.`name` like ?");
    expect(parking.params).toEqual(["%駐車場%"]);

    const combined = whereFor({ city: "Kyoto", country: "Japan", category: "parking" });
    expect(combined.sql).toContain("`explore_places`.`city` = ?");
    expect(combined.sql).toContain("`explore_places`.`country` = ?");
    expect(combined.sql).toContain("`explore_places`.`category` = ?");
    expect(combined.sql).toContain(" and ");
    expect(combined.params).toEqual(["Kyoto", "Japan", "parking"]);

    // No filters → no conditions → resolver refuses before a WHERE-less delete can run.
    expect(bulkDeleteConditions({})).toEqual([]);
  });
});

describe("escapeLike", () => {
  it("escapes LIKE wildcards so searches are literal", () => {
    expect(escapeLike("100%_\\")).toBe("100\\%\\_\\\\");
    expect(escapeLike("plain")).toBe("plain");
  });
});

// r19-portal: ONE smart search box fuzzy-matches name/nameLocal/city/country,
// with category/verdict dropdowns as exact refinements (shared admin+portal).
describe("placeSearchConditions (smart search)", () => {
  const db = drizzle.mock({ schema, mode: "planetscale" });
  const whereFor = (filters: Parameters<typeof placeSearchConditions>[0]) => {
    const conditions = placeSearchConditions(filters);
    return {
      conditions,
      sql: db
        .select({ id: schema.explorePlaces.id })
        .from(schema.explorePlaces)
        .where(conditions.length ? and(...conditions) : undefined)
        .toSQL(),
    };
  };

  it("no filters → no conditions (unfiltered list)", () => {
    expect(placeSearchConditions({})).toEqual([]);
    expect(placeSearchConditions({ q: "   " })).toEqual([]);
  });

  it("q matches name OR nameLocal OR city OR country (substring)", () => {
    const { sql: built } = whereFor({ q: "Riyadh" });
    expect(built.sql).toContain("`explore_places`.`name` like ?");
    expect(built.sql).toContain("`explore_places`.`nameLocal` like ?");
    expect(built.sql).toContain("`explore_places`.`city` like ?");
    expect(built.sql).toContain("`explore_places`.`country` like ?");
    expect(built.sql).toContain(" or ");
    expect(built.params).toEqual(["%Riyadh%", "%Riyadh%", "%Riyadh%", "%Riyadh%"]);
  });

  it("q with LIKE wildcards is matched literally (escaped)", () => {
    const { sql: built } = whereFor({ q: "100%_" });
    expect(built.params).toEqual(["%100\\%\\_%", "%100\\%\\_%", "%100\\%\\_%", "%100\\%\\_%"]);
  });

  it("non-Latin q (Arabic) passes through as a substring pattern", () => {
    const { sql: built } = whereFor({ q: "الرياض" });
    expect(built.params).toEqual(["%الرياض%", "%الرياض%", "%الرياض%", "%الرياض%"]);
  });

  it("dropdown refinements AND with the q match", () => {
    const { sql: built } = whereFor({ q: "mosque", category: "landmark", verdict: "must-see" });
    expect(built.sql).toContain(" and ");
    expect(built.sql).toContain("`explore_places`.`category` = ?");
    expect(built.sql).toContain("`explore_places`.`verdict` = ?");
    expect(built.params.slice(4)).toEqual(["landmark", "must-see"]);
  });

  it("exact city/country filters still work without q", () => {
    const { sql: built } = whereFor({ city: "Jeddah", country: "Saudi Arabia" });
    expect(built.sql).toContain("`explore_places`.`city` = ?");
    expect(built.sql).toContain("`explore_places`.`country` = ?");
    expect(built.params).toEqual(["Jeddah", "Saudi Arabia"]);
  });
});
