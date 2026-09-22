import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { gunzipSync } from 'node:zlib';

/** The London launch city ships with the app; later visits can still use fresher local cache data. */
const loaded = new Map<string, unknown>();
function file(lat: number, lon: number, part: string): string | null {
  if (lat.toFixed(4) !== '51.5136' || lon.toFixed(4) !== '-0.1365' || !/^(streets|terrain|scenery-[0-8])$/.test(part)) return null;
  const path = join('data', 'london', `${part}.json.gz`);
  return existsSync(path) ? path : null;
}
export const hasBundledMap = (lat: number, lon: number, part: string) => file(lat, lon, part) !== null;
export function bundledMap<T>(lat: number, lon: number, part: string): T | null {
  const path = file(lat, lon, part);
  if (!path) return null;
  if (!loaded.has(path)) loaded.set(path, JSON.parse(gunzipSync(readFileSync(path)).toString('utf8')));
  return loaded.get(path) as T;
}
