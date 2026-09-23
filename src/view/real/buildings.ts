// Buildings from their true footprints. Walls carry their own measurements (metres along the wall,
// metres up it), and one shader turns that into a facade: floors, bays, glass that reflects the sky by
// day and lights up at night, shopfronts on the ground floor of the bigger buildings, a mansard in the north.
// What stands proud of the wall (surrounds, sills, shutters, balconies, cornices, awnings, doors, drainpipes,
// chimneys) is instanced geometry laid to the same grid (`facade.ts`). A part of town is two meshes
// (walls, roofs) and its share of those instances, whatever it holds.

import { Neon } from './neon';
import { Storefronts, type Wall } from './storefronts';
import * as THREE from 'three';
import { SIZE, footprintsOf, type Building, type Pt } from '../../city/osm';
import type { Heightfield } from '../../city/terrain';
import { FLOOR, Facades, SHUTTERS, bayOf, type WallFrame } from './facade';
import type { Surfaces } from './textures';

function hash(n: number): number {
  let h = Math.imul(n ^ 0x9e3779b9, 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

const SOUTH = { walls: ['#e3c48f', '#ecdcb6', '#e7bd95', '#dfae9b', '#d8ccb2', '#efe8da', '#e9d3a2'], roof: '#b5603d', flat: '#8d857a', pitched: true };
const NORTH = { walls: ['#e6decb', '#ddd3bd', '#ece6d8', '#d9d0bd', '#e3d9c2'], roof: '#5f6b76', flat: '#6b737b', pitched: false };

export const facadeUniforms = { uNight: { value: 0 }, uNorth: { value: 0 } };

/** The standard lit material, with a facade painted into it. */
function facadeMaterial(surfaces: Surfaces): THREE.MeshStandardMaterial {
  const relief = surfaces.wallNormal.clone();
  const material = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.88, metalness: 0, normalMap: relief, normalScale: new THREE.Vector2(0.28, 0.28), envMapIntensity: 1.3 });
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, facadeUniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec3 aInfo;\nattribute vec3 aSpan;\nvarying vec3 vInfo;\nvarying vec3 vSpan;\nvarying vec2 vWall;\nvarying vec3 vFacadeWorld;\nvarying vec3 vFacadeNormal;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvInfo = aInfo;\nvSpan = aSpan;\nvWall = uv;\nvFacadeWorld = (modelMatrix * vec4(position,1.0)).xyz;\nvFacadeNormal = normalize(mat3(modelMatrix) * normal);');
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
        uniform float uNight;
        uniform float uNorth;
        varying vec3 vInfo;   // x: seed, y: height of the building, z: 0 house, 1 monument
        varying vec3 vSpan;   // x, y: where this wall begins and ends, in metres along; z: the bay with the door, or -1
        varying vec2 vWall;   // x: metres along the wall, y: metres above the ground
        varying vec3 vFacadeWorld;
        varying vec3 vFacadeNormal;
        // No sine: the geometry that stands on the wall works this out too, and they must agree.
        float fh(vec2 p) {
          vec3 p3 = fract(vec3(p.xyx) * 0.1031);
          p3 += dot(p3, p3.yzx + 33.33);
          return fract((p3.x + p3.y) * p3.z);
        }
        // Smooth noise, for plaster: the hash at the corners of a cell, blended.
        float vn(vec2 p) {
          vec2 i = floor(p);
          vec2 f = fract(p);
          f = f * f * (3.0 - 2.0 * f);
          return mix(mix(fh(i), fh(i + vec2(1.0, 0.0)), f.x), mix(fh(i + vec2(0.0, 1.0)), fh(i + vec2(1.0, 1.0)), f.x), f.y);
        }
        float fGlass = 0.0;
        float fLit = 0.0;
        vec3 fGlow = vec3(0.0);`,
      )
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
        {
          float seed = vInfo.x;
          float tall = vInfo.y;
          float y = vWall.y;
          if (vInfo.z > 0.5) {
            // Dressed stone: courses and joints, a cornice near the top.
            float course = step(0.94, fract(y / 1.1));
            float joint = step(0.96, fract(vWall.x / 2.2 + floor(y / 1.1) * 0.5));
            diffuseColor.rgb *= 1.0 - 0.18 * max(course, joint);
            diffuseColor.rgb *= 0.9 + 0.1 * fh(vec2(floor(vWall.x / 2.2), floor(y / 1.1)));
            diffuseColor.rgb *= mix(1.0, 0.8, smoothstep(tall - 3.5, tall - 3.0, y) * (1.0 - smoothstep(tall - 2.4, tall - 2.2, y)));
          } else {
            float floorH = 3.1;
            float bay = 2.5 + fh(vec2(seed, 1.0)) * 0.9;
            float storey = floor(y / floorH);
            vec2 cell = vec2(fract(vWall.x / bay), fract(y / floorH));
            vec2 id = vec2(floor(vWall.x / bay), storey);
            float ground = step(y, floorH) * step(0.0, y);
            // Only the bigger buildings have a shop on the ground floor; a house has a door.
            float shop = ground * step(8.0, tall) * (1.0 - step(0.2, vInfo.z));
            float attic = uNorth * step(tall - 3.3, y);
            // The window opening: a shopfront the width of the bay, small in a mansard.
            vec2 lo = mix(vec2(0.24, 0.26), vec2(0.1, 0.08), shop);
            vec2 hi = mix(vec2(0.76, 0.84), vec2(0.9, 0.8), shop);
            lo = mix(lo, vec2(0.34, 0.2), attic);
            hi = mix(hi, vec2(0.66, 0.62), attic);
            float inside = step(lo.x, cell.x) * step(cell.x, hi.x) * step(lo.y, cell.y) * step(cell.y, hi.y);
            // Whole windows only: within this wall, in a row that fits under the roof, and not where the door is.
            float within = step(vSpan.x, id.x * bay) * step((id.x + 1.0) * bay, vSpan.y + 0.001);
            float fits = step((storey + hi.y) * floorH, tall - 0.7);
            float door = ground * step(abs(id.x - vSpan.z), 0.5);
            float window = inside * within * fits * (1.0 - door) * step(2.4, tall) * step(0.0, y);
            // Glazing bars; the frame is geometry now, but shopfronts keep a painted one.
            float bar = step(abs(cell.x - 0.5), 0.012) + step(abs(cell.y - mix(0.55, 0.62, shop)), 0.01);
            float frame = 1.0 - step(lo.x + 0.03, cell.x) * step(cell.x, hi.x - 0.03) * step(lo.y + 0.025, cell.y) * step(cell.y, hi.y - 0.025);
            float glass = window * (1.0 - clamp(bar + frame * shop, 0.0, 1.0) * (1.0 - shop * 0.6));
            // Wall: rendered plaster with its grain and its blotches, a string course at each floor, grime low down,
            // a stone base to the ground floor, quoins up the corners of the bigger houses, a zinc mansard in the north.
            vec3 wall = diffuseColor.rgb;
            vec2 pw = vec2(vWall.x + seed, y);
            wall *= 0.9 + 0.2 * (0.5 * vn(pw * 0.6) + 0.3 * vn(pw * 2.5) + 0.2 * vn(pw * 9.0));
            // Brick, dressed limestone, and rendered plaster vary per building, not per repeated texture tile.
            float brick = uNorth * step(.34,fh(vec2(seed,12.0)));
            vec2 masonry=vec2(pw.x/.31+mod(floor(y/.105),2.0)*.5,y/.105);
            vec2 joint=min(fract(masonry),1.0-fract(masonry));
            float mortar=1.0-smoothstep(.014,.043+fwidth(min(joint.x,joint.y)),min(joint.x,joint.y));
            vec3 brickColour=mix(vec3(.22,.075,.035),vec3(.42,.23,.115),fh(vec2(seed,8.0)));
            brickColour*=.75+.5*fh(floor(masonry)+seed);
            brickColour=mix(brickColour,vec3(.28,.255,.21),mortar*.7);
            wall=mix(wall,brickColour,brick*.88);
            vec2 stoneCell=vec2(pw.x/1.2+mod(floor(y/.48),2.0)*.5,y/.48);
            vec2 stoneEdge=min(fract(stoneCell),1.0-fract(stoneCell));
            float stoneJoint=1.0-smoothstep(.003,.016+fwidth(min(stoneEdge.x,stoneEdge.y)),min(stoneEdge.x,stoneEdge.y));
            wall*=1.0-stoneJoint*.14*(1.0-brick)*uNorth;
            wall*=mix(.86,1.0,smoothstep(0.0,3.5,y))*(.96+.04*vn(vec2(pw.x*5.0,y*.22)));
            wall *= 1.0 - 0.16 * step(cell.y, 0.035) * (1.0 - ground);
            wall *= mix(0.78, 1.0, smoothstep(0.0, 2.2, y));
            float base = step(y, 1.05) * step(0.0, y) * (1.0 - shop);
            wall = mix(wall, wall * vec3(0.72, 0.7, 0.68) * (0.92 + 0.16 * fh(vec2(floor(vWall.x / 1.1), 5.0))), base);
            wall *= 1.0 - 0.2 * step(abs(y - 1.05), 0.02) * (1.0 - shop);
            float toEnd = min(vWall.x - vSpan.x, vSpan.y - vWall.x);
            float courseIndex = floor(y / 0.62);
            float quoinW = mix(0.36, 0.58, mod(courseIndex, 2.0));
            float quoin = step(toEnd, quoinW) * step(6.0, tall) * step(0.45, fh(vec2(seed, 13.0))) * step(0.0, y) * (1.0 - attic);
            float quoinJoint = max(step(abs(fract(y / 0.62) - 0.5), 0.47) * 0.0 + step(0.96, fract(y / 0.62)), step(abs(toEnd - quoinW), 0.02));
            wall = mix(wall, mix(wall * 1.12, wall * 0.8, quoinJoint), quoin);
            // Streaks of grime running down from the sills of some windows.
            float streak = (1.0 - ground) * within * step(lo.x + 0.05, cell.x) * step(cell.x, hi.x - 0.05) * step(lo.y - 0.16, cell.y) * step(cell.y, lo.y) * step(0.55, fh(id * 3.1 + seed));
            wall *= 1.0 - 0.14 * streak * (1.0 - (lo.y - cell.y) / 0.16) * (0.7 + 0.3 * fh(vec2(floor(vWall.x * 9.0), id.y)));
            wall = mix(wall, vec3(0.33, 0.38, 0.43) * (0.9 + 0.1 * fh(vec2(floor(vWall.x / 0.6), 3.0))), attic * (1.0 - step(tall - 0.7, y)));
            wall = mix(wall, wall * vec3(0.82, 0.8, 0.78), shop * 0.6);
            diffuseColor.rgb = mix(wall, vec3(0.3, 0.28, 0.26), window * frame * shop);
            diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.045, 0.06, 0.075), glass);
            // What is behind the glass: curtains drawn back, a blind half down, or nothing at all.
            float dressing = fh(id * 3.7 + seed * 1.3);
            float across = (cell.x - lo.x) / (hi.x - lo.x);
            float up = (cell.y - lo.y) / (hi.y - lo.y);
            // Ray-box interiors: the back wall, floor and ceiling move behind the glass as the taxi passes.
            vec3 outward=normalize(vFacadeNormal);
            vec3 along=vec3(-outward.z,0.0,outward.x);
            vec3 eyeRay=normalize(vFacadeWorld-cameraPosition);
            vec3 direction=vec3(dot(eyeRay,along)/((hi.x-lo.x)*bay),eyeRay.y/((hi.y-lo.y)*floorH),max(.05,-dot(eyeRay,outward))/(shop>0.5?3.8:2.7));
            vec3 entry=vec3(clamp(across,.001,.999),clamp(up,.001,.999),0.0);
            vec3 exitPlane=step(vec3(0),direction);
            vec3 distances=(exitPlane-entry)/(direction+vec3(.00001));
            float travel=min(min(distances.x,distances.y),distances.z);
            vec3 roomHit=entry+direction*max(0.0,travel);
            float backWall=step(.995,roomHit.z);
            float floorHit=1.0-step(.005,roomHit.y);
            float ceiling=step(.995,roomHit.y);
            vec3 roomColour=mix(vec3(.32,.27,.21),vec3(.18,.26,.28),step(.6,fh(id+seed*2.0)));
            roomColour*=mix(.58,.95,backWall);
            roomColour=mix(roomColour,vec3(.17,.095,.046)*(.8+.2*step(.06,fract(roomHit.x*9.0))),floorHit);
            roomColour=mix(roomColour,vec3(.43,.39,.3),ceiling);
            float shelf=step(.94,fract(roomHit.y*3.2))*backWall*shop;
            float goods=step(.27,fh(vec2(floor(roomHit.x*9.0),floor(roomHit.y*3.2))+seed));
            goods*=step(.25,fract(roomHit.y*3.2))*step(fract(roomHit.y*3.2),.82)*backWall*shop;
            roomColour=mix(roomColour,vec3(.04,.045,.046),shelf);
            roomColour=mix(roomColour,mix(vec3(.63,.27,.09),vec3(.16,.4,.36),fh(floor(roomHit.xy*vec2(9,3.2))+seed)),goods*.65);
            float picture=step(.28,roomHit.x)*step(roomHit.x,.66)*step(.45,roomHit.y)*step(roomHit.y,.76)*backWall*(1.0-shop);
            roomColour=mix(roomColour,vec3(.1,.14,.16),picture);
            float lamp=(1.0-smoothstep(.11,.16,length(roomHit.xz-vec2(.5,.55))))*ceiling;
            roomColour+=lamp*vec3(1.8,1.3,.7);
            diffuseColor.rgb=mix(diffuseColor.rgb,roomColour*.36,glass);
            float curtain = step(0.35, dressing) * step(dressing, 0.62) * (step(across, 0.3) + step(0.7, across));
            float blind = step(0.62, dressing) * step(dressing, 0.82) * step(1.0 - 0.35 - 0.3 * fh(id + seed), up);
            vec3 curtainColour = mix(vec3(0.82, 0.78, 0.7), vec3(0.6, 0.62, 0.66), step(0.5, fh(id * 5.3 + seed)));
            vec3 blindColour = vec3(0.66, 0.64, 0.58) * (0.9 + 0.1 * step(0.5, fract(up * 26.0)));
            float dressed = glass * (1.0 - shop) * clamp(curtain + blind, 0.0, 1.0);
            diffuseColor.rgb = mix(diffuseColor.rgb, mix(curtainColour, blindColour, blind), dressed * 0.9);
            float pane = glass;
            glass *= 1.0 - dressed * 0.8;
            fGlass = glass;
            // Who is home: more lights early in the evening than you would think, fewer upstairs in shops.
            float home = fh(id * 1.7 + seed * 3.1);
            // Light comes through a curtain, softer: the pane is lit whether it is dressed or not.
            fLit = pane * step(home, mix(0.42, 0.75, shop)) * uNight * (1.0 - dressed * 0.35);
            vec3 warm = mix(vec3(1.0, 0.72, 0.38), vec3(0.85, 0.9, 1.0), step(0.86, fh(id + seed * 5.0)));
            fGlow = roomColour * warm * fLit * (1.6 + 1.8 * fh(id * 2.3 + 1.0)) * mix(1.0, 1.45, shop);
            fGlow += roomColour * pane * shop * .16;
          }
        }`,
      )
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor = mix(roughnessFactor, 0.12, fGlass);')
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance += fGlow * 0.85;');
  };
  material.customProgramCacheKey = () => 'jev-facade-interiors-v2';
  return material;
}

