// What stands along the street: lamp posts and traffic signals, and the small things of a French pavement:
// bollards by the junctions, benches, bins beside the lamps, café tables with their chairs. Their places are
// worked out from the streets' real geometry (the kerb line, then a step into the pavement), never from the
// block grid: nothing must stand on the tarmac.

import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { City } from '../../city/build';
import { along, type Lane, type Network } from '../../city/network';
import { SIZE } from '../../city/osm';
import type { Traffic } from '../../sim/cars';
import type { Heightfield } from '../../city/terrain';

const NEAR_LIGHTS = 6;
const ROAD = 1;

interface Head {
  lane: number;
  x: number;
  z: number;
  fx: number;
  fz: number;
}

/** From the middle of a lane to the kerb on its right. */
function toKerb(lane: Lane): number {
  const fromCentre = lane.road.oneway ? ((lane.count - 1) / 2) * lane.spacing : lane.count === 1 ? 1.7 : (lane.count - 1) * lane.spacing + lane.spacing / 2;
  return Math.max(1.2, lane.road.width / 2 - fromCentre);
}

export class Furniture {
  readonly group = new THREE.Group();
  private readonly lampHeads: THREE.InstancedMesh;
  private readonly signalLamps: THREE.InstancedMesh | null = null;
  private readonly lamps: Array<{ x: number; y: number; z: number }> = [];
  private readonly heads: Head[] = [];
  private readonly pool: THREE.PointLight[] = [];
  private readonly colour = new THREE.Color();
  /** How many of each small thing were placed: for the checks. */
  readonly counts: Record<string, number>;

