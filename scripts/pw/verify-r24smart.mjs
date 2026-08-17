/**
 * verify-r24smart.mjs - Playwright pass for Wave 3 (r24-smart) against the
 * production build on :3100. Proves: premium gate blocks free / allows
 * premium, weather advisory on a near-term trip, bell notification, travel
 * mode check-in suggestions, wishlist add + best-time card, token earn +
 * redeem. Screenshots to /mnt/agents/output/r24smart-screenshots/.
 */
import { chromium } from '/home/kimi/.npm-global/lib/node_modules/playwright/index.mjs';
import { mkdirSync } from 'node:fs';

const BASE = 'http://localhost:3100';
const SHOT = '/mnt/agents/output/r24smart-screenshots';
mkdirSync(SHOT, { recursive: true });

const browser = await chromium.launch();
const mk = (w = 1440, h = 900) => browser.newContext({ viewport: { width: w, height: h } });
const results = [];
const ok = (name, cond, extra = '') => {
  results.push(`${cond ? 'PASS' : 'FAIL'} ${name} ${extra}`);
  console.log(results[results.length - 1]);
};

async function login(ctx, email, pass) {
  const page = await ctx.newPage();
  page.on('pageerror', e => console.log(`[pageerror ${email}]`, String(e).slice(0, 160)));
  await page.goto(`${BASE}/login`);
  await page.locator('input[type=email]').fill(email);
  await page.locator('input[type=password]').fill(pass);
  await page.locator('button[type=submit]').click();
  await page.waitForURL(u => !u.pathname.includes('/login'), { timeout: 15000 });
  return page;
}

/** tRPC call from inside the authed page (superjson batch format). */
async function call(page, proc, input, isQuery = false) {
  return page.evaluate(async ({ proc, input, isQuery }) => {
    const enc = encodeURIComponent(JSON.stringify({ 0: { json: input ?? null } }));
    const url = `/api/trpc/${proc}?batch=1${isQuery ? `&input=${enc}` : ''}`;
    const res = await fetch(url, {
      method: isQuery ? 'GET' : 'POST',
      headers: { 'content-type': 'application/json' },
      body: isQuery ? undefined : JSON.stringify({ 0: { json: input ?? null } }),
    });
    const j = await res.json();
    const r = j[0];
    if (r?.error) return { error: r.error.json?.message ?? r.error.message ?? 'error', code: r.error.json?.data?.code };
    return { data: r?.result?.data?.json };
  }, { proc, input, isQuery });
}

const iso = d => d.toISOString().slice(0, 10);
const today = new Date();
const in3 = new Date(Date.now() + 3 * 86400000);
const in6 = new Date(Date.now() + 6 * 86400000);

// ── 1. free user: gate blocks premium ──────────────────────────────────────
const ctxFree = await mk();
const free = await login(ctxFree, 'friend2@example.com', 'testpass1234');
// reruns accumulate trips and the free tier caps at 3 active ones, so create
// fixtures as Voyager (mock checkout seam), then downgrade for gate tests.
await call(free, 'billing.checkout', { interval: 'monthly' });

// near-term trip (Dubai: 40C+ inside the 16-day horizon) + in-progress trip
const tripA = await call(free, 'trips.create', {
  title: 'Dubai heat check', destination: 'Dubai, UAE',
  startDate: iso(in3), endDate: iso(in6),
});
ok('trip A created (near-term)', !!tripA.data?.id, JSON.stringify(tripA).slice(0, 120));
const tripAId = tripA.data?.id;

const tripB = await call(free, 'trips.create', {
  title: 'Paris today', destination: 'Paris, France',
  startDate: iso(new Date(Date.now() - 86400000)), endDate: iso(new Date(Date.now() + 86400000)),
});
const tripBId = tripB.data?.id;
ok('trip B created (in progress)', !!tripBId);

// stops on both trips (outdoor activities, geocoded Paris coords)
for (const [tid, names] of [
  [tripAId, ['Dubai Mall promenade', 'Marina walk', 'Old Dubai souk']],
  [tripBId, ['Rue Cler stroll', 'Musee d Orsay', 'Jardin du Luxembourg']],
]) {
  const det = await call(free, 'trips.get', { id: tid }, true);
  const days = det.data?.days ?? [];
  for (let i = 0; i < names.length; i++) {
    const dayId = days[Math.min(i, days.length - 1)]?.id ?? null;
    const r = await call(free, 'trips.addStop', {
      tripId: tid, dayId, name: names[i], category: 'activity',
      lat: (tid === tripAId ? 25.2 : 48.8566) + i * 0.008, lng: (tid === tripAId ? 55.3 : 2.3522) + i * 0.007,
      startTime: `${10 + i * 2}:00`, durationMin: 60,
    });
    if (r.error) ok(`addStop ${names[i]}`, false, r.error);
  }
}
ok('stops added to both trips', true);

