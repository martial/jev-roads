import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

test('reopening cached cities never uses or depends on the external map quota', async () => {
  const temporary = await mkdtemp(join(tmpdir(), 'jev-map-quota-'));
  const previousCache = process.env.CACHE_DIR;
  const realFetch = globalThis.fetch;
  process.env.CACHE_DIR = temporary;
  const folder = join(temporary, 'maps', '43.2140_5.5396');
  await mkdir(folder, { recursive: true });
  await writeFile(join(folder, 'streets.json'), '{"elements":[]}');
  await writeFile(join(folder, 'scenery-4.json'), '{"elements":[]}');
  await writeFile(join(folder, 'terrain.json'), '{"n":2,"heights":[0,0,0,0]}');
  const { api, configFromEnv } = await import('../server/api.ts');
  const { jev, gerard } = configFromEnv({});
  const handler = api(jev, gerard);
  const server = createServer((req, res) => handler(req, res, () => { res.statusCode = 404; res.end(); }));
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  const base = `http://127.0.0.1:${address.port}/api/`;
  const local = ['map?lat=43.214&lon=5.5396', 'terrain?lat=43.214&lon=5.5396', 'scenery?lat=43.214&lon=5.5396&tile=4'];
  let external = 0;
  globalThis.fetch = async (url) => {
    assert.ok(String(url).startsWith('https://nominatim.openstreetmap.org/'), 'Only the stubbed place lookup can make an external request');
    external++;
    return new Response('[]', { status: 200, headers: { 'Content-Type': 'application/json' } });
  };
  try {
    const vehicle = await realFetch(base + 'vehicle/saloon-2288ff.glb');
    const glb = Buffer.from(await vehicle.arrayBuffer());
    assert.equal(vehicle.status, 200);
    assert.equal(vehicle.headers.get('content-type'), 'model/gltf-binary');
    assert.equal(Number(vehicle.headers.get('content-length')), glb.length, 'Native Maps models need the GLB byte length');
    assert.equal(glb.subarray(0, 4).toString(), 'glTF');
    assert.equal(glb.readUInt32LE(8), glb.length);
    for (let i = 0; i < 66; i++) {
      const response = await realFetch(base + local[i % local.length]);
      assert.equal(response.status, 200);
      assert.equal((await response.json()).cached, true);
    }
    for (let i = 0; i < 60; i++) assert.equal((await realFetch(base + 'place?q=quota-test')).status, 404);
    assert.equal((await realFetch(base + 'place?q=quota-test')).status, 429, 'External requests are still limited');
    assert.equal(external, 60);
    for (const path of local) assert.equal((await realFetch(base + path)).status, 200, 'Cached data still works after exhausting the quota');
  } finally {
    globalThis.fetch = realFetch;
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    if (previousCache === undefined) delete process.env.CACHE_DIR;
    else process.env.CACHE_DIR = previousCache;
    await rm(temporary, { recursive: true, force: true });
  }
});
