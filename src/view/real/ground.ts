// The land, the water under it, and the plain beyond the map. The land's colours are baked from the
// city's ground grid (what lies on every square metre) into one texture; where that grid says water,
// the land is simply cut away and the water surface shows through.

import * as THREE from 'three';
import type { City } from '../../city/build';
import { SIZE } from '../../city/osm';
import { GRID, type Heightfield } from '../../city/terrain';
import { groundSurface } from './surfaceDetail';
import { fbm, type Surfaces } from './textures';

const ROAD = 1;
const GREEN = 4;
const WATER = 5;
const SEA = 6;

export class Ground {
  readonly group = new THREE.Group();
  readonly water: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshPhysicalMaterial>;
  private readonly land: THREE.Mesh<THREE.BufferGeometry, THREE.MeshStandardMaterial>;
  private readonly canvas = document.createElement('canvas');
  private readonly texture: THREE.CanvasTexture;
  private readonly grain = new Float32Array(SIZE * SIZE);
  /** Slope of the ground at every square metre (rise over run). */
  private readonly steepness = new Float32Array(SIZE * SIZE);
  private readonly wetness = { value: 0 };

  constructor(surfaces: Surfaces, terrain: Heightfield) {
    this.canvas.width = this.canvas.height = SIZE;
    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.colorSpace = THREE.SRGBColorSpace;
    this.texture.anisotropy = 8;
    for (let z = 0; z < SIZE; z++) for (let x = 0; x < SIZE; x++) this.grain[z * SIZE + x] = fbm(x / SIZE, z / SIZE, 40, 4, 11);
    if (terrain.relief > 1)
      for (let z = 0; z < SIZE; z += 1)
        for (let x = 0; x < SIZE; x += 1) this.steepness[z * SIZE + x] = Math.hypot(terrain.at(x + 3, z) - terrain.at(x - 3, z), terrain.at(x, z + 3) - terrain.at(x, z - 3)) / 6;

    const relief = surfaces.groundNormal.clone();
    relief.repeat.set(SIZE / 3, SIZE / 3);
    // The land: one vertex per sample of the height field, split into triangles exactly as `terrain.at` reads it.
    const w = GRID + 1;
    const cell = SIZE / GRID;
    const positions = new Float32Array(w * w * 3);
    const uvs = new Float32Array(w * w * 2);
    for (let i = 0; i < w; i++)
      for (let j = 0; j < w; j++) {
        positions.set([j * cell, terrain.y[i * w + j], i * cell], (i * w + j) * 3);
        uvs.set([j / GRID, 1 - i / GRID], (i * w + j) * 2);
      }
    const indices = new Uint32Array(GRID * GRID * 6);
    for (let i = 0, k = 0; i < GRID; i++)
      for (let j = 0; j < GRID; j++) {
        const [a, b, c, d] = [i * w + j, i * w + j + 1, (i + 1) * w + j, (i + 1) * w + j + 1];
        indices.set([a, c, b, b, c, d], k);
        k += 6;
      }
    const surface = new THREE.BufferGeometry();
    surface.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    surface.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
    surface.setIndex(new THREE.BufferAttribute(indices, 1));
    surface.computeVertexNormals();
    const landMaterial = new THREE.MeshStandardMaterial({ map: this.texture, normalMap: relief, normalScale: new THREE.Vector2(0.5, 0.5), roughness: 0.96, metalness: 0, alphaTest: 0.5 });
    groundSurface(landMaterial, this.wetness);
    this.land = new THREE.Mesh(surface, landMaterial);
    this.land.receiveShadow = true;
    this.land.castShadow = terrain.relief > 8;

    // The map is a slab cut out of the country: earth sides down to a plain below its lowest edge.
    let floor = Infinity;
    for (let k = 0; k < w; k++) floor = Math.min(floor, terrain.y[k], terrain.y[(w - 1) * w + k], terrain.y[k * w], terrain.y[k * w + w - 1]);
    floor = Math.min(floor, terrain.seaY) - 3;
    const side: number[] = [];
    const edge = (x0: number, z0: number, x1: number, z1: number) => {
      const [y0, y1] = [terrain.at(x0, z0), terrain.at(x1, z1)];
      side.push(x0, y0, z0, x1, y1, z1, x1, floor, z1, x0, y0, z0, x1, floor, z1, x0, floor, z0);
    };
    for (let k = 0; k < GRID; k++) {
      const [p, q] = [k * cell, (k + 1) * cell];
      edge(p, 0, q, 0);
      edge(q, SIZE, p, SIZE);
      edge(0, q, 0, p);
      edge(SIZE, p, SIZE, q);
    }
    const sides = new THREE.BufferGeometry();
    sides.setAttribute('position', new THREE.Float32BufferAttribute(side, 3));
    sides.computeVertexNormals();
    const skirt = new THREE.Mesh(sides, new THREE.MeshStandardMaterial({ color: '#6f5d49', roughness: 1, side: THREE.DoubleSide }));

    // The plain beyond the map: a frame, not a sheet, so that nothing lies under the land to flicker against it.
    const frame = new THREE.Shape([new THREE.Vector2(-6000, -6000), new THREE.Vector2(6000 + SIZE, -6000), new THREE.Vector2(6000 + SIZE, 6000 + SIZE), new THREE.Vector2(-6000, 6000 + SIZE)]);
    frame.holes.push(new THREE.Path([new THREE.Vector2(0.5, 0.5), new THREE.Vector2(0.5, SIZE - 0.5), new THREE.Vector2(SIZE - 0.5, SIZE - 0.5), new THREE.Vector2(SIZE - 0.5, 0.5)]));
    const apron = new THREE.Mesh(new THREE.ShapeGeometry(frame), new THREE.MeshStandardMaterial({ color: '#8f8a7c', roughness: 1, side: THREE.DoubleSide }));
    apron.rotation.x = Math.PI / 2;
    apron.position.y = floor;
    apron.receiveShadow = true;

    const ripples = surfaces.waterNormal.clone();
    ripples.repeat.set(SIZE / 28, SIZE / 28);
    this.water = new THREE.Mesh(
      new THREE.PlaneGeometry(SIZE, SIZE),
      new THREE.MeshPhysicalMaterial({ color: '#1d5468', roughness: 0.06, metalness: 0, normalMap: ripples, normalScale: new THREE.Vector2(0.55, 0.55), envMapIntensity: 1.4, clearcoat: 0.6, clearcoatRoughness: 0.05 }),
    );
    this.water.rotation.x = -Math.PI / 2;
    this.water.position.set(SIZE / 2, terrain.seaY - 0.45, SIZE / 2);
    this.water.receiveShadow = true;
    this.group.add(this.land, skirt, apron, this.water);
  }