// downgrade to free for the gate proofs
const cancelRes = await call(free, 'billing.cancel', {});
ok('downgraded to free for gate tests', cancelRes.data?.tier === 'wanderer', JSON.stringify(cancelRes).slice(0, 100));
const meFree = await call(free, 'users.me', undefined, true);
ok('users.me reports free', meFree.data?.isPremium === false);

// premium gates refuse free users (server-side truth)
const gateForecast = await call(free, 'weather.tripForecast', { tripId: tripAId }, true);
ok('free blocked from weather.tripForecast', gateForecast.code === 'FORBIDDEN' || /UPGRADE/.test(gateForecast.error ?? ''), JSON.stringify(gateForecast).slice(0, 100));
const gateEmbed = await call(free, 'maps.embed', { stops: [{ name: 'Louvre', lat: 48.86, lng: 2.33 }] });
ok('free blocked from maps.embed', gateEmbed.code === 'FORBIDDEN' || /UPGRADE/.test(gateEmbed.error ?? ''));
const gateBest = await call(free, 'wishlist.bestTime', { destination: 'Kyoto, Japan' }, true);
ok('free blocked from wishlist.bestTime', gateBest.code === 'FORBIDDEN' || /UPGRADE/.test(gateBest.error ?? ''));

// free workspace: no weather advisory banner, maps menu shows crown
await free.goto(`${BASE}/trips/${tripAId}`);
await free.waitForTimeout(2500);
ok('free: no weather advisory banner', (await free.locator('[data-testid=weather-advisory-banner]').count()) === 0);
await free.screenshot({ path: `${SHOT}/01-free-workspace-no-advisory-1440.png` });

// free wishlist: add works, best-time locked
await free.goto(`${BASE}/wishlist`);
await free.locator('input[aria-label="Wishlist title"]').fill('Cherry blossom week');
await free.locator('input[aria-label="Wishlist destination"]').fill('Kyoto, Japan');
await free.getByRole('button', { name: /^add$/i }).click();
await free.waitForTimeout(1500);
ok('free: wishlist add works', (await free.locator('text=Cherry blossom week').count()) >= 1);
ok('free: best-time locked with Upgrade', (await free.locator('text=Best-time advisor is a Voyager feature').count()) >= 1);
await free.screenshot({ path: `${SHOT}/02-free-wishlist-locked-besttime-1440.png`, fullPage: true });

// ── 2. grant Voyager via the mock checkout seam ────────────────────────────
const checkout = await call(free, 'billing.checkout', { interval: 'monthly' });
ok('billing.checkout grants Voyager', checkout.data?.tier === 'voyager', JSON.stringify(checkout).slice(0, 100));
const me = await call(free, 'users.me', undefined, true);
ok('users.me reports premium', me.data?.isPremium === true, JSON.stringify(me.data?.tier));

// premium procedures now allowed
const forecast = await call(free, 'weather.tripForecast', { tripId: tripAId }, true);
ok('premium: tripForecast allowed + flagged', !forecast.error && (forecast.data?.flagged?.length ?? 0) >= 1, JSON.stringify(forecast.data?.flagged ?? forecast).slice(0, 200));

// ── 3. weather advisory banner + review + apply ────────────────────────────
await free.goto(`${BASE}/trips/${tripAId}`);
await free.waitForTimeout(3500);
const banner = free.locator('[data-testid=weather-advisory-banner]');
// count() does not auto-wait; the forecast query needs a few seconds
await banner.first().waitFor({ timeout: 20000 }).catch(() => {});
const bannerCount = await banner.count();
console.log('banner count =', bannerCount);
ok('premium: weather advisory banner appears', bannerCount >= 1, await banner.first().innerText().catch(() => 'none'));
await free.screenshot({ path: `${SHOT}/03-premium-weather-advisory-1440.png`, fullPage: true });
await banner.getByRole('button', { name: /review/i }).click();
await free.waitForTimeout(800);
await free.screenshot({ path: `${SHOT}/04-weather-review-panel-1440.png` });
// apply "mark flexible" (always present for flagged days)
const applyBtns = free.getByRole('button', { name: /^apply$/i });
const nApply = await applyBtns.count();
ok('review panel lists adaptations', nApply >= 1, `${nApply} apply buttons`);
// click the last Apply (flexible is always last per flagged day)
await applyBtns.nth(nApply - 1).click();
await free.waitForTimeout(1500);
await free.keyboard.press('Escape');

// bell should now carry a weather notification (applyAdaptation posts one)
await free.waitForTimeout(1500);
const unread = free.locator('[data-testid=notif-unread-count]');
const unreadCount = await unread.count();
console.log('unread badge count =', unreadCount);
ok('bell shows unread count', unreadCount >= 1, await unread.first().innerText().catch(() => ''));
await free.getByRole('button', { name: /notifications/i }).click();
await free.waitForTimeout(800);
const bellTxt = await free.locator('body').innerText();
ok('bell lists weather notification', /marked flexible|weather/i.test(bellTxt));
await free.screenshot({ path: `${SHOT}/05-bell-weather-notification-1440.png` });
await free.keyboard.press('Escape');

