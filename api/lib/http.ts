/**
 * Shared HTTP helpers for every outbound (third-party) call.
 *
 * `fetchJson` is the safe way to consume external JSON APIs (Overpass,
 * Photon, Nominatim, OSRM, db.transport.rest, transitous, Open-Meteo, …):
 *
 *  - sets a real Wayfare User-Agent (Nominatim/Overpass usage policies
 *    require one) plus `Accept: application/json`,
 *  - checks `res.ok` BEFORE parsing and - critically - refuses to parse
 *    bodies whose content-type is not JSON, so an HTML error page (an
 *    Overpass 504 page, a Photon/Nominatim block page, a transitous 503)
 *    can never explode into `Unexpected token '<' … is not valid JSON`,
 *  - throws a typed `ExternalApiError` (service name + HTTP status) so the
 *    callers' existing try/catch fallbacks degrade softly instead of
 *    crashing the whole tRPC procedure,
 *  - times out via AbortSignal (default 12 s, overridable per call).
 */

/** Typed failure of an external JSON API - callers catch and fall back. */
export class ExternalApiError extends Error {
  /** short service label, e.g. "overpass", "photon", "osrm" */
  readonly service: string;
  /** HTTP status when the server answered (null for network/timeout) */
  readonly status: number | null;

  constructor(service: string, message: string, status: number | null = null) {
    super(`[${service}] ${message}`);
    this.name = "ExternalApiError";
    this.service = service;
    this.status = status;
  }
}

export interface FetchJsonOptions extends Omit<RequestInit, "signal"> {
  /** Service label for typed errors (defaults to the URL hostname). */
  service?: string;
  /** Abort timeout in ms (default 12_000). Ignored when `signal` is passed. */
  timeoutMs?: number;
  /** Override the default Wayfare User-Agent. */
  userAgent?: string;
  /** Caller-managed abort signal (wins over `timeoutMs`). */
  signal?: AbortSignal;
}

const DEFAULT_UA = "Wayfare/1.0 (travel app; +https://wayfare.app)";

function serviceNameOf(url: string | URL): string {
  try {
    return new URL(url).hostname;
  } catch {
    return "external";
  }
}

/**
 * Fetch a URL and parse its body as JSON - safely.
 *
 * Throws `ExternalApiError` on: network failure, timeout, non-2xx status,
 * a non-JSON content-type (HTML error pages!), or an unparseable body.
 * Never returns raw `SyntaxError`s from `res.json()`.
 */
export async function fetchJson<T = unknown>(
  url: string | URL,
  opts: FetchJsonOptions = {},
): Promise<T> {
  const { service, timeoutMs = 12_000, userAgent, signal, headers, ...rest } = opts;
  const name = service ?? serviceNameOf(url);

  let res: Response;
  try {
    res = await fetch(url, {
      ...rest,
      headers: {
        "User-Agent": userAgent ?? DEFAULT_UA,
        Accept: "application/json",
        ...headers,
      },
      signal: signal ?? AbortSignal.timeout(timeoutMs),
    });
  } catch (e) {
    const errName = e instanceof Error ? e.name : "";
    if (errName === "TimeoutError") {
      throw new ExternalApiError(name, `timeout after ${timeoutMs}ms`);
    }
    if (errName === "AbortError") throw new ExternalApiError(name, "request aborted");
    throw new ExternalApiError(name, e instanceof Error ? e.message : String(e));
  }

  if (!res.ok) {
    throw new ExternalApiError(name, `HTTP ${res.status}`, res.status);
  }

  // An HTML error page is the classic failure here (Overpass 504 page,
  // Nominatim block page, db.transport.rest 503) - refuse to parse it.
  const contentType = (res.headers.get("content-type") ?? "").toLowerCase();
  if (contentType && !contentType.includes("json")) {
    throw new ExternalApiError(
      name,
      `non-JSON response (content-type: ${contentType.split(";")[0]})`,
      res.status,
    );
  }

  try {
    return (await res.json()) as T;
  } catch (e) {
    throw new ExternalApiError(
      name,
      `invalid JSON body: ${e instanceof Error ? e.message : String(e)}`,
      res.status,
    );
  }
}

/** Convenience: true when the error came from an external API wrapper. */
export function isExternalApiError(e: unknown): e is ExternalApiError {
  return e instanceof ExternalApiError;
}

// ─── Legacy client (kept for compatibility; now built on fetchJson) ─────────

interface RequestConfig extends RequestInit {
  baseUrl?: string;
  params?: Record<string, string | number>;
  timeout?: number;
}

export class HttpClient {
  private baseUrl: string;
  private defaultHeaders: Record<string, string>;

  constructor(baseURL: string, opts?: { headers?: Record<string, string> }) {
    this.baseUrl = baseURL;
    this.defaultHeaders = {
      "Content-Type": "application/json",
      ...opts?.headers,
    };
  }

  async request<T>(endpoint: string, config: RequestConfig = {}): Promise<T> {
    const {
      method = "GET",
      params,
      body,
      headers,
      timeout = 30000,
      signal,
      ...rest
    } = config;

    const url = new URL(`${this.baseUrl}${endpoint}`);
    if (params) {
      Object.entries(params).forEach(([key, value]) =>
        url.searchParams.append(key, value.toString()),
      );
    }

    try {
      return await fetchJson<T>(url, {
        ...rest,
        method,
        headers: { ...this.defaultHeaders, ...(headers as Record<string, string> | undefined) },
        body: body ? JSON.stringify(body) : undefined,
        timeoutMs: timeout,
        signal: signal ?? undefined,
      });
    } catch (error) {
      if (error instanceof ExternalApiError) {
        if (error.message.includes("timeout")) throw new Error("Request timeout");
        throw new Error(error.message);
      }
      throw error;
    }
  }

  get<T>(
    url: string,
    params?: RequestConfig["params"],
    config?: RequestConfig,
  ) {
    return this.request<T>(url, { ...config, method: "GET", params });
  }

  post<T>(url: string, body?: any, config?: RequestConfig) {
    return this.request<T>(url, { ...config, method: "POST", body });
  }
}
