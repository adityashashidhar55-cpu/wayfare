import { chromium } from '/home/kimi/.npm-global/lib/node_modules/playwright/index.mjs';
const BASE = 'http://localhost:3100';
const SHOT = '/mnt/agents/output/r24s-screenshots';
const browser = await chromium.launch();
const mk = (w = 1440, h = 900) => browser.newContext({ viewport: { width: w, height: h } });
const results = [];
const ok = (name, cond, extra = '') => { results.push(`${cond ? 'PASS' : 'FAIL'} ${name} ${extra}`); console.log(results[results.length - 1]); };

async function login(ctx, email, pass) {
  const page = await ctx.newPage();
  page.on('pageerror', e => console.log(`[pageerror ${email}]`, String(e).slice(0, 200)));
  await page.goto(`${BASE}/login`);
  await page.locator('input[type=email]').fill(email);
  await page.locator('input[type=password]').fill(pass);
  await page.locator('button[type=submit]').click();
  await page.waitForURL(u => !u.pathname.includes('/login'), { timeout: 15000 });
  return page;
}

async function fillPlan(page, name, city, daysOut) {
  await page.locator('#fp-name').fill(name);
  await page.locator('#fp-home').click();
  await page.locator('#fp-home').pressSequentially(city, { delay: 35 });
  await page.locator('ul li button', { hasText: city }).first().click();
  const d = new Date(Date.now() + daysOut * 86400000);
  const label = d.toLocaleDateString('en', { weekday: 'long', month: 'long', day: 'numeric', timeZone: 'UTC' });
  await page.getByRole('button', { name: label, exact: true }).first().click();
  await page.waitForFunction(() => {
    const b = [...document.querySelectorAll('button')].find(x => x.textContent.includes('Count me in'));
    return b && !b.disabled;
  }, { timeout: 10000 });
  await page.getByRole('button', { name: /count me in/i }).click();
  await page.waitForTimeout(2000);
}

// ── 1. Friends flow end-to-end, budget, chat round-trip ─────────────────────
const ctxA = await mk();
const admin = await login(ctxA, 'admin@wayfare.app', 'a4nc-jge5-bjhk-4vvb');
await admin.goto(`${BASE}/friends`);
await admin.getByRole('button', { name: /start a planning session/i }).first().click();
await admin.locator('#fs-title').fill('r24s verify session');
await admin.locator('#fs-budget').fill('1500');
await admin.getByRole('button', { name: /create the session/i }).click();
await admin.getByRole('button', { name: /open the session/i }).click();
await admin.waitForLoadState('networkidle');
const ownerToken = admin.url().split('/friends/')[1];
ok('session created with budget', !!ownerToken);
await fillPlan(admin, 'Admin', 'Bengaluru', 16);
// budget chip visible on session view
await admin.waitForTimeout(500);
const budgetTxt = await admin.locator('body').innerText();
ok('budget chip shows', /Budget \$1\.5k|Budget \$1,500/i.test(budgetTxt), budgetTxt.match(/Budget[^\n]*/)?.[0] ?? 'none');

// mint invite via home page (the fixed path) AND session page
await admin.goto(`${BASE}/friends`);
await admin.waitForTimeout(1500);
await admin.screenshot({ path: `${SHOT}/friends-home-1440.png` });
const mintBtns = admin.getByRole('button', { name: /new invite link/i });
ok('home shows mint-invite (not owner link)', await mintBtns.count() >= 1);
await mintBtns.first().click();
await admin.waitForTimeout(1500);
const inviteUrl = await admin.locator('input[value*="/friends/"]').first().inputValue();
ok('invite minted from home', inviteUrl.includes('/friends/') && !inviteUrl.includes(ownerToken), inviteUrl);

