// The town after dark, as it would like to be seen: neon along the rooflines, strips up the corners of the tall
// ones, and billboards on their roofs selling taxis, pastis and the meter itself, animated. Everything is
// unlit geometry in colours brighter than white, so that the bloom does the glowing; it is built alongside the
// buildings (so it rises with them) and only switched on as the light goes.

import * as THREE from 'three';
import type { Building, Pt } from '../../city/osm';
import type { NearbyPlace } from '../../maps/google';

const TUBES = ['#ff2bd6', '#22e8ff', '#8b5cff', '#ff3b5c', '#ffb020', '#39ff9c'];
const ADS: Array<{ words: string; small: string; colour: string; glow: string }> = [
  { words: 'TAXI 24/24', small: 'TARIF C · TOUJOURS', colour: '#22e8ff', glow: '#0b8fa8' },
  { words: 'PASTIS', small: 'UN JAUNE, UN SEUL', colour: '#ffd23c', glow: '#b07a00' },
  { words: 'COMPTEUR +300%', small: 'SUPPLÉMENT NUIT · SUPPLÉMENT VUE MER', colour: '#ff2bd6', glow: '#9e1285' },
  { words: 'HÔTEL', small: 'CHAMBRES · PARKING · MISTRAL', colour: '#ff3b5c', glow: '#a3122c' },
  { words: 'PHARMACIE', small: 'OUVERTE · FERMÉE · ON VERRA', colour: '#39ff9c', glow: '#0f8a4c' },
  { words: 'BAGAGE INVISIBLE', small: '+1,90 € · NON NÉGOCIABLE', colour: '#8b5cff', glow: '#4a26a8' },
  { words: 'CAFÉ', small: 'EXPRESS · SERRÉ · 4 €', colour: '#ffb020', glow: '#a86400' },
  { words: 'CLIMATISÉ', small: 'LA FENÊTRE, C’EST MIEUX', colour: '#22e8ff', glow: '#0b8fa8' },
];
const SLOTS = ADS.length;
/** What a kind of place is called on a billboard. */
const TRADES: Record<string, string> = { cafe: 'CAFÉ', bar: 'BAR', wine_bar: 'BAR À VIN', pub: 'PUB', restaurant: 'RESTAURANT', bakery: 'BOULANGERIE', pharmacy: 'PHARMACIE', hotel: 'HÔTEL', florist: 'FLEURISTE', hair_care: 'COIFFEUR', night_club: 'CLUB', ice_cream_shop: 'GLACIER', supermarket: 'SUPERMARCHÉ', book_store: 'LIBRAIRIE', clothing_store: 'MODE' };

function hash(n: number): number {
  const x = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return x - Math.floor(x);
}

/** Flat quads straight into arrays: thousands of tubes, one draw call a colour set. */
class Strips {
  readonly position: number[] = [];
  readonly colour: number[] = [];
  readonly uv: number[] = [];
  readonly index: number[] = [];

  /** `outward`: the quad runs along a wall and must face away from it, text reading the right way from outside. */
  quad(a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3, d: THREE.Vector3, rgb: THREE.Color, uv?: [number, number, number, number], outward = false) {
    const base = this.position.length / 3;
    for (const p of [a, b, c, d]) this.position.push(p.x, p.y, p.z);
    for (let i = 0; i < 4; i++) this.colour.push(rgb.r, rgb.g, rgb.b);
    const [u0, v0, u1, v1] = uv ?? [0, 0, 1, 1];
    if (outward) {
      this.uv.push(u1, v0, u0, v0, u0, v1, u1, v1);
      this.index.push(base, base + 2, base + 1, base, base + 3, base + 2);
    } else {
      this.uv.push(u0, v0, u1, v0, u1, v1, u0, v1);
      this.index.push(base, base + 1, base + 2, base, base + 2, base + 3);
    }
  }

  geometry(): THREE.BufferGeometry | null {
    if (!this.index.length) return null;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.position, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.colour, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    g.setIndex(this.index);
    g.computeBoundingSphere();
    return g;
  }
}

export class Neon {
  /** Shared by every piece of town: the tubes, and the billboards' animated faces. */
  private readonly tubes = new THREE.MeshBasicMaterial({ vertexColors: true, toneMapped: false, side: THREE.DoubleSide, fog: true });
  private readonly canvas = document.createElement('canvas');
  private readonly ads: THREE.CanvasTexture;
  private readonly boards: THREE.MeshBasicMaterial;
  private readonly backs = new THREE.MeshStandardMaterial({ color: '#15161a', roughness: 0.6, metalness: 0.4, side: THREE.DoubleSide });
  private readonly meshes: THREE.Object3D[] = [];
  private strips = new Strips();
  private faces = new Strips();
  private frames = new Strips();
  /** The boards' adverts: the stock ones until the town's real places and the ride itself replace some. */
  private readonly adverts = ADS.map((ad) => ({ ...ad }));
  private redrawIn = 0;
  private clock = 0;
  private level = -1;

