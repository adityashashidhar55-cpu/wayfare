/**
 * redescribe-rich.ts (r21-desc) - regenerate explore_places descriptions with
 * the richer r21 composeDescription() templates, but ONLY for rows that are
 * still machine-composed AND belong to one of the two upgraded classes:
 *
 *   1. historic/cultural - category historic/museum/landmark or a tag match
 *      (temple, church, mosque, shrine, cathedral, chapel, gurudwara,
 *      synagogue, monastery, pagoda, memorial, ruins, fort, palace, castle,
 *      monument, museum, landmark, architecture, historic, heritage)
 *   2. iconic restaurants - famousEatery=1 (any category; the composer only
 *      applies eatery phrasing to food/cafe rows)
 *
 * For famous eateries a signature dish name is joined in when one exists
 * (signature_dish_places.placeId -> signature_dishes.dish), feeding the
 * "best known for its <dish>" sentence.
 *
 * curated / dbpedia / user descriptions are never touched: the WHERE clause
 * pins descriptionSource='composed' and every UPDATE repeats that predicate.
 * Idempotent: rows whose regenerated text equals the current description are
 * skipped, so a second run updates 0 rows.
 *
 * Run:  npx tsx db/redescribe-rich.ts
 */
import { sql } from "drizzle-orm";
import { getDb } from "../api/queries/connection";
import { composeDescription } from "../api/lib/place-story";

const HISTORIC_TAGS = [
  "historic",
  "heritage",
  "temple",
  "church",
  "mosque",
  "shrine",
  "cathedral",
  "chapel",
  "gurudwara",
  "gurdwara",
  "synagogue",
  "monastery",
  "pagoda",
  "memorial",
  "ruins",
  "fort",
  "palace",
  "castle",
  "monument",
  "museum",
  "landmark",
  "architecture",
  "worship",
];

const HISTORIC_WHERE = [
  `category IN ('historic','museum','landmark')`,
  ...HISTORIC_TAGS.map((t) => `tags LIKE '%"${t}"%'`),
].join(" OR ");

function quote(s: string): string {
  return `'${s.replace(/\\/g, "\\\\").replace(/'/g, "''")}'`;
}

function parseTags(raw: unknown): string[] | null {
  if (Array.isArray(raw)) return raw as string[];
  if (typeof raw === "string") {
    try {
      const v = JSON.parse(raw);
      return Array.isArray(v) ? v : null;
    } catch {
      return null;
    }
  }
  return null;
}

async function main() {
  const db = getDb();
  const q = async (s: string) =>
    ((await db.execute(sql.raw(s)))[0] as unknown as Array<Record<string, unknown>>);

  // Signature dish per famous eatery (first dish by dish/place position wins).
  const dishRows = await q(
    `SELECT sp.placeId AS placeId, d.dish AS dish
     FROM signature_dish_places sp
     JOIN signature_dishes d ON d.id = sp.dishId
     WHERE sp.placeId IS NOT NULL
     ORDER BY sp.placeId, d.position, sp.position`,
  );
  const dishByPlace = new Map<number, string>();
  for (const r of dishRows) {
    const pid = Number(r.placeId);
    if (!dishByPlace.has(pid)) dishByPlace.set(pid, String(r.dish));
  }
  console.log(`[redescribe] signature dishes linked: ${dishByPlace.size} places`);

  const rows = await q(
    `SELECT id, name, category, city, country, tags, verdict, famousEatery, feeCents, feeCurrency, description
     FROM explore_places
     WHERE descriptionSource = 'composed'
       AND (famousEatery = 1 OR ${HISTORIC_WHERE})`,
  );
  console.log(`[redescribe] candidate rows: ${rows.length}`);

  let historicUpdated = 0;
  let eateryUpdated = 0;
  let unchanged = 0;
  let dishUsed = 0;
  type Pending = { id: number; text: string; cls: "historic" | "eatery"; dish: boolean };
  const pending: Pending[] = [];

  for (const r of rows) {
    const isEatery = r.famousEatery === 1 || r.famousEatery === true;
    const id = Number(r.id);
    const dish = isEatery ? (dishByPlace.get(id) ?? null) : null;
    const next = composeDescription({
      name: String(r.name),
      category: String(r.category ?? "activity"),
      city: String(r.city ?? ""),
      country: String(r.country ?? ""),
      tags: parseTags(r.tags),
      verdict: (r.verdict as string | null) ?? null,
      famousEatery: isEatery,
      feeCents: r.feeCents == null ? null : Number(r.feeCents),
      feeCurrency: (r.feeCurrency as string | null) ?? null,
      signatureDish: dish,
    });
    if (next === String(r.description ?? "")) {
      unchanged++;
      continue;
    }
    pending.push({ id, text: next, cls: isEatery ? "eatery" : "historic", dish: dish != null });
  }

  console.log(
    `[redescribe] ${pending.length} rows need a rewrite (${unchanged} already current); applying in batches…`,
  );
  // Batched CASE updates: one round-trip per CHUNK rows (per-row UPDATEs are
  // far too slow against the remote MySQL at corpus scale).
  const CHUNK = 400;
  for (let i = 0; i < pending.length; i += CHUNK) {
    const batch = pending.slice(i, i + CHUNK);
    const whens = batch.map((b) => `WHEN ${b.id} THEN ${quote(b.text)}`).join(" ");
    const ids = batch.map((b) => b.id).join(",");
    await db.execute(
      sql.raw(
        `UPDATE explore_places SET description = CASE id ${whens} END ` +
          `WHERE id IN (${ids}) AND descriptionSource = 'composed'`,
      ),
    );
    for (const b of batch) {
      if (b.cls === "eatery") eateryUpdated++;
      else historicUpdated++;
      if (b.dish) dishUsed++;
    }
    console.log(`[redescribe] ${Math.min(i + CHUNK, pending.length)}/${pending.length} updated…`);
  }

  console.log(
    `[redescribe] done: ${historicUpdated} historic/cultural + ${eateryUpdated} famous-eatery rows updated ` +
      `(${dishUsed} with a signature dish), ${unchanged} unchanged, ${rows.length} scanned.`,
  );
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
