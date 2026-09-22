// Every question Jev is asked about a driver lives here. One request carries up to ten cars;
// each car gets only the questions that matter to it right now, and all of them run in parallel.

import { APIError, TypeSafeClient, type Questions } from '@typesafe-ai/sdk';
import { GAP_MOVES, MAX_CARS_PER_REQUEST, MAX_PLACES, MAX_VEHICLES, STYLES, TURNS, type AskKind, type CarDecision, type CarQuery, type DriveReply, type IntentReply, type Turn } from '../shared/drive.ts';

export class JevError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

export interface JevConfig {
  apiKey: string | undefined;
  model: string;
}

const STYLE_CRITERIA = {
  cruise: 'Drives normally: at the limit, with a sensible gap. The default when nothing calls for anything else, including while waiting at a red light or in a queue',
  hurry: 'Pushes on: a little over the limit, closer to the car ahead, quick off the mark. Someone late, confident, or told to hurry',
  tailgate: 'Drives aggressively: well over the limit, right on the bumper ahead. Only for an angry or reckless driver who is being held up',
  ease_off: 'Drives gently: under the limit with a long gap. Rain, darkness, a nervous or careful driver, a fragile load, a passenger asking for calm, or a scare just now',
  crawl: 'Creeps along far below the limit: lost, distracted, sightseeing, or looking for somewhere to park',
  pull_over: 'Steers to the kerb and stops there, out of the traffic. Only when ambulance_behind_with_siren is true, or the passenger demands to stop or get out right now. Never just because the car is standing at a light or in a queue',
} as const;

const GAP_CRITERIA = {
  go: 'Pull out now: the gap is big enough for this driver',
  wait: 'Stay put and wait for a bigger gap',
  creep: 'Edge the nose forward to claim the junction, without fully pulling out: an impatient driver who has waited a long time',
} as const;

// --- Input hygiene ------------------------------------------------------------------

const text = (v: unknown, max: number) => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, max) : '');
const num = (v: unknown, lo: number, hi: number) => (typeof v === 'number' && Number.isFinite(v) ? Math.round(Math.min(hi, Math.max(lo, v)) * 10) / 10 : lo);
const numOrNull = (v: unknown, lo: number, hi: number) => (v === null || v === undefined ? null : num(v, lo, hi));
const ASKS: AskKind[] = ['style', 'gap', 'amber', 'turn', 'horn', 'courtesy'];

function cleanCar(input: unknown): CarQuery | null {
  if (!input || typeof input !== 'object') return null;
  const c = input as Record<string, unknown>;
  const id = text(c.id, 12);
  const ask = Array.isArray(c.ask) ? ASKS.filter((k) => (c.ask as unknown[]).includes(k)) : [];
  if (!/^c\d{1,5}$/.test(id) || !ask.length) return null;
  const d = (c.driver ?? {}) as Record<string, unknown>;
  const s = (c.situation ?? {}) as Record<string, unknown>;
  const car: CarQuery = {
    id,
    ask,
    driver: { vehicle: text(d.vehicle, 40), temperament: text(d.temperament, 60), trip: text(d.trip, 80) },
    situation: {
      speed_kmh: num(s.speed_kmh, 0, 200),
      speed_limit_kmh: num(s.speed_limit_kmh, 5, 130),
      road: text(s.road, 40),
      metres_to_vehicle_ahead: numOrNull(s.metres_to_vehicle_ahead, 0, 500),
      vehicle_ahead_speed_kmh: numOrNull(s.vehicle_ahead_speed_kmh, 0, 200),
      seconds_stopped: num(s.seconds_stopped, 0, 3600),
      being_tailgated: s.being_tailgated === true,
      being_honked_at: s.being_honked_at === true,
      ambulance_behind_with_siren: s.ambulance_behind_with_siren === true,
      coming_up: text(s.coming_up, 60),
      raining: s.raining === true,
      night: s.night === true,
    },
  };
  // The one free-text field: what the rider typed to their own car.
  const says = text(d.passenger_says, 140);
  if (says) car.driver.passenger_says = says;
  const g = c.gap as Record<string, unknown> | undefined;
  if (ask.includes('gap') && g) car.gap = { seconds_until_next_priority_vehicle: num(g.seconds_until_next_priority_vehicle, 0, 60), seconds_waiting: num(g.seconds_waiting, 0, 600), vehicles_waiting_behind: num(g.vehicles_waiting_behind, 0, 50) };
  const a = c.amber as Record<string, unknown> | undefined;
  if (ask.includes('amber') && a) car.amber = { metres_to_stop_line: num(a.metres_to_stop_line, 0, 200), could_stop_comfortably: a.could_stop_comfortably === true };
  const t = c.turn as Record<string, Record<string, unknown>> | undefined;
  if (ask.includes('turn') && t) {
    car.turn = {};
    for (const k of TURNS) if (t[k]) car.turn[k] = { extra_seconds: num(t[k].extra_seconds, 0, 900), vehicles_queued: num(t[k].vehicles_queued, 0, 99), traffic_moving: t[k].traffic_moving === true };
  }
  const k = c.courtesy as Record<string, unknown> | undefined;
  if (ask.includes('courtesy') && k) car.courtesy = { other_driver_has_waited_seconds: num(k.other_driver_has_waited_seconds, 0, 600) };
  const h = c.horn as Record<string, unknown> | undefined;
  if (ask.includes('horn') && h) car.horn = { because: text(h.because, 80) };
  return car;
}

