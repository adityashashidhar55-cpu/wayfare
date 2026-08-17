import { existsSync, readFileSync } from "fs";
import { getDb } from "../api/queries/connection";
import * as schema from "./schema";

type ResearchPlace = {
  name: string;
  city: string;
  country: string;
  lat: number;
  lng: number;
  category: string;
  tags: string[];
  styles: string[];
  rating: number;
  priceLevel: number;
  feeCents: number | null;
  feeCurrency: string;
  feeNote: string | null;
  description: string;
  hidden: boolean;
};

const CITY_COVERS: Record<string, string> = {
  Kyoto: "/hero-kyoto.jpg",
  Osaka: "/explore-street.jpg",
  Nara: "/place-temple.jpg",
  Lisbon: "/cover-lisbon.jpg",
  Positano: "/cover-amalfi.jpg",
  Marrakech: "/cover-marrakech.jpg",
  "El Chaltén": "/cover-patagonia.jpg",
  Reykjavik: "/cover-reykjavik.jpg",
  Vík: "/cover-reykjavik.jpg",
  Copenhagen: "/cover-copenhagen.jpg",
  Oaxaca: "/cover-oaxaca.jpg",
};

function imageFor(p: ResearchPlace): string {
  const t = (p.tags ?? []).join(" ").toLowerCase();
  const d = (p.description ?? "").toLowerCase();
  const hay = `${t} ${d} ${p.name.toLowerCase()}`;
  if (/temple|shrine|church|cathedral|mosque|monastery|palace|castle|pagoda|wat /.test(hay)) return "/place-temple.jpg";
  if (/museum|gallery|art|exhibit/.test(hay)) return "/place-museum.jpg";
  if (/hike|trail|nature|park|garden|viewpoint|beach|waterfall|mountain|volcano|lake|river|falls|peak|coast/.test(hay)) return "/place-hike.jpg";
  if (/onsen|onsen|hot spring|spa|geothermal|lagoon/.test(hay)) return "/place-onsen.jpg";
  if (/market|street food|food hall|bazaar|souk/.test(hay)) return "/place-market.jpg";
  if (/coffee|café|cafe|bakery|tea/.test(hay)) return "/place-cafe.jpg";
  if (/bar|nightlife|rooftop|wine|mezcal|cocktail|beer|izakaya/.test(hay)) return "/place-bar.jpg";
  if (p.category === "food") return "/place-ramen.jpg";
  if (p.category === "shopping") return "/place-market.jpg";
  return CITY_COVERS[p.city] ?? "/place-hike.jpg";
}

async function main() {
  const db = getDb();
  const existingRows = await db.select().from(schema.explorePlaces);
  const existingNames = new Set(existingRows.map((r) => r.name));

  const files = [
    "places-europe",
    "places-east-asia",
    "places-seasia",
    "places-americas",
    "places-mena",
    "places-oceania-sasia",
    "places-europe-seasia2",
    "places-topup",
  ];
  let inserted = 0;
  for (const f of files) {
    const path = `/mnt/agents/output/research/${f}.json`;
    if (!existsSync(path)) {
      console.log(`[seed-research] skipping missing file: ${f}.json`);
      continue;
    }
    const places = JSON.parse(readFileSync(path, "utf8")) as ResearchPlace[];
    for (const p of places) {
      if (existingNames.has(p.name)) continue;
      await db.insert(schema.explorePlaces).values({
        name: p.name,
        city: p.city,
        country: p.country,
        lat: p.lat,
        lng: p.lng,
        category: p.category,
        tags: p.tags,
        styles: p.styles,
        rating: p.rating,
        priceLevel: p.priceLevel,
        feeCents: p.feeCents,
        feeCurrency: p.feeCurrency,
        feeNote: p.feeNote,
        image: imageFor(p),
        description: p.description,
        hidden: p.hidden,
      });
      inserted++;
    }
  }
  console.log(`[seed-research] inserted ${inserted} places (total now ${existingNames.size + inserted})`);
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
