/**
 * _verify-dishes.mts - one-off: verify signature-dishes-germany.draft.json
 * place coords through Photon ("name, city, Germany"), write the final
 * db/data/signature-dishes-germany.json with VERIFIED coords. Unverifiable
 * places are dropped (logged); dishes that lose all places are dropped.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { fetchJson } from "../api/lib/http";
import { geocodeCityInCountry } from "../api/queries/overpass";

/** normalizeNameKey plus U+2018/2019 apostrophe folding + token-prefix match. */
const normKey = (s: string) =>
  s
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/œ/g, "oe").replace(/æ/g, "ae").replace(/ß/g, "ss")
    .replace(/ø/g, "o").replace(/ł/g, "l").replace(/[đð]/g, "d").replace(/þ/g, "th")
    .replace(/[‘’‛'ʼ`]/g, "")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
/** Every token of the shorter name matches a token of the longer one
 * (exact, or ≥4-char prefix - "apfelwein" ↔ "apfelweinwirtschaft"). */
function nameMatches(a: string, b: string): boolean {
  const ta = normKey(a).split(" ").filter(Boolean);
  const tb = normKey(b).split(" ").filter(Boolean);
  if (ta.length === 0 || tb.length === 0) return false;
  const hit = (x: string, ys: string[]) =>
    ys.some((y) => y === x || (x.length >= 4 && y.startsWith(x)) || (y.length >= 4 && x.startsWith(y)));
  const [short, long] = ta.length <= tb.length ? [ta, tb] : [tb, ta];
  return short.every((t) => hit(t, long));
}

const PHOTON_API = "https://photon.komoot.io/api/";
const USER_AGENT = "Wayfare/1.0 (travel app; dish-place verification)";
const CITY_MATCH_KM = 30;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

interface Place { name: string; lat: number; lng: number; why: string }
interface Dish { city: string; country: string; dish: string; blurb: string; places: Place[] }
interface PhotonFeature {
  geometry: { coordinates: [number, number] };
  properties: { name?: string; country?: string };
}
const kmBetween = (aLat: number, aLng: number, bLat: number, bLng: number) => {
  const R = 6371, d = Math.PI / 180;
  const s =
    Math.sin(((bLat - aLat) * d) / 2) ** 2 +
    Math.cos(aLat * d) * Math.cos(bLat * d) * Math.sin(((bLng - aLng) * d) / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
};

async function verify(name: string, city: string, centre: { lat: number; lng: number }) {
  const url = new URL(PHOTON_API);
  url.searchParams.set("q", `${name}, ${city}, Germany`);
  url.searchParams.set("limit", "6");
  url.searchParams.set("lang", "en");
  const data = await fetchJson<{ features?: PhotonFeature[] }>(url, {
    timeoutMs: 8000, userAgent: USER_AGENT, service: "photon",
  });
  for (const f of data.features ?? []) {
    const p = f.properties;
    if (normKey(p.country ?? "") !== "germany") continue;
    const featName = p.name ?? "";
    if (normKey(featName).length < 3 || normKey(name).length < 3) continue;
    if (!nameMatches(name, featName)) continue;
    const [lng, lat] = f.geometry.coordinates;
    if (typeof lat !== "number" || typeof lng !== "number") continue;
    if (kmBetween(lat, lng, centre.lat, centre.lng) <= CITY_MATCH_KM) return { lat, lng };
  }
  return null;
}

const dishes = JSON.parse(
  readFileSync(new URL("./data/signature-dishes-germany.draft.json", import.meta.url), "utf8"),
) as Dish[];

const centres = new Map<string, { lat: number; lng: number }>();
for (const d of dishes) {
  if (centres.has(d.city)) continue;
  const geo = await geocodeCityInCountry(d.city, "Germany");
  if (!geo) { console.error(`city centre missing for ${d.city}`); process.exit(1); }
  centres.set(d.city, { lat: geo.lat, lng: geo.lng });
  console.log(`centre ${d.city}: ${geo.lat.toFixed(4)},${geo.lng.toFixed(4)}`);
  await sleep(1000);
}

const out: Dish[] = [];
for (const d of dishes) {
  const centre = centres.get(d.city)!;
  const places: Place[] = [];
  for (const p of d.places) {
    const started = Date.now();
    try {
      const hit = await verify(p.name, d.city, centre);
      if (hit) {
        places.push({ name: p.name, lat: Number(hit.lat.toFixed(5)), lng: Number(hit.lng.toFixed(5)), why: p.why });
        console.log(`OK   ${d.city} / ${p.name} → ${hit.lat.toFixed(5)},${hit.lng.toFixed(5)}`);
      } else {
        console.log(`DROP ${d.city} / ${p.name}, unverified`);
      }
    } catch (e) {
      console.log(`ERR  ${d.city} / ${p.name}, ${e instanceof Error ? e.message : e}`);
    }
    const elapsed = Date.now() - started;
    if (elapsed < 1000) await sleep(1000 - elapsed);
  }
  if (places.length > 0) out.push({ ...d, places });
  else console.log(`DROP DISH ${d.city} / ${d.dish}, no verified places`);
}

writeFileSync(
  new URL("./data/signature-dishes-germany.json", import.meta.url),
  JSON.stringify(out, null, 2) + "\n",
);
console.log(`\nwrote ${out.length} dishes, ${out.reduce((s, d) => s + d.places.length, 0)} places`);
process.exit(0);
