import { isUK, currencySymbol, displaySpeed, speedUnit } from '../../edition';
// The inside of the car, seen from the front passenger seat: a moulded dashboard with its vents, radio and
// glovebox, dials, a wheel that turns with the road and a driver holding it (`figure.ts`), seats in the striped
// velour of the period, door cards with window cranks, sun visors, wing mirrors in the car's own paint, wipers
// that work when it rains, a little tree swinging from the mirror, a nodding dog on the dash. Two things tell you
// how the ride is going: the screen on the dash (what the car has decided, the petrol, and now and then the
// price of a kilometre) and the taximeter beside it.
//
// Local axes: +x forward, +y up, +z to the right of the car, where you sit. The driver is on the left.
// What never moves is merged into one mesh per material; what moves is kept apart.

import { CabinPhysics, type CabinItem } from '../../sim/cabin';
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { Gags, Talk } from '../../sim/chatter';
import type { RideView } from '../../sim/ride';
import type { Network } from '../../city/network';
import { DriverFigure } from './figure';

export interface DashLines {
  speed: number;
  limit: number;
  decision: string;
  detail: string;
  goal: string;
}

export interface CabinState {
  /** Where the car is and which way it faces, for the GPS. */
  x: number;
  z: number;
  dx: number;
  dz: number;
  /** m/s, m/s², and how hard the road is turning (-1.6..1.6, as the wheel is turned). */
  speed: number;
  accel: number;
  steer: number;
  lateral: number;
  /** 0..1: how wet the windscreen is, how dark it is outside. */
  wet: number;
  night: number;
  honking: boolean;
}

const euros = (n: number) => isUK() ? n.toFixed(2) : n.toFixed(2).replace('.', ',');

/** Geometry that never moves, gathered by material and merged at the end. */
class Parts {
  private readonly buckets = new Map<THREE.Material, THREE.BufferGeometry[]>();
  private readonly m = new THREE.Matrix4();
  private readonly q = new THREE.Quaternion();
  private readonly e = new THREE.Euler();

  put(material: THREE.Material, geometry: THREE.BufferGeometry, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0) {
    const g = geometry.index ? geometry.toNonIndexed() : geometry;
    g.applyMatrix4(this.m.compose(new THREE.Vector3(x, y, z), this.q.setFromEuler(this.e.set(rx, ry, rz)), new THREE.Vector3(1, 1, 1)));
    const list = this.buckets.get(material) ?? [];
    list.push(g);
    this.buckets.set(material, list);
  }

  box(material: THREE.Material, sx: number, sy: number, sz: number, x: number, y: number, z: number, rx = 0, ry = 0, rz = 0) {
    this.put(material, new THREE.BoxGeometry(sx, sy, sz), x, y, z, rx, ry, rz);
  }

  soft(material: THREE.Material, sx: number, sy: number, sz: number, x: number, y: number, z: number, radius = 0.03, rx = 0, ry = 0, rz = 0) {
    this.put(material, new RoundedBoxGeometry(sx, sy, sz, 3, Math.min(radius, sx / 2.01, sy / 2.01, sz / 2.01)), x, y, z, rx, ry, rz);
  }

  /** A side profile pushed across the car from z = from to z = to. */
  across(material: THREE.Material, profile: Array<[number, number]>, from: number, to: number, bevel = 0.03) {
    const shape = new THREE.Shape(profile.map(([x, y]) => new THREE.Vector2(x, y)));
    const g = new THREE.ExtrudeGeometry(shape, { depth: to - from - bevel * 2, bevelEnabled: true, bevelThickness: bevel, bevelSize: bevel, bevelSegments: 4, curveSegments: 6 });
    this.put(material, g, 0, 0, from + bevel);
  }

  into(group: THREE.Group) {
    for (const [material, list] of this.buckets) {
      const mesh = new THREE.Mesh(mergeGeometries(list)!, material);
      mesh.castShadow = mesh.receiveShadow = true;
      group.add(mesh);
    }
    this.buckets.clear();
  }
}

