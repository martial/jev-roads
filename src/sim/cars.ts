// The physics of the street. Code owns everything that must be exact and safe: following distances,
// who may enter a junction, signals, routes. Jev's judgments arrive as a few plain fields on each car
// (style, gapMove, amberStop, courtesyUntil) and this file decides what they are allowed to change.

import type { GapMove, Style } from '../../shared/drive';
import { along, route, type Connector, type Lane, type Network, type Path } from '../city/network';
import { SIZE } from '../city/osm';
import { MANNERS, ambulanceDriver, randomDriver, taxiDriver, type Driver } from './drivers';

export type Light = 'green' | 'amber' | 'red';
export type Hold = '' | 'red' | 'amber' | 'stop' | 'box' | 'crossing' | 'gap' | 'courtesy' | 'broken';

export interface Car {
  id: number;
  driver: Driver;
  /** Lane id, or lanes.length + connector id. */
  path: number;
  /** Paths just left, newest first: the tail of a long vehicle may still be on them. */
  behind: number[];
  /** Front bumper, metres along the path. */
  s: number;
  v: number;
  a: number;
  /** Lanes to come; route[0] is the lane the car is on, or is turning into. */
  route: number[];
  /** Keeps driving around the map instead of leaving it: the car you ride in. */
  wander: boolean;
  /** The route is the ride's, stop by stop, and not for the driver to change at a junction. */
  onRails: boolean;
  ambulance: boolean;

  // --- What Jev decided (or the driver's fixed habit, with Jev off) ---
  style: Style;
  styleP: number;
  styleAt: number;
  gapMove: GapMove | null;
  gapUntil: number;
  /** Decision for the amber light now showing: true stop, false go, null not decided yet. */
  amberStop: boolean | null;
  courtesyUntil: number;
  hornUntil: number;
  honkedUntil: number;
  brokenUntil: number;
  /** Words floating over the car for a moment. */
  bubble: string;
  bubbleUntil: number;
  /** What the rider typed to this car. */
  says: string;
  /** Where the rider asked to go: a label for the dashboard, and the lane that counts as there. */
  goal: { label: string; lane: number } | null;
  /** The vehicle the rider asked to follow. */
  follow: Car | null;
  followLabel: string;
  /** Standing at the kerb until then: "here we are". */
  restUntil: number;
  /** When each kind of question was last put to Jev for this car (simulation seconds). */
  asked: Partial<Record<string, number>>;
  /** A request about this car is on its way. */
  pending: boolean;

  // --- Facts, refreshed every step ---
  x: number;
  z: number;
  dx: number;
  dz: number;
  side: number;
  leader: Car | null;
  /** Who is across this car's path at the junction ahead, when that is what holds it. */
  blocker: Car | null;
  gap: number | null;
  /** Speed of whatever is ahead along this car's own path; 0 for someone crossing it. */
  leadV: number;
  toLine: number;
  light: Light | null;
  hold: Hold;
  /** Seconds until the next vehicle this car must give way to reaches the junction. */
  priorityEta: number | null;
  /** Seconds spent first in line, waiting to enter a junction. */
  waiting: number;
  stopped: number;
  tailgatedUntil: number;
  ambulanceBehind: boolean;
  stopDoneAt: number;
  indicator: -1 | 0 | 1;
  braking: boolean;
  age: number;
}

/** Green seconds shared between a junction's two phases, in proportion to the lanes each one serves. */
const GREEN_POOL = 32;
const AMBER = 3;
const CLEAR = 2;
const LOOK = 90;

