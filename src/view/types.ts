// What the game needs from whatever draws the city. Two looks implement it: blocks (voxels) and real.

import type { CabinItem } from '../sim/cabin';
import type { City } from '../city/build';
import type { Network } from '../city/network';
import type { CityMap } from '../city/osm';
import type { RawTerrain } from '../city/terrain';
import type { TimeOfDay, Weather } from '../engine/sky';
import type { Car, Traffic } from '../sim/cars';
import type { Gags, Talk } from '../sim/chatter';
import type { RideView } from '../sim/ride';
import type { Sex } from '../../shared/driver';
import type { CameraShot } from '../maps/preferences';

export type Mode = 'ride' | 'above';
export type Look = 'blocks' | 'real' | 'toon';

export interface PlaceData {
  map: CityMap;
  net: Network;
  city: City;
  traffic: Traffic;
  place: { lat: number; lon: number };
  /** Elevation of the square, when it could be fetched. The block look is flat and ignores it. */
  terrain: RawTerrain | null;
}

export type Hotspot = 'radio' | 'window' | 'gps' | 'driver' | CabinItem;

export interface CityView {
  mode: Mode;
  riding: Car | null;
  onPick: (car: Car) => void;
  /** A tap on the picture from the passenger seat: on the radio, the window, the screen, or on nothing in particular (''). */
  onTap: (what: Hotspot | '') => void;
  /** What the pointer is over in the cabin right now, for the cursor and a word on the screen. */
  readonly hovering?: Hotspot | '';
  /** 1 once everything handed over so far is on screen. */
  progress: number;
  /** The streets of a new place: enough to drive on. */
  setPlace(data: PlaceData): void;
  /** One more part of town: its buildings, water, parks and trees. */
  addScenery(scenery: CityMap, city: City): void;
  ride(car: Car | null): void;
  setSky(time: TimeOfDay, weather: Weather): void;
  /** Real and toon share one renderer: switching between them needs no reload. */
  setToon?(on: boolean): void;
  setCameraShot?(shot: CameraShot): void;
  /** What the dashboard screen shows, for looks that have one. */
  setDash?(lines: { speed: number; limit: number; decision: string; detail: string; goal: string }): void;
  /** The driver beside you: how wide his mouth is, his mood, what his hands do. And his car's troubles, for the dials and the meter. */
  setDriver?(talk: Talk, gags: Gags): void;
  /** The ride: the destination and the time left for the dash, his mood for the tells. */
  setRide?(ride: RideView): void;
  /** A man or a woman at the wheel. */
  setDriverSex?(sex: Sex): void;
  /** Animate the physical object and optionally turn the passenger toward it. */
  touchCabin?(item: CabinItem, focus?: boolean): void;
  /** 0 looking at the road, 1 looking straight at the driver: it moves his voice from your left ear to the middle. */
  readonly facingDriver?: number;
  resize(): void;
  frame(dt: number): void;
  readonly lookingAt: { x: number; z: number };
  readonly ear: { x: number; y: number; z: number };
  dispose(): void;
}
