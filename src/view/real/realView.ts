import { isUK } from '../../edition';
// The realistic look. Same town, same traffic, same two cameras as the block look; everything drawn
// as smooth, physically lit surfaces instead of cubes.

import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { GTAOPass } from 'three/examples/jsm/postprocessing/GTAOPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import type { City } from '../../city/build';
import { SIZE, type CityMap } from '../../city/osm';
import { Heightfield } from '../../city/terrain';
import type { TimeOfDay, Weather } from '../../engine/sky';
import type { Car, Traffic } from '../../sim/cars';
import type { CityView, Hotspot, Mode, PlaceData } from '../types';
import { Atmosphere } from './atmosphere';
import { Buildings } from './buildings';
import type { Gags, Talk } from '../../sim/chatter';
import type { RideView } from '../../sim/ride';
import type { Sex } from '../../../shared/driver';
import { Cockpit, type DashLines } from './cockpit';
import { Furniture } from './furniture';
import { Ground } from './ground';
import { Roads } from './roads';
import { makeSurfaces, type Surfaces } from './textures';
import { ToonShader } from './toon';
import { People } from './people';
import { Trees } from './trees';
import { Vehicles } from './vehicles';
import { GoogleWorld } from '../google/GoogleWorld';
import type { CameraShot } from '../../maps/preferences';

const LABELS = 14;

export class RealView implements CityView {
  mode: Mode = 'above';
  riding: Car | null = null;
  onPick: (car: Car) => void = () => {};
  onTap: (what: Hotspot | '') => void = () => {};
  hovering: Hotspot | '' = '';
  private readonly ray = new THREE.Raycaster();
  progress = 0;

  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(55, 1, 0.08, 9000);
  private readonly composer: EffectComposer | null = null;
  private readonly ao: GTAOPass | null = null;
  private readonly bloom: UnrealBloomPass | null = null;
  private readonly toon: ShaderPass | null = null;
  private clock = 0;
  private readonly air: Atmosphere;
  private readonly surfaces: Surfaces = makeSurfaces();
  private readonly vehicles = new Vehicles();
  private readonly cockpit = new Cockpit();
  private readonly headlamp = new THREE.SpotLight('#ffe6b8', 0, 90, 0.5, 0.75, 1.4);

  private ground: Ground | null = null;
  private roads: Roads | null = null;
  private buildings: Buildings | null = null;
  private trees: Trees | null = null;
  private furniture: Furniture | null = null;
  private people: People | null = null;
  private traffic: Traffic | null = null;
  private terrain = new Heightfield(null);

