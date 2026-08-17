/**
 * api/lib/latin-name.ts (r19-portal) — English/Latin display names for
 * places whose OSM `name` is in a non-Latin script (Arabic, CJK, Cyrillic…).
 *
 * Owner pain point: "places in Saudi are in Arabic, translation needed."
 * explore_places.name is the display name — for non-Latin-script OSM imports
 * we want the English/Latin form there and the original local-script name in
 * explore_places.nameLocal. Three sourcing tiers (pickDisplayName):
 *
 *   1. Fully Latin name → keep as-is, no nameLocal.
 *   2. Bilingual mashup ("Mémorial Yves Saint Laurent نصب تذكاري…") → split:
 *      the Latin segment becomes `name`, the FULL original string (both
 *      segments, as OSM had it) is preserved in nameLocal.
 *   3. Pure non-Latin name → prefer OSM alt-name tags name:en → int_name →
 *      name:en-Latn → name:latin as `name`, original in nameLocal. When no
 *      English form exists the row is left unchanged (nameLocal stays NULL);
 *      db/translate-names.ts can retry those later with a network pass.
 *
 * All helpers are pure/network-free — the network tier lives in
 * db/translate-names.ts (Overpass tag fetch by osmId).
 */

/** Arabic (+ supplements/presentation), Hebrew, Cyrillic, CJK, kana, hangul, Thai, Devanagari. */
const NON_LATIN_RE =
  /[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF\uFB50-\uFDFF\uFE70-\uFEFF\u0590-\u05FF\u0400-\u04FF\uAC00-\uD7AF\u1100-\u11FF\u3040-\u309F\u30A0-\u30FF\u4E00-\u9FFF\u3400-\u4DBF\u0E00-\u0E7F\u0900-\u097F]/;

/** Latin letters incl. diacritics and extended blocks (é, ñ, ł, …). */
const LATIN_LETTER_RE = /[A-Za-z\u00C0-\u024F\u1E00-\u1EFF]/;
const LATIN_STRIP_RE = /[^A-Za-z\u00C0-\u024F\u1E00-\u1EFF]/g;

/** True when `s` contains at least one character in a non-Latin script. */
export function hasNonLatinScript(s: string): boolean {
  return NON_LATIN_RE.test(s);
}

/**
 * Latin segments that are too generic to stand alone as a display name
 * ("Hotel فندق" splitting to "Hotel" would be a worse name than the original).
 */
const GENERIC_LATIN = new Set([
  "hotel", "hotels", "cafe", "café", "restaurant", "restaurants", "mosque",
  "masjid", "temple", "church", "market", "souk", "souq", "museum", "park",
  "garden", "pharmacy", "bank", "atm", "hospital", "clinic", "school",
  "shop", "store", "mall", "parking", "station", "airport", "guest house",
  "guesthouse", "hostel", "coffee", "bar", "supermarket", "bakery",
]);

/**
 * Split a bilingual mashup name ("Latin segment <space> non-Latin segment",
 * either order) into its parts. Returns null unless the name contains BOTH
 * scripts, the parts are contiguous (one Latin run + one non-Latin run), the
 * Latin part has ≥3 letters and isn't a generic word like "Hotel".
 * Digits/punctuation/spaces attach to the segment they appear in.
 */
export function splitBilingual(name: string): { latin: string; local: string } | null {
  const s = name.trim().replace(/\s+/g, " ");
  if (!s || !hasNonLatinScript(s) || !LATIN_LETTER_RE.test(s)) return null;

  const segs: { script: "latin" | "local"; text: string }[] = [];
  let cur = "";
  let curScript: "latin" | "local" | null = null;
  for (const ch of Array.from(s)) {
    const sc: "latin" | "local" | null = NON_LATIN_RE.test(ch)
      ? "local"
      : LATIN_LETTER_RE.test(ch)
        ? "latin"
        : null;
    if (sc === null && curScript === null) continue; // leading punctuation/spaces
    if (sc !== null && sc !== curScript) {
      if (cur.trim()) segs.push({ script: curScript!, text: cur.trim() });
      cur = "";
      curScript = sc;
    }
    cur += ch;
  }
  if (cur.trim() && curScript) segs.push({ script: curScript, text: cur.trim() });

  const latins = segs.filter((x) => x.script === "latin");
  const locals = segs.filter((x) => x.script === "local");
  if (latins.length !== 1 || locals.length !== 1) return null;
  const latin = latins[0]!.text;
  const local = locals[0]!.text;
  if (latin.replace(LATIN_STRIP_RE, "").length < 3) return null;
  if (GENERIC_LATIN.has(latin.toLowerCase())) return null;
  return { latin, local };
}

export interface DisplayName {
  name: string;
  nameLocal: string | null;
}

/** First non-empty trimmed value among the given tag keys, in priority order. */
function firstAltName(tags: Record<string, string>, keys: string[]): string | null {
  for (const k of keys) {
    const v = (tags[k] ?? "").trim();
    if (v) return v;
  }
  return null;
}

/** English/Latin alt-name tags OSM mappers commonly fill, in priority order. */
export const EN_NAME_TAG_KEYS = ["name:en", "int_name", "name:en-Latn", "name:latin"];

/**
 * Decide the display name + local name for a place whose raw OSM `name` may
 * be non-Latin. Pure — never throws, never touches the network.
 */
export function pickDisplayName(
  tags: Record<string, string>,
  name: string,
): DisplayName {
  const trimmed = name.trim();
  if (!hasNonLatinScript(trimmed)) return { name: trimmed, nameLocal: null };

  const bi = splitBilingual(trimmed);
  if (bi) return { name: bi.latin, nameLocal: trimmed };

  const en = firstAltName(tags, EN_NAME_TAG_KEYS);
  if (en && en !== trimmed) return { name: en, nameLocal: trimmed };

  return { name: trimmed, nameLocal: null };
}
