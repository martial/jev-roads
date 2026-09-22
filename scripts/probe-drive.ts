// Live probe of the driving questions: npx tsx scripts/probe-drive.ts
import { readFileSync } from 'node:fs';
import { drive } from '../server/jev.ts';
import type { CarQuery, Situation } from '../shared/drive.ts';

const env = Object.fromEntries(readFileSync('.env', 'utf8').split('\n').filter((l) => l.includes('=') && !l.startsWith('#')).map((l) => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim()]));
const config = { apiKey: env.TYPESAFE_API_KEY, model: env.TYPESAFE_MODEL || 'jev' };
const base: Situation = { speed_kmh: 42, speed_limit_kmh: 50, road: 'Avenue des Belges', metres_to_vehicle_ahead: 18, vehicle_ahead_speed_kmh: 38, seconds_stopped: 0, being_tailgated: false, being_honked_at: false, ambulance_behind_with_siren: false, coming_up: 'open road', raining: false, night: false };
const cars: CarQuery[] = [
  { id: 'c1', driver: { vehicle: 'old Renault 4', temperament: 'retired teacher, careful, never in a hurry', trip: 'going to the market' }, situation: base, ask: ['style'] },
  { id: 'c2', driver: { vehicle: 'white delivery van', temperament: 'courier paid per parcel, impatient', trip: '14 parcels left, 40 minutes behind' }, situation: { ...base, metres_to_vehicle_ahead: 9, vehicle_ahead_speed_kmh: 25 }, ask: ['style', 'horn'], horn: { because: 'the car ahead is doing 25 in a 50 zone' } },
  { id: 'c3', driver: { vehicle: 'family estate car', temperament: 'calm parent', trip: 'school run' }, situation: { ...base, ambulance_behind_with_siren: true }, ask: ['style'] },
  { id: 'c4', driver: { vehicle: 'taxi', temperament: 'professional, smooth', trip: 'fare to the station', passenger_says: 'please hurry, my train leaves in six minutes' }, situation: base, ask: ['style', 'amber'], amber: { metres_to_stop_line: 22, could_stop_comfortably: false } },
  { id: 'c5', driver: { vehicle: 'taxi', temperament: 'professional, smooth', trip: 'fare to the station', passenger_says: 'slow down, I feel sick' }, situation: { ...base, raining: true }, ask: ['style', 'amber'], amber: { metres_to_stop_line: 22, could_stop_comfortably: false } },
  { id: 'c6', driver: { vehicle: 'scooter-like city car', temperament: 'student, relaxed', trip: 'no rush, heading to a cafe' }, situation: { ...base, speed_kmh: 0, seconds_stopped: 4, coming_up: 'give way, now' }, ask: ['gap'], gap: { seconds_until_next_priority_vehicle: 2.5, seconds_waiting: 4, vehicles_waiting_behind: 0 } },
  { id: 'c7', driver: { vehicle: 'black SUV', temperament: 'aggressive, hates waiting', trip: 'late for a meeting' }, situation: { ...base, speed_kmh: 0, seconds_stopped: 38, being_honked_at: true, coming_up: 'give way, now' }, ask: ['gap', 'courtesy'], gap: { seconds_until_next_priority_vehicle: 2.5, seconds_waiting: 38, vehicles_waiting_behind: 5 }, courtesy: { other_driver_has_waited_seconds: 30 } },
  { id: 'c8', driver: { vehicle: 'small hatchback', temperament: 'kind, easy-going', trip: 'going home' }, situation: { ...base, speed_kmh: 12, metres_to_vehicle_ahead: 6 }, ask: ['courtesy', 'turn'], courtesy: { other_driver_has_waited_seconds: 30 }, turn: { follow_navigation: { extra_seconds: 0, vehicles_queued: 9, traffic_moving: false }, right: { extra_seconds: 40, vehicles_queued: 0, traffic_moving: true } } },
];
const reply = await drive(config, { cars });
console.log(`${reply.latencyMs} ms  ${reply.inputTokens} tokens  ${reply.questions} questions  model ${reply.model}`);
const pct = (p: Record<string, number>) => Object.entries(p).filter(([, v]) => v > 0.04).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${Math.round(v * 100)}`).join(', ');
for (const d of reply.decisions) {
  const who = cars.find((c) => c.id === d.id)!;
  const parts = [];
  if (d.style) parts.push(`style[${pct(d.style.probabilities)}]`);
  if (d.gap) parts.push(`gap[${pct(d.gap.probabilities)}]`);
  if (d.amber_stop !== undefined) parts.push(`amber stop ${Math.round(d.amber_stop * 100)}%`);
  if (d.turn) parts.push(`turn[${pct(d.turn.probabilities)}]`);
  if (d.horn !== undefined) parts.push(`horn ${Math.round(d.horn * 100)}%`);
  if (d.courtesy !== undefined) parts.push(`courtesy ${Math.round(d.courtesy * 100)}%`);
  console.log(`${d.id} ${who.driver.temperament.slice(0, 34).padEnd(34)} ${parts.join('  ')}`);
}
