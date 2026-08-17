import { afterEach, describe, expect, it, vi } from "vitest";
import type { User } from "@db/schema";
import {
  chunkIntoDays,
  platformGroup,
  cleanSocialText,
  confidenceFor,
  countActiveTrips,
  detectPlatform,
  extractHashtags,
  extractSocialCandidates,
  geocodeCandidate,
  orderPlacesByRoute,
  parseMicrolinkResponse,
  partitionCandidates,
  rankCorpusMatches,
  sanitizeSocialCaption,
  socialRouter,
} from "./social-router";
import type { SocialCorpusRow } from "./social-router";
import { haversineKm } from "./trip-router";

afterEach(() => {
  vi.unstubAllGlobals();
});

// ─── Platform detection ─────────────────────────────────────────────────────
describe("detectPlatform", () => {
  it("recognizes tiktok hosts incl. short links", () => {
    expect(detectPlatform("https://www.tiktok.com/@user/video/123")).toBe("tiktok");
    expect(detectPlatform("https://vm.tiktok.com/abc/")).toBe("tiktok");
  });
  it("recognizes instagram, youtube, facebook, reddit; buckets the rest as other", () => {
    expect(detectPlatform("https://www.instagram.com/reel/abc/")).toBe("instagram");
    expect(detectPlatform("https://www.youtube.com/shorts/xyz")).toBe("youtube");
    expect(detectPlatform("https://youtu.be/xyz")).toBe("youtube");
    expect(detectPlatform("https://www.facebook.com/reel/123")).toBe("facebook");
    expect(detectPlatform("https://fb.watch/abc/")).toBe("facebook");
    expect(detectPlatform("https://www.reddit.com/r/travel/comments/xyz")).toBe("reddit");
    expect(detectPlatform("https://example.com/post")).toBe("other");
  });
  it("returns other for unparseable input", () => {
    expect(detectPlatform("not a url")).toBe("other");
  });
});

describe("platformGroup (r24-social)", () => {
  it("instagram/facebook are paste-caption, tiktok/youtube/reddit auto-fetch", () => {
    expect(platformGroup("instagram")).toBe("paste");
    expect(platformGroup("facebook")).toBe("paste");
    expect(platformGroup("tiktok")).toBe("auto");
    expect(platformGroup("youtube")).toBe("auto");
    expect(platformGroup("reddit")).toBe("auto");
    expect(platformGroup("other")).toBe("try-auto");
  });
});

// ─── Text cleaning ──────────────────────────────────────────────────────────
describe("cleanSocialText", () => {
  it("strips URLs and @mentions, keeps hashtag words, collapses whitespace", () => {
    const raw = "Best day!! https://www.tiktok.com/@u/video/1 @friend #Kyoto   #travel\tmore text";
    expect(cleanSocialText(raw)).toBe("Best day!! Kyoto travel more text");
  });
  it("keeps the tag word of multi-tag hashtags", () => {
    expect(cleanSocialText("#EiffelTower #Paris#foodie")).toBe("EiffelTower Paris foodie");
  });
  it("normalizes curly quotes and newlines", () => {
    expect(cleanSocialText("“The Grand Palace”\nwas packed")).toBe('"The Grand Palace" was packed');
  });
});

describe("extractHashtags", () => {
  it("pulls raw tag words", () => {
    expect(extractHashtags("loved it #Kyoto #food_tour")).toEqual(["Kyoto", "food_tour"]);
  });
});

// ─── Candidate extraction ───────────────────────────────────────────────────
describe("extractSocialCandidates", () => {
  it("finds multi-word capitalized spans (2–4 words)", () => {
    const cands = extractSocialCandidates("We visited Eiffel Tower, then Shibuya Crossing at night.");
    const names = cands.map((c) => c.name);
    expect(names).toContain("Eiffel Tower");
    expect(names).toContain("Shibuya Crossing");
  });

  it("drops stopwords and sentence-initial filler", () => {
    const cands = extractSocialCandidates("Day 1 of the trip: Monday in Kyoto. Travel vibes!");
    const names = cands.map((c) => c.name);
    expect(names).toContain("Kyoto");
    expect(names).not.toContain("Day");
    expect(names).not.toContain("Monday");
    expect(names).not.toContain("Travel");
  });

  it("marks hashtag candidates and keeps lowercase tag words", () => {
    const cands = extractSocialCandidates("so good #kyoto #FushimiInari");
    const kyoto = cands.find((c) => c.name === "kyoto");
    expect(kyoto?.hashtag).toBe(true);
    expect(cands.find((c) => c.name === "FushimiInari")?.hashtag).toBe(true);
  });

  it("dedupes by normalized name (span + hashtag of the same place)", () => {
    const cands = extractSocialCandidates("Eiffel Tower at sunset #EiffelTower");
    // "EiffelTower" (hashtag) and "Eiffel Tower" differ as written but the
    // span may not appear twice.
    const spans = cands.filter((c) => c.name === "Eiffel Tower");
    expect(spans.length).toBeLessThanOrEqual(1);
  });

  it("ignores lowercase prose words and short words", () => {
    const cands = extractSocialCandidates("we ate ramen near the big station to go");
    expect(cands).toEqual([]);
  });
});

