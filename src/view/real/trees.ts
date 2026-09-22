// Trees: the map's own, plus a scattering in every park. Eight species, modelled in Blender
// (`scripts/blender/make_trees.py`, `public/models/trees`), each recognisable by its outline: which ones grow
// depends on how far south the town is, and a street is planted with one kind, the way streets are. Two
// instanced meshes a species, however many trees there are. Until the models have arrived, or if they never
// do, a tree is a lumpy ball on a stick.

import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { City } from '../../city/build';
import { SIZE, type CityMap } from '../../city/osm';
import type { Heightfield } from '../../city/terrain';
import { fbm } from './textures';

const MAX = 7000;
const GREEN = 4;

const SPECIES = ['plane', 'umbrella_pine', 'cypress', 'palm', 'olive', 'lime', 'poplar', 'fir'] as const;
type Species = (typeof SPECIES)[number];

/** What is planted along streets and what grows in parks, by climate: how likely each is, out of their sum. */
const PLANTING: Record<'south' | 'middle' | 'north', { street: Partial<Record<Species, number>>; park: Partial<Record<Species, number>> }> = {
  south: { street: { plane: 5, umbrella_pine: 2, palm: 2, lime: 1, cypress: 1 }, park: { umbrella_pine: 5, olive: 3, cypress: 3, plane: 2, palm: 1 } },
  middle: { street: { plane: 5, lime: 4, poplar: 1 }, park: { lime: 4, plane: 3, poplar: 2, fir: 2, cypress: 1 } },
  north: { street: { lime: 5, plane: 3, poplar: 2 }, park: { lime: 4, fir: 4, poplar: 3, plane: 1 } },
};

