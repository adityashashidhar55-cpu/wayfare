import { describe, expect, it } from "vitest";
import {
  buildNarrationText,
  escapeSsml,
  voiceForPlace,
  NARRATION_MAX_CHARS,
  NARRATION_VOICE_DEFAULT,
  NARRATION_VOICE_INDIA,
} from "./narration";

/**
 * r21-detail - pure-function tests for the server narration pipeline
 * (text builder, SSML escaping, voice selection). The live TTS call is
 * exercised manually via the /api/narration endpoint check, not in CI.
 */

describe("buildNarrationText", () => {
  it("combines the place name and description", () => {
    const text = buildNarrationText({
      name: "Meenakshi Temple",
      description: "A historic Hindu temple on the southern bank of the Vaigai River.",
    });
    expect(text).toBe(
      "Meenakshi Temple. A historic Hindu temple on the southern bank of the Vaigai River.",
    );
  });

  it("returns empty when there is no description", () => {
    expect(buildNarrationText({ name: "Nowhere", description: null })).toBe("");
    expect(buildNarrationText({ name: "Nowhere", description: "   " })).toBe("");
    expect(buildNarrationText({ name: "Nowhere" })).toBe("");
  });

  it("strips URLs, emoji and markdown, and collapses whitespace", () => {
    const text = buildNarrationText({
      name: "Blue  Café",
      description:
        "Great  coffee ☕ and **fresh** bakes.\nSee https://example.com/menu for more. _Lovely_ spot!",
    });
    expect(text).toBe("Blue Café. Great coffee and fresh bakes. See for more. Lovely spot!");
  });

  it("trims to maxChars on a sentence boundary", () => {
    const sentence = "This is a fairly long sentence about the place. ";
    const description = sentence.repeat(40).trim();
    const text = buildNarrationText({ name: "Long Story Place", description });
    expect(text.length).toBeLessThanOrEqual(NARRATION_MAX_CHARS);
    expect(text.endsWith(".")).toBe(true);
  });

  it("falls back to a word boundary when no sentence end fits", () => {
    // empty name => no ". " separator, so the window has no sentence end at all
    const description = "word ".repeat(600).trim(); // ~3000 chars, no punctuation
    const text = buildNarrationText({ name: "", description });
    expect(text.length).toBeLessThanOrEqual(NARRATION_MAX_CHARS);
    expect(text.endsWith("word")).toBe(true);
  });
});

describe("escapeSsml", () => {
  it("escapes XML-special characters", () => {
    expect(escapeSsml(`A & B <C> "D" 'E'`)).toBe(
      "A &amp; B &lt;C&gt; &quot;D&quot; &apos;E&apos;",
    );
  });

  it("leaves plain text untouched", () => {
    expect(escapeSsml("Meenakshi Temple, Madurai.")).toBe("Meenakshi Temple, Madurai.");
  });
});

describe("voiceForPlace", () => {
  it("uses the en-IN neural voice for places in India", () => {
    expect(voiceForPlace({ name: "Amber Fort", country: "India" })).toBe(NARRATION_VOICE_INDIA);
    expect(voiceForPlace({ name: "Amber Fort", country: " india " })).toBe(NARRATION_VOICE_INDIA);
  });

  it("uses the default en-US voice elsewhere", () => {
    expect(voiceForPlace({ name: "Louvre", country: "France" })).toBe(NARRATION_VOICE_DEFAULT);
    expect(voiceForPlace({ name: "Somewhere" })).toBe(NARRATION_VOICE_DEFAULT);
  });
});
