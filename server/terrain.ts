import { bundledMap } from './bundledMaps.ts';
// The lie of the land. Elevation comes from the public Terrarium tiles (the old Mapzen set, hosted by
// AWS: global, free, no key): PNGs whose colours encode metres above sea level. The tiles covering the
// square are fetched once, sampled into a small grid of heights, and kept on disk with the rest of the place.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { PNG } from 'pngjs';
import { HALF } from './maps.ts';

const ZOOM = 14;
/** Samples along each side of the square, corners included: one every eight metres. */
export const TERRAIN_N = 129;
const HOST = 'https://s3.amazonaws.com/elevation-tiles-prod/terrarium';

export interface Terrain {
  n: number;
  /** Metres above sea level, row by row from the north-west corner, x (east) running fastest. */
  heights: number[];
  cached: boolean;
}

const tiles = new Map<string, Promise<PNG>>();
function tile(x: number, y: number): Promise<PNG> {
  const key = `${x}/${y}`;
  let got = tiles.get(key);
  if (!got) {
    got = (async () => {
      const res = await fetch(`${HOST}/${ZOOM}/${x}/${y}.png`, { signal: AbortSignal.timeout(20000) });
      if (!res.ok) throw new Error(`elevation tile ${key}: HTTP ${res.status}`);
      return PNG.sync.read(Buffer.from(await res.arrayBuffer()));
    })();
    tiles.set(key, got);
    got.catch(() => tiles.delete(key));
  }
  return got;
}

export async function loadTerrain(lat: number, lon: number): Promise<Terrain> {
  const dir = join(process.env.CACHE_DIR ? join(process.env.CACHE_DIR, 'maps') : 'maps', `${lat.toFixed(4)}_${lon.toFixed(4)}`);
  const file = join(dir, 'terrain.json');
  if (existsSync(file)) return { ...(JSON.parse(readFileSync(file, 'utf8')) as Omit<Terrain, 'cached'>), cached: true };
  const bundled = bundledMap<Omit<Terrain, 'cached'>>(lat, lon, 'terrain');
  if (bundled) return { ...bundled, cached: true };

  const world = 2 ** ZOOM * 256;
  const kx = 111320 * Math.cos((lat * Math.PI) / 180);
  // Web Mercator pixel of every sample.
  const at = (i: number, j: number) => {
    const sLon = lon + (-HALF + (j / (TERRAIN_N - 1)) * HALF * 2) / kx;
    const sLat = lat - (-HALF + (i / (TERRAIN_N - 1)) * HALF * 2) / 111320;
    const rad = (sLat * Math.PI) / 180;
    return { px: ((sLon + 180) / 360) * world, py: ((1 - Math.log(Math.tan(rad) + 1 / Math.cos(rad)) / Math.PI) / 2) * world };
  };
  const needed = new Set<string>();
  for (const [i, j] of [[0, 0], [0, TERRAIN_N - 1], [TERRAIN_N - 1, 0], [TERRAIN_N - 1, TERRAIN_N - 1]]) {
    const { px, py } = at(i, j);
    needed.add(`${Math.floor(px / 256)}/${Math.floor(py / 256)}`);
  }
  const xs = [...needed].map((k) => Number(k.split('/')[0]));
  const ys = [...needed].map((k) => Number(k.split('/')[1]));
  const images = new Map<string, PNG>();
  for (let tx = Math.min(...xs); tx <= Math.max(...xs) + 1; tx++) for (let ty = Math.min(...ys); ty <= Math.max(...ys) + 1; ty++) images.set(`${tx}/${ty}`, await tile(tx, ty));

  const metres = (gx: number, gy: number): number => {
    const image = images.get(`${Math.floor(gx / 256)}/${Math.floor(gy / 256)}`);
    if (!image) return 0;
    const i = ((gy % 256) * 256 + (gx % 256)) * 4;
    return image.data[i] * 256 + image.data[i + 1] + image.data[i + 2] / 256 - 32768;
  };
  const heights: number[] = [];
  for (let i = 0; i < TERRAIN_N; i++)
    for (let j = 0; j < TERRAIN_N; j++) {
      const { px, py } = at(i, j);
      const [x0, y0] = [Math.floor(px - 0.5), Math.floor(py - 0.5)];
      const [fx, fy] = [px - 0.5 - x0, py - 0.5 - y0];
      const h = metres(x0, y0) * (1 - fx) * (1 - fy) + metres(x0 + 1, y0) * fx * (1 - fy) + metres(x0, y0 + 1) * (1 - fx) * fy + metres(x0 + 1, y0 + 1) * fx * fy;
      heights.push(Math.round(h * 10) / 10);
    }
  const terrain = { n: TERRAIN_N, heights };
  mkdirSync(dir, { recursive: true });
  writeFileSync(file, JSON.stringify(terrain));
  return { ...terrain, cached: false };
}
