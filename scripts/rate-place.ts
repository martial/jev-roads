// How good is a place for the simulation?  npx tsx scripts/rate-place.ts <lat> <lon> [label]
import { loadMap } from '../server/maps.ts';
import { parseOsm } from '../src/city/osm.ts';
import { buildNetwork } from '../src/city/network.ts';
import { Traffic } from '../src/sim/cars.ts';
const [lat, lon] = process.argv.slice(2, 4).map(Number);
const loaded = await loadMap(lat, lon);
const map = parseOsm(loaded.osm as never, lat, lon);
const net = buildNetwork(map);
const traffic = new Traffic(net, 5);
const core = (traffic as unknown as { core: number[] }).core;
const metres = Math.round(net.lanes.reduce((s, l) => s + l.length, 0));
traffic.target = Math.round(metres / 70);
traffic.populate(Math.round(traffic.target * 0.7));
let left = 0;
traffic.onLeave = () => left++;
let speed = 0;
let samples = 0;
let longest = 0;
for (let step = 0; step < 5 * 60 * 30; step++) {
  traffic.step(1 / 30);
  if (step % 30 === 0) for (const c of traffic.cars) (speed += c.v, samples++, (longest = Math.max(longest, c.stopped)));
}
console.log(`${(process.argv[4] ?? '').padEnd(22)} roads ${map.roads.length} bldg ${map.buildings.length} trees ${map.trees.length} | lanes ${net.lanes.length} ${metres} m, junctions ${net.junctions.size}, signalled ${[...net.junctions.values()].filter((j) => j.signalled).length}, sources ${net.lanes.filter((l) => l.source).length}, sinks ${net.lanes.filter((l) => l.sink).length}, loop lanes ${core.length} | 5 min: ${traffic.target} cars, mean ${((speed / samples) * 3.6).toFixed(0)} km/h, ${left} trips done, longest stop ${longest.toFixed(0)} s`);
