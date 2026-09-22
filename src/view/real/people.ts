// People on the pavements: a few dozen Quaternius characters (CC0, `public/models/people`) walking the kerb
// lanes' pavements near the camera, at their own paces, and now and then one standing about or waving. When
// the camera moves on, whoever is left far behind is put down again somewhere ahead. Each walker is a skinned
// mesh with its own animation mixer; they are few, so that costs nothing worth counting.

import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import * as SkeletonUtils from 'three/examples/jsm/utils/SkeletonUtils.js';
import type { City } from '../../city/build';
import { along, type Lane, type Network } from '../../city/network';
import { SIZE } from '../../city/osm';
import type { Heightfield } from '../../city/terrain';

const OUTFITS = ['male_Casual_2', 'male_Suit', 'male_Beach', 'male_Farmer', 'male_Casual_Hoodie', 'female_Casual', 'female_Formal', 'female_Suit', 'female_Adventurer', 'female_Worker'];
const COUNT = 28;
/** Beyond this from the camera a walker is put down again nearer; within this they are placed. */
const FAR = 170;
const NEAR = 130;
const ROAD = 1;

interface Walker {
  root: THREE.Object3D;
  mixer: THREE.AnimationMixer;
  clips: Record<'walk' | 'idle' | 'wave', THREE.AnimationAction>;
  lane: Lane | null;
  /** Metres along the lane, and which way (+1 with the lane, -1 against it). */
  s: number;
  dir: 1 | -1;
  speed: number;
  /** How far into the pavement, from the kerb. */
  inset: number;
  /** Standing still until then (seconds of the walker's clock), or 0. */
  idleUntil: number;
  clock: number;
  side: number;
}

/** From the middle of a kerb lane to the kerb on its right. */
function toKerb(lane: Lane): number {
  const fromCentre = lane.road.oneway ? ((lane.count - 1) / 2) * lane.spacing : lane.count === 1 ? 1.7 : (lane.count - 1) * lane.spacing + lane.spacing / 2;
  return Math.max(1.2, lane.road.width / 2 - fromCentre);
}

export class People {
  readonly group = new THREE.Group();
  private walkers: Walker[] = [];
  private readonly kerbLanes: Lane[];
  private disposed = false;
  private readonly kind: (x: number, z: number) => number;

  constructor(
    net: Network,
    city: City,
    private readonly terrain: Heightfield,
  ) {
    this.kerbLanes = net.lanes.filter((l) => l.index === 0 && l.road.rank >= 1 && l.length > 20 && !l.source && !l.sink);
    this.kind = (x, z) => (x < 2 || z < 2 || x >= SIZE - 2 || z >= SIZE - 2 ? -1 : city.ground[Math.floor(z) * SIZE + Math.floor(x)]);
    const loader = new GLTFLoader();
    void Promise.all(OUTFITS.map((name) => loader.loadAsync(`${import.meta.env.BASE_URL}models/people/${name}.glb`).catch(() => null))).then((loaded) => {
      if (this.disposed) return;
      const outfits = loaded.filter((g): g is NonNullable<typeof g> => Boolean(g));
      if (!outfits.length) return;
      for (let i = 0; i < COUNT; i++) {
        const gltf = outfits[i % outfits.length];
        const root = SkeletonUtils.clone(gltf.scene);
        // Small, and many draw calls each: no shadow of their own, and not drawn when out of shot.
        root.traverse((o) => {
          if (o instanceof THREE.Mesh) {
            o.castShadow = false;
            o.receiveShadow = true;
            o.frustumCulled = true;
            if (o instanceof THREE.SkinnedMesh) o.computeBoundingSphere();
          }
        });
        // The pack is two metres tall; people are not.
        root.scale.setScalar(0.82 + Math.random() * 0.1);
        const mixer = new THREE.AnimationMixer(root);
        const clip = (name: string) => {
          const found = gltf.animations.find((a) => a.name === name) ?? gltf.animations[0];
          return mixer.clipAction(found);
        };
        const clips = { walk: clip('Walk'), idle: clip('Idle_Neutral'), wave: clip('Wave') };
        clips.walk.play();
        this.group.add(root);
        this.walkers.push({ root, mixer, clips, lane: null, s: 0, dir: 1, speed: 1.0 + Math.random() * 0.5, inset: 0, idleUntil: 0, clock: Math.random() * 10, side: 1 });
      }
    });
  }