  constructor() {
    this.canvas.width = 1024;
    this.canvas.height = 128 * SLOTS;
    this.ads = new THREE.CanvasTexture(this.canvas);
    this.ads.colorSpace = THREE.SRGBColorSpace;
    this.ads.anisotropy = 4;
    this.boards = new THREE.MeshBasicMaterial({ map: this.ads, toneMapped: false, fog: true });
    this.draw();
  }

  /** One building: a tube round its roof (some of them), strips up its corners and a billboard (the tall ones). */
  add(b: Building, points: Pt[], level: number, h: number) {
    if (b.monument || points.length < 3) return;
    const r = hash(b.id * 3.1);
    const top = level + h;
    const colour = new THREE.Color(TUBES[Math.floor(hash(b.id * 7.7) * TUBES.length)]);
    const out = (i: number) => {
      const [p, q] = [points[i], points[(i + 1) % points.length]];
      const len = Math.hypot(q[0] - p[0], q[1] - p[1]) || 1;
      return { p, q, len, nx: (q[1] - p[1]) / len, nz: -(q[0] - p[0]) / len };
    };
    const v = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);

    // The roofline: a tube a hand's width below the edge, facing out, and its top.
    if (r < 0.55 && h >= 5) {
      const y = top - 0.18;
      for (let i = 0; i < points.length; i++) {
        const { p, q, len, nx, nz } = out(i);
        if (len < 1.2) continue;
        const o = 0.06;
        const [ax, az, bx, bz] = [p[0] + nx * o, p[1] + nz * o, q[0] + nx * o, q[1] + nz * o];
        this.strips.quad(v(ax, y - 0.08, az), v(bx, y - 0.08, bz), v(bx, y + 0.08, bz), v(ax, y + 0.08, az), colour);
      }
    }
    // Strips up the corners of the tall ones, in a second colour.
    if (h >= 14 && hash(b.id * 5.3) < 0.55) {
      const second = new THREE.Color(TUBES[Math.floor(hash(b.id * 9.1) * TUBES.length)]);
      for (let i = 0; i < points.length; i += Math.max(1, Math.floor(points.length / 4))) {
        const { p } = out(i);
        const prev = out((i - 1 + points.length) % points.length);
        const [dx, dz] = [(out(i).nx + prev.nx) * 0.5, (out(i).nz + prev.nz) * 0.5];
        const [x, z] = [p[0] + dx * 0.08, p[1] + dz * 0.08];
        const w = 0.06;
        this.strips.quad(v(x - w, level + 3.2, z), v(x + w, level + 3.2, z), v(x + w, top - 0.3, z), v(x - w, top - 0.3, z), second);
        this.strips.quad(v(x, level + 3.2, z - w), v(x, level + 3.2, z + w), v(x, top - 0.3, z + w), v(x, top - 0.3, z - w), second);
      }
    }
    // A billboard on the roof of the tall ones, along the longest side, facing out over the street.
    if (h >= 10 && hash(b.id * 11.3) < 0.4) {
      let best = 0;
      for (let i = 1; i < points.length; i++) if (out(i).len > out(best).len) best = i;
      const { p, q, len, nx, nz } = out(best);
      if (len >= 7) {
        const w = Math.min(14, len * 0.7);
        const hgt = w / 4;
        const [mx, mz] = [(p[0] + q[0]) / 2 - nx * 0.8, (p[1] + q[1]) / 2 - nz * 0.8];
        const [ax, az] = [(q[0] - p[0]) / len, (q[1] - p[1]) / len];
        const y0 = top + 1.0;
        const slot = Math.floor(hash(b.id * 13.7) * SLOTS);
        const [v0, v1] = [1 - (slot + 1) / SLOTS, 1 - slot / SLOTS];
        const [lx, lz, rx, rz] = [mx - (ax * w) / 2, mz - (az * w) / 2, mx + (ax * w) / 2, mz + (az * w) / 2];
        const face = new THREE.Color(1, 1, 1);
        this.faces.quad(v(lx + nx * 0.02, y0, lz + nz * 0.02), v(rx + nx * 0.02, y0, rz + nz * 0.02), v(rx + nx * 0.02, y0 + hgt, rz + nz * 0.02), v(lx + nx * 0.02, y0 + hgt, lz + nz * 0.02), face, [0, v0, 1, v1], true);
        // The back and the legs it stands on.
        const dark = new THREE.Color(1, 1, 1);
        this.frames.quad(v(lx - nx * 0.04, y0 - 0.12, lz - nz * 0.04), v(rx - nx * 0.04, y0 - 0.12, rz - nz * 0.04), v(rx - nx * 0.04, y0 + hgt + 0.12, rz - nz * 0.04), v(lx - nx * 0.04, y0 + hgt + 0.12, lz - nz * 0.04), dark);
        for (const k of [0.2, 0.8]) {
          const [x, z] = [lx + (rx - lx) * k, lz + (rz - lz) * k];
          this.frames.quad(v(x - ax * 0.08, top, z - az * 0.08), v(x + ax * 0.08, top, z + az * 0.08), v(x + ax * 0.08, y0, z + az * 0.08), v(x - ax * 0.08, y0, z - az * 0.08), dark);
        }
      }
    }
  }

  /** The tubes and boards of this piece of town, as meshes to stand with its buildings. */
  flush(): THREE.Object3D[] {
    const made: THREE.Object3D[] = [];
    const tubes = this.strips.geometry();
    const faces = this.faces.geometry();
    const frames = this.frames.geometry();
    if (tubes) made.push(new THREE.Mesh(tubes, this.tubes));
    if (faces) made.push(new THREE.Mesh(faces, this.boards));
    if (frames) made.push(Object.assign(new THREE.Mesh(frames, this.backs), { castShadow: true }));
    for (const m of made) m.userData.neon = true;
    this.meshes.push(...made);
    this.strips = new Strips();
    this.faces = new Strips();
    this.frames = new Strips();
    return made;
  }

  /** The adverts, drawn again a few times a second: a ticker runs along the bottom of each, and they flicker. */
  private draw() {
    const c = this.canvas.getContext('2d')!;
    const W = this.canvas.width;
    const H = 128;
    c.clearRect(0, 0, W, this.canvas.height);
    this.adverts.forEach((ad, i) => {
      const y = i * H;
      const g = c.createLinearGradient(0, y, 0, y + H);
      g.addColorStop(0, '#07060c');
      g.addColorStop(1, '#120a1c');
      c.fillStyle = g;
      c.fillRect(0, y, W, H);
      // A border tube round the board.
      c.strokeStyle = ad.colour;
      c.lineWidth = 4;
      c.shadowColor = ad.colour;
      c.shadowBlur = 14;
      c.strokeRect(6, y + 6, W - 12, H - 12);
      // The words, and now and then a letter that goes out.
      const flicker = Math.sin(this.clock * (3 + i) + i * 7) > 0.93 ? 0.35 : 1;
      c.globalAlpha = flicker;
      c.fillStyle = ad.colour;
      c.shadowBlur = 22;
      c.font = '900 64px Overpass, system-ui, sans-serif';
      c.textAlign = 'center';
      c.textBaseline = 'middle';
      c.fillText(ad.words, W / 2, y + H * 0.42, W - 60);
      c.globalAlpha = 1;
      // The ticker.
      c.shadowBlur = 6;
      c.fillStyle = ad.glow;
      c.font = '700 20px Overpass, system-ui, sans-serif';
      c.textAlign = 'left';
      const line = `${ad.small}   ·   `;
      const width = c.measureText(line).width;
      const shift = (this.clock * 60 + i * 97) % width;
      for (let x = -shift + 16; x < W - 16; x += width) c.fillText(line, x, y + H * 0.82);
    });
    c.shadowBlur = 0;
    this.ads.needsUpdate = true;
  }

  /** The real places of the town take half the boards: their names, and what they are. */
  setNames(places: NearbyPlace[]) {
    const picked = places.filter((p) => p.name.length <= 22).slice(0, 4);
    picked.forEach((p, i) => {
      const slot = this.adverts[1 + i * 2];
      slot.words = p.name.toUpperCase();
      slot.small = `${TRADES[p.type] ?? 'OUVERT'} · À DEUX PAS · LE CHAUFFEUR CONNAÎT`;
    });
  }

  /** The first board is about you: the meter as it stands and the minutes he says are left. */
  setLive(fare: number | null, eta: number) {
    const slot = this.adverts[0];
    if (fare === null) {
      Object.assign(slot, { words: ADS[0].words, small: ADS[0].small });
      return;
    }
    slot.words = `${fare.toFixed(2).replace('.', ',')} €`;
    slot.small = eta > 0 ? `VOTRE COURSE · ENCORE ${eta} MIN · PARFAITEMENT NORMAL` : 'VOTRE COURSE · PARFAITEMENT NORMAL';
  }

  /** Every frame: lit as the light goes; the adverts move while they are lit. */
  update(dt: number, night: number) {
    const on = night > 0.04;
    for (const m of this.meshes) m.visible = on;
    if (!on) return;
    this.clock += dt;
    // Brighter than white, so that the bloom takes them; a slow breath in the tubes.
    const k = night * (2.6 + 0.25 * Math.sin(this.clock * 1.7));
    if (Math.abs(k - this.level) > 0.01) {
      this.level = k;
      this.tubes.color.setScalar(k);
      this.boards.color.setScalar(night * 1.9);
    }
    this.redrawIn -= dt;
    if (this.redrawIn <= 0) {
      this.redrawIn = 1 / 8;
      this.draw();
    }
  }

  dispose() {
    for (const m of this.meshes) if (m instanceof THREE.Mesh) m.geometry.dispose();
    this.tubes.dispose();
    this.boards.dispose();
    this.backs.dispose();
    this.ads.dispose();
  }
}
