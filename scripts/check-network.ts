// Sanity check of the lane network on a cached map: npx tsx scripts/check-network.ts [file]
import { readFileSync } from 'node:fs';
import { parseOsm } from '../src/city/osm.ts';
import { buildNetwork, route } from '../src/city/network.ts';

const file = process.argv[2] ?? 'maps/48.8738_2.2950/streets.json';
const [lat, lon] = file.replace(/\/streets\.json$/, '').replace(/^.*\//, '').split('_').map(Number);
const map = parseOsm(JSON.parse(readFileSync(file, 'utf8')), lat, lon);
const net = buildNetwork(map);
const lanes = net.lanes;
console.log(`roads ${map.roads.length}  buildings ${map.buildings.length}  trees ${map.trees.length}  crossings ${map.crossings.length}`);
console.log(`lanes ${lanes.length} (${Math.round(lanes.reduce((s, l) => s + l.length, 0))} m)  connectors ${net.connectors.length}  junctions ${net.junctions.size}  signalled ${[...net.junctions.values()].filter((j) => j.signalled).length}`);
console.log(`sources ${lanes.filter((l) => l.source).length}  sinks ${lanes.filter((l) => l.sink).length}  dead ends (no way out) ${lanes.filter((l) => !l.sink && !l.out.length).length}  with signs ${lanes.filter((l) => l.sign).length}`);
const turns: Record<string, number> = {};
for (const c of net.connectors) turns[c.turn] = (turns[c.turn] ?? 0) + 1;
console.log('turns', turns, ' conflicts', net.connectors.reduce((s, c) => s + c.conflicts.length, 0) / 2, ' give-ways', net.connectors.reduce((s, c) => s + c.yieldsTo.length, 0));
let ok = 0;
let hops = 0;
const tries = 300;
for (let i = 0; i < tries; i++) {
  const a = lanes[Math.floor(Math.random() * lanes.length)];
  const b = lanes[Math.floor(Math.random() * lanes.length)];
  const r = route(net, a.id, b.id, () => 0);
  if (r) (ok++, (hops += r.length));
}
console.log(`random routes found ${ok}/${tries}, average ${(hops / Math.max(1, ok)).toFixed(1)} lanes`);
console.log('shortest lanes', lanes.map((l) => l.length).sort((a, b) => a - b).slice(0, 6).map((n) => n.toFixed(1)).join(', '), ' longest', Math.max(...lanes.map((l) => l.length)).toFixed(0));