  /** A pavement spot to the right of a lane at `s`: past the kerb, on ground that is not road, house or water. */
  private spot(lane: Lane, s: number, inset: number): { x: number; z: number; dx: number; dz: number } | null {
    const p = along(lane, s);
    const d = toKerb(lane) + inset;
    const [x, z] = [p.x - p.dz * d, p.z + p.dx * d];
    const here = this.kind(x, z);
    if (here === -1 || here === ROAD || here === 3 || here === 5 || here === 6) return null;
    return { x, z, dx: p.dx, dz: p.dz };
  }

  /** Put a walker down on a pavement within reach of the camera, facing one way or the other. */
  private place(w: Walker, eye: THREE.Vector3) {
    for (let attempt = 0; attempt < 12; attempt++) {
      const lane = this.kerbLanes[Math.floor(Math.random() * this.kerbLanes.length)];
      if (!lane) return;
      const s = 6 + Math.random() * (lane.length - 12);
      const p = along(lane, s);
      const d = Math.hypot(p.x - eye.x, p.z - eye.z);
      if (d > NEAR || d < 12) continue;
      const inset = 1.2 + Math.random() * 1.6;
      const at = this.spot(lane, s, inset);
      if (!at) continue;
      w.lane = lane;
      w.s = s;
      w.dir = Math.random() < 0.5 ? 1 : -1;
      w.inset = inset;
      w.idleUntil = 0;
      w.root.position.set(at.x, this.terrain.at(at.x, at.z), at.z);
      w.root.visible = true;
      return;
    }
    w.root.visible = false;
    w.lane = null;
  }

  update(dt: number, eye: THREE.Vector3) {
    for (const w of this.walkers) {
      w.clock += dt;
      if (!w.lane || Math.hypot(w.root.position.x - eye.x, w.root.position.z - eye.z) > FAR) {
        this.place(w, eye);
        if (!w.lane) continue;
      }
      // Standing about: a pause now and then, once in a while a wave at the taxi.
      if (w.idleUntil > w.clock) {
        w.mixer.update(dt);
        continue;
      }
      if (w.idleUntil > 0) {
        w.idleUntil = 0;
        w.clips.idle.fadeOut(0.3);
        w.clips.wave.fadeOut(0.3);
        w.clips.walk.reset().fadeIn(0.3).play();
      } else if (Math.random() < dt * 0.02) {
        w.idleUntil = w.clock + 2 + Math.random() * 5;
        const wave = Math.random() < 0.25;
        w.clips.walk.fadeOut(0.3);
        (wave ? w.clips.wave : w.clips.idle).reset().fadeIn(0.3).play();
      }
      w.s += w.dir * w.speed * dt;
      const lane = w.lane;
      // Turn round at the ends of the street, or walk back when the pavement runs out.
      const ahead = this.spot(lane, w.s + w.dir * 1.5, w.inset);
      if (w.s < 4 || w.s > lane.length - 4 || !ahead) {
        w.dir = w.dir === 1 ? -1 : 1;
        w.s = Math.min(lane.length - 4, Math.max(4, w.s));
      }
      const at = this.spot(lane, w.s, w.inset);
      if (!at) {
        this.place(w, eye);
        continue;
      }
      w.root.position.set(at.x, this.terrain.at(at.x, at.z), at.z);
      // The pack faces +z; the way they walk is the lane's heading, or the opposite.
      w.root.rotation.y = Math.atan2(at.dx * w.dir, at.dz * w.dir);
      w.clips.walk.timeScale = w.speed / 1.25;
      w.mixer.update(dt);
    }
  }

  get count(): number {
    return this.walkers.filter((w) => w.lane && w.root.visible).length;
  }

  dispose() {
    this.disposed = true;
    for (const w of this.walkers) {
      w.mixer.stopAllAction();
      w.root.traverse((o) => {
        if (o instanceof THREE.Mesh) o.geometry.dispose();
      });
    }
    this.walkers = [];
  }
}
