import { isUK } from '../../edition';
// What stands proud of a wall: the surround and sill of every window, the shutters folded back beside it, a
// balcony with its railing, the cornice under the roof, an awning over a shop, a door, a drainpipe down one
// corner, a chimney on the ridge. All of it is a handful of small shapes drawn many thousand times, one
// instanced mesh a kind, laid out to the same floors and bays the facade shader paints its glass to.
//
// A window is described in the wall's own terms (metres along it, metres up it) and placed with the wall's frame.

import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

/** The facade shader's grid, mirrored here so that the geometry lands on the painted glass. */
export const FLOOR = 3.1;
export const bayOf = (seed: number) => 2.5 + fh(seed, 1) * 0.9;
/** The opening within a bay and a floor: fractions along and up. Ground floors of big buildings are shopfronts. */
export const OPENING = { window: { x0: 0.24, x1: 0.76, y0: 0.26, y1: 0.84 }, shop: { x0: 0.1, x1: 0.9, y0: 0.08, y1: 0.8 } };

/** The shader's hash, without a sine in it, so that both sides can agree on a bay's width. */
export function fh(x: number, y: number): number {
  const f = Math.fround;
  const fract = (v: number) => f(v - Math.floor(v));
  let p0 = fract(f(f(x) * f(0.1031)));
  let p1 = fract(f(f(y) * f(0.1031)));
  let p2 = fract(f(f(x) * f(0.1031)));
  const d = f(f(f(p0 * f(p1 + f(33.33))) + f(p1 * f(p2 + f(33.33)))) + f(p2 * f(p0 + f(33.33))));
  p0 = f(p0 + d);
  p1 = f(p1 + d);
  p2 = f(p2 + d);
  return fract(f(f(p0 + p1) * p2));
}

const v1 = new THREE.Vector3();

export const SHUTTERS = ['#7fa3b3', '#8fb094', '#a5786e', '#a9b8c2', '#7d907a', '#c2ceba', '#6b8aa0', '#cfa77c', '#e8e2d2', '#c9b8a8'];
const AWNINGS = ['#9c2a25', '#2c5a44', '#d9cfb4', '#3d5470', '#b8823f'];

/** What the shops are: the word on the fascia, its board's colour, and the letters'. */
const SHOPS: Array<[string, string, string]> = isUK() ? [
  ['BAKERY', '#513125', '#f3e4c2'], ['OFF LICENCE', '#82332b', '#ffffff'],
  ['CHEMIST', '#1f6b47', '#ffffff'], ['TEA & TOAST', '#2b2b2f', '#e9d8a6'],
  ['THE RED LION', '#702b29', '#eadab1'], ['NEWSAGENT', '#334633', '#f2e8d1'],
  ['BARBERS', '#29394d', '#f0e6f5'], ['BUTCHER', '#8a1c1c', '#f7e6d3'],
  ['FISH & CHIPS', '#284455', '#f6efd8'], ['OPTICIANS', '#e6e2d8', '#1d1d1f'],
  ['BANK', '#1b2f4f', '#d9dee8'], ['FLOWERS', '#5f7f3a', '#f5efe0'],
  ['CORNER SHOP', '#a05a2c', '#f6ecd6'], ['CURRY HOUSE', '#6b1e2e', '#f3dcc0'],
  ['TO LET', '#3a4f6b', '#eef1f5'], ['POST OFFICE', '#a62424', '#fff6df'],
] : [
  ['BOULANGERIE', '#7a2a1e', '#f3e4c2'],
  ['TABAC', '#b3262a', '#ffffff'],
  ['PHARMACIE', '#1f7a3a', '#ffffff'],
  ['CAFÉ', '#2b2b2f', '#e9d8a6'],
  ['BAR', '#1e3a5a', '#f2e9d0'],
  ['PRESSE', '#d9a21b', '#1c1c1c'],
  ['COIFFEUR', '#3d2b4f', '#f0e6f5'],
  ['BOUCHERIE', '#8a1c1c', '#f7e6d3'],
  ['PIZZERIA', '#2f6b3a', '#f6efd8'],
  ['OPTIQUE', '#e6e2d8', '#1d1d1f'],
  ['BANQUE', '#1b2f4f', '#d9dee8'],
  ['FLEURS', '#5f7f3a', '#f5efe0'],
  ['ÉPICERIE', '#a05a2c', '#f6ecd6'],
  ['RESTAURANT', '#6b1e2e', '#f3dcc0'],
  ['IMMOBILIER', '#3a4f6b', '#eef1f5'],
  ['LA POSTE', '#f2c230', '#1f3a7a'],
];

