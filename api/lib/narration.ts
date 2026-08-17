// api/lib/narration.ts - Server-side place narration (r21-detail).
//
// Browser SpeechSynthesis is flaky on mobile (iOS voice-loading races,
// gesture requirements), so the Listen button is driven by a real MP3
// generated here via the open-source `msedge-tts` client (Microsoft Edge
// Read Aloud endpoint, no API key) and cached in the shared `api_cache`
// table as base64 (v is MEDIUMTEXT, ~16MB - a capped 1200-char narration
// is a few hundred KB of MP3, so it fits comfortably).
//
// Failure contract for the Hono route (see boot.ts):
//   - unknown place            -> NarrationError("not_found")      -> 404
//   - no description to read   -> NarrationError("no_description") -> 400
//   - TTS failure after retry  -> NarrationError("tts_failed")     -> 503

import { createHash } from "node:crypto";
import { eq } from "drizzle-orm";
import { MsEdgeTTS, OUTPUT_FORMAT } from "msedge-tts";
import * as schema from "@db/schema";
import { getDb } from "../queries/connection";
import { cacheGet, cacheSet } from "./cache";

/** Hard cap on narration length (keeps synthesis latency + cache size bounded). */
export const NARRATION_MAX_CHARS = 1200;
/** Clear default neural voice; Indian places get the en-IN neural voice. */
export const NARRATION_VOICE_DEFAULT = "en-US-AriaNeural";
export const NARRATION_VOICE_INDIA = "en-IN-NeerjaNeural";
/** Narration is deterministic per (text, voice) - cache for 180 days. */
const CACHE_TTL_MS = 180 * 24 * 60 * 60 * 1000;
export const NARRATION_MIME = "audio/mpeg";

export type NarrationErrorCode = "not_found" | "no_description" | "tts_failed";

export class NarrationError extends Error {
  constructor(
    public readonly code: NarrationErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "NarrationError";
  }
}

export interface NarrationResult {
  mime: string;
  bytes: Buffer;
  voice: string;
  /** true when served from the persistent cache (no TTS round-trip). */
  cached: boolean;
}

export interface NarrationPlaceInput {
  name: string;
  city?: string | null;
  country?: string | null;
  description?: string | null;
}

/** XML-escape text before it is interpolated into the SSML template. */
export function escapeSsml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/**
 * Build the spoken script for a place: the name, then the description,
 * cleaned for reading aloud (URLs, emoji and markdown stripped, whitespace
 * collapsed) and capped at `maxChars` on a sentence boundary. Returns ""
 * when there is nothing meaningful to read.
 */
