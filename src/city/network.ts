// Real road centrelines -> something cars can drive: directed lanes, the curved connectors that
// join them at every junction, which connectors cross, who gives way to whom, and traffic signals.
// France: drive on the right, and where nothing else decides it, give way to the right.

import { SIZE, type CityMap, type Pt, type Road } from './osm';

const LANE_OFFSET = 1.7;
const EDGE = 3;
/** Links between junctions shorter than this are the inside of one bigger junction. */
const JOIN = 22;

export interface Path {
  points: Pt[];
  cum: number[];
  length: number;
}

export interface Lane extends Path {
  id: number;
  road: Road;
  fromNode: number;
  toNode: number;
  /** Connectors leaving the end of this lane. */
  out: number[];
  /** Cars appear at the start / vanish at the end: the lane crosses the edge of the map. */
  source: boolean;
  sink: boolean;
  /** Key of the junction at the end of this lane, in `Network.junctions`. */
  junction: number | null;
  sign: 'stop' | 'give_way' | null;
  /** Index of the signal phase that gives this lane green, when its junction is signalled. */
  phase: number | null;
  /** The lane of the same road going the other way, if any. */
  twin: number | null;
  /** Which stretch of street this lane belongs to; parallel lanes share it. */
  stretch: number;
  forward: boolean;
  /** 0 is the lane by the kerb; `count` lanes run side by side in this direction, `spacing` metres apart. */
  index: number;
  count: number;
  spacing: number;
}

export interface Connector extends Path {
  id: number;
  node: number;
  from: number;
  to: number;
  turn: 'left' | 'straight' | 'right' | 'uturn';
  /** How many lanes sideways this movement drifts; 0 keeps its lane. */
  shift: number;
  /** For each conflicting connector: where the two paths share the road, as [from, to] along this one and [from, to] along the other. */
  zones: Map<number, [number, number, number, number]>;
  /** Connectors whose paths cross or merge with this one. */
  conflicts: number[];
  /** The subset this one must give way to. */
  yieldsTo: number[];
}

export interface Junction {
  node: number;
  x: number;
  z: number;
  /** Every map node folded into this junction. */
  nodes: number[];
  /** Lanes arriving plus lanes leaving. */
  arms: number;
  connectors: number[];
  signalled: boolean;
  /** Approach lanes with a stop line, for drawing signals and lines. */
  approaches: number[];
}

export interface Network {
  lanes: Lane[];
  connectors: Connector[];
  junctions: Map<number, Junction>;
}

// --- Path helpers -----------------------------------------------------------------------

export function makePath(points: Pt[]): Path {
  const cum = [0];
  for (let i = 1; i < points.length; i++) cum.push(cum[i - 1] + Math.hypot(points[i][0] - points[i - 1][0], points[i][1] - points[i - 1][1]));
  return { points, cum, length: cum[cum.length - 1] };
}

/** Position and heading at distance `s` along a path. */
export function along(path: Path, s: number): { x: number; z: number; dx: number; dz: number } {
  const d = Math.min(path.length, Math.max(0, s));
  let i = 1;
  while (i < path.cum.length - 1 && path.cum[i] < d) i++;
  const [ax, az] = path.points[i - 1];
  const [bx, bz] = path.points[i];
  const span = path.cum[i] - path.cum[i - 1] || 1;
  const t = (d - path.cum[i - 1]) / span;
  return { x: ax + (bx - ax) * t, z: az + (bz - az) * t, dx: (bx - ax) / span, dz: (bz - az) / span };
}

function slice(points: Pt[], from: number, to: number): Pt[] {
  const path = makePath(points);
  const a = Math.max(0, from);
  const b = Math.min(path.length, to);
  if (b - a < 0.5) return [];
  const start = along(path, a);
  const end = along(path, b);
  const inner = points.filter((_, i) => path.cum[i] > a + 0.05 && path.cum[i] < b - 0.05);
  return [[start.x, start.z], ...inner, [end.x, end.z]];
}

/** Shift a polyline to its right (heading east, right is south). */
function offsetRight(points: Pt[], by: number): Pt[] {
  if (!by) return points;
  return points.map((p, i) => {
    const a = points[Math.max(0, i - 1)];
    const b = points[Math.min(points.length - 1, i + 1)];
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
    return [p[0] - ((b[1] - a[1]) / len) * by, p[1] + ((b[0] - a[0]) / len) * by] as Pt;
  });
}