/** The word, painted once onto a board's face. */
function signTexture(word: string, board: string, letters: string): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 128;
  const c = canvas.getContext('2d')!;
  c.fillStyle = board;
  c.fillRect(0, 0, 512, 128);
  c.strokeStyle = 'rgb(0 0 0 / 0.25)';
  c.lineWidth = 6;
  c.strokeRect(3, 3, 506, 122);
  c.fillStyle = letters;
  c.textAlign = 'center';
  c.textBaseline = 'middle';
  let size = 78;
  c.font = `800 ${size}px Overpass, "Arial Narrow", system-ui, sans-serif`;
  while (c.measureText(word).width > 470 && size > 30) c.font = `800 ${(size -= 4)}px Overpass, "Arial Narrow", system-ui, sans-serif`;
  c.fillText(word, 256, 68);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  return texture;
}

export interface WallFrame {
  /** Start of the wall, on the ground line the shader measures from. */
  origin: THREE.Vector3;
  /** Along the wall, and out of it. */
  along: THREE.Vector3;
  out: THREE.Vector3;
  length: number;
}

/**
 * One instanced kind of thing. Everything placed is kept; each frame, only what is within `reach` of the camera is
 * drawn (a window surround four hundred metres off is a pixel), sorted by the sixty-metre cell it stands in so that
 * the drawn set is found by walking the cells around the camera, not the whole town.
 */
class Kind {
  readonly mesh: THREE.InstancedMesh;
  n = 0;
  private readonly all: { matrices: Float32Array; colours: Float32Array };
  private readonly cells = new Map<number, number[]>();
  private readonly m = new THREE.Matrix4();
  private readonly c = new THREE.Color();
  private lastCell = -1;
  private lastN = -1;

  constructor(geometry: THREE.BufferGeometry, material: THREE.Material, capacity: number, readonly reach: number, shadows: boolean) {
    this.mesh = new THREE.InstancedMesh(geometry, material, capacity);
    this.mesh.count = 0;
    this.mesh.castShadow = shadows;
    this.mesh.receiveShadow = true;
    this.mesh.frustumCulled = false;
    this.all = { matrices: new Float32Array(capacity * 16), colours: new Float32Array(capacity * 3) };
    this.mesh.setColorAt(0, this.c.set('#ffffff'));
  }

  put(m: THREE.Matrix4, colour: THREE.Color) {
    if (this.n >= this.mesh.instanceMatrix.count) return;
    m.toArray(this.all.matrices, this.n * 16);
    this.all.colours.set([colour.r, colour.g, colour.b], this.n * 3);
    const cell = Math.floor(m.elements[14] / 60) * 1000 + Math.floor(m.elements[12] / 60);
    let list = this.cells.get(cell);
    if (!list) this.cells.set(cell, (list = []));
    list.push(this.n);
    this.n++;
    this.lastN = -1;
  }

  /** Draw what is near `eye`: called every frame, and does nothing when neither the camera's cell nor the count has changed. */
  cull(eye: THREE.Vector3) {
    const cx = Math.floor(eye.x / 60);
    const cz = Math.floor(eye.z / 60);
    const here = cz * 1000 + cx;
    if (here === this.lastCell && this.n === this.lastN) return;
    this.lastCell = here;
    this.lastN = this.n;
    const r = Math.ceil(this.reach / 60);
    const reach2 = (this.reach + 42) ** 2;
    let k = 0;
    const cap = this.mesh.instanceMatrix.count;
    for (let dz = -r; dz <= r && k < cap; dz++)
      for (let dx = -r; dx <= r && k < cap; dx++) {
        const list = this.cells.get((cz + dz) * 1000 + cx + dx);
        if (!list) continue;
        for (const i of list) {
          const x = this.all.matrices[i * 16 + 12];
          const z = this.all.matrices[i * 16 + 14];
          if ((x - eye.x) ** 2 + (z - eye.z) ** 2 > reach2) continue;
          this.m.fromArray(this.all.matrices, i * 16);
          this.mesh.setMatrixAt(k, this.m);
          this.mesh.setColorAt(k, this.c.setRGB(this.all.colours[i * 3], this.all.colours[i * 3 + 1], this.all.colours[i * 3 + 2]));
          if (++k >= cap) break;
        }
      }
    this.mesh.count = k;
    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
  }
}

