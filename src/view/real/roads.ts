// Streets as real surfaces: tarmac ribbons that follow every bend, paint laid on top of them,
// raised pavements with a kerb face. All merged into three meshes, however big the town.

import * as THREE from 'three';
import type { City } from '../../city/build';
import { along, type Network, type Path } from '../../city/network';
import { SIZE, type CityMap, type Pt } from '../../city/osm';
import { refine, type Heightfield } from '../../city/terrain';
import type { Surfaces } from './textures';
import { roadSurface } from './surfaceDetail';

const ROAD = 1;

class Builder {
  positions: number[] = [];
  normals: number[] = [];
  uvs: number[] = [];
  indices: number[] = [];

  quad(a: THREE.Vector3Like, b: THREE.Vector3Like, c: THREE.Vector3Like, d: THREE.Vector3Like, n: THREE.Vector3Like, scale = 0.25) {
    const base = this.positions.length / 3;
    for (const p of [a, b, c, d]) {
      this.positions.push(p.x, p.y, p.z);
      this.normals.push(n.x, n.y, n.z);
      // World-space coordinates: overlapping ribbons show one continuous surface.
      this.uvs.push((p.x + p.y) * scale, (p.z + p.y) * scale);
    }
    this.indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }

  geometry(): THREE.BufferGeometry {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.positions, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.normals, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uvs, 2));
    g.setIndex(this.indices);
    // Real normals: a street on a slope catches the light like one.
    g.computeVertexNormals();
    return g;
  }
}

const UP = { x: 0, y: 1, z: 0 };
const v = (x: number, y: number, z: number) => ({ x, y, z });

/** A flat strip along a polyline, `left`..`right` metres from it (right positive), mitred at the bends. */
function strip(out: Builder, points: Pt[], left: number, right: number, lift: number, ground: (x: number, z: number) => number, keep?: (x: number, z: number) => boolean) {
  if (points.length < 2) return;
  const side: Array<[number, number]> = points.map((p, i) => {
    const a = points[Math.max(0, i - 1)];
    const b = points[Math.min(points.length - 1, i + 1)];
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
    let nx = -(b[1] - a[1]) / len;
    let nz = (b[0] - a[0]) / len;
    // At a bend the strip must widen a little to keep its width on both legs.
    if (i > 0 && i < points.length - 1) {
      const l1 = Math.hypot(p[0] - a[0], p[1] - a[1]) || 1;
      const cos = ((p[0] - a[0]) / l1) * ((b[0] - a[0]) / len) + ((p[1] - a[1]) / l1) * ((b[1] - a[1]) / len);
      const stretch = Math.min(1.8, 1 / Math.max(0.55, cos));
      nx *= stretch;
      nz *= stretch;
    }
    return [nx, nz];
  });
  for (let i = 0; i + 1 < points.length; i++) {
    const [p, q] = [points[i], points[i + 1]];
    const [n0, n1] = [side[i], side[i + 1]];
    if (keep && !keep((p[0] + q[0]) / 2 + ((n0[0] + n1[0]) / 2) * ((left + right) / 2), (p[1] + q[1]) / 2 + ((n0[1] + n1[1]) / 2) * ((left + right) / 2))) continue;
    const on = (x: number, z: number) => v(x, ground(x, z) + lift, z);
    out.quad(on(p[0] + n0[0] * left, p[1] + n0[1] * left), on(p[0] + n0[0] * right, p[1] + n0[1] * right), on(q[0] + n1[0] * right, q[1] + n1[1] * right), on(q[0] + n1[0] * left, q[1] + n1[1] * left), UP);
  }
}

/** Points every few metres along a path, between two distances. */
function sample(path: Path, from: number, to: number, step = 2): Pt[] {
  const points: Pt[] = [];
  const count = Math.max(1, Math.ceil((to - from) / step));
  for (let i = 0; i <= count; i++) {
    const p = along(path, from + ((to - from) * i) / count);
    points.push([p.x, p.z]);
  }
  return points;
}

/** The stretches of a polyline that satisfy `keep`, each as its own polyline. */
function runs(points: Pt[], keep: (p: Pt) => boolean): Pt[][] {
  const out: Pt[][] = [];
  let run: Pt[] = [];
  for (const p of points) {
    if (keep(p)) run.push(p);
    else {
      if (run.length > 1) out.push(run);
      run = [];
    }
  }
  if (run.length > 1) out.push(run);
  return out;
}

