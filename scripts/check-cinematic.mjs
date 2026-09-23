// The reconstructed city in the cinematic look, from the passenger seat, in the three light presets; with the
// frame rate and any shader error. `node scripts/check-cinematic.mjs [outDir]` (dev server running)
import { mkdirSync } from 'node:fs';
import puppeteer from 'puppeteer-core';
const out = process.argv[2] ?? 'shots-out/cine';
mkdirSync(out, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await puppeteer.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true, args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist', '--mute-audio'], defaultViewport: { width: 1440, height: 810 } });
const page = await browser.newPage();
await page.evaluateOnNewDocument(() => { localStorage.setItem('jev-roads:look', 'real'); localStorage.setItem('jev-roads:driver', 'off'); });
const problems = [];
page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));
page.on('console', (m) => (m.type() === 'error' || /shader|GLSL|WebGL/i.test(m.text())) && problems.push(`${m.type()}: ${m.text().slice(0, 400)}`));
await page.goto('http://localhost:5185/?maps=google&scene=reconstructed', { waitUntil: 'domcontentloaded' });
await sleep(2500);
await page.evaluate((place) => window.jevRoads.open(place), { name: process.env.PLACE ?? 'Cassis', lat: Number(process.env.LAT ?? 43.214), lon: Number(process.env.LON ?? 5.5396) });
await sleep(18000);
await page.evaluate(() => { const g = window.jevRoads.game; const d = g.ride.destinations()[0]; if (d) g.startRide(d.label); });
// The real places from Google, if the key allows it: how many, and how many found a wall.
const real = await page.evaluate(() => { const b = window.jevRoads.view.buildings; const s = b?.storefronts; return s ? { places: s.names.length, signs: s.group.children[0]?.geometry.index.count / 6 || 0, sample: s.names.slice(0, 6).map((p) => `${p.name} (${p.type})`) } : null; });
console.log('google places:', JSON.stringify(real));
await sleep(1500);
await page.evaluate(() => { const css = document.createElement('style'); css.textContent = '.gps,.gauge,.caption,.keys,.ride,.verdict,.choice,.ride-hint,.start,.pick{display:none!important}'; document.head.appendChild(css); });
for (const [time, weather, name] of (process.env.ONLY === 'neon' ? [['night', 'rain', 'neon'], ['night', 'clear', 'night']] : [['midday', 'clear', 'day'], ['golden', 'clear', 'golden'], ['dusk', 'rain', 'rain-dusk'], ['night', 'clear', 'night'], ['night', 'rain', 'neon']])) {
  await page.evaluate(([t, w]) => window.jevRoads.game.setSky(t, w), [time, weather]);
  await sleep(6000);
  const fps = await page.evaluate(() => new Promise((res) => { let n = 0; const t0 = performance.now(); const f = () => (++n, performance.now() - t0 < 2000 ? requestAnimationFrame(f) : res(Math.round((n * 1000) / (performance.now() - t0)))); requestAnimationFrame(f); }));
  for (const [yaw, suffix] of [[0, 'ahead'], [-0.9, 'side']]) {
    await page.evaluate((y) => { const v = window.jevRoads.view; v.look.idle = 0; v.look.yaw = y; v.look.pitch = -0.02; }, yaw);
    await sleep(700);
    await page.screenshot({ path: `${out}/${name}-${suffix}.png` });
  }
  console.log(`${name}: ${fps} fps`);
}
console.log(problems.length ? `PROBLEMS:\n${[...new Set(problems)].slice(0, 10).join('\n')}` : 'no errors');
await browser.close();