  private readonly labels: HTMLDivElement[] = [];
  private readonly orbit = { yaw: -0.6, pitch: 0.6, distance: 380, target: new THREE.Vector3(SIZE / 2, 0, SIZE / 2) };
  private readonly look = { yaw: 0, pitch: 0, idle: 9 };
  private readonly eye = new THREE.Vector3(SIZE / 2, 260, SIZE / 2 + 360);
  private readonly aim = new THREE.Vector3(SIZE / 2, 0, SIZE / 2);
  private blend = 0;
  private steer = 0;
  private climb = 0;
  /** Your head turns towards the driver when he turns to you; 0..1. */
  private glance = 0;
  private talk: Talk | null = null;
  private lastHeading = 0;
  private drag: { x: number; y: number; moved: number } | null = null;
  private slow = 0;
  private googleWorld: GoogleWorld | null = null;
  private rideView: RideView | null = null;
  private shot: CameraShot = 'orbit';
  private readonly reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  constructor(
    private readonly canvas: HTMLCanvasElement,
    labelLayer: HTMLElement,
    toon = false,
    private readonly googleHolder: HTMLElement | null = null,
  ) {
    this.renderer = new THREE.WebGLRenderer({ canvas, alpha: Boolean(googleHolder), antialias: Boolean(googleHolder), powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.air = new Atmosphere(this.scene, this.renderer);
    if (googleHolder) {
      this.air.hideBackdrop();
      this.renderer.setClearColor(0x000000, 0);
      this.vehicles.group.visible = false;
    }

    this.cockpit.group.visible = false;
    this.scene.add(this.vehicles.group, this.cockpit.group, this.headlamp, this.headlamp.target);

    if (!googleHolder) {
      // Multisampled, half-float frame: smooth edges, and highlights bright enough to bloom.
      const size = this.renderer.getDrawingBufferSize(new THREE.Vector2());
      this.composer = new EffectComposer(this.renderer, new THREE.WebGLRenderTarget(size.x, size.y, { samples: 4, type: THREE.HalfFloatType }));
      this.composer.addPass(new RenderPass(this.scene, this.camera));
      // Ambient occlusion: the soft darkening where walls meet pavements and cars meet the road.
      this.ao = new GTAOPass(this.scene, this.camera, size.x, size.y);
      this.ao.blendIntensity = 1;
      this.ao.updateGtaoMaterial({ radius: 1.6, distanceExponent: 1.4, thickness: 1.2, scale: 1.15, samples: 12, distanceFallOff: 1, screenSpaceRadius: false });
      this.ao.updatePdMaterial({ lumaPhi: 10, depthPhi: 2, normalPhi: 3, radius: 6, rings: 2, samples: 12 });
      this.composer.addPass(this.ao);
      this.bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), 0.16, 0.45, 1.5);
      this.composer.addPass(this.bloom);
      this.composer.addPass(new OutputPass());
      // The toon finish works on the finished picture, and borrows the depth and normals drawn for the occlusion.
      this.toon = new ShaderPass(ToonShader);
      this.toon.uniforms.tDepth.value = this.ao.depthTexture;
      this.toon.uniforms.tNormal.value = this.ao.normalTexture;
      this.toon.enabled = toon;
      this.composer.addPass(this.toon);
    }

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

  // --- The town -------------------------------------------------------------------------------------

  setPlace({ map, net, city, traffic, place, terrain }: PlaceData) {
    this.clearPlace();
    this.traffic = traffic;
    // The lie of the land first, with the streets cut into it; everything else stands on that.
    this.terrain = new Heightfield(terrain);
    this.terrain.grade(map, city.ground);
    this.cockpit.setNetwork(net);
    if (this.googleHolder) {
      this.googleWorld = new GoogleWorld(this.googleHolder, { map, net, city, traffic, place, terrain });
      this.orbit.target.set(SIZE / 2, this.terrain.at(SIZE / 2, SIZE / 2), SIZE / 2);
      this.orbit.distance = 700;
      return;
    }
    this.ground = new Ground(this.surfaces, this.terrain);
    this.ground.bake(city);
    this.roads = new Roads(map, net, city, this.surfaces, this.terrain);
    this.furniture = new Furniture(city, this.terrain, net);
    this.buildings = new Buildings(this.surfaces, place.lat, this.terrain);
    this.trees = new Trees(this.terrain, place.lat);
    this.people = new People(net, city, this.terrain);
    this.vehicles.park(net, city);
    this.cockpit.setNetwork(net);
    this.scene.add(this.ground.group, this.roads.group, this.furniture.group, this.buildings.group, this.trees.group, this.people.group);
    this.orbit.target.set(SIZE / 2, this.terrain.at(SIZE / 2, SIZE / 2), SIZE / 2);
  }

  addScenery(scenery: CityMap, city: City) {
    // Parks and water have just been written into the city's ground grid: repaint the land from it.
    this.ground?.bake(city);
    this.buildings?.add(scenery.buildings);
    this.trees?.add(scenery, city);
  }

  private clearPlace() {
    this.googleWorld?.dispose();
    this.googleWorld = null;
    for (const part of [this.ground, this.roads, this.furniture, this.buildings, this.trees, this.people]) {
      if (!part) continue;
      this.scene.remove(part.group);
      part.dispose();
    }
    this.ground = this.roads = this.furniture = this.buildings = this.trees = this.people = null;
  }

  setSky(time: TimeOfDay, weather: Weather) {
    this.air.set(time, weather);
  }

  /** Ink, flat washes and warm colour on top of the realistic picture, or not. */
  setToon(on: boolean) {
    if (this.toon) this.toon.enabled = on;
  }

  setDriver(talk: Talk, gags: Gags) {
    this.talk = talk;
    this.cockpit.setDriver(talk, gags);
  }

  setRide(ride: RideView) {
    this.rideView = ride;
    this.cockpit.setRide(ride);
  }

  setDriverSex(sex: Sex) {
    this.cockpit.figure.load(sex);
  }

  /** 0 looking at the road, 1 looking straight at him. */
  get facingDriver(): number {
    return THREE.MathUtils.clamp((this.look.yaw + this.glance * 0.62 + 0.1) / 1.4, 0, 1);
  }

  setDash(lines: DashLines) {
    this.cockpit.show(lines);
  }

  // --- Cameras ----------------------------------------------------------------------------------------

  setCameraShot(shot: CameraShot) {
    this.shot = shot;
    if (shot === 'orbit') { this.orbit.distance = 650; this.orbit.pitch = 0.58; }
    if (shot === 'overhead') { this.orbit.distance = 950; this.orbit.pitch = 1.48; this.orbit.yaw = 0; }
    if (shot === 'chase') { this.orbit.distance = 65; this.orbit.pitch = 0.42; }
  }

  ride(car: Car | null) {
    this.riding = car;
    this.look.yaw = this.look.pitch = 0;
    if (car) {
      this.lastHeading = Math.atan2(-car.dz, car.dx);
      this.cockpit.paint(car.driver.color);
      this.cockpit.figure.dress(car.id * 7 + car.driver.card.vehicle.length);
    }
  }

  private readonly down = (e: PointerEvent) => {
    this.drag = { x: e.clientX, y: e.clientY, moved: 0 };
  };

  /** What is under the pointer in the cabin, from the passenger seat. */
  private hit(e: { clientX: number; clientY: number }): Hotspot | '' {
    if (this.mode !== 'ride' || !this.riding || !this.cockpit.group.visible) return '';
    const rect = this.canvas.getBoundingClientRect();
    this.ray.setFromCamera(new THREE.Vector2(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1), this.camera);
    this.ray.layers.set(1);
    const found = this.ray.intersectObjects(this.cockpit.hotspots, false)[0];
    return (found?.object.name as Hotspot | undefined) ?? '';
  }

  private readonly move = (e: PointerEvent) => {
    if (!this.drag) {
      if (e.target === this.canvas) {
        this.hovering = this.hit(e);
        this.cockpit.setHover(this.hovering);
        this.canvas.style.cursor = this.hovering ? 'pointer' : '';
      }
      return;
    }
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
      this.shot = 'overhead'; // Manual orbiting stops the automatic camera movement.
      this.orbit.yaw -= dx * 0.005;
      this.orbit.pitch = THREE.MathUtils.clamp(this.orbit.pitch + dy * 0.004, 0.08, 1.45);
    }
  };