// friend2 joins in second context
const ctxF = await mk();
const friend = await login(ctxF, 'friend2@example.com', 'testpass1234');
await friend.goto(inviteUrl);
await friend.waitForTimeout(2000);
await fillPlan(friend, 'Friend Two', 'Mumbai', 16);
await friend.waitForTimeout(2500);
const fTxt = await friend.locator('body').innerText();
ok('friend joined + threshold met', /2 of 2 submitted/.test(fTxt), fTxt.match(/\d of \d submitted/)?.[0]);
await friend.screenshot({ path: `${SHOT}/friends-met-1440.png`, fullPage: true });

// chat round-trip: friend sends, admin receives
await friend.locator('textarea[aria-label="Message the group"]').fill('Coffee when we land?');
await friend.locator('textarea[aria-label="Message the group"]').press('Enter');
await friend.waitForTimeout(1000);
const fTxt2 = await friend.locator('body').innerText();
ok('friend sees own message', fTxt2.includes('Coffee when we land?'));
await admin.goto(`${BASE}/friends/${ownerToken}`);
await admin.waitForTimeout(7000); // first poll tick
const aTxt = await admin.locator('body').innerText();
ok('admin sees friend message (poll)', aTxt.includes('Coffee when we land?'));
await admin.locator('textarea[aria-label="Message the group"]').fill('Yes, 10am at the airport cafe');
await admin.locator('button[aria-label="Send message"]').click();
await admin.waitForTimeout(1000);
await friend.waitForTimeout(6500); // friend poll tick
const fTxt3 = await friend.locator('body').innerText();
ok('friend sees admin reply (round-trip)', fTxt3.includes('airport cafe'));
await friend.screenshot({ path: `${SHOT}/friends-chat-1440.png`, fullPage: true });

// claim-guard: friend2 opens the OWNER's token link
await friend.goto(`${BASE}/friends/${ownerToken}`);
await friend.waitForTimeout(2500);
const claimTxt = await friend.locator('body').innerText();
ok('owner-token link blocked for friend', /already claimed/.test(claimTxt), claimTxt.slice(0, 80).replace(/\n/g, ' | '));
await friend.screenshot({ path: `${SHOT}/friends-claimed-1440.png` });

// admin converts
await admin.reload();
await admin.waitForTimeout(1500);
await admin.getByRole('button', { name: /start planning/i }).first().click();
await admin.waitForURL(u => u.pathname.startsWith('/trips/'), { timeout: 25000 });
const tripUrl = admin.url();
const tripId = Number(tripUrl.split('/trips/')[1]);
ok('converted to trip', tripId > 0, tripUrl);
await admin.waitForTimeout(4000);
// budget carried to trip (TripCostChip shows planned vs budget when costs exist; at least no error)
await friend.goto(tripUrl);
await friend.waitForTimeout(4000);
const fTrip = await friend.locator('body').innerText();
ok('friend opens shared trip', /Itinerary/.test(fTrip) && fTrip.includes('r24s verify session'));
await friend.screenshot({ path: `${SHOT}/friend-trip-1440.png` });

