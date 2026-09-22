// Run against the local dev server. Uses live Google Maps; suppresses paid AI driver requests.
// No credentials or request URLs are written to the screenshots or test output.
import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import puppeteer from 'puppeteer-core';
const url = process.env.SHOTS_URL ?? 'http://localhost:5185';
const config = await (await fetch(`${url}/api/maps/config`)).json();
assert.ok(config.browserKey, 'Configure GOOGLE_MAPS_BROWSER_KEY locally first');
const redact = (text) => String(text).replaceAll(config.browserKey, '[REDACTED]').replace(/key=[^&\s]+/g, 'key=[REDACTED]');
const out = 'shots-out/googlemaps';
mkdirSync(out, { recursive: true });
const browser = await puppeteer.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true, args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist', '--mute-audio'], defaultViewport: { width: 1440, height: 900 } });
const problems = [];
try {
  const page = await browser.newPage();
  page.on('response', (response) => { if (response.status() >= 400) { const target = new URL(response.url()); console.log('HTTP', response.status(), target.origin + target.pathname); } });
  page.on('pageerror', (e) => problems.push(redact(e.message)));
  page.on('console', (m) => { if (m.type() === 'error') problems.push(redact(m.text())); });
  await page.setRequestInterception(true);
  page.on('request', (req) => {
    const path = new URL(req.url()).pathname;
    if (path === '/api/health') return void req.respond({ contentType: 'application/json', body: JSON.stringify({ configured: false }) });
    if (path === '/api/driver/health') return void req.respond({ contentType: 'application/json', body: JSON.stringify({ configured: false, voice: 'off' }) });
    if (path === '/api/driver/cast') return void req.respond({ contentType: 'application/json', body: 'null' });
    if (path.startsWith('/api/driver/') || path === '/api/drive') return void req.respond({ contentType: 'application/json', body: '{}' });
    void req.continue();
  });
  await page.goto(`${url}/?maps=google&scene=tiles`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => Boolean(window.jevRoads));
  if (!process.env.SKIP_PICKER) {
  await page.click('.landing-map');
  await page.waitForFunction(() => document.querySelector('.picker-note')?.textContent?.includes('Click a street'), { timeout: 45000 });
  await page.screenshot({ path: `${out}/01-picker-3d.png` });
  console.log('PASS live photorealistic 3D picker');
  await page.type('[aria-label="Search Google Maps"]', 'Arc de Triomphe, Paris');
  await page.click('.picker-head form button');
  await page.waitForFunction(() => document.querySelector('.picker-go strong')?.textContent?.includes('Paris'), { timeout: 20000 });
  console.log('PASS Google geocoding and camera flight');
  await page.click('[data-explore="satellite"]');
  await page.waitForSelector('.picker-map[data-loaded="true"]', { timeout: 20000 });
  await page.screenshot({ path: `${out}/02-satellite.png` });
  await page.click('[data-explore="street"]');
  await page.waitForFunction(() => document.querySelector('.picker-note')?.textContent?.includes('Scout the neighbourhood'), { timeout: 20000 });
  await new Promise((r) => setTimeout(r, 2500));
  await page.screenshot({ path: `${out}/03-streetview.png` });
  console.log('PASS satellite and Street View');
  }
  await page.evaluate(() => window.jevRoads.open({ name: 'Cassis', lat: 43.214, lon: 5.5396 }));
  await page.waitForFunction(async () => (await import('/src/store.ts')).get().googleStatus === 'ready', { timeout: 55000 });
  await page.evaluate(() => window.jevRoads.game.setCameraShot('orbit'));
  await new Promise((r) => setTimeout(r, 2000));
  await page.screenshot({ path: `${out}/04-orbit.png` });
  console.log('PASS streamed 3D ride world');
  for (const shot of ['chase', 'overhead', 'ride']) {
    await page.evaluate((shot) => window.jevRoads.game.setCameraShot(shot), shot);
    await new Promise((r) => setTimeout(r, 1800));
    await new Promise((r) => setTimeout(r, 2000));
    await page.screenshot({ path: `${out}/05-${shot}.png` });
  }
  console.log('PASS chase, overhead and passenger cameras');
  assert.equal(await page.$eval('.google-world-map', (el) => el.style.visibility), 'visible', 'Passenger uses tiles by default');
  const models = await page.$$eval('gmp-model-3d', (els) => els.map((el) => ({ colour: el.dataset.colour, tilt: el.orientation?.tilt, src: el.src?.href })));
  assert.ok(new Set(models.map((m) => m.colour)).size > 4, 'Traffic has individual colours');
  assert.ok(models.every((m) => m.tilt === 270 && m.src.includes('/api/vehicle/')), 'Upright, painted native models');
  await page.click('.gear');
  await page.click('.provider-options [data-world="street"]');
  await page.click('.gear');
  await page.waitForFunction(() => document.querySelector('.street-ride-notice')?.textContent.includes('imagery advances'), { timeout: 20000 });
  await new Promise((r) => setTimeout(r, 2500));
  await page.screenshot({ path: `${out}/05-street-ride.png` });
  assert.equal(await page.$eval('.google-world-map', (el) => el.style.visibility), 'hidden');
  assert.ok(await page.evaluate(() => document.elementFromPoint(innerWidth / 2, innerHeight / 2)?.classList.contains('scene')), 'Cabin stays in front of Street View');
  await page.click('.gear');
  await page.click('.provider-options [data-world="tiles"]');
  await page.click('.gear');
  await page.waitForFunction(() => document.querySelector('.street-ride')?.hidden);
  console.log('PASS tiles / Street View switch without restarting the ride');
  const details = await page.evaluate(async () => {
    const { get, set } = await import('/src/store.ts');
    const ui = get();
    set({ talk: { ...ui.talk, ready: true }, gps: true });
    return { cars: ui.cars, status: ui.googleStatus, mapCount: document.querySelectorAll('gmp-map-3d').length, models: document.querySelectorAll('gmp-model-3d').length };
  });
  console.log('World:', JSON.stringify(details));
  assert.equal(details.status, 'ready');
  assert.ok(details.cars > 0);
  assert.equal(details.mapCount, 1, 'Picker map should be disposed');
  await page.evaluate(async () => {
    const { set, get } = await import('/src/store.ts');
    window.jevRoads.chatter.health = { configured: true, voice: 'off' };
    window.jevRoads.chatter.on = false;
    set({ talk: { ...get().talk, ready: true }, gps: true });
  });
  await page.waitForSelector('.google-gps-map[data-loaded="true"]', { timeout: 20000 });
  await page.screenshot({ path: `${out}/06-gps.png` });
  console.log('PASS Google taxi GPS');
  await page.click('.gear');
  await Promise.all([
    page.waitForNavigation({ waitUntil: 'domcontentloaded' }),
    page.click('.provider-options [data-world="reconstructed"]'),
  ]);
  await page.waitForFunction(() => window.jevRoads?.game.frame && document.querySelector('.app.maps-google.world-reconstructed'), { timeout: 30000 });
  await page.evaluate(() => window.jevRoads.game.setMode('above'));
  await new Promise((r) => setTimeout(r, 5000));
  await page.screenshot({ path: `${out}/07-osm-fallback.png` });
  assert.equal(await page.$$eval('gmp-map-3d', (els) => els.length), 0);
  console.log('PASS Reconstructed switch keeps Google as the map provider');
  await page.click('.gear');
  await Promise.all([page.waitForNavigation({ waitUntil: 'domcontentloaded' }), page.click('[data-provider="osm"]')]);
  await page.waitForFunction(() => window.jevRoads?.game.frame && document.querySelector('.app.maps-osm.world-reconstructed'), { timeout: 30000 });
  console.log('PASS OpenStreetMap remains an alternative provider');
  const fresh = await browser.createBrowserContext();
  const mobile = await fresh.newPage();
  await mobile.setViewport({ width: 390, height: 844 });
  await mobile.setRequestInterception(true);
  mobile.on('request', (req) => {
    const path = new URL(req.url()).pathname;
    if (path === '/api/health' || path.startsWith('/api/driver/')) return void req.respond({ contentType: 'application/json', body: '{"configured":false,"voice":"off"}' });
    void req.continue();
  });
  await mobile.goto(url, { waitUntil: 'domcontentloaded' });
  await mobile.waitForSelector('.app.maps-google.world-reconstructed');
  assert.equal(await mobile.$('.camera-bar'), null, 'No floating mode controls');
  await mobile.click('.gear');
  await mobile.waitForSelector('#game-settings', { visible: true });
  assert.equal(await mobile.$eval('[data-provider="google"]', (el) => el.getAttribute('aria-pressed')), 'true');
  assert.equal(await mobile.$eval('[data-world="reconstructed"]', (el) => el.getAttribute('aria-pressed')), 'true');
  assert.deepEqual(await mobile.$$eval('[data-world]', (els) => els.map((el) => el.dataset.world)), ['reconstructed', 'tiles', 'street']);
  assert.equal(await mobile.$$eval('[data-world]', (els) => els.length === 3 && els.every((el) => el.closest('#game-settings'))), true);
  assert.ok(await mobile.$eval('#game-settings', (el) => { const box = el.getBoundingClientRect(); return box.x >= 0 && box.right <= innerWidth && box.bottom <= innerHeight; }), 'Mobile settings fit the viewport');
  await mobile.screenshot({ path: `${out}/08-mobile-settings.png` });
  await fresh.close();
  console.log('PASS Google + Reconstructed default; modes only in Settings; mobile layout');
  assert.deepEqual(problems, [], 'Browser errors');
  console.log('All live Google Maps smoke checks passed.');
} catch (error) {
  console.error(redact(error.message));
  console.error(problems.map(redact).join('\n'));
  const page = (await browser.pages()).at(-1);
  if (page) {
    await page.screenshot({ path: `${out}/failure.png` }).catch(() => {});
    console.error(await page.evaluate(() => [...document.querySelectorAll('.picker-note,.map-error,.world-loading')].map((el) => el.textContent).join('\n')).catch(() => ''));
  }
  process.exitCode = 1;
} finally { await browser.close(); }