// --- Questions ------------------------------------------------------------------------

function questionsFor(car: CarQuery, i: number): Questions {
  const me = `\`cars[${i}]\``;
  const q: Questions = {};
  for (const kind of car.ask) {
    if (kind === 'style')
      q[`style_${i}`] = {
        type: 'choice',
        instructions: {
          question: `In what manner does the driver of ${me} drive for the next few seconds?`,
          weigh: [`${me}.driver`, `${me}.situation`],
          focus: `The car stops for red lights, junctions and queues by itself; standing still is not a manner. This is about temperament meeting the moment: decide as this particular driver would. If ${me}.driver.passenger_says is present, the passenger's wishes matter a great deal.`,
        },
        criteria: STYLE_CRITERIA,
      };
    if (kind === 'gap' && car.gap)
      q[`gap_${i}`] = {
        type: 'choice',
        instructions: {
          question: `${me} is stopped at a junction and must give way. The next vehicle with priority arrives in ${me}.gap.seconds_until_next_priority_vehicle seconds. What does this driver do right now?`,
          focus: 'Pulling out safely takes about three seconds. Patient, careful drivers want more; impatient ones accept less, more so the longer they have waited.',
        },
        criteria: GAP_CRITERIA,
      };
    if (kind === 'amber' && car.amber)
      q[`amber_${i}`] = {
        type: 'noul',
        instructions: `The traffic light ahead of ${me} has just turned amber, ${me}.amber.metres_to_stop_line metres away. Does this driver brake and stop?`,
        criteria: { true: 'Brakes and stops at the line', false: 'Keeps going and crosses on amber' },
      };
    if (kind === 'turn' && car.turn)
      q[`turn_${i}`] = {
        type: 'choice',
        instructions: {
          question: `${me} is coming to a junction. Which way does this driver go?`,
          focus: `${me}.turn lists the ways open: for each, how many seconds longer it makes the trip, how many vehicles are queued on it and whether they are moving. follow_navigation is the planned route. Drivers keep to the plan unless it is jammed and they are the impatient kind, or unless ${me}.driver.passenger_says asks for a particular direction.`,
        },
        criteria: Object.fromEntries((Object.keys(car.turn) as Turn[]).map((k) => [k, k === 'follow_navigation' ? 'Stay on the planned route' : k === 'straight' ? 'Leave the planned route and go straight on' : `Leave the planned route and turn ${k}`])),
      };
    if (kind === 'horn')
      q[`horn_${i}`] = { type: 'noul', instructions: `Does the driver of ${me} sound the horn right now? Reason they might: ${me}.horn.because.`, criteria: { true: 'Sounds the horn', false: 'Stays quiet' } };
    if (kind === 'courtesy')
      q[`courtesy_${i}`] = {
        type: 'noul',
        instructions: `Another driver has been waiting ${me}.courtesy.other_driver_has_waited_seconds seconds to pull out in front of ${me}, who has priority. Does the driver of ${me} slow down and let them in?`,
        criteria: { true: 'Eases off and waves them in', false: 'Holds their priority and drives past' },
      };
  }
  return q;
}

// --- Call -----------------------------------------------------------------------------

let client: TypeSafeClient | null = null;
let clientKey: string | undefined;

function getClient(config: JevConfig): TypeSafeClient {
  if (!config.apiKey) throw new JevError('TYPESAFE_API_KEY is not set in .env', 503);
  if (!client || clientKey !== config.apiKey) {
    client = new TypeSafeClient({ apiKey: config.apiKey, defaultModel: config.model, timeout: 3000, retry: { maxRetries: 1, backoffInitialMs: 250, backoffMaxMs: 500 }, logLevel: 'error' });
    clientKey = config.apiKey;
  }
  return client;
}

type Raw = { type?: string; noul?: number; choice?: string; probabilities?: Record<string, number> };
const unit = (n: number | undefined) => (typeof n === 'number' && Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : 0);

function choice<K extends string>(a: Raw | undefined, options: readonly K[]) {
  const picked = options.find((o) => o === a?.choice);
  if (!a || !picked) return undefined;
  return { choice: picked, probabilities: Object.fromEntries(options.map((o) => [o, unit(a.probabilities?.[o])])) as Record<K, number> };
}

