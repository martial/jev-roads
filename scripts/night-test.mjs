// Does switching to night stall the realistic look? Logs frame rate every second.  node scripts/night-test.mjs <out.png>
import puppeteer from 'puppeteer-core';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await puppeteer.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true, protocolTimeout: 240000, args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist', '--mute-audio'], defaultViewport: { width: 1440, height: 810 } });
const page = await browser.newPage();
await page.evaluateOnNewDocument(() => localStorage.setItem('jev-roads:look', 'real'));
page.on('pageerror', (e) => console.log('pageerror:', e.message));
page.on('console', (m) => (m.type() === 'error' || m.type() === 'warning') && !m.text().includes('402') && console.log(m.type(), m.text().slice(0, 300)));
await page.goto('http://localhost:5185/', { waitUntil: 'domcontentloaded' });
await sleep(3500);
await page.evaluate(() => {
  window.jevRoads.open({ name: 'Aix', lat: 43.5263, lon: 5.4454 });
  window.__frames = 0;
  const tick = () => { window.__frames++; requestAnimationFrame(tick); };
  requestAnimationFrame(tick);
});
await sleep(9000);
const rate = async (label) => { const a = await page.evaluate(() => window.__frames); await sleep(2000); const b = await page.evaluate(() => window.__frames); console.log(label, (b - a) / 2, 'fps'); };
await rate('day, riding:');
await page.evaluate(() => [...document.querySelectorAll('.events button')].find((b) => b.textContent === 'Night').click());
for (let i = 0; i < 5; i++) await rate(`night +${i * 2}s:`);
await page.screenshot({ path: process.argv[2] });
console.log('screenshot written');
await browser.close();
