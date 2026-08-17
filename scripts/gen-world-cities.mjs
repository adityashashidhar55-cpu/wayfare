/**
 * One-off generator for api/lib/world-cities.ts.
 *
 * Sources (GeoNames, CC-BY 4.0 - https://www.geonames.org):
 *   - https://download.geonames.org/export/dump/cities15000.zip  (all cities pop ≥ 15 000)
 *   - https://download.geonames.org/export/dump/countryInfo.txt  (country → capital, continent)
 *
 * Run:  node scripts/gen-world-cities.mjs
 * It downloads both dumps into /tmp (reuses them if present) and rewrites
 * api/lib/world-cities.ts with every country/territory that has a capital:
 * capital first, then the remaining top cities by population, capped at 25.
 */
import { execSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";

const CITIES_TXT = "/tmp/cities15000.txt";
const COUNTRY_TXT = "/tmp/countryInfo.txt";

if (!existsSync(CITIES_TXT)) {
  execSync(
    `cd /tmp && curl -s --max-time 120 -o cities15000.zip https://download.geonames.org/export/dump/cities15000.zip && unzip -o -q cities15000.zip`,
    { stdio: "inherit" },
  );
}
if (!existsSync(COUNTRY_TXT)) {
  execSync(
    `curl -s --max-time 60 -o ${COUNTRY_TXT} https://download.geonames.org/export/dump/countryInfo.txt`,
    { stdio: "inherit" },
  );
}

const REGION_BY_CONTINENT = {
  AF: "Africa",
  AS: "Asia",
  EU: "Europe",
  NA: "North America",
  SA: "South America",
  OC: "Oceania",
};

// ── countries ────────────────────────────────────────────────────────────────
/** @type {Map<string, {code:string,name:string,capital:string,region:string}>} */
const countries = new Map();
for (const line of readFileSync(COUNTRY_TXT, "utf8").split("\n")) {
  if (!line || line.startsWith("#")) continue;
  const c = line.split("\t");
  const [code, , , , name, capital, , , continent] = c;
  const region = REGION_BY_CONTINENT[continent];
  if (!code || !name || !region) continue; // drops Antarctica + malformed rows
  if (!capital) continue; // no capital → not a self-governing territory we list
  countries.set(code, { code, name, capital, region });
}

// ── cities (pop ≥ 15 000) ────────────────────────────────────────────────────
/** @type {Map<string, Array<{name:string,pop:number,lat:number,lng:number}>>} */
const byCountry = new Map();
for (const line of readFileSync(CITIES_TXT, "utf8").split("\n")) {
  if (!line) continue;
  const c = line.split("\t");
  const name = c[1];
  const lat = Number(c[4]);
  const lng = Number(c[5]);
  const code = c[8];
  const pop = Number(c[14]) || 0;
  if (!name || !code || !countries.has(code)) continue;
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;
  const list = byCountry.get(code) ?? [];
  list.push({ name, pop, lat, lng });
  byCountry.set(code, list);
}

const norm = (s) => s.trim().replace(/\s+/g, " ").toLowerCase();

const out = [];
for (const country of [...countries.values()].sort((a, b) =>
  a.region === b.region ? a.name.localeCompare(b.name) : a.region.localeCompare(b.region),
)) {
  const ranked = (byCountry.get(country.code) ?? []).sort((a, b) => b.pop - a.pop);
  const seen = new Set();
  const cities = [];
  const push = (entry) => {
    const key = norm(entry.name);
    if (seen.has(key) || cities.length >= 25) return;
    seen.add(key);
    cities.push(entry);
  };
  // capital first - find it in the ranked list for coords/pop, else bare name
  const cap = ranked.find((c) => norm(c.name) === norm(country.capital));
  push(cap ?? { name: country.capital, pop: 0, lat: null, lng: null });
  for (const c of ranked) push(c);
  out.push({ ...country, cities });
}

const totalCities = out.reduce((n, c) => n + c.cities.length, 0);
console.log(`countries: ${out.length}, cities listed: ${totalCities}`);

const header = `/**
 * World city directory - every country/territory with a capital, each listing
 * its capital plus its top cities by population (max 25), grouped by region.
 *
 * GENERATED FILE - do not hand-edit the data table below.
 * Regenerate with:  node scripts/gen-world-cities.mjs
 * Data: GeoNames cities15000 + countryInfo dumps (CC-BY 4.0, geonames.org),
 * embedded at build time so the API never fetches this at runtime.
 */

export interface WorldCity {
  name: string;
  /** population from GeoNames (0 when unknown - e.g. a capital under 15 000) */
  pop: number;
  lat: number | null;
  lng: number | null;
}

export interface WorldCountry {
  /** ISO 3166-1 alpha-2 */
  code: string;
  name: string;
  region: string;
  capital: string;
  /** capital first, then top cities by population - max 25 */
  cities: WorldCity[];
}

export const WORLD_REGIONS = [
  "Africa",
  "Asia",
  "Europe",
  "North America",
  "South America",
  "Oceania",
] as const;

export const WORLD_COUNTRIES: WorldCountry[] = `;

// one compact line per country keeps the generated file reviewable (~250 lines)
const lines = out.map(
  (c) =>
    `  { code: ${JSON.stringify(c.code)}, name: ${JSON.stringify(c.name)}, region: ${JSON.stringify(c.region)}, capital: ${JSON.stringify(c.capital)}, cities: ${JSON.stringify(c.cities)} },`,
);

writeFileSync(
  new URL("../api/lib/world-cities.ts", import.meta.url),
  `${header}[\n${lines.join("\n")}\n];\n`,
  "utf8",
);
console.log("wrote api/lib/world-cities.ts");
