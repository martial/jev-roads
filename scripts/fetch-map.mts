// Fetch a whole place ahead of time (streets, then nine scenery tiles, two at a time):
//   npx tsx scripts/fetch-map.ts <lat> <lon>
import { TILES, loadScenery, loadStreets } from '../server/maps.ts';
const [lat, lon] = process.argv.slice(2).map(Number);
const t = Date.now();
const streets = await loadStreets(lat, lon);
console.log(`streets: ${streets.osm.elements.length} elements${streets.cached ? ' (on disk)' : ''}`);
const results = await Promise.allSettled(Array.from({ length: TILES * TILES }, (_, tile) => loadScenery(lat, lon, tile)));
results.forEach((r, tile) => console.log(`tile ${tile}: ${r.status === 'fulfilled' ? `${r.value.osm.elements.length} elements${r.value.cached ? ' (on disk)' : ''}` : `FAILED ${(r.reason as Error).message}`}`));
console.log(`${Math.round((Date.now() - t) / 1000)} s`);
