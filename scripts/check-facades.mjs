// How many things stand on the walls, and what a street looks like now: from the pavement, and from a window.
//   [PLACE=... LAT=... LON=...] node scripts/check-facades.mjs [outDir]      (dev server running)
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
await page.evaluateOnNewDocument((look) => {
  localStorage.setItem('jev-roads:look', look);
  localStorage.setItem('jev-roads:driver', 'off');
}, process.env.SHOTS_LOOK ?? 'toon');
const problems = [];
page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));
page.on('console', (m) => (m.type() === 'error' || m.type() === 'warn') && !/402|Payment Required/.test(m.text()) && problems.push(`${m.type()}: ${m.text()}`));
await page.goto(process.env.SHOTS_URL ?? 'http://localhost:5185/', { waitUntil: 'domcontentloaded' });
await page.waitForSelector('canvas');
await sleep(2500);
await page.evaluate((place) => window.jevRoads.open(place), { name: process.env.PLACE ?? 'Cassis', lat: Number(process.env.LAT ?? 43.214), lon: Number(process.env.LON ?? 5.5396) });
await sleep(18000);
console.log('on the walls:', JSON.stringify(await page.evaluate(() => window.jevRoads.view.buildings.facades.counts)));
// Stand in the street by the taxi and look at the houses, then look down the street from a first floor.
for (const [name, distance, pitch, yaw] of [['street', 24, 0.1, 2.4], ['window', 45, 0.22, 0.9], ['above', 120, 0.45, 0.6]]) {
  await page.evaluate(({ distance, pitch, yaw }) => {
    const v = window.jevRoads.view;
    [...document.querySelectorAll('.segment button')].find((b) => b.textContent === 'Above').click();
    Object.assign(v.orbit, { distance, pitch, yaw });
  }, { distance, pitch, yaw });
  await sleep(1200);
  await page.screenshot({ path: `${out}/facades-${name}.png` });
}
console.log(problems.length ? `PROBLEMS:\n${problems.join('\n')}` : 'no console errors or warnings (402s apart)');
await browser.close();
