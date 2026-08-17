import { afterEach, describe, expect, it, vi } from "vitest";
import { ExternalApiError, fetchJson } from "./http";

/**
 * The r11-apifix crash: external APIs answering HTML error pages (Overpass
 * 504, Photon/Nominatim block pages, db.transport.rest 503) used to explode
 * as `Unexpected token '<' … is not valid JSON` out of a blind res.json().
 * fetchJson must surface a typed ExternalApiError instead.
 */

function htmlResponse(status = 200, body = "<!DOCTYPE html><html><body>504 Gateway Time-out</body></html>") {
  return new Response(body, {
    status,
    headers: { "content-type": "text/html; charset=utf-8" },
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("fetchJson", () => {
  it("parses a real JSON response", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(JSON.stringify({ elements: [1, 2] }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      ),
    );
    const data = await fetchJson<{ elements: number[] }>("https://example.test/api");
    expect(data.elements).toEqual([1, 2]);
  });

  it("throws ExternalApiError (not SyntaxError) on an HTML 200 page", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => htmlResponse(200)));
    const err = await fetchJson("https://example.test/api").catch((e) => e);
    expect(err).toBeInstanceOf(ExternalApiError);
    expect(err).not.toBeInstanceOf(SyntaxError);
    expect((err as ExternalApiError).message).toMatch(/non-JSON response/);
  });

  it("throws ExternalApiError with status on an HTML 504 gateway page", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => htmlResponse(504)));
    const err = await fetchJson("https://example.test/api", { service: "overpass" }).catch((e) => e);
    expect(err).toBeInstanceOf(ExternalApiError);
    expect((err as ExternalApiError).status).toBe(504);
    expect((err as ExternalApiError).service).toBe("overpass");
    expect((err as ExternalApiError).message).toMatch(/HTTP 504/);
  });

  it("throws ExternalApiError when a JSON content-type carries a broken body", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response("{not json", {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      ),
    );
    const err = await fetchJson("https://example.test/api").catch((e) => e);
    expect(err).toBeInstanceOf(ExternalApiError);
    expect((err as ExternalApiError).message).toMatch(/invalid JSON body/);
  });

  it("sends a Wayfare User-Agent and Accept header", async () => {
    const spy = vi.fn(
      async (_url: unknown, _init?: RequestInit) =>
        new Response("{}", { status: 200, headers: { "content-type": "application/json" } }),
    );
    vi.stubGlobal("fetch", spy);
    await fetchJson("https://example.test/api");
    const init = spy.mock.calls[0]![1] as RequestInit;
    const headers = init.headers as Record<string, string>;
    expect(headers["User-Agent"]).toMatch(/Wayfare/);
    expect(headers["Accept"]).toBe("application/json");
  });

  it("times out via AbortSignal", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        (_url: unknown, init: RequestInit) =>
          new Promise((_resolve, reject) => {
            init.signal?.addEventListener("abort", () =>
              reject(new DOMException("The operation timed out", "TimeoutError")),
            );
          }),
      ),
    );
    const err = await fetchJson("https://example.test/api", { timeoutMs: 20 }).catch((e) => e);
    expect(err).toBeInstanceOf(ExternalApiError);
    expect((err as ExternalApiError).message).toMatch(/timeout/);
  });
});
