// Does the picker map keep loading tiles while zooming out?  node scripts/zoom-test.mjs <outDir>
import { mkdirSync } from 'node:fs';
import puppeteer from 'puppeteer-core';
const out = process.argv[2] ?? 'shots-out';
mkdirSync(out, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await puppeteer.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true, args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist', '--mute-audio'], defaultViewport: { width: 1440, height: 810 } });
const page = await browser.newPage();
const failed = [];
page.on('requestfailed', (r) => failed.push(`${r.failure()?.errorText} ${r.url().slice(0, 90)}`));
page.on('response', (r) => r.status() >= 400 && failed.push(`HTTP ${r.status()} ${r.url().slice(0, 90)}`));
await page.goto('http://localhost:5185/', { waitUntil: 'domcontentloaded' });
await page.waitForSelector('.picker-map .leaflet-tile-loaded');
await sleep(1500);
await page.evaluate(() => [...document.querySelectorAll('.picker-head li button')].find((b) => b.textContent.includes('toile')).click());
await sleep(4000);
await page.screenshot({ path: `${out}/1-zoomed-in.png` });
await page.mouse.move(900, 450);
for (let i = 0; i < 9; i++) {
  await page.mouse.wheel({ deltaY: 400 });
  await sleep(700);
}
await sleep(3500);
await page.screenshot({ path: `${out}/2-zoomed-out.png` });
const tiles = await page.evaluate(() => ({ zoom: document.querySelectorAll('.leaflet-tile').length, loaded: document.querySelectorAll('.leaflet-tile-loaded').length, broken: [...document.querySelectorAll('.leaflet-tile')].filter((t) => t.complete && !t.naturalWidth).length }));
console.log(JSON.stringify(tiles));
console.log(failed.length ? `FAILED REQUESTS:\n${[...new Set(failed)].slice(0, 12).join('\n')}` : 'no failed requests');
await browser.close();
