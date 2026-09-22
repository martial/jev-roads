// Who is on the road. Every car gets a person: a vehicle, a temperament and a reason to be out.
// That card is all Jev knows about them; how they then drive is Jev's call, moment by moment.

import type { DriverCard, Style } from '../../shared/drive';

/** The modelled bodies in `public/models`, made by `scripts/blender/make_cars.py`. */
export type Model = 'hatch' | 'saloon' | 'estate' | 'suv' | 'coupe' | 'pickup' | 'van' | 'bus' | 'truck';

export interface Body {
  kind: 'car' | 'van' | 'bus' | 'truck' | 'taxi' | 'ambulance';
  /** Which modelled body the smooth looks draw, stretched to this length, width and height. */
  model: Model;
  length: number;
  width: number;
  height: number;
  colors: string[];
}

interface Person {
  vehicle: string;
  temperament: string;
  trips: string[];
  body: Body;
  /** How they drive with Jev switched off: one fixed habit, whatever happens around them. */
  habit: Style;
  /** How often this person turns up, relative to the others. */
  weight: number;
}

const CAR = (model: Model, colors: string[], length = 4.1, height = 1.45): Body => ({ kind: 'car', model, length, width: 1.8, height, colors });
const VAN = (colors: string[]): Body => ({ kind: 'van', model: 'van', length: 5.2, width: 2, height: 2.3, colors });

const PEOPLE: Person[] = [
  { vehicle: 'old Renault 4', temperament: 'retired teacher, careful, never in a hurry', trips: ['going to the market', 'visiting her sister'], body: CAR('hatch', ['#d9c9a0', '#9db8a0'], 3.7), habit: 'ease_off', weight: 2 },
  { vehicle: 'white delivery van', temperament: 'courier paid per parcel, impatient', trips: ['14 parcels left and 40 minutes behind', 'last drop of a long shift'], body: VAN(['#eeeeea']), habit: 'hurry', weight: 3 },
  { vehicle: 'black SUV', temperament: 'aggressive, hates waiting, thinks the road is his', trips: ['late for a meeting', 'late to pick up a client'], body: CAR('suv', ['#1d1f24'], 4.7, 1.75), habit: 'tailgate', weight: 2 },
  { vehicle: 'small hatchback', temperament: 'kind, easy-going', trips: ['heading home', 'going to see a friend'], body: CAR('hatch', ['#c9473c', '#3f78b5', '#e0b33c'], 3.9), habit: 'cruise', weight: 4 },
  { vehicle: 'driving-school car', temperament: 'learner on a third lesson, nervous, instructor beside them', trips: ['practising junctions'], body: CAR('hatch', ['#f2f2ee'], 3.9), habit: 'ease_off', weight: 1 },
  { vehicle: 'rental car', temperament: 'tourist, lost, keeps looking at the buildings', trips: ['searching for the hotel', 'trying to find the car park'], body: CAR('saloon', ['#9aa3ad', '#7d8fa8']), habit: 'crawl', weight: 2 },
  { vehicle: 'city bus', temperament: 'steady professional with a timetable and standing passengers', trips: ['line 7 towards the station', 'line 4 towards the university'], body: { kind: 'bus', model: 'bus', length: 10.5, width: 2.4, height: 3, colors: ['#e8e4d8'] }, habit: 'cruise', weight: 1.5 },
  { vehicle: 'red convertible', temperament: 'show-off, loves the sound of the engine', trips: ['cruising, wants to be seen'], body: CAR('coupe', ['#c4262e'], 4.2, 1.25), habit: 'hurry', weight: 1 },
  { vehicle: 'family estate car', temperament: 'calm parent, two children in the back', trips: ['school run', 'going to football practice'], body: CAR('estate', ['#3e5c76', '#6b705c'], 4.6, 1.5), habit: 'cruise', weight: 3 },
  { vehicle: 'florist van', temperament: 'cheerful, careful with the load', trips: ['delivering a wedding arrangement, fragile'], body: VAN(['#8fbf9a']), habit: 'ease_off', weight: 1 },
  { vehicle: "plumber's van", temperament: 'practical, short-tempered today', trips: ['emergency call, a flooded kitchen'], body: VAN(['#2f5d8a']), habit: 'hurry', weight: 1.5 },
  { vehicle: 'electric city car', temperament: 'eco-minded, gentle on the pedal', trips: ['commuting to the office', 'going to yoga'], body: CAR('hatch', ['#a8d5ba', '#f0f0f0'], 3.6, 1.55), habit: 'cruise', weight: 3 },
  { vehicle: 'old pickup', temperament: 'farmer, unhurried, waves at everyone', trips: ['bringing melons to the market'], body: CAR('pickup', ['#7a8450'], 5, 1.7), habit: 'ease_off', weight: 1 },
  { vehicle: 'sports coupe', temperament: 'young, overconfident, easily provoked', trips: ['meeting friends, already late'], body: CAR('coupe', ['#f2a900', '#2a9d8f'], 4.3, 1.3), habit: 'tailgate', weight: 1.5 },
  { vehicle: "doctor's saloon", temperament: 'focused, brisk but safe', trips: ['house call to an elderly patient'], body: CAR('saloon', ['#44546a'], 4.6), habit: 'hurry', weight: 1 },
  { vehicle: 'hatchback with a cake on the back seat', temperament: 'anxious about every bump', trips: ['delivering a three-tier birthday cake'], body: CAR('hatch', ['#e9a5b8'], 3.9), habit: 'ease_off', weight: 1 },
  { vehicle: 'removal truck', temperament: 'tired, heavy vehicle, needs room to turn', trips: ['third move of the day'], body: { kind: 'truck', model: 'truck', length: 7.5, width: 2.4, height: 3.2, colors: ['#d98e3a'] }, habit: 'ease_off', weight: 1 },
  { vehicle: 'dented city car', temperament: 'student who slept three hours, slow to react', trips: ['late for an exam'], body: CAR('hatch', ['#8a6fb0'], 3.6), habit: 'hurry', weight: 1.5 },
  { vehicle: 'grey saloon', temperament: 'ordinary commuter, neither slow nor fast', trips: ['driving to work', 'driving home from work'], body: CAR('saloon', ['#8d9197', '#5f6670', '#b9bec6'], 4.5), habit: 'cruise', weight: 5 },
];

