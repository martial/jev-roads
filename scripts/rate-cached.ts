// Rate every cached map without touching the network: npx tsx scripts/rate-cached.ts [minutes]
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { parseOsm } from '../src/city/osm.ts';
import { buildNetwork } from '../src/city/network.ts';
import { Traffic, capacity } from '../src/sim/cars.ts';
const minutes = Number(process.argv[2] ?? 8);
for (const name of readdirSync('maps').filter((f) => existsSync(`maps/${f}/streets.json`))) {
  const [lat, lon] = name.split('_').map(Number);
  const started = Date.now();
  const net = buildNetwork(parseOsm(JSON.parse(readFileSync(`maps/${name}/streets.json`, 'utf8')), lat, lon));
  const built = Date.now() - started;
  const traffic = new Traffic(net, 5);
  const metres = Math.round(net.lanes.reduce((s, l) => s + l.length, 0));
  traffic.target = Math.round(capacity(net) * Number(process.argv[3] ?? 1));
  traffic.populate(Math.round(traffic.target * 0.7));
  let left = 0, speed = 0, samples = 0, longest = 0, overlaps = 0, stuckNow = 0;
  traffic.onLeave = () => left++;
  for (let step = 0; step < minutes * 60 * 30; step++) {
    traffic.step(1 / 30);
    if (step % 30 === 0) {
      for (const c of traffic.cars) (speed += c.v, samples++, (longest = Math.max(longest, c.stopped)));
      for (let i = 0; i < traffic.cars.length; i++) for (let j = i + 1; j < traffic.cars.length; j++) { const a = traffic.cars[i], b = traffic.cars[j]; if (Math.hypot(a.x - b.x, a.z - b.z) < 1.6 && (a.v > 0.5 || b.v > 0.5)) overlaps++; }
    }
  }
  stuckNow = traffic.cars.filter((c) => c.stopped > 60).length;
  console.log(`${name.padEnd(16)} network ${built} ms, sim ${Math.round((Date.now() - started - built) / 100) / 10} s | lanes ${net.lanes.length}, signalled ${[...net.junctions.values()].filter((j) => j.signalled).length}/${net.junctions.size} | ${minutes} min, ${traffic.target} cars: mean ${((speed / samples) * 3.6).toFixed(0)} km/h, ${left} trips, longest stop ${longest.toFixed(0)} s, stuck>60s at end ${stuckNow}, overlaps ${overlaps}, towed ${traffic.towed}`);
}
