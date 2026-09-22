// The map, block by block. One block is one metre. Roads lie at ground level; everything else
// (kerbs, squares, lawns) is a thin layer above them, and buildings rise from that.

import { B } from '../engine/blocks';
import { Voxels, SY } from '../engine/voxels';
import { along, type Network } from './network';
import { SIZE, footprintsOf, insideRing, type Building, type CityMap, type Pt, type Road } from './osm';

/** Height of the driving surface: cars sit on top of the blocks at y = 0. */
export const ROAD_Y = 1;

const NONE = 0;
const ROAD = 1;
const KERB = 2;
const BUILDING = 3;
const GREEN = 4;
const WATER = 5;
const SEA = 6;

export interface SignalHead {
  lane: number;
  x: number;
  y: number;
  z: number;
  /** Unit vector the lamps face: back towards the approaching driver. */
  fx: number;
  fz: number;
}

export interface City {
  voxels: Voxels;
  heads: SignalHead[];
  /** Blocks that change at night, five numbers each: x, y, z, id by day, id by night. */
  lights: number[];
  /** What stands on each ground cell, for anything that wants to know where the road is. */
  ground: Uint8Array;
  heights: Uint8Array;
  owner: Int32Array;
  /** Distance of a building cell from its outside wall, for roofs that step up towards the middle. */
  depth: Uint8Array;
  buildings: Building[];
  /** Buildings already standing: a house on the border of two tiles arrives twice. */
  built: Set<number>;
  place: { lat: number; lon: number };
  night: boolean;
}

// The south builds in ochre under terracotta; the north in pale stone under zinc and slate.
const SOUTH = { fronts: [B.ochre, B.cream, B.apricot, B.rose, B.stonePale, B.whitewash, B.cream, B.ochre], roof: B.roofTerracotta, other: B.roofSlate, otherShare: 0.1 };
const NORTH = { fronts: [B.limestone, B.cream, B.limestone, B.stonePale, B.whitewash, B.limestone], roof: B.roofZinc, other: B.roofTerracotta, otherShare: 0.12 };

