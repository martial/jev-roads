// What a passenger can ask for. Jev understands the words; only the code knows what actually exists on
// this map and where: street names, the sea, water, parks, landmarks, the edges of the map.

import type { City } from '../city/build';
import type { Network } from '../city/network';
import { SIZE } from '../city/osm';
import { MAX_PLACES } from '../../shared/drive';
import type { Car } from './cars';

export interface PlaceOption {
  label: string;
  /** Lanes that count as being there, best first. */
  lanes: number[];
}

const SEA = 6;
const WATER = 5;
const GREEN = 4;

export function placesOn(net: Network, city: City): PlaceOption[] {
  const places: PlaceOption[] = [];
  const drivable = net.lanes.filter((l) => l.length > 8);
  const mid = (id: number) => net.lanes[id].points[Math.floor(net.lanes[id].points.length / 2)];

  // Lanes that run beside a kind of ground: the seafront, the riverside, the park.
  const beside = (kind: number, reach: number) => {
    const found: Array<{ id: number; d: number }> = [];
    for (const lane of drivable) {
      const [x, z] = mid(lane.id);
      let best = Infinity;
      for (let dz = -reach; dz <= reach; dz += 4)
        for (let dx = -reach; dx <= reach; dx += 4) {
          const [cx, cz] = [Math.floor(x + dx), Math.floor(z + dz)];
          if (cx < 0 || cz < 0 || cx >= SIZE || cz >= SIZE || city.ground[cz * SIZE + cx] !== kind) continue;
          best = Math.min(best, Math.hypot(dx, dz));
        }
      if (best < Infinity) found.push({ id: lane.id, d: best });
    }
    return found.sort((a, b) => a.d - b.d).slice(0, 12).map((f) => f.id);
  };
  const sea = beside(SEA, 60);
  if (sea.length) places.push({ label: 'the sea: the seafront, the harbour, the port, the beach, la mer', lanes: sea });
  const water = beside(WATER, 50);
  if (water.length) places.push({ label: 'the water: the river, the lake, the canal, the fountain', lanes: water });
  const green = beside(GREEN, 40);
  if (green.length) places.push({ label: 'the park: the gardens, the green, somewhere with trees', lanes: green });

  // Landmarks the map names.
  const nearest = (x: number, z: number, count: number) =>
    drivable
      .map((l) => ({ id: l.id, d: Math.hypot(mid(l.id)[0] - x, mid(l.id)[1] - z) }))
      .sort((a, b) => a.d - b.d)
      .slice(0, count)
      .filter((l) => l.d < 160)
      .map((l) => l.id);
  const named = city.buildings.filter((b) => b.name && (b.monument || b.name.length > 3)).sort((a, b) => Number(b.monument) - Number(a.monument) || b.height - a.height);
  const seen = new Set<string>();
  for (const b of named.slice(0, 40)) {
    if (seen.has(b.name)) continue;
    seen.add(b.name);
    const cx = b.points.reduce((s, p) => s + p[0], 0) / b.points.length;
    const cz = b.points.reduce((s, p) => s + p[1], 0) / b.points.length;
    const lanes = nearest(cx, cz, 4);
    if (lanes.length) places.push({ label: b.name, lanes });
  }

  // The middle, and the four ways out of town.
  places.push({ label: 'the middle of the map: the town centre, downtown', lanes: nearest(SIZE / 2, SIZE / 2, 6) });
  const exits = net.lanes.filter((l) => l.sink);
  const end = (id: number) => net.lanes[id].points[net.lanes[id].points.length - 1];
  const edge = (label: string, score: (p: [number, number]) => number) => {
    const lanes = exits.map((l) => l.id).sort((a, b) => score(end(b)) - score(end(a))).slice(0, 4);
    if (lanes.length) places.push({ label, lanes });
  };
  edge('north: out of town to the north', (p) => -p[1]);
  edge('south: out of town to the south', (p) => p[1]);
  edge('east: out of town to the east', (p) => p[0]);
  edge('west: out of town to the west', (p) => -p[0]);

  // Every named street, the longest first.
  const streets = new Map<string, { lanes: number[]; metres: number }>();
  for (const lane of drivable) {
    if (!lane.road.name) continue;
    const s = streets.get(lane.road.name) ?? { lanes: [], metres: 0 };
    s.lanes.push(lane.id);
    s.metres += lane.length;
    streets.set(lane.road.name, s);
  }
  for (const [label, s] of [...streets].sort((a, b) => b[1].metres - a[1].metres)) {
    if (places.length >= MAX_PLACES) break;
    places.push({ label, lanes: s.lanes });
  }
  return places;
}

/** "#c9473c" -> "red": what a passenger would call that paint. */
export function colourName(hex: string): string {
  const [r, g, b] = [1, 3, 5].map((i) => Number.parseInt(hex.slice(i, i + 2), 16) / 255);
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const light = (max + min) / 2;
  const sat = max === min ? 0 : (max - min) / (1 - Math.abs(2 * light - 1));
  if (sat < 0.16) return light > 0.8 ? 'white' : light > 0.55 ? 'silver grey' : light > 0.25 ? 'grey' : 'black';
  let hue = max === r ? ((g - b) / (max - min)) % 6 : max === g ? (b - r) / (max - min) + 2 : (r - g) / (max - min) + 4;
  hue = (hue * 60 + 360) % 360;
  if (light > 0.82) return 'cream white';
  const name = hue < 18 || hue >= 340 ? 'red' : hue < 42 ? 'orange' : hue < 68 ? 'yellow' : hue < 165 ? 'green' : hue < 200 ? 'teal' : hue < 255 ? 'blue' : hue < 295 ? 'purple' : 'pink';
  if (name === 'red' && light > 0.7) return 'pink';
  if ((name === 'yellow' || name === 'orange') && sat < 0.45 && light > 0.6) return 'beige';
  if (name === 'green' && sat < 0.35) return light > 0.6 ? 'pale green' : 'olive green';
  return light < 0.3 ? `dark ${name}` : name;
}

/** The vehicles around a car, described the way a passenger would point them out. */
export function vehiclesAround(me: Car, cars: Car[], count: number): Array<{ label: string; car: Car }> {
  return cars
    .filter((c) => c !== me)
    .map((car) => {
      const [dx, dz] = [car.x - me.x, car.z - me.z];
      const ahead = dx * me.dx + dz * me.dz;
      const right = -dx * me.dz + dz * me.dx;
      return { car, d: Math.hypot(dx, dz), ahead, right };
    })
    .filter((v) => v.d < 140)
    // Ahead counts for more than behind: that is where a passenger points.
    .sort((a, b) => a.d - Math.max(0, a.ahead) * 0.4 - (b.d - Math.max(0, b.ahead) * 0.4))
    .slice(0, count)
    .map((v) => {
      const where = Math.abs(v.ahead) > Math.abs(v.right) * 0.8 ? (v.ahead > 0 ? 'ahead' : 'behind') : v.right > 0 ? 'to the right' : 'to the left';
      const colour = colourName(v.car.driver.color);
      const vehicle = v.car.driver.card.vehicle;
      // "red convertible" and "white delivery van" already say their colour.
      const named = colour.split(' ').some((word) => vehicle.includes(word));
      return { car: v.car, label: `${named ? '' : `${colour} `}${vehicle}, ${Math.round(v.d)} m ${where}` };
    });
}