export class Roads {
  private readonly wetness = { value: 0 };
  readonly group = new THREE.Group();
  private readonly tarmac: THREE.MeshStandardMaterial;
  private readonly pavement: THREE.MeshStandardMaterial;

  constructor(map: CityMap, net: Network, city: City, surfaces: Surfaces, terrain: Heightfield) {
    const ground = (x: number, z: number) => terrain.at(x, z);
    // The map is a slab of country: nothing is drawn past its edge.
    const near = (p: Pt) => p[0] > 1 && p[1] > 1 && p[0] < SIZE - 1 && p[1] < SIZE - 1;
    const inside = (x: number, z: number) => x > 1 && z > 1 && x < SIZE - 1 && z < SIZE - 1;
    const kind = (x: number, z: number) => (x < 0 || z < 0 || x >= SIZE || z >= SIZE ? -1 : city.ground[Math.floor(z) * SIZE + Math.floor(x)]);

    // --- Tarmac ---------------------------------------------------------------------------------
    const tarmac = new Builder();
    for (const road of map.roads) {
      for (const points of runs(refine(road.points, 3), near)) strip(tarmac, points, -road.width / 2, road.width / 2, 0.05, ground, inside);
    }
    for (const c of net.connectors) strip(tarmac, c.points, -2.1, 2.1, 0.05, ground, inside);
    for (const j of net.junctions.values()) {
      // The mouth of a junction: a disc as wide as the widest street that meets it.
      const r = Math.min(16, Math.max(3, ...j.approaches.map((id) => net.lanes[id].road.width / 2))) + 0.5;
      // Two rings, so that the disc can follow a junction that lies on a slope.
      const on = (a: number, radius: number) => v(j.x + Math.cos(a) * radius, ground(j.x + Math.cos(a) * radius, j.z + Math.sin(a) * radius) + 0.05, j.z + Math.sin(a) * radius);
      for (let k = 0; k < 18; k++) {
        const [a, b] = [(k / 18) * Math.PI * 2, ((k + 1) / 18) * Math.PI * 2];
        tarmac.quad(on(0, 0), on(b, r / 2), on(a, r / 2), on(0, 0), UP);
        tarmac.quad(on(a, r / 2), on(b, r / 2), on(b, r), on(a, r), UP);
      }
    }
    const asphalt = surfaces.asphalt.clone();
    const asphaltNormal = surfaces.asphaltNormal.clone();
    this.tarmac = new THREE.MeshStandardMaterial({ map: asphalt, normalMap: asphaltNormal, normalScale: new THREE.Vector2(0.7, 0.7), roughness: 0.9, metalness: 0, envMapIntensity: 0.7, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 });
    roadSurface(this.tarmac, this.wetness);
    const tarmacMesh = new THREE.Mesh(tarmac.geometry(), this.tarmac);
    tarmacMesh.receiveShadow = true;

    // --- Paint ------------------------------------------------------------------------------------
    const paint = new Builder();
    const busy = [...net.junctions.values()].filter((j) => j.approaches.length >= 2 || j.connectors.length >= 3);
    const clearOf = (x: number, z: number) => !busy.some((j) => Math.hypot(j.x - x, j.z - z) < 8);
    for (const lane of net.lanes) {
      if (lane.road.rank < 2) continue;
      const innermost = lane.index === lane.count - 1;
      const centre = innermost && lane.twin !== null && lane.forward;
      if (!centre && innermost) continue;
      // To the left of the lane: the middle of the street, or the gap to the next lane over.
      const off = -(lane.count === 1 ? 1.7 : lane.spacing / 2);
      const solid = centre && lane.count > 1;
      for (let s = 0; s < lane.length; s += solid ? 12 : 9) {
        const end = Math.min(lane.length, s + (solid ? 12 : 3));
        const mid = along(lane, (s + end) / 2);
        if (!clearOf(mid.x, mid.z)) continue;
        strip(paint, sample(lane, s, end), off - 0.075, off + 0.075, 0.09, ground);
      }
    }
    for (const junction of busy)
      for (const id of junction.approaches) {
        const lane = net.lanes[id];
        const mustYield = lane.out.some((c) => net.connectors[c].yieldsTo.some((y) => net.lanes[net.connectors[y].from].stretch !== lane.stretch));
        if (!junction.signalled && !lane.sign && !mustYield) continue;
        const half = lane.count > 1 ? lane.spacing / 2 : lane.road.oneway ? lane.road.width / 2 - 0.5 : 1.6;
        strip(paint, sample(lane, lane.length - 0.5, lane.length, 0.5), -half, half, 0.09, ground);
      }
    for (const [cx, cz] of map.crossings) {
      let best: { width: number; dx: number; dz: number; d: number } | null = null;
      for (const road of map.roads)
        for (let i = 1; i < road.points.length; i++) {
          const [ax, az] = road.points[i - 1];
          const [bx, bz] = road.points[i];
          const len = Math.hypot(bx - ax, bz - az) || 1;
          const t = Math.min(1, Math.max(0, ((cx - ax) * (bx - ax) + (cz - az) * (bz - az)) / (len * len)));
          const d = Math.hypot(cx - ax - (bx - ax) * t, cz - az - (bz - az) * t);
          if (!best || d < best.d) best = { width: road.width, dx: (bx - ax) / len, dz: (bz - az) / len, d };
        }
      if (!best || best.d > 3 || cx < 0 || cz < 0 || cx >= SIZE || cz >= SIZE) continue;
      // Stripes run along the street; the row of them runs across it.
      for (let across = -best.width / 2 + 0.4; across < best.width / 2 - 0.5; across += 1) {
        const [ox, oz] = [cx - best.dz * across, cz + best.dx * across];
        strip(paint, [[ox - best.dx * 1.6, oz - best.dz * 1.6], [ox + best.dx * 1.6, oz + best.dz * 1.6]], 0, 0.5, 0.09, ground);
      }
    }
    const paintMesh = new THREE.Mesh(paint.geometry(), new THREE.MeshStandardMaterial({ color: '#e9e6dc', roughness: 0.55, metalness: 0, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }));
    paintMesh.receiveShadow = true;

    // --- Pavements ------------------------------------------------------------------------------
    const walk = new Builder();
    const H = 0.15;
    const offRoad = (x: number, z: number) => {
      const k = kind(x, z);
      return k !== -1 && k !== ROAD;
    };
    for (const road of map.roads) {
      if (road.kind === 'service') continue;
      const width = road.rank >= 2 ? 2.4 : 1.4;
      for (const points of runs(refine(road.points, 4), near))
      for (const sign of [-1, 1]) {
        const inner = (road.width / 2) * sign;
        const outer = (road.width / 2 + width) * sign;
        strip(walk, points, Math.min(inner, outer), Math.max(inner, outer), H, ground, offRoad);
        // The kerb: a short wall facing the street.
        for (let i = 0; i + 1 < points.length; i++) {
          const [p, q] = [points[i], points[i + 1]];
          const len = Math.hypot(q[0] - p[0], q[1] - p[1]) || 1;
          const [nx, nz] = [(-(q[1] - p[1]) / len) * sign, ((q[0] - p[0]) / len) * sign];
          const half = road.width / 2;
          const mx = (p[0] + q[0]) / 2 + nx * (half + width / 2);
          const mz = (p[1] + q[1]) / 2 + nz * (half + width / 2);
          if (!offRoad(mx, mz)) continue;
          const a = v(p[0] + nx * half, ground(p[0] + nx * half, p[1] + nz * half), p[1] + nz * half);
          const b = v(q[0] + nx * half, ground(q[0] + nx * half, q[1] + nz * half), q[1] + nz * half);
          walk.quad(a, b, v(b.x, b.y + H, b.z), v(a.x, a.y + H, a.z), v(-nx, 0, -nz));
        }
      }
    }
    const slabs = surfaces.concreteNormal.clone();
    this.pavement = new THREE.MeshStandardMaterial({ color: '#a9a59a', normalMap: slabs, normalScale: new THREE.Vector2(0.8, 0.8), roughness: 0.92, metalness: 0, side: THREE.DoubleSide });
    roadSurface(this.pavement, this.wetness, true);
    const walkMesh = new THREE.Mesh(walk.geometry(), this.pavement);
    walkMesh.receiveShadow = true;
    walkMesh.castShadow = true;
    this.group.add(tarmacMesh, paintMesh, walkMesh);
  }

  /** Rain darkens the tarmac and turns it into a mirror for the sky and the lamps. */
  update(wet: number) {
    this.wetness.value = wet;
    this.tarmac.envMapIntensity = 0.7 + wet * 1.1;
  }

  dispose() {
    this.group.traverse((o) => {
      if (o instanceof THREE.Mesh) {
        o.geometry.dispose();
        (o.material as THREE.Material).dispose();
      }
    });
  }
}
