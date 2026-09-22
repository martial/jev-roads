// Everything you see: the voxel city, the cars, the lamps, and the two cameras: one high above
// the streets, one behind the windscreen of a car that drives itself.

import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { ROAD_Y, setNight, type City } from '../city/build';
import { SIZE } from '../city/osm';
import { Sky, type TimeOfDay, type Weather } from '../engine/sky';
import { MeshPool } from '../engine/meshPool';
import { CHUNK, CHUNKS_X, CHUNKS_Z, type ChunkArrays, type MeshArrays } from '../engine/voxels';
import type { Car, Traffic } from '../sim/cars';
import type { CityMap } from '../city/osm';
import type { CityView, Hotspot, PlaceData } from './types';

const MAX_CARS = 1100;
const LABELS = 14;
const GLASS = new THREE.Color('#1c2733');
const UNDER = new THREE.Color('#141518');

export type Mode = 'ride' | 'above';

interface ChunkMeshes {
  solid: THREE.Mesh | null;
  glow: THREE.Mesh | null;
  liquid: THREE.Mesh | null;
}

export class View implements CityView {
  mode: Mode = 'above';
  riding: Car | null = null;
  /** Called when the person clicks a car from above. */
  onPick: (car: Car) => void = () => {};
  /** The blocks look has no cabin to touch: a tap is a tap on nothing in particular. */
  onTap: (what: Hotspot | '') => void = () => {};
  /** 0..1 while the city is still being meshed. */
  progress = 0;

  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(62, 1, 0.08, 3200);
  private readonly composer: EffectComposer;
  private readonly bloom: UnrealBloomPass;
  private readonly sky: Sky;
  private readonly solidMaterial = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.94, metalness: 0 });
  private readonly glowMaterial = new THREE.MeshBasicMaterial({ vertexColors: true });
  private readonly liquidMaterial = new THREE.MeshStandardMaterial({ vertexColors: true, transparent: true, opacity: 0.78, roughness: 0.1, metalness: 0 });
  private readonly apron: THREE.Mesh;

  private city: City | null = null;
  private traffic: Traffic | null = null;
  private chunks: ChunkMeshes[] = [];
  /** Chunks waiting to be meshed, nearest the point of interest first; `grow` ones rise out of the ground. */
  private queue: Array<{ index: number; grow: boolean }> = [];
  private readonly queued = new Map<number, boolean>();
  private readonly pool = new MeshPool();
  /** New pieces of city growing up through the old ones, which stay until the new stand. */
  private rising: Array<{ meshes: THREE.Mesh[]; old: THREE.Mesh[]; t: number }> = [];
  private generation = 0;
  private outstanding = 0;

  private readonly bodies: THREE.InstancedMesh;
  private readonly cabins: THREE.InstancedMesh;
  private readonly unders: THREE.InstancedMesh;
  private readonly tails: THREE.InstancedMesh;
  private readonly heads: THREE.InstancedMesh;
  private readonly blinkers: THREE.InstancedMesh;
  private readonly roofs: THREE.InstancedMesh;
  private readonly beams: THREE.InstancedMesh;
  private housings: THREE.InstancedMesh | null = null;
  private lamps: THREE.InstancedMesh | null = null;
  private readonly cockpit = new THREE.Group();
  private readonly hood: THREE.Mesh<THREE.BoxGeometry, THREE.MeshStandardMaterial>;
  private readonly wheel = new THREE.Group();
  /** Real light from the headlights of the car you ride in; every other car makes do with a glow. */
  private readonly headlamp = new THREE.SpotLight('#ffe6b8', 0, 80, 0.55, 0.8, 1.5);

  private readonly labels: HTMLDivElement[] = [];
  private readonly orbit = { yaw: -0.6, pitch: 0.66, distance: 360, target: new THREE.Vector3(SIZE / 2, 2, SIZE / 2) };
  private readonly look = { yaw: 0, pitch: 0, idle: 9 };
  private readonly eye = new THREE.Vector3(SIZE / 2, 260, SIZE / 2 + 340);
  private readonly aim = new THREE.Vector3(SIZE / 2, 0, SIZE / 2);
  private blend = 0;
  private steer = 0;
  private lastHeading = 0;
  private drag: { x: number; y: number; moved: number } | null = null;
  private night = false;
  private readonly m = new THREE.Matrix4();
  private readonly q = new THREE.Quaternion();
  private readonly color = new THREE.Color();
  private readonly UP = new THREE.Vector3(0, 1, 0);

  constructor(
    private readonly canvas: HTMLCanvasElement,
    labelLayer: HTMLElement,
  ) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.75));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 0.92;
    this.sky = new Sky(this.scene);

    // The map stops at its edge; the ground does not. It is a frame round the map, not a sheet under it:
    // two surfaces a few centimetres apart flicker when seen from a kilometre up.
    const frame = new THREE.Shape([new THREE.Vector2(-4000, -4000), new THREE.Vector2(4000 + SIZE, -4000), new THREE.Vector2(4000 + SIZE, 4000 + SIZE), new THREE.Vector2(-4000, 4000 + SIZE)]);
    frame.holes.push(new THREE.Path([new THREE.Vector2(1, 1), new THREE.Vector2(1, SIZE - 1), new THREE.Vector2(SIZE - 1, SIZE - 1), new THREE.Vector2(SIZE - 1, 1)]));
    this.apron = new THREE.Mesh(new THREE.ShapeGeometry(frame), new THREE.MeshStandardMaterial({ color: '#b3a78c', roughness: 1, side: THREE.DoubleSide }));
    // Shapes are drawn in x/y; lay this one down so that its y becomes the world's z.
    this.apron.rotation.x = Math.PI / 2;
    this.apron.position.set(0, ROAD_Y + 0.2, 0);
    this.apron.receiveShadow = true;
    this.scene.add(this.apron);

    const box = new THREE.BoxGeometry(1, 1, 1);
    const paint = () => new THREE.MeshStandardMaterial({ roughness: 0.55, metalness: 0.1 });
    const make = (material: THREE.Material, count = MAX_CARS, shadow = true) => {
      const mesh = new THREE.InstancedMesh(box, material, count);
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      mesh.setColorAt(0, this.color.set('#ffffff'));
      mesh.instanceColor!.setUsage(THREE.DynamicDrawUsage);
      mesh.castShadow = shadow;
      mesh.receiveShadow = shadow;
      mesh.frustumCulled = false;
      mesh.count = 0;
      this.scene.add(mesh);
      return mesh;
    };
    this.bodies = make(paint());
    this.cabins = make(paint());
    this.unders = make(new THREE.MeshStandardMaterial({ roughness: 0.9 }));
    this.tails = make(new THREE.MeshBasicMaterial(), MAX_CARS * 2, false);
    this.heads = make(new THREE.MeshBasicMaterial(), MAX_CARS * 2, false);
    this.blinkers = make(new THREE.MeshBasicMaterial(), MAX_CARS * 2, false);
    this.roofs = make(new THREE.MeshBasicMaterial(), MAX_CARS, false);
    // Headlight pools on the tarmac at night.
    this.beams = make(new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.16, depthWrite: false, blending: THREE.AdditiveBlending }), MAX_CARS, false);

    // The inside of the car you ride in: just enough to feel the windscreen around you.
    const dark = new THREE.MeshStandardMaterial({ color: '#15171b', roughness: 0.8 });
    const trim = new THREE.MeshStandardMaterial({ color: '#2a2d33', roughness: 0.7 });
    const part = (w: number, h: number, d: number, x: number, y: number, z: number, material: THREE.Material = dark) => {
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material);
      mesh.position.set(x, y, z);
      this.cockpit.add(mesh);
      return mesh;
    };
    // Local axes: +x forward, +z to the driver's right.
    part(0.5, 0.26, 1.62, 1.0, 0.7, 0);
    part(0.16, 0.05, 1.5, 0.84, 0.84, 0, trim);
    this.hood = part(1.25, 0.1, 1.66, 1.9, 0.68, 0, new THREE.MeshStandardMaterial({ color: '#f4f1e6', roughness: 0.5, metalness: 0.1 })) as typeof this.hood;
    for (const side of [-1, 1]) {
      const pillar = part(0.05, 0.95, 0.06, 0.92, 1.22, side * 0.85);
      pillar.rotation.z = 0.55;
      part(2.6, 0.56, 0.06, -0.2, 0.58, side * 0.87);
      part(0.07, 0.8, 0.06, -0.6, 1.26, side * 0.87);
    }
    part(1.9, 0.06, 1.74, -0.4, 1.68, 0);
    part(0.04, 0.06, 0.2, 0.6, 1.56, 0, trim);
    part(0.5, 0.55, 1.5, -1.3, 0.66, 0, trim);
    this.wheel.position.set(0.66, 0.84, -0.36);
    this.wheel.rotation.z = -0.5;
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2;
      const rim = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.04, 0.09), trim);
      rim.position.set(0, Math.cos(a) * 0.16, Math.sin(a) * 0.16);
      rim.rotation.x = a;
      this.wheel.add(rim);
    }
    const hub = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.04, 0.3), trim);
    this.wheel.add(hub);
    this.cockpit.add(this.wheel);
    this.cockpit.visible = false;
    this.scene.add(this.cockpit);
    this.scene.add(this.headlamp, this.headlamp.target);

    this.composer = new EffectComposer(this.renderer);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    this.bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), 0.3, 0.75, 2.2);
    this.composer.addPass(this.bloom);
    this.composer.addPass(new OutputPass());

    for (let i = 0; i < LABELS; i++) {
      const el = document.createElement('div');
      el.className = 'bubble';
      labelLayer.appendChild(el);
      this.labels.push(el);
    }

    canvas.addEventListener('pointerdown', this.down);
    window.addEventListener('pointermove', this.move);
    window.addEventListener('pointerup', this.up);
    canvas.addEventListener('wheel', this.zoom, { passive: false });
    this.resize();
  }

  // --- The city ---------------------------------------------------------------------------------------

  setPlace(data: PlaceData) {
    this.setCity(data.city, data.traffic);
  }

  /** The builder has just written this part of town into the blocks: mesh what changed, and let it rise. */
  addScenery(_scenery: CityMap, city: City) {
    this.grow(city.voxels.dirty);
  }

  setCity(city: City, traffic: Traffic) {
    this.clearCity();
    this.city = city;
    this.traffic = traffic;
    this.chunks = Array.from({ length: CHUNKS_X * CHUNKS_Z }, () => ({ solid: null, glow: null, liquid: null }));
    this.generation++;
    this.queue = [];
    this.queued.clear();
    this.rising = [];
    city.voxels.dirty.clear();
    this.grow(Array.from({ length: CHUNKS_X * CHUNKS_Z }, (_, i) => i));
    if (this.night) setNight(city, true);

    const n = city.heads.length;
    const housing = new THREE.InstancedMesh(new THREE.BoxGeometry(0.5, 1.5, 0.5), new THREE.MeshStandardMaterial({ color: '#16181c', roughness: 0.7 }), Math.max(1, n));
    const lamps = new THREE.InstancedMesh(new THREE.BoxGeometry(0.34, 0.34, 0.12), new THREE.MeshBasicMaterial(), Math.max(1, n * 3));
    city.heads.forEach((head, i) => {
      this.q.setFromAxisAngle(this.UP, Math.atan2(head.fx, head.fz));
      housing.setMatrixAt(i, this.m.compose(new THREE.Vector3(head.x, head.y, head.z), this.q, new THREE.Vector3(1, 1, 1)));
      for (let k = 0; k < 3; k++) {
        lamps.setMatrixAt(i * 3 + k, this.m.compose(new THREE.Vector3(head.x + head.fx * 0.27, head.y + 0.48 - k * 0.48, head.z + head.fz * 0.27), this.q, new THREE.Vector3(1, 1, 1)));
        lamps.setColorAt(i * 3 + k, this.color.set('#111111'));
      }
    });
    housing.count = n;
    lamps.count = n * 3;
    housing.castShadow = true;
    lamps.frustumCulled = housing.frustumCulled = false;
    this.housings = housing;
    this.lamps = lamps;
    this.scene.add(housing, lamps);
    this.orbit.target.set(SIZE / 2, 2, SIZE / 2);
  }

  private clearCity() {
    for (const chunk of this.chunks)
      for (const mesh of [chunk.solid, chunk.glow, chunk.liquid])
        if (mesh) {
          this.scene.remove(mesh);
          mesh.geometry.dispose();
        }
    for (const rise of this.rising) this.discard(rise.old);
    this.rising = [];
    this.chunks = [];
    for (const mesh of [this.housings, this.lamps])
      if (mesh) {
        this.scene.remove(mesh);
        mesh.geometry.dispose();
        (mesh.material as THREE.Material).dispose();
      }
    this.housings = this.lamps = null;
  }

  /** Chunks whose blocks have just been built: mesh them, and let what is new rise out of the ground. */
  grow(indices: Iterable<number>) {
    for (const index of indices) this.enqueue(index, true);
    this.city?.voxels.dirty.clear();
    this.sortQueue();
  }

  private enqueue(index: number, grow: boolean) {
    const had = this.queued.get(index);
    if (had !== undefined) {
      if (grow && !had) {
        this.queued.set(index, true);
        const entry = this.queue.find((q) => q.index === index);
        if (entry) entry.grow = true;
      }
      return;
    }
    this.queued.set(index, grow);
    this.queue.push({ index, grow });
  }

  /** Nearest first: around the car being ridden, or the middle of the map. */
  private sortQueue() {
    const fx = (this.riding?.x ?? this.orbit.target.x) / CHUNK;
    const fz = (this.riding?.z ?? this.orbit.target.z) / CHUNK;
    const d = (i: number) => Math.hypot((i % CHUNKS_X) + 0.5 - fx, Math.floor(i / CHUNKS_X) + 0.5 - fz);
    this.queue.sort((a, b) => d(a.index) - d(b.index));
  }

  /** Hand waiting chunks to idle workers. Several are meshed at once; the page only uploads the result. */
  private pump() {
    const city = this.city;
    if (!city) return;
    while (this.queue.length && this.pool.free > 0 && this.outstanding < Math.max(1, this.pool.size) * 2) {
      const { index, grow } = this.queue.shift()!;
      this.queued.delete(index);
      const generation = this.generation;
      this.outstanding++;
      void this.pool.mesh(city.voxels, index % CHUNKS_X, Math.floor(index / CHUNKS_X)).then((arrays) => {
        this.outstanding--;
        if (generation === this.generation) this.apply(index, arrays, grow);
      });
    }
  }

  private apply(index: number, arrays: ChunkArrays, grow: boolean) {
    const chunk = this.chunks[index];
    if (!chunk) return;
    const geometry = (m: MeshArrays | null) => {
      if (!m) return null;
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(m.positions, 3));
      g.setAttribute('normal', new THREE.BufferAttribute(m.normals, 3));
      g.setAttribute('color', new THREE.BufferAttribute(m.colors, 3));
      g.setIndex(new THREE.BufferAttribute(m.indices, 1));
      g.computeBoundingSphere();
      return g;
    };
    const old: THREE.Mesh[] = [];
    const fresh: THREE.Mesh[] = [];
    const swap = (key: keyof ChunkMeshes, g: THREE.BufferGeometry | null, material: THREE.Material, shadows: boolean) => {
      if (chunk[key]) old.push(chunk[key]!);
      chunk[key] = null;
      if (!g) return;
      const mesh = new THREE.Mesh(g, material);
      mesh.castShadow = shadows;
      mesh.receiveShadow = shadows;
      this.scene.add(mesh);
      chunk[key] = mesh;
      fresh.push(mesh);
    };
    swap('solid', geometry(arrays.solid), this.solidMaterial, true);
    swap('glow', geometry(arrays.glow), this.glowMaterial, false);
    swap('liquid', geometry(arrays.liquid), this.liquidMaterial, false);
    // A chunk still rising when its next version arrives: finish the old rise at once.
    for (const rise of this.rising) if (rise.meshes.some((m) => old.includes(m))) rise.t = 1;
    if (grow && fresh.length) {
      // The new piece grows up through the old one, which stays put until the new one stands.
      for (const mesh of fresh) mesh.scale.y = 0.015;
      this.rising.push({ meshes: fresh, old, t: 0 });
    } else this.discard(old);
  }

  private discard(meshes: THREE.Mesh[]) {
    for (const mesh of meshes) {
      this.scene.remove(mesh);
      mesh.geometry.dispose();
    }
  }

  setSky(time: TimeOfDay, weather: Weather) {
    this.sky.set(time, weather);
    const night = time === 'night' || time === 'dusk';
    if (night !== this.night && this.city) {
      setNight(this.city, night);
    }
    this.night = night;
  }

  // --- Cameras ------------------------------------------------------------------------------------------

  ride(car: Car | null) {
    this.riding = car;
    this.look.yaw = this.look.pitch = 0;
    if (car) {
      this.lastHeading = Math.atan2(-car.dz, car.dx);
      this.hood.material.color.set(car.driver.color);
    }
  }

  private readonly down = (e: PointerEvent) => {
    this.drag = { x: e.clientX, y: e.clientY, moved: 0 };
  };

  private readonly move = (e: PointerEvent) => {
    if (!this.drag) return;
    const dx = e.clientX - this.drag.x;
    const dy = e.clientY - this.drag.y;
    this.drag.x = e.clientX;
    this.drag.y = e.clientY;
    this.drag.moved += Math.abs(dx) + Math.abs(dy);
    if (this.mode === 'ride') {
      // The head follows the hand.
      this.look.yaw = THREE.MathUtils.clamp(this.look.yaw + dx * 0.004, -2.4, 2.4);
      this.look.pitch = THREE.MathUtils.clamp(this.look.pitch + dy * 0.003, -0.5, 0.45);
      this.look.idle = 0;
    } else {
      this.orbit.yaw -= dx * 0.005;
      this.orbit.pitch = THREE.MathUtils.clamp(this.orbit.pitch + dy * 0.004, 0.16, 1.45);
    }
  };

  private readonly up = (e: PointerEvent) => {
    const drag = this.drag;
    this.drag = null;
    if (!drag || drag.moved > 5 || e.target !== this.canvas) return;
    if (this.mode === 'ride') return void this.onTap('');
    if (this.mode !== 'above' || !this.traffic) return;
    // A click, not a drag: is there a car under it?
    const rect = this.canvas.getBoundingClientRect();
    let best: Car | null = null;
    let bestD = 34;
    const p = new THREE.Vector3();
    for (const car of this.traffic.cars) {
      p.set(car.x, ROAD_Y + 1, car.z).project(this.camera);
      if (p.z > 1) continue;
      const d = Math.hypot(((p.x + 1) / 2) * rect.width - (e.clientX - rect.left), ((1 - p.y) / 2) * rect.height - (e.clientY - rect.top));
      if (d < bestD) {
        best = car;
        bestD = d;
      }
    }
    if (best) this.onPick(best);
  };

  private readonly zoom = (e: WheelEvent) => {
    e.preventDefault();
    if (this.mode === 'above') this.orbit.distance = THREE.MathUtils.clamp(this.orbit.distance * Math.exp(e.deltaY * 0.0012), 24, 1200);
  };

  resize() {
    const w = this.canvas.clientWidth || window.innerWidth;
    const h = this.canvas.clientHeight || window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.composer.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  // --- A frame ----------------------------------------------------------------------------------------

  frame(dt: number) {
    // A few chunks per frame, so the page never freezes while a city is built.
    // Blocks changed since the last frame (windows lit at night, say) are remeshed in place.
    if (this.city?.voxels.dirty.size) {
      for (const index of this.city.voxels.dirty) this.enqueue(index, false);
      this.city.voxels.dirty.clear();
    }
    this.pump();
    for (const rise of this.rising) {
      rise.t = Math.min(1, rise.t + dt / 1.1);
      const y = 1 - (1 - rise.t) ** 3;
      for (const mesh of rise.meshes) mesh.scale.y = Math.max(0.015, y);
      if (rise.t >= 1) this.discard(rise.old);
    }
    this.rising = this.rising.filter((r) => r.t < 1);
    this.progress = this.queue.length || this.outstanding || this.rising.length ? 0.5 : 1;

    const traffic = this.traffic;
    const riding = this.riding && traffic?.cars.includes(this.riding) ? this.riding : null;
    const inside = this.mode === 'ride' && riding !== null;
    this.blend += ((inside ? 1 : 0) - this.blend) * (1 - Math.exp(-dt * 3.2));
    const k = 1 - Math.exp(-dt * 6);

    // Above: orbit the car being followed, or the middle of the map.
    const o = this.orbit;
    if (riding) o.target.lerp(new THREE.Vector3(riding.x, 2, riding.z), 1 - Math.exp(-dt * 2.5));
    const aboveEye = new THREE.Vector3(o.target.x + Math.cos(o.pitch) * Math.sin(o.yaw) * o.distance, o.target.y + Math.sin(o.pitch) * o.distance, o.target.z + Math.cos(o.pitch) * Math.cos(o.yaw) * o.distance);

    if (riding) {
      const heading = Math.atan2(-riding.dz, riding.dx);
      let turn = heading - this.lastHeading;
      turn = Math.atan2(Math.sin(turn), Math.cos(turn));
      this.lastHeading = heading;
      this.steer += (THREE.MathUtils.clamp((turn / Math.max(dt, 1e-3)) * 1.6, -1.6, 1.6) - this.steer) * (1 - Math.exp(-dt * 5));
      this.wheel.rotation.x = -this.steer * 1.4;
      this.cockpit.position.set(riding.x, ROAD_Y + 0.02, riding.z);
      this.cockpit.rotation.y = heading;
      // The front passenger seat: right of centre, eyes 1.2 m up. Let go of the mouse and the gaze drifts back to the road.
      this.look.idle += dt;
      if (this.look.idle > 2.2 && !this.drag) {
        this.look.yaw *= Math.exp(-dt * 2);
        this.look.pitch *= Math.exp(-dt * 2);
      }
      const seat = new THREE.Vector3(riding.x + riding.dx * 0.12 - riding.dz * 0.36, ROAD_Y + 1.27, riding.z + riding.dz * 0.12 + riding.dx * 0.36);
      const yaw = heading + this.look.yaw - this.steer * 0.18;
      const rideAim = new THREE.Vector3(seat.x + Math.cos(yaw) * Math.cos(this.look.pitch) * 10, seat.y + Math.sin(this.look.pitch) * 10 - 0.5, seat.z - Math.sin(yaw) * Math.cos(this.look.pitch) * 10);
      const e = this.blend > 0.97 ? 1 : this.blend * this.blend * (3 - 2 * this.blend);
      this.eye.lerpVectors(aboveEye, seat, e);
      this.aim.lerpVectors(o.target, rideAim, e);
    } else {
      this.eye.lerp(aboveEye, k);
      this.aim.lerp(o.target, k);
    }
    this.camera.position.copy(this.eye);
    this.camera.lookAt(this.aim);
    const wantFov = inside ? 74 : 50;
    // From high up the near plane moves out with the camera: depth precision is spent where the city is.
    const height = Math.max(0, this.camera.position.y - 60);
    const wantNear = this.blend > 0.6 ? 0.08 : Math.max(0.08, Math.min(30, height * 0.06));
    if (Math.abs(this.camera.fov - wantFov) > 0.05 || Math.abs(this.camera.near - wantNear) > wantNear * 0.1) {
      this.camera.fov += (wantFov - this.camera.fov) * k;
      this.camera.near = wantNear;
      this.camera.updateProjectionMatrix();
    }
    this.cockpit.visible = this.blend > 0.9;
    if (riding) {
      const nose = riding.driver.body.length / 2 + 0.4;
      this.headlamp.position.set(riding.x + riding.dx * nose, ROAD_Y + 0.75, riding.z + riding.dz * nose);
      this.headlamp.target.position.set(riding.x + riding.dx * 40, ROAD_Y - 0.5, riding.z + riding.dz * 40);
    }
    this.headlamp.intensity += ((riding && this.night ? 38 : 0) - this.headlamp.intensity) * k;

    if (traffic) this.drawCars(traffic, riding);
    this.drawSignals(traffic);
    this.drawLabels(traffic, riding);

    const time = this.sky.current.time;
    const wet = this.sky.current.weather === 'rain';
    this.solidMaterial.roughness += ((wet ? 0.5 : 0.94) - this.solidMaterial.roughness) * (1 - Math.exp(-dt));
    const focus = riding && this.blend > 0.5 ? new THREE.Vector3(riding.x, 1, riding.z) : o.target;
    this.sky.update(dt, this.camera.position, focus, this.blend > 0.5 ? 70 : Math.max(90, o.distance * 0.75), 1 - this.blend);
    const glow = time === 'night' ? 0.85 : time === 'dusk' ? 0.6 : 0.22;
    this.bloom.strength += (glow - this.bloom.strength) * (1 - Math.exp(-dt));
    this.bloom.threshold += ((time === 'night' ? 0.95 : time === 'dusk' ? 1.25 : 2.3) - this.bloom.threshold) * (1 - Math.exp(-dt));
    (this.apron.material as THREE.MeshStandardMaterial).color.set(time === 'night' ? '#6c6a66' : '#b3a78c');
    this.composer.render(dt);
  }

  private drawCars(traffic: Traffic, riding: Car | null) {
    const night = this.night;
    const blinkOn = Math.floor(performance.now() / 380) % 2 === 0;
    const flash = Math.floor(performance.now() / 140) % 2 === 0;
    const pos = new THREE.Vector3();
    const scale = new THREE.Vector3();
    let n = 0;
    let lights = 0;
    let blink = 0;
    let roofsN = 0;
    let beamsN = 0;
    const put = (mesh: THREE.InstancedMesh, index: number, car: Car, fx: number, y: number, rz: number, sx: number, sy: number, sz: number) => {
      // fx metres forward of the car's centre, rz metres to its right.
      pos.set(car.x + car.dx * fx - car.dz * rz, ROAD_Y + y, car.z + car.dz * fx + car.dx * rz);
      mesh.setMatrixAt(index, this.m.compose(pos, this.q, scale.set(sx, sy, sz)));
    };
    for (const car of traffic.cars) {
      if (n >= MAX_CARS) break;
      // From the driver's seat you see the cockpit instead of your own bodywork.
      if (car === riding && this.blend > 0.9) {
        if (night) {
          this.q.setFromAxisAngle(this.UP, Math.atan2(-car.dz, car.dx));
          put(this.beams, beamsN, car, car.driver.body.length / 2 + 6, 0.03, 0, 11, 0.02, car.driver.body.width * 1.6);
          this.beams.setColorAt(beamsN++, this.color.set('#ffe9b0'));
        }
        continue;
      }
      const b = car.driver.body;
      this.q.setFromAxisAngle(this.UP, Math.atan2(-car.dz, car.dx));
      const tall = b.kind === 'van' || b.kind === 'bus' || b.kind === 'truck' || b.kind === 'ambulance';
      const lower = tall ? b.height * 0.5 : b.height * 0.56;
      put(this.unders, n, car, 0, 0.2, 0, b.length * 0.86, 0.4, b.width * 0.94);
      this.unders.setColorAt(n, UNDER);
      put(this.bodies, n, car, 0, 0.28 + lower / 2, 0, b.length, lower, b.width);
      this.bodies.setColorAt(n, this.color.set(car.driver.color));
      const top = b.height - lower - 0.1;
      if (b.kind === 'truck') put(this.cabins, n, car, -b.length * 0.12, 0.28 + lower + top / 2, 0, b.length * 0.74, top, b.width * 0.98);
      else if (tall) put(this.cabins, n, car, -b.length * 0.04, 0.28 + lower + top / 2, 0, b.length * 0.9, top, b.width * 0.94);
      else put(this.cabins, n, car, -b.length * 0.06, 0.28 + lower + top / 2, 0, b.length * 0.52, top, b.width * 0.86);
      this.cabins.setColorAt(n, b.kind === 'bus' || !tall ? GLASS : this.color.set(car.driver.color).multiplyScalar(b.kind === 'truck' ? 0.92 : 1.04));
      n++;

      const hazard = car.brokenUntil > traffic.time;
      for (const side of [-1, 1]) {
        put(this.tails, lights, car, -b.length / 2 - 0.02, 0.28 + lower * 0.62, side * b.width * 0.34, 0.08, 0.16, 0.34);
        this.tails.setColorAt(lights, this.color.set('#ff2a1e').multiplyScalar(car.braking ? 3.2 : night ? 1.1 : 0.45));
        put(this.heads, lights, car, b.length / 2 + 0.02, 0.28 + lower * 0.55, side * b.width * 0.34, 0.08, 0.16, 0.32);
        this.heads.setColorAt(lights, this.color.set('#fff2cf').multiplyScalar(night ? 3.4 : car.courtesyUntil > traffic.time && flash ? 3.2 : 0.85));
        lights++;
        if ((hazard || car.indicator === side) && blinkOn) {
          put(this.blinkers, blink, car, b.length / 2 - 0.1, 0.28 + lower * 0.55, side * (b.width / 2 + 0.01), 0.3, 0.16, 0.08);
          this.blinkers.setColorAt(blink++, this.color.set('#ffa01e').multiplyScalar(3));
          put(this.blinkers, blink, car, -b.length / 2 + 0.1, 0.28 + lower * 0.62, side * (b.width / 2 + 0.01), 0.3, 0.16, 0.08);
          this.blinkers.setColorAt(blink++, this.color.set('#ffa01e').multiplyScalar(3));
        }
      }
      if (b.kind === 'taxi' || b.kind === 'ambulance') {
        put(this.roofs, roofsN, car, b.kind === 'taxi' ? -0.2 : b.length * 0.3, b.height + 0.32, 0, b.kind === 'taxi' ? 0.3 : 0.4, 0.2, b.kind === 'taxi' ? 0.6 : 1.4);
        this.roofs.setColorAt(roofsN++, b.kind === 'taxi' ? this.color.set('#ffd23c').multiplyScalar(night ? 2.6 : 1.2) : this.color.set(flash ? '#2a6bff' : '#ffffff').multiplyScalar(3.4));
      }
      if (night) {
        put(this.beams, beamsN, car, b.length / 2 + 5, 0.03, 0, 9, 0.02, b.width * 1.5);
        this.beams.setColorAt(beamsN++, this.color.set('#ffe9b0'));
      }
    }
    const commit = (mesh: THREE.InstancedMesh, count: number) => {
      mesh.count = count;
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    };
    commit(this.bodies, n);
    commit(this.cabins, n);
    commit(this.unders, n);
    commit(this.tails, lights);
    commit(this.heads, lights);
    commit(this.blinkers, blink);
    commit(this.roofs, roofsN);
    commit(this.beams, beamsN);
  }

  private drawSignals(traffic: Traffic | null) {
    if (!this.city || !this.lamps || !traffic) return;
    this.city.heads.forEach((head, i) => {
      const light = traffic.light(traffic.net.lanes[head.lane]);
      this.lamps!.setColorAt(i * 3, this.color.set('#ff2b1c').multiplyScalar(light === 'red' ? 3.4 : 0.12));
      this.lamps!.setColorAt(i * 3 + 1, this.color.set('#ffae1c').multiplyScalar(light === 'amber' ? 3.4 : 0.12));
      this.lamps!.setColorAt(i * 3 + 2, this.color.set('#2bff7a').multiplyScalar(light === 'green' ? 2.8 : 0.1));
    });
    if (this.lamps.instanceColor) this.lamps.instanceColor.needsUpdate = true;
  }

  /** Words over the cars: what each driver has just decided. */
  private drawLabels(traffic: Traffic | null, riding: Car | null) {
    const w = this.canvas.clientWidth;
    const h = this.canvas.clientHeight;
    const p = new THREE.Vector3();
    let used = 0;
    if (traffic)
      for (const car of traffic.cars) {
        if (used >= LABELS) break;
        if (car.bubbleUntil < traffic.time || (car === riding && this.blend > 0.5)) continue;
        p.set(car.x, ROAD_Y + car.driver.body.height + 1.1, car.z);
        const distance = p.distanceTo(this.camera.position);
        p.project(this.camera);
        if (p.z > 1 || Math.abs(p.x) > 1.05 || Math.abs(p.y) > 1.05 || distance > (this.blend > 0.5 ? 70 : 700)) continue;
        const el = this.labels[used++];
        if (el.textContent !== car.bubble) el.textContent = car.bubble;
        el.style.opacity = String(Math.min(1, (car.bubbleUntil - traffic.time) * 2.5));
        el.style.transform = `translate(-50%, -100%) translate(${((p.x + 1) / 2) * w}px, ${((1 - p.y) / 2) * h}px)`;
      }
    for (let i = used; i < LABELS; i++) this.labels[i].style.opacity = '0';
  }

  /** The spot on the ground the aerial camera circles. */
  get lookingAt(): { x: number; z: number } {
    return { x: this.orbit.target.x, z: this.orbit.target.z };
  }

  /** Where the camera is, for sounds that fade with distance. */
  get ear(): THREE.Vector3 {
    return this.camera.position;
  }

  dispose() {
    this.canvas.removeEventListener('pointerdown', this.down);
    window.removeEventListener('pointermove', this.move);
    window.removeEventListener('pointerup', this.up);
    this.canvas.removeEventListener('wheel', this.zoom);
    this.clearCity();
    for (const el of this.labels) el.remove();
    this.pool.dispose();
    this.sky.dispose();
    this.composer.dispose();
    this.renderer.dispose();
  }
}

export { CHUNK };