export async function drive(config: JevConfig, body: Record<string, unknown>): Promise<DriveReply> {
  const cars = (Array.isArray(body.cars) ? body.cars : []).slice(0, MAX_CARS_PER_REQUEST).map(cleanCar).filter((c): c is CarQuery => c !== null);
  if (!cars.length) throw new JevError('No cars to decide for', 400);
  const questions: Questions = {};
  cars.forEach((car, i) => Object.assign(questions, questionsFor(car, i)));
  if (!Object.keys(questions).length) throw new JevError('Nothing to ask', 400);
  // Jev sees the drivers and their situations; the bookkeeping (what to ask) stays out of the state.
  const state = { cars: cars.map(({ ask: _ask, ...rest }) => rest) };

  const started = performance.now();
  let result;
  try {
    result = await getClient(config).systemOne({ state: state as unknown as { [key: string]: string }, questions });
  } catch (error) {
    if (error instanceof APIError && error.status === 402) throw new JevError('The TypeSafe account has no credits left', 402);
    if (error instanceof APIError) throw new JevError(`TypeSafe returned HTTP ${error.status}`, error.status === 429 ? 429 : 502);
    throw new JevError(error instanceof Error ? error.name : 'TypeSafe request failed', 502);
  }
  const raw = result.answers as unknown as Record<string, Raw>;
  const decisions: CarDecision[] = cars.map((car, i) => {
    const d: CarDecision = { id: car.id };
    d.style = choice(raw[`style_${i}`], STYLES);
    d.gap = choice(raw[`gap_${i}`], GAP_MOVES);
    if (raw[`amber_${i}`]) d.amber_stop = unit(raw[`amber_${i}`].noul);
    if (car.turn) d.turn = choice(raw[`turn_${i}`], Object.keys(car.turn) as Turn[]);
    if (raw[`horn_${i}`]) d.horn = unit(raw[`horn_${i}`].noul);
    if (raw[`courtesy_${i}`]) d.courtesy = unit(raw[`courtesy_${i}`].noul);
    return d;
  });
  return { decisions, model: result.model, latencyMs: Math.round(performance.now() - started), inputTokens: result.usage.input_tokens, questions: Object.keys(questions).length };
}

// --- Where to, and after whom ------------------------------------------------------------------
// The rider says "go to the sea" or "follow the red car". Jev cannot know where the sea is or which car
// is red; the simulation can. So the code lists what exists and Jev picks what the rider meant.

export async function intent(config: JevConfig, body: Record<string, unknown>): Promise<IntentReply> {
  const says = text(body.passenger_says, 140);
  if (!says) throw new JevError('Nothing was said', 400);
  const places = (Array.isArray(body.places) ? body.places : []).slice(0, MAX_PLACES).map((p) => text(p, 70)).filter(Boolean);
  const vehicles = (Array.isArray(body.vehicles) ? body.vehicles : []).slice(0, MAX_VEHICLES).map((v) => text(v, 90)).filter(Boolean);
  const questions: Questions = {
    place: {
      type: 'choice',
      instructions: {
        question: 'Which place does `passenger_says` ask the taxi driver to go to?',
        focus: 'Pick the listed place the passenger means, allowing for other languages, nicknames and spelling mistakes. Words about speed, comfort, turning left or right, stopping, or following another vehicle name no place.',
      },
      criteria: { none: 'The passenger names no place to go', ...Object.fromEntries(places.map((label, i) => [`p${i}`, label])) },
    },
    vehicle: {
      type: 'choice',
      instructions: {
        question: 'Which vehicle does `passenger_says` ask the taxi driver to follow, chase or stay behind?',
        focus: 'Match colour and kind of vehicle, allowing for spelling mistakes ("red card" means red car). If several fit, prefer the nearest one ahead.',
      },
      criteria: {
        nobody: 'The passenger does not ask to follow any vehicle',
        unmatched: 'The passenger asks to follow a vehicle, but none of the vehicles listed fits the description (wrong colour, wrong kind)',
        ...Object.fromEntries(vehicles.map((label, i) => [`v${i}`, label])),
      },
    },
  };
  const started = performance.now();
  let result;
  try {
    result = await getClient(config).systemOne({ state: { passenger_says: says }, questions });
  } catch (error) {
    if (error instanceof APIError && error.status === 402) throw new JevError('The TypeSafe account has no credits left', 402);
    if (error instanceof APIError) throw new JevError(`TypeSafe returned HTTP ${error.status}`, error.status === 429 ? 429 : 502);
    throw new JevError(error instanceof Error ? error.name : 'TypeSafe request failed', 502);
  }
  const raw = result.answers as unknown as Record<string, Raw>;
  const pick = (answer: Raw | undefined, prefix: string, count: number) => {
    const chosen = answer?.choice ?? '';
    const index = chosen.startsWith(prefix) ? Number(chosen.slice(prefix.length)) : -1;
    return { index: Number.isInteger(index) && index >= 0 && index < count ? index : -1, p: unit(answer?.probabilities?.[chosen]) };
  };
  const place = pick(raw.place, 'p', places.length);
  const vehicle = pick(raw.vehicle, 'v', vehicles.length);
  return { place: place.index, placeP: place.p, vehicle: vehicle.index, vehicleP: vehicle.p, unmatched: raw.vehicle?.choice === 'unmatched', latencyMs: Math.round(performance.now() - started), inputTokens: result.usage.input_tokens };
}
