import assert from 'node:assert/strict';
import { test } from 'node:test';
import { CabinPhysics, type CabinForces } from '../src/sim/cabin.ts';
import { Ride } from '../src/sim/ride.ts';
import type { Chatter } from '../src/sim/chatter.ts';
import type { Traffic } from '../src/sim/cars.ts';

const still: CabinForces = { acceleration: 0, lateral: 0, speed: 0, windowOpen: false };
const run = (p: CabinPhysics, seconds: number, forces = still, fps = 60) => {
  for (let i = 0; i < seconds * fps; i++) p.step(1 / fps, forces);
};
const axes = (p: CabinPhysics) => [p.fore, p.side, p.twist, p.dog];

test('a flick moves the tree and a poke nods the dog; both settle at rest', () => {
  const p = new CabinPhysics();
  p.flickTree(); p.pokeDog(); run(p, .1);
  for (const axis of axes(p)) assert.ok(Math.abs(axis.angle) > .05);
  run(p, 15);
  for (const axis of axes(p)) {
    assert.ok(Math.abs(axis.angle) < .001);
    assert.ok(Math.abs(axis.velocity) < .001);
  }
});

test('each cabin topic offers three distinct choices, charges only a selected question, and cannot farm compliments', () => {
  const replies: string[] = [];
  const chatter = { setPhone() {}, prompt() {}, reply(text: string) { replies.push(text); }, talk: { speaking: false }, gags: { fare: 4, perKm: 8 }, waiting: false } as unknown as Chatter;
  for (const topic of ['meter', 'newspaper', 'vents', 'mirror'] as const) {
    const ride = new Ride(chatter, () => {});
    ride.phase = 'riding'; ride.sympathie = 50;
    assert.equal(ride.touchCabin(topic), true);
    assert.equal(ride.sympathie, 50);
    assert.equal(ride.view().offer?.lines.length, 3);
    assert.equal(new Set(ride.view().offer?.lines.map(l => l.text)).size, 3);
    assert.equal(ride.view().offer?.topic, topic);
    assert.equal(chatter.waiting, true);
    ride.dismissCabinChoice();
    assert.equal(ride.sympathie, 50); assert.equal(chatter.waiting, false);
    ride.touchCabin(topic);
    const curious = ride.view().offer!.lines.find(l=>l.kind==='curious')!;
    ride.answer(curious); assert.equal(ride.sympathie, 53);
    ride.touchCabin(topic); ride.answer(curious); assert.equal(ride.sympathie, 53);
    ride.touchCabin(topic);
    const rude = ride.view().offer!.lines.find(l=>l.kind==='provocative')!;
    ride.answer(rude); assert.equal(ride.sympathie, 45);
    ride.answer(rude); assert.equal(ride.sympathie, 45);
    assert.equal(replies.at(-1), rude.text);
    ride.ringPhone(); assert.equal(ride.touchCabin(topic), false);
    assert.equal(ride.view().offer, null); assert.equal(ride.phone.phase, 'ringing');
  }
});

test('braking and cornering push the hanging tree opposite to acceleration; window breeze adds motion', () => {
  const brake = new CabinPhysics(), corner = new CabinPhysics(), closed = new CabinPhysics(), open = new CabinPhysics();
  run(brake, .2, { ...still, acceleration: -4 });
  run(corner, .2, { ...still, lateral: 4 });
  assert.ok(brake.fore.angle > .1);
  assert.ok(corner.side.angle < -.1);
  run(closed, 3, { ...still, speed: 15 });
  let twistPeak = 0;
  for (let i = 0; i < 180; i++) {
    open.step(1 / 60, { ...still, speed: 15, windowOpen: true });
    twistPeak = Math.max(twistPeak, Math.abs(open.twist.angle));
  }
  assert.equal(closed.side.angle, 0);
  assert.ok(Math.abs(open.side.angle) > .01);
  assert.ok(twistPeak > .01);
});

test('30, 60 and 120 fps produce the same motion; pauses and repeated flicks stay bounded', () => {
  const results = [30, 60, 120].map(fps => {
    const p = new CabinPhysics(); p.flickTree(); p.pokeDog();
    run(p, 5, { acceleration: 3, lateral: -2, speed: 15, windowOpen: true }, fps);
    return axes(p).flatMap(a => [a.angle, a.velocity]);
  });
  assert.deepEqual(results[0], results[1]); assert.deepEqual(results[1], results[2]);
  const p = new CabinPhysics();
  for (let i = 0; i < 1000; i++) {
    p.flickTree(); p.pokeDog();
    p.step(i % 2 ? 10 : NaN, { acceleration: i % 3 ? 100 : NaN, lateral: -100, speed: Infinity, windowOpen: true });
    for (const a of axes(p)) assert.ok(Number.isFinite(a.angle) && Math.abs(a.angle) < 1.2 && Number.isFinite(a.velocity));
  }
  p.reset(); assert.deepEqual(axes(p).map(a => [a.angle, a.velocity]), [[0,0],[0,0],[0,0],[0,0]]);
});

test('cabin actions toggle, avoid repeated scoring, preserve a call, and reset in a new town', t => {
  let now = 0;
  t.mock.method(performance, 'now', () => now);
  const prompts: string[] = [];
  const chatter = { setPhone() {}, prompt(s: string) { prompts.push(s); }, talk: { speaking: false }, gags: { fare: 4, perKm: 8 }, waiting: false } as unknown as Chatter;
  const ride = new Ride(chatter, () => {});
  assert.equal(ride.touchCabin('dog'), false);
  ride.phase = 'riding'; ride.sympathie = 30;
  assert.equal(ride.touchCabin('dog'), true); assert.equal(ride.sympathie, 32);
  assert.equal(ride.touchCabin('dog'), false);
  now += 11000;
  ride.touchCabin('dog'); assert.equal(ride.sympathie, 32);
  ride.ringPhone(); ride.touchCabin('tree');
  assert.equal(ride.phone.phase, 'ringing'); assert.equal(ride.sympathie, 31);
  now += 500;
  ride.touchCabin('tree'); assert.equal(ride.sympathie, 31);
  ride.touchCabin('glovebox'); assert.equal(ride.view().cabin.gloveboxOpen, true); assert.equal(ride.sympathie, 27);
  now += 500;
  ride.touchCabin('glovebox'); assert.equal(ride.view().cabin.gloveboxOpen, false); assert.equal(ride.sympathie, 27);
  ride.touchCabin('visor'); assert.equal(ride.view().cabin.visorDown, true);
  now += 500;
  ride.touchCabin('visor'); assert.equal(ride.view().cabin.visorDown, false);
  assert.ok(prompts.some(s => s.includes('parking tickets')));
  assert.ok(prompts.some(s => s.includes('sun visor')));
  ride.setPlace({ name: 'Test', lat: 0, lon: 0 }, {} as Traffic, []);
  assert.deepEqual(ride.view().cabin, { gloveboxOpen: false, visorDown: false, dogPetted: false });
  ride.phase = 'riding'; ride.touchCabin('dog'); assert.equal(ride.sympathie, 29);
});