const TAXI: Person = { vehicle: 'taxi', temperament: 'professional, smooth, knows every street', trips: ['carrying a passenger across town'], body: { kind: 'taxi', model: 'saloon', length: 4.6, width: 1.8, height: 1.5, colors: ['#f4f1e6'] }, habit: 'cruise', weight: 0 };
const AMBULANCE: Person = { vehicle: 'ambulance with siren on', temperament: 'trained emergency driver, fast and precise', trips: ['emergency call, siren on'], body: { kind: 'ambulance', model: 'van', length: 5.6, width: 2.1, height: 2.6, colors: ['#f6f6f2'] }, habit: 'hurry', weight: 0 };

export interface Driver {
  card: DriverCard;
  body: Body;
  color: string;
  habit: Style;
}

function make(person: Person, rng: () => number): Driver {
  return {
    card: { vehicle: person.vehicle, temperament: person.temperament, trip: person.trips[Math.floor(rng() * person.trips.length)] },
    body: person.body,
    color: person.body.colors[Math.floor(rng() * person.body.colors.length)],
    habit: person.habit,
  };
}

const TOTAL = PEOPLE.reduce((s, p) => s + p.weight, 0);

export function randomDriver(rng: () => number): Driver {
  let pick = rng() * TOTAL;
  for (const person of PEOPLE) if ((pick -= person.weight) <= 0) return make(person, rng);
  return make(PEOPLE[PEOPLE.length - 1], rng);
}

/** The car you ride in: a taxi, so that telling the driver what you want makes sense. */
export const taxiDriver = (rng: () => number) => make(TAXI, rng);
export const ambulanceDriver = (rng: () => number) => make(AMBULANCE, rng);

/** What each way of driving means to the physics. Jev picks the word; these numbers are the word. */
export interface Manner {
  /** Desired speed as a share of the limit. */
  speed: number;
  /** Absolute cap in m/s, if any. */
  cap: number;
  /** Time gap kept to the vehicle ahead, seconds. */
  headway: number;
  /** Standstill gap, metres. */
  standstill: number;
  accel: number;
  brake: number;
}

export const MANNERS: Record<Style, Manner> = {
  cruise: { speed: 1, cap: 99, headway: 1.4, standstill: 2.2, accel: 1.7, brake: 2.4 },
  hurry: { speed: 1.18, cap: 99, headway: 0.95, standstill: 1.8, accel: 2.5, brake: 3 },
  tailgate: { speed: 1.3, cap: 99, headway: 0.5, standstill: 1.2, accel: 2.8, brake: 3.4 },
  ease_off: { speed: 0.82, cap: 99, headway: 2.2, standstill: 3, accel: 1.2, brake: 2 },
  crawl: { speed: 0.4, cap: 4.2, headway: 2.4, standstill: 3, accel: 0.9, brake: 1.8 },
  pull_over: { speed: 0.35, cap: 0, headway: 2, standstill: 2.5, accel: 1.2, brake: 2.6 },
};

export const STYLE_WORDS: Record<Style, string> = {
  cruise: 'cruising',
  hurry: 'hurrying',
  tailgate: 'tailgating',
  ease_off: 'easing off',
  crawl: 'crawling',
  pull_over: 'pulling over',
};
