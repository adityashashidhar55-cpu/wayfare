/**
 * r17-portal verification script.
 * Run: npx tsx scripts/verify-portal.mts
 *
 *   A) Login gate: wrong pathSecret → NOT_FOUND; wrong password → UNAUTHORIZED
 *      "Invalid credentials"; 5 failures → lockout (even correct creds refused).
 *   B) Session cookie: login sets wf_portal; portal.session flips to ok:true
 *      with the cookie; portalProcedure rejects without it (FORBIDDEN).
 *   C) Places: portal.places.create → update → search → delete (temp row).
 *   D) Images: images.set writes image + photoSource='manual' + attribution;
 *      images.remove clears image/photoSource/photoAttribution (redaction);
 *      images.suggest returns a candidate shape without writing.
 *   E) Dishes: dishes.cities → list → updateDish (blurb) → updateDishPlace
 *      (why) - originals restored afterwards.
 *   F) The /portal route is not referenced by any nav/shell component.
 *
 * The temp place is deleted and dish edits are restored at the end.
 */
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { appRouter } from "../api/router";
import { resetPortalRateLimits } from "../api/portal-router";
import type { TrpcContext } from "../api/context";

let failures = 0;
function check(label: string, ok: boolean, detail = "") {
  console.log(`${ok ? "✓" : "✗ FAIL"} ${label}${detail ? `, ${detail}` : ""}`);
  if (!ok) failures++;
}

const PATH_SECRET = process.env.PORTAL_PATH_SECRET ?? "";
const PORTAL_ID = process.env.PORTAL_ID ?? "";
const PASSWORD = process.env.PORTAL_PASSWORD ?? "";
if (!PATH_SECRET || !PORTAL_ID || !PASSWORD || !process.env.PORTAL_SESSION_SECRET) {
  console.error("PORTAL_* env vars must be set (.env), refusing to run against a fail-closed portal");
  process.exit(1);
}

const ctxFor = (headers: Record<string, string> = {}): TrpcContext => ({
  req: new Request("http://verify.local/api/trpc", { headers }),
  resHeaders: new Headers(),
});
const ipCtx = (ip: string) => ctxFor({ "x-forwarded-for": ip });

const good = { pathSecret: PATH_SECRET, portalId: PORTAL_ID, password: PASSWORD };

let tempPlaceId: number | null = null;
// dish originals for restore
let dishOrig: { id: number; blurb: string | null } | null = null;
let dishPlaceOrig: { id: number; why: string | null } | null = null;
let cookie = "";

