// What the interface shows. The simulation writes here a few times a second; React reads.

import { useSyncExternalStore } from 'react';
import type { TimeOfDay, Weather } from './engine/sky';
import type { BrainStats, Verdict } from './sim/brain';
import type { Caption } from './sim/chatter';
import type { RideView } from './sim/ride';
import type { Lang, Sex } from '../shared/driver';
import type { Look, Mode } from './view/types';
import { mapProvider, worldMode, type WorldMode, type MapProvider, type CameraShot } from './maps/preferences';

export interface MyCar {
  id: number;
  vehicle: string;
  temperament: string;
  trip: string;
  color: string;
  style: string;
  confidence: number;
  speed: number;
  limit: number;
  road: string;
  comingUp: string;
  hold: string;
  says: string;
  /** "Heading for the sea", "Following the red small hatchback". */
  goal: string;
  taxi: boolean;
  /** Share of a tank left, 0..1. */
  fuel: number;
  /** What the meter shows, and what it charges per kilometre; null when this is not a taxi. */
  fare: number | null;
  perKm: number;
  /** The meter's latest idea: "SUPPLÉMENT MISTRAL +2,50 €". */
  banner: string;
}

/** The driver who talks. */
export interface DriverTalk {
  /** A Google Cloud login was found, so he has something to say. */
  ready: boolean;
  on: boolean;
  lang: Lang;
  /** The driver's first name, and where they are from: every town has its own. */
  who: string;
  from: string;
  sex: Sex;
  /** Why he is silent, when he should not be. */
  error: string;
  /** Who wrote and said the last line, and how long it took. */
  last: string;
}

export interface UIState {
  mapProvider: MapProvider;
  worldMode: WorldMode;
  cameraShot: CameraShot;
  googleStatus: 'idle' | 'loading' | 'ready' | 'error';
  googleError: string;
  mapLabels: boolean;
  place: string;
  status: 'loading' | 'ready' | 'error';
  message: string;
  progress: number;
  /** How much of the town around the streets has been built, 0..1. */
  built: number;
  mode: Mode;
  /** Blocks (voxels) or real (smooth, physically lit). Changing it reloads the page. */
  look: Look;
  jev: boolean;
  configured: boolean;
  time: TimeOfDay;
  weather: Weather;
  rush: boolean;
  /** Traffic multiplier chosen with More cars / Fewer cars. */
  density: number;
  /** Waiting for the person to say where to drive. */
  choosing: boolean;
  lastPlace: string;
  muted: boolean;
  debug: boolean;
  stats: BrainStats;
  verdicts: Verdict[];
  mine: MyCar | null;
  cars: number;
  fps: number;
  /** The title page, before anything else. */
  landing: boolean;
  talk: DriverTalk;
  /** What he is saying right now. */
  caption: Caption | null;
  /** The ride as a game: where to, how it is going, what the passenger can do. */
  ride: RideView;
  destinations: string[];
  /** The taxi's screen is up: the map. */
  gps: boolean;
  /** What the pointer is over in the cabin: the radio, the window, the screen, him. */
  hover: string;
  /** The quote has been looked at: the screen may dock before he has even said the price. */
  quoteSeen: boolean;
}

let state: UIState = {
  mapProvider: mapProvider(),
  worldMode: worldMode(),
  cameraShot: 'orbit',
  googleStatus: 'idle',
  googleError: '',
  mapLabels: true,
  place: '',
  status: 'loading',
  message: '',
  progress: 0,
  built: 1,
  mode: 'above',
  look: 'blocks',
  jev: true,
  configured: true,
  time: 'midday',
  weather: 'clear',
  rush: false,
  density: 1,
  choosing: true,
  lastPlace: '',
  muted: false,
  debug: false,
  stats: { requests: 0, questions: 0, tokens: 0, latency: 0, inFlight: 0, error: '', model: '', noCredit: false },
  verdicts: [],
  mine: null,
  cars: 0,
  fps: 0,
  landing: true,
  talk: { ready: false, on: true, lang: 'en', who: 'Gérard', from: '', sex: 'm', error: '', last: '' },
  caption: null,
  ride: { cabin: { gloveboxOpen: false, visorDown: false, dogPetted: false }, phone: { phase: 'idle', enabled: true, caller: '', relation: '', elapsed: 0 }, phase: 'idle', sympathie: 20, level: 'hostile', destination: '', eta: 0, fare: 0, estimate: 0, meterCut: false, routeLanes: [], recalc: 0, verdict: null, metres: 0, etas: [], stops: 0, stopLanes: [], direct: 0, promised: 30, elapsed: 0, score: null, radio: { on: false, station: '', his: false, song: '', stream: '' }, window: 'up', offer: null, note: '', twist: '', memory: { rides: 0, lastTip: '', mood: 20 }, tension: 0 },
  destinations: [],
  gps: false,
  hover: '',
  quoteSeen: false,
};

const listeners = new Set<() => void>();

export function set(patch: Partial<UIState>) {
  state = { ...state, ...patch };
  for (const l of listeners) l();
}

export const get = () => state;

export function useUI(): UIState {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => state,
  );
}