function hash(n: number): number {
  let h = Math.imul(n ^ 0x9e3779b9, 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/** Every cell within `half` of the polyline. */
function stamp(points: Pt[], half: number, put: (x: number, z: number) => void) {
  for (let i = 1; i < points.length; i++) {
    const [ax, az] = points[i - 1];
    const [bx, bz] = points[i];
    const dx = bx - ax;
    const dz = bz - az;
    const len2 = dx * dx + dz * dz || 1;
    const x0 = Math.max(0, Math.floor(Math.min(ax, bx) - half));
    const x1 = Math.min(SIZE - 1, Math.ceil(Math.max(ax, bx) + half));
    const z0 = Math.max(0, Math.floor(Math.min(az, bz) - half));
    const z1 = Math.min(SIZE - 1, Math.ceil(Math.max(az, bz) + half));
    for (let z = z0; z <= z1; z++)
      for (let x = x0; x <= x1; x++) {
        const t = Math.min(1, Math.max(0, ((x + 0.5 - ax) * dx + (z + 0.5 - az) * dz) / len2));
        if (Math.hypot(x + 0.5 - ax - dx * t, z + 0.5 - az - dz * t) <= half) put(x, z);
      }
  }
}

/** Every cell whose centre lies inside the polygon. */
function fill(polygon: Pt[], put: (x: number, z: number) => void) {
  let z0 = Infinity;
  let z1 = -Infinity;
  for (const p of polygon) {
    z0 = Math.min(z0, p[1]);
    z1 = Math.max(z1, p[1]);
  }
  for (let z = Math.max(0, Math.floor(z0)); z <= Math.min(SIZE - 1, Math.ceil(z1)); z++) {
    const crossings: number[] = [];
    for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
      const [ax, az] = polygon[i];
      const [bx, bz] = polygon[j];
      if (az > z + 0.5 !== bz > z + 0.5) crossings.push(ax + ((z + 0.5 - az) / (bz - az)) * (bx - ax));
    }
    crossings.sort((a, b) => a - b);
    for (let k = 0; k + 1 < crossings.length; k += 2)
      for (let x = Math.max(0, Math.ceil(crossings[k] - 0.5)); x <= Math.min(SIZE - 1, Math.floor(crossings[k + 1] - 0.5)); x++) put(x, z);
  }
}

/** Stage one: the ground, the streets and everything painted or planted on them. Enough to drive on. */
export function buildBase(map: CityMap, net: Network, place: { lat: number; lon: number }): City {
  const voxels = new Voxels();
  const ground = new Uint8Array(SIZE * SIZE);
  const lights: number[] = [];
  const at = (x: number, z: number) => (x < 0 || z < 0 || x >= SIZE || z >= SIZE ? NONE : ground[z * SIZE + x]);

  // --- What lies where -----------------------------------------------------------------
  for (const road of map.roads) stamp(road.points, road.width / 2 + (road.kind === 'service' ? 1.2 : 2.6), (x, z) => (ground[z * SIZE + x] = KERB));
  floodSea(map.coast, ground);
  for (const road of map.roads) stamp(road.points, road.width / 2, (x, z) => (ground[z * SIZE + x] = ROAD));
  // Junction mouths: the curves cars actually drive must be on tarmac too.
  for (const c of net.connectors) stamp(c.points, 2.1, (x, z) => (ground[z * SIZE + x] = ROAD));
  for (const lane of net.lanes) stamp(lane.points, 1.6, (x, z) => (ground[z * SIZE + x] = ROAD));

  // --- Ground -----------------------------------------------------------------------------
  // Tarmac is a little more worn where wheels run: along the lanes.
  const worn = new Uint8Array(SIZE * SIZE);
  for (const lane of net.lanes) stamp(lane.points, 0.9, (x, z) => (worn[z * SIZE + x] = 1));
  for (let z = 0; z < SIZE; z++)
    for (let x = 0; x < SIZE; x++) {
      const kind = ground[z * SIZE + x];
      if (kind === ROAD) voxels.set(x, 0, z, worn[z * SIZE + x] ? B.asphaltWorn : B.asphalt);
      else if (kind === SEA) {
        const wet = (k: number) => k === SEA || k === ROAD;
        const rim = !wet(at(x + 1, z)) || !wet(at(x - 1, z)) || !wet(at(x, z + 1)) || !wet(at(x, z - 1));
        const inside = x > 0 && z > 0 && x < SIZE - 1 && z < SIZE - 1;
        voxels.set(x, 0, z, B.sand);
        // A stone edge: the quay of a harbour.
        voxels.set(x, 1, z, rim && inside ? B.stonePale : B.water);
      } else {
        voxels.set(x, 0, z, B.concrete);
        voxels.set(x, 1, z, kind === KERB ? B.kerb : B.paving);
      }
    }

  // --- Road paint ---------------------------------------------------------------------------
  const paint = (x: number, z: number, block: number = B.marking) => {
    const fx = Math.floor(x);
    const fz = Math.floor(z);
    if (at(fx, fz) === ROAD) voxels.set(fx, 0, fz, block);
  };
  const busy = [...net.junctions.values()].filter((j) => j.approaches.length >= 2 || j.connectors.length >= 3);
  // Where junctions are, so that paint and lamp posts keep clear of them.
  const close = new Uint8Array(SIZE * SIZE);
  const disc = (cx: number, cz: number, r: number, put: (x: number, z: number) => void) => {
    for (let z = Math.max(0, Math.floor(cz - r)); z <= Math.min(SIZE - 1, Math.ceil(cz + r)); z++) for (let x = Math.max(0, Math.floor(cx - r)); x <= Math.min(SIZE - 1, Math.ceil(cx + r)); x++) if (Math.hypot(x + 0.5 - cx, z + 0.5 - cz) <= r) put(x, z);
  };
  for (const j of busy) {
    disc(j.x, j.z, 9, (x, z) => (close[z * SIZE + x] = Math.max(close[z * SIZE + x], 1)));
    disc(j.x, j.z, 7, (x, z) => (close[z * SIZE + x] = 2));
  }
  const nearJunction = (x: number, z: number, within: 7 | 9) => {
    const [fx, fz] = [Math.floor(x), Math.floor(z)];
    if (fx < 0 || fz < 0 || fx >= SIZE || fz >= SIZE) return false;
    return close[fz * SIZE + fx] >= (within === 7 ? 2 : 1);
  };
  // Between the two directions: a dashed line on an ordinary street, a solid one on an avenue.
  // Between lanes going the same way: short dashes. Never across a junction.
  for (const lane of net.lanes) {
    if (lane.road.rank < 2) continue;
    const innermost = lane.index === lane.count - 1;
    const centre = innermost && lane.twin !== null && lane.forward;
    if (!centre && innermost) continue;
    const off = lane.count === 1 ? 1.7 : lane.spacing / 2;
    for (let s = 0; s < lane.length; s += 0.5) {
      if (centre ? lane.count === 1 && Math.floor(s / 3) % 2 : Math.floor(s / 3) % 3 !== 0) continue;
      const p = along(lane, s);
      const x = p.x + p.dz * off;
      const z = p.z - p.dx * off;
      if (!nearJunction(x, z, 7)) paint(x, z);
    }
  }
  // Stop lines where it matters: signals, signs, and side roads meeting bigger ones.
  for (const junction of busy)
    for (const id of junction.approaches) {
      const lane = net.lanes[id];
      const mustYield = lane.out.some((c) => net.connectors[c].yieldsTo.some((y) => net.lanes[net.connectors[y].from].stretch !== lane.stretch));
      if (!junction.signalled && !lane.sign && !mustYield) continue;
      const end = along(lane, lane.length);
      const half = lane.count > 1 ? lane.spacing / 2 : lane.road.oneway ? lane.road.width / 2 - 0.6 : 1.5;
      for (let o = -half; o <= half; o += 0.5) paint(end.x - end.dz * o, end.z + end.dx * o);
    }
  // Zebra crossings.
  for (const [cx, cz] of map.crossings) {
    let best: { road: Road; dx: number; dz: number; d: number } | null = null;
    for (const road of map.roads)
      for (let i = 1; i < road.points.length; i++) {
        const [ax, az] = road.points[i - 1];
        const [bx, bz] = road.points[i];
        const len = Math.hypot(bx - ax, bz - az) || 1;
        const t = Math.min(1, Math.max(0, ((cx - ax) * (bx - ax) + (cz - az) * (bz - az)) / (len * len)));
        const d = Math.hypot(cx - ax - (bx - ax) * t, cz - az - (bz - az) * t);
        if (!best || d < best.d) best = { road, dx: (bx - ax) / len, dz: (bz - az) / len, d };
      }
    if (!best || best.d > 3) continue;
    for (let across = -best.road.width / 2; across <= best.road.width / 2; across += 0.5) {
      if (Math.floor(across + 100) % 2) continue;
      for (let a = -1.5; a <= 1.5; a += 0.5) paint(cx + best.dx * a - best.dz * across, cz + best.dz * a + best.dx * across);
    }
  }

  // --- Street furniture -------------------------------------------------------------------------
  const free = (x: number, z: number) => at(x, z) === KERB || at(x, z) === NONE || at(x, z) === GREEN;
  /** First non-road cell to the right of a point on a lane. */
  const kerbside = (x: number, z: number, dx: number, dz: number): Pt | null => {
    for (let o = 1.5; o < 14; o += 0.5) {
      const px = Math.floor(x - dz * o);
      const pz = Math.floor(z + dx * o);
      if (free(px, pz)) return [px, pz];
    }
    return null;
  };
  const heads: SignalHead[] = [];
  for (const junction of net.junctions.values()) {
    if (!junction.signalled) continue;
    for (const id of junction.approaches) {
      const lane = net.lanes[id];
      // One set of lamps per street, by the kerb.
      if (lane.index !== 0) continue;
      const end = along(lane, lane.length);
      // A little past the line, so a driver stopped at it can still see the lamps.
      const spot = kerbside(end.x + end.dx * 2.5, end.z + end.dz * 2.5, end.dx, end.dz) ?? kerbside(end.x, end.z, end.dx, end.dz);
      if (!spot) continue;
      for (let y = 1; y <= 3; y++) voxels.set(spot[0], y, spot[1], B.steel);
      heads.push({ lane: id, x: spot[0] + 0.5, y: 4.6, z: spot[1] + 0.5, fx: -end.dx, fz: -end.dz });
    }
  }
  // Street lamps along the bigger streets, alternating sides.
  for (const lane of net.lanes) {
    if (lane.road.rank < 2 || lane.length < 30 || lane.index !== 0) continue;
    for (let s = 14; s < lane.length - 10; s += 34) {
      const p = along(lane, s);
      const spot = kerbside(p.x, p.z, p.dx, p.dz);
      if (!spot || nearJunction(spot[0], spot[1], 9)) continue;
      for (let y = 1; y <= 5; y++) voxels.set(spot[0], y, spot[1], B.rubber);
      const ax = Math.round(spot[0] + p.dz);
      const az = Math.round(spot[1] - p.dx);
      voxels.set(ax, 6, az, B.rubber);
      voxels.set(spot[0], 6, spot[1], B.rubber);
      voxels.set(ax, 5, az, B.white);
      lights.push(ax, 5, az, B.white, B.lamp);
    }
  }

  return { voxels, heads, lights, ground, heights: new Uint8Array(SIZE * SIZE), owner: new Int32Array(SIZE * SIZE).fill(-1), depth: new Uint8Array(SIZE * SIZE), buildings: [], built: new Set(), place, night: false };
}

/** Stage two, as often as scenery arrives: parks, water, houses and trees of one part of town, added to what stands. */
export function addScenery(city: City, map: CityMap) {
  const { voxels, ground, heights, owner, depth, lights, place } = city;
  const at = (x: number, z: number) => (x < 0 || z < 0 || x >= SIZE || z >= SIZE ? NONE : ground[z * SIZE + x]);
  const disc = (cx: number, cz: number, r: number, put: (x: number, z: number) => void) => {
    for (let z = Math.floor(cz - r); z <= Math.ceil(cz + r); z++) for (let x = Math.floor(cx - r); x <= Math.ceil(cx + r); x++) if (Math.hypot(x + 0.5 - cx, z + 0.5 - cz) <= r) put(x, z);
  };

  // --- Parks and water ---------------------------------------------------------------------------
  for (const polygon of map.green)
    fill(polygon, (x, z) => {
      if (ground[z * SIZE + x] !== NONE) return;
      ground[z * SIZE + x] = GREEN;
      voxels.set(x, 0, z, B.soil);
      voxels.set(x, 1, z, B.lawn);
    });
  const wetCells: number[] = [];
  for (const polygon of map.water)
    fill(polygon, (x, z) => {
      const kind = ground[z * SIZE + x];
      if (kind !== NONE && kind !== GREEN && kind !== KERB) return;
      ground[z * SIZE + x] = WATER;
      wetCells.push(z * SIZE + x);
    });
  for (const polygon of map.islands) fill(polygon, (x, z) => ground[z * SIZE + x] === WATER && (ground[z * SIZE + x] = NONE));
  const wet = (k: number) => k === WATER || k === SEA || k === ROAD;
  for (const i of wetCells) {
    const [x, z] = [i % SIZE, Math.floor(i / SIZE)];
    if (ground[i] !== WATER) {
      voxels.set(x, 0, z, B.concrete);
      voxels.set(x, 1, z, B.paving);
      continue;
    }
    const rim = !wet(at(x + 1, z)) || !wet(at(x - 1, z)) || !wet(at(x, z + 1)) || !wet(at(x, z - 1));
    voxels.set(x, 0, z, B.stonePale);
    // A stone edge all round: the rim of a basin, the bank of a river.
    voxels.set(x, 1, z, rim && x > 0 && z > 0 && x < SIZE - 1 && z < SIZE - 1 ? B.marble : B.water);
  }

  // --- Fountains ----------------------------------------------------------------------------
  for (const polygon of map.basins) {
    const cx = polygon.reduce((s, p) => s + p[0], 0) / polygon.length;
    const cz = polygon.reduce((s, p) => s + p[1], 0) / polygon.length;
    const radius = Math.min(...polygon.map((p) => Math.hypot(p[0] - cx, p[1] - cz)));
    if (radius < 5 || radius > 40) continue;
    // A tiered centrepiece: basin, bowl, column, figures.
    disc(cx, cz, Math.min(4.5, radius * 0.45), (x, z) => [1, 2].forEach((y) => voxels.set(x, y, z, B.marble)));
    disc(cx, cz, Math.min(3.4, radius * 0.34), (x, z) => voxels.set(x, 3, z, B.water));
    disc(cx, cz, 1.6, (x, z) => [3, 4, 5, 6].forEach((y) => voxels.set(x, y, z, B.stonePale)));
    disc(cx, cz, 2.6, (x, z) => voxels.set(x, 7, z, B.marble));
    disc(cx, cz, 1.9, (x, z) => voxels.set(x, 8, z, B.water));
    disc(cx, cz, 0.8, (x, z) => [8, 9, 10, 11].forEach((y) => voxels.set(x, y, z, B.white)));
  }
  for (const [fx, fz] of map.fountains) {
    disc(fx, fz, 2.4, (x, z) => at(x, z) !== ROAD && at(x, z) !== BUILDING && voxels.set(x, 1, z, B.marble));
    disc(fx, fz, 1.5, (x, z) => at(x, z) !== ROAD && at(x, z) !== BUILDING && voxels.set(x, 1, z, B.water));
    if (at(Math.floor(fx), Math.floor(fz)) !== ROAD) [1, 2, 3].forEach((y) => voxels.set(Math.floor(fx), y, Math.floor(fz), B.stonePale));
  }

  // --- Buildings ------------------------------------------------------------------------------
  const cells: number[] = [];
  for (const building of map.buildings) {
    if (city.built.has(building.id)) continue;
    city.built.add(building.id);
    const index = city.buildings.push(building) - 1;
    for (const [outline, ...holes] of footprintsOf(building)) fill(outline, (x, z) => {
      if (holes.some(h => insideRing(x + 0.5, z + 0.5, h))) return;
      const i = z * SIZE + x;
      if (ground[i] === ROAD || ground[i] === BUILDING) return;
      ground[i] = BUILDING;
      heights[i] = Math.min(SY - 6, Math.max(4, building.height));
      owner[i] = index;
      cells.push(i);
    });
  }
  let frontier: number[] = [];
  for (const i of cells) {
    const [x, z] = [i % SIZE, Math.floor(i / SIZE)];
    const edge = [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dz]) => at(x + dx, z + dz) !== BUILDING || owner[(z + dz) * SIZE + x + dx] !== owner[i]);
    if (edge) {
      depth[i] = 1;
      frontier.push(i);
    }
  }
  for (let d = 2; d <= 4 && frontier.length; d++) {
    const next: number[] = [];
    for (const i of frontier)
      for (const j of [i + 1, i - 1, i + SIZE, i - SIZE]) {
        if (j < 0 || j >= SIZE * SIZE || ground[j] !== BUILDING || depth[j] || owner[j] !== owner[i]) continue;
        depth[j] = d;
        next.push(j);
      }
    frontier = next;
  }
  const region = place.lat > 45.5 ? NORTH : SOUTH;
  // Arches: the long side of the footprint gives the monument's axis.
  const frames = new Map<Building, { cx: number; cz: number; ux: number; uz: number; long: number; short: number }>();
  const frameOf = (b: Building) => {
    let frame = frames.get(b);
    if (frame) return frame;
    const cx = b.points.reduce((s, p) => s + p[0], 0) / b.points.length;
    const cz = b.points.reduce((s, p) => s + p[1], 0) / b.points.length;
    let ux = 1;
    let uz = 0;
    let longest = 0;
    b.points.forEach((p, k) => {
      const q = b.points[(k + 1) % b.points.length];
      const d = Math.hypot(q[0] - p[0], q[1] - p[1]);
      if (d > longest) [longest, ux, uz] = [d, (q[0] - p[0]) / d, (q[1] - p[1]) / d];
    });
    const lengthwise = b.points.map((p) => (p[0] - cx) * ux + (p[1] - cz) * uz);
    const across = b.points.map((p) => -(p[0] - cx) * uz + (p[1] - cz) * ux);
    frame = { cx, cz, ux, uz, long: Math.max(...lengthwise) - Math.min(...lengthwise), short: Math.max(...across) - Math.min(...across) };
    frames.set(b, frame);
    return frame;
  };
  /** Height of the open air under a round-headed arch, at `offset` from its middle. */
  const under = (offset: number, half: number, top: number) => (Math.abs(offset) >= half ? 0 : top - half + Math.sqrt(half * half - offset * offset));

  for (const i of cells) {
    const [x, z] = [i % SIZE, Math.floor(i / SIZE)];
    const building = city.buildings[owner[i]];
    const id = building.id;
    const h = heights[i];
    if (building.monument) {
      let open = 0;
      if (building.arch) {
        const frame = frameOf(building);
        const u = (x + 0.5 - frame.cx) * frame.ux + (z + 0.5 - frame.cz) * frame.uz;
        const w = -(x + 0.5 - frame.cx) * frame.uz + (z + 0.5 - frame.cz) * frame.ux;
        // The great arch runs through the short way; a smaller one crosses it through the long way.
        open = Math.max(under(u, frame.long * 0.17, h * 0.6), under(w, frame.short * 0.2, h * 0.38));
      }
      for (let y = 1; y <= h; y++) if (y > open) voxels.set(x, y, z, y > h - 3 && depth[i] === 1 ? B.marble : y % 9 === 0 ? B.stonePale : B.limestone);
      if (open > 0) voxels.set(x, 1, z, B.paving);
      continue;
    }
    const wall = region.fronts[Math.floor(hash(id) * region.fronts.length)];
    const stoneBase = hash(id + 7) < 0.45;
    const outside = depth[i] === 1 && [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dz]) => at(x + dx, z + dz) !== BUILDING);
    for (let y = 1; y <= h; y++) {
      let block = stoneBase && y <= 3 ? B.stonePale : wall;
      // Windows: one per floor, in a rhythm along the wall.
      if (outside && y % 3 === 2 && y < h && (x + 2 * z) % 4 < 2) {
        block = B.glass;
        if (hash(x * 73856093 + y * 19349663 + z * 83492791) < 0.42) {
          lights.push(x, y, z, B.glass, B.windowLit);
          if (city.night) block = B.windowLit;
        }
      }
      voxels.set(x, y, z, block);
    }
    const roof = hash(id + 3) < region.otherShare ? region.other : region.roof;
    const rise = depth[i] === 0 ? 3 : Math.min(3, Math.ceil(depth[i] / 2) + (depth[i] > 3 ? 1 : 0));
    for (let y = h + 1; y <= Math.min(SY - 1, h + rise); y++) voxels.set(x, y, z, roof);
  }

  // --- Trees ----------------------------------------------------------------------------------
  // The map's own trees; big plane trees, as on any avenue.
  const free = (x: number, z: number) => at(x, z) === KERB || at(x, z) === NONE || at(x, z) === GREEN;
  const seed = Math.round((place.lat + place.lon) * 1e4);
  for (const [tx, tz] of map.trees) {
    const x = Math.floor(tx);
    const z = Math.floor(tz);
    // Already planted (a tree on the border of two tiles), or no room.
    if (!free(x, z) || x < 3 || z < 3 || x > SIZE - 4 || z > SIZE - 4 || voxels.get(x, 2, z) !== 0) continue;
    const n = x * 4099 + z;
    const r = hash(seed + n * 31);
    const trunk = 4 + Math.floor(r * 3);
    const crown = 2.3 + hash(seed + n * 17) * 1.4;
    for (let y = 1; y <= trunk; y++) voxels.set(x, y, z, r < 0.5 ? B.trunkWhite : B.trunk);
    for (let dy = -1; dy <= Math.ceil(crown); dy++)
      for (let dz = -3; dz <= 3; dz++)
        for (let dx = -3; dx <= 3; dx++) {
          const d = Math.hypot(dx, dy * 1.35, dz);
          if (d > crown || (d > crown - 0.9 && hash(seed + n * 131 + dx * 7 + dy * 13 + dz * 29) < 0.35)) continue;
          const px = x + dx;
          const py = trunk + 1 + dy;
          const pz = z + dz;
          if (voxels.get(px, py, pz) === 0 && py < SY) voxels.set(px, py, pz, hash(seed + px * 3 + py * 5 + pz * 11) < 0.4 ? B.leavesLight : B.leaves);
        }
  }
}

