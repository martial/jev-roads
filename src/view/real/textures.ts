// Every surface texture is made here, in code: no image files. Tileable noise turned into asphalt,
// paving, water ripples and the fine relief that keeps big flat surfaces from looking like plastic.

import * as THREE from 'three';

function lattice(ix: number, iy: number, period: number, seed: number): number {
  let h = Math.imul(((ix % period) + period) % period, 374761393) ^ Math.imul(((iy % period) + period) % period, 668265263) ^ Math.imul(seed, 1274126177);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/** Smooth noise that repeats every `period` cells. */
function tileNoise(x: number, y: number, period: number, seed: number): number {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const fx = x - ix;
  const fy = y - iy;
  const sx = fx * fx * (3 - 2 * fx);
  const sy = fy * fy * (3 - 2 * fy);
  const a = lattice(ix, iy, period, seed);
  const b = lattice(ix + 1, iy, period, seed);
  const c = lattice(ix, iy + 1, period, seed);
  const d = lattice(ix + 1, iy + 1, period, seed);
  return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
}

/** Several octaves, still tileable: 0..1. */
export function fbm(u: number, v: number, base: number, octaves: number, seed: number): number {
  let sum = 0;
  let weight = 0;
  for (let o = 0; o < octaves; o++) {
    const period = base * 2 ** o;
    const w = 0.5 ** o;
    sum += tileNoise(u * period, v * period, period, seed + o * 17) * w;
    weight += w;
  }
  return sum / weight;
}

function finish(canvas: HTMLCanvasElement, colour: boolean, repeat: number): THREE.CanvasTexture {
  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(repeat, repeat);
  texture.anisotropy = 8;
  if (colour) texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

/** A normal map from a height function. `strength` is how deep the relief reads. */
export function normalMap(size: number, height: (u: number, v: number) => number, strength: number, repeat = 1): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  const image = ctx.createImageData(size, size);
  const h = new Float32Array(size * size);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) h[y * size + x] = height(x / size, y / size);
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      const l = h[y * size + ((x + size - 1) % size)];
      const r = h[y * size + ((x + 1) % size)];
      const u = h[((y + size - 1) % size) * size + x];
      const d = h[((y + 1) % size) * size + x];
      const nx = (l - r) * strength;
      const ny = (u - d) * strength;
      const len = Math.hypot(nx, ny, 1);
      const i = (y * size + x) * 4;
      image.data[i] = ((nx / len) * 0.5 + 0.5) * 255;
      image.data[i + 1] = ((ny / len) * 0.5 + 0.5) * 255;
      image.data[i + 2] = (1 / len) * 255;
      image.data[i + 3] = 255;
    }
  ctx.putImageData(image, 0, 0);
  return finish(canvas, false, repeat);
}

/** A colour map from a function returning [r, g, b] in 0..255. */
export function colourMap(size: number, colour: (u: number, v: number) => [number, number, number], repeat = 1): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  const image = ctx.createImageData(size, size);
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      const [r, g, b] = colour(x / size, y / size);
      const i = (y * size + x) * 4;
      image.data[i] = r;
      image.data[i + 1] = g;
      image.data[i + 2] = b;
      image.data[i + 3] = 255;
    }
  ctx.putImageData(image, 0, 0);
  return finish(canvas, true, repeat);
}

export interface Surfaces {
  asphalt: THREE.CanvasTexture;
  asphaltNormal: THREE.CanvasTexture;
  concreteNormal: THREE.CanvasTexture;
  groundNormal: THREE.CanvasTexture;
  waterNormal: THREE.CanvasTexture;
  wallNormal: THREE.CanvasTexture;
  /** Roman tiles: rows of half-round channels, each course stepping down over the next. One repeat is 1 m by 1 m. */
  tileNormal: THREE.CanvasTexture;
}

export function makeSurfaces(): Surfaces {
  // Tarmac: dark, with pale aggregate showing through and slow blotches where it has worn or been patched.
  const asphalt = colourMap(512, (u, v) => {
    const blotch = fbm(u, v, 3, 3, 1);
    const grit = fbm(u, v, 96, 2, 2);
    const stone = grit > 0.74 ? 9 : 0;
    const g = 30 + blotch * 10 + grit * 14 + stone;
    return [g, g + 1, g + 3];
  });
  return {
    asphalt,
    asphaltNormal: normalMap(512, (u, v) => fbm(u, v, 96, 3, 3), 0.65),
    concreteNormal: normalMap(256, (u, v) => fbm(u, v, 24, 4, 4) + (Math.abs(((u * 8) % 1) - 0.5) < 0.012 || Math.abs(((v * 8) % 1) - 0.5) < 0.012 ? -0.5 : 0), 1.6),
    groundNormal: normalMap(256, (u, v) => fbm(u, v, 12, 4, 5), 1.4),
    waterNormal: normalMap(512, (u, v) => fbm(u, v, 6, 5, 6) * 0.7 + fbm(u + 0.37, v + 0.11, 14, 3, 7) * 0.3, 3.2),
    wallNormal: normalMap(256, (u, v) => fbm(u, v, 20, 4, 8), 0.9),
    tileNormal: normalMap(256, (u, v) => {
      // Four courses to the metre down the slope (v), five tiles across (u): a cylinder's profile across, a step down each course.
      // Three courses to the metre down the slope (v), four tiles across (u): a channel's profile across, a step down each course.
      const across = Math.abs(((u * 4) % 1) - 0.5) * 2;
      const round = Math.sqrt(Math.max(0, 1 - across * across)) * 0.5;
      const course = (v * 3) % 1;
      const step = course * 0.35;
      return round + step + fbm(u, v, 40, 2, 9) * 0.08;
    }, 3.2),
  };
}
