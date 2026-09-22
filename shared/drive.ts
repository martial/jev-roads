// The contract between the simulation (browser) and the Jev endpoint (Node). The browser sends
// facts about drivers and their situations; the server owns every question.

export const STYLES = ['cruise', 'hurry', 'tailgate', 'ease_off', 'crawl', 'pull_over'] as const;
export type Style = (typeof STYLES)[number];

export const GAP_MOVES = ['go', 'wait', 'creep'] as const;
export type GapMove = (typeof GAP_MOVES)[number];

export const TURNS = ['follow_navigation', 'left', 'straight', 'right'] as const;
export type Turn = (typeof TURNS)[number];

export type AskKind = 'style' | 'gap' | 'amber' | 'turn' | 'horn' | 'courtesy';

/** Who is driving. Generated once per car; `passenger_says` is whatever the rider typed to their own car. */
export interface DriverCard {
  vehicle: string;
  temperament: string;
  trip: string;
  passenger_says?: string;
}

export interface Situation {
  speed_kmh: number;
  speed_limit_kmh: number;
  road: string;
  metres_to_vehicle_ahead: number | null;
  vehicle_ahead_speed_kmh: number | null;
  seconds_stopped: number;
  being_tailgated: boolean;
  being_honked_at: boolean;
  ambulance_behind_with_siren: boolean;
  /** "traffic light, red, in 40 m", "give way in 12 m", "roundabout in 25 m", "open road". */
  coming_up: string;
  raining: boolean;
  night: boolean;
}

export interface TurnOption {
  extra_seconds: number;
  vehicles_queued: number;
  traffic_moving: boolean;
}

export interface CarQuery {
  id: string;
  driver: DriverCard;
  situation: Situation;
  ask: AskKind[];
  /** Waiting to enter traffic that has priority. */
  gap?: { seconds_until_next_priority_vehicle: number; seconds_waiting: number; vehicles_waiting_behind: number };
  amber?: { metres_to_stop_line: number; could_stop_comfortably: boolean };
  turn?: Partial<Record<Turn, TurnOption>>;
  courtesy?: { other_driver_has_waited_seconds: number };
  horn?: { because: string };
}

export interface Choice<K extends string> {
  choice: K;
  probabilities: Record<K, number>;
}

export interface CarDecision {
  id: string;
  style?: Choice<Style>;
  gap?: Choice<GapMove>;
  /** Probability that the driver stops for the amber light. */
  amber_stop?: number;
  turn?: Choice<Turn>;
  horn?: number;
  courtesy?: number;
}

export interface DriveReply {
  decisions: CarDecision[];
  model: string;
  latencyMs: number;
  inputTokens: number;
  questions: number;
}

export const MAX_CARS_PER_REQUEST = 10;

export interface Health {
  configured: boolean;
  model: string;
}

/** What the rider's words ask for beyond a manner of driving: somewhere to go, or someone to follow. */
export interface IntentQuery {
  passenger_says: string;
  /** Places that exist on this map, as the code found them: street names, the sea, a park, a landmark. */
  places: string[];
  /** Vehicles around the taxi right now: "red small hatchback, 30 m ahead". */
  vehicles: string[];
}

export interface IntentReply {
  /** Index into `places`, or -1 when the rider names no destination. */
  place: number;
  placeP: number;
  /** Index into `vehicles`, or -1 when the rider does not ask to follow anyone. */
  vehicle: number;
  vehicleP: number;
  /** The rider wants to follow something, but nothing in sight fits the description. */
  unmatched: boolean;
  latencyMs: number;
  inputTokens: number;
}

export const MAX_PLACES = 180;
export const MAX_VEHICLES = 14;
