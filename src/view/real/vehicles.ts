// Vehicles with real bodywork: clear-coated paint, a dark glasshouse, wheels. The bodies are the nine models in
// `public/models` (made in Blender by `scripts/blender/make_cars.py`); until they have arrived, or if they never
// do, a side profile pushed through the car's width stands in. One set of three instanced meshes per body,
// so a thousand cars cost a few dozen draw calls.

import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { City } from '../../city/build';
import { along, type Lane, type Network } from '../../city/network';
import { SIZE } from '../../city/osm';
import type { Heightfield } from '../../city/terrain';
import type { Car, Traffic } from '../../sim/cars';
import type { Model } from '../../sim/drivers';

const MAX = 1800;

/** A car left at the kerb: it never moves, but it is drawn like the others. */
interface Parked {
  x: number;
  z: number;
  dx: number;
  dz: number;
  model: Model;
  colour: string;
  size: [number, number, number];
}

const PARKED_MODELS: Array<{ model: Model; size: [number, number, number]; weight: number }> = [
  { model: 'hatch', size: [3.9, 1.78, 1.47], weight: 5 },
  { model: 'saloon', size: [4.55, 1.82, 1.44], weight: 3 },
  { model: 'estate', size: [4.6, 1.82, 1.5], weight: 2 },
  { model: 'suv', size: [4.7, 1.92, 1.76], weight: 2 },
  { model: 'coupe', size: [4.3, 1.84, 1.28], weight: 1 },
  { model: 'van', size: [5.2, 2.0, 2.3], weight: 1 },
];
const PARKED_COLOURS = ['#e8e6df', '#d9d6cc', '#8d9197', '#5f6670', '#1d1f24', '#2c3e5c', '#7a1f1f', '#3f6b4a', '#b9bec6', '#c9c0a8', '#6f5a48', '#9aa3ad', '#c4262e', '#f0f0f0', '#44546a'];

/** From the middle of a kerb lane to the kerb on its right. */
function toKerb(lane: Lane): number {
  const fromCentre = lane.road.oneway ? ((lane.count - 1) / 2) * lane.spacing : lane.count === 1 ? 1.7 : (lane.count - 1) * lane.spacing + lane.spacing / 2;
  return Math.max(1.2, lane.road.width / 2 - fromCentre);
}