  constructor(city: City, terrain: Heightfield, net: Network) {
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const one = new THREE.Vector3(1, 1, 1);
    const metal = new THREE.MeshStandardMaterial({ color: '#2a2d31', roughness: 0.55, metalness: 0.7 });
    const kind = (x: number, z: number) => (x < 2 || z < 2 || x >= SIZE - 2 || z >= SIZE - 2 ? -1 : city.ground[Math.floor(z) * SIZE + Math.floor(x)]);
    // The round patch of tarmac drawn at the heart of every junction (same radius as in roads.ts).
    const discs = [...net.junctions.values()].map((j) => ({ x: j.x, z: j.z, r: Math.min(16, Math.max(3, ...j.approaches.map((id) => net.lanes[id].road.width / 2))) + 0.5 }));
    const onDisc = (x: number, z: number) => discs.some((d) => Math.hypot(d.x - x, d.z - z) < d.r + 0.4);
    /** A spot on the pavement to the right of a point on a lane: past the kerb, and clear of any other tarmac. */
    const pavement = (lane: Lane, x: number, z: number, dx: number, dz: number, inset: number): [number, number] | null => {
      for (let step = 0; step <= 6; step += 0.75) {
        const d = toKerb(lane) + inset + step;
        const [px, pz] = [x - dz * d, z + dx * d];
        const here = kind(px, pz);
        // Not on a road (nor within a pace of one), not inside a house, not in the water.
        if (here === -1 || here === 3 || here === 5 || here === 6) return null;
        if (here !== ROAD && !onDisc(px, pz) && kind(px + dz * 0.8, pz - dx * 0.8) !== ROAD && kind(px - dz * 0.8, pz + dx * 0.8) !== ROAD) return [px, pz];
      }
      return null;
    };
    const busy = [...net.junctions.values()].filter((j) => j.approaches.length >= 2 || j.connectors.length >= 3);
    const hash = (n: number) => {
      let h = Math.imul(n ^ 0x9e3779b9, 0x85ebca6b);
      h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
      return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
    };
    const rot = (dx: number, dz: number) => new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.atan2(-dz, dx));
    const place = (list: THREE.Matrix4[], x: number, z: number, dx: number, dz: number, extra = 0) => list.push(new THREE.Matrix4().compose(new THREE.Vector3(x, terrain.at(x, z), z), rot(dx, dz).multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), extra)), one));
    const bollards: THREE.Matrix4[] = [];
    const benches: THREE.Matrix4[] = [];
    const bins: THREE.Matrix4[] = [];
    const tables: THREE.Matrix4[] = [];
    const chairs: THREE.Matrix4[] = [];
    const drains: THREE.Matrix4[] = [];
    const manholes: THREE.Matrix4[] = [];
    for (const lane of net.lanes) {
      if (lane.road.rank < 2 || lane.length < 24 || lane.index !== 0) continue;
      for (let s=22;s<lane.length-12;s+=29) {
        const at=along(lane,s);
        if (busy.some(j=>Math.hypot(j.x-at.x,j.z-at.z)<10)) continue;
        const edge=toKerb(lane)-.3;
        place(drains,at.x-at.dz*edge,at.z+at.dx*edge,at.dx,at.dz);
        if(hash(lane.id*47+Math.floor(s))>.72) place(manholes,at.x,at.z,at.dx,at.dz);
      }
      // Bollards: the last dozen metres before a junction, a pace apart, just past the kerb.
      for (const [from, to] of [[lane.length - 13, lane.length - 2.5], [2.5, 13]] as const) {
        if (hash(lane.id * 31 + from) < 0.35) continue;
        for (let s = from; s <= to; s += 1.7) {
          const p = along(lane, s);
          const spot = pavement(lane, p.x, p.z, p.dx, p.dz, 0.4);
          if (spot && Math.hypot(spot[0] - p.x, spot[1] - p.z) < toKerb(lane) + 1.2) place(bollards, spot[0], spot[1], p.dx, p.dz);
        }
      }
      // Benches, bins, and now and then a café terrace, further in on the pavement where it is wide enough.
      for (let s = 20; s < lane.length - 16; s += 9) {
        const r = hash(lane.id * 104729 + Math.floor(s));
        const p = along(lane, s);
        if (busy.some((j) => Math.hypot(j.x - p.x, j.z - p.z) < 10)) continue;
        const deep = pavement(lane, p.x, p.z, p.dx, p.dz, 2.2);
        const shallow = pavement(lane, p.x, p.z, p.dx, p.dz, 0.5);
        if (!deep || !shallow || Math.hypot(deep[0] - p.x, deep[1] - p.z) > toKerb(lane) + 3.2) continue;
        if (r < 0.07) place(benches, deep[0], deep[1], p.dx, p.dz);
        else if (r < 0.13) place(bins, shallow[0], shallow[1], p.dx, p.dz);
        else if (r < 0.2) {
          // A terrace: two or three tables in a row along the wall, two chairs each, facing the street.
          const n = 2 + (r < 0.16 ? 1 : 0);
          for (let k = 0; k < n; k++) {
            const q = along(lane, s + (k - (n - 1) / 2) * 1.6);
            const at = pavement(lane, q.x, q.z, q.dx, q.dz, 1.9);
            if (!at || Math.hypot(at[0] - q.x, at[1] - q.z) > toKerb(lane) + 2.6) continue;
            place(tables, at[0], at[1], q.dx, q.dz);
            for (const side of [-1, 1]) place(chairs, at[0] + q.dx * side * 0.62, at[1] + q.dz * side * 0.62, q.dx * side, q.dz * side, Math.PI / 2);
          }
        }
      }
    }
    const iron = new THREE.MeshStandardMaterial({ color: '#2f3236', roughness: 0.5, metalness: 0.7 });
    const wood = new THREE.MeshStandardMaterial({ color: '#6b5236', roughness: 0.85 });
    const green = new THREE.MeshStandardMaterial({ color: '#2d4a35', roughness: 0.7, metalness: 0.2 });
    const cafe = new THREE.MeshStandardMaterial({ color: '#8a2f2a', roughness: 0.6, metalness: 0.3 });
    const box = (w: number, h: number, d: number, x = 0, y = 0, z = 0) => new THREE.BoxGeometry(w, h, d).translate(x, y, z);
    const bollardGeometry = mergeGeometries([new THREE.CylinderGeometry(0.07, 0.09, 0.85, 10).translate(0, 0.425, 0), new THREE.SphereGeometry(0.085, 10, 8).translate(0, 0.88, 0)])!;
    const benchGeometry = mergeGeometries([box(1.7, 0.05, 0.42, 0, 0.45, 0), box(1.7, 0.4, 0.04, 0, 0.72, -0.2), box(0.06, 0.45, 0.4, -0.75, 0.22, 0), box(0.06, 0.45, 0.4, 0.75, 0.22, 0), box(0.06, 0.32, 0.04, -0.75, 0.62, -0.2), box(0.06, 0.32, 0.04, 0.75, 0.62, -0.2)])!;
    const binGeometry = mergeGeometries([new THREE.CylinderGeometry(0.2, 0.17, 0.85, 12).translate(0, 0.45, 0), new THREE.CylinderGeometry(0.22, 0.22, 0.05, 12).translate(0, 0.9, 0)])!;
    const tableGeometry = mergeGeometries([new THREE.CylinderGeometry(0.32, 0.32, 0.03, 16).translate(0, 0.72, 0), new THREE.CylinderGeometry(0.025, 0.025, 0.7, 8).translate(0, 0.36, 0), new THREE.CylinderGeometry(0.2, 0.22, 0.03, 12).translate(0, 0.015, 0)])!;
    const chairGeometry = mergeGeometries([box(0.4, 0.03, 0.4, 0, 0.45, 0), box(0.4, 0.36, 0.03, 0, 0.64, -0.19), box(0.02, 0.45, 0.02, -0.18, 0.22, -0.18), box(0.02, 0.45, 0.02, 0.18, 0.22, -0.18), box(0.02, 0.45, 0.02, -0.18, 0.22, 0.18), box(0.02, 0.45, 0.02, 0.18, 0.22, 0.18)])!;
    const grateParts=[box(.66,.018,.035,0,.068,-.22),box(.66,.018,.035,0,.068,.22),box(.035,.018,.44,-.33,.068,0),box(.035,.018,.44,.33,.068,0)];
    for(let x=-.27;x<=.27;x+=.065) grateParts.push(box(.027,.018,.42,x,.068,0));
    const manholeParts: THREE.BufferGeometry[]=[new THREE.CylinderGeometry(.37,.39,.02,28).translate(0,.065,0)];
    for(let k=-3;k<=3;k++) manholeParts.push(box(.46,.009,.009,0,.08,k*.074));
    manholeParts.push(new THREE.TorusGeometry(.34,.008,4,32).rotateX(Math.PI/2).translate(0,.08,0));
    const instanced = (geometry: THREE.BufferGeometry, material: THREE.Material, list: THREE.Matrix4[]) => {
      if (!list.length) return;
      const mesh = new THREE.InstancedMesh(geometry, material, list.length);
      list.forEach((matrix, i) => mesh.setMatrixAt(i, matrix));
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      this.group.add(mesh);
    };
    instanced(bollardGeometry, iron, bollards);
    instanced(benchGeometry, wood, benches);
    instanced(binGeometry, green, bins);
    instanced(tableGeometry, cafe, tables);
    instanced(chairGeometry, cafe, chairs);
    instanced(mergeGeometries(grateParts)!,iron,drains);
    instanced(mergeGeometries(manholeParts)!,iron,manholes);
    this.counts = { bollards: bollards.length, benches: benches.length, bins: bins.length, tables: tables.length, chairs: chairs.length, drains:drains.length, manholes:manholes.length };

    // Street lamps: along the kerb lane of every proper street, clear of the junctions.
    for (const lane of net.lanes) {
      if (lane.road.rank < 2 || lane.length < 30 || lane.index !== 0) continue;
      for (let s = 14; s < lane.length - 10; s += 34) {
        const p = along(lane, s);
        if (busy.some((j) => Math.hypot(j.x - p.x, j.z - p.z) < 12)) continue;
        const spot = pavement(lane, p.x, p.z, p.dx, p.dz, 0.9);
        if (spot) this.lamps.push({ x: spot[0], y: terrain.at(spot[0], spot[1]), z: spot[1] });
      }
    }
    // Traffic signals: one per street arriving at a signalled junction, on the pavement just past the stop line.
    for (const junction of net.junctions.values()) {
      if (!junction.signalled) continue;
      for (const id of junction.approaches) {
        const lane = net.lanes[id];
        if (lane.index !== 0) continue;
        const end = along(lane, lane.length);
        const spot = pavement(lane, end.x + end.dx * 1.5, end.z + end.dz * 1.5, end.dx, end.dz, 0.7) ?? pavement(lane, end.x - end.dx * 2, end.z - end.dz * 2, end.dx, end.dz, 0.7);
        if (spot) this.heads.push({ lane: id, x: spot[0], z: spot[1], fx: -end.dx, fz: -end.dz });
      }
    }

    const posts = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.06, 0.11, 7, 8), metal, Math.max(1, this.lamps.length));
    this.lampHeads = new THREE.InstancedMesh(new THREE.BoxGeometry(0.9, 0.12, 0.36), new THREE.MeshBasicMaterial({ toneMapped: false }), Math.max(1, this.lamps.length));
    this.lamps.forEach((lamp, i) => {
      posts.setMatrixAt(i, m.compose(new THREE.Vector3(lamp.x, lamp.y + 3.5, lamp.z), q, one));
      this.lampHeads.setMatrixAt(i, m.compose(new THREE.Vector3(lamp.x, lamp.y + 7.02, lamp.z), q, one));
      this.lampHeads.setColorAt(i, this.colour.set('#d8d8d2'));
    });
    posts.count = this.lampHeads.count = this.lamps.length;
    posts.castShadow = true;
    this.group.add(posts, this.lampHeads);
    for (let i = 0; i < NEAR_LIGHTS; i++) {
      const light = new THREE.PointLight('#ffd9a0', 0, 34, 1.6);
      this.pool.push(light);
      this.group.add(light);
    }

    // Traffic signals: a post by the kerb, a head with three lamps facing the driver.
    const heads = this.heads;
    if (heads.length) {
      const poles = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.07, 0.09, 3.4, 8), metal, heads.length);
      const housings = new THREE.InstancedMesh(new THREE.BoxGeometry(0.36, 1.05, 0.3), new THREE.MeshStandardMaterial({ color: '#15171a', roughness: 0.5, metalness: 0.3 }), heads.length);
      const lamps = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.11, 0.11, 0.06, 14), new THREE.MeshBasicMaterial({ toneMapped: false }), heads.length * 3);
      heads.forEach((head, i) => {
        const y = terrain.at(head.x, head.z);
        const facing = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.atan2(head.fx, head.fz));
        poles.setMatrixAt(i, m.compose(new THREE.Vector3(head.x, y + 1.7, head.z), q, one));
        housings.setMatrixAt(i, m.compose(new THREE.Vector3(head.x, y + 3.55, head.z), facing, one));
        // Lamps are discs lying on their side, facing the driver.
        const disc = facing.clone().multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), Math.PI / 2));
        for (let k = 0; k < 3; k++) {
          lamps.setMatrixAt(i * 3 + k, m.compose(new THREE.Vector3(head.x + head.fx * 0.16, y + 3.88 - k * 0.33, head.z + head.fz * 0.16), disc, one));
          lamps.setColorAt(i * 3 + k, this.colour.set('#111111'));
        }
      });
      poles.castShadow = housings.castShadow = true;
      this.signalLamps = lamps;
      this.group.add(poles, housings, lamps);
    }
  }

  update(traffic: Traffic, night: number, eye: THREE.Vector3) {
    if (this.signalLamps) {
      this.heads.forEach((head, i) => {
        const light = traffic.light(traffic.net.lanes[head.lane]);
        this.signalLamps!.setColorAt(i * 3, this.colour.set('#ff2414').multiplyScalar(light === 'red' ? 7 : 0.07));
        this.signalLamps!.setColorAt(i * 3 + 1, this.colour.set('#ffa514').multiplyScalar(light === 'amber' ? 7 : 0.07));
        this.signalLamps!.setColorAt(i * 3 + 2, this.colour.set('#1aff6e').multiplyScalar(light === 'green' ? 5 : 0.06));
      });
      if (this.signalLamps.instanceColor) this.signalLamps.instanceColor.needsUpdate = true;
    }
    const on = night > 0.3;
    for (let i = 0; i < this.lamps.length; i++) this.lampHeads.setColorAt(i, this.colour.set(on ? '#ffe2ae' : '#d8d8d2').multiplyScalar(on ? 2.6 : 1));
    if (this.lampHeads.instanceColor) this.lampHeads.instanceColor.needsUpdate = true;
    // Real light only from the few lamps nearest the eye; the rest glow.
    const nearest = on ? [...this.lamps].sort((a, b) => Math.hypot(a.x - eye.x, a.z - eye.z) - Math.hypot(b.x - eye.x, b.z - eye.z)).slice(0, NEAR_LIGHTS) : [];
    this.pool.forEach((light, i) => {
      const lamp = nearest[i];
      light.intensity = lamp ? 90 * night : 0;
      if (lamp) light.position.set(lamp.x, lamp.y + 6.8, lamp.z);
    });
  }

  dispose() {
    this.group.traverse((o) => {
      if (o instanceof THREE.InstancedMesh) {
        o.geometry.dispose();
        (o.material as THREE.Material).dispose();
      }
    });
  }
}
