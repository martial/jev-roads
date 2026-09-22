// The world as blocks, and the mesher that turns a chunk of it into triangles. Nothing here touches
// three.js: the mesher also runs inside web workers, several chunks at a time.

import { COLOR, GLOW, LIQUID, SLAB, SMALL_H, SMALL_W, VARY, isOpen } from './blocks';

export const SX = 1024;
export const SY = 64;
export const SZ = 1024;
export const CHUNK = 32;
export const CHUNKS_X = SX / CHUNK;
export const CHUNKS_Z = SZ / CHUNK;

/** Anything the mesher can read blocks from, in world coordinates. */
export interface Grid {
  get(x: number, y: number, z: number): number;
}

/** The world: one byte per block, plus which chunks need remeshing. */
export class Voxels implements Grid {
  readonly data = new Uint8Array(SX * SY * SZ);
  readonly dirty = new Set<number>();

  get(x: number, y: number, z: number): number {
    if (x < 0 || y < 0 || z < 0 || x >= SX || y >= SY || z >= SZ) return 0;
    return this.data[(y * SZ + z) * SX + x];
  }

  solid(x: number, y: number, z: number): boolean {
    return !isOpen(this.get(x, y, z));
  }

  set(x: number, y: number, z: number, id: number) {
    if (x < 0 || y < 0 || z < 0 || x >= SX || y >= SY || z >= SZ) return;
    const i = (y * SZ + z) * SX + x;
    if (this.data[i] === id) return;
    this.data[i] = id;
    const cx = Math.floor(x / CHUNK);
    const cz = Math.floor(z / CHUNK);
    this.dirty.add(cz * CHUNKS_X + cx);
    // A block on a chunk border changes its neighbour's faces and shading too.
    const lx = x - cx * CHUNK;
    const lz = z - cz * CHUNK;
    if (lx === 0 && cx > 0) this.dirty.add(cz * CHUNKS_X + cx - 1);
    if (lx === CHUNK - 1 && cx < CHUNKS_X - 1) this.dirty.add(cz * CHUNKS_X + cx + 1);
    if (lz === 0 && cz > 0) this.dirty.add((cz - 1) * CHUNKS_X + cx);
    if (lz === CHUNK - 1 && cz < CHUNKS_Z - 1) this.dirty.add((cz + 1) * CHUNKS_X + cx);
  }

  /** Highest solid block in a column, or -1. */
  top(x: number, z: number): number {
    for (let y = SY - 1; y >= 0; y--) if (this.solid(x, y, z)) return y;
    return -1;
  }

  /** A chunk and one block of its surroundings, copied out so a worker can mesh it on its own. */
  slab(cx: number, cz: number): Uint8Array {
    const w = CHUNK + 2;
    const out = new Uint8Array(w * SY * w);
    const x0 = cx * CHUNK - 1;
    const z0 = cz * CHUNK - 1;
    const from = Math.max(0, x0);
    const to = Math.min(SX, x0 + w);
    for (let y = 0; y < SY; y++)
      for (let lz = 0; lz < w; lz++) {
        const z = z0 + lz;
        if (z < 0 || z >= SZ) continue;
        const row = (y * SZ + z) * SX;
        out.set(this.data.subarray(row + from, row + to), (y * w + lz) * w + (from - x0));
      }
    return out;
  }
}

/** The copy a worker works on: answers in world coordinates, like the world itself. */
export class Slab implements Grid {
  private readonly w = CHUNK + 2;
  constructor(
    private readonly data: Uint8Array,
    private readonly x0: number,
    private readonly z0: number,
  ) {}

  get(x: number, y: number, z: number): number {
    const lx = x - this.x0;
    const lz = z - this.z0;
    if (lx < 0 || lz < 0 || lx >= this.w || lz >= this.w || y < 0 || y >= SY) return 0;
    return this.data[(y * this.w + lz) * this.w + lx];
  }
}