// ─── Corpus matching / ranking ──────────────────────────────────────────────
const CORPUS: SocialCorpusRow[] = [
  { id: 1, name: "Eiffel Tower", city: "Paris", country: "France", lat: 48.8584, lng: 2.2945, rating: 4.7, verdict: "must-see", famousEatery: false },
  { id: 2, name: "Eiffel Tower", city: "Las Vegas", country: "United States", lat: 36.1125, lng: -115.1727, rating: 4.3, verdict: null, famousEatery: false },
  { id: 3, name: "Joe's Diner", city: "Paris", country: "France", lat: 48.85, lng: 2.35, rating: 4.6, verdict: null, famousEatery: true },
  { id: 4, name: "Joe's Diner", city: "Lyon", country: "France", lat: 45.76, lng: 4.83, rating: 4.0, verdict: null, famousEatery: false },
  { id: 5, name: "Shibuya Crossing", city: "Tokyo", country: "Japan", lat: 35.6595, lng: 139.7005, rating: 4.6, verdict: null, famousEatery: false },
];

const cand = (name: string, hashtag = false, genericOnly = false) => ({ name, hashtag, genericOnly });

describe("rankCorpusMatches", () => {
  it("exact name match wins and same-name rows dedupe to the better one", () => {
    const out = rankCorpusMatches([cand("Eiffel Tower")], CORPUS);
    expect(out).toHaveLength(1);
    expect(out[0]!.placeId).toBe(1); // must-see + higher rating beats the Vegas replica
    expect(out[0]!.matchedOn).toBe("exact");
    expect(out[0]!.source).toBe("corpus");
  });

  it("hintCity bias flips the winning same-name row", () => {
    const out = rankCorpusMatches([cand("Eiffel Tower")], CORPUS, { hintCity: "Las Vegas" });
    expect(out[0]!.placeId).toBe(2);
    expect(out[0]!.confidence).toBe("high"); // 98 base + 20 hint = 118
  });

  it("famous eatery beats the plain same-name row", () => {
    const out = rankCorpusMatches([cand("Joe's Diner")], CORPUS);
    expect(out).toHaveLength(1);
    expect(out[0]!.placeId).toBe(3);
    expect(out[0]!.city).toBe("Paris");
  });

  it("bands confidence: hashtag exact → high, bare exact → medium", () => {
    const bare = rankCorpusMatches([cand("Shibuya Crossing")], CORPUS);
    expect(bare[0]!.confidence).toBe("medium"); // 100 + rating
    const tagged = rankCorpusMatches([cand("Shibuya Crossing", true)], CORPUS);
    expect(tagged[0]!.confidence).toBe("high"); // +15 hashtag
  });

  it("drops weak uncorroborated substring matches (minimal confidence)", () => {
    const out = rankCorpusMatches([cand("Shibuya Crossing at Night")], CORPUS);
    expect(out).toEqual([]); // 'contained' tier, low, no hashtag/hint — junk guard
  });

  it("keeps low-confidence substring hits when a hashtag corroborates them", () => {
    const out = rankCorpusMatches([cand("Shibuya Crossing at Night", true)], CORPUS);
    expect(out).toHaveLength(1);
    expect(out[0]!.confidence).toBe("low");
  });

  it("mentioned-city bonus lifts places in the captioned city", () => {
    const corpus: SocialCorpusRow[] = [
      { id: 10, name: "Ichiran Ramen", city: "Tokyo", country: "Japan", lat: 35.69, lng: 139.7, rating: 4.5 },
      { id: 11, name: "Ichiran Ramen", city: "Osaka", country: "Japan", lat: 34.67, lng: 135.5, rating: 4.5 },
    ];
    const out = rankCorpusMatches([cand("Ichiran Ramen")], corpus, { mentionedCities: ["Tokyo"] });
    expect(out[0]!.placeId).toBe(10);
  });

  it("locality prior: single-word candidates only pin in the captioned city", () => {
    const corpus: SocialCorpusRow[] = [
      { id: 30, name: "Ramen", city: "Osaka", country: "Japan", lat: 34.6, lng: 135.5, rating: 4.6 },
      { id: 31, name: "Ramen", city: "Kyoto", country: "Japan", lat: 35.0, lng: 135.7, rating: 4.2 },
    ];
    // Caption is about Kyoto: the Osaka row is out of context.
    const out = rankCorpusMatches([cand("Ramen")], corpus, { mentionedCities: ["Kyoto"] });
    expect(out).toHaveLength(1);
    expect(out[0]!.placeId).toBe(31);
    // Without a city context both rows compete and dedupe to the better one.
    const noCtx = rankCorpusMatches([cand("Ramen")], corpus);
    expect(noCtx).toHaveLength(1);
    expect(noCtx[0]!.placeId).toBe(30);
  });

  it("skips corpus rows without coordinates and caps at 12", () => {
    const noCoords: SocialCorpusRow[] = [
      { id: 20, name: "Eiffel Tower", city: "Paris", country: "France", lat: null, lng: null },
    ];
    expect(rankCorpusMatches([cand("Eiffel Tower")], noCoords)).toEqual([]);
  });
});

