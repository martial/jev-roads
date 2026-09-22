import { readFileSync } from 'node:fs';
import { parseOsm } from '../src/city/osm.ts';
import { buildNetwork } from '../src/city/network.ts';
import { Traffic, capacity, type Car } from '../src/sim/cars.ts';
const file = process.argv[2]!;
const [lat, lon] = file.replace(/\/streets\.json$/, '').replace(/^.*\//, '').split('_').map(Number);
const net = buildNetwork(parseOsm(JSON.parse(readFileSync(file, 'utf8')), lat, lon));
const traffic = new Traffic(net, 5);
const L = net.lanes.length;
traffic.target = Math.round(capacity(net) * Number(process.argv[4] ?? 1));
traffic.populate(Math.round(traffic.target * 0.7));
const name = (p: number) => (p < L ? `lane${p}(${(net.lanes[p].road.name || net.lanes[p].road.kind).slice(0, 18)},${Math.round(net.lanes[p].length)}m)` : `conn${p - L}[${net.connectors[p - L].from}>${net.connectors[p - L].to} ${net.connectors[p - L].turn} ${Math.round(net.connectors[p - L].length)}m]`);
let reported = false;
for (let step = 0; step < 10 * 60 * 30 && !reported; step++) {
  traffic.step(1 / 30);
  const stuck = traffic.cars.filter((c) => c.stopped > 40 && c.hold !== "red");
  const chainIds = new Set<number>(); for (const c0 of stuck) { let o: Car | null = c0; for (let h = 0; o && h < 8; h++) { chainIds.add(o.id); o = o.leader; } }
  const all = traffic.cars.filter((c) => chainIds.has(c.id));
  if (stuck.length >= Number(process.argv[3] ?? 6)) {
    reported = true;
    console.log(`t=${Math.round(traffic.time)}s, ${stuck.length} cars stopped > 50 s`);
    const onPath = (traffic as unknown as { onPath: Car[][] }).onPath;
    for (const c of all.sort((a, b) => b.stopped - a.stopped).slice(0, 22)) {
      let why = '';
      if (c.path < L && c.route[1] !== undefined) {
        const conn = traffic.connectorBetween(c.path, c.route[1]);
        const who = conn ? traffic.crosser(c, conn) : null;
        if (conn) why = `${who ? `BLOCKED BY car${who.car.id} (v=${who.car.v.toFixed(1)} hold=${who.car.hold || '-'} stopped ${Math.round(who.car.stopped)}s): ${who.why} | ` : ''}next ${name(L + conn.id)} -> lane${conn.to}(${Math.round(net.lanes[conn.to].length)}m, ${onPath[conn.to].length} cars) yields to ${conn.yieldsTo.length}, conflicts ${conn.conflicts.length}, light ${traffic.light(net.lanes[c.path]) ?? '-'}`;
      }
      console.log(`  car${c.id} ${c.driver.body.kind} v=${c.v.toFixed(1)} style=${c.style} stopped ${Math.round(c.stopped)}s hold=${c.hold || '-'} on ${name(c.path)} s=${c.s.toFixed(1)} toLine=${c.toLine.toFixed(1)} leader=${c.leader ? `car${c.leader.id}` : '-'} gap=${c.gap?.toFixed(1) ?? '-'} ${why}`);
    }
  }
}
if (!reported) console.log('no gridlock in 10 minutes');