/** Grey velour with thin coloured stripes: every taxi of a certain age. */
function velour(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 128;
  const c = canvas.getContext('2d')!;
  c.fillStyle = '#41444c';
  c.fillRect(0, 0, 128, 128);
  for (let i = 0; i < 1400; i++) {
    c.fillStyle = Math.random() < 0.5 ? 'rgb(255 255 255 / 0.05)' : 'rgb(0 0 0 / 0.08)';
    c.fillRect(Math.random() * 128, Math.random() * 128, 1.5, 1.5);
  }
  const stripes: Array<[number, number, string]> = [[18, 3, '#3f9089'], [25, 1.5, '#c9b88c'], [60, 5, '#2c2f35'], [82, 3, '#a9473c'], [89, 1.5, '#c9b88c'], [112, 2, '#3f9089']];
  for (const [x, w, colour] of stripes) {
    c.fillStyle = colour;
    c.fillRect(x, 0, w, 128);
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(2, 2);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

/** A dial: ticks round three quarters of a circle. */
function dialFace(marks: number, label: string): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 128;
  const c = canvas.getContext('2d')!;
  c.fillStyle = '#0a0b0d';
  c.fillRect(0, 0, 128, 128);
  c.translate(64, 64);
  for (let i = 0; i <= marks; i++) {
    const a = (225 - (270 * i) / marks) * (Math.PI / 180);
    const long = i % 2 === 0;
    c.strokeStyle = long ? '#f3f0e6' : '#8b9098';
    c.lineWidth = long ? 3 : 1.5;
    c.beginPath();
    c.moveTo(Math.cos(a) * (long ? 44 : 49), -Math.sin(a) * (long ? 44 : 49));
    c.lineTo(Math.cos(a) * 57, -Math.sin(a) * 57);
    c.stroke();
  }
  c.fillStyle = '#9aa0a8';
  c.font = '600 13px Overpass, system-ui, sans-serif';
  c.textAlign = 'center';
  c.fillText(label, 0, 34);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

export class Cockpit {
  readonly group = new THREE.Group();
  readonly figure = new DriverFigure();
  private readonly wheel = new THREE.Group();
  private readonly paintwork: THREE.MeshPhysicalMaterial;
  private readonly canvas = document.createElement('canvas');
  private readonly screen: THREE.CanvasTexture;
  private readonly display: THREE.MeshBasicMaterial;
  private readonly meterCanvas = document.createElement('canvas');
  private readonly meterScreen: THREE.CanvasTexture;
  private readonly meterDisplay: THREE.MeshBasicMaterial;
  private readonly meter = new THREE.Group();
  private readonly glow: THREE.MeshBasicMaterial[] = [];
  private readonly needles: { speed: THREE.Mesh; fuel: THREE.Mesh };
  private readonly fuelLamp: THREE.Mesh;
  private readonly wipers: THREE.Group[] = [];
  private readonly tree = new THREE.Group();
  private readonly dogHead = new THREE.Group();
  private readonly glovebox = new THREE.Group();
  private readonly gloveContents = new THREE.Group();
  private readonly visor = new THREE.Group();
  private readonly physics = new CabinPhysics();
  private readonly down = new THREE.Vector3(0, -1, 0);
  private readonly hanging = new THREE.Vector3();
  private gloveAngle = 0;
  private gloveVelocity = 0;
  private visorAngle = 0;
  /** Things you can put a finger on from the passenger seat: boxes on their own layer, drawn by nobody, hit by the raycaster. */
  readonly hotspots: THREE.Mesh[] = [];
  /** And a small light on each, so that they can be found: the radio, the crank of your window, his screen. */
  private readonly marks: Array<{ name: string; sprite: THREE.Sprite }> = [];
  private hover = '';
  private lines: DashLines = { speed: 0, limit: 50, decision: '', detail: '', goal: '' };
  private gags: Gags = { fuel: 1, fare: null, perKm: 0, banner: '' };
  private talk: Talk = { level: 0, speaking: false, mood: 'grumble', gesture: 'none', since: 0, progress: 0, story: false };
  private ride: RideView | null = null;
  private net: Network | null = null;
  private at = { x: 0, z: 0, dx: 1, dz: 0 };
  private recalcSeen = -1;
  private recalcAt = 0;
  private shown = '';
  private metered = '';
  private clock = 0;
  private wipe = 0;

  constructor() {
    const soft = new THREE.MeshStandardMaterial({ color: '#17191c', roughness: 0.78, metalness: 0.05 });
    const grain = new THREE.MeshStandardMaterial({ color: '#24272c', roughness: 0.9 });
    const trim = new THREE.MeshStandardMaterial({ color: '#2b2e33', roughness: 0.45, metalness: 0.5 });
    const chrome = new THREE.MeshStandardMaterial({ color: '#c9ccd1', roughness: 0.22, metalness: 1, envMapIntensity: 1.4 });
    const lining = new THREE.MeshStandardMaterial({ color: '#77746e', roughness: 1 });
    const carpet = new THREE.MeshStandardMaterial({ color: '#0e0f11', roughness: 1 });
    const vinyl = new THREE.MeshStandardMaterial({ color: '#1d1f23', roughness: 0.55 });
    const fabric = new THREE.MeshStandardMaterial({ map: velour(), roughness: 1 });
    const mirror = new THREE.MeshStandardMaterial({ color: '#0d0f12', roughness: 0.08, metalness: 0.95, envMapIntensity: 1.6 });
    const paper = new THREE.MeshStandardMaterial({ color: '#d9d4c5', roughness: 0.95 });
    const blue = new THREE.MeshStandardMaterial({ color: '#2f5fa8', roughness: 0.7 });
    this.paintwork = new THREE.MeshPhysicalMaterial({ color: '#f4f1e6', roughness: 0.5, metalness: 0.35, clearcoat: 0.7, clearcoatRoughness: 0.22, envMapIntensity: 0.9 });
    const p = new Parts();

    // --- Dashboard ---
    const dashboard: Array<[number, number]> = [[0.62, 0.4], [0.62, 0.78], [0.74, 0.86], [1.24, 0.84], [1.32, 0.74], [1.32, 0.4]];
    p.across(soft, dashboard, -0.84, 0.17);
    p.across(soft, dashboard, 0.79, 0.84, 0.01);
    // Leave a real recess in the passenger side, so opening the door reveals a box, not a solid dashboard.
    p.across(soft, [[0.62, 0.725], [0.62, 0.78], [0.74, 0.86], [1.24, 0.84], [1.32, 0.74], [1.32, 0.725]], 0.17, 0.79, 0.005);
    p.box(soft, 0.7, 0.095, 0.62, 0.97, 0.4475, 0.48);
    p.box(carpet, 0.016, 0.22, 0.60, 0.94, 0.61, 0.48);
    p.box(carpet, 0.32, 0.012, 0.60, 0.78, 0.501, 0.48);
    p.across(soft, [[0.6, 0.8], [0.6, 0.86], [0.8, 0.92], [0.98, 0.9], [0.98, 0.84]], -0.6, -0.12, 0.02);
    // Glovebox, with its catch, in front of your knees.
    const gloveParts = new Parts();
    gloveParts.soft(grain, 0.025, 0.215, 0.6, 0, 0.108, 0, 0.012);
    gloveParts.box(chrome, 0.012, 0.018, 0.1, -0.018, 0.175, 0);
    gloveParts.into(this.glovebox);
    this.glovebox.position.set(0.60, 0.5, 0.48);
    this.group.add(this.glovebox);
    const clutter = new Parts();
    for (let i = 0; i < 4; i++) {
      clutter.box(paper, 0.15, 0.002, 0.09, 0.70 + i * 0.014, 0.515 + i * 0.004, 0.34 + i * 0.025, 0, i * 0.22, 0);
      // Ink on the parking receipts.
      for (let line = 0; line < 3; line++) clutter.box(grain, 0.075, 0.001, 0.003, 0.70 + i * 0.014, 0.517 + i * 0.004, 0.33 + i * 0.025 + line * 0.014, 0, i * 0.22, 0);
    }
    clutter.box(blue, 0.14, 0.019, 0.16, 0.77, 0.519, 0.62, 0, -0.15, 0);
    clutter.box(paper, 0.13, 0.002, 0.14, 0.77, 0.53, 0.62, 0, -0.15, 0);
    clutter.put(new THREE.MeshStandardMaterial({ color: '#bad2a8', roughness: 0.45 }), new THREE.SphereGeometry(0.014, 10, 8), 0.66, 0.519, 0.71);
    clutter.into(this.gloveContents);
    this.gloveContents.visible = false;
    this.group.add(this.gloveContents);
    // Four vents: a dark mouth and three slats.
    for (const [z, y] of [[-0.76, 0.76], [-0.07, 0.75], [0.09, 0.75], [0.76, 0.76]] as const) {
      p.box(carpet, 0.014, 0.062, 0.13, 0.614, y, z);
      for (const dy of [-0.018, 0, 0.018]) p.box(trim, 0.02, 0.005, 0.122, 0.61, y + dy, z, 0, 0, 0.3);
    }
    // The radio, cassette slot and all, and the heater's three levers.
    p.box(trim, 0.014, 0.06, 0.2, 0.612, 0.655, 0.01);
    p.box(carpet, 0.016, 0.01, 0.1, 0.606, 0.648, 0.01);
    for (const z of [-0.075, 0.095]) p.put(chrome, new THREE.CylinderGeometry(0.012, 0.012, 0.022, 14), 0.6, 0.655, z, 0, 0, Math.PI / 2);
    p.box(grain, 0.014, 0.045, 0.2, 0.612, 0.575, 0.01);
    for (const [i, z] of [-0.06, 0.0, 0.07].entries()) p.box(chrome, 0.02, 0.014, 0.008, 0.603, 0.575, z + (i - 1) * 0.012);
    // What lives on top of a dashboard: yesterday's paper, the parking disc.
    p.box(paper, 0.21, 0.012, 0.29, 1.0, 0.856, 0.47, 0, 0.25, -0.03);
    p.box(blue, 0.11, 0.006, 0.11, 1.12, 0.85, -0.12, 0, -0.3, -0.04);
    // The steering column and its two stalks.
    p.put(soft, new THREE.CylinderGeometry(0.034, 0.042, 0.2, 14), 0.585, 0.825, -0.36, 0, 0, Math.PI / 2 - 0.42);
    for (const side of [-1, 1]) p.box(trim, 0.012, 0.012, 0.13, 0.62, 0.845, -0.36 + side * 0.1, side * 0.25, 0, 0);

    // --- Body: bonnet, scuttle, roof, pillars, rails ---
    p.across(this.paintwork, [[1.28, 0.62], [1.32, 0.76], [2.0, 0.72], [2.42, 0.62], [2.45, 0.5], [1.28, 0.5]], -0.86, 0.86, 0.05);
    p.box(carpet, 0.09, 0.02, 1.6, 1.3, 0.79, 0);
    p.across(lining, [[-1.6, 1.56], [-1.6, 1.62], [0.62, 1.62], [0.72, 1.56]], -0.84, 0.84, 0.01);
    p.box(soft, 0.1, 0.035, 1.68, 0.7, 1.572, 0);
    for (const side of [-1, 1]) {
      p.box(soft, 0.06, 0.98, 0.06, 1.0, 1.24, side * 0.86, 0, 0, 0.58);
      p.box(soft, 0.09, 0.74, 0.07, -0.62, 1.25, side * 0.87);
      p.box(soft, 2.32, 0.045, 0.05, -0.44, 1.588, side * 0.855);
      p.box(soft, 0.24, 0.72, 0.07, -1.66, 1.25, side * 0.85, 0, 0, -0.38);
      // Sun visors, folded up.
      if (side < 0) p.soft(lining, 0.17, 0.016, 0.42, 0.6, 1.538, side * 0.38, 0.006, 0, 0, -0.12);
      else {
        const visorParts = new Parts();
        visorParts.soft(lining, 0.23, 0.018, 0.42, -0.115, 0, 0, 0.008);
        // A faded note and a coin tucked under an elastic strap.
        visorParts.box(paper, 0.13, 0.002, 0.18, -0.115, 0.012, 0.04);
        visorParts.box(carpet, 0.018, 0.003, 0.32, -0.11, 0.015, 0);
        visorParts.put(new THREE.MeshStandardMaterial({ color: '#bc9a42', metalness: 0.65, roughness: 0.35 }), new THREE.CylinderGeometry(0.013, 0.013, 0.003, 16), -0.09, 0.016, -0.04);
        visorParts.into(this.visor);
        this.visor.position.set(0.70, 1.535, 0.40);
        this.group.add(this.visor);
      }
      // Wing mirrors, in the car's own paint.
      p.soft(this.paintwork, 0.075, 0.11, 0.2, 0.96, 0.995, side * 1.0, 0.03);
      p.box(mirror, 0.006, 0.085, 0.165, 0.92, 0.995, side * 1.0);
      p.box(trim, 0.05, 0.02, 0.1, 0.97, 0.94, side * 0.915);
    }
    p.box(grain, 0.44, 0.03, 1.62, -1.8, 0.985, 0);
    p.box(carpet, 3.1, 0.04, 1.72, -0.2, 0.29, 0);
    // Rear-view mirror on its stalk, and the grab handle nobody admits to holding.
    p.box(mirror, 0.03, 0.07, 0.24, 0.66, 1.49, 0);
    p.box(soft, 0.02, 0.06, 0.02, 0.675, 1.54, 0);
    p.soft(grain, 0.17, 0.022, 0.024, 0.05, 1.5, 0.8, 0.01);
    for (const x of [-0.03, 0.13]) p.box(grain, 0.024, 0.04, 0.03, x, 1.52, 0.815);

    // --- Doors ---
    for (const side of [-1, 1]) {
      p.box(soft, 2.7, 0.62, 0.08, -0.2, 0.56, side * 0.88);
      p.box(grain, 2.7, 0.13, 0.086, -0.2, 0.805, side * 0.878);
      p.box(trim, 2.7, 0.035, 0.11, -0.2, 0.885, side * 0.87);
      for (const x of [0.05, -1.05]) {
        p.soft(grain, 0.52, 0.06, 0.09, x, 0.7, side * 0.815, 0.025);
        p.box(chrome, 0.12, 0.024, 0.02, x + 0.2, 0.79, side * 0.832);
        // A window crank: this car has never heard of buttons.
        p.put(chrome, new THREE.CylinderGeometry(0.024, 0.024, 0.014, 16), x + 0.32, 0.61, side * 0.835, Math.PI / 2, 0, 0);
        p.box(chrome, 0.075, 0.012, 0.012, x + 0.35, 0.625, side * 0.825, 0, 0, 0.5);
        p.put(soft, new THREE.SphereGeometry(0.017, 10, 8), x + 0.383, 0.643, side * 0.812);
      }
      p.put(carpet, new THREE.CylinderGeometry(0.075, 0.075, 0.012, 20), 0.52, 0.47, side * 0.836, Math.PI / 2, 0, 0);
      p.soft(grain, 0.62, 0.1, 0.045, 0.08, 0.36, side * 0.83, 0.015);
    }

    // --- Between the seats ---
    p.soft(soft, 1.4, 0.17, 0.2, -0.12, 0.385, 0, 0.04);
    p.put(vinyl, new THREE.CylinderGeometry(0.018, 0.06, 0.1, 14), 0.27, 0.515, 0);
    p.put(chrome, new THREE.CylinderGeometry(0.008, 0.008, 0.17, 8), 0.262, 0.63, 0, 0, 0, 0.1);
    p.put(soft, new THREE.SphereGeometry(0.027, 14, 10), 0.253, 0.72, 0);
    p.soft(soft, 0.27, 0.035, 0.042, -0.08, 0.51, -0.02, 0.015, 0, 0, 0.22);
    p.put(chrome, new THREE.CylinderGeometry(0.011, 0.011, 0.02, 10), 0.052, 0.54, -0.02, 0, 0, Math.PI / 2 - 0.22);
    p.soft(vinyl, 0.34, 0.11, 0.18, -0.42, 0.5, 0, 0.035);
    p.box(carpet, 0.12, 0.012, 0.1, 0.09, 0.474, 0);

    // --- Seats ---
    for (const z of [-0.36, 0.36]) {
      p.soft(fabric, 0.5, 0.13, 0.42, 0.13, 0.41, z, 0.045);
      p.soft(fabric, 0.12, 0.66, 0.42, -0.215, 0.78, z, 0.045, 0, 0, 0.16);
      for (const side of [-1, 1]) {
        p.soft(vinyl, 0.5, 0.11, 0.08, 0.13, 0.44, z + side * 0.235, 0.035);
        p.soft(vinyl, 0.15, 0.62, 0.08, -0.2, 0.78, z + side * 0.235, 0.035, 0, 0, 0.16);
        p.put(chrome, new THREE.CylinderGeometry(0.006, 0.006, 0.12, 8), -0.283, 1.13, z + side * 0.06, 0, 0, 0.16);
      }
      p.soft(vinyl, 0.1, 0.17, 0.26, -0.3, 1.22, z, 0.04, 0, 0, 0.16);
    }
    p.soft(fabric, 0.52, 0.16, 1.5, -1.24, 0.4, 0, 0.05);
    p.soft(fabric, 0.14, 0.62, 1.5, -1.53, 0.78, 0, 0.05, 0, 0, 0.2);
    for (const z of [-0.45, 0.45]) p.soft(vinyl, 0.1, 0.15, 0.24, -1.62, 1.16, z, 0.04, 0, 0, 0.2);
    p.into(this.group);

    // --- The wheel ---
    const rim = new THREE.Mesh(new THREE.TorusGeometry(0.17, 0.016, 14, 44), vinyl);
    rim.rotation.y = Math.PI / 2;
    this.wheel.add(rim);
    for (const a of [Math.PI / 2, (Math.PI * 7) / 6, (Math.PI * 11) / 6]) {
      const spoke = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.17, 0.035), trim);
      spoke.position.set(0, Math.sin(a) * -0.085, Math.cos(a) * 0.085);
      spoke.rotation.x = a + Math.PI / 2;
      this.wheel.add(spoke);
    }
    const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.055, 0.04, 20), soft);
    hub.rotation.z = Math.PI / 2;
    this.wheel.add(hub);
    this.wheel.position.set(0.5, 0.87, -0.36);
    this.wheel.rotation.z = -0.42;
    this.group.add(this.wheel);

    // --- Dials: speed, and the one that matters, petrol ---
    const lit = (map?: THREE.Texture, color = '#ffffff') => {
      const m = new THREE.MeshBasicMaterial(map ? { map, color, toneMapped: false } : { color, toneMapped: false });
      this.glow.push(m);
      return m;
    };
    const dial = (z: number, face: THREE.CanvasTexture) => {
      const unit = new THREE.Group();
      unit.rotation.order = 'YXZ';
      unit.rotation.set(-0.3, -Math.PI / 2, 0);
      unit.position.set(0.628, 0.8, z);
      unit.add(new THREE.Mesh(new THREE.CircleGeometry(0.058, 28), lit(face)));
      const needle = new THREE.Mesh(new THREE.BoxGeometry(0.046, 0.005, 0.002).translate(0.018, 0, 0.003), lit(undefined, '#ff5a2a'));
      unit.add(needle);
      this.group.add(unit);
      return { unit, needle };
    };
    const speedo = dial(-0.43, dialFace(16, speedUnit()));
    const fuel = dial(-0.29, dialFace(4, 'E      F'));
    this.needles = { speed: speedo.needle, fuel: fuel.needle };
    this.fuelLamp = new THREE.Mesh(new THREE.CircleGeometry(0.009, 12), new THREE.MeshBasicMaterial({ color: '#ffae1a', toneMapped: false }));
    this.fuelLamp.position.set(0, -0.034, 0.004);
    fuel.unit.add(this.fuelLamp);

    // --- The screen: what the car has decided, the petrol, and now and then what a kilometre costs ---
    this.canvas.width = 512;
    this.canvas.height = 256;
    this.screen = new THREE.CanvasTexture(this.canvas);
    this.screen.colorSpace = THREE.SRGBColorSpace;
    const unit = new THREE.Group();
    unit.rotation.order = 'YXZ';
    // Facing back into the car, leaning a little, turned a little towards whoever pays.
    unit.rotation.set(-0.32, -Math.PI / 2 - 0.12, 0);
    unit.position.set(0.74, 0.97, 0.245);
    const bezel = new THREE.Mesh(new THREE.BoxGeometry(0.33, 0.185, 0.018), trim);
    bezel.position.z = -0.011;
    this.display = lit(this.screen);
    unit.add(bezel, new THREE.Mesh(new THREE.PlaneGeometry(0.31, 0.155), this.display));
    this.group.add(unit);

    // --- The taximeter: red figures that only ever go one way ---
    this.meterCanvas.width = 256;
    this.meterCanvas.height = 96;
    this.meterScreen = new THREE.CanvasTexture(this.meterCanvas);
    this.meterScreen.colorSpace = THREE.SRGBColorSpace;
    this.meter.rotation.order = 'YXZ';
    this.meter.rotation.set(-0.2, -Math.PI / 2 - 0.32, 0);
    this.meter.position.set(0.715, 0.935, -0.005);
    const box = new THREE.Mesh(new RoundedBoxGeometry(0.17, 0.075, 0.06, 2, 0.008), trim);
    box.position.z = -0.032;
    this.meterDisplay = lit(this.meterScreen);
    this.meter.add(box, new THREE.Mesh(new THREE.PlaneGeometry(0.155, 0.058), this.meterDisplay));
    this.group.add(this.meter);

    // --- What can be touched: the radio, the screen, your window, and him ---
    const touch = (name: string, w: number, h: number, d: number, x: number, y: number, z: number, parent = this.group) => {
      const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), new THREE.MeshBasicMaterial());
      m.name = name;
      m.position.set(x, y, z);
      m.layers.set(1);
      this.hotspots.push(m);
      parent.add(m);
    };
    touch('radio', 0.08, 0.16, 0.26, 0.6, 0.62, 0.01);
    touch('gps', 0.12, 0.22, 0.36, 0.72, 0.97, 0.245);
    touch('window', 1.7, 0.62, 0.04, -0.3, 1.22, 0.86);
    touch('driver', 0.5, 0.9, 0.5, -0.1, 1.05, -0.36);
    touch('glovebox', 0.05, 0.22, 0.6, -0.01, 0.11, 0, this.glovebox);
    touch('visor', 0.25, 0.04, 0.44, -0.12, 0, 0, this.visor);
    touch('meter', 0.18, 0.09, 0.075, 0, 0, -0.02, this.meter);
    touch('newspaper', 0.24, 0.03, 0.3, 1, 0.875, 0.47);
    touch('vents', 0.06, 0.10, 0.14, 0.60, 0.76, 0.76);
    touch('mirror', 0.055, 0.085, 0.25, 0.65, 1.49, 0);
    const ring = document.createElement('canvas');
    ring.width = ring.height = 64;
    const rc = ring.getContext('2d')!;
    rc.strokeStyle = '#f2c230';
    rc.lineWidth = 5;
    rc.beginPath();
    rc.arc(32, 32, 22, 0, Math.PI * 2);
    rc.stroke();
    rc.fillStyle = '#f2c230';
    rc.beginPath();
    rc.arc(32, 32, 9, 0, Math.PI * 2);
    rc.fill();
    const ringMap = new THREE.CanvasTexture(ring);
    ringMap.colorSpace = THREE.SRGBColorSpace;
    const mark = (name: string, x: number, y: number, z: number, parent = this.group) => {
      const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: ringMap, color: '#f2c230', transparent: true, opacity: 0.85, depthTest: false, depthWrite: false, toneMapped: false }));
      sprite.position.set(x, y, z);
      sprite.scale.setScalar(0.05);
      sprite.renderOrder = 20;
      sprite.visible = false;
      this.marks.push({ name, sprite });
      parent.add(sprite);
    };
    mark('radio', 0.585, 0.655, 0.01);
    mark('gps', 0.7, 1.0, 0.25);
    mark('window', 0.37, 0.625, 0.82);
    mark('glovebox', -0.025, 0.175, 0, this.glovebox);
    mark('visor', -0.13, -0.023, 0, this.visor);
    mark('meter', 0, 0, 0.012, this.meter);
    mark('newspaper', 0.98, 0.885, 0.54);
    mark('vents', 0.58, 0.76, 0.76);
    mark('mirror', 0.628, 1.49, 0);

    // --- Wipers: lying on the glass, which leans back from the scuttle to the roof ---
    for (const z of [-0.62, 0.06]) {
      const pivot = new THREE.Group();
      pivot.position.set(1.295, 0.805, z);
      pivot.rotation.z = 0.63;
      const arm = new THREE.Group();
      const blade = new THREE.Mesh(new THREE.BoxGeometry(0.012, 0.014, 0.56).translate(0.004, 0, 0.28), carpet);
      arm.add(blade);
      pivot.add(arm);
      this.wipers.push(arm);
      this.group.add(pivot);
    }

    // --- Hanging from the mirror: a little tree that has smelled of nothing since 2011 ---
    const fir = new THREE.Shape();
    const outline: Array<[number, number]> = [[0, 0], [0.008, 0], [0.008, -0.012], [0.03, -0.012], [0.014, -0.034], [0.024, -0.034], [0.01, -0.054], [0.018, -0.054], [0, -0.08]];
    fir.moveTo(outline[0][0], outline[0][1]);
    for (const [x, y] of [...outline.slice(1), ...outline.slice(0, -1).reverse().map(([x, y]) => [-x, y] as [number, number])]) fir.lineTo(x, y);
    const treeMesh = new THREE.Mesh(new THREE.ExtrudeGeometry(fir, { depth: 0.003, bevelEnabled: false }), new THREE.MeshStandardMaterial({ color: '#2f8f4e', roughness: 0.9 }));
    treeMesh.rotation.x = Math.PI;
    treeMesh.position.y = -0.17;
    const string = new THREE.Mesh(new THREE.CylinderGeometry(0.0012, 0.0012, 0.1, 5), paper);
    string.position.y = -0.05;
    this.tree.add(string, treeMesh);
    this.tree.rotation.y = Math.PI / 2;
    this.tree.position.set(0.655, 1.46, 0.04);
    this.group.add(this.tree);
    touch('tree', 0.085, 0.12, 0.055, 0, -0.13, 0, this.tree);
    mark('tree', 0, -0.13, 0, this.tree);

    // --- On the dash: a dog that agrees with everything ---
    const fur = new THREE.MeshStandardMaterial({ color: '#8a5a33', roughness: 1 });
    const dog = new THREE.Group();
    const torso = new THREE.Mesh(new THREE.SphereGeometry(0.03, 14, 10), fur);
    torso.scale.set(1.5, 0.9, 1);
    torso.position.y = 0.03;
    const skull = new THREE.Mesh(new THREE.SphereGeometry(0.026, 14, 10), fur);
    const snout = new THREE.Mesh(new THREE.SphereGeometry(0.013, 10, 8), new THREE.MeshStandardMaterial({ color: '#2a1a10', roughness: 0.6 }));
    snout.position.set(-0.028, -0.005, 0);
    this.dogHead.add(skull, snout);
    for (const side of [-1, 1]) {
      const ear = new THREE.Mesh(new THREE.SphereGeometry(0.012, 8, 6), snout.material);
      ear.scale.set(0.6, 1.4, 0.5);
      ear.position.set(0.004, -0.004, side * 0.026);
      this.dogHead.add(ear);
    }
    this.dogHead.position.set(-0.045, 0.064, 0);
    dog.add(torso, this.dogHead);
    dog.position.set(1.0, 0.853, 0.69);
    dog.rotation.y = -0.35;
    this.group.add(dog);
    touch('dog', 0.12, 0.13, 0.10, -0.02, 0.06, 0, dog);
    mark('dog', -0.045, 0.09, 0, dog);

    this.group.add(this.figure.group);
    this.figure.group.position.x = 0.16;
    // The car shades its own inside: the roof and pillars fall across the dash and the driver.
    this.group.traverse((o) => {
      if (o instanceof THREE.Mesh) o.castShadow = o.receiveShadow = !(o.material instanceof THREE.MeshBasicMaterial);
    });
    if (isUK()) {
      // The cabin is modelled along +X: mirror its lateral Z axis for a right-hand-drive cab.
      this.group.scale.z = -1;
      const flipped = new Set<THREE.Texture>();
      this.group.traverse(o => {
        if (!(o instanceof THREE.Mesh)) return;
        for (const material of Array.isArray(o.material) ? o.material : [o.material]) {
          const texture = (material as THREE.MeshBasicMaterial).map;
          if (texture instanceof THREE.CanvasTexture && !flipped.has(texture)) {
            texture.repeat.x = -1; texture.offset.x = 1; texture.needsUpdate = true; flipped.add(texture);
          }
        }
      });
    }
    this.draw();
    this.drawMeter();
  }

  touch(item: CabinItem) {
    if (item === 'tree') this.physics.flickTree();
    if (item === 'dog') this.physics.pokeDog();
  }

  resetObjects() {
    this.physics.reset();
    this.gloveAngle = this.gloveVelocity = this.visorAngle = 0;
    this.glovebox.rotation.z = this.visor.rotation.z = 0;
    this.gloveContents.visible = false;
  }

  paint(colour: string) {
    this.paintwork.color.set(colour);
  }

  /** Screens and dials turn themselves down at night. */
  dim(night: number) {
    for (const m of this.glow) m.color.setScalar(1 - night * 0.5);
  }

  steer(amount: number) {
    this.wheel.rotation.x = -amount * 1.5;
  }

  show(lines: DashLines) {
    this.lines = lines;
  }

  setDriver(talk: Talk, gags: Gags) {
    this.talk = talk;
    this.gags = gags;
  }

  /** What the pointer is over: that light grows. */
  setHover(name: string) {
    this.hover = name;
  }

  setRide(ride: RideView) {
    const on = ride.phase === 'riding' || ride.phase === 'quoting' || ride.phase === 'refusing';
    for (const m of this.marks) m.sprite.visible = on;
    this.ride = ride;
    this.figure.tension = ride.tension;
    if (ride.recalc !== this.recalcSeen) {
      this.recalcSeen = ride.recalc;
      this.recalcAt = this.clock;
    }
  }

  /** The streets, for the GPS on the dash. */
  setNetwork(net: Network | null) {
    this.net = net;
  }

  /** Everything in here that moves by itself. */
  animate(dt: number, s: CabinState) {
    // The touch-points breathe, and the one under the pointer swells.
    for (const m of this.marks) {
      const small = !['radio', 'gps', 'window'].includes(m.name);
      const want = m.name === this.hover ? (small ? 0.04 : 0.085) : (small ? 0.021 : 0.045) + 0.004 * Math.sin(this.clock * 3 + m.name.length);
      m.sprite.scale.setScalar(m.sprite.scale.x + (want - m.sprite.scale.x) * Math.min(1, dt * 12));
      (m.sprite.material as THREE.SpriteMaterial).opacity = m.name === this.hover ? 1 : small ? 0.5 : 0.75;
    }
    this.clock += dt;
    this.at = { x: s.x, z: s.z, dx: s.dx, dz: s.dz };
    this.figure.update(dt, { talk: this.talk, steer: s.steer, speed: s.speed, wheel: this.wheel, honking: s.honking });
    // Needles. The petrol one lives at the bottom of its dial and trembles there.
    this.needles.speed.rotation.z = (225 - Math.min(1, displaySpeed(s.speed * 3.6) / 160) * 270) * (Math.PI / 180);
    const low = this.gags.fuel <= 0.1;
    this.needles.fuel.rotation.z = (225 - Math.min(1, this.gags.fuel + (low ? Math.sin(this.clock * 23) * 0.006 : 0)) * 270) * (Math.PI / 180);
    this.fuelLamp.visible = low && (this.gags.fuel > 0.05 || this.clock % 0.7 < 0.4);
    // Wipers sweep while the glass is wet, and park themselves when it is not.
    const raining = s.wet > 0.25;
    if (raining || this.wipe % (Math.PI * 2) > 0.05) this.wipe = raining ? this.wipe + dt * 4.2 : Math.min(Math.ceil(this.wipe / (Math.PI * 2)) * Math.PI * 2, this.wipe + dt * 4.2);
    for (const arm of this.wipers) arm.rotation.x = -(0.5 - 0.5 * Math.cos(this.wipe)) * 1.7;
    const physics = this.physics;
    physics.step(dt, { acceleration: s.accel, lateral: s.lateral * (isUK() ? -1 : 1), speed: s.speed, windowOpen: this.ride?.window === 'down' });
    this.hanging.set(Math.sin(physics.fore.angle), -Math.cos(physics.fore.angle) * Math.cos(physics.side.angle), Math.sin(physics.side.angle)).normalize();
    this.tree.quaternion.setFromUnitVectors(this.down, this.hanging);
    this.tree.rotateY(Math.PI / 2 + physics.twist.angle);
    this.dogHead.rotation.z = physics.dog.angle;
    // A damped hinge, with a little bounce as the glovebox catches its retaining strap.
    const target = this.ride?.cabin.gloveboxOpen ? 1.3 : 0;
    for (let left = Math.min(0.1, dt); left > 0;) {
      const step = Math.min(left, 1 / 120); left -= step;
      this.gloveVelocity += ((target - this.gloveAngle) * 100 - this.gloveVelocity * 13) * step;
      this.gloveAngle = THREE.MathUtils.clamp(this.gloveAngle + this.gloveVelocity * step, 0, 1.36);
    }
    this.glovebox.rotation.z = this.gloveAngle;
    this.gloveContents.visible = this.gloveAngle > 0.08;
    this.visorAngle += ((this.ride?.cabin.visorDown ? 1.28 : 0) - this.visorAngle) * (1 - Math.exp(-dt * 10));
    this.visor.rotation.z = this.visorAngle;
    this.draw();
    this.drawMeter();
  }

  /** The dash screen. Every five seconds the bottom line changes its mind about what to show. */
  private draw() {
    const { lines, gags } = this;
    const low = gags.fuel <= 0.1;
    const turn = Math.floor(this.clock / 5) % 2;
    const blink = low && this.clock % 1 < 0.55;
    const riding = Boolean(this.ride && (this.ride.phase === 'riding' || this.ride.phase === 'quoting' || this.ride.phase === 'refusing') && this.ride.destination);
    const recalculating = riding && this.clock - this.recalcAt < 1.6;
    const strip = gags.banner || (riding && turn === 0 ? `${this.ride!.destination.toUpperCase()}   ${this.ride!.eta} MIN` : gags.fare !== null && (turn === 1 || !lines.goal) ? `${isUK() ? 'PER MILE' : 'PRIX AU KM'}   ${euros(gags.perKm * (isUK() ? 1.609344 : 1))} ${currencySymbol()}` : lines.goal);
    // While riding the GPS panel is live: it is redrawn a few times a second, and continuously while it recalculates.
    const key = `${lines.speed}|${lines.limit}|${lines.decision}|${lines.detail}|${strip}|${Math.round(gags.fuel * 100)}|${blink}|${riding ? Math.floor(this.clock * (recalculating ? 30 : 6)) : ''}`;
    if (key === this.shown) return;
    this.shown = key;
    const c = this.canvas.getContext('2d')!;
    c.textAlign = 'left';
    c.fillStyle = '#0b0d10';
    c.fillRect(0, 0, 512, 256);
    if (riding) this.drawGps(c, recalculating ? Math.min(1, (this.clock - this.recalcAt) / 1.5) : 1);
    c.fillStyle = '#f3f0e6';
    c.font = '800 118px Overpass, system-ui, sans-serif';
    c.textBaseline = 'alphabetic';
    c.fillText(String(displaySpeed(lines.speed)), 26, 128);
    c.font = '400 24px Overpass, system-ui, sans-serif';
    c.fillStyle = '#9aa0a8';
    c.fillText(`${speedUnit()} in a ${displaySpeed(lines.limit)}`, 30, 166);
    if (!riding) {
      c.fillStyle = '#f3f0e6';
      c.font = '600 34px Overpass, system-ui, sans-serif';
      c.fillText(lines.decision.charAt(0).toUpperCase() + lines.decision.slice(1), 236, 62);
      c.font = '400 22px Overpass, system-ui, sans-serif';
      c.fillStyle = '#9aa0a8';
      let line = '';
      let y = 94;
      for (const word of lines.detail.split(' ')) {
        if (c.measureText(`${line} ${word}`).width > 250 && line) {
          c.fillText(line, 236, y);
          line = word;
          y += 27;
        } else line = line ? `${line} ${word}` : word;
      }
      c.fillText(line, 236, y);
    }
    // Petrol: a bar that is mostly empty, and says so.
    c.fillStyle = '#2a2e35';
    c.fillRect(236, 158, 170, 12);
    c.fillStyle = low ? (blink ? '#ffae1a' : '#7a5410') : '#8fbf9a';
    c.fillRect(236, 158, Math.max(3, 170 * gags.fuel), 12);
    c.font = '600 19px Overpass, system-ui, sans-serif';
    c.fillStyle = low ? (blink ? '#ffae1a' : '#7a5410') : '#9aa0a8';
    c.fillText(low ? `RÉSERVE ${Math.round(gags.fuel * 100)} %` : `${Math.round(gags.fuel * 100)} %`, 416, 170);
    if (strip) {
      const loud = Boolean(gags.banner);
      c.fillStyle = '#f2c230';
      c.fillRect(0, 196, 512, loud ? 60 : 3);
      c.fillStyle = loud ? '#14161a' : '#f2c230';
      c.font = `${loud ? 800 : 600} ${c.measureText(strip).width > 330 ? 22 : 26}px Overpass, system-ui, sans-serif`;
      c.fillText(strip, 26, 236);
    }
    this.screen.needsUpdate = true;
  }

  /** The GPS on the dash: the streets around the car with the car pointing up, the route in yellow, the flag at the end. */
  private drawGps(c: CanvasRenderingContext2D, drawn: number) {
    const net = this.net;
    const ride = this.ride;
    if (!net || !ride) return;
    const [px, py, pw, ph] = [236, 14, 264, 176];
    c.save();
    c.beginPath();
    c.rect(px, py, pw, ph);
    c.clip();
    c.fillStyle = '#0d1a14';
    c.fillRect(px, py, pw, ph);
    const scale = 0.62;
    const cx = px + pw / 2;
    const cy = py + ph * 0.72;
    const { x, z, dx, dz } = this.at;
    // Heading up: the world turned so that the car's forward is the screen's up.
    const toScreen = (wx: number, wz: number): [number, number] => {
      const rx = wx - x;
      const rz = wz - z;
      const forward = rx * dx + rz * dz;
      const right = rx * dz - rz * dx;
      return [cx + right * scale, cy - forward * scale];
    };
    const reach = 190;
    const onRoute = new Set(ride.routeLanes);
    c.lineCap = 'round';
    c.lineJoin = 'round';
    for (const lane of net.lanes) {
      if (lane.index !== 0 || onRoute.has(lane.id)) continue;
      const [mx, mz] = lane.points[Math.floor(lane.points.length / 2)];
      if (Math.hypot(mx - x, mz - z) > reach + lane.length / 2) continue;
      c.strokeStyle = lane.road.rank >= 3 ? '#3a5a47' : '#2a4234';
      c.lineWidth = lane.road.rank >= 3 ? 4 : 2.5;
      c.beginPath();
      lane.points.forEach(([wx, wz], i) => (i ? c.lineTo(...toScreen(wx, wz)) : c.moveTo(...toScreen(wx, wz))));
      c.stroke();
    }
    // The route, drawn as far as the recalculation has got.
    const pts: Array<[number, number]> = [];
    for (const id of ride.routeLanes) for (const [wx, wz] of net.lanes[id]?.points ?? []) pts.push(toScreen(wx, wz));
    if (pts.length > 1) {
      const n = Math.max(2, Math.ceil(pts.length * drawn));
      c.strokeStyle = '#f2c230';
      c.lineWidth = 5;
      c.beginPath();
      pts.slice(0, n).forEach((p, i) => (i ? c.lineTo(p[0], p[1]) : c.moveTo(p[0], p[1])));
      c.stroke();
      if (drawn >= 1) {
        const end = pts[pts.length - 1];
        c.fillStyle = '#f2c230';
        c.beginPath();
        c.arc(end[0], end[1], 6, 0, Math.PI * 2);
        c.fill();
      }
    }
    // The car.
    c.fillStyle = '#f3f0e6';
    c.beginPath();
    c.moveTo(cx, cy - 10);
    c.lineTo(cx + 7, cy + 7);
    c.lineTo(cx - 7, cy + 7);
    c.closePath();
    c.fill();
    if (drawn < 1 && Math.floor(this.clock * 4) % 2 === 0) {
      c.fillStyle = '#9fe0b8';
      c.font = '700 20px ui-monospace, Menlo, monospace';
      c.fillText(isUK() ? 'REROUTING…' : 'RECALCUL…', px + 12, py + 30);
    }
    c.restore();
    c.strokeStyle = '#22322a';
    c.lineWidth = 2;
    c.strokeRect(px, py, pw, ph);
  }

  private drawMeter() {
    const g = this.gags;
    const key = g.fare === null ? 'off' : `${g.fare.toFixed(1)}|${g.perKm.toFixed(1)}|${g.banner}`;
    if (key === this.metered) return;
    this.metered = key;
    this.meter.visible = g.fare !== null;
    if (g.fare === null) return;
    const c = this.meterCanvas.getContext('2d')!;
    c.fillStyle = '#120403';
    c.fillRect(0, 0, 256, 96);
    c.fillStyle = '#ff2a1a';
    c.textBaseline = 'alphabetic';
    c.textAlign = 'right';
    c.font = '800 58px ui-monospace, Menlo, monospace';
    c.fillText(euros(g.fare), 214, 58);
    c.font = '800 24px ui-monospace, Menlo, monospace';
    c.fillText(currencySymbol(), 244, 58);
    c.textAlign = 'left';
    c.font = '700 15px ui-monospace, Menlo, monospace';
    c.fillStyle = g.banner ? '#ffd23c' : '#c4281c';
    c.fillText(g.banner ? g.banner.slice(0, 27) : `${isUK() ? 'TARIFF C' : 'TARIF C'}   ${euros(g.perKm * (isUK() ? 1.609344 : 1))} ${currencySymbol()}/${isUK() ? 'MI' : 'KM'}`, 10, 85);
    this.meterScreen.needsUpdate = true;
  }

  dispose() {
    this.screen.dispose();
    this.meterScreen.dispose();
    this.figure.dispose();
    this.group.traverse((o) => {
      if (o instanceof THREE.Mesh) {
        o.geometry.dispose();
        const material = o.material as THREE.MeshStandardMaterial;
        material.map?.dispose();
        material.dispose();
      }
    });
  }
}