const inside = (p: Pt) => p[0] > EDGE && p[1] > EDGE && p[0] < SIZE - EDGE && p[1] < SIZE - EDGE;

/** Where the segment a-b leaves the map, a inside and b outside (or the reverse). */
function toEdge(a: Pt, b: Pt): Pt {
  let lo = 0;
  let hi = 1;
  for (let i = 0; i < 20; i++) {
    const mid = (lo + hi) / 2;
    if (inside([a[0] + (b[0] - a[0]) * mid, a[1] + (b[1] - a[1]) * mid])) lo = mid;
    else hi = mid;
  }
  return [a[0] + (b[0] - a[0]) * lo, a[1] + (b[1] - a[1]) * lo];
}

// --- Building the network -------------------------------------------------------------------

interface Stretch {
  road: Road;
  ids: number[];
  points: Pt[];
}

export function buildNetwork(map: CityMap): Network {
  // 1. Keep the parts of every road that lie inside the map. Where a road leaves, it gets an edge node.
  let edgeId = -1;
  const runs: Stretch[] = [];
  for (const road of map.roads) {
    let ids: number[] = [];
    let points: Pt[] = [];
    const flush = () => {
      if (points.length >= 2) runs.push({ road, ids, points });
      ids = [];
      points = [];
    };
    for (let i = 0; i < road.points.length; i++) {
      const p = road.points[i];
      const was = i > 0 ? road.points[i - 1] : null;
      if (inside(p)) {
        if (was && !inside(was)) {
          ids.push(edgeId--);
          points.push(toEdge(p, was));
        }
        ids.push(road.nodeIds[i]);
        points.push(p);
      } else if (was && inside(was)) {
        ids.push(edgeId--);
        points.push(toEdge(was, p));
        flush();
      }
    }
    flush();
  }

  // 2. A node is a junction when roads meet or end there; roads are cut into stretches between junctions.
  const uses = new Map<number, number>();
  for (const run of runs) run.ids.forEach((id, i) => uses.set(id, (uses.get(id) ?? 0) + (i === 0 || i === run.ids.length - 1 ? 2 : 1)));
  const stretches: Stretch[] = [];
  for (const run of runs) {
    let start = 0;
    for (let i = 1; i < run.ids.length; i++)
      if ((uses.get(run.ids[i]) ?? 0) >= 2 || i === run.ids.length - 1) {
        stretches.push({ road: run.road, ids: run.ids.slice(start, i + 1), points: run.points.slice(start, i + 1) });
        start = i;
      }
  }
  // Where the map merely changes from one way to the next (a new name, a new speed limit) nothing
  // happens for a driver: sew the two stretches back together.
  for (let merged = true; merged; ) {
    merged = false;
    const touching = new Map<number, Stretch[]>();
    for (const s of stretches) for (const id of new Set([s.ids[0], s.ids[s.ids.length - 1]])) (touching.get(id) ?? touching.set(id, []).get(id)!).push(s);
    for (const [node, pair] of touching) {
      if (node < 0 || pair.length !== 2 || pair[0] === pair[1] || pair[0].road.oneway !== pair[1].road.oneway || map.signals.has(node)) continue;
      let [a, b] = pair;
      if (a.ids[a.ids.length - 1] !== node) [a, b] = [b, a];
      const flip = (s: Stretch): Stretch => ({ road: s.road, ids: [...s.ids].reverse(), points: [...s.points].reverse() });
      if (a.ids[a.ids.length - 1] !== node) {
        if (a.road.oneway) continue;
        a = flip(a);
      }
      if (b.ids[0] !== node) {
        if (b.road.oneway) continue;
        b = flip(b);
      }
      if (a.ids[0] === b.ids[b.ids.length - 1]) continue;
      const longer = makePath(a.points).length >= makePath(b.points).length ? a.road : b.road;
      stretches.splice(stretches.indexOf(pair[0]), 1);
      stretches.splice(stretches.indexOf(pair[1]), 1);
      stretches.push({ road: longer, ids: [...a.ids, ...b.ids.slice(1)], points: [...a.points, ...b.points.slice(1)] });
      merged = true;
      break;
    }
  }
  const degree = new Map<number, number>();
  for (const s of stretches) for (const id of [s.ids[0], s.ids[s.ids.length - 1]]) degree.set(id, (degree.get(id) ?? 0) + 1);
  const meeting = new Map<number, Stretch[]>();
  for (const s of stretches) for (const id of new Set([s.ids[0], s.ids[s.ids.length - 1]])) (meeting.get(id) ?? meeting.set(id, []).get(id)!).push(s);
  /** How far a street's lanes stop short of a node: clear of the full width of whatever it meets there. */
  const setback = (node: number, own: Stretch) => {
    if (node < 0) return 0;
    const arms = degree.get(node) ?? 0;
    if (arms < 3) return arms === 1 ? 3 : 1.2;
    const others = (meeting.get(node) ?? []).filter((s) => s !== own).map((s) => s.road.width);
    return Math.min(24, Math.max(4.5, Math.max(7, ...others) / 2 + 3));
  };
  /** Lanes side by side in one direction, and the gap between their middles. */
  const layout = (road: Road) => {
    const small = road.kind === 'service' || road.kind === 'living_street';
    const count = small ? 1 : road.oneway ? Math.min(6, road.lanes) : Math.min(4, Math.max(1, Math.floor(road.lanes / 2)));
    const room = (road.width - 1) / (road.oneway ? count : count * 2);
    return { count, spacing: Math.min(road.oneway ? 4.2 : 3.6, Math.max(3, room)) };
  };
  /** Distance of lane `index` (0 by the kerb) to the right of the street's centreline. */
  const offsetOf = (road: Road, index: number, count: number, spacing: number) => (road.oneway ? ((count - 1) / 2 - index) * spacing : count === 1 ? LANE_OFFSET : (count - 1 - index) * spacing + spacing / 2);

  // 2b. Where two big roads cross, the map draws a knot of junctions a few metres apart. To a driver
  // that is one junction: the short links inside it become part of the turn, not streets of their own.
  const ends = (s: Stretch) => [s.ids[0], s.ids[s.ids.length - 1]] as const;
  const isInternal = (s: Stretch) => ends(s).every((id) => id >= 0 && (degree.get(id) ?? 0) >= 3) && makePath(s.points).length < JOIN;
  const root = new Map<number, number>();
  const find = (id: number): number => {
    const up = root.get(id);
    if (up === undefined || up === id) return id;
    const top = find(up);
    root.set(id, top);
    return top;
  };
  const inner: Stretch[] = [];
  for (const s of stretches)
    if (isInternal(s)) {
      inner.push(s);
      root.set(find(s.ids[0]), find(s.ids[s.ids.length - 1]));
    }
  /** Shortest way through a knot's inner links, as points, from one of its nodes to another. */
  const through = (from: number, to: number): Pt[] | null => {
    if (from === to) return [];
    const best = new Map<number, { cost: number; points: Pt[] }>([[from, { cost: 0, points: [] }]]);
    const todo = [from];
    while (todo.length) {
      const here = todo.shift()!;
      for (const s of inner) {
        const [a, b] = ends(s);
        const forward = a === here;
        if (!forward && !(b === here && !s.road.oneway)) continue;
        const next = forward ? b : a;
        const points = offsetRight(forward ? s.points : [...s.points].reverse(), s.road.oneway ? 0 : LANE_OFFSET);
        const cost = best.get(here)!.cost + makePath(points).length;
        if (cost >= (best.get(next)?.cost ?? Infinity)) continue;
        best.set(next, { cost, points: [...best.get(here)!.points, ...points] });
        todo.push(next);
      }
    }
    return best.get(to)?.points ?? null;
  };

  // 3. Lanes: as many side by side as the map says, each way, set back from the junctions.
  const lanes: Lane[] = [];
  const position = new Map<number, Pt>();
  stretches.forEach((s, stretch) => {
    const [a, b] = ends(s);
    position.set(a, s.points[0]);
    position.set(b, s.points[s.points.length - 1]);
    if (inner.includes(s)) return;
    const full = makePath(s.points).length;
    const { count, spacing } = layout(s.road);
    // Short streets keep most of their length, so that a bus still fits between two junctions.
    const share = full > 60 ? 0.35 : 0.2;
    const make = (points: Pt[], ids: number[], from: number, to: number, forward: boolean, index: number): number | null => {
      const shifted = offsetRight(points, offsetOf(s.road, index, count, spacing));
      const length = makePath(shifted).length;
      const trimmed = slice(shifted, Math.min(setback(from, s), full * share), length - Math.min(setback(to, s), full * share));
      if (trimmed.length < 2) return null;
      // A stop or give-way sign counts when it stands on the last stretch before the junction.
      let sign: Lane['sign'] = null;
      for (const id of ids.slice(-4)) sign = map.signs.get(id) ?? sign;
      lanes.push({ id: lanes.length, road: s.road, fromNode: from, toNode: to, junction: to < 0 ? null : find(to), out: [], source: from < 0, sink: to < 0, sign, phase: null, twin: null, stretch, forward, index, count, spacing, ...makePath(trimmed) });
      return lanes.length - 1;
    };
    for (let index = 0; index < count; index++) {
      const forward = make(s.points, s.ids, a, b, true, index);
      const back = s.road.oneway ? null : make([...s.points].reverse(), [...s.ids].reverse(), b, a, false, index);
      if (forward !== null && back !== null) {
        lanes[forward].twin = back;
        lanes[back].twin = forward;
      }
    }
  });

  // 4. Connectors: a smooth curve from the end of each arriving lane to the start of each leaving one.
  const connectors: Connector[] = [];
  const junctions = new Map<number, Junction>();
  const arriving = new Map<number, Lane[]>();
  const leaving = new Map<number, Lane[]>();
  const members = new Map<number, Set<number>>();
  for (const lane of lanes) {
    if (lane.toNode >= 0) {
      (arriving.get(find(lane.toNode)) ?? arriving.set(find(lane.toNode), []).get(find(lane.toNode))!).push(lane);
      (members.get(find(lane.toNode)) ?? members.set(find(lane.toNode), new Set()).get(find(lane.toNode))!).add(lane.toNode);
    }
    if (lane.fromNode >= 0) {
      (leaving.get(find(lane.fromNode)) ?? leaving.set(find(lane.fromNode), []).get(find(lane.fromNode))!).push(lane);
      (members.get(find(lane.fromNode)) ?? members.set(find(lane.fromNode), new Set()).get(find(lane.fromNode))!).add(lane.fromNode);
    }
  }
  for (const [node, ins] of arriving) {
    const outs = leaving.get(node) ?? [];
    const nodes = [...(members.get(node) ?? [node])];
    const at: Pt = [nodes.reduce((sum, id) => sum + (position.get(id)?.[0] ?? 0), 0) / nodes.length, nodes.reduce((sum, id) => sum + (position.get(id)?.[1] ?? 0), 0) / nodes.length];
    const junction: Junction = { node, x: at[0], z: at[1], nodes, connectors: [], signalled: false, approaches: [], arms: ins.length + outs.length };
    /** The curve from the end of lane a to the start of lane b. */
    const curve = (a: Lane, b: Lane, via: Pt[]): Pt[] => {
      const end = along(a, a.length);
      const start = along(b, 0);
      const direct = Math.hypot(start.x - end.x, start.z - end.z);
      if (via.length && a.count === 1 && b.count === 1 && (makePath(via).length > Math.max(25, direct * 1.35) || direct < 1)) {
        // A long way round inside the knot (a roundabout, a wide median): follow the road itself.
        let line: Pt[] = [[end.x, end.z], ...via.filter((p) => Math.hypot(p[0] - end.x, p[1] - end.z) > 3 && Math.hypot(p[0] - start.x, p[1] - start.z) > 3), [start.x, start.z]];
        for (let round = 0; round < 2; round++) {
          const cut: Pt[] = [line[0]];
          for (let i = 0; i + 1 < line.length; i++) {
            const [p, q] = [line[i], line[i + 1]];
            cut.push([p[0] * 0.75 + q[0] * 0.25, p[1] * 0.75 + q[1] * 0.25], [p[0] * 0.25 + q[0] * 0.75, p[1] * 0.25 + q[1] * 0.75]);
          }
          cut.push(line[line.length - 1]);
          line = cut;
        }
        return line;
      }
      // Control point where the two headings meet; if they never sensibly do, halfway between.
      const denom = end.dx * -start.dz - end.dz * -start.dx;
      let control: Pt = [(end.x + start.x) / 2, (end.z + start.z) / 2];
      if (Math.abs(denom) > 0.15) {
        const t = ((start.x - end.x) * -start.dz - (start.z - end.z) * -start.dx) / denom;
        if (t > 0.3 && t < direct * 1.5) control = [end.x + end.dx * t, end.z + end.dz * t];
      }
      if (b.stretch === a.stretch) control = [end.x + end.dx * 5 - end.dz * 2, end.z + end.dz * 5 + end.dx * 2];
      const points: Pt[] = [];
      const steps = Math.max(10, Math.ceil(direct / 1.5));
      for (let i = 0; i <= steps; i++) {
        const t = i / steps;
        points.push([(1 - t) ** 2 * end.x + 2 * (1 - t) * t * control[0] + t * t * start.x, (1 - t) ** 2 * end.z + 2 * (1 - t) * t * control[1] + t * t * start.z]);
      }
      return points;
    };

    // Work street by street: the lanes arriving along one street, and each street they can leave by.
    const approaches = new Map<string, Lane[]>();
    for (const a of ins) (approaches.get(`${a.stretch}${a.forward}`) ?? approaches.set(`${a.stretch}${a.forward}`, []).get(`${a.stretch}${a.forward}`)!).push(a);
    for (const from of approaches.values()) {
      from.sort((p, q) => p.index - q.index);
      const n = from.length;
      const exits = new Map<string, Lane[]>();
      for (const b of outs) (exits.get(`${b.stretch}${b.forward}`) ?? exits.set(`${b.stretch}${b.forward}`, []).get(`${b.stretch}${b.forward}`)!).push(b);
      const ways: Array<{ to: Lane[]; via: Pt[]; angle: number; back: boolean }> = [];
      for (const to of exits.values()) {
        to.sort((p, q) => p.index - q.index);
        const via = through(from[0].toNode, to[0].fromNode);
        if (via === null) continue;
        const end = along(from[0], from[0].length);
        const start = along(to[0], 0);
        ways.push({ to, via, angle: Math.atan2(end.dx * start.dz - end.dz * start.dx, end.dx * start.dx + end.dz * start.dz), back: to[0].stretch === from[0].stretch });
      }
      // Turning back on yourself is for when there is no other way out.
      const onward = ways.filter((w) => !w.back && Math.abs(w.angle) <= 2.7);
      const usable = onward.length ? onward : ways.filter((w) => !w.back).length ? ways.filter((w) => !w.back).slice(0, 1) : ways.slice(0, 1);
      const made: Connector[] = [];
      const link = (a: Lane, b: Lane, w: (typeof ways)[number], turn: Connector['turn'], shift: number) => {
        if (made.some((c) => c.from === a.id && c.to === b.id)) return;
        made.push({ id: -1, node, from: a.id, to: b.id, turn, shift, zones: new Map(), conflicts: [], yieldsTo: [], ...makePath(curve(a, b, w.via)) });
      };
      for (const w of usable) {
        const m = w.to.length;
        const turn: Connector['turn'] = w.back || Math.abs(w.angle) > 2.7 ? 'uturn' : Math.abs(w.angle) < 0.5 ? 'straight' : w.angle > 0 ? 'right' : 'left';
        // The only way on is no real turn, however sharp the bend: every lane follows the road round.
        if (turn === 'straight' || usable.length === 1) {
          for (let k = 0; k < n; k++) {
            const base = n === 1 ? -1 : Math.round((k * (m - 1)) / (n - 1));
            for (let j = 0; j < m; j++) if (base < 0 || Math.abs(j - base) <= 1) link(from[k], w.to[j], w, turn, base < 0 ? 0 : Math.abs(j - base));
          }
        } else if (turn === 'uturn') link(from[n - 1], w.to[m - 1], w, turn, 0);
        else {
          // Turns leave from the side they turn to: one lane, two on a wide road.
          const turning = n >= 4 ? 2 : 1;
          for (let r = 0; r < turning; r++) {
            const k = turn === 'right' ? r : n - 1 - r;
            const j = turn === 'right' ? Math.min(r, m - 1) : m - 1 - Math.min(r, m - 1);
            link(from[k], w.to[j], w, turn, 0);
            if (turning === 1 && m >= 2) link(from[k], w.to[turn === 'right' ? 1 : m - 2], w, turn, 1);
          }
        }
      }
      // No lane may be a trap: one with nowhere to go follows the straightest way on.
      const straightest = [...usable].sort((p, q) => Math.abs(p.angle) - Math.abs(q.angle))[0];
      if (straightest)
        from.forEach((a, k) => {
          if (made.some((c) => c.from === a.id)) return;
          const m = straightest.to.length;
          link(a, straightest.to[n === 1 ? 0 : Math.round((k * (m - 1)) / (n - 1))], straightest, Math.abs(straightest.angle) < 0.5 ? 'straight' : straightest.angle > 0 ? 'right' : 'left', 0);
        });
      for (const c of made) {
        c.id = connectors.length;
        connectors.push(c);
        lanes[c.from].out.push(c.id);
        junction.connectors.push(c.id);
      }
    }
    if (junction.connectors.length) junctions.set(node, junction);
  }

  // 5. Signals: on the junction itself, or on an approach just before it (as OpenStreetMap often tags them).
  const signalAt: Pt[] = [];
  for (const road of map.roads) road.nodeIds.forEach((id, i) => map.signals.has(id) && signalAt.push(road.points[i]));
  for (const junction of junctions.values()) {
    const ins = arriving.get(junction.node) ?? [];
    // Lights belong where real streets meet, not where a yard or a car park opens onto one.
    if (ins.filter((l) => l.road.rank >= 1).length < 2 || junction.arms < 3) continue;
    const reach = 14 + Math.max(...junction.nodes.map((id) => Math.hypot((position.get(id)?.[0] ?? 0) - junction.x, (position.get(id)?.[1] ?? 0) - junction.z)));
    if (!junction.nodes.some((id) => map.signals.has(id)) && !signalAt.some((p) => Math.hypot(p[0] - junction.x, p[1] - junction.z) < reach)) continue;
    junction.signalled = true;
    // Two phases: approaches roughly in line with the first one, and everything else.
    const bearing = (l: Lane) => {
      const e = along(l, l.length);
      return Math.atan2(e.dz, e.dx);
    };
    const reference = bearing(ins[0]);
    for (const lane of ins) {
      const off = Math.abs(((bearing(lane) - reference + Math.PI * 2.5) % Math.PI) - Math.PI / 2);
      lane.phase = off > Math.PI / 4 ? 0 : 1;
    }
    if (ins.every((l) => l.phase === ins[0].phase)) ins.forEach((l, i) => (l.phase = i % 2));
  }

  // 6. Who crosses whom, and who waits.
  const dense = new Map<number, Pt[]>();
  const sample = (c: Connector) => {
    let points = dense.get(c.id);
    if (!points) {
      points = [];
      for (let d = 0; d <= c.length; d += 1) points.push([along(c, d).x, along(c, d).z]);
      dense.set(c.id, points);
    }
    return points;
  };
  const boxes = new Map<number, [number, number, number, number]>();
  const box = (c: Connector) => {
    let b = boxes.get(c.id);
    if (!b) {
      b = [Infinity, Infinity, -Infinity, -Infinity];
      for (const [x, z] of sample(c)) b = [Math.min(b[0], x), Math.min(b[1], z), Math.max(b[2], x), Math.max(b[3], z)];
      boxes.set(c.id, b);
    }
    return b;
  };
  /** Where two connectors come within touching distance, as a stretch along each; null when they never do. */
  const near = (p: Connector, q: Connector): [number, number, number, number] | null => {
    const [a, b] = [box(p), box(q)];
    if (a[0] > b[2] + 2.4 || b[0] > a[2] + 2.4 || a[1] > b[3] + 2.4 || b[1] > a[3] + 2.4) return null;
    let zone: [number, number, number, number] | null = null;
    const [ps, qs] = [sample(p), sample(q)];
    for (let i = 0; i < ps.length; i++)
      for (let j = 0; j < qs.length; j++)
        if (Math.hypot(ps[i][0] - qs[j][0], ps[i][1] - qs[j][1]) < 2.4) zone = zone ? [Math.min(zone[0], i), Math.max(zone[1], i), Math.min(zone[2], j), Math.max(zone[3], j)] : [i, i, j, j];
    return zone;
  };
  for (const junction of junctions.values()) {
    const own = junction.connectors.map((id) => connectors[id]);
    for (const c of own) {
      const mine = lanes[c.from];
      const heading = along(mine, mine.length);
      junction.approaches.includes(mine.id) || junction.approaches.push(mine.id);
      for (const d of own) {
        if (d.from === c.from) continue;
        const zone = near(c, d);
        if (!zone) continue;
        c.conflicts.push(d.id);
        c.zones.set(d.id, zone);
        const theirs = lanes[d.from];
        const theirHeading = along(theirs, theirs.length);
        const opposite = heading.dx * theirHeading.dx + heading.dz * theirHeading.dz < -0.6;
        let waits: boolean;
        // Side by side on the same street: whoever drifts across lanes gives way to whoever keeps theirs.
        if (mine.stretch === theirs.stretch && mine.forward === theirs.forward) waits = c.shift > d.shift;
        else if (junction.signalled && mine.phase !== theirs.phase) waits = false;
        else if (opposite) waits = c.turn === 'left' && d.turn !== 'left';
        else if (mine.sign && !theirs.sign) waits = true;
        else if (!mine.sign && theirs.sign) waits = false;
        else if (mine.road.rank !== theirs.road.rank) waits = mine.road.rank < theirs.road.rank;
        // Priorité à droite: they come from my right when the way back along their lane lies to my right.
        else waits = -heading.dz * -theirHeading.dx + heading.dx * -theirHeading.dz > 0.3;
        if (waits) c.yieldsTo.push(d.id);
      }
    }
  }
  return { lanes, connectors, junctions };
}

