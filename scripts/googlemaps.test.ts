import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { paintedVehicle } from '../server/vehicle.ts';
import { boundsAround, cameraPose, toLatLng, toWorld } from '../src/maps/coordinates.ts';
import { mapProvider, worldMode } from '../src/maps/preferences.ts';

const document = (buffer: Buffer) => JSON.parse(buffer.subarray(20, 20 + buffer.readUInt32LE(12)).toString());
const binary = (buffer: Buffer) => buffer.subarray(20 + buffer.readUInt32LE(12));

test('plain root defaults to Google + Reconstructed, independently of the old experimental preferences', () => {
  const saved = new Map([['jev-roads:maps', 'osm'], ['jev-roads:google-scene', 'tiles']]);
  Object.defineProperty(globalThis, 'location', { configurable: true, value: { search: '' } });
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: { getItem: (key: string) => saved.get(key) ?? null } });
  try {
    assert.equal(mapProvider(), 'google');
    assert.equal(worldMode(), 'reconstructed');
    saved.set('jev-roads:world-mode', 'tiles');
    assert.equal(mapProvider(), 'google');
    assert.equal(worldMode(), 'tiles');
    saved.set('jev-roads:world-mode', 'reconstructed');
    assert.equal(mapProvider(), 'google');
    assert.equal(worldMode(), 'reconstructed');
    saved.set('jev-roads:map-provider', 'osm');
    assert.equal(mapProvider(), 'osm');
    assert.equal(worldMode(), 'reconstructed');
  } finally {
    Reflect.deleteProperty(globalThis, 'location');
    Reflect.deleteProperty(globalThis, 'localStorage');
  }
});

test('each Google vehicle keeps its geometry and trim while taking its driver’s paint', async () => {
  for (const model of ['hatch', 'saloon', 'estate', 'suv', 'coupe', 'pickup', 'van', 'bus', 'truck']) {
    const original = await readFile(`public/models/${model}.glb`);
    const white = (await paintedVehicle(model, 'ffffff'))!;
    const blue = (await paintedVehicle(model, '0080ff'))!;
    assert.equal(white.readUInt32LE(8), white.length);
    assert.equal(white.length % 4, 0);
    assert.deepEqual(binary(white), binary(original));
    const a = document(original), b = document(white), c = document(blue);
    assert.deepEqual(a.nodes, b.nodes);
    assert.deepEqual(a.meshes, b.meshes);
    for (let i = 0; i < a.materials.length; i++) {
      if (a.materials[i].name.split('.')[0] === 'paint') {
        assert.deepEqual(b.materials[i].pbrMetallicRoughness.baseColorFactor, [1, 1, 1, 1]);
        const rgba = c.materials[i].pbrMetallicRoughness.baseColorFactor;
        assert.deepEqual([rgba[0], rgba[2], rgba[3]], [0, 1, 1]);
        assert.ok(Math.abs(rgba[1] - 0.2158605) < 0.000001, 'CSS sRGB converted to glTF linear RGB');
      } else assert.deepEqual(a.materials[i], b.materials[i]);
    }
  }
});

test('vehicle requests cannot read arbitrary files or accept malformed paint', async () => {
  for (const [model, colour] of [['../.env', 'ffffff'], ['unknown', 'ffffff'], ['hatch', '#ffffff'], ['hatch', 'xyzxyz'], ['hatch', 'ffffff/../../.env']]) {
    assert.equal(await paintedVehicle(model, colour), null);
  }
});

test('map positions, bounds and compass headings agree with the simulation', () => {
  for (const origin of [{ lat: 43.214, lon: 5.5396 }, { lat: -33.8, lon: 151.2 }, { lat: 0, lon: 0 }]) {
    for (const [x, z] of [[0, 0], [512, 512], [1024, 1024], [173, 826]]) {
      const point = toLatLng(origin, x, z);
      const roundtrip = toWorld(origin, point.lat, point.lng);
      assert.ok(Math.abs(roundtrip[0] - x) < 1e-6 && Math.abs(roundtrip[1] - z) < 1e-6);
    }
    const bounds = boundsAround(origin);
    assert.ok(bounds.south < origin.lat && origin.lat < bounds.north);
    assert.ok(bounds.west < origin.lon && origin.lon < bounds.east);
    for (const [x, z, heading] of [[0, -10, 0], [10, 0, 90], [0, 10, 180], [-10, 0, 270]]) {
      const pose = cameraPose(origin, { x: 512, y: 2, z: 512 }, { x: 512 + x, y: 2, z: 512 + z });
      assert.equal(pose.heading, heading);
      assert.equal(pose.tilt, 90);
      assert.equal(pose.range, 10);
    }
  }
});