// ── 4. travel mode check-in (in-progress trip) ─────────────────────────────
await free.goto(`${BASE}/trips/${tripBId}`);
await free.waitForTimeout(3000);
const tmToggle = free.locator('[data-testid=travel-mode-toggle]');
ok('travel mode toggle visible for in-progress trip', (await tmToggle.count()) === 1);
await tmToggle.click();
await free.waitForTimeout(800);
await free.getByRole('radio', { name: 'Low' }).click();
await free.getByRole('button', { name: 'tired' }).click();
await free.waitForTimeout(500);
const sugg = free.locator('[data-testid=checkin-suggestions]');
const suggTxt = await sugg.innerText();
ok('check-in produces suggestions', /rest|cafe|drop|keep the next/i.test(suggTxt), suggTxt.slice(0, 120));
await free.screenshot({ path: `${SHOT}/06-travel-mode-checkin-1440.png` });
await free.getByRole('button', { name: /save check-in/i }).click();
await free.waitForTimeout(1500);
await free.screenshot({ path: `${SHOT}/07-travel-mode-saved-1440.png` });
await free.keyboard.press('Escape');

// ── 5. wishlist best-time card (premium) ───────────────────────────────────
await free.goto(`${BASE}/wishlist`);
await free.waitForTimeout(2500);
const btc = free.locator('[data-testid=best-time-card]');
ok('premium: best-time card shows top months', (await btc.count()) >= 1 && /best time to go/i.test(await btc.first().innerText()), (await btc.first().innerText().catch(() => '')).slice(0, 140));
await free.screenshot({ path: `${SHOT}/08-wishlist-besttime-1440.png`, fullPage: true });

// ── 6. tokens: earn + redeem ───────────────────────────────────────────────
const tok = await call(free, 'tokens.state', undefined, true);
ok('tokens earned (2 trips + wishlist >= 50)', (tok.data?.balance ?? 0) >= 50, `balance=${tok.data?.balance}`);
await free.goto(`${BASE}/rewards`);
await free.waitForTimeout(2000);
const balTxt = await free.locator('[data-testid=rewards-balance]').innerText();
ok('rewards page shows balance', /tokens/.test(balTxt), balTxt);
const pick = tok.data.catalog.find(c => !tok.data.redeemed.some(r => r.rewardId === c.id) && c.cost <= tok.data.balance)
  ?? tok.data.catalog[0];
console.log('redeeming reward:', pick.id, 'cost', pick.cost);
const alreadyOwned = tok.data.redeemed.some(r => r.rewardId === pick.id);
if (!alreadyOwned) await free.locator(`[data-testid=redeem-${pick.id}]`).click();
await free.waitForTimeout(1500);
const afterTxt = await free.locator('[data-testid=rewards-balance]').innerText();
const shelf = await free.locator('body').innerText();
ok('reward redeemed (on shelf)', /On your shelf/.test(shelf), pick.id);
const balAfter = Number(afterTxt.match(/-?\d+/)?.[0] ?? 'NaN');
ok('balance decreased by reward cost', alreadyOwned || balAfter === tok.data.balance - pick.cost, `${tok.data.balance} -> ${balAfter}`);
await free.screenshot({ path: `${SHOT}/09-rewards-redeemed-1440.png`, fullPage: true });

// token chip in header reflects balance
const chip = free.locator('[data-testid=token-balance]');
ok('header token chip visible', (await chip.count()) === 1, await chip.innerText().catch(() => ''));

// ── 7. mobile 390 pass ─────────────────────────────────────────────────────
const ctxM = await mk(390, 844);
const mob = await login(ctxM, 'friend2@example.com', 'testpass1234');
await mob.goto(`${BASE}/trips/${tripAId}`);
await mob.waitForTimeout(3000);
await mob.locator('[data-testid=weather-advisory-banner]').first().waitFor({ timeout: 20000 }).catch(() => {});
const mobBannerCount = await mob.locator('[data-testid=weather-advisory-banner]').count();
console.log('mobile banner count =', mobBannerCount);
ok('mobile: advisory banner present', mobBannerCount >= 1);
ok('mobile: bell + token chip in top bar',
  (await mob.getByRole('button', { name: /notifications/i }).count()) === 1 &&
  (await mob.locator('[data-testid=token-balance]').count()) === 1);
await mob.screenshot({ path: `${SHOT}/10-mobile-workspace-390.png`, fullPage: true });
await mob.goto(`${BASE}/wishlist`);
await mob.waitForTimeout(2000);
await mob.screenshot({ path: `${SHOT}/11-mobile-wishlist-390.png`, fullPage: true });
await mob.goto(`${BASE}/rewards`);
await mob.waitForTimeout(1500);
await mob.screenshot({ path: `${SHOT}/12-mobile-rewards-390.png`, fullPage: true });

await browser.close();
console.log('\n=== SUMMARY ===');
results.forEach(r => console.log(r));
const fails = results.filter(r => r.startsWith('FAIL'));
console.log(fails.length ? `\n${fails.length} FAILURES` : '\nALL PASS');
process.exit(fails.length ? 1 : 0);