const box = (w: number, h: number, d: number, x = 0, y = 0, z = 0) => new THREE.BoxGeometry(w, h, d).translate(x, y, z);

/** A window surround in the units of a typical opening (1.3 by 1.8): jambs, a lintel, and a sill that sticks out. */
function surroundGeometry(): THREE.BufferGeometry {
  return mergeGeometries([box(0.11, 1.8 + 0.2, 0.07, -0.65 - 0.055, 0.1, 0.035), box(0.11, 1.8 + 0.2, 0.07, 0.65 + 0.055, 0.1, 0.035), box(1.3 + 0.22, 0.16, 0.08, 0, 0.9 + 0.08, 0.04), box(1.3 + 0.3, 0.09, 0.2, 0, -0.9 - 0.045, 0.1)])!;
}

/** Two shutters folded back against the wall, either side of a 1.3 by 1.8 opening, with a lighter frame and a darker middle. */
function shuttersGeometry(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  for (const side of [-1, 1]) {
    const x = side * (0.65 + 0.12 + 0.3);
    // The leaf, its two cross-battens, and the louvred middle standing a little proud.
    parts.push(box(0.6, 1.8, 0.06, x, 0, 0.03));
    parts.push(box(0.6, 0.1, 0.03, x, 0.6, 0.075));
    parts.push(box(0.6, 0.1, 0.03, x, -0.6, 0.075));
    for (let i = 0; i < 10; i++) parts.push(box(0.46, 0.035, 0.02, x, -0.45 + i * 0.1, 0.07));
    parts.push(box(0.46, 0.035, 0.02, x, 0.75, 0.07), box(0.46, 0.035, 0.02, x, -0.75, 0.07));
  }
  return mergeGeometries(parts)!;
}

/** A balcony: a slab and a railing, for a 1.3 opening; the instance stretches it to the window. */
function balconyGeometry(): THREE.BufferGeometry {
  // The slab sits at the sill, under the window; the railing rises from its edge.
  const w = 1.3 + 0.7;
  const floor = -0.9 - 0.1;
  const parts: THREE.BufferGeometry[] = [box(w, 0.12, 0.7, 0, floor, 0.35)];
  parts.push(box(w, 0.035, 0.035, 0, floor + 1.0, 0.69));
  for (let i = 0; i <= 8; i++) parts.push(box(0.02, 1.0, 0.02, -w / 2 + (i * w) / 8, floor + 0.5, 0.69));
  parts.push(box(w, 0.02, 0.02, 0, floor + 0.12, 0.69));
  for (const side of [-1, 1]) {
    parts.push(box(0.02, 1.0, 0.02, side * (w / 2), floor + 0.5, 0.35));
    parts.push(box(0.02, 0.035, 0.7, side * (w / 2), floor + 1.0, 0.35));
  }
  return mergeGeometries(parts)!;
}

/** An awning: canvas sloping out and down over the shopfront, with a valance. Unit width 1. */
function awningGeometry(): THREE.BufferGeometry {
  const canvas = new THREE.PlaneGeometry(1, 1.1);
  canvas.rotateX(-Math.PI / 2 + 0.5);
  canvas.translate(0, 0.25, 0.45);
  const valance = box(1, 0.22, 0.02, 0, -0.1, 0.95);
  const arms = [box(0.03, 0.03, 0.95, -0.47, 0.02, 0.47), box(0.03, 0.03, 0.95, 0.47, 0.02, 0.47)];
  const back = new THREE.PlaneGeometry(1, 1.1);
  back.rotateX(Math.PI / 2 + 0.5);
  back.translate(0, 0.25, 0.45);
  return mergeGeometries([canvas, back, valance, ...arms])!;
}

/** A door: a leaf with a step and a surround, for a 1.0 by 2.2 opening. */
function doorGeometry(): THREE.BufferGeometry {
  return mergeGeometries([box(1.0, 2.2, 0.05, 0, 0, 0.025), box(0.1, 2.3, 0.08, -0.55, 0.05, 0.04), box(0.1, 2.3, 0.08, 0.55, 0.05, 0.04), box(1.2, 0.14, 0.09, 0, 1.17, 0.045), box(1.3, 0.12, 0.35, 0, -1.16, 0.175), box(0.05, 0.05, 0.08, 0.32, -0.1, 0.06)])!;
}