class Mesher {
  positions: number[] = [];
  normals: number[] = [];
  uvs: number[] = [];
  colors: number[] = [];
  infos: number[] = [];
  spans: number[] = [];
  indices: number[] = [];

  vertex(x: number, y: number, z: number, nx: number, ny: number, nz: number, u: number, w: number, colour: THREE.Color, info: [number, number, number], span: [number, number, number] = [0, 1e6, -1]): number {
    this.positions.push(x, y, z);
    this.normals.push(nx, ny, nz);
    this.uvs.push(u, w);
    this.colors.push(colour.r, colour.g, colour.b);
    this.infos.push(...info);
    this.spans.push(...span);
    return this.positions.length / 3 - 1;
  }

  geometry(): THREE.BufferGeometry | null {
    if (!this.indices.length) return null;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.positions, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.normals, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uvs, 2));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.colors, 3));
    g.setAttribute('aInfo', new THREE.Float32BufferAttribute(this.infos, 3));
    g.setAttribute('aSpan', new THREE.Float32BufferAttribute(this.spans, 3));
    g.setIndex(this.indices);
    g.computeBoundingSphere();
    return g;
  }
}

const area = (points: Pt[]) => points.reduce((s, p, i) => s + p[0] * points[(i + 1) % points.length][1] - points[(i + 1) % points.length][0] * p[1], 0) / 2;