function mulberry(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** How much traffic a lane draws, by the class of its street: avenues carry the town, back streets a trickle. */
const draw = (lane: Lane) => (lane.road.rank >= 4 ? 6 : lane.road.rank >= 3 ? 3 : lane.road.rank >= 2 ? 1 : 0.25);

/** Cars a street network can reasonably hold: a car every 50 m of avenue lane, every 400 m of back lane. */
export function capacity(net: Network): number {
  let cars = 0;
  for (const lane of net.lanes) cars += lane.length / (lane.road.rank >= 4 ? 50 : lane.road.rank >= 3 ? 80 : lane.road.rank >= 2 ? 160 : 400);
  return Math.max(6, Math.round(cars));
}

export class Traffic {
  readonly cars: Car[] = [];
  time = 0;
  /** How many cars the street should hold. */
  target = 36;
  /** Called when a horn sounds. */
  onHorn: (car: Car) => void = () => {};
  onLeave: (car: Car) => void = () => {};

  private readonly rng: () => number;
  private readonly paths: Path[];
  private readonly L: number;
  private onPath: Car[][] = [];
  private readonly used = new Set<number>();
  private readonly offsets = new Map<number, number>();
  /** Green time of phase 0 and phase 1 at each signalled junction. */
  private readonly greens = new Map<number, [number, number]>();
  private readonly sinks: number[];
  private readonly leadsOut: Set<number>;
  /** Lanes you can drive away from and come back to: where a wandering car can live for ever. */
  private readonly core: number[];
  private readonly sources: number[];
  /** How many vehicles had to be towed out of a jam that would never clear. */
  towed = 0;
  private nextId = 1;
  private spawnClock = 0;

  constructor(
    readonly net: Network,
    seed = 7,
  ) {
    this.rng = mulberry(seed);
    this.L = net.lanes.length;
    this.paths = [...net.lanes, ...net.connectors];
    for (const j of net.junctions.values()) {
      // An avenue six lanes wide gets more green than the side street that crosses it.
      const weight = [0.5, 0.5];
      for (const id of j.approaches) if (net.lanes[id].phase !== null) weight[net.lanes[id].phase!] += 1 + net.lanes[id].road.rank / 4;
      const first = Math.min(24, Math.max(8, (GREEN_POOL * weight[0]) / (weight[0] + weight[1])));
      this.greens.set(j.node, [first, Math.min(24, Math.max(8, GREEN_POOL - first))]);
      this.offsets.set(j.node, this.rng() * (GREEN_POOL + 2 * (AMBER + CLEAR)));
    }
    // Which lanes lead out of the map, and which lie on a loop: found by walking the graph backwards.
    const into: number[][] = net.lanes.map(() => []);
    for (const c of net.connectors) into[c.to].push(c.from);
    const upstreamOf = (starts: number[]) => {
      const seen = new Set(starts);
      const todo = [...starts];
      while (todo.length) for (const from of into[todo.pop()!]) if (!seen.has(from)) (seen.add(from), todo.push(from));
      return seen;
    };
    this.sinks = net.lanes.filter((l) => l.sink).map((l) => l.id);
    this.leadsOut = upstreamOf(this.sinks);
    this.core = this.loops();
    this.sources = net.lanes.filter((l) => l.source && this.leadsOut.has(l.id)).map((l) => l.id);
    this.index();
  }

  // --- Signals ------------------------------------------------------------------------------------

  light(lane: Lane): Light | null {
    if (lane.phase === null || lane.junction === null) return null;
    const [g0, g1] = this.greens.get(lane.junction) ?? [13, 13];
    const first = g0 + AMBER + CLEAR;
    const t = (this.time + (this.offsets.get(lane.junction) ?? 0)) % (first + g1 + AMBER + CLEAR);
    const mine = t < first ? 0 : 1;
    if (mine !== lane.phase) return 'red';
    const u = mine === 0 ? t : t - first;
    const green = mine === 0 ? g0 : g1;
    return u < green ? 'green' : u < green + AMBER ? 'amber' : 'red';
  }

  // --- People -------------------------------------------------------------------------------------

  private create(driver: Driver, lane: number, s: number, v: number): Car {
    const p = along(this.net.lanes[lane], s);
    const car: Car = {
      id: this.nextId++, driver, path: lane, behind: [], s, v, a: 0, route: [lane], wander: false, onRails: false, ambulance: driver.body.kind === 'ambulance',
      style: driver.habit, styleP: 1, styleAt: -99, gapMove: null, gapUntil: 0, amberStop: null, courtesyUntil: 0, hornUntil: 0, honkedUntil: 0, brokenUntil: 0,
      bubble: '', bubbleUntil: 0, says: '', goal: null, follow: null, followLabel: '', restUntil: 0, asked: {}, pending: false,
      x: p.x, z: p.z, dx: p.dx, dz: p.dz, side: 0, leader: null, blocker: null, gap: null, leadV: 0, toLine: Infinity, light: null, hold: '', priorityEta: null, waiting: 0, stopped: 0,
      tailgatedUntil: 0, ambulanceBehind: false, stopDoneAt: -1, indicator: 0, braking: false, age: 0,
    };
    this.cars.push(car);
    this.onPath[lane].push(car);
    this.used.add(lane);
    return car;
  }

  /** One of `lanes`, busier streets more often. */
  private pick(lanes: number[], weight: (lane: Lane) => number = draw): number {
    let total = 0;
    for (const id of lanes) total += weight(this.net.lanes[id]);
    let at = this.rng() * total;
    for (const id of lanes) if ((at -= weight(this.net.lanes[id])) <= 0) return id;
    return lanes[lanes.length - 1];
  }

  /** Lanes that lie on a loop: strongly connected to something other than themselves (Tarjan, iteratively). */
  private loops(): number[] {
    const n = this.net.lanes.length;
    const out = (i: number) => this.net.lanes[i].out.map((c) => this.net.connectors[c].to);
    const index = new Int32Array(n).fill(-1);
    const low = new Int32Array(n);
    const onStack = new Uint8Array(n);
    const stack: number[] = [];
    const found: number[] = [];
    let counter = 0;
    for (let root = 0; root < n; root++) {
      if (index[root] >= 0) continue;
      const work: Array<[number, number]> = [[root, 0]];
      while (work.length) {
        const frame = work[work.length - 1];
        const [v, i] = frame;
        if (i === 0) {
          index[v] = low[v] = counter++;
          stack.push(v);
          onStack[v] = 1;
        }
        const next = out(v);
        if (i < next.length) {
          frame[1]++;
          const w = next[i];
          if (index[w] < 0) work.push([w, 0]);
          else if (onStack[w]) low[v] = Math.min(low[v], index[w]);
          continue;
        }
        work.pop();
        if (work.length) low[work[work.length - 1][0]] = Math.min(low[work[work.length - 1][0]], low[v]);
        if (low[v] === index[v]) {
          const group: number[] = [];
          for (let w = -1; w !== v; ) {
            w = stack.pop()!;
            onStack[w] = 0;
            group.push(w);
          }
          if (group.length > 1) found.push(...group);
        }
      }
    }
    return found;
  }

  private plan(car: Car) {
    const here = car.route[car.route.length - 1];
    const delay = (l: number) => this.queue(l) * 3;
    if (car.wander && this.core.length) {
      // Somewhere else in the heart of the map, then somewhere else again.
      for (let tries = 0; tries < 4; tries++) {
        const to = this.core[Math.floor(this.rng() * this.core.length)];
        const leg = to === here ? null : route(this.net, here, to, delay);
        if (leg) return void car.route.push(...leg.slice(1));
      }
    }
    for (let tries = 0; tries < 5 && this.sinks.length; tries++) {
      const leg = route(this.net, here, this.pick(this.sinks), delay);
      if (leg && leg.length > 1) return void car.route.push(...leg.slice(1));
    }
  }

  /** Stopped or crawling vehicles on a lane. */
  queue(lane: number): number {
    let n = 0;
    for (const c of this.onPath[lane] ?? []) if (c.v < 1.5) n++;
    return n;
  }

  private roomAt(lane: number, s: number, length: number): boolean {
    return this.onPath[lane].every((c) => c.s - c.driver.body.length > s + 5 || c.s < s - length - 5);
  }

  /** Fill the streets before the first frame so the city is already alive. */
  populate(count: number) {
    const lanes = this.net.lanes.filter((l) => l.length > 16 && this.leadsOut.has(l.id));
    const ids = lanes.map((l) => l.id);
    for (let tries = 0; tries < count * 12 && this.cars.length < count && lanes.length; tries++) {
      const lane = this.net.lanes[this.pick(ids, (l) => draw(l) * l.length)];
      const driver = randomDriver(this.rng);
      const s = driver.body.length + 1 + this.rng() * (lane.length - driver.body.length - 8);
      if (!this.roomAt(lane.id, s, driver.body.length)) continue;
      this.plan(this.create(driver, lane.id, s, lane.road.limit * 0.5));
    }
    this.index();
  }

  /** The car you ride in: a taxi that never leaves the map. */
  addTaxi(): Car | null {
    const middle = (l: Lane) => Math.hypot(l.points[0][0] - SIZE / 2, l.points[0][1] - SIZE / 2);
    // Near the middle of the map: that is where the city stands first.
    const lanes = this.core.map((id) => this.net.lanes[id]).filter((l) => l.length > 25 && l.road.rank >= 2).sort((a, b) => middle(a) - middle(b)).slice(0, 24);
    for (let tries = 0; tries < 80 && lanes.length; tries++) {
      const lane = lanes[Math.floor(this.rng() * lanes.length)];
      const driver = taxiDriver(this.rng);
      const s = driver.body.length + 2 + this.rng() * (lane.length - driver.body.length - 12);
      if (!this.roomAt(lane.id, s, driver.body.length)) continue;
      const car = this.create(driver, lane.id, s, lane.road.limit * 0.5);
      car.wander = true;
      this.plan(car);
      this.index();
      return car;
    }
    // A map with no way round the block: the ride is one trip across it, from edge to edge.
    return this.spawn(taxiDriver(this.rng));
  }

  private spawn(driver = randomDriver(this.rng)): Car | null {
    if (!this.sources.length) return null;
    for (let tries = 0; tries < 6; tries++) {
      const lane = this.net.lanes[this.pick(this.sources)];
      const s = driver.body.length + 0.5;
      if (lane.length < s + 2 || !this.roomAt(lane.id, s, driver.body.length)) continue;
      const car = this.create(driver, lane.id, s, lane.road.limit * 0.7);
      this.plan(car);
      return car;
    }
    return null;
  }

  /** The rider named a place: drive to the first of `lanes` that can be reached from here. */
  sendTo(car: Car, lanes: number[], label: string): boolean {
    const from = car.path < this.L ? car.path : car.route[0];
    const near = (id: number) => Math.hypot(this.net.lanes[id].points[0][0] - car.x, this.net.lanes[id].points[0][1] - car.z);
    for (const lane of [...lanes].sort((a, b) => near(a) - near(b)).slice(0, 8)) {
      if (lane === from) continue;
      const leg = route(this.net, from, lane, (l) => this.queue(l) * 3);
      if (!leg) continue;
      // On a connector the turn already begun must be finished: keep the lane it leads to.
      car.route = leg;
      car.goal = { label, lane };
      car.follow = null;
      car.restUntil = 0;
      return true;
    }
    return false;
  }

  /** The rider pointed at a vehicle: go where it goes. */
  followCar(car: Car, target: Car, label: string) {
    car.follow = target;
    car.followLabel = label;
    car.goal = null;
    car.restUntil = 0;
    this.tail(car);
  }

  forget(car: Car) {
    car.goal = null;
    car.follow = null;
  }

  /** Route to wherever the followed vehicle is now, then on along its own route. */
  private tail(car: Car) {
    const target = car.follow;
    if (!target) return;
    if (!this.cars.includes(target)) {
      car.follow = null;
      this.say(car, 'lost them', 3);
      return;
    }
    const from = car.path < this.L ? car.path : car.route[0];
    const theirs = target.path < this.L ? target.path : target.route[0];
    const rest = target.path < this.L ? target.route.slice(1) : target.route.slice(1);
    if (from === theirs) return void (car.route = [from, ...rest]);
    const leg = route(this.net, from, theirs, () => 0);
    if (leg) car.route = [...leg, ...rest];
  }

  sendAmbulance(): Car | null {
    const car = this.spawn(ambulanceDriver(this.rng));
    if (car) this.say(car, 'siren', 4);
    return car;
  }

  /** A breakdown: some moving car stops dead for a while. */
  breakDown(near?: Car): Car | null {
    const moving = this.cars.filter((c) => c.v > 3 && c !== near && !c.ambulance && c.path < this.L && c.toLine > 15 && this.net.lanes[c.path].road.rank >= 2);
    if (!moving.length) return null;
    const pool = near ? moving.sort((a, b) => Math.hypot(a.x - near.x, a.z - near.z) - Math.hypot(b.x - near.x, b.z - near.z)).slice(0, 4) : moving;
    const car = pool[Math.floor(this.rng() * pool.length)];
    car.brokenUntil = this.time + 35;
    this.say(car, 'broken down', 6);
    return car;
  }

  say(car: Car, words: string, seconds = 2.6) {
    car.bubble = words;
    car.bubbleUntil = this.time + seconds;
  }

  honk(car: Car) {
    car.hornUntil = this.time + 0.9;
    if (car.leader) car.leader.honkedUntil = this.time + 6;
    this.say(car, 'honks', 1.4);
    this.onHorn(car);
  }

  // --- Looking ahead --------------------------------------------------------------------------------

  private index() {
    if (this.onPath.length !== this.paths.length) this.onPath = this.paths.map(() => []);
    // Only the paths that had cars need emptying: most of a big city's lanes are bare at any moment.
    for (const key of this.used) this.onPath[key].length = 0;
    this.used.clear();
    for (const car of this.cars) {
      this.onPath[car.path].push(car);
      this.used.add(car.path);
    }
  }

  connectorBetween(from: number, to: number): Connector | null {
    for (const c of this.net.lanes[from].out) if (this.net.connectors[c].to === to) return this.net.connectors[c];
    return null;
  }

  /** The paths a car will drive, starting with the one it is on, with the distance to the start of each. */
  private *chain(car: Car): Generator<{ key: number; from: number }> {
    let from = -car.s;
    let key = car.path;
    let next = car.path < this.L ? 1 : 0;
    for (let guard = 0; guard < 40 && from < LOOK; guard++) {
      yield { key, from };
      from += this.paths[key].length;
      if (key < this.L) {
        const to = car.route[next];
        const c = to === undefined ? null : this.connectorBetween(key, to);
        if (!c) return;
        key = this.L + c.id;
      } else {
        key = car.route[next++];
        if (key === undefined) return;
      }
    }
  }

  private lookAhead(car: Car) {
    car.leader = null;
    car.gap = null;
    car.leadV = 0;
    for (const { key, from } of this.chain(car)) {
      let best: Car | null = null;
      let bestRear = Infinity;
      let bestV = 0;
      const consider = (c: Car, rear: number, v: number) => {
        if (c === car || rear >= bestRear) return;
        // An ambulance drives past anyone who has pulled over for it.
        if (car.ambulance && c.side > 1) return;
        best = c;
        bestRear = rear;
        bestV = v;
      };
      for (const c of this.onPath[key]) if (key !== car.path || c.s > car.s || (c.s === car.s && c.id < car.id)) consider(c, from + c.s - c.driver.body.length, c.v);
      if (key >= this.L) {
        const mine = this.net.connectors[key - this.L];
        // Someone turning off my lane another way still has their tail in my way.
        for (const sibling of this.net.lanes[mine.from].out)
          if (sibling !== mine.id) for (const c of this.onPath[this.L + sibling]) if (c.s - c.driver.body.length < 4 && (key !== car.path || c.s > car.s)) consider(c, from + Math.max(0, c.s - c.driver.body.length), c.v);
        // Inside a junction you brake for whoever is already across your path, whatever the rules said.
        if (key === car.path)
          for (const [id, [mineFrom, mineTo, theirsFrom, theirsTo]] of mine.zones) {
            if (car.s > mineTo) continue;
            const other = this.net.connectors[id];
            const inPatch = (o: Car, front: number) => {
              if (front < theirsFrom - 1 || front - o.driver.body.length > theirsTo + 1) return;
              // Both in it at once: whoever is further in keeps going.
              const [deep, theirDeep] = [car.s - mineFrom, front - theirsFrom];
              if (deep > theirDeep || (deep === theirDeep && car.id < o.id)) return;
              consider(o, Math.max(0.05, from + mineFrom - 1.5), 0);
            };
            for (const o of this.onPath[this.L + id]) inPatch(o, o.s);
            for (const o of this.onPath[other.to]) if (o.behind[0] === this.L + id && o.s < o.driver.body.length) inPatch(o, other.length + o.s);
          }
      }
      if (best) {
        car.leader = best;
        car.gap = Math.max(0.05, bestRear);
        car.leadV = bestV;
        return;
      }
    }
  }

  /** Every connector a car will use soon, and how far away its entry is. */
  private upcoming(car: Car): Array<{ conn: number; dist: number }> {
    const list: Array<{ conn: number; dist: number }> = [];
    for (const { key, from } of this.chain(car)) {
      if (from > 60) break;
      if (key >= this.L && from > 0) list.push({ conn: key - this.L, dist: from });
    }
    return list;
  }

  // --- The junction ------------------------------------------------------------------------------------

  /** Stopped cars each waiting for the next, round in a circle (nose to tail round a block, or across each
   *  other's paths at a roundabout): they can only ever move together, so "leave room beyond" must not hold them. */
  private inRing(car: Car): boolean {
    const waitsFor = (c: Car) => (c.hold === 'crossing' && c.blocker ? c.blocker : c.leader);
    let other = waitsFor(car);
    for (let hops = 0; other && hops < 24; hops++) {
      if (other === car) return true;
      if (other.v > 0.5) return false;
      other = waitsFor(other);
    }
    return false;
  }

  /** Would driving into `conn` now put this car in the path of someone already crossing? */
  private crossed(car: Car, conn: Connector): boolean {
    return this.crosser(car, conn) !== null;
  }

  /** Who is in the way, and how: for the junction rule above and for diagnosing jams. */
  crosser(car: Car, conn: Connector): { car: Car; why: string; eta: number } | null {
    const length = car.driver.body.length;
    // How long a driver waits politely before pushing in is Jev's call: bold ones at once, patient ones late.
    const move = car.gapUntil > this.time ? car.gapMove : null;
    const patience = car.ambulance || move === 'go' || move === 'creep' ? 0 : move === 'wait' ? 14 : 7;
    const pushing = car.waiting > patience;
    for (const id of conn.conflicts) {
      const zone = conn.zones.get(id);
      if (!zone) continue;
      const [, mineTo, theirsFrom, theirsTo] = zone;
      const other = this.net.connectors[id];
      // Someone who has left that connector may still be dragging their tail across the shared patch.
      for (const o of this.onPath[other.to]) if (o.behind[0] === this.L + id && other.length + o.s - o.driver.body.length < theirsTo + 1.5 && o.s < o.driver.body.length) return { car: o, why: `tail on conn${id}`, eta: 0 };
      for (const o of this.onPath[this.L + id]) {
        if (o.s - o.driver.body.length > theirsTo + 1.5) continue;
        if (o.s > theirsFrom - 2) return { car: o, why: `in the shared patch of conn${id}`, eta: 0 };
        const theirs = (theirsFrom - 2 - o.s) / Math.max(o.v, 1.5);
        // Never right under someone's wheels.
        if (theirs < 1.8) return { car: o, why: `on conn${id}, there in ${theirs.toFixed(1)} s`, eta: theirs };
        if (pushing || !conn.yieldsTo.includes(id)) continue;
        // Giving way properly: through and gone before they get there.
        const room = car.toLine + mineTo + 1.5 + length;
        const mine = Math.sqrt(room) + (car.v < 1 ? 0.8 : 0);
        const clearAhead = !car.leader || (car.gap ?? 99) > room + 2 || car.leadV > 3;
        if (!clearAhead || theirs < mine + 1) return { car: o, why: `giving way to conn${id}: there in ${theirs.toFixed(1)} s, I need ${mine.toFixed(1)} s`, eta: theirs };
      }
    }
    return null;
  }

  /** May this car drive off the end of its lane into the connector? If not, why not. */
  private entry(car: Car, lane: Lane, conn: Connector, approaching: Map<number, Array<{ car: Car; dist: number }>>): Hold {
    const light = this.light(lane);
    car.light = light;
    car.priorityEta = null;
    if (light === 'red' && !car.ambulance) return 'red';
    if (light === 'amber' && !car.ambulance) {
      const needed = (car.v * car.v) / (2 * Math.max(0.5, car.toLine));
      // No judgment needed at the extremes: plenty of room, or none at all.
      const stop = needed < 1.4 ? true : needed > 5.5 ? false : (car.amberStop ?? needed < 3);
      if (stop) return 'amber';
    }
    if (lane.sign === 'stop' && car.stopDoneAt !== lane.id && !car.ambulance) return 'stop';

    // Do not block the box: whoever is ahead must leave this car room beyond the junction.
    if (car.leader && car.gap !== null && car.leadV < 1.5 && car.leader.v < 1.5 && !this.inRing(car)) {
      const beyond = car.gap - car.toLine - conn.length;
      if (beyond < car.driver.body.length + 2) return 'box';
    }

    // Never drive into someone who is already crossing.
    const across = this.crosser(car, conn);
    car.blocker = across?.car ?? null;
    if (across) {
      car.priorityEta = across.eta;
      return 'crossing';
    }

    // Give way: is anyone with priority about to arrive?
    let eta = Infinity;
    for (const id of conn.yieldsTo)
      for (const other of approaching.get(id) ?? []) {
        if (other.car === car || other.car.courtesyUntil > this.time || other.car.brokenUntil > this.time) continue;
        // Two drivers each waiting for the other: whoever has waited longer goes first.
        if (other.car.v < 0.3 && other.car.waiting > 1.5 && car.waiting > 3 && (car.waiting > other.car.waiting || (car.waiting === other.car.waiting && car.id < other.car.id))) continue;
        // Stuck in a queue or at their own red light: not coming yet.
        if (other.car.v < 0.5 && (other.dist > 6 || other.car.hold === 'red' || other.car.hold === 'box' || other.car.hold === 'amber')) continue;
        eta = Math.min(eta, other.dist / Math.max(other.car.v, 2.5));
      }
    if (eta === Infinity) return '';
    car.priorityEta = eta;
    const move = car.gapUntil > this.time ? car.gapMove : null;
    // Jev chooses how bold to be; the floor of 1.6 s is not negotiable.
    const accepts = car.ambulance ? 1.6 : move === 'go' ? 1.7 : move === 'creep' ? 2.6 : move === 'wait' ? 6 : 4;
    if (eta > Math.max(1.6, accepts)) return '';
    // Two cars each politely waiting for the other would wait for ever.
    if (car.waiting > 14 && eta > 1.6) return '';
    return 'gap';
  }

  // --- One step --------------------------------------------------------------------------------------

  step(dt: number) {
    this.time += dt;
    this.index();
    for (const key of this.used) this.onPath[key].sort((a, b) => a.s - b.s);

    const approaching = new Map<number, Array<{ car: Car; dist: number }>>();
    for (const car of this.cars) {
      if (car.follow && (this.time * 2) % 1 < dt * 2) this.tail(car);
      if (car.goal && car.path === car.goal.lane && car.restUntil <= this.time && car.toLine < this.net.lanes[car.path].length * 0.6) {
        // Arrived: stand at the kerb a moment, then the ride goes on.
        this.say(car, 'here we are', 5);
        car.restUntil = this.time + 8;
        car.goal = null;
      }
      if (car.wander && !car.follow && !car.onRails && car.route.length < 4) this.plan(car);
      for (const u of this.upcoming(car)) (approaching.get(u.conn) ?? approaching.set(u.conn, []).get(u.conn)!).push({ car, dist: u.dist });
    }

    for (const car of this.cars) car.ambulanceBehind = false;
    for (const car of this.cars)
      if (car.ambulance)
        for (const { key, from } of this.chain(car)) {
          if (from > 70) break;
          for (const c of this.onPath[key]) if (c !== car && (key !== car.path || c.s > car.s)) c.ambulanceBehind = true;
        }

    for (const car of this.cars) {
      car.age += dt;
      const manner = MANNERS[car.style];
      const onLane = car.path < this.L;
      const lane = onLane ? this.net.lanes[car.path] : null;
      const conn = onLane ? (car.route[1] === undefined ? null : this.connectorBetween(car.path, car.route[1])) : this.net.connectors[car.path - this.L];
      const limit = (lane ?? this.net.lanes[this.net.connectors[car.path - this.L].to]).road.limit;
      const heavy = car.driver.body.length > 6 ? 0.8 : 1;
      const turnSpeed = !conn ? 99 : conn.turn === 'uturn' ? 2.6 : conn.turn === 'right' ? 4.6 * heavy : conn.turn === 'left' ? 5.6 * heavy : 99;

      car.toLine = lane ? lane.length - car.s : Infinity;
      car.indicator = conn && (lane ? car.toLine < 35 : true) ? (conn.turn === 'left' || conn.turn === 'uturn' ? -1 : conn.turn === 'right' ? 1 : 0) : 0;
      this.lookAhead(car);

      let desired = Math.min(limit * manner.speed * (car.ambulance ? 1.25 : 1), manner.cap, onLane ? Math.sqrt(turnSpeed * turnSpeed + 2 * 1.7 * car.toLine) : turnSpeed);
      // Only the kerb lane has a kerb to pull over to; further out, a driver just slows right down.
      const pullingOver = car.style === 'pull_over' && lane !== null && lane.index === 0 && car.toLine > 8;
      if (pullingOver) desired = 0;
      if (car.style === 'pull_over' && !pullingOver) desired = Math.min(desired, 3);
      if (car.brokenUntil > this.time || (car.restUntil > this.time && onLane)) desired = 0;
      const aside = lane && (pullingOver || (car.restUntil > this.time && lane.index === 0)) ? (lane.road.oneway ? Math.max(1.4, lane.road.width / 2 - 1.6) : 1.5) : 0;
      car.side += (aside - car.side) * Math.min(1, dt * 1.5);

      // Intelligent Driver Model: free road, then whatever is in the way.
      const accel = car.ambulance ? 3 : manner.accel;
      const free = desired <= 0.05 ? -manner.brake : accel * (1 - (car.v / Math.max(0.1, desired)) ** 4);
      const obstacle = (gap: number, closing: number, standstill: number) => {
        const wish = standstill + Math.max(0, car.v * manner.headway + (car.v * closing) / (2 * Math.sqrt(accel * manner.brake)));
        return accel * (1 - (car.v / Math.max(0.1, Math.max(desired, car.v))) ** 4 - (wish / Math.max(0.1, gap)) ** 2);
      };
      let a = free;
      if (car.leader && car.gap !== null) a = Math.min(a, obstacle(car.gap, car.v - car.leadV, manner.standstill));
      if (car.leader && car.gap !== null && car.gap < Math.max(3.5, car.v * 0.45) && car.v > 4) car.leader.tailgatedUntil = this.time + 2.5;

      car.hold = car.brokenUntil > this.time ? 'broken' : '';
      if (lane && conn && !lane.sink && car.toLine < Math.max(45, (car.v * car.v) / 3)) {
        let hold = this.entry(car, lane, conn, approaching);
        if (!hold && car.courtesyUntil > this.time && car.toLine > 2) hold = 'courtesy';
        if (hold) {
          car.hold = car.hold || hold;
          // A driver who creeps claims an extra metre and a half of junction.
          const nose = hold === 'gap' && car.gapUntil > this.time && car.gapMove === 'creep' ? 1.5 : 0;
          a = Math.min(a, obstacle(Math.max(0.05, car.toLine - 0.6 + nose), car.v, 0.4));
        }
      } else if (!lane) car.light = null;
      else if (car.toLine >= 45) car.light = this.light(lane);

      car.a = Math.max(-8, Math.min(accel, a));
      car.braking = car.a < -0.7 || (car.v < 0.2 && car.hold !== '');
    }

    // Move, and change path where a path ends.
    for (const car of [...this.cars]) {
      car.v = Math.max(0, car.v + car.a * dt);
      if (car.v < 0.02 && car.a <= 0) car.v = 0;
      car.s += car.v * dt;
      const first = car.leader === null || (car.gap ?? 99) > car.toLine;
      car.waiting = car.v < 0.4 && first && car.toLine < 4 && (car.hold === 'gap' || car.hold === 'crossing' || car.hold === 'stop') ? car.waiting + dt : car.v > 1.5 ? 0 : car.waiting;
      car.stopped = car.v < 0.3 ? car.stopped + dt : 0;
      if (car.path < this.L && this.net.lanes[car.path].sign === 'stop' && car.v < 0.3 && car.toLine < 3) car.stopDoneAt = car.path;
      if (car.light !== 'amber') car.amberStop = null;

      for (let guard = 0; guard < 6 && car.s > this.paths[car.path].length; guard++) {
        const length = this.paths[car.path].length;
        let next: number;
        if (car.path < this.L) {
          const lane = this.net.lanes[car.path];
          const conn = car.route[1] === undefined ? null : this.connectorBetween(car.path, car.route[1]);
          if (lane.sink || !conn) {
            this.remove(car);
            break;
          }
          // The last word: two cars that both saw a clear junction in the same instant.
          if (car.hold || this.crossed(car, conn)) {
            car.s = length - 0.01;
            car.v = 0;
            break;
          }
          next = this.L + conn.id;
          car.route.shift();
        } else next = car.route[0];
        this.onPath[car.path].splice(this.onPath[car.path].indexOf(car), 1);
        car.behind.unshift(car.path);
        car.behind.length = Math.min(car.behind.length, 6);
        car.s -= length;
        car.path = next;
        this.onPath[next].push(car);
        this.used.add(next);
      }
    }

    // Last resort: a vehicle that has not moved for ages, with no red light to blame, gets towed away.
    for (const car of [...this.cars])
      if (car.stopped > 120 && car.hold !== 'red' && car.hold !== 'broken' && car.style !== 'pull_over' && !car.wander) {
        this.towed++;
        this.remove(car);
      }

    for (const car of this.cars) this.place(car);

    this.spawnClock += dt;
    if (this.spawnClock > 0.6) {
      this.spawnClock = 0;
      const ordinary = this.cars.reduce((n, c) => n + (c.wander || c.ambulance ? 0 : 1), 0);
      if (ordinary < this.target) this.spawn();
    }
  }

  private remove(car: Car) {
    this.cars.splice(this.cars.indexOf(car), 1);
    const list = this.onPath[car.path];
    list.splice(list.indexOf(car), 1);
    this.onLeave(car);
  }

  /** A point `back` metres behind the front bumper, following the road the car came along. */
  private pointBehind(car: Car, back: number) {
    let d = car.s - back;
    if (d >= 0) return along(this.paths[car.path], d);
    for (const key of car.behind) {
      const path = this.paths[key];
      if (d + path.length >= 0) return along(path, d + path.length);
      d += path.length;
    }
    const first = this.paths[car.behind[car.behind.length - 1] ?? car.path];
    const p = along(first, 0);
    return { x: p.x + p.dx * d, z: p.z + p.dz * d, dx: p.dx, dz: p.dz };
  }

  private place(car: Car) {
    const front = this.pointBehind(car, 0.4);
    const rear = this.pointBehind(car, car.driver.body.length - 0.4);
    const len = Math.hypot(front.x - rear.x, front.z - rear.z) || 1;
    car.dx = (front.x - rear.x) / len;
    car.dz = (front.z - rear.z) / len;
    car.x = (front.x + rear.x) / 2 - car.dz * car.side;
    car.z = (front.z + rear.z) / 2 + car.dx * car.side;
  }

  // --- Things the brain wants to know -------------------------------------------------------------

  /** Other ways out of the junction ahead that still lead where this car is going. */
  alternatives(car: Car): Array<{ turn: 'left' | 'straight' | 'right'; lane: number; extra: number; queued: number; moving: boolean }> {
    if (car.path >= this.L || car.route.length < 2) return [];
    const goal = car.route[car.route.length - 1];
    const cost = (lanes: number[]) => lanes.reduce((s, id) => s + this.net.lanes[id].length / this.net.lanes[id].road.limit, 0);
    const planned = cost(car.route.slice(1));
    const found: ReturnType<Traffic['alternatives']> = [];
    for (const id of this.net.lanes[car.path].out) {
      const c = this.net.connectors[id];
      // Another lane of the street already planned is not another way.
      if (c.to === car.route[1] || c.turn === 'uturn' || this.net.lanes[c.to].stretch === this.net.lanes[car.route[1]].stretch) continue;
      const rest = car.wander ? [c.to] : route(this.net, c.to, goal, () => 0);
      if (!rest || found.some((f) => f.turn === c.turn)) continue;
      const cars = this.onPath[c.to];
      found.push({ turn: c.turn, lane: c.to, extra: car.wander ? 0 : Math.max(0, Math.round(cost(rest) - planned)), queued: this.queue(c.to), moving: cars.length === 0 || cars.some((o) => o.v > 2) });
    }
    return found;
  }

  /** Take another way at the next junction. */
  divert(car: Car, lane: number): boolean {
    if (car.path >= this.L || car.onRails) return false;
    const goal = car.route[car.route.length - 1];
    const rest = car.wander ? [lane] : route(this.net, lane, goal, (l) => this.queue(l) * 3);
    if (!rest || !this.connectorBetween(car.path, lane)) return false;
    car.route = [car.path, ...rest];
    return true;
  }

  /** Is traffic on this lane moving (or is the lane empty)? */
  flowing(lane: number): boolean {
    const cars = this.onPath[lane] ?? [];
    return cars.length === 0 || cars.some((c) => c.v > 2);
  }

  vehiclesBehind(car: Car): number {
    if (car.path >= this.L) return 0;
    return this.onPath[car.path].filter((c) => c.s < car.s && c.v < 1).length;
  }

  /** Someone who has waited a while to pull out across this car's path. */
  waitingToCross(car: Car): Car | null {
    if (car.path >= this.L || car.route[1] === undefined) return null;
    const mine = this.connectorBetween(car.path, car.route[1]);
    if (!mine) return null;
    for (const other of this.cars) {
      if (other.hold !== 'gap' || other.waiting < 5 || other.path >= this.L || other.route[1] === undefined) continue;
      const theirs = this.connectorBetween(other.path, other.route[1]);
      if (theirs && theirs.yieldsTo.includes(mine.id)) return other;
    }
    return null;
  }

  lanesCount() {
    return this.L;
  }
}