function airConditioner(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[]=[box(.82,.52,.27,0,0,.17),box(.92,.045,.38,0,-.3,.2)];
  for(let i=0;i<8;i++) parts.push(box(.7,.025,.06,0,-.19+i*.055,.335));
  parts.push(new THREE.CylinderGeometry(.026,.026,.55,8).translate(.39,-.48,.14));
  return mergeGeometries(parts)!;
}

const NEON = ['#ff2bd6', '#22e8ff', '#8b5cff', '#ff3b5c', '#ffb020', '#39ff9c'];

export class Facades {
  readonly group = new THREE.Group();
  private readonly kinds: Record<'surround' | 'mullion' | 'shutters' | 'balcony' | 'cornice' | 'awning' | 'door' | 'pipe' | 'chimney' | 'aircon' | 'lamp' | 'neon' | 'neonUp', Kind>;
  /** Shopfront neon: unlit colour by day, brighter than white at night so that the bloom takes it. */
  private readonly neonMaterial = new THREE.MeshBasicMaterial({ toneMapped: false });
  /** One instanced board a word: a draw call each, and there are sixteen words. */
  private readonly signs: Kind[];
  private readonly blades: Kind[];
  private readonly signMaterials: THREE.MeshStandardMaterial[] = [];
  private readonly lampMaterial = new THREE.MeshStandardMaterial({ color: '#e8dec1', emissive: '#ffe1a4', emissiveIntensity: .1, roughness: .4 });
  private readonly shopLights: THREE.Vector3[] = [];
  private readonly lights = Array.from({ length: 4 }, () => new THREE.PointLight('#ffd4a0', 0, 15, 2));
  private readonly lightEye = new THREE.Vector3(Infinity, Infinity, Infinity);
  private lightCount = -1;
  private nearestLights: THREE.Vector3[] = [];
  private readonly m = new THREE.Matrix4();
  private readonly q = new THREE.Quaternion();
  private readonly pos = new THREE.Vector3();
  private readonly scale = new THREE.Vector3();
  private readonly colour = new THREE.Color();
  private readonly basis = new THREE.Matrix4();

  constructor() {
    // The colour of every instance comes with the instance; the materials have none of their own.
    const painted = new THREE.MeshStandardMaterial({ roughness: 0.85, metalness: 0 });
    const iron = new THREE.MeshStandardMaterial({ roughness: 0.5, metalness: 0.6 });
    const cloth = new THREE.MeshStandardMaterial({ roughness: 0.95, metalness: 0, side: THREE.DoubleSide });
    // The wall's frame (along, up, out) is left-handed, so a shape is built facing +z and turned round to face -z:
    // a turn, not a mirror, which is what keeps the faces the right way out.
    const turned = (g: THREE.BufferGeometry) => g.rotateY(Math.PI);
    // Each kind is drawn out to the distance at which it still shows, and only the big ones throw shadows.
    this.kinds = {
      surround: new Kind(turned(surroundGeometry()), painted, 90000, 220, false),
      mullion: new Kind(turned(mergeGeometries([box(.045,1.8,.065,0,0,.04),box(1.3,.045,.065,0,.12,.04)])!), painted, 90000, 115, false),
      shutters: new Kind(turned(shuttersGeometry()), painted, 70000, 200, false),
      balcony: new Kind(turned(balconyGeometry()), iron, 12000, 260, true),
      cornice: new Kind(turned(box(1, 0.28, 0.24, 0, 0, 0.12)), painted, 20000, 320, true),
      awning: new Kind(turned(awningGeometry()), cloth, 6000, 260, true),
      door: new Kind(turned(doorGeometry()), painted, 6000, 160, false),
      pipe: new Kind(new THREE.CylinderGeometry(0.055, 0.055, 1, 8).translate(0, 0.5, 0), iron, 5000, 120, false),
      chimney: new Kind(mergeGeometries([box(0.55, 1, 0.5, 0, 0.5, 0), box(0.65, 0.1, 0.6, 0, 1.0, 0), box(0.25, 0.25, 0.25, 0, 1.12, 0)])!, painted, 5000, 400, true),
      aircon: new Kind(turned(airConditioner()), iron, 7000, 125, true),
      lamp: new Kind(turned(box(.26,.065,.36,0,0,.2)), this.lampMaterial, 7000, 180, false),
      neon: new Kind(turned(box(1, 0.08, 0.08, 0, 0, 0.1)), this.neonMaterial, 9000, 220, false),
      neonUp: new Kind(turned(box(0.08, 1, 0.08, 0, 0, 0.1)), this.neonMaterial, 18000, 200, false),
    };
    for (const kind of Object.values(this.kinds)) this.group.add(kind.mesh);
    // A board with the word on its face; the thin sides and the back (in the wall) carry a smear of it nobody sees.
    const board = turned(box(1, 0.42, 0.05, 0, 0, 0.025));
    this.signs = SHOPS.map(([word, colour, letters]) => {
      const texture=signTexture(word, colour, letters);
      const material=new THREE.MeshStandardMaterial({ map:texture, emissiveMap:texture, emissive:'#ffffff', emissiveIntensity:.08, roughness:.42, metalness:.14 });
      this.signMaterials.push(material);
      return new Kind(board,material,1200,200,false);
    });
    const blade=turned(box(.08,.75,1.2,0,0,.68));
    this.blades=this.signMaterials.map(material=>new Kind(blade,material,600,160,true));
    for (const kind of [...this.signs, ...this.blades]) this.group.add(kind.mesh);
    this.group.add(...this.lights);
  }

