interface BlockDef {
  color: string;
  /** Brightness variation between neighbouring blocks, 0..1. */
  vary?: number;
  /** Rendered unlit and over-bright so it blooms. */
  glow?: number;
  /** Rendered in the transparent pass with a lowered surface. */
  liquid?: boolean;
  /** Drawn as a little box [width, height] standing on the block below; you can walk through it. */
  small?: readonly [number, number];
  /** A full-width layer this many blocks thick lying on the block below: kerbs, paving, lawns. */
  slab?: number;
}

// One flat, painterly palette. Every block is a single colour; light, shadow and
// ambient occlusion do the rest.
const DEFS = {
  air: { color: '#000000' },
  grass: { color: '#86b562', vary: 0.1 },
  grassDark: { color: '#5d934e', vary: 0.1 },
  grassDry: { color: '#b3a862', vary: 0.1 },
  grassFresh: { color: '#9bcb6c', vary: 0.09 },
  heather: { color: '#8f7198', vary: 0.12 },
  jungle: { color: '#4fae60', vary: 0.1 },
  soil: { color: '#8a6a4c', vary: 0.07 },
  rock: { color: '#9b9b95', vary: 0.07 },
  rockDark: { color: '#6a6c70', vary: 0.07 },
  sand: { color: '#ead9ab', vary: 0.05 },
  dune: { color: '#e2c48c', vary: 0.05 },
  sandstone: { color: '#d0a775', vary: 0.05 },
  redRock: { color: '#b4553d', vary: 0.06 },
  redRockLight: { color: '#d08a5e', vary: 0.06 },
  redRockDeep: { color: '#93402f', vary: 0.06 },
  snow: { color: '#f3f6f8', vary: 0.025 },
  ice: { color: '#bfe2ee', vary: 0.04 },
  basalt: { color: '#3d3839', vary: 0.08 },
  ash: { color: '#5c5658', vary: 0.07 },
  lava: { color: '#ff6a2b', glow: 2.6 },
  water: { color: '#4aa7bb', liquid: true },
  trunk: { color: '#6b4a36', vary: 0.06 },
  trunkDark: { color: '#3f2c24', vary: 0.06 },
  trunkWhite: { color: '#e4dfd2', vary: 0.05 },
  leaves: { color: '#5e9e4f', vary: 0.13 },
  leavesLight: { color: '#8cc063', vary: 0.13 },
  leavesPine: { color: '#2f6650', vary: 0.12 },
  leavesPalm: { color: '#43a862', vary: 0.12 },
  leavesOrange: { color: '#dd8230', vary: 0.12 },
  leavesRed: { color: '#bb4a31', vary: 0.12 },
  leavesYellow: { color: '#e3b645', vary: 0.12 },
  leavesPink: { color: '#f4a9c2', vary: 0.1 },
  cactus: { color: '#5f9b5d', vary: 0.06 },
  planks: { color: '#b98d5c', vary: 0.06 },
  planksDark: { color: '#7a5738', vary: 0.06 },
  timber: { color: '#4f3a2b', vary: 0.05 },
  stoneBrick: { color: '#a9a8a2', vary: 0.06 },
  stoneDark: { color: '#6f7074', vary: 0.06 },
  brick: { color: '#a9543f', vary: 0.07 },
  whitewash: { color: '#f2ede2', vary: 0.025 },
  marble: { color: '#ecebe6', vary: 0.03 },
  obsidian: { color: '#1d1a24', vary: 0.05 },
  roofSlate: { color: '#4c5561', vary: 0.05 },
  roofTerracotta: { color: '#c8673f', vary: 0.07 },
  roofThatch: { color: '#c7a75d', vary: 0.08 },
  roofBlue: { color: '#3f6fa0', vary: 0.05 },
  glass: { color: '#34465a' },
  windowLit: { color: '#ffc774', glow: 2.2 },
  windowCold: { color: '#7fd6ff', glow: 2.4 },
  lamp: { color: '#fff0c2', glow: 4 },
  fire: { color: '#ff8a2a', glow: 3.2 },
  crystal: { color: '#8ff2e6', glow: 2.3 },
  // Gentler versions for big glowing things: a sun, a bonfire, a crystal hill.
  lampSoft: { color: '#ffe9a8', glow: 1.35 },
  fireSoft: { color: '#ff8a2a', glow: 1.3 },
  crystalSoft: { color: '#8ff2e6', glow: 1.25 },
  crystalViolet: { color: '#c79bff', glow: 2.3 },
  skyLantern: { color: '#ffb45e', glow: 2.8 },
  path: { color: '#c9b48c', vary: 0.06 },
  farmland: { color: '#6e4f37', vary: 0.06 },
  wheat: { color: '#e2c25a', vary: 0.1, small: [0.82, 0.78] },
  crop: { color: '#79b04d', vary: 0.1, small: [0.7, 0.42] },
  tuft: { color: '#7fb45c', vary: 0.14, small: [0.5, 0.34] },
  tuftDry: { color: '#b9ad66', vary: 0.14, small: [0.5, 0.34] },
  fence: { color: '#8a6845', vary: 0.05 },
  cloth: { color: '#f4efe4', vary: 0.02 },
  clothRed: { color: '#c9493c', vary: 0.03 },
  moss: { color: '#6f8f4d', vary: 0.1 },
  flowerRed: { color: '#e2574c', vary: 0.06, small: [0.36, 0.44] },
  flowerYellow: { color: '#f2cf4a', vary: 0.06, small: [0.36, 0.44] },
  flowerBlue: { color: '#6f8fe0', vary: 0.06, small: [0.36, 0.44] },
  flowerWhite: { color: '#f7f3ea', vary: 0.03, small: [0.36, 0.44] },
  flowerPink: { color: '#f08fb4', vary: 0.06, small: [0.36, 0.44] },
  door: { color: '#3a2a20' },
  hull: { color: '#6a4630', vary: 0.05 },
  heart: { color: '#e23b4e', vary: 0.04 },
  asphalt: { color: '#3f4248', vary: 0.05 },
  asphaltWorn: { color: '#4a4d53', vary: 0.05 },
  marking: { color: '#e9e6dc', vary: 0.02 },
  markingYellow: { color: '#e3b63c', vary: 0.03 },
  sidewalk: { color: '#bdbab2', vary: 0.04 },
  concrete: { color: '#a3a5a8', vary: 0.04 },
  glassBlue: { color: '#5d8cab', vary: 0.03 },
  steel: { color: '#7d858e', vary: 0.04 },
  // The city: everything that is not road lies a kerb's height above it.
  kerb: { color: '#b4b1a9', vary: 0.035, slab: 0.22 },
  paving: { color: '#cdbfa2', vary: 0.06, slab: 0.22 },
  lawn: { color: '#86b562', vary: 0.1, slab: 0.3 },
  // Provence fronts.
  ochre: { color: '#e2b36c', vary: 0.035 },
  cream: { color: '#efe1c0', vary: 0.03 },
  apricot: { color: '#e9b48a', vary: 0.035 },
  rose: { color: '#e2a795', vary: 0.035 },
  stonePale: { color: '#d6c9ae', vary: 0.05 },
  shutter: { color: '#7f9fae', vary: 0.03 },
  limestone: { color: '#e4dcc8', vary: 0.04 },
  roofZinc: { color: '#66737f', vary: 0.04 },
  gold: { color: '#e9b93c', vary: 0.05 },
  green: { color: '#35b04a', vary: 0.04 },
  rubber: { color: '#1b1b1f', vary: 0.04 },
  darkGreen: { color: '#2f8f4e', vary: 0.06 },
  lime: { color: '#a6d94a', vary: 0.05 },
  teal: { color: '#2aa198', vary: 0.04 },
  lightBlue: { color: '#8ecbf0', vary: 0.04 },
  pink: { color: '#f29bc1', vary: 0.04 },
  yellow: { color: '#f6d33c', vary: 0.04 },
  brown: { color: '#7a5233', vary: 0.05 },
  grey: { color: '#8d9197', vary: 0.04 },
  white: { color: '#f5f3ee', vary: 0.025 },
  purple: { color: '#8a4fc7', vary: 0.04 },
  orange: { color: '#ee8a2c', vary: 0.05 },
  wax: { color: '#f3e9d2', vary: 0.03 },
  skin: { color: '#e0ac86', vary: 0.04 },
  rainbow1: { color: '#ff5d5d', glow: 1.25 },
  rainbow2: { color: '#ffa24d', glow: 1.25 },
  rainbow3: { color: '#ffe066', glow: 1.25 },
  rainbow4: { color: '#6fdc8c', glow: 1.25 },
  rainbow5: { color: '#5db7ff', glow: 1.25 },
  rainbow6: { color: '#a78bfa', glow: 1.25 },
} as const satisfies Record<string, BlockDef>;

