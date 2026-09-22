import clipping from 'polygon-clipping';
import type { Network } from './network';
import { footprintsOf, type Building, type CityMap, type Pt } from './osm';

const snap = (p: Pt[]): Pt[] => p.map(([x, z]) => [Math.round(x * 1000) / 1000, Math.round(z * 1000) / 1000]);

type Bounds = [number, number, number, number];
const bounds = (points: Pt[]): Bounds => [Math.min(...points.map(p => p[0])), Math.min(...points.map(p => p[1])), Math.max(...points.map(p => p[0])), Math.max(...points.map(p => p[1]))];
const overlaps = (a: Bounds, b: Bounds) => a[0] <= b[2] && a[2] >= b[0] && a[1] <= b[3] && a[3] >= b[1];
export const ringArea = (p: Pt[]) => Math.abs(p.reduce((a, v, i) => { const q = p[(i + 1) % p.length]; return a + v[0] * q[1] - q[0] * v[1]; }, 0)) / 2;

/** Reserve the actual roads and turning paths before either renderer builds walls.
 * OSM's estimated road widths and separately traced houses sometimes overlap, especially in old villages.
 * Keep the driving topology intact; trim only the conflicting portion of each footprint, retaining courtyards.
 */
export class RoadClearance {
  private readonly corridors: Array<{ bounds: Bounds; polygon: Pt[][] }> = [];
  private readonly prepared = new Map<number, Building>();

  constructor(map: CityMap, net: Network) {
    const reserve = (points: Pt[], half: number) => {
      for (let i = 1; i < points.length; i++) {
        const [a, b] = [points[i - 1], points[i]];
        const length = Math.hypot(b[0] - a[0], b[1] - a[1]);
        if (length < 0.01) continue;
        const dx = (b[0] - a[0]) / length, dz = (b[1] - a[1]) / length;
        // Square caps overlap at bends and leave room for the body beyond the car's centre point.
        const x0 = a[0] - dx * half, z0 = a[1] - dz * half;
        const x1 = b[0] + dx * half, z1 = b[1] + dz * half;
        const ring: Pt[] = [[x0 - dz * half, z0 + dx * half], [x1 - dz * half, z1 + dx * half], [x1 + dz * half, z1 - dx * half], [x0 + dz * half, z0 - dx * half]];
        this.corridors.push({ bounds: bounds(ring), polygon: [snap(ring)] });
      }
    };
    for (const road of map.roads) reserve(road.points, road.width / 2 + 0.6);
    for (const lane of net.lanes) reserve(lane.points, 2.2);
    for (const turn of net.connectors) reserve(turn.points, 2.8);
  }

  prepare(buildings: Building[]): Building[] {
    return buildings.map(b => {
      const previous = this.prepared.get(b.id);
      if (previous) return previous;
      // The arch renderer already leaves a real passage through city gates.
      if (b.arch) return b;
      const box = bounds(footprintsOf(b).flat(2));
      const near = this.corridors.filter(c => overlaps(box, c.bounds)).map(c => c.polygon);
      if (!near.length) return b;
      const original = footprintsOf(b).map(p => p.map(snap));
      // Millimetre precision avoids almost-coincident edges destabilising the sweep-line.
      let polygons = original;
      for (const corridor of near) polygons = clipping.difference(polygons, corridor).map(p => p.map(snap));
      polygons = polygons.filter(p => ringArea(p[0]) >= 1);
      const area = (polys: Pt[][][]) => polys.reduce((sum, p) => sum + ringArea(p[0]) - p.slice(1).reduce((s, h) => s + ringArea(h), 0), 0);
      const adjusted = area(original) - area(polygons) > 0.01 ? { ...b, polygons, roadClipped: true } : b;
      this.prepared.set(b.id, adjusted);
      return adjusted;
    });
  }
}