export function buildNarrationText(
  place: NarrationPlaceInput,
  maxChars: number = NARRATION_MAX_CHARS,
): string {
  const description = (place.description ?? "")
    // URLs (http(s)://... or www....)
    .replace(/https?:\/\/\S+|www\.\S+/gi, " ")
    // emoji + pictographs, variation selectors, ZWJ
    .replace(/[\p{Extended_Pictographic}\uFE0F\u200D]/gu, "")
    // markdown symbols
    .replace(/[*_#>`~]/g, "")
    // collapse whitespace/newlines
    .replace(/\s+/g, " ")
    .trim();

  const name = place.name.trim().replace(/\s+/g, " ");
  if (!description) return "";
  let out = name ? `${name}. ${description}` : description;

  if (out.length <= maxChars) return out;
  const window_ = out.slice(0, maxChars);
  const lastEnd = Math.max(
    ...[".", "!", "?"].map((p) => window_.lastIndexOf(p)),
  );
  if (lastEnd > 0) return window_.slice(0, lastEnd + 1).trim();
  const lastSpace = window_.lastIndexOf(" ");
  if (lastSpace > 0) return window_.slice(0, lastSpace).trim();
  return window_.trim();
}

/** en-IN neural voice for places in India, clear en-US voice otherwise. */
export function voiceForPlace(place: NarrationPlaceInput): string {
  return (place.country ?? "").trim().toLowerCase() === "india"
    ? NARRATION_VOICE_INDIA
    : NARRATION_VOICE_DEFAULT;
}

/** Stable cache key for one (place, text, voice) combination. */
function narrationCacheKey(placeId: number, text: string, voice: string): string {
  const hash = createHash("sha256").update(`${voice}|${text}`).digest("hex").slice(0, 24);
  return `narr:${placeId}:${hash}`;
}

interface CachedAudio {
  mime: string;
  b64: string;
}

/** One synthesis attempt: stream MP3 chunks from the Edge endpoint into a Buffer. */
async function synthesizeOnce(text: string, voice: string): Promise<Buffer> {
  const tts = new MsEdgeTTS();
  try {
    await tts.setMetadata(voice, OUTPUT_FORMAT.AUDIO_24KHZ_48KBITRATE_MONO_MP3);
    const { audioStream } = tts.toStream(escapeSsml(text));
    const chunks: Buffer[] = await new Promise((resolve, reject) => {
      const acc: Buffer[] = [];
      audioStream.on("data", (chunk: Buffer | Uint8Array) =>
        acc.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)),
      );
      audioStream.on("end", () => resolve(acc));
      audioStream.on("error", reject);
    });
    const bytes = Buffer.concat(chunks);
    if (bytes.length < 200) {
      throw new Error(`TTS returned suspiciously small audio (${bytes.length} bytes)`);
    }
    return bytes;
  } finally {
    tts.close();
  }
}

/** Synthesize with one retry (the Edge endpoint occasionally drops the socket). */
export async function synthesizeNarration(text: string, voice: string): Promise<Buffer> {
  try {
    return await synthesizeOnce(text, voice);
  } catch {
    return synthesizeOnce(text, voice);
  }
}

/** In-flight generations, so concurrent requests for the same place share one TTS call. */
const inflight = new Map<string, Promise<NarrationResult>>();

async function generateAndCache(
  cacheKey: string,
  text: string,
  voice: string,
): Promise<NarrationResult> {
  let bytes: Buffer;
  try {
    bytes = await synthesizeNarration(text, voice);
  } catch (err) {
    throw new NarrationError(
      "tts_failed",
      `Audio narration is temporarily unavailable (${err instanceof Error ? err.message : "TTS error"})`,
    );
  }
  const cached: CachedAudio = { mime: NARRATION_MIME, b64: bytes.toString("base64") };
  // fire-and-forget safe: cacheSet never throws
  await cacheSet(cacheKey, cached, CACHE_TTL_MS);
  return { mime: NARRATION_MIME, bytes, voice, cached: false };
}

/**
 * Load a place, build its narration script and return MP3 bytes, served from
 * the persistent cache when this exact (text, voice) was generated before.
 */
export async function getPlaceNarration(placeId: number): Promise<NarrationResult> {
  const db = getDb();
  const [place] = await db
    .select({
      id: schema.explorePlaces.id,
      name: schema.explorePlaces.name,
      city: schema.explorePlaces.city,
      country: schema.explorePlaces.country,
      description: schema.explorePlaces.description,
    })
    .from(schema.explorePlaces)
    .where(eq(schema.explorePlaces.id, placeId))
    .limit(1);
  if (!place) throw new NarrationError("not_found", "Place not found");

  const text = buildNarrationText(place);
  if (!text) {
    throw new NarrationError("no_description", "This place has no story to narrate yet");
  }
  const voice = voiceForPlace(place);
  const key = narrationCacheKey(placeId, text, voice);

  const hit = await cacheGet<CachedAudio>(key);
  if (hit && typeof hit.b64 === "string") {
    return { mime: hit.mime || NARRATION_MIME, bytes: Buffer.from(hit.b64, "base64"), voice, cached: true };
  }

  const pending = inflight.get(key);
  if (pending) return pending;

  const generation = generateAndCache(key, text, voice).finally(() => {
    inflight.delete(key);
  });
  inflight.set(key, generation);
  return generation;
}
