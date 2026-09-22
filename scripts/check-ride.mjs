// A ride, played by a script: he asks where to, the screen comes up, the tour of the town is quoted; then a
// click on the road (an interruption), a provocation, the radio, a long silence, a curious answer, and the
// verdict each one came to: what he feels (the hidden number, for the check only), the route left, the fare.
//   [PLACE=... LAT=... LON=...] node scripts/check-ride.mjs [outDir]      (dev server running, Google login on this machine)
import { mkdirSync } from 'node:fs';
import puppeteer from 'puppeteer-core';

const out = process.argv[2] ?? 'shots-out';
mkdirSync(out, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await puppeteer.launch({
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: true,
  args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist', '--mute-audio', '--autoplay-policy=no-user-gesture-required'],
  defaultViewport: { width: 1440, height: 810 },
});
const page = await browser.newPage();
await page.evaluateOnNewDocument(() => {
  localStorage.setItem('jev-roads:look', 'toon');
  localStorage.setItem('jev-roads:driver', 'on');
  localStorage.removeItem('jev-roads:driver-memory:43.21,5.54');
});
const problems = [];
page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));
page.on('console', (m) => (m.type() === 'error' || m.type() === 'warn') && !/402|Payment Required/.test(m.text()) && problems.push(`${m.type()}: ${m.text()}`));
page.on('response', async (r) => r.status() >= 400 && r.status() !== 402 && problems.push(`${r.status()} ${new URL(r.url()).pathname}: ${(await r.text().catch(() => '')).slice(0, 160)}`));
await page.goto(process.env.SHOTS_URL ?? 'http://localhost:5185/', { waitUntil: 'domcontentloaded' });
await page.waitForSelector('canvas');
await sleep(2500);
await page.evaluate((sex) => window.jevRoads.game.setSex(sex), process.env.SEX === 'f' ? 'f' : 'm');
await page.evaluate((place) => window.jevRoads.open(place), { name: process.env.PLACE ?? 'Cassis', lat: Number(process.env.LAT ?? 43.214), lon: Number(process.env.LON ?? 5.5396) });
await sleep(9000);
await page.keyboard.press('m');
await page.keyboard.press('m');
for (let i = 0; i < 40 && !(await page.evaluate(() => window.jevRoads.chatter.ready)); i++) await sleep(500);
const t0 = Date.now();
const at = () => ((Date.now() - t0) / 1000).toFixed(0).padStart(4);
const state = () =>
  page.evaluate(() => {
    const g = window.jevRoads.game;
    const v = g.ride.view();
    const net = g.frame.net;
    const left = Math.round(v.routeLanes.reduce((s, id) => s + (net.lanes[id]?.length ?? 0), 0));
    const vd = v.verdict;
    return {
      sympathie: Math.round(g.ride.sympathie),
      phase: v.phase,
      left,
      stops: v.stops,
      eta: v.eta,
      estimate: v.estimate.toFixed(2),
      fare: v.fare.toFixed(2),
      rate: window.jevRoads.chatter.gags.perKm.toFixed(1),
      offer: v.offer ? v.offer.lines.map((l) => `[${l.kind}${l.lever ? '/' + l.lever : ''}] ${l.text}`) : null,
      twist: v.twist,
      note: v.note,
      etas: v.etas.join('>'),
      verdict: vd ? `${vd.kind.toUpperCase()} "${vd.title}" ${Math.round(vd.to.metres - vd.from.metres)} m, ${vd.to.eta - vd.from.eta} min, ${(vd.to.estimate - vd.from.estimate).toFixed(0)} € (${vd.hint})` : '',
      dom: { gps: document.querySelector('.gps')?.className.replace(/\s+/g, ' ') ?? '', card: document.querySelector('.verdict')?.textContent?.slice(0, 40) ?? '', choice: document.querySelector('.choice-timer b')?.textContent ?? '', events: document.querySelector('.events')?.hidden },
    };
  });
