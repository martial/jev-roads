// Live: does Jev understand where a passenger wants to go, or whom to follow?  npx tsx scripts/probe-intent.mts
import { readFileSync } from 'node:fs';
import { intent } from '../server/jev.ts';
const env = Object.fromEntries(readFileSync('.env', 'utf8').split('\n').filter((l) => l.includes('=') && !l.startsWith('#')).map((l) => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim()]));
const config = { apiKey: env.TYPESAFE_API_KEY, model: env.TYPESAFE_MODEL || 'jev-latest' };
const places = ['the sea: the seafront, the harbour, the port, the beach, la mer', 'the park: the gardens, the green, somewhere with trees', 'Église Saint-Michel', 'the middle of the map: the town centre, downtown', 'north: out of town to the north', 'south: out of town to the south', 'east: out of town to the east', 'west: out of town to the west', 'Avenue de la Viguerie', 'Rue de l’Arène', 'Avenue Victor Hugo', 'Quai des Baux', 'Rue Séverin Icard', 'Avenue du Revestel', 'Rue Pierre Eydin', 'Boulevard Anatole France'];
const vehicles = ['grey grey saloon, 18 m ahead', 'red small hatchback, 34 m ahead', 'white white delivery van, 22 m behind', 'cream white city bus, 60 m ahead', 'red red convertible, 95 m to the left', 'olive green old pickup, 12 m to the right'];
for (const says of ['go to the sea', 'follow the red card', 'emmène-moi au port s’il vous plaît', 'follow that bus!', 'I am late, hurry', 'take me to victor hugo avenue', 'slow down, I feel sick', 'let’s leave town towards the north', 'suis la camionnette blanche']) {
  const r = await intent(config, { passenger_says: says, places, vehicles });
  console.log(`${says.padEnd(38)} place: ${(r.place >= 0 ? places[r.place].split(':')[0] : '—').padEnd(24)} ${Math.round(r.placeP * 100)}%   follow: ${(r.vehicle >= 0 ? vehicles[r.vehicle] : '—').padEnd(36)} ${Math.round(r.vehicleP * 100)}%   ${r.latencyMs} ms`);
}