function hash(n: number): number {
  let h = Math.imul(n ^ 0x9e3779b9, 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
type Shape2 = Array<[number, number]>;
type Kind = 'car' | 'van' | 'bus' | 'truck';
type BodySet = { paint: THREE.InstancedMesh; glass: THREE.InstancedMesh; dark: THREE.InstancedMesh; n: number };
const MODELS: Model[] = ['hatch', 'saloon', 'estate', 'suv', 'coupe', 'pickup', 'van', 'bus', 'truck'];

// Side profiles: x from the tail (-0.5) to the nose (0.5), y from the road (0) to the roof (1).
// `round` squeezes the wheels along the body so that they come out round once the body is stretched to its real length.
const PROFILES: Record<Kind, { body: Shape2; glass: Shape2; roof: Shape2 | null; wheels: number[]; wheel: number; round: number }> = {
  car: {
    body: [[-0.5, 0.2], [-0.5, 0.52], [-0.47, 0.6], [-0.3, 0.63], [0.2, 0.62], [0.42, 0.56], [0.5, 0.46], [0.5, 0.2]],
    glass: [[-0.34, 0.62], [-0.2, 0.95], [0.06, 0.97], [0.26, 0.62]],
    roof: [[-0.22, 0.94], [-0.19, 1.0], [0.05, 1.0], [0.09, 0.95]],
    wheels: [-0.3, 0.31],
    wheel: 0.23,
    round: 0.35,
  },
  van: {
    body: [[-0.5, 0.17], [-0.5, 0.96], [-0.46, 1.0], [0.22, 1.0], [0.3, 0.95], [0.44, 0.56], [0.5, 0.5], [0.5, 0.17]],
    glass: [[0.2, 0.6], [0.26, 0.92], [0.31, 0.92], [0.43, 0.6]],
    roof: null,
    wheels: [-0.3, 0.33],
    wheel: 0.16,
    round: 0.44,
  },
  bus: {
    body: [[-0.5, 0.13], [-0.5, 0.97], [-0.48, 1.0], [0.47, 1.0], [0.5, 0.95], [0.5, 0.13]],
    glass: [[-0.47, 0.42], [-0.47, 0.84], [0.485, 0.84], [0.485, 0.42]],
    roof: null,
    wheels: [-0.3, 0.32],
    wheel: 0.16,
    round: 0.29,
  },
  truck: {
    body: [[-0.5, 0.2], [-0.5, 1.0], [0.2, 1.0], [0.2, 0.78], [0.3, 0.78], [0.34, 0.74], [0.47, 0.46], [0.5, 0.4], [0.5, 0.2]],
    glass: [[0.3, 0.52], [0.32, 0.74], [0.35, 0.74], [0.46, 0.52]],
    roof: null,
    wheels: [-0.3, 0.33],
    wheel: 0.15,
    round: 0.43,
  },
};

/** A profile pushed through the vehicle's width (z), centred, with softened edges. */
function extrude(profile: Shape2, width: number, bevel: number): THREE.BufferGeometry {
  const shape = new THREE.Shape(profile.map(([x, y]) => new THREE.Vector2(x, y)));
  const g = new THREE.ExtrudeGeometry(shape, { depth: width - bevel * 2, bevelEnabled: bevel > 0, bevelThickness: bevel, bevelSize: bevel * 0.6, bevelSegments: 3, curveSegments: 4 });
  g.translate(0, 0, -(width - bevel * 2) / 2);
  g.deleteAttribute('uv');
  // Extruded shapes come without an index already, like the wheels they are merged with.
  return g;
}

function tint(g: THREE.BufferGeometry, colour: THREE.ColorRepresentation): THREE.BufferGeometry {
  const c = new THREE.Color(colour);
  const colours = new Float32Array(g.attributes.position.count * 3);
  for (let i = 0; i < colours.length; i += 3) colours.set([c.r, c.g, c.b], i);
  g.setAttribute('color', new THREE.BufferAttribute(colours, 3));
  return g;
}

function buildKind(kind: Kind) {
  const p = PROFILES[kind];
  const paintParts = [extrude(p.body, 1, 0.07)];
  if (p.roof) paintParts.push(extrude(p.roof, 0.84, 0.03));
  const paint = mergeGeometries(paintParts)!;
  // The glasshouse stands a little proud of the body on a car, so the pillars vanish behind it.
  const glass = extrude(p.glass, kind === 'car' ? 0.9 : 1.012, kind === 'car' ? 0.05 : 0);
  const dark: THREE.BufferGeometry[] = [];
  for (const x of p.wheels)
    for (const side of [-1, 1]) {
      // Units here are fractions of the vehicle's length, height and width: the instance scale stretches them.
      const tyre = new THREE.CylinderGeometry(p.wheel, p.wheel, 0.13, 18).toNonIndexed();
      tyre.deleteAttribute('uv');
      tyre.rotateX(Math.PI / 2);
      tyre.scale(p.round, 1, 1);
      tyre.translate(x, p.wheel, side * 0.41);
      dark.push(tint(tyre, '#101113'));
      const rim = new THREE.CylinderGeometry(p.wheel * 0.62, p.wheel * 0.62, 0.135, 12).toNonIndexed();
      rim.deleteAttribute('uv');
      rim.rotateX(Math.PI / 2);
      rim.scale(p.round, 1, 1);
      rim.translate(x, p.wheel, side * 0.415);
      dark.push(tint(rim, '#9a9da3'));
    }
  const floor = new THREE.BoxGeometry(0.9, 0.12, 0.86).toNonIndexed();
  floor.deleteAttribute('uv');
  floor.translate(0, 0.17, 0);
  dark.push(tint(floor, '#0c0d0f'));
  const grille = new THREE.BoxGeometry(0.02, 0.12, 0.6).toNonIndexed();
  grille.deleteAttribute('uv');
  grille.translate(0.5, 0.3, 0);
  dark.push(tint(grille, '#16181b'));
  return { paint, glass, dark: mergeGeometries(dark)! };
}

/**
 * A modelled body, brought to the same terms as the profiles: a unit box that the instance stretches to the
 * driver's length, height and width. "paint" takes the driver's colour, "glass" the glass, the rest keeps its own.
 */
function fromModel(root: THREE.Object3D) {
  root.updateMatrixWorld(true);
  let size: number[] | undefined;
  let lamps: number[] | undefined;
  const parts: Record<'paint' | 'glass' | 'dark', THREE.BufferGeometry[]> = { paint: [], glass: [], dark: [] };
  root.traverse((o) => {
    if (Array.isArray(o.userData.size)) ({ size, lamps } = o.userData);
    if (!(o instanceof THREE.Mesh)) return;
    const material = o.material as THREE.MeshStandardMaterial;
    const g = (o.geometry as THREE.BufferGeometry).clone().applyMatrix4(o.matrixWorld);
    for (const name of Object.keys(g.attributes)) if (name !== 'position' && name !== 'normal') g.deleteAttribute(name);
    const name = material.name.split('.')[0]; // Blender numbers materials that share a name
    if (name === 'paint' || name === 'glass') parts[name].push(g);
    else parts.dark.push(tint(g, material.color));
  });
  if (!size || !lamps || !parts.paint.length || !parts.glass.length || !parts.dark.length) throw new Error('not a Jev Roads vehicle');
  const [length, width, height] = size;
  const fit = new THREE.Matrix4().makeScale(1 / length, 1 / height, 1 / width);
  const merged = (list: THREE.BufferGeometry[]) => mergeGeometries(list)!.applyMatrix4(fit);
  return { paint: merged(parts.paint), glass: merged(parts.glass), dark: merged(parts.dark), lamps: lamps as [number, number, number] };
}

const kindOf = (car: Car): Kind => (car.driver.body.kind === 'bus' ? 'bus' : car.driver.body.kind === 'truck' ? 'truck' : car.driver.body.kind === 'van' || car.driver.body.kind === 'ambulance' ? 'van' : 'car');

export class Vehicles {
  readonly group = new THREE.Group();
  private readonly sets: Record<Kind, BodySet>;
  /** Modelled bodies, as they arrive. `lamps`: how high the head and tail lamps sit, and how far out. */
  private readonly models = new Map<Model, BodySet & { lamps: [number, number, number] }>();
  private parked: Parked[] = [];
  private disposed = false;
  private readonly tails: THREE.InstancedMesh;
  private readonly heads: THREE.InstancedMesh;
  private readonly blinkers: THREE.InstancedMesh;
  private readonly tops: THREE.InstancedMesh;
  private readonly beams: THREE.InstancedMesh;
  private readonly paintMaterial = new THREE.MeshPhysicalMaterial({ roughness: 0.42, metalness: 0.55, clearcoat: 1, clearcoatRoughness: 0.06, envMapIntensity: 1.25 });
  private readonly glassMaterial = new THREE.MeshPhysicalMaterial({ color: '#0b1014', roughness: 0.04, metalness: 0.2, envMapIntensity: 1.8, clearcoat: 1, clearcoatRoughness: 0.02 });
  private readonly m = new THREE.Matrix4();
  private readonly q = new THREE.Quaternion();
  private readonly qPitch = new THREE.Quaternion();
  private readonly colour = new THREE.Color();
  private readonly UP = new THREE.Vector3(0, 1, 0);
  private readonly SIDE = new THREE.Vector3(0, 0, 1);

  constructor() {
    const make = (geometry: THREE.BufferGeometry, material: THREE.Material, count = MAX, shadow = true) => {
      const mesh = new THREE.InstancedMesh(geometry, material, count);
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      mesh.setColorAt(0, this.colour.set('#ffffff'));
      mesh.castShadow = shadow;
      mesh.receiveShadow = shadow;
      mesh.frustumCulled = false;
      mesh.count = 0;
      this.group.add(mesh);
      return mesh;
    };
    const darkMaterial = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.6, metalness: 0.35 });
    this.sets = Object.fromEntries(
      (Object.keys(PROFILES) as Kind[]).map((kind) => {
        const g = buildKind(kind);
        return [kind, { paint: make(g.paint, this.paintMaterial), glass: make(g.glass, this.glassMaterial), dark: make(g.dark, darkMaterial), n: 0 }];
      }),
    ) as typeof this.sets;
    const box = new THREE.BoxGeometry(1, 1, 1);
    const glow = () => new THREE.MeshBasicMaterial({ toneMapped: false });
    this.tails = make(box, glow(), MAX * 2, false);
    this.heads = make(box, glow(), MAX * 2, false);
    this.blinkers = make(box, glow(), MAX * 2, false);
    this.tops = make(box, glow(), MAX, false);
    this.beams = make(box, new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.1, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false }), MAX, false);

    const loader = new GLTFLoader();
    for (const name of MODELS)
      loader
        .loadAsync(`${import.meta.env.BASE_URL}models/${name}.glb`)
        .then((gltf) => {
          if (this.disposed) return;
          const g = fromModel(gltf.scene);
          this.models.set(name, { paint: make(g.paint, this.paintMaterial), glass: make(g.glass, this.glassMaterial), dark: make(g.dark, darkMaterial), n: 0, lamps: g.lamps });
        })
        .catch((error) => console.warn(`vehicle model "${name}" not loaded, its profile stands in`, error));
  }

  /**
   * Cars left along the kerbs: on every proper street with room for a parking strip outside its lanes, one every
   * few metres with gaps, clear of the junctions, facing the way the traffic on that side goes.
   */
  park(net: Network, city: City) {
    const kind = (x: number, z: number) => (x < 2 || z < 2 || x >= SIZE - 2 || z >= SIZE - 2 ? -1 : city.ground[Math.floor(z) * SIZE + Math.floor(x)]);
    const junctions = [...net.junctions.values()];
    const total = PARKED_MODELS.reduce((sum, m) => sum + m.weight, 0);
    this.parked = [];
    for (const lane of net.lanes) {
      if (lane.index !== 0 || lane.road.rank < 2 || lane.length < 26) continue;
      const kerb = toKerb(lane);
      // The car's inner side must clear the lane's sweep by a hand's breadth. Where the road is wide, that leaves
      // it on the tarmac; where it is not, it goes up with two wheels on the pavement, as it does in France.
      const out = Math.max(kerb - 0.95, kerb - 0.9 + 0.15 + 0.9);
      const onPavement = out + 0.9 - kerb;
      if (onPavement > 1.3) continue;
      for (let s = 9; s < lane.length - 9; s += 6.4) {
        const seed = lane.id * 7919 + Math.floor(s * 10);
        if (hash(seed) < (onPavement > 0.2 ? 0.5 : 0.38)) continue;
        const p = along(lane, s);
        if (junctions.some((j) => Math.hypot(j.x - p.x, j.z - p.z) < 15)) continue;
        const [x, z] = [p.x - p.dz * out, p.z + p.dx * out];
        // The inner wheels must stand on tarmac along the car's whole length; the outer ones on pavement, not in a house.
        const half = 2.3;
        const inner = out - 0.7;
        const outer = out + 0.7;
        let fits = true;
        for (const t of [-half, 0, half]) {
          const [ix, iz] = [p.x + p.dx * t - p.dz * inner, p.z + p.dz * t + p.dx * inner];
          const [ox, oz] = [p.x + p.dx * t - p.dz * outer, p.z + p.dz * t + p.dx * outer];
          const o = kind(ox, oz);
          if (kind(ix, iz) !== 1 || o === -1 || o === 3 || o === 5 || o === 6) fits = false;
        }
        if (!fits) continue;
        let pick = hash(seed + 1) * total;
        let choice = PARKED_MODELS[0];
        for (const m of PARKED_MODELS) if ((pick -= m.weight) <= 0) { choice = m; break; }
        // Not quite straight: nobody parks perfectly.
        const skew = (hash(seed + 2) - 0.5) * 0.06;
        const [dx, dz] = [p.dx * Math.cos(skew) - p.dz * Math.sin(skew), p.dx * Math.sin(skew) + p.dz * Math.cos(skew)];
        this.parked.push({ x, z, dx, dz, model: choice.model, colour: PARKED_COLOURS[Math.floor(hash(seed + 3) * PARKED_COLOURS.length)], size: choice.size });
      }
    }
  }

  get parkedCount(): number {
    return this.parked.length;
  }

  /** `hidden` is the car whose inside you are sitting in. */
  draw(traffic: Traffic, hidden: Car | null, night: number, wet: number, terrain: Heightfield) {
    const blink = Math.floor(performance.now() / 380) % 2 === 0;
    const flash = Math.floor(performance.now() / 140) % 2 === 0;
    const pos = new THREE.Vector3();
    const scale = new THREE.Vector3();
    const all: BodySet[] = [...Object.values(this.sets), ...this.models.values()];
    for (const set of all) set.n = 0;
    let lights = 0;
    let blinks = 0;
    let tops = 0;
    let beams = 0;
    this.paintMaterial.clearcoatRoughness = 0.06 + wet * 0.1;
    let ground = 0;
    let slope = 0;
    const put = (mesh: THREE.InstancedMesh, index: number, car: Car, fx: number, y: number, rz: number, sx: number, sy: number, sz: number) => {
      // `fx` metres ahead of the car's middle, on a road that climbs `slope` metres per metre.
      pos.set(car.x + car.dx * fx - car.dz * rz, ground + y + fx * slope, car.z + car.dz * fx + car.dx * rz);
      mesh.setMatrixAt(index, this.m.compose(pos, this.q, scale.set(sx, sy, sz)));
    };
    for (const car of traffic.cars) {
      const b = car.driver.body;
      // The nose dips under braking and lifts under power: small, but it is what makes a car look heavy.
      const reach = b.length / 2;
      const [front, back] = [terrain.at(car.x + car.dx * reach, car.z + car.dz * reach), terrain.at(car.x - car.dx * reach, car.z - car.dz * reach)];
      ground = (front + back) / 2 + 0.05;
      slope = (front - back) / b.length;
      this.q.setFromAxisAngle(this.UP, Math.atan2(-car.dz, car.dx));
      this.qPitch.setFromAxisAngle(this.SIDE, Math.atan(slope) + THREE.MathUtils.clamp(car.a * 0.006, -0.03, 0.02));
      this.q.multiply(this.qPitch);
      if (car !== hidden) {
        const model = this.models.get(b.model);
        const set: BodySet = model ?? this.sets[kindOf(car)];
        if (set.n < MAX) {
          for (const mesh of [set.paint, set.glass, set.dark]) put(mesh, set.n, car, 0, 0, 0, b.length, b.height, b.width);
          set.paint.setColorAt(set.n, this.colour.set(car.driver.color));
          set.n++;
        }
        const hazard = car.brokenUntil > traffic.time;
        const tall = b.kind === 'van' || b.kind === 'bus' || b.kind === 'truck' || b.kind === 'ambulance';
        const lampY = b.height * (tall ? 0.3 : 0.5);
        const [headY, tailY, lampZ] = model ? [b.height * model.lamps[0], b.height * model.lamps[1], b.width * model.lamps[2]] : [lampY * 0.98, lampY, b.width * 0.355];
        for (const side of [-1, 1]) {
          put(this.tails, lights, car, -b.length / 2 - 0.01, tailY, side * lampZ, 0.06, 0.13, 0.34);
          this.tails.setColorAt(lights, this.colour.set('#ff1a10').multiplyScalar(car.braking ? 3.4 : 0.5 + night * 0.9));
          put(this.heads, lights, car, b.length / 2 + 0.005, headY, side * lampZ, 0.06, 0.12, 0.3);
          this.heads.setColorAt(lights, this.colour.set('#fff3d6').multiplyScalar(night > 0.3 ? 3.2 : car.courtesyUntil > traffic.time && flash ? 4 : 1.1));
          lights++;
          if ((hazard || car.indicator === side) && blink) {
            put(this.blinkers, blinks, car, b.length / 2 - 0.12, headY, side * (b.width / 2 + 0.005), 0.22, 0.1, 0.05);
            this.blinkers.setColorAt(blinks++, this.colour.set('#ff9a14').multiplyScalar(5));
            put(this.blinkers, blinks, car, -b.length / 2 + 0.12, tailY, side * (b.width / 2 + 0.005), 0.22, 0.1, 0.05);
            this.blinkers.setColorAt(blinks++, this.colour.set('#ff9a14').multiplyScalar(5));
          }
        }
        if (b.kind === 'taxi' || b.kind === 'ambulance') {
          put(this.tops, tops, car, b.kind === 'taxi' ? -0.15 : b.length * 0.28, b.height + 0.09, 0, b.kind === 'taxi' ? 0.28 : 0.3, 0.14, b.kind === 'taxi' ? 0.55 : 1.3);
          this.tops.setColorAt(tops++, b.kind === 'taxi' ? this.colour.set('#ffd23c').multiplyScalar(1 + night * 3) : this.colour.set(flash ? '#1f5bff' : '#ffffff').multiplyScalar(6));
        }
      }
      if (night > 0.3 && beams < MAX) {
        this.q.setFromAxisAngle(this.UP, Math.atan2(-car.dz, car.dx));
        this.q.multiply(this.qPitch);
        put(this.beams, beams, car, b.length / 2 + 6, 0.06, 0, 11, 0.02, b.width * 1.7);
        this.beams.setColorAt(beams++, this.colour.set('#ffe9b0').multiplyScalar(night));
      }
    }
    // The parked cars, after the moving ones: the same bodies, standing still, lamps off.
    for (const car of this.parked) {
      const model = this.models.get(car.model);
      const set: BodySet = model ?? this.sets.car;
      if (set.n >= MAX) continue;
      const [length, width, height] = car.size;
      const reach = length / 2;
      const [front, back] = [terrain.at(car.x + car.dx * reach, car.z + car.dz * reach), terrain.at(car.x - car.dx * reach, car.z - car.dz * reach)];
      this.q.setFromAxisAngle(this.UP, Math.atan2(-car.dz, car.dx));
      this.qPitch.setFromAxisAngle(this.SIDE, Math.atan((front - back) / length));
      this.q.multiply(this.qPitch);
      pos.set(car.x, (front + back) / 2 + 0.05, car.z);
      this.m.compose(pos, this.q, scale.set(length, height, width));
      for (const mesh of [set.paint, set.glass, set.dark]) mesh.setMatrixAt(set.n, this.m);
      set.paint.setColorAt(set.n, this.colour.set(car.colour));
      set.n++;
    }
    const commit = (mesh: THREE.InstancedMesh, count: number) => {
      mesh.count = count;
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    };
    for (const set of all) for (const mesh of [set.paint, set.glass, set.dark]) commit(mesh, set.n);
    commit(this.tails, lights);
    commit(this.heads, lights);
    commit(this.blinkers, blinks);
    commit(this.tops, tops);
    commit(this.beams, beams);
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
