// Sit beside the driver for a while and write down what he says, and when.
//   [PLACE='Paris' LAT=48.8738 LON=2.295] node scripts/check-driver.mjs [seconds] [en|fr] [shot.png]
// The dev server must be running, with a Google Cloud login on this machine.
import puppeteer from 'puppeteer-core';

const seconds = Number(process.argv[2] ?? 60);
const lang = process.argv[3] === 'fr' ? 'fr' : 'en';
const shot = process.argv[4];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await puppeteer.launch({
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: true,
  args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist', '--mute-audio', '--autoplay-policy=no-user-gesture-required'],
  defaultViewport: { width: 1440, height: 810 },
});
const page = await browser.newPage();
await page.evaluateOnNewDocument((lang) => {
  localStorage.setItem('jev-roads:look', 'toon');
  localStorage.setItem('jev-roads:lang', lang);
  localStorage.setItem('jev-roads:driver', 'on');
}, lang);
const problems = [];
page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));
// Which call was refused, and what it said: a 429 from our own server and one from Google are different stories.
page.on('response', async (r) => r.status() >= 400 && r.status() !== 402 && problems.push(`${r.status()} ${new URL(r.url()).pathname}: ${(await r.text().catch(() => '')).slice(0, 200)}`));
page.on('console', (m) => (m.type() === 'error' || m.type() === 'warn') && !/402|Payment Required/.test(m.text()) && problems.push(`${m.type()}: ${m.text()}`));
await page.goto(process.env.SHOTS_URL ?? 'http://localhost:5185/', { waitUntil: 'domcontentloaded' });
await page.waitForSelector('canvas');
await sleep(2500);
await page.evaluate((place) => window.jevRoads.open(place), { name: process.env.PLACE ?? 'Cassis', lat: Number(process.env.LAT ?? 43.214), lon: Number(process.env.LON ?? 5.5396) });
await sleep(7000);
await page.keyboard.press('m'); // a key press wakes the sound...
await page.keyboard.press('m'); // ...and a second one un-mutes it
await page.evaluate(() => [...document.querySelectorAll('.segment button')].find((b) => b.textContent === 'Ride').click());
const t0 = Date.now();
let last = '';
let shown = false;
while (Date.now() - t0 < seconds * 1000) {
  const now = await page.evaluate(() => {
    const c = window.jevRoads.chatter;
    return { who: c.who, caption: document.querySelector('.caption')?.textContent ?? '', mood: document.querySelector('.caption')?.dataset.mood ?? '', gesture: c.talk.gesture, level: c.talk.level, last: c.last, error: c.error, gags: c.gags };
  });
  if (now.caption !== last) {
    const at = ((Date.now() - t0) / 1000).toFixed(1).padStart(5);
    if (now.caption) console.log(`${at}s  [${now.mood}/${now.gesture}] ${now.caption.replace(now.who, `${now.who}: `)}${now.last ? `   (${now.last.engine}, words ${now.last.wordsMs} ms, voice ${now.last.voiceMs} ms)` : ''}`);
    else console.log(`${at}s  ...`);
    last = now.caption;
    if (now.caption && shot && !shown && Date.now() - t0 > 12000) {
      shown = true;
      await page.screenshot({ path: shot });
    }
  }
  if (now.error) console.log(`       error: ${now.error}`);
  await sleep(250);
}
const end = await page.evaluate(() => ({ gags: window.jevRoads.chatter.gags, level: window.jevRoads.chatter.talk.level }));
console.log('the car:', JSON.stringify(end.gags));
console.log(problems.length ? `PROBLEMS:\n${problems.slice(0, 10).join('\n')}` : 'no console errors or warnings (402s apart)');
await browser.close();
