import { readFileSync } from 'node:fs';
import { parseOsm, SIZE } from '../src/city/osm.ts';
const dir = process.argv[2]!;
const [lat, lon] = dir.replace(/\/$/, '').replace(/^.*\//, '').split('_').map(Number);
const osm = JSON.parse(readFileSync(`${dir}/streets.json`, 'utf8'));
const tags: Record<string, number> = {};
for (const e of osm.elements) if (e.type === 'way' && e.tags?.natural) tags[e.tags.natural] = (tags[e.tags.natural] ?? 0) + 1;
console.log('natural ways in streets.json:', tags);
const map = parseOsm(osm, lat, lon);
console.log('coast lines', map.coast.length, 'points', map.coast.map((c) => c.length).join(','));
for (const line of map.coast) {
  const inside = line.filter((p) => p[0] >= 0 && p[1] >= 0 && p[0] < SIZE && p[1] < SIZE).length;
  console.log(`  line: ${line.length} pts, ${inside} inside the map, from [${line[0].map(Math.round)}] to [${line[line.length - 1].map(Math.round)}]`);
}
import { buildNetwork } from '../src/city/network.ts';
import { buildBase } from '../src/city/build.ts';
const net = buildNetwork(map);
const city = buildBase(map, net, { lat, lon });
const kinds: Record<number, number> = {};
for (const k of city.ground) kinds[k] = (kinds[k] ?? 0) + 1;
console.log('ground kinds (0 none, 1 road, 2 kerb, 6 sea):', kinds);
