// Are the modelled vehicles loaded and on the road? node scripts/check-models.mjs   (dev server running)
import puppeteer from 'puppeteer-core';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await puppeteer.launch({
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: true,
  args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist', '--mute-audio'],
  defaultViewport: { width: 1280, height: 720 },
});
const page = await browser.newPage();
await page.evaluateOnNewDocument(() => localStorage.setItem('jev-roads:look', 'real'));
const problems = [];
page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));
// Out of credits (402) is the account's business, not the models'.
page.on('console', (m) => (m.type() === 'error' || m.type() === 'warn') && !/402|Payment Required/.test(m.text()) && problems.push(`${m.type()}: ${m.text()}`));
await page.goto(process.env.SHOTS_URL ?? 'http://localhost:5185/', { waitUntil: 'domcontentloaded' });
await page.waitForSelector('canvas');
await sleep(2500);
await page.evaluate(() => window.jevRoads.open({ name: 'Cassis', lat: 43.214, lon: 5.5396 }));
await sleep(10000);
const drawn = await page.evaluate(() => {
  const v = window.jevRoads.view.vehicles;
  return { models: Object.fromEntries([...v.models].map(([name, set]) => [name, set.n])), profiles: Object.fromEntries(Object.entries(v.sets).map(([kind, set]) => [kind, set.n])) };
});
console.log('drawn as models  ', JSON.stringify(drawn.models));
console.log('drawn as profiles', JSON.stringify(drawn.profiles));
console.log(problems.length ? `PROBLEMS:\n${problems.join('\n')}` : 'no console errors or warnings (402s apart)');
await browser.close();
process.exit(Object.keys(drawn.models).length === 9 && Object.values(drawn.profiles).every((n) => n === 0) && !problems.length ? 0 : 1);
