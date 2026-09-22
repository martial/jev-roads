import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { DriverPhone, PHONE_PENALTY } from '../src/sim/phone.ts';
import { Ride } from '../src/sim/ride.ts';
import type { Chatter } from '../src/sim/chatter.ts';
import { parseOsm, footprintsOf, insideRing, type Building, type CityMap, type Road } from '../src/city/osm.ts';
import { buildNetwork, along, makePath } from '../src/city/network.ts';
import { RoadClearance } from '../src/city/clearance.ts';
import { londonDriver } from '../shared/london.ts';

const empty = (): CityMap => parseOsm({ elements: [] }, 0, 0);
const house: Building = { id: 1, name: '', points: [[100, 100], [140, 100], [140, 140], [100, 140]], height: 10, monument: false, arch: false };
const contains = (b: Building, x: number, z: number) => footprintsOf(b).some(([ring, ...holes]) => insideRing(x, z, ring) && !holes.some(h => insideRing(x, z, h)));
const road: Road = { id: 1, nodeIds: [1, 2], points: [[80, 120], [160, 120]], name: 'Test Street', kind: 'residential', oneway: false, lanes: 2, width: 7, rank: 2, limit: 8.3 };

test('calls ring, connect, pause with the view, finish naturally, and do not repeat the same caller', () => {
  const phone = new DriverPhone(true, () => 0);
  phone.reset();
  assert.equal(phone.update(21, false), false);
  assert.equal(phone.update(21, true), true);
  assert.equal(phone.phase, 'ringing');
  const first = phone.caller;
  phone.update(100, false);
  assert.equal(phone.elapsed, 0);
  phone.update(6, true);
  assert.equal(phone.phase, 'talking');
  phone.update(32, true);
  assert.equal(phone.phase, 'idle');
  phone.update(91, true);
  assert.notEqual(phone.caller, first);
  phone.end(); phone.enabled = false;
  assert.equal(phone.start(), false);
  phone.update(1000, true);
  assert.equal(phone.phase, 'idle');
});

test('Interrupt charges once in both ringing and between spoken lines, with no ordinary-story penalty', () => {
  const chatter = { setPhone() {}, prompt() {}, talk: { speaking: false }, gags: { fare: 4, perKm: 8 }, waiting: false } as unknown as Chatter;
  for (const phase of ['ringing', 'talking'] as const) {
    const ride = new Ride(chatter, () => {});
    ride.phase = 'riding'; ride.sympathie = 30;
    ride.ringPhone(); ride.phone.phase = phase;
    ride.interrupt();
    assert.equal(ride.sympathie, 30 - PHONE_PENALTY);
    assert.equal(ride.view().verdict?.points, -PHONE_PENALTY);
    assert.equal(ride.phone.phase, 'idle');
    ride.interruptPhone();
    assert.equal(ride.sympathie, 30 - PHONE_PENALTY);
  }
});

test('road clearance splits conflicting buildings, preserves the rest, and reserves turns too', () => {
  const map = { ...empty(), roads: [road] };
  const net = buildNetwork(map);
  const far = { ...house, id: 2, points: house.points.map(([x, z]) => [x, z + 200] as [number, number]) };
  const [clipped, untouched] = new RoadClearance(map, net).prepare([house, far]);
  assert.equal(footprintsOf(clipped).length, 2);
  assert.equal(contains(clipped, 120, 120), false);
  assert.equal(contains(clipped, 120, 104), true);
  assert.equal(untouched, far);
  const turn = { ...net.connectors[0], ...makePath([[120, 80], [120, 160]]) };
  const [withTurn] = new RoadClearance(empty(), { ...net, lanes: [], connectors: [turn] }).prepare([house]);
  assert.equal(contains(withTurn, 120, 115), false);
  assert.equal(contains(withTurn, 104, 115), true);
});

test('multipolygon courtyards survive and their tagged member ways do not fill them back in', () => {
  const xy = [[0,0],[.001,0],[.001,.001],[0,.001],[.0002,.0002],[.0008,.0002],[.0008,.0008],[.0002,.0008]];
  const osm = { elements: [
    ...xy.map(([lon, lat], i) => ({ type: 'node' as const, id: i + 1, lon, lat })),
    { type: 'way' as const, id: 10, nodes: [1,2,3,4,1], tags: { building: 'yes' } },
    { type: 'way' as const, id: 11, nodes: [5,6,7,8,5] },
    { type: 'relation' as const, id: 30, tags: { building: 'yes' }, members: [{ type: 'way', ref: 10, role: 'outer' }, { type: 'way', ref: 11, role: 'inner' }] },
  ] };
  const map = parseOsm(osm, 0, 0);
  assert.equal(map.buildings.length, 1);
  const building = map.buildings[0];
  assert.equal(footprintsOf(building)[0].length, 2);
  assert.equal(contains(building, 512 + 55, 512 - 55), false);
  assert.equal(contains(building, 512 + 10, 512 - 10), true);
});

test('UK lanes run on the left; mph tags become correct simulation speeds; London cast is preloaded', () => {
  const map = { ...empty(), roads: [road] };
  for (const [side, offset] of [['left', -1], ['right', 1]] as const) {
    const forward = buildNetwork(map, side).lanes.find(l => l.forward)!;
    assert.ok((along(forward, 10).z - 120) * offset > 0);
  }
  const mapMph = parseOsm({ elements: [
    { type: 'node', id: 1, lat: 0, lon: 0 }, { type: 'node', id: 2, lat: 0, lon: .001 },
    { type: 'way', id: 1, nodes: [1,2], tags: { highway: 'residential', maxspeed: '20 mph' } },
  ] }, 0, 0);
  assert.ok(Math.abs(mapMph.roads[0].limit - 8.9408) < 1e-6);
  for (const sex of ['m', 'f'] as const) {
    const driver = londonDriver(sex);
    assert.equal(driver.sex, sex);
    assert.equal(driver.locale, 'en-GB');
    assert.ok(driver.grievances.some(g => g.includes('Blackwall')));
  }
});

for (const place of ['44.5854_-0.2962', '43.2526_5.5517', '51.5136_-0.1365']) {
  test(`cached ${place}: no lane or connector enters a reconstructed building`, { skip: !existsSync(`maps/${place}/streets.json`) }, () => {
    const [lat, lon] = place.split('_').map(Number);
    const read = (file: string) => JSON.parse(readFileSync(`maps/${place}/${file}`, 'utf8'));
    const map = parseOsm(read('streets.json'), lat, lon);
    const net = buildNetwork(map, lat > 50 ? 'left' : 'right');
    const scenery = [...new Map(readdirSync(`maps/${place}`).filter(n => n.startsWith('scenery-')).flatMap(n => parseOsm(read(n), lat, lon).buildings).map(b => [b.id, b])).values()];
    assert.ok(scenery.length > 100);
    const buildings = new RoadClearance(map, net).prepare(scenery).filter(b => !b.arch).map(b => ({ b, minX: Math.min(...b.points.map(p => p[0])) - 1, maxX: Math.max(...b.points.map(p => p[0])) + 1, minZ: Math.min(...b.points.map(p => p[1])) - 1, maxZ: Math.max(...b.points.map(p => p[1])) + 1 }));
    for (const path of [...net.lanes, ...net.connectors]) for (let s = 0; s <= path.length; s += 1) {
      const p = along(path, s);
      for (const {b,minX,maxX,minZ,maxZ} of buildings) if (p.x >= minX && p.x <= maxX && p.z >= minZ && p.z <= maxZ) assert.equal(contains(b, p.x, p.z), false, `path ${path.id}, building ${b.id}`);
    }
  });
}