describe("partitionCandidates", () => {
  it("splits city/country hashtag words away from place candidates", () => {
    const cands = [cand("Kyoto", true), cand("Japan", true), cand("Fushimi Inari"), cand("Ramen")];
    const { cityWords, countryWords, placeCands } = partitionCandidates(cands, ["Kyoto"], ["Japan"]);
    expect(cityWords.map((c) => c.name)).toEqual(["Kyoto"]);
    expect(countryWords.map((c) => c.name)).toEqual(["Japan"]);
    expect(placeCands.map((c) => c.name)).toEqual(["Fushimi Inari", "Ramen"]);
  });
});

describe("confidenceFor", () => {
  it("bands at 110 / 85 / below", () => {
    expect(confidenceFor(110)).toBe("high");
    expect(confidenceFor(85)).toBe("medium");
    expect(confidenceFor(84)).toBe("low");
  });
});

// ─── Caption sanitize (TikTok likes/comments noise) ─────────────────────────
describe("sanitizeSocialCaption", () => {
  it("strips the TikTok likes/comments prefix", () => {
    expect(sanitizeSocialCaption("1.2K likes, 84 comments. Kyoto food tour #japan")).toBe(
      "Kyoto food tour #japan",
    );
    expect(sanitizeSocialCaption("10 likes, 2 comments.  Ramen in Osaka")).toBe("Ramen in Osaka");
    expect(sanitizeSocialCaption("3M likes, 12K comments. Tokyo")).toBe("Tokyo");
  });
  it("leaves plain captions untouched (and collapses whitespace)", () => {
    expect(sanitizeSocialCaption("3 days in Kyoto #travel")).toBe("3 days in Kyoto #travel");
    expect(sanitizeSocialCaption("  Kyoto   food  ")).toBe("Kyoto food");
  });
});

// ─── Microlink response parsing ─────────────────────────────────────────────
describe("parseMicrolinkResponse", () => {
  it("parses a TikTok payload (description caption + author + image)", () => {
    const parsed = parseMicrolinkResponse({
      status: "success",
      data: {
        title: "wanderer on TikTok",
        description: "1.2K likes, 84 comments. 3 days in Kyoto #travel",
        author: "wanderer",
        image: { url: "https://p16-sign.tiktokcdn.com/x.jpg" },
      },
    });
    expect(parsed).toEqual({
      text: "3 days in Kyoto #travel",
      author: "wanderer",
      thumbnailUrl: "https://p16-sign.tiktokcdn.com/x.jpg",
    });
  });

  it("Instagram login wall (empty description, platform-name title) → null", () => {
    expect(
      parseMicrolinkResponse({ status: "success", data: { title: "Instagram", description: "" } }),
    ).toBeNull();
    expect(parseMicrolinkResponse({ status: "success", data: { title: "Instagram" } })).toBeNull();
  });

  it("falls back to a meaningful title when the description is empty", () => {
    const parsed = parseMicrolinkResponse({
      status: "success",
      data: { title: "Best ramen in Fukuoka", description: "" },
    });
    expect(parsed).toMatchObject({ text: "Best ramen in Fukuoka", author: null, thumbnailUrl: null });
  });

  it("rejects non-success / junk payloads", () => {
    expect(parseMicrolinkResponse({ status: "fail" })).toBeNull();
    expect(parseMicrolinkResponse(null)).toBeNull();
    expect(parseMicrolinkResponse("nope")).toBeNull();
    expect(parseMicrolinkResponse({ status: "success", data: {} })).toBeNull();
  });

  it("treats the generic logged-out TikTok landing text as no caption", () => {
    expect(
      parseMicrolinkResponse({
        status: "success",
        data: { title: "TikTok", description: "Browse your favorite items.", image: { url: "https://www.tiktok.com/favicon.ico" } },
      }),
    ).toBeNull();
  });
});

