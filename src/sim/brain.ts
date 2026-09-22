// The drivers' minds. Several times a second this gathers the cars that need a judgment right now
// (an amber light, a gap in traffic, a reason to honk) plus the ones whose mood is simply due for a
// fresh look, and puts them to Jev in one request. Answers come back as typed fields on each car.

import { MAX_CARS_PER_REQUEST, MAX_VEHICLES, type AskKind, type CarQuery, type DriveReply, type IntentQuery, type IntentReply, type Situation, type Turn } from '../../shared/drive';
import { vehiclesAround, type PlaceOption } from './places';
import { STYLE_WORDS } from './drivers';
import type { Car, Traffic } from './cars';

/** A TypeSafe key typed on the title page: held here only, never stored, sent with each question. */
let givenKey = '';
export const setTypesafeKey = (key: string) => (givenKey = key.trim());
export const hasTypesafeKey = () => Boolean(givenKey);
const keyHeader = (): Record<string, string> => (givenKey ? { 'x-typesafe-key': givenKey } : {});

export interface Verdict {
  id: number;
  at: number;
  car: number;
  who: string;
  kind: AskKind;
  text: string;
  p: number;
  mine: boolean;
}

export interface BrainStats {
  requests: number;
  questions: number;
  tokens: number;
  latency: number;
  inFlight: number;
  error: string;
  model: string;
  /** The TypeSafe account has run dry: drivers are on their fixed habits until it is topped up. */
  noCredit: boolean;
}

const MAX_IN_FLIGHT = 3;
const TICK = 0.22;
/** Requests per second, averaged: about a dollar and a half an hour at full tilt. */
const BUDGET = 2.2;
/** Dollars per input token. */
export const PRICE = 42 / 1e9;

const away0 = (brain: Brain, car: Car) => (car === brain.focus ? 0 : Math.hypot(car.x - brain.viewer.x, car.z - brain.viewer.z));

export class Brain {
  enabled = true;
  /** The car being ridden: asked more often, and the only one with a passenger talking. */
  focus: Car | null = null;
  raining = false;
  night = false;
  /** What exists on this map for a passenger to ask for; worked out afresh each time, as the town is still rising. */
  places: () => PlaceOption[] = () => [];
  /** Where the person is looking from: drivers nearby get a fresh look most often. */
  viewer = { x: 0, z: 0 };
  readonly stats: BrainStats = { requests: 0, questions: 0, tokens: 0, latency: 0, inFlight: 0, error: '', model: '', noCredit: false };

  private clock = 0;
  private allowance = 2;
  private backoff = 0;
  private verdictId = 1;

  constructor(
    private readonly traffic: Traffic,
    private readonly onVerdict: (v: Verdict) => void,
    private readonly onStats: (s: BrainStats) => void,
  ) {}

  setEnabled(on: boolean) {
    this.enabled = on;
    if (on) return;
    // Without Jev every driver falls back on one fixed habit.
    for (const car of this.traffic.cars) {
      car.style = car.driver.habit;
      car.gapMove = null;
      car.amberStop = null;
      car.courtesyUntil = 0;
    }
  }

  // --- What a driver sees --------------------------------------------------------------------------

  situation(car: Car): Situation {
    const t = this.traffic;
    const L = t.lanesCount();
    const lane = car.path < L ? t.net.lanes[car.path] : t.net.lanes[car.route[0]];
    const d = Math.round(car.toLine);
    let comingUp = 'open road';
    if (car.leader && car.leader.brokenUntil > t.time && (car.gap ?? 99) < 45) comingUp = `broken-down vehicle blocking the lane in ${Math.round(car.gap ?? 0)} m`;
    else if (car.path >= L) comingUp = 'crossing a junction';
    else if (lane.sink || d > 90) comingUp = 'open road';
    else if (car.light) comingUp = `traffic light, ${car.light}, in ${d} m`;
    else if (lane.sign) comingUp = `${lane.sign === 'stop' ? 'stop sign' : 'give way sign'} in ${d} m`;
    else {
      const conn = car.route[1] === undefined ? null : t.connectorBetween(car.path, car.route[1]);
      if (conn) comingUp = `junction in ${d} m, ${conn.yieldsTo.length ? 'must give way' : 'has priority'}, going ${conn.turn === 'uturn' ? 'back' : conn.turn}`;
    }
    return {
      speed_kmh: Math.round(car.v * 3.6),
      speed_limit_kmh: Math.round(lane.road.limit * 3.6),
      road: lane.road.name || `${lane.road.kind} road`,
      metres_to_vehicle_ahead: car.gap !== null && car.gap < 80 ? Math.round(car.gap) : null,
      vehicle_ahead_speed_kmh: car.leader && car.gap !== null && car.gap < 80 ? Math.round(car.leadV * 3.6) : null,
      seconds_stopped: Math.round(car.stopped),
      being_tailgated: car.tailgatedUntil > t.time,
      being_honked_at: car.honkedUntil > t.time,
      ambulance_behind_with_siren: car.ambulanceBehind,
      coming_up: comingUp,
      raining: this.raining,
      night: this.night,
    };
  }