function hash(n: number): number {
  let h = Math.imul(n ^ 0x9e3779b9, 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

function pick(weights: Partial<Record<Species, number>>, r: number): Species {
  const entries = Object.entries(weights) as Array<[Species, number]>;
  let left = r * entries.reduce((sum, [, w]) => sum + w, 0);
  for (const [species, w] of entries) if ((left -= w) <= 0) return species;
  return entries[0][0];
}

/** Darker underneath, lighter where the sun catches it: painted into the leaves once, so that every green has depth. */
function shaded(g: THREE.BufferGeometry): THREE.BufferGeometry {
  g.computeBoundingBox();
  const { min, max } = g.boundingBox!;
  const pos = g.attributes.position;
  const colours = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) colours.fill(0.62 + 0.38 * THREE.MathUtils.smoothstep(pos.getY(i), min.y, max.y), i * 3, i * 3 + 3);
  g.setAttribute('color', new THREE.BufferAttribute(colours, 3));
  return g;
}

interface Kind {
  bark: THREE.InstancedMesh;
  leaf: THREE.InstancedMesh;
  /** Metres, as modelled. */
  height: number;
  green: THREE.Color;
  n: number;
}

interface Spot {
  x: number;
  z: number;
  y: number;
  cell: number;
  park: boolean;
}

export class Trees {
  readonly group = new THREE.Group();
  private readonly trunks: THREE.InstancedMesh;
  private readonly crowns: THREE.InstancedMesh;
  private readonly kinds = new Map<Species, Kind>();
  private readonly planted = new Set<number>();
  private readonly spots: Spot[] = [];
  private readonly climate: 'south' | 'middle' | 'north';
  private disposed = false;

  /** `latitude` decides what grows: palms and umbrella pines by the Mediterranean, limes and firs further north. */
  constructor(private readonly terrain: Heightfield, latitude: number) {
    const lat = Math.abs(latitude);
    this.climate = lat < 44.6 ? 'south' : lat < 50.5 ? 'middle' : 'north';

    // The stand-in: a crown is a lumpy ball.
    const crown = new THREE.IcosahedronGeometry(1, 2);
    const pos = crown.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      const p = new THREE.Vector3().fromBufferAttribute(pos, i);
      p.multiplyScalar(0.78 + fbm(p.x * 0.35 + 0.5, p.y * 0.35 + p.z * 0.2 + 0.5, 3, 3, 21) * 0.5);
      pos.setXYZ(i, p.x, p.y * 0.86, p.z);
    }
    crown.computeVertexNormals();
    this.crowns = this.instanced(shaded(crown), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, metalness: 0 }));
    this.trunks = this.instanced(new THREE.CylinderGeometry(0.12, 0.2, 1, 7), new THREE.MeshStandardMaterial({ color: '#5d4a3a', roughness: 1 }));
    this.crowns.setColorAt(0, new THREE.Color('#4f7f3a'));

    const loader = new GLTFLoader();
    void Promise.all(
      SPECIES.map((name) =>
        loader
          .loadAsync(`${import.meta.env.BASE_URL}models/trees/${name}.glb`)
          .then((gltf) => !this.disposed && this.adopt(name, gltf.scene))
          .catch((error) => console.warn(`tree "${name}" not loaded, a ball stands in`, error)),
      ),
    ).then(() => !this.disposed && this.lay());
  }

  private instanced(geometry: THREE.BufferGeometry, material: THREE.Material): THREE.InstancedMesh {
    const mesh = new THREE.InstancedMesh(geometry, material, MAX);
    mesh.count = 0;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.frustumCulled = false;
    this.group.add(mesh);
    return mesh;
  }

  /** A modelled species: "leaf" takes each tree's own green, "bark" keeps the colour it was given. */
  private adopt(name: Species, root: THREE.Object3D) {
    root.updateMatrixWorld(true);
    const parts: Record<'bark' | 'leaf', THREE.BufferGeometry[]> = { bark: [], leaf: [] };
    let height = 10;
    let green = new THREE.Color('#3f6f2a');
    let bark = new THREE.Color('#5d4a3a');
    root.traverse((o) => {
      if (typeof o.userData.height === 'number') height = o.userData.height;
      if (!(o instanceof THREE.Mesh)) return;
      const material = o.material as THREE.MeshStandardMaterial;
      const g = (o.geometry as THREE.BufferGeometry).clone().applyMatrix4(o.matrixWorld);
      for (const attribute of Object.keys(g.attributes)) if (attribute !== 'position' && attribute !== 'normal') g.deleteAttribute(attribute);
      // Blender numbers materials that share a name: "leaf.003" is still leaf.
      if (material.name.split('.')[0] === 'leaf') {
        green = material.color.clone();
        parts.leaf.push(g);
      } else {
        bark = material.color.clone();
        parts.bark.push(g);
      }
    });
    if (!parts.leaf.length || !parts.bark.length) throw new Error('not a Jev Roads tree');
    this.kinds.set(name, {
      bark: this.instanced(mergeGeometries(parts.bark)!, new THREE.MeshStandardMaterial({ color: bark, roughness: 1 })),
      leaf: this.instanced(shaded(mergeGeometries(parts.leaf)!), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, metalness: 0 })),
      height,
      green,
      n: 0,
    });
  }

  add(map: CityMap, city: City) {
    const found: Array<[number, number]> = map.trees.map((t) => [t[0], t[1]]);
    // Parks are rarely mapped tree by tree: plant them, thicker in the middle than by the paths.
    for (const polygon of map.green) {
      const xs = polygon.map((p) => p[0]);
      const zs = polygon.map((p) => p[1]);
      const [x0, x1, z0, z1] = [Math.max(0, Math.min(...xs)), Math.min(SIZE, Math.max(...xs)), Math.max(0, Math.min(...zs)), Math.min(SIZE, Math.max(...zs))];
      for (let z = z0; z < z1; z += 9)
        for (let x = x0; x < x1; x += 9) {
          const [jx, jz] = [x + hash(Math.floor(x) * 7919 + Math.floor(z)) * 8, z + hash(Math.floor(z) * 104729 + Math.floor(x)) * 8];
          if (hash(Math.floor(jx) * 31 + Math.floor(jz) * 17) < 0.45) found.push([jx, jz]);
        }
    }
    for (const [x, z] of found) {
      if (this.spots.length >= MAX || x < 1 || z < 1 || x > SIZE - 1 || z > SIZE - 1) continue;
      const cell = Math.floor(z) * SIZE + Math.floor(x);
      const kind = city.ground[cell];
      // Not on the road, not inside a house, and only once.
      if (kind === 1 || kind === 3 || kind === 5 || kind === 6 || this.planted.has(cell)) continue;
      this.planted.add(cell);
      this.spots.push({ x, z, y: this.terrain.at(x, z), cell, park: kind === GREEN });
    }
    this.lay();
  }

  /** Every tree, laid out afresh: with the modelled species once they are here, as balls until then. */
  private lay() {
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const colour = new THREE.Color();
    const hsl = { h: 0, s: 0, l: 0 };
    const up = new THREE.Vector3(0, 1, 0);
    const planting = PLANTING[this.climate];
    for (const kind of this.kinds.values()) kind.n = 0;
    let balls = 0;
    for (const { x, z, y, cell, park } of this.spots) {
      const r = hash(cell);
      q.setFromAxisAngle(up, r * 6.28);
      // A street is planted with one kind for a good sixty metres; a park is a mixture.
      const district = Math.floor(z / 64) * 97 + Math.floor(x / 64);
      const species = pick(park ? planting.park : planting.street, park ? hash(cell + 13) : hash(district * 31 + 5) * 0.8 + hash(cell + 13) * 0.2);
      const kind = this.kinds.get(species);
      if (kind) {
        // Its own size and its own green: a little taller or squatter, a little yellower or bluer than its neighbour.
        const tall = ((park ? 1.05 : 0.92) + (r - 0.5) * 0.5) * (species === 'plane' && !park ? 0.85 : 1);
        const wide = tall * (0.9 + hash(cell + 3) * 0.25);
        m.compose(new THREE.Vector3(x, y - 0.15, z), q, new THREE.Vector3(wide, tall, wide));
        kind.bark.setMatrixAt(kind.n, m);
        kind.leaf.setMatrixAt(kind.n, m);
        kind.green.getHSL(hsl);
        kind.leaf.setColorAt(kind.n, colour.setHSL(hsl.h + (hash(cell + 9) - 0.5) * 0.05, hsl.s * (0.85 + hash(cell + 5) * 0.3), hsl.l * (0.8 + hash(cell + 7) * 0.45)));
        kind.n++;
        continue;
      }
      const height = 5.5 + r * 5 + (park ? 2 : 0);
      const spread = 2.2 + hash(cell + 3) * 1.8;
      const trunk = height * 0.45;
      this.trunks.setMatrixAt(balls, m.compose(new THREE.Vector3(x, y + trunk / 2 - 0.3, z), q, new THREE.Vector3(spread * 0.5, trunk + 0.6, spread * 0.5)));
      this.crowns.setMatrixAt(balls, m.compose(new THREE.Vector3(x, y + trunk + (height - trunk) * 0.55, z), q, new THREE.Vector3(spread, (height - trunk) * 0.62, spread)));
      this.crowns.setColorAt(balls, colour.setHSL(0.25 + hash(cell + 9) * 0.08, 0.5 + hash(cell + 5) * 0.2, 0.17 + hash(cell + 7) * 0.09));
      balls++;
    }
    const commit = (mesh: THREE.InstancedMesh, count: number) => {
      mesh.count = count;
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    };
    commit(this.trunks, balls);
    commit(this.crowns, balls);
    for (const kind of this.kinds.values()) {
      commit(kind.bark, kind.n);
      commit(kind.leaf, kind.n);
    }
  }

  /** How many of each are standing: for the checks. */
  get census(): Record<string, number> {
    return { balls: this.crowns.count, ...Object.fromEntries([...this.kinds].map(([name, kind]) => [name, kind.n])) };
  }

  dispose() {
    this.disposed = true;
    this.group.traverse((o) => {
      if (o instanceof THREE.InstancedMesh) {
        o.geometry.dispose();
        (o.material as THREE.Material).dispose();
      }
    });
  }
}
