// Real places from OpenStreetMap. A square kilometre is fetched in pieces: first the streets of the
// whole square (small, and all the traffic needs), then the scenery — buildings, water, trees — as
// nine tiles, so a city can rise bit by bit. Every piece is kept on disk: a place is only ever
// fetched once, and then opens instantly, and offline.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

/** Streets fetched once and kept: under the project, or wherever CACHE_DIR says (App Engine only lets us write /tmp). */
const DIR = process.env.CACHE_DIR ? join(process.env.CACHE_DIR, 'maps') : 'maps';
/** Half the side of the world, metres. Must match SIZE / 2 in src/city/osm.ts. */
export const HALF = 512;
/** The scenery comes as TILES x TILES pieces. */
export const TILES = 3;
const HOST = 'https://overpass.openstreetmap.fr/api/interpreter';
const FALLBACK = 'https://overpass-api.de/api/interpreter';
const AGENT = 'jev-roads/0.2 (local traffic simulation)';

interface Osm {
  elements: unknown[];
}

// Two public Overpass servers. The French one answers in a second or two and takes several queries at
// once, so parts of a town can be fetched side by side. The German one rations each address to one query
// at a time with a cool-down it announces on its status page; it is the fallback, and queries to it queue
// up and wait exactly as long as they are told to.
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

let busy = 0;
const waiting: Array<() => void> = [];
async function sideBySide<T>(work: () => Promise<T>): Promise<T> {
  if (busy >= 3) await new Promise<void>((go) => waiting.push(go));
  busy++;
  try {
    return await work();
  } finally {
    busy--;
    waiting.shift()?.();
  }
}

let chain: Promise<unknown> = Promise.resolve();
function inTurn<T>(work: () => Promise<T>): Promise<T> {
  const next = chain.then(work, work);
  chain = next.catch(() => {});
  return next;
}

async function ask(host: string, query: string, patience: number): Promise<Osm | number> {
  const res = await fetch(host, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': AGENT }, body: `data=${encodeURIComponent(query)}`, signal: AbortSignal.timeout(patience) });
  if (!res.ok) return res.status;
  const osm = JSON.parse(await res.text()) as Partial<Osm>;
  if (!Array.isArray(osm.elements)) throw new Error('unreadable answer');
  return { elements: osm.elements };
}

/** Seconds until the fallback server will take another query from us. */
async function coolDown(): Promise<number> {
  try {
    const text = await (await fetch(FALLBACK.replace('/interpreter', '/status'), { headers: { 'User-Agent': AGENT }, signal: AbortSignal.timeout(8000) })).text();
    if (/slots? available now/.test(text)) return 0;
    const waits = [...text.matchAll(/in (\d+) seconds/g)].map((m) => Number(m[1]));
    return waits.length ? Math.min(...waits) : 5;
  } catch {
    return 5;
  }
}

/** One Overpass query: the quick server first, the rationed one if that fails. */
async function overpass(query: string): Promise<Osm> {
  const errors: string[] = [];
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const got = await sideBySide(() => ask(HOST, query, 40000));
      if (typeof got !== 'number') return got;
      errors.push(`${new URL(HOST).hostname}: HTTP ${got}`);
    } catch (error) {
      errors.push(`${new URL(HOST).hostname}: ${(error as Error).name === 'TimeoutError' ? 'timed out' : (error as Error).message}`);
    }
    await sleep(1500 + attempt * 2000);
  }
  return inTurn(async () => {
    for (let attempt = 0; attempt < 4; attempt++) {
      try {
        const got = await ask(FALLBACK, query, 45000);
        if (typeof got !== 'number') return got;
        errors.push(`${new URL(FALLBACK).hostname}: HTTP ${got}`);
        await sleep(got === 429 ? (Math.min(40, await coolDown()) + 1) * 1000 : 4000);
      } catch (error) {
        errors.push(`${new URL(FALLBACK).hostname}: ${(error as Error).name === 'TimeoutError' ? 'timed out' : (error as Error).message}`);
        await sleep(3000);
      }
    }
    throw new Error(errors.join('; '));
  });
}

const folder = (lat: number, lon: number) => join(DIR, `${lat.toFixed(4)}_${lon.toFixed(4)}`);

/** Local reads don't consume the quota reserved for requests to external map services. */
export function hasCachedMapData(lat: number, lon: number, part: 'streets' | 'terrain' | number): boolean {
  const name = typeof part === 'number' ? `scenery-${part}` : part;
  return existsSync(join(folder(lat, lon), `${name}.json`));
}

/** south,west,north,east of a rectangle given in metres east (x) and south (z) of the centre. */
function box(lat: number, lon: number, x0: number, z0: number, x1: number, z1: number): string {
  const kx = 111320 * Math.cos((lat * Math.PI) / 180);
  return `${lat - z1 / 111320},${lon + x0 / kx},${lat - z0 / 111320},${lon + x1 / kx}`;
}