  /** Which questions this car needs answered now; urgent ones first. */
  private needs(car: Car): { ask: AskKind[]; urgent: boolean; query: Partial<CarQuery>; turnLanes?: Partial<Record<Turn, number>> } {
    const t = this.traffic;
    const now = t.time;
    const since = (k: string) => now - (car.asked[k] ?? -99);
    const ask: AskKind[] = [];
    const query: Partial<CarQuery> = {};
    let turnLanes: Partial<Record<Turn, number>> | undefined;
    const onLane = car.path < t.lanesCount();

    if (car.light === 'amber' && car.amberStop === null && onLane && since('amber') > 5) {
      const needed = (car.v * car.v) / (2 * Math.max(0.5, car.toLine));
      if (needed >= 1.4 && needed <= 5.5) {
        ask.push('amber');
        query.amber = { metres_to_stop_line: Math.round(car.toLine), could_stop_comfortably: needed < 3 };
      }
    }
    if ((car.hold === 'gap' || car.hold === 'crossing') && car.toLine < 5 && car.waiting > 1 && since('gap') > 3.5 && car.priorityEta !== null) {
      ask.push('gap');
      query.gap = { seconds_until_next_priority_vehicle: Math.round(car.priorityEta * 10) / 10, seconds_waiting: Math.round(car.waiting), vehicles_waiting_behind: t.vehiclesBehind(car) };
    }
    const leader = car.leader;
    if (leader && car.stopped > 6 && (car.gap ?? 99) < 7 && car.hold === '' && since('horn') > 9 && !car.ambulance) {
      const because =
        leader.brokenUntil > now ? 'the vehicle ahead has broken down and blocks the lane'
        : leader.hold === 'red' || leader.hold === 'amber' ? ''
        : leader.light === 'green' && leader.stopped > 2 ? `the light is green and the ${leader.driver.card.vehicle} ahead is not moving`
        : leader.style === 'pull_over' ? ''
        : `stuck behind a stationary ${leader.driver.card.vehicle} for ${Math.round(car.stopped)} seconds`;
      if (because) {
        ask.push('horn');
        query.horn = { because };
      }
    } else if (leader && leader.style === 'crawl' && (car.gap ?? 99) < 10 && car.v < 5 && since('horn') > 12 && !car.ambulance) {
      ask.push('horn');
      query.horn = { because: `the ${leader.driver.card.vehicle} ahead is crawling at ${Math.round(leader.v * 3.6)} km/h` };
    }
    if (onLane && car.v > 1 && car.toLine < 32 && car.hold === '' && since('courtesy') > 10) {
      const other = t.waitingToCross(car);
      if (other) {
        ask.push('courtesy');
        query.courtesy = { other_driver_has_waited_seconds: Math.round(other.waiting) };
      }
    }
    if (onLane && car.toLine > 12 && car.toLine < 70 && car.route[1] !== undefined && since('turn') > 10 && car.asked.turnLane !== car.path) {
      const queued = t.queue(car.route[1]);
      if (queued >= 4 || (car === this.focus && car.says)) {
        const options = t.alternatives(car);
        if (options.length) {
          const planned = t.net.lanes[car.route[1]];
          query.turn = { follow_navigation: { extra_seconds: 0, vehicles_queued: queued, traffic_moving: t.flowing(planned.id) } };
          turnLanes = {};
          for (const o of options) {
            query.turn[o.turn] = { extra_seconds: o.extra, vehicles_queued: o.queued, traffic_moving: o.moving };
            turnLanes[o.turn] = o.lane;
          }
          ask.push('turn');
        }
      }
    }

    // Far from anyone watching, the fixed thresholds decide amber lights and gaps; Jev is kept for what can be seen.
    if (away0(this, car) > 420) ask.length = 0;
    const urgent = ask.length > 0;
    // The mood: refreshed on a slow rota, at once when something changes around the driver.
    const jolt = (car.honkedUntil > now && since('style') > 1.5 && (car.asked.styleHonk ?? 0) < car.honkedUntil) || (car.ambulanceBehind && car.style !== 'pull_over' && since('style') > 1.2) || (!car.ambulanceBehind && car.style === 'pull_over' && since('style') > 1.2) || (car.asked.saysSeen ?? 0) < (car.asked.saysAt ?? 0);
    // The drivers around you are looked at often, the far side of town seldom: the bill stays flat however big the city.
    const away = Math.hypot(car.x - this.viewer.x, car.z - this.viewer.z);
    const due = since('style') > (car === this.focus ? 3 : away < 130 ? 7 : away < 320 ? 18 : 45);
    if (jolt || due || (urgent && since('style') > 3)) ask.push('style');
    return { ask, urgent: urgent || jolt, query, turnLanes };
  }