  /** The matrix that puts a unit shape on the wall: x along it, y up, and (the shapes being turned) -z out of it. */
  private place(kind: Kind, frame: WallFrame, u: number, y: number, sx: number, sy: number, sz: number, colour: THREE.Color, lift = 0) {
    const f = frame;
    this.basis.makeBasis(f.along, new THREE.Vector3(0, 1, 0), v1.copy(f.out).negate());
    this.q.setFromRotationMatrix(this.basis);
    this.pos.copy(f.origin).addScaledVector(f.along, u).addScaledVector(f.out, lift);
    this.pos.y += y;
    kind.put(this.m.compose(this.pos, this.q, this.scale.set(sx, sy, sz)), colour);
  }

  /** Every window of a wall: its surround, its shutters, and a balcony when the building has them. */
  windows(frame: WallFrame, run: number, seed: number, storeys: number, tall: number, shop: boolean, south: boolean, balconied: boolean, wallColour: THREE.Color, shutterColour: THREE.Color) {
    const bay = bayOf(seed);
    const first = Math.ceil(run / bay);
    const last = Math.floor((run + frame.length) / bay) - 1;
    const stone = this.colour.copy(wallColour).lerp(new THREE.Color('#f2ece0'), 0.55).clone();
    for (let cell = first; cell <= last; cell++) {
      const u = cell * bay - run;
      for (let storey = 0; storey < storeys; storey++) {
        const ground = storey === 0;
        const o = ground && shop ? OPENING.shop : OPENING.window;
        // The window's rectangle on the wall.
        const w = (o.x1 - o.x0) * bay;
        const h = (o.y1 - o.y0) * FLOOR;
        const cx = u + ((o.x0 + o.x1) / 2) * bay;
        const cy = storey * FLOOR + ((o.y0 + o.y1) / 2) * FLOOR;
        if (cy + h / 2 > tall - 0.7) continue;
        const [sx, sy] = [w / 1.3, h / 1.8];
        this.place(this.kinds.mullion, frame, cx, cy, sx, sy, 1, this.colour.set(south ? '#b5b0a0' : '#574e43'));
        if (ground && shop) {
          // A shopfront: a thin frame, a fascia with the shop's name over it, and an awning over some.
          this.place(this.kinds.surround, frame, cx, cy, sx, sy, 0.6, this.colour.set('#4a4540'));
          if (fh(cell, seed) > 0.5) this.place(this.kinds.awning, frame, cx, cy + h / 2 - 0.1, w + 0.3, 1, 1, this.colour.set(AWNINGS[Math.floor(fh(cell, seed + 3) * AWNINGS.length)]));
          // A shop takes two or three bays; one sign runs the length of its front, from its first bay.
          const run = 2 + Math.floor(fh(Math.floor(cell / 3), seed + 11) * 2);
          if ((cell - first) % run === 0) {
            const bays = Math.min(run, last - cell + 1);
            const which = Math.floor(fh(cell, seed + 17) * this.signs.length);
            // A word over one shop in three, and a hanging sign over few of those: the real names do the talking.
            if (fh(cell, seed + 81) < 0.34) {
              this.place(this.signs[which], frame, u + (bays * bay) / 2, cy + h / 2 + 0.28, bays * bay - 0.35, 1, 1, this.colour.set('#ffffff'));
              if (fh(cell, seed + 51) > 0.8) this.place(this.blades[which], frame, u + 0.24, 3.7, 1, 1, 1, this.colour.set('#ffffff'));
            }
            this.place(this.kinds.lamp,frame,cx,3.08,1,1,1,this.colour.set('#ffffff'));
            // Neon round the front: a tube under the sign and one up each side, in the shop's own colour.
            const tube = this.colour.set(NEON[Math.floor(fh(cell, seed + 71) * NEON.length)]).clone();
            const [left, right, top] = [u + 0.12, u + bays * bay - 0.12, cy + h / 2 + 0.04];
            this.place(this.kinds.neon, frame, (left + right) / 2, top, right - left, 1, 1, tube);
            for (const x of [left, right]) this.place(this.kinds.neonUp, frame, x, (0.35 + top) / 2, 1, top - 0.35, 1, tube);
            const light=frame.origin.clone().addScaledVector(frame.along,u+(bays*bay)/2).addScaledVector(frame.out,.85);
            light.y+=2.6;
            this.shopLights.push(light);
          }
          continue;
        }
        this.place(this.kinds.surround, frame, cx, cy, sx, sy, 1, stone);
        if (south) this.place(this.kinds.shutters, frame, cx, cy, sx, sy, 1, shutterColour);
        if (balconied && storey >= 1 && (storey === 1 || fh(cell + 7, storey) > 0.5)) this.place(this.kinds.balcony, frame, cx, cy, sx, sy, 1, this.colour.set('#2a2c30'));
        if (storey===1 && fh(cell,seed+61)>.81) this.place(this.kinds.aircon,frame,cx,cy-h/2-.5,1,1,1,this.colour.set('#ada99d'));
      }
    }
  }