// Faces: outward normal and four corners, counter-clockwise seen from outside.
const FACES = [
  { n: [1, 0, 0], c: [[1, 0, 0], [1, 1, 0], [1, 1, 1], [1, 0, 1]] },
  { n: [-1, 0, 0], c: [[0, 0, 1], [0, 1, 1], [0, 1, 0], [0, 0, 0]] },
  { n: [0, 1, 0], c: [[0, 1, 1], [1, 1, 1], [1, 1, 0], [0, 1, 0]] },
  { n: [0, -1, 0], c: [[0, 0, 0], [1, 0, 0], [1, 0, 1], [0, 0, 1]] },
  { n: [0, 0, 1], c: [[1, 0, 1], [1, 1, 1], [0, 1, 1], [0, 0, 1]] },
  { n: [0, 0, -1], c: [[0, 0, 0], [0, 1, 0], [1, 1, 0], [1, 0, 0]] },
] as const;

/** Brightness for 0..3 open neighbours at a corner: the soft contact shadow that makes voxels read. */
const AO = [0.46, 0.66, 0.84, 1];

function hash(x: number, y: number, z: number): number {
  let h = Math.imul(x, 374761393) ^ Math.imul(y, 668265263) ^ Math.imul(z, 1274126177);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/** Triangles as plain typed arrays: cheap to hand from a worker to the page. */
export interface MeshArrays {
  positions: Float32Array;
  normals: Float32Array;
  colors: Float32Array;
  indices: Uint32Array;
}

export interface ChunkArrays {
  solid: MeshArrays | null;
  glow: MeshArrays | null;
  liquid: MeshArrays | null;
}

class MeshData {
  positions: number[] = [];
  normals: number[] = [];
  colors: number[] = [];
  indices: number[] = [];

  pack(): MeshArrays | null {
    if (!this.indices.length) return null;
    return { positions: new Float32Array(this.positions), normals: new Float32Array(this.normals), colors: new Float32Array(this.colors), indices: new Uint32Array(this.indices) };
  }
}

const ao4 = [0, 0, 0, 0];

export function meshChunk(v: Grid, cx: number, cz: number): ChunkArrays {
  const solid = new MeshData();
  const glow = new MeshData();
  const liquid = new MeshData();
  const x0 = cx * CHUNK;
  const z0 = cz * CHUNK;
  const full = (x: number, y: number, z: number) => !isOpen(v.get(x, y, z));

  for (let y = 0; y < SY; y++)
    for (let z = z0; z < z0 + CHUNK; z++)
      for (let x = x0; x < x0 + CHUNK; x++) {
        const id = v.get(x, y, z);
        if (id === 0) continue;
        const isLiquid = LIQUID[id] === 1;
        const isGlow = GLOW[id] > 0;
        const out = isLiquid ? liquid : isGlow ? glow : solid;
        const shade = 1 + (hash(x, y, z) - 0.5) * 2 * VARY[id];
        const gain = (GLOW[id] || 1) * shade;
        const r = COLOR[id * 3] * gain;
        const g = COLOR[id * 3 + 1] * gain;
        const b = COLOR[id * 3 + 2] * gain;
        if (SMALL_W[id] > 0) {
          // A little box standing on the block below: flowers, tufts, crops.
          const half = SMALL_W[id] / 2;
          const jx = (hash(x, 7, z) - 0.5) * (1 - SMALL_W[id]) * 0.8;
          const jz = (hash(x, 9, z) - 0.5) * (1 - SMALL_W[id]) * 0.8;
          const height = SMALL_H[id] * (0.8 + hash(x, 3, z) * 0.4);
          for (const face of FACES) {
            if (face.n[1] === -1) continue;
            const base = out.positions.length / 3;
            for (const [ox, oy, oz] of face.c) {
              out.positions.push(x + 0.5 + jx + (ox - 0.5) * 2 * half, y + oy * height, z + 0.5 + jz + (oz - 0.5) * 2 * half);
              out.normals.push(face.n[0], face.n[1], face.n[2]);
              const foot = oy ? 1 : 0.62;
              out.colors.push(r * foot, g * foot, b * foot);
            }
            out.indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
          }
          continue;
        }
        if (SLAB[id] > 0) {
          // A thin layer lying on the block below; its sides only show where the layer ends.
          const h = SLAB[id];
          for (const face of FACES) {
            const [nx, ny, nz] = face.n;
            if (ny === -1) continue;
            if (ny === 0) {
              const beside = v.get(x + nx, y, z + nz);
              if (SLAB[beside] > 0 || !isOpen(beside) || x + nx < 0 || x + nx >= SX || z + nz < 0 || z + nz >= SZ) continue;
            }
            const base = out.positions.length / 3;
            for (let i = 0; i < 4; i++) {
              const [ox, oy, oz] = face.c[i];
              out.positions.push(x + ox, y + oy * h, z + oz);
              out.normals.push(nx, ny, nz);
              let light = ny === 0 ? 0.8 : 1;
              if (ny === 1) {
                // Walls standing beside the layer shade it, as they would a full block.
                const dx = ox ? 1 : -1;
                const dz = oz ? 1 : -1;
                const s1 = full(x + dx, y, z);
                const s2 = full(x, y, z + dz);
                ao4[i] = s1 && s2 ? 0 : 3 - (Number(s1) + Number(s2) + Number(full(x + dx, y, z + dz)));
                light = AO[ao4[i]];
              } else ao4[i] = 3;
              out.colors.push(r * light, g * light, b * light);
            }
            if (ao4[0] + ao4[2] >= ao4[1] + ao4[3]) out.indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
            else out.indices.push(base + 1, base + 2, base + 3, base + 1, base + 3, base);
          }
          continue;
        }
        // A liquid's surface sits a little below the block top, like a filled basin.
        const lower = isLiquid && v.get(x, y + 1, z) === 0 ? 0.14 : 0;

        for (const face of FACES) {
          const [nx, ny, nz] = face.n;
          // The bottom and the outer walls of the world are never seen.
          if (y === 0 && ny === -1) continue;
          if (x + nx < 0 || x + nx >= SX || z + nz < 0 || z + nz >= SZ) continue;
          const neighbour = v.get(x + nx, y + ny, z + nz);
          if (isLiquid ? neighbour !== 0 : !isOpen(neighbour)) continue;
          if (ny === 1 && SLAB[neighbour] > 0) continue;

          const base = out.positions.length / 3;
          for (let i = 0; i < 4; i++) {
            const [ox, oy, oz] = face.c[i];
            out.positions.push(x + ox, y + oy - (oy ? lower : 0), z + oz);
            out.normals.push(nx, ny, nz);
            let light = 1;
            if (!isGlow && !isLiquid) {
              // Count the blocks hugging this corner, in the layer the face looks into.
              const px = x + nx;
              const py = y + ny;
              const pz = z + nz;
              const dx = ox ? 1 : -1;
              const dy = oy ? 1 : -1;
              const dz = oz ? 1 : -1;
              let s1: boolean;
              let s2: boolean;
              let corner: boolean;
              if (nx !== 0) {
                s1 = full(px, py + dy, pz);
                s2 = full(px, py, pz + dz);
                corner = full(px, py + dy, pz + dz);
              } else if (ny !== 0) {
                s1 = full(px + dx, py, pz);
                s2 = full(px, py, pz + dz);
                corner = full(px + dx, py, pz + dz);
              } else {
                s1 = full(px + dx, py, pz);
                s2 = full(px, py + dy, pz);
                corner = full(px + dx, py + dy, pz);
              }
              ao4[i] = s1 && s2 ? 0 : 3 - (Number(s1) + Number(s2) + Number(corner));
              light = AO[ao4[i]];
            } else ao4[i] = 3;
            out.colors.push(r * light, g * light, b * light);
          }
          // Split the quad along the brighter diagonal so the shading stays symmetrical.
          if (ao4[0] + ao4[2] >= ao4[1] + ao4[3]) out.indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
          else out.indices.push(base + 1, base + 2, base + 3, base + 1, base + 3, base);
        }
      }

  return { solid: solid.pack(), glow: glow.pack(), liquid: liquid.pack() };
}