// ── 2. Publish flow ──────────────────────────────────────────────────────────
async function trpcCall(page, path, input) {
  return page.evaluate(async ([path, input]) => {
    const r = await fetch(`/api/trpc/${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ json: input }),
    });
    const t = await r.text();
    try { return { status: r.status, body: JSON.parse(t) }; } catch { return { status: r.status, body: t }; }
  }, [path, input]);
}
await admin.goto(tripUrl);
await admin.waitForTimeout(4000);
await admin.getByRole('button', { name: 'Share', exact: true }).nth(1).click();
await admin.waitForTimeout(1500);
await admin.screenshot({ path: `${SHOT}/share-dialog-publish-1440.png` });
await admin.locator('textarea[aria-label="Public summary"]').fill('Group trip, come along!');
await admin.getByRole('button', { name: /publish this trip/i }).click();
await admin.waitForTimeout(2500);
const pubUrl = await admin.locator('input[value*="/p/"]').first().inputValue();
ok('trip published with slug', /\/p\/[a-z0-9-]+/.test(pubUrl), pubUrl);
const slug = pubUrl.split('/p/')[1];

// mark a stop booked -> auto booking update (add a stop via tRPC, then book it)
await admin.keyboard.press('Escape');
await admin.waitForTimeout(500);
const tripGet = await admin.evaluate(async (id) => {
  const r = await fetch(`/api/trpc/trips.get?input=${encodeURIComponent(JSON.stringify({ json: { id } }))}`, { credentials: 'include' });
  return r.json();
}, tripId);
const dayId = tripGet?.result?.data?.json?.days?.[0]?.id;
ok('got trip day for stop', !!dayId, String(dayId));
const added = await trpcCall(admin, 'trips.addStop', { tripId, dayId, name: 'Senso-ji Temple', category: 'sights' });
const stopId = added.body?.result?.data?.json?.id;
ok('stop added', !!stopId, JSON.stringify(added.body).slice(0, 120));
const bookedRes = await trpcCall(admin, 'trips.markStopBooked', { id: stopId, tripId, booked: true });
ok('markStopBooked ok', bookedRes.status === 200, JSON.stringify(bookedRes.body).slice(0, 120));
await admin.waitForTimeout(1000);

// public page logged OUT (incognito)
const ctxI = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const incog = await ctxI.newPage();
await incog.goto(`${BASE}/p/${slug}`);
await incog.waitForTimeout(3000);
const iTxt = await incog.locator('body').innerText();
ok('public page renders logged-out', iTxt.includes('r24s verify session'), iTxt.slice(0, 120).replace(/\n/g, ' | '));
ok('booking auto-update posted', /booked/i.test(iTxt), iTxt.match(/[^\n]*booked[^\n]*/i)?.[0] ?? 'none');
ok('sign-in prompt for join', /Sign in to request a spot/.test(iTxt));
await incog.screenshot({ path: `${SHOT}/published-incognito-1440.png`, fullPage: true });

// friend2 requests to join a DIFFERENT published trip (they're a member of the first)
const t2 = await trpcCall(admin, 'trips.create', {
  title: 'Kyoto long weekend', destination: 'Kyoto, Japan',
  startDate: '2026-10-02', endDate: '2026-10-05',
});
const tripId2 = t2.body?.result?.data?.json?.trip?.id ?? t2.body?.result?.data?.json?.id;
ok('second trip created', !!tripId2, JSON.stringify(t2.body).slice(0, 120));
const pub2 = await trpcCall(admin, 'publish.publish', { tripId: tripId2, summary: 'Two seats open!', isOpen: true });
const slug2 = pub2.body?.result?.data?.json?.slug;
ok('second trip published', !!slug2, slug2);
await friend.goto(`${BASE}/p/${slug2}`);
await friend.waitForTimeout(2500);
await friend.locator('textarea[aria-label="Join request message"]').fill('Can I come?');
await friend.getByRole('button', { name: /request to join this trip/i }).click();
await friend.waitForTimeout(2000);
const fReq = await friend.locator('body').innerText();
ok('join request pending state', /waiting for/.test(fReq));

// admin accepts
await admin.goto(`${BASE}/p/${slug2}`);
await admin.waitForTimeout(2500);
const aPub = await admin.locator('body').innerText();
ok('owner sees pending request', aPub.includes('Friend Two'));
await admin.screenshot({ path: `${SHOT}/published-owner-1440.png`, fullPage: true });
await admin.getByRole('button', { name: /^Accept$/ }).first().click();
await admin.waitForTimeout(2500);
const aPub2 = await admin.locator('body').innerText();
await admin.locator('textarea[aria-label="Post an update"]').fill('Hotels booked for everyone!');
await admin.locator('button[aria-label="Post update"]').click();
await admin.waitForTimeout(2000);
const aPub3 = await admin.locator('body').innerText();
ok('owner update posted to feed', aPub3.includes('Hotels booked for everyone!'));
// accepted -> friend2 is a trip member already (was already member via convert? no - friend2 was NOT a participant with account... check)
// friend2 reloads: should show member state
await friend.goto(`${BASE}/p/${slug2}`);
await friend.waitForTimeout(2500);
const fAfter = await friend.locator('body').innerText();
ok('friend accepted (no more request panel)', !/Request to join this trip/.test(fAfter), fAfter.match(/waiting|member|join/i)?.[0] ?? '');

// discover strip on /friends
await admin.goto(`${BASE}/friends`);
await admin.waitForTimeout(2500);
const fHome = await admin.locator('body').innerText();
ok('discover strip lists published trip', fHome.includes('Discover trips') && fHome.includes('r24s verify session'));
await admin.screenshot({ path: `${SHOT}/friends-discover-1440.png`, fullPage: true });

// unpublished slug 404s
await admin.goto(`${BASE}/trips/${tripId2}`);
await admin.waitForTimeout(3000);
await admin.getByRole('button', { name: 'Share', exact: true }).nth(1).click();
await admin.waitForTimeout(1500);
await admin.getByRole('button', { name: /unpublish/i }).click();
await admin.waitForTimeout(1500);
await incog.goto(`${BASE}/p/${slug2}`);
await incog.waitForTimeout(2000);
const goneTxt = await incog.locator('body').innerText();
ok('unpublished slug 404s', /isn’t published|isn't published/.test(goneTxt));

// ── 3. Social import IG paste fallback ──────────────────────────────────────
await admin.goto(`${BASE}/trips`);
await admin.waitForTimeout(2000);
// open the social import modal
const importBtn = admin.getByRole('button', { name: /import|social/i }).first();
console.log('import buttons:', await importBtn.count());
await importBtn.click();
await admin.waitForTimeout(1000);
await admin.screenshot({ path: `${SHOT}/social-chips-1440.png` });
const chipsTxt = await admin.locator('[role="dialog"]').innerText();
ok('platform chips visible', chipsTxt.includes('auto-fetch') && chipsTxt.includes('paste caption'));
await admin.locator('input[aria-label="Social link"]').fill('https://www.instagram.com/reel/C12345abc/');
await admin.getByRole('button', { name: /resolve link/i }).click();
await admin.waitForTimeout(2000);
const dlgTxt = await admin.locator('[role="dialog"]').innerText();
ok('IG login-wall paste-first view', /locks its posts/.test(dlgTxt) && dlgTxt.includes('Paste the caption here'));
await admin.screenshot({ path: `${SHOT}/social-ig-paste-1440.png` });
await admin.locator('textarea[aria-label="Caption text"]').fill('Paris weekend! Eiffel Tower at sunrise, then the Louvre, coffee at Cafe de Flore. #paris #eiffeltower');
await admin.locator('input[aria-label="Near city"]').fill('Paris');
await admin.getByRole('button', { name: /find places in this caption/i }).click();
await admin.waitForTimeout(8000);
const revTxt = await admin.locator('[role="dialog"]').innerText();
ok('extraction produced places', /places found/.test(revTxt) && /Eiffel/i.test(revTxt), revTxt.slice(0, 150).replace(/\n/g, ' | '));
await admin.screenshot({ path: `${SHOT}/social-extract-1440.png`, fullPage: true });

// ── 4. Mobile 390 spot checks ────────────────────────────────────────────────
const ctxM = await mk(390, 844);
const mAdmin = await login(ctxM, 'admin@wayfare.app', 'a4nc-jge5-bjhk-4vvb');
await mAdmin.goto(`${BASE}/friends`);
await mAdmin.waitForTimeout(2000);
await mAdmin.screenshot({ path: `${SHOT}/friends-home-390.png`, fullPage: true });
await mAdmin.goto(`${BASE}/friends/${ownerToken}`);
await mAdmin.waitForTimeout(2500);
await mAdmin.screenshot({ path: `${SHOT}/friends-session-390.png`, fullPage: true });
const mIncog = await (await mk(390, 844)).newPage();
await mIncog.goto(`${BASE}/p/nonexistent-slug-0000`);
await mIncog.waitForTimeout(2000);
await mIncog.screenshot({ path: `${SHOT}/published-404-390.png`, fullPage: true });

console.log('\n=== SUMMARY ===');
results.forEach(r => console.log(r));
await browser.close();
