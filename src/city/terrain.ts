// The relief of the square kilometre. Raw elevation arrives as a coarse grid (one height every eight
// metres, from satellite radar: stepped and noisy). Here it becomes a smooth surface, and then the streets
// are cut into it the way road builders do: level across their width, gently graded along their length,
// the banks blended back into the hillside. Everything in the realistic look stands on `at(x, z)`.

import { SIZE, type CityMap, type Pt } from './osm';

/** Cells along each side of the fine grid (so GRID + 1 samples): one every 2.67 m. */
export const GRID = 384;
const CELL = SIZE / GRID;
const SEA = 6;

export interface RawTerrain {
  n: number;
  heights: number[];
}

export class Heightfield {
  /** World heights (metres above the lowest point of the map), (GRID + 1) squared, row by row from the north. */
  readonly y = new Float32Array((GRID + 1) * (GRID + 1));
  /** What the lowest point is, in metres above sea level. */
  base = 0;
  /** World height of the sea's surface. */
  seaY = 0;
  relief = 0;

  constructor(raw: RawTerrain | null) {
    if (!raw) return;
    const n = raw.n;
    const src = raw.heights;
    const get = (i: number, j: number) => src[Math.min(n - 1, Math.max(0, i)) * n + Math.min(n - 1, Math.max(0, j))];
    // Catmull-Rom between the coarse samples: smooth slopes instead of facets.
    const cubic = (a: number, b: number, c: number, d: number, t: number) => b + 0.5 * t * (c - a + t * (2 * a - 5 * b + 4 * c - d + t * (3 * (b - c) + d - a)));
    for (let i = 0; i <= GRID; i++)
      for (let j = 0; j <= GRID; j++) {
        const [fi, fj] = [(i / GRID) * (n - 1), (j / GRID) * (n - 1)];
        const [i0, j0] = [Math.floor(fi), Math.floor(fj)];
        const rows = [-1, 0, 1, 2].map((d) => cubic(get(i0 + d, j0 - 1), get(i0 + d, j0), get(i0 + d, j0 + 1), get(i0 + d, j0 + 2), fj - j0));
        this.y[i * (GRID + 1) + j] = cubic(rows[0], rows[1], rows[2], rows[3], fi - i0);
      }
    // Radar heights come in whole metres, which would show as terraces: blur them away.
    this.blur(3);
    this.blur(3);
    let lo = Infinity;
    let hi = -Infinity;
    for (const h of this.y) {
      lo = Math.min(lo, h);
      hi = Math.max(hi, h);
    }
    this.base = Math.min(lo, 0.5);
    this.relief = hi - lo;
    for (let k = 0; k < this.y.length; k++) this.y[k] -= this.base;
    this.seaY = -this.base;
  }

  private blur(radius: number) {
    const w = GRID + 1;
    const tmp = new Float32Array(this.y.length);
    for (const horizontal of [true, false]) {
      for (let i = 0; i < w; i++)
        for (let j = 0; j < w; j++) {
          let sum = 0;
          let count = 0;
          for (let d = -radius; d <= radius; d++) {
            const [a, b] = horizontal ? [i, j + d] : [i + d, j];
            if (a < 0 || b < 0 || a >= w || b >= w) continue;
            sum += this.y[a * w + b];
            count++;
          }
          tmp[i * w + j] = sum / count;
        }
      this.y.set(tmp);
    }
  }

  /** Height of the ground at a point of the map, in world metres. */
  at(x: number, z: number): number {
    const fx = Math.min(GRID - 1e-4, Math.max(0, x / CELL));
    const fz = Math.min(GRID - 1e-4, Math.max(0, z / CELL));
    const [j, i] = [Math.floor(fx), Math.floor(fz)];
    const [u, v] = [fx - j, fz - i];
    const w = GRID + 1;
    const [a, b, c, d] = [this.y[i * w + j], this.y[i * w + j + 1], this.y[(i + 1) * w + j], this.y[(i + 1) * w + j + 1]];
    // The same split as the mesh's triangles, so that things stand on the surface you see, not near it.
    return u + v <= 1 ? a + (b - a) * u + (c - a) * v : d + (c - d) * (1 - u) + (b - d) * (1 - v);
  }

  /** Cut the streets into the hillside, and keep dry land above the sea. */
  grade(map: CityMap, ground: Uint8Array) {
    if (!this.relief) return;
    const w = GRID + 1;
    const sumW = new Float32Array(this.y.length);
    const sumY = new Float32Array(this.y.length);
    const most = new Float32Array(this.y.length);
    for (const road of map.roads) {
      const points = refine(road.points.filter((p) => p[0] > -60 && p[1] > -60 && p[0] < SIZE + 60 && p[1] < SIZE + 60), 2.5);
      if (points.length < 2) continue;
      // The road's own long profile: the hill's, with the bumps ironed out.
      let profile = points.map((p) => this.at(p[0], p[1]));
      for (let pass = 0; pass < 3; pass++)
        profile = profile.map((_, i) => {
          let sum = 0;
          let count = 0;
          for (let k = Math.max(0, i - 6); k <= Math.min(profile.length - 1, i + 6); k++) (sum += profile[k]), count++;
          return sum / count;
        });
      const core = road.width / 2 + 3.5;
      const reach = core + 9;
      points.forEach((p, n) => {
        const [i0, i1] = [Math.max(0, Math.floor((p[1] - reach) / CELL)), Math.min(GRID, Math.ceil((p[1] + reach) / CELL))];
        const [j0, j1] = [Math.max(0, Math.floor((p[0] - reach) / CELL)), Math.min(GRID, Math.ceil((p[0] + reach) / CELL))];
        for (let i = i0; i <= i1; i++)
          for (let j = j0; j <= j1; j++) {
            const d = Math.hypot(j * CELL - p[0], i * CELL - p[1]);
            if (d > reach) continue;
            const t = d <= core ? 1 : 1 - (d - core) / (reach - core);
            const weight = t * t * (3 - 2 * t);
            const k = i * w + j;
            // Nearer samples count for far more, so that a cell takes the height of its own stretch of road.
            const pull = weight / (1 + d * d * 0.2);
            sumW[k] += pull;
            sumY[k] += pull * profile[n];
            most[k] = Math.max(most[k], weight);
          }
      });
    }
    for (let k = 0; k < this.y.length; k++) if (sumW[k] > 0) this.y[k] += (sumY[k] / sumW[k] - this.y[k]) * most[k];
    // Dry land stays dry: nothing that is not sea may lie below the waterline.
    for (let i = 0; i <= GRID; i++)
      for (let j = 0; j <= GRID; j++) {
        const kind = ground[Math.min(SIZE - 1, Math.round(i * CELL)) * SIZE + Math.min(SIZE - 1, Math.round(j * CELL))];
        const k = i * w + j;
        if (kind !== SEA) this.y[k] = Math.max(this.y[k], this.seaY + 0.5);
      }
  }
}

/** Cut a polyline into pieces no longer than `step`. */
export function refine(points: Pt[], step: number): Pt[] {
  if (!points.length) return [];
  const out: Pt[] = [points[0]];
  for (let i = 1; i < points.length; i++) {
    const [a, b] = [points[i - 1], points[i]];
    const n = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / step));
    for (let k = 1; k <= n; k++) out.push([a[0] + ((b[0] - a[0]) * k) / n, a[1] + ((b[1] - a[1]) * k) / n]);
  }
  return out;
}
