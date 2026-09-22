// Does the mood question behave in the dull, common situations?  npx tsx scripts/probe-style.ts
import { readFileSync } from 'node:fs';
import { drive } from '../server/jev.ts';
import type { CarQuery, Situation } from '../shared/drive.ts';
const env = Object.fromEntries(readFileSync('.env', 'utf8').split('\n').filter((l) => l.includes('=') && !l.startsWith('#')).map((l) => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim()]));
const config = { apiKey: env.TYPESAFE_API_KEY, model: env.TYPESAFE_MODEL || 'jev-latest' };
const base: Situation = { speed_kmh: 0, speed_limit_kmh: 50, road: 'Avenue Kléber', metres_to_vehicle_ahead: 3, vehicle_ahead_speed_kmh: 0, seconds_stopped: 14, being_tailgated: false, being_honked_at: false, ambulance_behind_with_siren: false, coming_up: 'traffic light, red, in 9 m', raining: false, night: false };
const people = [
  ['grey saloon', 'ordinary commuter, neither slow nor fast', 'driving to work'],
  ['city bus', 'steady professional with a timetable and standing passengers', 'line 7 towards the station'],
  ['removal truck', 'tired, heavy vehicle, needs room to turn', 'third move of the day'],
  ['black SUV', 'aggressive, hates waiting, thinks the road is his', 'late for a meeting'],
  ['old Renault 4', 'retired teacher, careful, never in a hurry', 'going to the market'],
];
const scenes: Array<[string, Partial<Situation>]> = [
  ['stopped at red, 14 s', {}],
  ['queue, honked at', { being_honked_at: true, coming_up: 'junction in 30 m, must give way, going left', seconds_stopped: 22 }],
  ['crossing junction 12 km/h', { speed_kmh: 12, seconds_stopped: 0, coming_up: 'crossing a junction', metres_to_vehicle_ahead: null, vehicle_ahead_speed_kmh: null }],
  ['open road 38 km/h', { speed_kmh: 38, seconds_stopped: 0, coming_up: 'open road', metres_to_vehicle_ahead: 25, vehicle_ahead_speed_kmh: 40 }],
  ['ambulance behind', { speed_kmh: 30, seconds_stopped: 0, coming_up: 'open road', ambulance_behind_with_siren: true }],
];
const pct = (p: Record<string, number>) => Object.entries(p).filter(([, v]) => v > 0.06).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${Math.round(v * 100)}`).join(', ');
for (const [label, patch] of scenes) {
  const cars: CarQuery[] = people.map(([vehicle, temperament, trip], i) => ({ id: `c${i + 1}`, driver: { vehicle, temperament, trip }, situation: { ...base, ...patch }, ask: ['style'] }));
  const reply = await drive(config, { cars });
  console.log(`\n${label}  (${reply.latencyMs} ms)`);
  reply.decisions.forEach((d, i) => console.log(`  ${people[i][0].padEnd(14)} ${pct(d.style!.probabilities)}`));
}