/** Windows and street lamps come on at night. */
export function setNight(city: City, night: boolean) {
  city.night = night;
  const l = city.lights;
  for (let i = 0; i < l.length; i += 5) city.voxels.set(l[i], l[i + 1], l[i + 2], night ? l[i + 4] : l[i + 3]);
}

/** The sea. The coastline cuts the map into regions; OpenStreetMap draws it with land on the left and
 *  water on the right, so probes just off each side of every segment vote on what each region is. A harbour
 *  full of narrow quays puts a few probes on the wrong side; the majority still gets it right. */
function floodSea(coast: Pt[][], ground: Uint8Array) {
  if (!coast.length) return;
  const wall = new Uint8Array(SIZE * SIZE);
  for (const line of coast) stamp(line, 1, (x, z) => (wall[z * SIZE + x] = 1));

  // Label every region the coastline encloses.
  const region = new Int32Array(SIZE * SIZE);
  let regions = 0;
  const todo: number[] = [];
  for (let start = 0; start < region.length; start++) {
    if (region[start] || wall[start]) continue;
    region[start] = ++regions;
    todo.push(start);
    while (todo.length) {
      const i = todo.pop()!;
      const x = i % SIZE;
      for (const j of [x > 0 ? i - 1 : -1, x < SIZE - 1 ? i + 1 : -1, i - SIZE, i + SIZE]) {
        if (j < 0 || j >= region.length || region[j] || wall[j]) continue;
        region[j] = regions;
        todo.push(j);
      }
    }
  }

  const wet = new Int32Array(regions + 1);
  const dry = new Int32Array(regions + 1);
  for (const line of coast)
    for (let i = 1; i < line.length; i++) {
      const [ax, az] = line[i - 1];
      const [bx, bz] = line[i];
      const len = Math.hypot(bx - ax, bz - az);
      if (len < 1) continue;
      // A probe every few metres along the segment, just clear of the wall on either side.
      for (let d = Math.min(len / 2, 2); d < len; d += 4)
        for (const side of [1, -1]) {
          const x = Math.floor(ax + ((bx - ax) * d) / len - ((bz - az) / len) * 2.6 * side);
          const z = Math.floor(az + ((bz - az) * d) / len + ((bx - ax) / len) * 2.6 * side);
          if (x < 0 || z < 0 || x >= SIZE || z >= SIZE || wall[z * SIZE + x]) continue;
          (side === 1 ? wet : dry)[region[z * SIZE + x]]++;
        }
    }
  for (let i = 0; i < region.length; i++) {
    const r = region[i];
    if (r && wet[r] > dry[r] && ground[i] !== ROAD) ground[i] = SEA;
  }
  // The coastline itself belongs to whichever side most of its neighbours are on.
  for (let i = 0; i < region.length; i++) {
    if (!wall[i] || ground[i] === ROAD) continue;
    const x = i % SIZE;
    let sea = 0;
    let all = 0;
    for (const j of [x > 1 ? i - 2 : -1, x < SIZE - 2 ? i + 2 : -1, i - 2 * SIZE, i + 2 * SIZE]) {
      if (j < 0 || j >= region.length || wall[j]) continue;
      all++;
      if (ground[j] === SEA) sea++;
    }
    if (all && sea === all) ground[i] = SEA;
  }
}