try {
  // ══ A) login gate ════════════════════════════════════════════════════════
  console.log("\nA) login gate, path secret, credentials, lockout");
  resetPortalRateLimits();

  let wrongPath: { code?: string } | null = null;
  try {
    await appRouter.createCaller(ipCtx("172.16.0.1")).portal.login({ ...good, pathSecret: "wrong-path" });
  } catch (e) {
    wrongPath = e as { code?: string };
  }
  check("wrong pathSecret → NOT_FOUND (portal hidden)", wrongPath?.code === "NOT_FOUND", String(wrongPath?.code));

  let wrongPw: { code?: string; message?: string } | null = null;
  try {
    await appRouter.createCaller(ipCtx("172.16.0.2")).portal.login({ ...good, password: "wrong" });
  } catch (e) {
    wrongPw = e as { code?: string; message?: string };
  }
  check(
    "wrong password → generic UNAUTHORIZED 'Invalid credentials'",
    wrongPw?.code === "UNAUTHORIZED" && wrongPw?.message === "Invalid credentials",
    `${wrongPw?.code} ${wrongPw?.message}`,
  );

  const lockIp = "172.16.0.3";
  for (let i = 0; i < 5; i++) {
    await appRouter
      .createCaller(ipCtx(lockIp))
      .portal.login({ ...good, password: `bad-${i}` })
      .catch(() => {});
  }
  let locked: { code?: string; message?: string } | null = null;
  try {
    await appRouter.createCaller(ipCtx(lockIp)).portal.login(good); // correct creds, still refused
  } catch (e) {
    locked = e as { code?: string; message?: string };
  }
  check(
    "5 failures → lockout refuses even correct credentials",
    locked?.code === "UNAUTHORIZED" && locked?.message === "Too many attempts, try again later",
    `${locked?.code} ${locked?.message}`,
  );

  // ══ B) session cookie ════════════════════════════════════════════════════
  console.log("\nB) wf_portal session cookie");
  const loginCtx = ipCtx("172.16.0.10");
  const login = await appRouter.createCaller(loginCtx).portal.login(good);
  check("login returns ok + token", login.ok === true && login.token.length > 20);
  const setCookie = loginCtx.resHeaders.get("set-cookie") ?? "";
  check(
    "Set-Cookie: wf_portal, httpOnly, SameSite=Lax",
    setCookie.includes("wf_portal=") && /httponly/i.test(setCookie) && /samesite=lax/i.test(setCookie),
    setCookie.split(";").slice(0, 3).join(";"),
  );
  cookie = `wf_portal=${login.token}`;

  const anonCaller = appRouter.createCaller(ipCtx("172.16.0.11"));
  const anonSession = await anonCaller.portal.session();
  check("portal.session without cookie → { ok: false }", anonSession.ok === false);

  const authed = () => appRouter.createCaller(ctxFor({ cookie }));
  const authedSession = await authed().portal.session();
  check("portal.session with cookie → { ok: true }", authedSession.ok === true);

  let forbidden: { code?: string } | null = null;
  try {
    await anonCaller.portal.stats();
  } catch (e) {
    forbidden = e as { code?: string };
  }
  check("portalProcedure rejects without cookie (FORBIDDEN)", forbidden?.code === "FORBIDDEN", String(forbidden?.code));

  const stats = await authed().portal.stats();
  check(
    "portal.stats returns the six totals",
    ["places", "placesWithImage", "famousEateries", "signatureDishes", "countries", "cities"].every(
      (k) => typeof (stats as Record<string, unknown>)[k] === "number",
    ),
    JSON.stringify(stats),
  );

  // ══ C) places CRUD ═══════════════════════════════════════════════════════
  console.log("\nC) portal.places CRUD");
  const created = await authed().portal.places.create({
    name: "Verify Portal Temp Place",
    category: "landmark",
    city: "Verifyville",
    country: "Verifyland",
    lat: 12.34,
    lng: 56.78,
    rating: 4.2,
  });
  tempPlaceId = created.id;
  check("places.create inserts a curated row", created.source === "curated" && created.name === "Verify Portal Temp Place");

  const updated = await authed().portal.places.update({ id: created.id, patch: { rating: 4.9, verdict: "worth-it" } });
  check("places.update patches rating + verdict", updated.rating === 4.9 && updated.verdict === "worth-it");

  const found = await authed().portal.places.search({ q: "Verify Portal Temp Place" });
  check("places.search finds the temp row", found.places.some((p) => p.id === created.id));

  // ══ D) images ════════════════════════════════════════════════════════════
  console.log("\nD) portal.images set / suggest / remove");
  const withImage = await authed().portal.images.set({
    placeId: created.id,
    url: "https://commons.wikimedia.org/wiki/Special:FilePath/Verify_Test.jpg?width=800",
    attribution: "Verify Attribution",
  });
  check(
    "images.set writes image + photoSource='manual' + attribution",
    withImage.image?.includes("Verify_Test.jpg") &&
      withImage.photoSource === "manual" &&
      withImage.photoAttribution === "Verify Attribution",
    `photoSource=${withImage.photoSource}`,
  );

  const suggestion = await authed().portal.images.suggest({ placeId: created.id });
  check(
    "images.suggest returns the place + candidate-or-null WITHOUT writing",
    suggestion.place.id === created.id &&
      (suggestion.candidate === null ||
        (typeof suggestion.candidate.image === "string" && suggestion.candidate.image.startsWith("http"))),
    suggestion.candidate ? `candidate: ${suggestion.candidate.title}` : "no candidate (network/Wikipedia blocked), ok",
  );
  const afterSuggest = await authed().portal.places.get({ id: created.id });
  check("suggest did not overwrite the manual image", afterSuggest.photoSource === "manual");

  const cleared = await authed().portal.images.remove({ placeId: created.id });
  check(
    "images.remove redacts image + photoSource + photoAttribution",
    cleared.image === null && cleared.photoSource === null && cleared.photoAttribution === null,
    `image=${cleared.image} source=${cleared.photoSource} attr=${cleared.photoAttribution}`,
  );

  // ══ E) dishes ════════════════════════════════════════════════════════════
  console.log("\nE) portal.dishes update flow");
  const cities = await authed().portal.dishes.cities();
  check("dishes.cities lists cities with signature dishes", cities.length > 0, `${cities.length} cities`);
  if (cities.length) {
    const first = cities[0]!;
    const dishes = await authed().portal.dishes.list({ city: first.city, country: first.country });
    check("dishes.list returns dishes with their places", dishes.length > 0 && Array.isArray(dishes[0]!.places));

    const dish = dishes[0]!;
    dishOrig = { id: dish.id, blurb: dish.blurb };
    const stamp = `portal-verify ${Date.now()}`;
    const updatedDish = await authed().portal.dishes.updateDish({ id: dish.id, blurb: stamp });
    check("dishes.updateDish writes the blurb", updatedDish.blurb === stamp);

    const place = dish.places[0];
    if (place) {
      dishPlaceOrig = { id: place.id, why: place.why };
      const updatedPlace = await authed().portal.dishes.updateDishPlace({ id: place.id, why: stamp });
      check("dishes.updateDishPlace writes the why", updatedPlace.why === stamp);
    } else {
      check("dishes.updateDishPlace writes the why", true, "no dish-places in first dish, skipped");
    }
  }

  // ══ F) route not linked ══════════════════════════════════════════════════
  console.log("\nF) /portal stays unlinked");
  const offenders: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (/\.(tsx|ts|jsx|js)$/.test(entry.name)) {
        const text = readFileSync(full, "utf8");
        if (/["'`]\/portal/.test(text) && !/OwnerPortal\.tsx$|App\.tsx$/.test(full)) offenders.push(full);
      }
    }
  };
  walk(path.resolve(import.meta.dirname, "..", "src", "components"));
  walk(path.resolve(import.meta.dirname, "..", "src", "pages"));
  check("no nav/shell/footer component references /portal", offenders.length === 0, offenders.join(", "));
} finally {
  // ── cleanup ──────────────────────────────────────────────────────────────
  console.log("\nCleanup");
  const authed = () => appRouter.createCaller(ctxFor({ cookie }));
  try {
    if (dishPlaceOrig) {
      await authed().portal.dishes.updateDishPlace({ id: dishPlaceOrig.id, why: dishPlaceOrig.why });
      console.log("  dish-place why restored");
    }
    if (dishOrig) {
      await authed().portal.dishes.updateDish({ id: dishOrig.id, blurb: dishOrig.blurb });
      console.log("  dish blurb restored");
    }
    if (tempPlaceId != null) {
      await authed().portal.places.delete({ id: tempPlaceId });
      console.log("  temp place deleted");
    }
  } catch (e) {
    console.error("  cleanup error:", e instanceof Error ? e.message : e);
    failures++;
  }
  resetPortalRateLimits();
}

console.log(failures ? `\n${failures} check(s) FAILED` : "\nAll r17-portal checks passed ✓");
process.exit(failures ? 1 : 0);