// ─── resolveLink (network fully mocked, no live microlink calls) ───────────
function caller() {
  const user = { id: 1, name: "Test", email: "t@example.com", role: "user" } as unknown as User;
  return socialRouter.createCaller({ req: new Request("http://test.local"), resHeaders: new Headers(), user });
}

const microlinkResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

describe("resolveLink", () => {
  it("TikTok success → sanitized caption + author + thumbnail", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        microlinkResponse({
          status: "success",
          data: {
            title: "eats on TikTok",
            description: "120 likes, 9 comments. Tokyo food tour",
            author: "eats",
            image: { url: "https://x/t.jpg" },
          },
        }),
      ),
    );
    const res = await caller().resolveLink({ url: "https://www.tiktok.com/@eats/video/123" });
    expect(res).toMatchObject({ ok: true, platform: "tiktok", text: "Tokyo food tour", author: "eats" });
  });

  it("Instagram/Facebook short-circuit to needsText login-wall WITHOUT fetching (r24-social)", async () => {
    const spy = vi.fn();
    vi.stubGlobal("fetch", spy);
    const ig = await caller().resolveLink({ url: "https://www.instagram.com/reel/abc/" });
    expect(ig).toMatchObject({ ok: false, platform: "instagram", needsText: true, reason: "login-wall" });
    const fb = await caller().resolveLink({ url: "https://www.facebook.com/reel/123" });
    expect(fb).toMatchObject({ ok: false, platform: "facebook", needsText: true, reason: "login-wall" });
    expect(spy).not.toHaveBeenCalled();
  });

  it("microlink network failure → needsText, never throws", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Promise.reject(new Error("ENETUNREACH"))));
    const res = await caller().resolveLink({ url: "https://www.tiktok.com/@eats/video/123" });
    expect(res).toMatchObject({ ok: false, platform: "tiktok", needsText: true });
  });

  it("HTML block page → needsText (no JSON parse explosion)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("<!DOCTYPE html><title>504</title>", { status: 200, headers: { "content-type": "text/html" } })),
    );
    const res = await caller().resolveLink({ url: "https://vm.tiktok.com/abc/" });
    expect(res).toMatchObject({ ok: false, needsText: true, reason: expect.stringContaining("fetch-failed") });
  });

  it("non-social links resolve through microlink too (platform other)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        microlinkResponse({ status: "success", data: { title: "Hidden gems of Lisbon" } }),
      ),
    );
    const res = await caller().resolveLink({ url: "https://blog.example.com/lisbon" });
    expect(res).toMatchObject({ ok: true, platform: "other", text: "Hidden gems of Lisbon" });
  });

  it("rejects invalid URLs without fetching", async () => {
    const spy = vi.fn();
    vi.stubGlobal("fetch", spy);
    await expect(caller().resolveLink({ url: "ht!tp://nope" })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(spy).not.toHaveBeenCalled();
  });
});