  /** Repaint the land from the ground grid: after the streets, and again whenever scenery arrives. */
  bake(city: City) {
    // How far each square metre is from anything built: town ground is paved, the hillside beyond is scrub and rock.
    const far = new Uint8Array(SIZE * SIZE).fill(255);
    let frontier: number[] = [];
    for (let i = 0; i < far.length; i++)
      if (city.ground[i] === ROAD || city.ground[i] === 2 || city.ground[i] === 3) {
        far[i] = 0;
        frontier.push(i);
      }
    for (let d = 1; d <= 40 && frontier.length; d++) {
      const next: number[] = [];
      for (const i of frontier) {
        const x = i % SIZE;
        for (const j of [x > 0 ? i - 1 : -1, x < SIZE - 1 ? i + 1 : -1, i - SIZE, i + SIZE]) {
          if (j < 0 || j >= far.length || far[j] <= d) continue;
          far[j] = d;
          next.push(j);
        }
      }
      frontier = next;
    }
    const steep = this.steepness;
    const ctx = this.canvas.getContext('2d')!;
    const image = ctx.createImageData(SIZE, SIZE);
    const ground = city.ground;
    for (let i = 0; i < ground.length; i++) {
      const kind = ground[i];
      const n = this.grain[i];
      const j = i * 4;
      let r: number;
      let g: number;
      let b: number;
      // How built-up it is, for the detail shader (alpha 1 paved .. 0.5 wild; 0 is water, cut away).
      let built = 1;
      if (kind === GREEN) {
        [r, g, b] = [52 + n * 34, 86 + n * 40, 38 + n * 20];
        built = 0;
      } else if (kind === ROAD) [r, g, b] = [52 + n * 12, 53 + n * 12, 56 + n * 12];
      else {
        // Paved near the houses; then dry earth, scrub, and bare rock where the slope is too steep to hold soil.
        const wild = Math.min(1, Math.max(0, (far[i] - 6) / 22));
        const rock = Math.min(1, Math.max(0, (steep[i] - 0.32) / 0.3));
        const scrub = [82 + n * 40, 88 + n * 36, 52 + n * 22];
        const stone = [138 + n * 26, 130 + n * 26, 116 + n * 24];
        const paved = [112 + n * 26, 106 + n * 24, 96 + n * 22];
        const nature = scrub.map((c, k) => c + (stone[k] - c) * rock);
        [r, g, b] = paved.map((c, k) => c + (nature[k] - c) * wild) as [number, number, number];
        built = 1 - wild;
      }
      // Dirt and shade gather at the foot of a wall, a metre or two out.
      if (kind !== ROAD && far[i] >= 1 && far[i] <= 2) {
        const shade = far[i] === 1 ? 0.72 : 0.86;
        r *= shade;
        g *= shade;
        b *= shade;
      }
      image.data[j] = r;
      image.data[j + 1] = g;
      image.data[j + 2] = b;
      image.data[j + 3] = kind === WATER || kind === SEA ? 0 : Math.round(128 + 127 * built);
    }
    ctx.putImageData(image, 0, 0);
    this.texture.needsUpdate = true;
  }

  update(dt: number, wet: number) {
    const map = this.water.material.normalMap!;
    map.offset.x += dt * 0.012;
    map.offset.y += dt * 0.007;
    this.wetness.value = wet;
  }

  dispose() {
    this.texture.dispose();
    this.group.traverse((o) => {
      if (o instanceof THREE.Mesh) {
        o.geometry.dispose();
        (o.material as THREE.Material).dispose();
      }
    });
  }
}
