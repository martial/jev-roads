import { readFileSync } from 'node:fs';
import { parseOsm } from '../src/city/osm.ts';
import { buildNetwork } from '../src/city/network.ts';
const map = parseOsm(JSON.parse(readFileSync('maps/43.5263_5.4454.json', 'utf8')), 43.5263, 5.4454);
const net = buildNetwork(map);
const ring = map.roads.filter((r) => /Gaulle/.test(r.name));
for (const r of ring) console.log(`way ${r.id} oneway=${r.oneway} kind=${r.kind} nodes=${r.nodeIds.length} first=${r.nodeIds[0]} last=${r.nodeIds[r.nodeIds.length - 1]} len=${Math.round(r.points.slice(1).reduce((s, p, i) => s + Math.hypot(p[0] - r.points[i][0], p[1] - r.points[i][1]), 0))}m centre-dist=${Math.round(Math.hypot(r.points[0][0] - 192, r.points[0][1] - 192))}`);
console.log('--- lanes on the ring');
for (const l of net.lanes.filter((l) => /Gaulle/.test(l.road.name))) console.log(`lane ${l.id} way ${l.road.id} ${l.fromNode} -> ${l.toNode} ${l.length.toFixed(1)}m out=[${l.out.map((c) => `${net.connectors[c].to}:${net.connectors[c].turn}`).join(', ')}]`);