const say = (label, s) => {
  console.log(`${at()}s ${label.padEnd(26)} sympathie ${String(s.sympathie).padStart(3)} ${s.phase.padEnd(8)} route ${String(s.left).padStart(5)} m  ${s.stops} stops  eta ${s.eta} min  est. ${s.estimate} € @${s.rate}/km  meter ${s.fare} €${s.twist ? '  twist ' + s.twist : ''}${s.note ? '  (' + s.note + ')' : ''}`);
  if (s.verdict) console.log(`        verdict: ${s.verdict}   etas ${s.etas}   dom: ${s.dom.gps}${s.dom.card ? ' | card "' + s.dom.card + '"' : ''}${s.dom.choice ? ' | timer ' + s.dom.choice : ''}`);
};
let lastCaption = 0;
const captions = async () => {
  // Each line once, whole, as soon as he starts it (the screen streams it word by word).
  const c = await page.evaluate(() => {
    const ch = window.jevRoads.chatter;
    return { n: ch.lines, said: ch.said.at(-1) ?? '', who: ch.who };
  });
  if (c.n !== lastCaption && c.said) {
    lastCaption = c.n;
    console.log(`${at()}s   » ${c.who}: ${c.said}`);
  }
};
const waitFor = async (seconds, what) => {
  for (let i = 0; i < seconds * 4; i++) {
    await captions();
    if (what && (await page.evaluate(what))) return true;
    await sleep(250);
  }
  return false;
};
// He asks where to first; only then the screen.
const askedFirst = !(await page.evaluate(() => Boolean(document.querySelector('.gps'))));
console.log(`${at()}s before he speaks, the taxi's screen is ${askedFirst ? 'down (good)' : 'ALREADY UP'}`);
const asked = await waitFor(30, () => window.jevRoads.game.ride.phase === 'idle');
const gps = await page.evaluate(() => Boolean(document.querySelector('.gps.is-big')));
console.log(`${at()}s he ${asked ? 'has asked' : 'never asked'}; the taxi's screen is ${gps ? 'up' : 'NOT up'}`);
await sleep(1500);
await page.screenshot({ path: `${out}/1-gps.png` });
// The ride: to the first named place.
const label = await page.evaluate(() => {
  const d = window.jevRoads.game.ride.destinations()[0];
  window.jevRoads.game.startRide(d.label);
  return d.label;
});
const quoted = await state();
say(`ride to ${label}`, quoted);
const direct = await page.evaluate(() => {
  // The direct route, for comparison with the tour he quoted.
  const g = window.jevRoads.game;
  const taxi = g.view.riding;
  const net = g.frame.net;
  const d = g.ride.destinations()[0];
  const from = taxi.path < g.traffic.lanesCount() ? taxi.path : taxi.route[0];
  const leg = window.jevRoads.route ? window.jevRoads.route(net, from, d.lanes[0], () => 0) : null;
  return leg ? Math.round(leg.reduce((s, id) => s + net.lanes[id].length, 0)) : null;
});
if (direct) console.log(`        the direct road would be ${direct} m: the tour is ${(quoted.left / direct).toFixed(1)}× that`);
await waitFor(30, () => window.jevRoads.game.ride.phase === 'riding');
await sleep(1200);
await page.screenshot({ path: `${out}/2-quote.png` });
say('after the quote', await state());
const docked = await waitFor(20, () => Boolean(document.querySelector('.gps.is-docked')));
console.log(`${at()}s the screen ${docked ? 'docked in the corner' : 'did NOT dock'}`);
await page.screenshot({ path: `${out}/3-docked.png` });
// A click on the road while he talks.
const talking = await waitFor(25, () => window.jevRoads.chatter.talk.speaking && window.jevRoads.chatter.talk.progress > 0.2);
if (talking) {
  await page.mouse.click(720, 300);
  await sleep(400);
  say('clicked the road', await state());
  await page.screenshot({ path: `${out}/4-verdict-lose.png` });
} else console.log(`${at()}s he never spoke, nothing to cut off`);
await waitFor(8, () => Boolean(window.jevRoads.game.ride.view().offer));
const s1 = await state();
say('lines offered?', s1);
if (s1.offer) {
  s1.offer.forEach((l) => console.log('      ', l));
  await sleep(1500);
  await page.screenshot({ path: `${out}/5-choice.png` });
  const timer = await page.evaluate(() => document.querySelector('.choice-timer b')?.textContent);
  console.log(`${at()}s the timer says ${timer}`);
  await page.evaluate(() => {
    const o = window.jevRoads.game.ride.view().offer;
    const p = o.lines.find((l) => l.kind === 'provocative') ?? o.lines[0];
    window.jevRoads.game.answer(p.text, p.kind, p.lever);
  });
  await sleep(400);
  say('answered: provocative', await state());
} else say('no lines to answer', s1);
await waitFor(14);
// The cabin is the controls: a click on the radio, on your window, on his screen.
// Each is off to one side of the resting gaze (the radio is low, your window is to your right): look there first, as a hand would drag.
const LOOK = { radio: [0, -0.45, [0.6, 0.66, 0.01]], window: [-1.05, -0.05, [0.3, 1.2, 0.86]], gps: [-0.15, -0.3, [0.72, 0.97, 0.245]] };
const spot = (name) =>
  page.evaluate((name, [yaw, pitch, local]) => {
    const v = window.jevRoads.view;
    v.look.idle = 0;
    v.look.yaw = yaw;
    v.look.pitch = pitch;
    v.frame(0.016);
    v.camera.updateMatrixWorld();
    const p = v.cockpit.group.localToWorld(new window.jevRoads.THREE.Vector3(...local)).project(v.camera);
    const r = v.canvas.getBoundingClientRect();
    return { x: r.left + ((p.x + 1) / 2) * r.width, y: r.top + ((1 - p.y) / 2) * r.height, behind: p.z > 1 };
  }, name, LOOK[name]);