  // --- The loop --------------------------------------------------------------------------------------

  update(dt: number) {
    this.clock += dt;
    if (!this.enabled || this.clock < TICK + this.backoff) return;
    this.allowance = Math.min(3, this.allowance + this.clock * BUDGET);
    this.clock = 0;
    if (this.stats.inFlight >= MAX_IN_FLIGHT || this.allowance < 1) return;

    const wanted = this.traffic.cars.filter((c) => !c.pending && !c.ambulance).map((car) => ({ car, ...this.needs(car) })).filter((w) => w.ask.length);
    if (!wanted.length) return;
    // Urgent first, then the rider's car, then whoever has gone longest without a fresh look.
    wanted.sort((a, b) => Number(b.urgent) - Number(a.urgent) || Number(b.car === this.focus) - Number(a.car === this.focus) || (a.car.asked.style ?? -99) - (b.car.asked.style ?? -99));
    const batch = wanted.slice(0, MAX_CARS_PER_REQUEST);
    // Not worth a request for one routine mood check; wait for company.
    if (!batch.some((w) => w.urgent) && batch.length < Math.min(4, this.traffic.cars.length)) return;

    const now = this.traffic.time;
    const cars: CarQuery[] = batch.map((w) => {
      w.car.pending = true;
      for (const k of w.ask) w.car.asked[k] = now;
      if (w.ask.includes('turn')) w.car.asked.turnLane = w.car.path;
      if (w.ask.includes('style')) {
        w.car.asked.styleHonk = w.car.honkedUntil;
        w.car.asked.saysSeen = w.car.asked.saysAt ?? 0;
      }
      const driver = { ...w.car.driver.card, ...(w.car.says ? { passenger_says: w.car.says } : {}) };
      return { id: `c${w.car.id}`, driver, situation: this.situation(w.car), ask: w.ask, ...w.query };
    });
    this.allowance -= 1;
    void this.send(cars, batch);
  }