/** Quickest lane-to-lane route by free-flow time plus a penalty for queues; returns lane ids, first is `from`. */
export function route(net: Network, from: number, to: number, delay: (lane: number) => number): number[] | null {
  const cost = new Map<number, number>([[from, 0]]);
  const prev = new Map<number, number>();
  // A binary heap of [cost, lane]: the city is big enough for the difference to show.
  const heap: Array<[number, number]> = [[0, from]];
  const push = (item: [number, number]) => {
    heap.push(item);
    for (let i = heap.length - 1; i > 0; ) {
      const up = (i - 1) >> 1;
      if (heap[up][0] <= heap[i][0]) break;
      [heap[up], heap[i]] = [heap[i], heap[up]];
      i = up;
    }
  };
  const pop = (): [number, number] => {
    const top = heap[0];
    const last = heap.pop()!;
    if (heap.length) {
      heap[0] = last;
      for (let i = 0; ; ) {
        const [l, r] = [i * 2 + 1, i * 2 + 2];
        let small = i;
        if (l < heap.length && heap[l][0] < heap[small][0]) small = l;
        if (r < heap.length && heap[r][0] < heap[small][0]) small = r;
        if (small === i) break;
        [heap[small], heap[i]] = [heap[i], heap[small]];
        i = small;
      }
    }
    return top;
  };
  while (heap.length) {
    const [spent, here] = pop();
    if (here === to) break;
    if (spent > (cost.get(here) ?? Infinity)) continue;
    for (const cid of net.lanes[here].out) {
      const c = net.connectors[cid];
      const lane = net.lanes[c.to];
      const next = spent + c.length / 4 + lane.length / lane.road.limit + delay(lane.id) + (c.turn === 'uturn' ? 25 : c.turn === 'left' ? 4 : 0) + c.shift * 1.5;
      if (next < (cost.get(lane.id) ?? Infinity)) {
        cost.set(lane.id, next);
        prev.set(lane.id, here);
        push([next, lane.id]);
      }
    }
  }
  if (!cost.has(to)) return null;
  const path = [to];
  while (path[0] !== from) path.unshift(prev.get(path[0])!);
  return path;
}