export type BlockName = keyof typeof DEFS;

const NAMES = Object.keys(DEFS) as BlockName[];

/** Block name -> id stored in the voxel grid. `air` is 0. */
export const B = Object.fromEntries(NAMES.map((name, id) => [name, id])) as Record<BlockName, number>;

export const BLOCK_COUNT = NAMES.length;

// Per-id lookups for the mesher, colours already in linear space.
export const COLOR = new Float32Array(BLOCK_COUNT * 3);
export const VARY = new Float32Array(BLOCK_COUNT);
export const GLOW = new Float32Array(BLOCK_COUNT);
export const LIQUID = new Uint8Array(BLOCK_COUNT);
/** Width and height of small blocks; 0 width means a full cube. */
export const SMALL_W = new Float32Array(BLOCK_COUNT);
export const SMALL_H = new Float32Array(BLOCK_COUNT);
/** Thickness of slab blocks; 0 means not a slab. */
export const SLAB = new Float32Array(BLOCK_COUNT);

/** "#rrggbb" in sRGB to linear light, as the renderer wants its vertex colours. No three.js here: this file also runs in the meshing workers. */
function linear(hex: string): [number, number, number] {
  const channel = (i: number) => {
    const c = Number.parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return [channel(1), channel(3), channel(5)];
}

NAMES.forEach((name, id) => {
  const def: BlockDef = DEFS[name];
  COLOR.set(linear(def.color), id * 3);
  VARY[id] = def.vary ?? 0;
  GLOW[id] = def.glow ?? 0;
  LIQUID[id] = def.liquid ? 1 : 0;
  SMALL_W[id] = def.small?.[0] ?? 0;
  SMALL_H[id] = def.small?.[1] ?? 0;
  SLAB[id] = def.slab ?? 0;
});

/** Blocks light passes through for meshing and ambient occlusion. */
export function isOpen(id: number): boolean {
  return id === 0 || LIQUID[id] === 1 || SMALL_W[id] > 0 || SLAB[id] > 0;
}
