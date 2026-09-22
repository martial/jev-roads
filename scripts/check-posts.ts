// Do lamp posts and signals stand clear of the tarmac in the realistic look?  npx tsx scripts/check-posts.ts
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { parseOsm } from '../src/city/osm.ts';
import { buildNetwork } from '../src/city/network.ts';
import { buildBase } from '../src/city/build.ts';
import { Heightfield } from '../src/city/terrain.ts';
import { B } from '../src/engine/blocks.ts';
import { Furniture } from '../src/view/real/furniture.ts';

for (const name of readdirSync('maps').filter((f) => existsSync(`maps/${f}/streets.json`))) {
  const [lat, lon] = name.split('_').map(Number);
  const map = parseOsm(JSON.parse(readFileSync(`maps/${name}/streets.json`, 'utf8')), lat, lon);
  const net = buildNetwork(map);
  const city = buildBase(map, net, { lat, lon });
  // Metres from a point to the edge of the nearest tarmac (negative: on the road).
  const clear = (x: number, z: number) => {
    let best = Infinity;
    for (const road of map.roads)
      for (let i = 1; i < road.points.length; i++) {
        const [ax, az] = road.points[i - 1];
        const [bx, bz] = road.points[i];
        const len2 = (bx - ax) ** 2 + (bz - az) ** 2 || 1;
        const t = Math.min(1, Math.max(0, ((x - ax) * (bx - ax) + (z - az) * (bz - az)) / len2));
        best = Math.min(best, Math.hypot(x - ax - (bx - ax) * t, z - az - (bz - az) * t) - road.width / 2);
      }
    return best;
  };
  const report = (label: string, posts: Array<{ x: number; z: number }>) => {
    const d = posts.map((p) => clear(p.x, p.z));
    const onRoad = d.filter((v) => v < 0.15).length;
    console.log(`  ${label.padEnd(26)} ${String(posts.length).padStart(4)} posts, ${String(onRoad).padStart(3)} on the tarmac, nearest ${d.length ? Math.min(...d).toFixed(2) : '-'} m, typical ${d.length ? d.sort((a, b) => a - b)[Math.floor(d.length / 2)].toFixed(2) : '-'} m from it`);
  };
  console.log(name);
  const old: Array<{ x: number; z: number }> = [];
  for (let i = 0; i < city.lights.length; i += 5) if (city.lights[i + 4] === B.lamp) old.push({ x: city.lights[i] + 0.5, z: city.lights[i + 2] + 0.5 });
  report('lamps, as they were', old);
  report('signals, as they were', city.heads);
  const f = new Furniture(city, new Heightfield(null), net) as unknown as { lamps: Array<{ x: number; z: number }>; heads: Array<{ x: number; z: number }> };
  report('lamps, now', f.lamps);
  report('signals, now', f.heads);
}
