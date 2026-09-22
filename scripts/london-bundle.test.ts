import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

test('London starts from bundled streets, all scenery and terrain with an empty cache and no network', async () => {
  const temporary = await mkdtemp(join(tmpdir(), 'jev-london-'));
  const cache = process.env.CACHE_DIR, fetch = globalThis.fetch;
  process.env.CACHE_DIR = temporary;
  globalThis.fetch = async () => { throw new Error('London must be preloaded'); };
  try {
    const { loadStreets, loadScenery, hasCachedMapData } = await import('../server/maps.ts');
    const { loadTerrain } = await import('../server/terrain.ts');
    const [lat, lon] = [51.5136, -0.1365];
    assert.ok(hasCachedMapData(lat,lon,'streets'));
    assert.ok((await loadStreets(lat,lon)).osm.elements.length > 100);
    for (let i=0;i<9;i++) {
      assert.ok(hasCachedMapData(lat,lon,i));
      assert.ok((await loadScenery(lat,lon,i)).osm.elements.length > 10);
    }
    assert.ok(hasCachedMapData(lat,lon,'terrain'));
    const terrain = await loadTerrain(lat,lon);
    assert.equal(terrain.heights.length,terrain.n**2);
    assert.ok(terrain.cached);
    assert.equal(hasCachedMapData(0,0,'streets'),false);
  } finally {
    if (cache === undefined) delete process.env.CACHE_DIR; else process.env.CACHE_DIR=cache;
    globalThis.fetch = fetch;
    await rm(temporary,{recursive:true,force:true});
  }
});