for (const [name, check] of [['radio', () => window.jevRoads.game.ride.view().radio.on], ['window', () => window.jevRoads.game.ride.view().window === 'down'], ['gps', () => Boolean(document.querySelector('.gps.is-big'))]]) {
  await spot(name);
  await sleep(700);
  const pt = await spot(name);
  await page.mouse.move(pt.x, pt.y);
  await sleep(300);
  const hover = await page.evaluate(() => window.jevRoads.view.hovering);
  await page.mouse.click(pt.x, pt.y);
  await sleep(500);
  const ok = await page.evaluate(check);
  console.log(`${at()}s clicked the ${name} at ${Math.round(pt.x)},${Math.round(pt.y)} (hover said "${hover}"): ${ok ? 'it worked' : 'NOTHING HAPPENED'}`);
  if (name === 'gps') {
    await page.screenshot({ path: `${out}/7-map-open.png` });
    await page.keyboard.press('n');
    await sleep(300);
  }
}
await page.evaluate(() => { const v = window.jevRoads.view; v.look.yaw = 0; v.look.pitch = 0; });
say('radio on', await state());
const stream = await page.evaluate(() => window.jevRoads.game.ride.view().radio.stream);
console.log(`${at()}s the radio streams ${stream || 'NOTHING'}`);
await waitFor(30);
say('after 30 s of silence', await state());
const offered = await waitFor(40, () => Boolean(window.jevRoads.game.ride.view().offer));
const s3 = await state();
if (offered && s3.offer) {
  s3.offer.forEach((l) => console.log('      ', l));
  await page.evaluate(() => {
    const o = window.jevRoads.game.ride.view().offer;
    const p = o.lines.find((l) => l.kind === 'curious') ?? o.lines[0];
    window.jevRoads.game.answer(p.text, p.kind, p.lever);
  });
  await sleep(500);
  say('answered: curious', await state());
  await page.screenshot({ path: `${out}/6-verdict-win.png` });
}
// The point of it all: not a friend, and the route shrinks; still the address is never reached.
await waitFor(20);
say('end of the test', await state());
console.log(problems.length ? `PROBLEMS:\n${[...new Set(problems)].slice(0, 12).join('\n')}` : 'no console errors or warnings (402s apart)');
await browser.close();
