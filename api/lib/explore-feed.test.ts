import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import {
  __feedInternals,
  feedCacheKey,
  feedScoreSql,
  getGlobalFeed,
  FEED_TTL_MS,
  type ExploreFeedKey,
  type FeedPlace,
} from "./explore-feed";

import { MySqlDialect } from "drizzle-orm/mysql-core";
import type { SQL } from "drizzle-orm";

const dialect = new MySqlDialect();
function sqlText(chunk: SQL): string {
  return dialect.sqlToQuery(chunk).sql;
}

describe("feedScoreSql", () => {
  it("mirrors the JS scorer terms", () => {
    const s = sqlText(feedScoreSql(new Set(["food"]), "historical", 2));
    // style overlap + tag overlap + rating + hidden + affordability + style penalty
    expect(s).toContain("10 *");
    expect(s).toContain("4 * LEAST(3,");
    expect(s).toContain("COALESCE(`explore_places`.`rating`, 4)");
    expect(s).toContain("1.5 * `explore_places`.`hidden`");
    expect(s).toContain("COALESCE(`explore_places`.`priceLevel`, 2) <= ?");
    expect(s).toContain("-100 * (1 - ");
  });

  it("adds the budget free-gem bonus only for the budget style", () => {
    expect(sqlText(feedScoreSql(new Set(["budget"]), null, 2))).toContain("`feeCents` = 0");
    expect(sqlText(feedScoreSql(new Set(["food"]), null, 2))).not.toContain("`feeCents` = 0");
  });

  it("omits LIKE terms for non-slug values (they can never match corpus slugs)", () => {
    const s = sqlText(feedScoreSql(new Set(["Fine Dining!!"]), "not a slug!", 2));
    expect(s).not.toContain("Fine Dining");
    expect(s).not.toContain("not a slug");
    expect(s).not.toContain("-100 *");
  });

  it("scores zero base when the user has no styles", () => {
    const s = sqlText(feedScoreSql(new Set(), null, 2));
    expect(s.trim()).toMatch(/^0\s/);
  });
});

describe("feedCacheKey", () => {
  it("is order-insensitive for styles", () => {
    expect(feedCacheKey({ styles: ["b", "a"], style: null, maxPrice: 2 })).toBe(
      feedCacheKey({ styles: ["a", "b"], style: null, maxPrice: 2 }),
    );
  });
  it("distinguishes style filter and budget", () => {
    const base = feedCacheKey({ styles: [], style: null, maxPrice: 2 });
    expect(feedCacheKey({ styles: [], style: "food", maxPrice: 2 })).not.toBe(base);
    expect(feedCacheKey({ styles: [], style: null, maxPrice: 3 })).not.toBe(base);
  });
});

describe("getGlobalFeed cache", () => {
  beforeEach(() => {
    __feedInternals.reset();
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
    __feedInternals.reset();
  });

  const key: ExploreFeedKey = { styles: [], style: null, maxPrice: 2 };
  const rows = (tag: string) => [{ id: tag }] as unknown as FeedPlace[];

  it("caches fills and coalesces concurrent misses (single-flight)", async () => {
    let calls = 0;
    __feedInternals.setFillImpl(async () => {
      calls++;
      return rows(`fill${calls}`);
    });
    const [a, b] = await Promise.all([getGlobalFeed(key), getGlobalFeed(key)]);
    expect(calls).toBe(1);
    expect(a).toBe(b);
    const c = await getGlobalFeed(key);
    expect(calls).toBe(1); // fresh cache hit
    expect(c).toBe(a);
  });

  it("refreshes after the TTL and serves stale while revalidating", async () => {
    let calls = 0;
    __feedInternals.setFillImpl(async () => {
      calls++;
      return rows(`fill${calls}`);
    });
    const first = await getGlobalFeed(key);
    vi.advanceTimersByTime(FEED_TTL_MS + 1);
    const stale = await getGlobalFeed(key); // stale hit + background refresh
    expect(stale).toBe(first);
    await vi.waitFor(() => expect(calls).toBe(2));
    const fresh = await getGlobalFeed(key);
    expect(fresh).not.toBe(first);
    expect(calls).toBe(2);
  });

  it("blocks on a fill once the stale window has lapsed", async () => {
    let calls = 0;
    __feedInternals.setFillImpl(async () => {
      calls++;
      return rows(`fill${calls}`);
    });
    await getGlobalFeed(key);
    vi.advanceTimersByTime(FEED_TTL_MS + 31 * 60 * 1000);
    const again = await getGlobalFeed(key);
    expect(calls).toBe(2);
    expect(again[0]!.id).toBe("fill2");
  });
});