  cornice(frame: WallFrame, y: number, colour: THREE.Color) {
    this.place(this.kinds.cornice, frame, frame.length / 2, y, frame.length, 1, 1, this.colour.copy(colour).lerp(new THREE.Color('#f2ece0'), 0.4));
  }

  door(frame: WallFrame, u: number, colour: THREE.Color) {
    this.place(this.kinds.door, frame, u, 1.1, 1, 1, 1, colour);
  }

  pipe(frame: WallFrame, u: number, height: number) {
    this.place(this.kinds.pipe, frame, u, 0, 1, height, 1, this.colour.set('#6d7378'), 0.1);
  }

  chimney(at: THREE.Vector3, along: THREE.Vector3, out: THREE.Vector3, colour: THREE.Color) {
    this.basis.makeBasis(along, new THREE.Vector3(0, 1, 0), v1.copy(out).negate());
    this.q.setFromRotationMatrix(this.basis);
    this.kinds.chimney.put(this.m.compose(at, this.q, this.scale.set(1, 1, 1)), colour);
  }

  /** Every frame: draw what is near the camera. */
  update(eye: THREE.Vector3, night: number) {
    for (const kind of Object.values(this.kinds)) kind.cull(eye);
    for (const kind of [...this.signs,...this.blades]) kind.cull(eye);
    for (const material of this.signMaterials) material.emissiveIntensity=.08+night*1.35;
    this.lampMaterial.emissiveIntensity=.1+night*2.8;
    this.neonMaterial.color.setScalar(0.3 + night * 3.2);
    if (eye.distanceToSquared(this.lightEye)>16 || this.lightCount!==this.shopLights.length) {
      this.lightEye.copy(eye); this.lightCount=this.shopLights.length;
      this.nearestLights=this.shopLights.filter(p=>p.distanceToSquared(eye)<65*65).sort((a,b)=>a.distanceToSquared(eye)-b.distanceToSquared(eye)).slice(0,this.lights.length);
    }
    this.lights.forEach((light,i)=>{const p=this.nearestLights[i];light.intensity=p?night*32:0;light.color.set(i%3===0?'#c2dfec':'#ffd4a0');if(p)light.position.copy(p);});
  }

  get counts(): Record<string, number> {
    return { ...Object.fromEntries(Object.entries(this.kinds).map(([name, kind]) => [name, kind.n])), signs: this.signs.reduce((sum, k) => sum + k.n, 0), blades:this.blades.reduce((sum,k)=>sum+k.n,0) };
  }

  dispose() {
    for (const kind of [...Object.values(this.kinds), ...this.signs, ...this.blades]) {
      kind.mesh.geometry.dispose();
      const material = kind.mesh.material as THREE.MeshStandardMaterial;
      material.map?.dispose();
      material.dispose();
    }
  }
}