export class Buildings {
  readonly group = new THREE.Group();
  private readonly walls: THREE.MeshStandardMaterial;
  private readonly roofs: THREE.MeshStandardMaterial;
  private readonly flats: THREE.MeshStandardMaterial;
  /** Everything that stands proud of the walls, instanced. */
  readonly facades = new Facades();
  /** The town after dark: roofline tubes, corner strips and billboards. */
  readonly neon = new Neon();
  /** The real shops of the place, by name, when Google knows them. */
  readonly storefronts = new Storefronts();
  private readonly seen = new Set<number>();
  /** Pieces of town still growing out of the ground. */
  private rising: Array<{ object: THREE.Object3D; t: number }> = [];

  constructor(
    surfaces: Surfaces,
    private readonly lat: number,
    private readonly terrain: Heightfield,
  ) {
    this.walls = facadeMaterial(surfaces);
    // Pitched roofs are tiled (their uv runs across and down the slope, a metre a repeat); flat ones stay gravel.
    this.roofs = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85, metalness: 0.02, normalMap: surfaces.tileNormal, normalScale: new THREE.Vector2(1.2, 1.2) });
    this.flats = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9, metalness: 0.05, normalMap: surfaces.groundNormal.clone(), normalScale: new THREE.Vector2(0.5, 0.5) });
    facadeUniforms.uNorth.value = lat > 45.5 ? 1 : 0;
    this.group.add(this.facades.group, this.storefronts.group);
  }

  get busy(): boolean {
    return this.rising.length > 0;
  }

  /** One part of town: every building not yet standing, as one wall mesh and one roof mesh. */
  add(buildings: Building[]) {
    const style = this.lat > 45.5 ? NORTH : SOUTH;
    const wall = new Mesher();
    const roof = new Mesher();
    const flat = new Mesher();
    const colour = new THREE.Color();
    const walls: Wall[] = [];
    for (const b of buildings) {
      if (this.seen.has(b.id) || b.points.length < 3) continue;
      this.seen.add(b.id);
      for (const polygon of footprintsOf(b)) {
        let points = polygon[0].slice();
        const holes = polygon.slice(1).map(ring => {
          const clean = ring.filter((p, i) => i !== ring.length - 1 || p[0] !== ring[0][0] || p[1] !== ring[0][1]);
          return area(clean) > 0 ? clean.reverse() : clean;
        });
        if (Math.hypot(points[0][0] - points[points.length - 1][0], points[0][1] - points[points.length - 1][1]) < 0.01) points.pop();
        if (points.length < 3) continue;
        // Only what stands wholly on the slab.
        if (points.some((q) => q[0] < 1 || q[1] < 1 || q[0] > SIZE - 1 || q[1] > SIZE - 1)) continue;
        // One winding for all (x east, z south), so that every wall's outside is known.
        if (area(points) < 0) points = points.reverse();
        const h = Math.max(4, b.height);
        // On a slope a house is dug in uphill and stands tall downhill: floors are counted from the middle.
        const grounds = points.map((p) => this.terrain.at(p[0], p[1]));
        const foot = Math.min(...grounds) - 0.6;
        const level = grounds.reduce((sum, g) => sum + g, 0) / grounds.length;
        const seed = hash(b.id) * 97;
        // Not every big building has a shop under it: most have a front door (0.25 tells the shader so).
        const shop = h >= 8 && hash(b.id + 33) < 0.4;
        const info: [number, number, number] = [seed, h, b.monument ? 1 : shop ? 0 : 0.25];
        colour.set(b.monument ? '#d9d0bb' : style.walls[Math.floor(hash(b.id + 1) * style.walls.length)]);

        if (b.arch && this.arch(wall, roof, points, h, level, colour, info)) continue;

        // What this building wears: the storeys the shader will paint, and whether it has a shop, balconies, a door.
        const storeys = Math.max(1, Math.floor((h - 0.7) / FLOOR + (1 - 0.84)));
        const south = style.pitched && !b.monument;
        const balconied = !b.monument && storeys >= 3 && hash(b.id + 21) < (south ? 0.4 : 0.55);
        const shutterColour = new THREE.Color(SHUTTERS[Math.floor(hash(b.id + 23) * SHUTTERS.length)]);
        const bay = bayOf(seed);
        let longest = -1;
        let longestLen = 0;
        points.forEach((p, i) => {
          const q = points[(i + 1) % points.length];
          const len = Math.hypot(q[0] - p[0], q[1] - p[1]);
          if (len > longestLen) [longestLen, longest] = [len, i];
        });
        let run = 0;
        for (const boundary of [points, ...holes]) for (let i = 0; i < boundary.length; i++) {
          const [p, q] = [boundary[i], boundary[(i + 1) % boundary.length]];
          const len = Math.hypot(q[0] - p[0], q[1] - p[1]);
          if (len < 0.05) continue;
          const [nx, nz] = [(q[1] - p[1]) / len, -(q[0] - p[0]) / len];
          // The door: on the longest wall of a house, in its first whole bay.
          const firstCell = Math.ceil(run / bay);
          const doorCell = !shop && !b.monument && i === longest && (firstCell + 1) * bay <= run + len ? firstCell : -1;
          const span: [number, number, number] = [run, run + len, doorCell];
          const a = wall.vertex(p[0], foot, p[1], nx, 0, nz, run, foot - level, colour, info, span);
          const c = wall.vertex(q[0], foot, q[1], nx, 0, nz, run + len, foot - level, colour, info, span);
          const d = wall.vertex(q[0], level + h, q[1], nx, 0, nz, run + len, h, colour, info, span);
          const e = wall.vertex(p[0], level + h, p[1], nx, 0, nz, run, h, colour, info, span);
          wall.indices.push(a, d, c, a, e, d);
          if (!b.monument && h >= 2.4 && len >= 1.5) {
            const frame: WallFrame = { origin: new THREE.Vector3(p[0], level, p[1]), along: new THREE.Vector3(q[0] - p[0], 0, q[1] - p[1]).divideScalar(len), out: new THREE.Vector3(nx, 0, nz), length: len };
            this.facades.windows(frame, run, seed, storeys, h, shop, south, balconied, colour, shutterColour);
            if (storeys >= 2) this.facades.cornice(frame, h - 0.14, colour);
            if (doorCell >= 0) this.facades.door(frame, doorCell * bay - run + bay / 2 + (bay / 2 - 0.5) * 0.3, new THREE.Color(hash(b.id + 27) < 0.5 ? '#4a3a2c' : shutterColour.getHex()));
            if (i === (longest + 1) % points.length && len > 3) this.facades.pipe(frame, 0.22, h - 0.4);
          }
          run += len;
        }
        this.roof(roof, flat, points, level + h, b, style, colour, holes);
        this.neon.add(b, points, level, h);
        if (!b.monument)
          for (let i = 0; i < points.length; i++) {
            const [p, q] = [points[i], points[(i + 1) % points.length]];
            const len = Math.hypot(q[0] - p[0], q[1] - p[1]);
            if (len >= 3) walls.push({ p: [p[0], p[1]], q: [q[0], q[1]], level, nx: (q[1] - p[1]) / len, nz: -(q[0] - p[0]) / len, len });
          }
      }
    }
    const piece = new THREE.Group();
    const wallGeometry = wall.geometry();
    const roofGeometry = roof.geometry();
    const flatGeometry = flat.geometry();
    if (wallGeometry) piece.add(Object.assign(new THREE.Mesh(wallGeometry, this.walls), { castShadow: true, receiveShadow: true }));
    if (roofGeometry) piece.add(Object.assign(new THREE.Mesh(roofGeometry, this.roofs), { castShadow: true, receiveShadow: true }));
    if (flatGeometry) piece.add(Object.assign(new THREE.Mesh(flatGeometry, this.flats), { castShadow: true, receiveShadow: true }));
    this.storefronts.addWalls(walls);
    const lit = this.neon.flush();
    if (lit.length) piece.add(...lit);
    if (!piece.children.length) return;
    piece.scale.y = 0.001;
    piece.userData.ground = this.terrain.at(SIZE / 2, SIZE / 2);
    this.group.add(piece);
    this.rising.push({ object: piece, t: 0 });
  }

  private roof(out: Mesher, flatOut: Mesher, points: Pt[], h: number, b: Building, style: typeof SOUTH, wallColour: THREE.Color, holes: Pt[][] = []) {
    // `h` is where the roof starts, in world metres; the building's own height decides what kind of roof it gets.
    const info: [number, number, number] = [0, h, 0];
    const tile = new THREE.Color(b.monument ? '#cfc6b2' : style.roof).multiplyScalar(0.85 + hash(b.id + 5) * 0.3);
    // A simple shape that a hip roof can sit on? Find the box around it, along its longest wall.
    let [ux, uz, longest] = [1, 0, 0];
    points.forEach((p, i) => {
      const q = points[(i + 1) % points.length];
      const d = Math.hypot(q[0] - p[0], q[1] - p[1]);
      if (d > longest) [longest, ux, uz] = [d, (q[0] - p[0]) / d, (q[1] - p[1]) / d];
    });
    const us = points.map((p) => p[0] * ux + p[1] * uz);
    const ws = points.map((p) => -p[0] * uz + p[1] * ux);
    const [u0, u1, w0, w1] = [Math.min(...us), Math.max(...us), Math.min(...ws), Math.max(...ws)];
    const [long, short] = [u1 - u0, w1 - w0];
    const boxy = Math.abs(area(points)) / Math.max(1, long * short);
    if (!holes.length && !b.roadClipped && style.pitched && !b.monument && boxy > 0.78 && Math.min(long, short) > 4 && Math.min(long, short) < 17 && b.height < 19) {
      const along = long >= short;
      // The eaves overhang the walls by half a metre, and the roof starts a little below the top of the wall so that
      // the wall's cornice tucks under it.
      const eave = 0.5;
      const [a0, a1, b0, b1] = along ? [u0 - eave, u1 + eave, w0 - eave, w1 + eave] : [w0 - eave, w1 + eave, u0 - eave, u1 + eave];
      const half = (b1 - b0) / 2;
      const rise = half * 0.5;
      const at = (a: number, c: number, y: number): [number, number, number] => (along ? [a * ux - c * uz, y, a * uz + c * ux] : [c * ux - a * uz, y, c * uz + a * ux]);
      const ridge0 = at(a0 + Math.min(half, (a1 - a0) / 2), (b0 + b1) / 2, h + rise);
      const ridge1 = at(a1 - Math.min(half, (a1 - a0) / 2), (b0 + b1) / 2, h + rise);
      const corners = [at(a0, b0, h), at(a1, b0, h), at(a1, b1, h), at(a0, b1, h)];
      const slope = Math.hypot(half, rise);
      // A face's uv: across the slope in metres, and down it in metres, so that the tile courses run the right way.
      const face = (vs: Array<[number, number, number]>, uvs: Array<[number, number]>) => {
        const [p, q, r] = vs;
        const n = new THREE.Vector3(q[0] - p[0], q[1] - p[1], q[2] - p[2]).cross(new THREE.Vector3(r[0] - p[0], r[1] - p[1], r[2] - p[2])).normalize();
        if (n.y < 0) {
          n.negate();
          vs.reverse();
          uvs.reverse();
        }
        const ids = vs.map((v, i) => out.vertex(v[0], v[1], v[2], n.x, n.y, n.z, uvs[i][0], uvs[i][1], tile, info));
        for (let k = 1; k + 1 < ids.length; k++) out.indices.push(ids[0], ids[k], ids[k + 1]);
      };
      const L = a1 - a0;
      const r0 = a0 + Math.min(half, L / 2);
      const r1 = a1 - Math.min(half, L / 2);
      face([corners[0], corners[1], ridge1, ridge0], [[0, slope], [L, slope], [r1 - a0, 0], [r0 - a0, 0]]);
      face([corners[2], corners[3], ridge0, ridge1], [[0, slope], [L, slope], [a1 - r0, 0], [a1 - r1, 0]]);
      face([corners[1], corners[2], ridge1], [[0, slope], [b1 - b0, slope], [half, 0]]);
      face([corners[3], corners[0], ridge0], [[0, slope], [b1 - b0, slope], [half, 0]]);
      // The ridge: a course of round tiles along the top, and a fascia board under the eaves all round.
      const ridgeColour = tile.clone().multiplyScalar(0.92);
      const ridgeInfo: [number, number, number] = [0, h, 0];
      const along3 = new THREE.Vector3(ridge1[0] - ridge0[0], 0, ridge1[2] - ridge0[2]);
      if (along3.lengthSq() > 0.01) {
        along3.normalize();
        const side = new THREE.Vector3(-along3.z, 0, along3.x).multiplyScalar(0.2);
        const top = 0.13;
        const quad = (p: THREE.Vector3, q: THREE.Vector3, r: THREE.Vector3, s2: THREE.Vector3, n: THREE.Vector3) => {
          const ids = [p, q, r, s2].map((v) => out.vertex(v.x, v.y, v.z, n.x, n.y, n.z, v.x * 0.5, v.z * 0.5, ridgeColour, ridgeInfo));
          out.indices.push(ids[0], ids[1], ids[2], ids[0], ids[2], ids[3]);
        };
        const R0 = new THREE.Vector3(...ridge0).addScaledVector(along3, -0.15);
        const R1 = new THREE.Vector3(...ridge1).addScaledVector(along3, 0.15);
        const up = new THREE.Vector3(0, top, 0);
        quad(R0.clone().sub(side), R0.clone().sub(side).add(up), R1.clone().sub(side).add(up), R1.clone().sub(side), side.clone().negate().normalize());
        quad(R1.clone().add(side), R1.clone().add(side).add(up), R0.clone().add(side).add(up), R0.clone().add(side), side.clone().normalize());
        quad(R0.clone().sub(side).add(up), R0.clone().add(side).add(up), R1.clone().add(side).add(up), R1.clone().sub(side).add(up), new THREE.Vector3(0, 1, 0));
      }
      const fascia = new THREE.Color(wallColour).multiplyScalar(0.85);
      for (let k = 0; k < 4; k++) {
        const p = new THREE.Vector3(...corners[k]);
        const q = new THREE.Vector3(...corners[(k + 1) % 4]);
        const n = new THREE.Vector3(q.z - p.z, 0, -(q.x - p.x)).normalize();
        const ids = [p, q, q.clone().setY(q.y - 0.22), p.clone().setY(p.y - 0.22)].map((v) => out.vertex(v.x, v.y, v.z, n.x, 0, n.z, 0, 0, fascia, ridgeInfo));
        out.indices.push(ids[0], ids[2], ids[1], ids[0], ids[3], ids[2]);
        // And the underside of the eaves, seen from the street.
        const inner0 = p.clone().addScaledVector(n, -eave).setY(p.y - 0.22);
        const inner1 = q.clone().addScaledVector(n, -eave).setY(q.y - 0.22);
        const under = [p.clone().setY(p.y - 0.22), inner0, inner1, q.clone().setY(q.y - 0.22)].map((v) => out.vertex(v.x, v.y, v.z, 0, -1, 0, 0, 0, fascia, ridgeInfo));
        out.indices.push(under[0], under[1], under[2], under[0], under[2], under[3]);
      }
      // A chimney or two on the ridge, a little off it so that they clear the tiles.
      const chimneys = 1 + (hash(b.id + 31) < 0.4 ? 1 : 0);
      for (let k = 0; k < chimneys; k++) {
        const t = chimneys === 1 ? 0.3 + hash(b.id + 33) * 0.4 : 0.22 + k * 0.56;
        const at = new THREE.Vector3().lerpVectors(new THREE.Vector3(...ridge0), new THREE.Vector3(...ridge1), t);
        at.y -= 0.15;
        const along = new THREE.Vector3(ridge1[0] - ridge0[0], 0, ridge1[2] - ridge0[2]).normalize();
        if (along.lengthSq() < 0.5) along.set(ux, 0, uz);
        this.facades.chimney(at, along, new THREE.Vector3(-along.z, 0, along.x), new THREE.Color(wallColour).multiplyScalar(0.9));
      }
      return;
    }
    // Otherwise a flat roof: gravel or zinc, sunk a little behind a parapet that carries the wall's colour.
    const tiled = !b.monument && style.pitched && hash(b.id + 9) < 0.55;
    const flatColour = new THREE.Color(b.monument ? '#cfc6b2' : tiled ? style.roof : style.flat).multiplyScalar(0.8 + hash(b.id + 5) * 0.25).lerp(wallColour, 0.08);
    const target = tiled ? out : flatOut;
    const contour = points.map((p) => new THREE.Vector2(p[0], p[1]));
    const sink = 0.35;
    const vertices = [points, ...holes].flat();
    const ids = vertices.map((p) => target.vertex(p[0], h - sink, p[1], 0, 1, 0, p[0] * (tiled ? 1 : 0.3), p[1] * (tiled ? 1 : 0.3), flatColour, info));
    for (const [a, c, d] of THREE.ShapeUtils.triangulateShape(contour, holes.map(r => r.map(p => new THREE.Vector2(...p))))) {
      // Face up whichever way the triangulator wound it.
      const [p, q, r] = [vertices[a], vertices[c], vertices[d]];
      const up = (q[1] - p[1]) * (r[0] - p[0]) - (q[0] - p[0]) * (r[1] - p[1]) > 0;
      target.indices.push(ids[a], up ? ids[c] : ids[d], up ? ids[d] : ids[c]);
    }
    // The parapet: the wall's inner face down to the roof, and a coping on top.
    const coping = new THREE.Color(wallColour).lerp(new THREE.Color('#e8e2d4'), 0.5);
    for (const boundary of [points, ...holes]) for (let i = 0; i < boundary.length; i++) {
      const [p, q] = [boundary[i], boundary[(i + 1) % boundary.length]];
      const len = Math.hypot(q[0] - p[0], q[1] - p[1]);
      if (len < 0.05) continue;
      const [nx, nz] = [(q[1] - p[1]) / len, -(q[0] - p[0]) / len];
      const t = 0.3;
      const inner = (pt: Pt): [number, number] => [pt[0] - nx * t, pt[1] - nz * t];
      const [ip, iq] = [inner(p), inner(q)];
      const a = flatOut.vertex(ip[0], h - sink, ip[1], -nx, 0, -nz, 0, 0, wallColour, info);
      const c = flatOut.vertex(iq[0], h - sink, iq[1], -nx, 0, -nz, 0, 0, wallColour, info);
      const d = flatOut.vertex(iq[0], h, iq[1], -nx, 0, -nz, 0, 0, wallColour, info);
      const e = flatOut.vertex(ip[0], h, ip[1], -nx, 0, -nz, 0, 0, wallColour, info);
      flatOut.indices.push(a, c, d, a, d, e);
      const top = [p, q, iq, ip].map((pt) => flatOut.vertex(pt[0], h + 0.06, pt[1], 0, 1, 0, 0, 0, coping, info));
      flatOut.indices.push(top[0], top[2], top[1], top[0], top[3], top[2]);
    }
  }

  /** A triumphal arch: the front elevation with its great opening, pushed through the monument's depth. */
  private arch(wall: Mesher, roof: Mesher, points: Pt[], h: number, level: number, colour: THREE.Color, info: [number, number, number]): boolean {
    let [ux, uz, longest] = [1, 0, 0];
    points.forEach((p, i) => {
      const q = points[(i + 1) % points.length];
      const d = Math.hypot(q[0] - p[0], q[1] - p[1]);
      if (d > longest) [longest, ux, uz] = [d, (q[0] - p[0]) / d, (q[1] - p[1]) / d];
    });
    const cx = points.reduce((s, p) => s + p[0], 0) / points.length;
    const cz = points.reduce((s, p) => s + p[1], 0) / points.length;
    const us = points.map((p) => (p[0] - cx) * ux + (p[1] - cz) * uz);
    const ws = points.map((p) => -(p[0] - cx) * uz + (p[1] - cz) * ux);
    const L = Math.max(...us) - Math.min(...us);
    const S = Math.max(...ws) - Math.min(...ws);
    if (L < 8 || S < 4) return false;
    const half = L * 0.17;
    const top = h * 0.6;
    const shape = new THREE.Shape();
    shape.moveTo(-L / 2, 0);
    shape.lineTo(-half, 0);
    shape.lineTo(-half, top - half);
    shape.absarc(0, top - half, half, Math.PI, 0, true);
    shape.lineTo(half, 0);
    shape.lineTo(L / 2, 0);
    shape.lineTo(L / 2, h);
    shape.lineTo(-L / 2, h);
    shape.closePath();
    const g = new THREE.ExtrudeGeometry(shape, { depth: S, bevelEnabled: false, curveSegments: 14 });
    const pos = g.attributes.position;
    const nor = g.attributes.normal;
    for (let i = 0; i < pos.count; i++) {
      const [u, y, d] = [pos.getX(i), pos.getY(i), pos.getZ(i) - S / 2];
      const [nu, ny, nd] = [nor.getX(i), nor.getY(i), nor.getZ(i)];
      const target = ny > 0.9 && y > h - 0.01 ? roof : wall;
      const id = target.vertex(cx + u * ux - d * uz, level + y, cz + u * uz + d * ux, nu * ux - nd * uz, ny, nu * uz + nd * ux, u + d, y, colour, info);
      target.indices.push(id);
    }
    g.dispose();
    return true;
  }

  update(dt: number, night: number, eye: THREE.Vector3) {
    facadeUniforms.uNight.value = night;
    this.facades.update(eye, night);
    this.neon.update(dt, night);
    this.storefronts.update(dt, night);
    for (const rise of this.rising) {
      rise.t = Math.min(1, rise.t + dt / 1.4);
      rise.object.scale.y = Math.max(0.001, 1 - (1 - rise.t) ** 3);
    }
    this.rising = this.rising.filter((r) => r.t < 1);
  }

  dispose() {
    this.facades.dispose();
    this.neon.dispose();
    this.storefronts.dispose();
    this.group.traverse((o) => o instanceof THREE.Mesh && !(o instanceof THREE.InstancedMesh) && o.geometry.dispose());
    this.walls.dispose();
    this.roofs.dispose();
    this.flats.dispose();
  }
}
