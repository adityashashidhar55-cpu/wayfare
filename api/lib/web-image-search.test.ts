import { afterEach, describe, expect, it, vi } from "vitest";
import { searchWebImagesUncached } from "./web-image-search";

const jsonResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("searchWebImagesUncached", () => {
  it("returns unavailable (NOT an error) when every source fails", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockRejectedValue(new Error("getaddrinfo ENOTFOUND api.openverse.org")),
    );
    const res = await searchWebImagesUncached("Al-Masjid an-Nabawi Medina", 9);
    expect(res.unavailable).toBe(true);
    expect(res.candidates).toEqual([]);
  });

  it("maps Openverse results with license + creator attribution", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        jsonResponse({
          results: [
            {
              url: "https://live.staticflickr.com/1/2/3_b.jpg",
              thumbnail: "https://live.staticflickr.com/1/2/3_m.jpg",
              title: "Prophet's Mosque",
              license: "by-sa",
              creator: "Jane Doe",
            },
            { url: "not-a-url", title: "broken" },
          ],
        }),
      ),
    );
    const res = await searchWebImagesUncached("mosque medina", 9);
    expect(res.unavailable).toBe(false);
    expect(res.candidates).toHaveLength(1);
    expect(res.candidates[0]).toMatchObject({
      url: "https://live.staticflickr.com/1/2/3_b.jpg",
      thumb: "https://live.staticflickr.com/1/2/3_m.jpg",
      title: "Prophet's Mosque",
      source: "openverse",
      license: "BY-SA",
      attribution: "Jane Doe · BY-SA",
    });
  });

  it("falls through to DuckDuckGo when Openverse fails", async () => {
    const fetchMock = vi.fn().mockImplementation((input: unknown) => {
      const url = String(input);
      if (url.includes("api.openverse.org")) {
        return Promise.reject(new Error("blocked"));
      }
      if (url.startsWith("https://duckduckgo.com/i.js")) {
        return Promise.resolve(
          jsonResponse({
            results: [
              { m: "https://img.example.org/pic.jpg", t: "A nice place", tb: "data:image/jpeg;base64,AA==" },
              { m: "ftp://nope/x.jpg", t: "bad scheme" },
            ],
          }),
        );
      }
      // html page with the vqd token
      return Promise.resolve(
        new Response('<html><script>vqd="3-123456";</script></html>', {
          status: 200,
          headers: { "content-type": "text/html" },
        }),
      );
    });
    vi.stubGlobal("fetch", fetchMock);
    const res = await searchWebImagesUncached("senso-ji tokyo", 9);
    expect(res.unavailable).toBe(false);
    expect(res.candidates).toHaveLength(1);
    expect(res.candidates[0]).toMatchObject({
      url: "https://img.example.org/pic.jpg",
      thumb: "data:image/jpeg;base64,AA==",
      title: "A nice place",
      source: "duckduckgo",
      attribution: "img.example.org",
    });
  });

  it("marks unavailable when Openverse 404s and DuckDuckGo html has no vqd", async () => {
    const fetchMock = vi.fn().mockImplementation((input: unknown) => {
      const url = String(input);
      if (url.includes("api.openverse.org")) {
        return Promise.resolve(jsonResponse({ results: [] }, 200)); // reachable, empty
      }
      return Promise.resolve(
        new Response("<html>no token here</html>", {
          status: 200,
          headers: { "content-type": "text/html" },
        }),
      );
    });
    vi.stubGlobal("fetch", fetchMock);
    const res = await searchWebImagesUncached("nothing anywhere", 9);
    expect(res.candidates).toEqual([]);
    expect(res.unavailable).toBe(true);
  });

  it("empty results from reachable sources is NOT unavailable", async () => {
    const fetchMock = vi.fn().mockImplementation((input: unknown) => {
      const url = String(input);
      if (url.includes("api.openverse.org") || url.startsWith("https://duckduckgo.com/i.js")) {
        return Promise.resolve(jsonResponse({ results: [] }));
      }
      return Promise.resolve(
        new Response('<html><script>vqd="3-1";</script></html>', {
          status: 200,
          headers: { "content-type": "text/html" },
        }),
      );
    });
    vi.stubGlobal("fetch", fetchMock);
    const res = await searchWebImagesUncached("zzzqqq", 9);
    expect(res.unavailable).toBe(false);
    expect(res.candidates).toEqual([]);
  });

  it("blank query short-circuits without fetching", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const res = await searchWebImagesUncached("   ", 9);
    expect(res).toEqual({ candidates: [], unavailable: false });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
