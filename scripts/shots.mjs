// Headless look at the running dev server: node scripts/shots.mjs [outDir] [jsToRunFirst]
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
// SHOTS_LOOK=real opens the realistic look without a reload in the middle of the script.
if (process.env.SHOTS_LOOK) await page.evaluateOnNewDocument((look) => localStorage.setItem('jev-roads:look', look), process.env.SHOTS_LOOK);
const problems = [];
page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));
page.on('console', (m) => (m.type() === 'error' || m.type() === 'warn') && problems.push(`${m.type()}: ${m.text()}`));
await page.goto(process.env.SHOTS_URL ?? 'http://localhost:5185/', { waitUntil: 'domcontentloaded' });
await page.waitForSelector('canvas');
const steps = JSON.parse(process.argv[3] ?? '[]');
let n = 1;
for (const step of steps.length ? steps : [{ wait: 9000, name: 'aerial' }]) {
  if (step.run) await page.evaluate(step.run).catch(() => {}); // a step that reloads the page cuts its own call short
  if (step.key) await page.keyboard.press(step.key);
  await sleep(step.wait ?? 1000);
  if (step.name) await page.screenshot({ path: `${out}/${n++}-${step.name}.png` });
}
const info = await page.evaluate(() => {
  const gl = document.querySelector('canvas').getContext('webgl2');
  const e = window.engine;
  return { renderer: gl ? 'webgl2 ok' : 'no webgl2 handle (in use by three, expected)', flyers: e?.flyers?.length, dirty: e?.voxels?.dirty?.size };
});
console.log(JSON.stringify(info));
console.log(problems.length ? `PROBLEMS:\n${problems.slice(0, 12).join('\n')}` : 'no console errors or warnings');
await browser.close();
