// Which trees were planted, and what do they look like from above and from the street?
//   [PLACE='Aix' LAT=43.5263 LON=5.4454] node scripts/check-trees.mjs [outDir]      (dev server running)
import { mkdirSync } from 'node:fs';
import puppeteer from 'puppeteer-core';

const out = process.argv[2] ?? 'shots-out';
mkdirSync(out, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await puppeteer.launch({
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: true,
  args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist', '--mute-audio'],
  defaultViewport: { width: 1440, height: 810 },
});
const page = await browser.newPage();
await page.evaluateOnNewDocument(() => {
  localStorage.setItem('jev-roads:look', 'toon');
  localStorage.setItem('jev-roads:driver', 'off');
});
const problems = [];
page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));
page.on('console', (m) => (m.type() === 'error' || m.type() === 'warn') && !/402|Payment Required/.test(m.text()) && problems.push(`${m.type()}: ${m.text()}`));
await page.goto(process.env.SHOTS_URL ?? 'http://localhost:5185/', { waitUntil: 'domcontentloaded' });
await page.waitForSelector('canvas');
await sleep(2500);
await page.evaluate((place) => window.jevRoads.open(place), { name: process.env.PLACE ?? 'La Rotonde, Aix-en-Provence', lat: Number(process.env.LAT ?? 43.5263), lon: Number(process.env.LON ?? 5.4454) });
await sleep(20000);
console.log('planted:', JSON.stringify(await page.evaluate(() => window.jevRoads.view.trees.census)));
// Look at wherever the trees stand thickest, not at the taxi.
for (const [name, distance, pitch, yaw] of [['above', 110, 0.5, 0.6], ['street', 34, 0.12, 2.2]]) {
  await page.evaluate(
    ({ distance, pitch, yaw }) => {
      const v = window.jevRoads.view;
      [...document.querySelectorAll('.segment button')].find((b) => b.textContent === 'Above').click();
      const spots = v.trees.spots.filter((s) => !s.park);
      const best = (spots.length ? spots : v.trees.spots).map((s) => ({ s, n: spots.filter((o) => Math.hypot(o.x - s.x, o.z - s.z) < 45).length })).sort((a, b) => b.n - a.n)[0].s;
      v.ride(null);
      v.orbit.target.set(best.x, best.y, best.z);
      Object.assign(v.orbit, { distance, pitch, yaw });
    },
    { distance, pitch, yaw },
  );
  await sleep(900);
  await page.screenshot({ path: `${out}/trees-${name}.png` });
}
console.log(problems.length ? `PROBLEMS:\n${problems.join('\n')}` : 'no console errors or warnings (402s apart)');
await browser.close();
