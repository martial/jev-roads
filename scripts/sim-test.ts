// Headless traffic run with no Jev: does the street keep flowing, and does anyone crash?
//   npx tsx scripts/sim-test.ts [map file] [minutes] [cars]
import { readFileSync } from 'node:fs';
import { parseOsm } from '../src/city/osm.ts';
import { buildNetwork } from '../src/city/network.ts';
import { Traffic } from '../src/sim/cars.ts';

const file = process.argv[2] ?? 'maps/43.5263_5.4454.json';
const minutes = Number(process.argv[3] ?? 10);
const [lat, lon] = file.replace(/^.*\//, '').replace('.json', '').split('_').map(Number);
const net = buildNetwork(parseOsm(JSON.parse(readFileSync(file, 'utf8')), lat, lon));
const traffic = new Traffic(net, 11);
traffic.target = Number(process.argv[4] ?? 36);
let left = 0;
traffic.onLeave = () => left++;
traffic.populate(Math.round(traffic.target * 0.7));
const taxi = traffic.addTaxi();
console.log(`start: ${traffic.cars.length} cars, taxi ${taxi ? 'placed' : 'NOT placed'}`);

let overlaps = 0;
const overlapPairs = new Set<string>();
let worstWait = 0;
const holds: Record<string, number> = {};
const dt = 1 / 30;
for (let step = 0; step < minutes * 60 * 30; step++) {
  traffic.step(dt);
  if (step % 6 === 0) {
    const cars = traffic.cars;
    for (let i = 0; i < cars.length; i++)
      for (let j = i + 1; j < cars.length; j++) {
        const a = cars[i];
        const b = cars[j];
        const d = Math.hypot(a.x - b.x, a.z - b.z);
        if (d < 1.7 && (a.v > 0.5 || b.v > 0.5)) {
          overlaps++;
          overlapPairs.add(`${a.id}-${b.id}`);
        }
      }
    for (const c of cars) {
      worstWait = Math.max(worstWait, c.stopped);
      if (c.hold) holds[c.hold] = (holds[c.hold] ?? 0) + 1;
    }
  }
  if (step % (30 * 60) === 0 && step) {
    const cars = traffic.cars;
    const mean = cars.reduce((s, c) => s + c.v, 0) / Math.max(1, cars.length);
    const stuck = cars.filter((c) => c.stopped > 45).length;
    console.log(`t=${Math.round(traffic.time)}s cars ${cars.length}  mean ${(mean * 3.6).toFixed(0)} km/h  stopped>45s ${stuck}  left so far ${left}  taxi ${taxi && cars.includes(taxi) ? `${(taxi.v * 3.6).toFixed(0)} km/h on ${taxi.path}` : 'gone'}`);
  }
}
console.log(`overlap samples ${overlaps} (${overlapPairs.size} pairs)  longest stop ${worstWait.toFixed(0)} s  holds`, holds);
const stuck = traffic.cars.filter((c) => c.stopped > 45);
for (const c of stuck.slice(0, 8)) console.log(`  stuck: car ${c.id} ${c.driver.card.vehicle} hold=${c.hold} path=${c.path} s=${c.s.toFixed(1)} toLine=${c.toLine.toFixed(1)} leader=${c.leader?.id ?? '-'} gap=${c.gap?.toFixed(1) ?? '-'} route=${c.route.slice(0, 4).join('>')}`);