  private readonly up = (e: PointerEvent) => {
    const drag = this.drag;
    this.drag = null;
    if (!drag || drag.moved > 5 || e.target !== this.canvas) return;
    if (this.mode === 'ride') return void this.onTap(this.hit(e));
    if (this.mode !== 'above' || !this.traffic) return;
    const rect = this.canvas.getBoundingClientRect();
    let best: Car | null = null;
    let bestD = 34;
    const p = new THREE.Vector3();
    for (const car of this.traffic.cars) {
      p.set(car.x, this.terrain.at(car.x, car.z) + 1, car.z).project(this.camera);
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
    if (this.mode === 'above') this.orbit.distance = THREE.MathUtils.clamp(this.orbit.distance * Math.exp(e.deltaY * 0.0012), 14, 1400);
  };

  resize() {
    const w = this.canvas.clientWidth || window.innerWidth;
    const h = this.canvas.clientHeight || window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.composer?.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  // --- A frame ----------------------------------------------------------------------------------------

  frame(dt: number) {
    const traffic = this.traffic;
    const riding = this.riding && traffic?.cars.includes(this.riding) ? this.riding : null;
    const inside = this.mode === 'ride' && riding !== null;
    this.blend += ((inside ? 1 : 0) - this.blend) * (1 - Math.exp(-dt * 3.2));
    const k = 1 - Math.exp(-dt * 6);

    const o = this.orbit;
    const land = this.terrain;
    if (this.googleHolder && this.mode === 'above' && !this.drag) {
      if (this.shot === 'orbit' && !this.reducedMotion) o.yaw += dt * 0.085;
      if (this.shot === 'chase' && riding) {
        const want = Math.atan2(-riding.dx, -riding.dz);
        o.yaw += Math.atan2(Math.sin(want - o.yaw), Math.cos(want - o.yaw)) * k;
      }
    }
    if (riding) o.target.lerp(new THREE.Vector3(riding.x, land.at(riding.x, riding.z), riding.z), 1 - Math.exp(-dt * 2.5));
    else o.target.y += (land.at(o.target.x, o.target.z) - o.target.y) * k;
    const aboveEye = new THREE.Vector3(o.target.x + Math.cos(o.pitch) * Math.sin(o.yaw) * o.distance, o.target.y + Math.sin(o.pitch) * o.distance, o.target.z + Math.cos(o.pitch) * Math.cos(o.yaw) * o.distance);
    // Never under the hillside.
    aboveEye.y = Math.max(aboveEye.y, land.at(THREE.MathUtils.clamp(aboveEye.x, 0, SIZE), THREE.MathUtils.clamp(aboveEye.z, 0, SIZE)) + 2.5);

    if (riding) {
      const heading = Math.atan2(-riding.dz, riding.dx);
      let turn = heading - this.lastHeading;
      turn = Math.atan2(Math.sin(turn), Math.cos(turn));
      this.lastHeading = heading;
      this.steer += (THREE.MathUtils.clamp((turn / Math.max(dt, 1e-3)) * 1.6, -1.6, 1.6) - this.steer) * (1 - Math.exp(-dt * 5));
      this.cockpit.steer(this.steer);
      this.cockpit.animate(dt, { x: riding.x, z: riding.z, dx: riding.dx, dz: riding.dz, speed: riding.v, accel: riding.a, steer: this.steer, wet: this.air.wet, night: this.air.night, honking: riding.hornUntil > (this.traffic?.time ?? 0) });
      // The car sits on the road and tilts with it: nose up on a climb, down on a descent.
      const reach = riding.driver.body.length / 2;
      const [front, back] = [land.at(riding.x + riding.dx * reach, riding.z + riding.dz * reach), land.at(riding.x - riding.dx * reach, riding.z - riding.dz * reach)];
      const road = (front + back) / 2 + 0.05;
      const climb = Math.atan((front - back) / riding.driver.body.length);
      this.climb += (climb - this.climb) * (1 - Math.exp(-dt * 6));
      this.cockpit.group.position.set(riding.x, road + 0.02, riding.z);
      this.cockpit.group.rotation.order = 'YZX';
      this.cockpit.group.rotation.set(0, heading, this.climb);
      this.look.idle += dt;
      if (this.look.idle > 2.2 && !this.drag) {
        this.look.yaw *= Math.exp(-dt * 2);
        this.look.pitch *= Math.exp(-dt * 2);
      }
      // The front passenger seat: right of centre, eyes 1.2 m up; the head leans a little into the bends.
      const side = isUK() ? -1 : 1;
      const seat = new THREE.Vector3(riding.x + riding.dx * 0.1 - riding.dz * 0.36 * side, road + 1.2, riding.z + riding.dz * 0.1 + riding.dx * 0.36 * side);
      // When he turns to you, or loses his temper, you cannot help looking at him, unless you are looking elsewhere on purpose.
      const t = this.talk;
      const drawn = t?.speaking && this.look.idle > 2.2 && !this.drag && t.since < 2.6 && (t.gesture === 'look_at_passenger' || t.gesture === 'both_hands' || t.mood === 'shout');
      this.glance += ((drawn ? 1 : 0) - this.glance) * (1 - Math.exp(-dt * 3.5));
      // At rest your eyes sit a little left of straight ahead: the road, and the man you are listening to.
      const yaw = heading + this.look.yaw + (0.1 + this.glance * 0.62) * side - this.steer * 0.16;
      // You look where the road goes: up the hill, or down into the valley.
      const gaze = this.look.pitch + this.climb * 0.85;
      const rideAim = new THREE.Vector3(seat.x + Math.cos(yaw) * Math.cos(gaze) * 10, seat.y + Math.sin(gaze) * 10 - 0.45, seat.z - Math.sin(yaw) * Math.cos(gaze) * 10);
      const e = this.blend > 0.97 ? 1 : this.blend * this.blend * (3 - 2 * this.blend);
      this.eye.lerpVectors(aboveEye, seat, e);
      this.aim.lerpVectors(o.target, rideAim, e);
      const nose = riding.driver.body.length / 2 + 0.4;
      this.headlamp.position.set(riding.x + riding.dx * nose, road + 0.7, riding.z + riding.dz * nose);
      this.headlamp.target.position.set(riding.x + riding.dx * 40, road - 1.5 + Math.tan(this.climb) * 40, riding.z + riding.dz * 40);
    } else {
      this.eye.lerp(aboveEye, k);
      this.aim.lerp(o.target, k);
    }
    this.camera.position.copy(this.eye);
    this.camera.lookAt(this.aim);
    const wantFov = inside ? 64 : 42;
    const wantNear = this.blend > 0.6 ? 0.08 : Math.max(0.3, Math.min(30, (this.camera.position.y - o.target.y - 30) * 0.05));
    if (Math.abs(this.camera.fov - wantFov) > 0.05 || Math.abs(this.camera.near - wantNear) > wantNear * 0.1) {
      this.camera.fov += (wantFov - this.camera.fov) * k;
      this.camera.near = wantNear;
      this.camera.updateProjectionMatrix();
    }
    this.cockpit.group.visible = this.blend > 0.9;

    const focus = riding && this.blend > 0.5 ? new THREE.Vector3(riding.x, land.at(riding.x, riding.z), riding.z) : o.target;
    // From inside the car the shadows that matter are within a few car lengths: the map is spent on those, finely.
    this.air.update(dt, this.camera.position, focus, this.blend > 0.5 ? 36 : THREE.MathUtils.clamp(o.distance * 0.9, 120, 800));
    const { night, wet } = this.air;
    this.headlamp.intensity += ((riding && night > 0.3 ? 320 * night : 0) - this.headlamp.intensity) * k;
    this.ground?.update(dt, wet);
    this.roads?.update(wet);
    this.buildings?.update(dt, night, this.camera.position);
    if (traffic && !this.googleHolder) {
      this.vehicles.draw(traffic, this.blend > 0.9 ? riding : null, night, wet, land);
      this.furniture?.update(traffic, night, this.camera.position);
    }
    this.people?.update(dt, this.camera.position);
    this.drawLabels(traffic, riding);
    this.progress = this.googleWorld ? (this.googleWorld.ready ? 1 : 0.5) : this.buildings?.busy ? 0.5 : 1;

    // By day only the sun's glint on paint and glass blooms; at night lamps and windows get a soft halo, no more.
    if (this.bloom) {
      this.bloom.strength += ((0.16 + night * 0.16) - this.bloom.strength) * (1 - Math.exp(-dt));
      this.bloom.threshold = 1.5 - night * 0.35;
    }
    this.cockpit.dim(night);

    // If the machine cannot keep up: some resolution first, then the ambient occlusion (and with it the ink,
    // which is drawn from the same depth and normals).
    this.slow = dt > 0.042 ? this.slow + dt : Math.max(0, this.slow - dt * 0.5);
    if (this.slow > 4) {
      this.slow = 0;
      if (this.renderer.getPixelRatio() > 1) {
        this.renderer.setPixelRatio(1);
        this.resize();
      } else if (this.ao) this.ao.enabled = false;
    }
    this.clock += dt;
    if (this.toon && this.ao) {
      const t = this.toon.uniforms;
      t.cameraNear.value = this.camera.near;
      t.cameraFar.value = this.camera.far;
      t.uInk.value = this.ao.enabled ? 1 : 0;
      t.uNight.value = night;
      t.uTime.value = this.clock % 64;
      this.renderer.getDrawingBufferSize(t.resolution.value);
    }
    if (this.googleHolder) {
      this.googleWorld?.update(dt, this.camera, this.aim, land.at(this.camera.position.x, this.camera.position.z), inside ? riding : null, this.rideView);
      // Postprocessing has an opaque background; render only the transparent cabin foreground.
      this.renderer.render(this.scene, this.camera);
    } else this.composer?.render(dt);
  }

  private drawLabels(traffic: Traffic | null, riding: Car | null) {
    const w = this.canvas.clientWidth;
    const h = this.canvas.clientHeight;
    const p = new THREE.Vector3();
    let used = 0;
    if (traffic)
      for (const car of traffic.cars) {
        if (used >= LABELS) break;
        if (car.bubbleUntil < traffic.time || (car === riding && this.blend > 0.5)) continue;
        p.set(car.x, this.terrain.at(car.x, car.z) + car.driver.body.height + 0.9, car.z);
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

  get lookingAt(): { x: number; z: number } {
    return { x: this.orbit.target.x, z: this.orbit.target.z };
  }

  get ear(): THREE.Vector3 {
    return this.camera.position;
  }

  dispose() {
    this.canvas.removeEventListener('pointerdown', this.down);
    window.removeEventListener('pointermove', this.move);
    window.removeEventListener('pointerup', this.up);
    this.canvas.removeEventListener('wheel', this.zoom);
    this.clearPlace();
    for (const el of this.labels) el.remove();
    this.vehicles.dispose();
    this.cockpit.dispose();
    this.air.dispose();
    this.ao?.dispose();
    this.bloom?.dispose();
    this.toon?.dispose();
    this.composer?.dispose();
    this.renderer.dispose();
  }
}
