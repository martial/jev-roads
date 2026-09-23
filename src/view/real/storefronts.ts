// The real shops of the place, by name: what Google Places knows is there (a café, a bar, a pharmacy, a bakery)
// gets its own sign above the ground floor of the nearest wall, in neon of a colour for its trade. The town's
// invented signs are few; these are the ones worth reading, because they are true.

import * as THREE from 'three';
import type { NearbyPlace } from '../../maps/google';
import { SIZE } from '../../city/osm';

/** A ground-floor wall, facing out: where a sign could go. */
export interface Wall {
  p: [number, number];
  q: [number, number];
  level: number;
  nx: number;
  nz: number;
  len: number;
}

const COLOURS: Record<string, string> = {
  cafe: '#ffb020', bakery: '#ffd23c', ice_cream_shop: '#ffd23c',
  bar: '#ff2bd6', wine_bar: '#ff2bd6', pub: '#ff2bd6', night_club: '#8b5cff',
  restaurant: '#ff3b5c', pharmacy: '#39ff9c', hotel: '#22e8ff',
  florist: '#39ff9c', hair_care: '#ff2bd6',
};
const MAX = 36;
const SLOT = 96;

export class Storefronts {
  readonly group = new THREE.Group();
  private readonly walls: Wall[] = [];
  private places: NearbyPlace[] = [];
  private origin = { lat: 0, lon: 0 };
  private readonly canvas = document.createElement('canvas');
  private readonly texture: THREE.CanvasTexture;
  private readonly material: THREE.MeshBasicMaterial;
  private mesh: THREE.Mesh | null = null;
  private dirty = false;
  private since = 0;

  constructor() {
    this.canvas.width = 1024;
    this.canvas.height = SLOT * MAX;
    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.colorSpace = THREE.SRGBColorSpace;
    this.texture.anisotropy = 4;
    this.material = new THREE.MeshBasicMaterial({ map: this.texture, toneMapped: false, transparent: true, fog: true });
  }

  /** The names of the place, once Google has answered. */
  setPlaces(places: NearbyPlace[], origin: { lat: number; lon: number }) {
    this.places = places;
    this.origin = origin;
    this.dirty = true;
  }

  /** More of the town has been built: more walls to hang signs on. */
  addWalls(walls: Wall[]) {
    this.walls.push(...walls);
    this.dirty = true;
  }

  /** The names nearest the middle first, for the billboards. */
  get names(): NearbyPlace[] {
    return this.places;
  }

  private build() {
    this.dirty = false;
    if (this.mesh) {
      this.group.remove(this.mesh);
      this.mesh.geometry.dispose();
      this.mesh = null;
    }
    if (!this.places.length || !this.walls.length) return;
    const kx = 111320 * Math.cos((this.origin.lat * Math.PI) / 180);
    const taken = new Set<Wall>();
    const position: number[] = [];
    const uv: number[] = [];
    const index: number[] = [];
    const c = this.canvas.getContext('2d')!;
    c.clearRect(0, 0, this.canvas.width, this.canvas.height);
    let slot = 0;
    for (const place of this.places) {
      if (slot >= MAX) break;
      const x = (place.lon - this.origin.lon) * kx + SIZE / 2;
      const z = -(place.lat - this.origin.lat) * 111320 + SIZE / 2;
      // The nearest free wall, long enough, within twenty-five metres.
      let best: { wall: Wall; d: number; t: number } | null = null;
      for (const wall of this.walls) {
        if (taken.has(wall) || wall.len < 3) continue;
        const [ax, az] = wall.p;
        const [dx, dz] = [(wall.q[0] - ax) / wall.len, (wall.q[1] - az) / wall.len];
        const t = Math.max(1.2, Math.min(wall.len - 1.2, (x - ax) * dx + (z - az) * dz));
        const d = Math.hypot(ax + dx * t - x, az + dz * t - z);
        if (d < 25 && (!best || d < best.d)) best = { wall, d, t };
      }
      if (!best) continue;
      taken.add(best.wall);
      const { wall, t } = best;
      const name = place.name.length > 26 ? `${place.name.slice(0, 25)}…` : place.name;
      const colour = COLOURS[place.type] ?? '#22e8ff';
      const used = this.paint(c, slot, name, colour);
      // The board: as wide as its name at 55 cm tall, smaller if the wall is short; just above the ground floor.
      let h = 0.55;
      let w = (h * used) / SLOT;
      if (w > wall.len - 0.6) {
        h *= (wall.len - 0.6) / w;
        w = wall.len - 0.6;
      }
      const [dx, dz] = [(wall.q[0] - wall.p[0]) / wall.len, (wall.q[1] - wall.p[1]) / wall.len];
      const t0 = Math.max(w / 2 + 0.2, Math.min(wall.len - w / 2 - 0.2, t));
      const [cx, cz] = [wall.p[0] + dx * t0 + wall.nx * 0.14, wall.p[1] + dz * t0 + wall.nz * 0.14];
      const y = wall.level + 3.35;
      const base = position.length / 3;
      position.push(cx - (dx * w) / 2, y, cz - (dz * w) / 2, cx + (dx * w) / 2, y, cz + (dz * w) / 2, cx + (dx * w) / 2, y + h, cz + (dz * w) / 2, cx - (dx * w) / 2, y + h, cz - (dz * w) / 2);
      const [v0, v1] = [1 - (slot + 1) / MAX, 1 - slot / MAX];
      // Seen from the street, the wall's own direction runs right to left: the name starts at its far end, and the
      // triangles turn to face out (the other way round they face into the wall, and are not drawn).
      const u1 = used / this.canvas.width;
      uv.push(u1, v0, 0, v0, 0, v1, u1, v1);
      index.push(base, base + 2, base + 1, base, base + 3, base + 2);
      slot++;
    }
    this.texture.needsUpdate = true;
    if (!index.length) return;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(position, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.setIndex(index);
    g.computeBoundingSphere();
    this.mesh = new THREE.Mesh(g, this.material);
    this.group.add(this.mesh);
  }

  /** One name in neon on a dark board, with a tube round it, from the left of its strip. Returns the pixels used. */
  private paint(c: CanvasRenderingContext2D, slot: number, name: string, colour: string): number {
    const y = slot * SLOT;
    const W = this.canvas.width;
    let size = 58;
    c.font = `800 ${size}px Overpass, system-ui, sans-serif`;
    while (c.measureText(name).width > W - 70 && size > 26) c.font = `800 ${(size -= 2)}px Overpass, system-ui, sans-serif`;
    const used = Math.min(W, Math.ceil(c.measureText(name).width) + 64);
    c.fillStyle = 'rgba(8,8,14,0.92)';
    c.fillRect(2, y + 4, used - 4, SLOT - 8);
    c.strokeStyle = colour;
    c.shadowColor = colour;
    c.shadowBlur = 12;
    c.lineWidth = 4;
    c.strokeRect(9, y + 10, used - 18, SLOT - 20);
    c.fillStyle = colour;
    c.shadowBlur = 18;
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    c.fillText(name, used / 2, y + SLOT / 2 + 3);
    c.shadowBlur = 0;
    return used;
  }

  update(dt: number, night: number) {
    this.since += dt;
    // Rebuilt at most twice a second while the town is still arriving.
    if (this.dirty && this.since > 0.5) {
      this.since = 0;
      this.build();
    }
    // Readable by day, glowing by night.
    this.material.color.setScalar(0.85 + night * 1.7);
  }

  dispose() {
    this.mesh?.geometry.dispose();
    this.material.dispose();
    this.texture.dispose();
  }
}