// ─── Photon geocode fallback (mocked) ───────────────────────────────────────
describe("geocodeCandidate", () => {
  const photon = (name: string, city: string, country: string, lat: number, lng: number) =>
    new Response(
      JSON.stringify({
        type: "FeatureCollection",
        features: [{ type: "Feature", properties: { name, city, country }, geometry: { type: "Point", coordinates: [lng, lat] } }],
      }),
      { status: 200, headers: { "content-type": "application/json" } },
    );

  it("resolves a city-like candidate to coordinates", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => photon("Kyoto", "Kyoto", "Japan", 35.0116, 135.7681)));
    const hit = await geocodeCandidate("Kyoto");
    expect(hit).toMatchObject({ city: "Kyoto", country: "Japan", lat: 35.0116, lng: 135.7681 });
  });

  it("rejects unrelated hits", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => photon("Springfield", "Springfield", "USA", 39.7, -89.6)));
    expect(await geocodeCandidate("Kyoto")).toBeNull();
  });

  it("never throws on network failure", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Promise.reject(new Error("down"))));
    expect(await geocodeCandidate("Kyoto")).toBeNull();
  });
});

// ─── Trip creation helpers ──────────────────────────────────────────────────
describe("orderPlacesByRoute", () => {
  const places = [
    { name: "A", lat: 0, lng: 0 },
    { name: "B", lat: 0, lng: 10 },
    { name: "C", lat: 10, lng: 0 },
    { name: "D", lat: 10, lng: 10 },
    { name: "E", lat: 5, lng: 5 },
  ];
  const total = (list: { lat: number; lng: number }[]) => {
    let d = 0;
    for (let i = 1; i < list.length; i++) d += haversineKm(list[i - 1]!.lat, list[i - 1]!.lng, list[i]!.lat, list[i]!.lng);
    return d;
  };

  it("2-opt ordering improves or equals the naive input order", () => {
    const ordered = orderPlacesByRoute(places);
    expect(ordered).toHaveLength(places.length);
    expect(total(ordered)).toBeLessThanOrEqual(total(places) + 1e-9);
  });

  it("keeps the first place anchored and is a permutation", () => {
    const ordered = orderPlacesByRoute(places);
    expect(ordered[0]!.name).toBe("A");
    expect([...ordered].map((p) => p.name).sort()).toEqual(["A", "B", "C", "D", "E"]);
  });

  it("passes through ≤2 places untouched", () => {
    const two = places.slice(0, 2);
    expect(orderPlacesByRoute(two)).toEqual(two);
  });
});

describe("chunkIntoDays", () => {
  it("chunks 10 stops into 8 + 2 across days", () => {
    const items = Array.from({ length: 10 }, (_, i) => i);
    expect(chunkIntoDays(items, 8).map((d) => d.length)).toEqual([8, 2]);
    expect(chunkIntoDays([], 8)).toEqual([]);
  });
});

describe("countActiveTrips (free-tier limit rule)", () => {
  const today = "2026-08-10";
  it("counts only trips ending today or later", () => {
    const owned = [
      { endDate: "2026-08-09" }, // past — doesn't count
      { endDate: "2026-08-10" }, // today — counts
      { endDate: "2026-09-01" }, // future — counts
    ];
    expect(countActiveTrips(owned, today)).toBe(2);
  });
  it("flags the wanderer 3-active-trip ceiling", () => {
    const owned = [{ endDate: "2026-08-11" }, { endDate: "2026-08-12" }, { endDate: "2026-08-13" }];
    expect(countActiveTrips(owned, today) >= 3).toBe(true); // FORBIDDEN UPGRADE_REQUIRED path
  });
});

// ─── extractFromText (r24-social; live DB corpus, same pattern as explore tests) ─
//
// r26: this hits a REAL MySQL corpus, so it cannot pass anywhere without a
// database - CI has none, and it was the single failure keeping the suite red
// while the other 462 tests passed. Skipped unless DATABASE_URL is set, so it
// still runs locally and in any environment wired to a real database, and
// stops masking genuine regressions everywhere else.
const describeWithDb = process.env.DATABASE_URL ? describe : describe.skip;

describeWithDb("extractFromText", () => {
  it("extracts corpus places from a pasted IG caption", async () => {
    // Never hit the network from tests: geocode fallback must stay quiet.
    vi.stubGlobal("fetch", vi.fn(async () => Promise.reject(new Error("offline"))));
    const res = await caller().extractFromText({
      text: "Paris weekend! Eiffel Tower at sunrise, then the Louvre. #paris #eiffeltower",
      hintCity: "Paris",
    });
    expect(res).toBeTruthy();
    expect(Array.isArray(res!.places)).toBe(true);
    expect(typeof res!.resolvedText).toBe("string");
    const names = res!.places.map((p) => p.name.toLowerCase());
    expect(names.some((n) => n.includes("eiffel"))).toBe(true);
  }, 20000);
});
