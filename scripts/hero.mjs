// A clean render of the cabin for the title page: Cassis, a ride begun, every bit of interface hidden.
//   node scripts/hero.mjs          (dev server running)
import { execSync } from 'node:child_process';
import puppeteer from 'puppeteer-core';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await puppeteer.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true, args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist', '--mute-audio'], defaultViewport: { width: 1800, height: 1000 } });
const page = await browser.newPage();
await page.evaluateOnNewDocument(() => { localStorage.setItem('jev-roads:look', 'toon'); localStorage.setItem('jev-roads:driver', 'off'); });
await page.goto('http://localhost:5185/', { waitUntil: 'domcontentloaded' });
await sleep(2000);
await page.evaluate(() => window.jevRoads.open({ name: 'Cassis', lat: 43.214, lon: 5.5396 }));
await sleep(14000);
await page.evaluate(() => {
  const g = window.jevRoads.game;
  const d = g.ride.destinations()[0];
  g.startRide(d.label);
  const css = document.createElement('style');
  css.textContent = '.gauge,.gps,.caption,.ride,.dash,.keys,.place,.gear,.switches,.verdict,.choice,.ride-hint,.bubbles,.progress{display:none!important}';
  document.head.appendChild(css);
  const v = window.jevRoads.view;
  v.look.idle = 0; v.look.yaw = 0.75; v.look.pitch = -0.1;
});
await sleep(2500);
await page.screenshot({ path: 'shots-out/hero.png' });
execSync('sips -s format jpeg -s formatOptions 74 shots-out/hero.png --out public/hero.jpg');
await browser.close();