  private async send(cars: CarQuery[], batch: Array<{ car: Car; turnLanes?: Partial<Record<Turn, number>> }>) {
    this.stats.inFlight++;
    this.onStats(this.stats);
    try {
      const res = await fetch('/api/drive', { method: 'POST', headers: { 'Content-Type': 'application/json', ...keyHeader() }, body: JSON.stringify({ cars }) });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw Object.assign(new Error(body.error ?? `HTTP ${res.status}`), { status: res.status });
      }
      const reply = (await res.json()) as DriveReply;
      this.stats.requests++;
      this.stats.questions += reply.questions;
      this.stats.tokens += reply.inputTokens;
      this.stats.latency = this.stats.latency ? this.stats.latency * 0.8 + reply.latencyMs * 0.2 : reply.latencyMs;
      this.stats.model = reply.model;
      this.stats.error = '';
      this.stats.noCredit = false;
      this.backoff = 0;
      if (this.enabled) this.apply(reply, batch);
    } catch (error) {
      const status = (error as { status?: number }).status;
      this.stats.error = (error as Error).message;
      if (status === 402) {
        // No credits: every driver back to a fixed habit, and only one quiet try a minute to see if that has changed.
        this.stats.noCredit = true;
        this.setEnabled(false);
        this.enabled = true;
        this.backoff = 60;
        return;
      }
      // Told to slow down, or the service is struggling: leave it alone for a while.
      this.backoff = Math.min(10, status === 429 || status === 503 ? Math.max(3, this.backoff * 2) : Math.max(1, this.backoff * 1.5));
    } finally {
      for (const w of batch) w.car.pending = false;
      this.stats.inFlight--;
      this.onStats(this.stats);
    }
  }

  private apply(reply: DriveReply, batch: Array<{ car: Car; turnLanes?: Partial<Record<Turn, number>> }>) {
    const t = this.traffic;
    for (const d of reply.decisions) {
      const entry = batch.find((w) => `c${w.car.id}` === d.id);
      if (!entry || !t.cars.includes(entry.car)) continue;
      const car = entry.car;
      const tell = (kind: AskKind, text: string, p: number, bubble = true) => {
        if (bubble) t.say(car, text);
        this.onVerdict({ id: this.verdictId++, at: t.time, car: car.id, who: car.driver.card.vehicle, kind, text, p, mine: car === this.focus });
      };
      if (d.style) {
        const changed = d.style.choice !== car.style;
        car.style = d.style.choice;
        car.styleP = d.style.probabilities[d.style.choice];
        car.styleAt = t.time;
        if (changed) tell('style', STYLE_WORDS[car.style], car.styleP);
      }
      if (d.gap) {
        car.gapMove = d.gap.choice;
        car.gapUntil = t.time + 5;
        tell('gap', d.gap.choice === 'go' ? 'goes for the gap' : d.gap.choice === 'creep' ? 'noses out' : 'waits for a bigger gap', d.gap.probabilities[d.gap.choice], d.gap.choice !== 'wait');
      }
      if (d.amber_stop !== undefined && car.light === 'amber') {
        car.amberStop = d.amber_stop >= 0.5;
        tell('amber', car.amberStop ? 'stops for amber' : 'runs the amber', car.amberStop ? d.amber_stop : 1 - d.amber_stop);
      }
      if (d.horn !== undefined && d.horn >= 0.55 && car.leader) {
        t.honk(car);
        tell('horn', 'sounds the horn', d.horn, false);
      }
      if (d.courtesy !== undefined && d.courtesy >= 0.55) {
        car.courtesyUntil = t.time + 5;
        tell('courtesy', 'waves them in', d.courtesy);
      }
      if (d.turn && d.turn.choice !== 'follow_navigation') {
        const lane = entry.turnLanes?.[d.turn.choice];
        if (lane !== undefined && t.divert(car, lane)) tell('turn', `turns ${d.turn.choice} instead`, d.turn.probabilities[d.turn.choice]);
      }
    }
  }

  /** "Go to the sea", "follow the red car": Jev picks what was meant from what the code knows exists. */
  private async understand(car: Car, words: string) {
    const places = this.places();
    const vehicles = vehiclesAround(car, this.traffic.cars, MAX_VEHICLES);
    const query: IntentQuery = { passenger_says: words, places: places.map((p) => p.label), vehicles: vehicles.map((v) => v.label) };
    try {
      const res = await fetch('/api/intent', { method: 'POST', headers: { 'Content-Type': 'application/json', ...keyHeader() }, body: JSON.stringify(query) });
      if (res.status === 402) {
        this.stats.noCredit = true;
        this.traffic.say(car, 'Jev is out of credits', 5);
      }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const reply = (await res.json()) as IntentReply;
      this.stats.requests++;
      this.stats.questions += 2;
      this.stats.tokens += reply.inputTokens;
      this.onStats(this.stats);
      if (!this.traffic.cars.includes(car) || car.says !== words) return;
      const t = this.traffic;
      const note = (text: string, p: number) => this.onVerdict({ id: this.verdictId++, at: t.time, car: car.id, who: car.driver.card.vehicle, kind: 'turn', text, p, mine: true });
      const target = reply.vehicle >= 0 && reply.vehicleP >= 0.45 ? vehicles[reply.vehicle] : null;
      const place = reply.place >= 0 && reply.placeP >= 0.4 ? places[reply.place] : null;
      if (target && (!place || reply.vehicleP >= reply.placeP)) {
        t.followCar(car, target.car, target.label.split(',')[0]);
        t.say(target.car, 'followed', 4);
        note(`follows the ${target.label.split(',')[0]}`, reply.vehicleP);
      } else if (reply.unmatched && !place) {
        t.say(car, 'nothing like that in sight', 4);
        note('sees no such vehicle to follow', reply.vehicleP);
      } else if (place) {
        const name = place.label.split(':')[0];
        if (t.sendTo(car, place.lanes, name)) note(`heads for ${name}`, reply.placeP);
        else note(`cannot reach ${name} from here`, reply.placeP);
      }
    } catch (error) {
      this.stats.error = (error as Error).message;
      this.onStats(this.stats);
    }
  }

  /** The rider speaks to their driver. */
  tell(car: Car, words: string) {
    car.says = words.trim().slice(0, 140);
    if (!car.says) this.traffic.forget(car);
    else if (this.enabled) void this.understand(car, car.says);
    car.asked.saysAt = this.traffic.time + 0.001;
    car.asked.turnLane = -1;
    car.asked.turn = -99;
  }
}