function cached(file: string): Osm | null {
  return existsSync(file) ? (JSON.parse(readFileSync(file, 'utf8')) as Osm) : null;
}

function keep(file: string, osm: Osm) {
  mkdirSync(join(file, '..'), { recursive: true });
  writeFileSync(file, JSON.stringify(osm));
}

/** Every street of the square, its signals and crossings, and the sea's edge. */
export async function loadStreets(lat: number, lon: number): Promise<{ lat: number; lon: number; osm: Osm; cached: boolean }> {
  const file = join(folder(lat, lon), 'streets.json');
  const had = cached(file);
  if (had) return { lat, lon, osm: had, cached: true };
  const b = box(lat, lon, -HALF - 20, -HALF - 20, HALF + 20, HALF + 20);
  const query = `[out:json][timeout:30];(
    way["highway"~"^(motorway|trunk|primary|secondary|tertiary|unclassified|residential|living_street|service|motorway_link|trunk_link|primary_link|secondary_link|tertiary_link)$"](${b});
    node["highway"~"^(traffic_signals|crossing|give_way|stop)$"](${b});way["natural"="coastline"](${b}););out body;>;out skel qt;`;
  let osm: Osm;
  try {
    osm = await overpass(query);
  } catch (error) {
    throw new Error(`OpenStreetMap is not answering right now (${(error as Error).message}). Try again in a minute, or pick a place already on disk.`);
  }
  if (!osm.elements.length) throw new Error('No streets found here. Try a town centre.');
  keep(file, osm);
  return { lat, lon, osm, cached: false };
}

/** Buildings, water, parks, trees and fountains of one of the nine tiles. */
export async function loadScenery(lat: number, lon: number, tile: number): Promise<{ tile: number; osm: Osm; cached: boolean }> {
  const file = join(folder(lat, lon), `scenery-${tile}.json`);
  const had = cached(file);
  if (had) return { tile, osm: had, cached: true };
  const side = (HALF * 2) / TILES;
  const [tx, tz] = [tile % TILES, Math.floor(tile / TILES)];
  const b = box(lat, lon, -HALF + tx * side, -HALF + tz * side, -HALF + (tx + 1) * side, -HALF + (tz + 1) * side);
  const query = `[out:json][timeout:30];(
    way["building"](${b});relation["building"](${b});way["natural"="water"](${b});relation["natural"="water"](${b});way["amenity"="fountain"](${b});node["amenity"="fountain"](${b});
    way["leisure"~"^(park|garden)$"](${b});way["landuse"~"^(grass|forest|meadow|village_green)$"](${b});node["natural"="tree"](${b}););out body;>;out skel qt;`;
  let osm: Osm;
  try {
    osm = await overpass(query);
  } catch (error) {
    throw new Error(`OpenStreetMap was too busy for this part of town (${(error as Error).message})`);
  }
  keep(file, osm);
  return { tile, osm, cached: false };
}

/** Which places are already on disk, whole. */
export function isKept(lat: number, lon: number): boolean {
  const dir = folder(lat, lon);
  return existsSync(join(dir, 'streets.json')) && Array.from({ length: TILES * TILES }, (_, i) => existsSync(join(dir, `scenery-${i}.json`))).every(Boolean);
}

/** A place name to coordinates, through OpenStreetMap's Nominatim. */
export async function findPlace(query: string): Promise<{ name: string; lat: number; lon: number } | null> {
  const res = await fetch(`https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&q=${encodeURIComponent(query)}`, { headers: { 'User-Agent': AGENT }, signal: AbortSignal.timeout(15000) });
  if (!res.ok) throw new Error(`Place search returned HTTP ${res.status}`);
  const rows = (await res.json()) as Array<{ display_name: string; lat: string; lon: string }>;
  return rows[0] ? { name: rows[0].display_name, lat: Number(rows[0].lat), lon: Number(rows[0].lon) } : null;
}

/** Coordinates to a short human name: "Rue de Rivoli, Paris". */
export async function nameOf(lat: number, lon: number): Promise<{ name: string }> {
  const res = await fetch(`https://nominatim.openstreetmap.org/reverse?format=jsonv2&zoom=17&lat=${lat}&lon=${lon}`, { headers: { 'User-Agent': AGENT, 'Accept-Language': 'en,fr;q=0.8' }, signal: AbortSignal.timeout(10000) });
  if (!res.ok) throw new Error(`Place lookup returned HTTP ${res.status}`);
  const row = (await res.json()) as { address?: Record<string, string>; display_name?: string };
  const a = row.address ?? {};
  const near = a.road ?? a.pedestrian ?? a.square ?? a.neighbourhood ?? a.suburb ?? a.quarter ?? '';
  const town = a.city ?? a.town ?? a.village ?? a.municipality ?? a.county ?? a.state ?? a.country ?? '';
  return { name: [near, town].filter(Boolean).join(', ') || (row.display_name ?? '').split(',').slice(0, 2).join(',') || `${lat.toFixed(4)}, ${lon.toFixed(4)}` };
}
