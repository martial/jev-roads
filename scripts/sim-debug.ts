import { readFileSync } from 'node:fs';
import { parseOsm } from '../src/city/osm.ts';
import { buildNetwork } from '../src/city/network.ts';
import { Traffic } from '../src/sim/cars.ts';
const file = process.argv[2] ?? 'maps/43.5263_5.4454.json';
const net = buildNetwork(parseOsm(JSON.parse(readFileSync(file, 'utf8')), ...(file.replace(/^.*\//, '').replace('.json', '').split('_').map(Number) as [number, number])));
const traffic = new Traffic(net, 11);
const core = (traffic as unknown as { core: number[] }).core;
console.log('core lanes', core.length, core.map((id) => `${id}:${net.lanes[id].road.name || net.lanes[id].road.kind}:${Math.round(net.lanes[id].length)}m:r${net.lanes[id].road.rank}`).join('  '));
traffic.target = Number(process.argv[3] ?? 36); traffic.populate(Math.round(traffic.target * 0.7));
const where: Record<string, number> = {};
const dt = 1 / 30;
for (let step = 0; step < 6 * 60 * 30; step++) {
  traffic.step(dt);
  if (step % 30 === 0) for (const c of traffic.cars) if (c.stopped > 30) { const k = `${c.hold || (c.leader ? 'queue' : 'none')}@${c.path < net.lanes.length ? `lane${c.path}(${net.lanes[c.path].road.name || net.lanes[c.path].road.kind}, ${Math.round(net.lanes[c.path].length)}m)` : `conn${c.path - net.lanes.length}`}`; where[k] = (where[k] ?? 0) + 1; }
}
console.log(Object.entries(where).sort((a, b) => b[1] - a[1]).slice(0, 14).map(([k, n]) => `${n}  ${k}`).join('\n'));
const signalled = [...net.junctions.values()].filter((j) => j.signalled);
console.log('signalled junctions:', signalled.map((j) => `${j.node}[${j.approaches.map((a) => `${a}:p${net.lanes[a].phase}`).join(',')}]`).join(' '));
