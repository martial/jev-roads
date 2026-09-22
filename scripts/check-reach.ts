import { readFileSync } from 'node:fs';
import { parseOsm } from '../src/city/osm.ts';
import { buildNetwork } from '../src/city/network.ts';
const file = process.argv[2] ?? 'maps/43.5263_5.4454.json';
const [lat, lon] = file.replace(/^.*\//, '').replace('.json', '').split('_').map(Number);
const map = parseOsm(JSON.parse(readFileSync(file, 'utf8')), lat, lon);
const net = buildNetwork(map);
const reach = (from: number) => {
  const seen = new Set([from]);
  const todo = [from];
  while (todo.length) for (const c of net.lanes[todo.pop()!].out) { const t = net.connectors[c].to; if (!seen.has(t)) (seen.add(t), todo.push(t)); }
  return seen;
};
const inMap = map.roads.filter((r) => r.points.some((p) => p[0] > 3 && p[1] > 3 && p[0] < 381 && p[1] < 381));
console.log('roads touching the map', inMap.length, 'of', map.roads.length, ' kinds', Object.entries(inMap.reduce((m: Record<string, number>, r) => ((m[r.kind] = (m[r.kind] ?? 0) + 1), m), {})).map(([k, n]) => `${k}:${n}`).join(' '));
for (const l of net.lanes.filter((l) => l.source)) {
  const seen = reach(l.id);
  console.log(`source ${l.id} ${l.road.name || l.road.kind} -> reaches ${seen.size} lanes, ${[...seen].filter((i) => net.lanes[i].sink).length} sinks`);
}
const stuck = net.lanes.filter((l) => !l.sink && !l.out.length);
for (const l of stuck) console.log('no way out:', l.id, l.road.name, l.road.kind, 'at node', l.toNode, 'end', l.points[l.points.length - 1].map(Math.round));
const noIn = net.lanes.filter((l) => !l.source && !net.connectors.some((c) => c.to === l.id));
console.log('lanes nobody can enter:', noIn.length, noIn.map((l) => `${l.id}:${l.road.name || l.road.kind}`).join(', '));
