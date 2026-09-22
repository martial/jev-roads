import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const MODELS = new Set(['hatch', 'saloon', 'estate', 'suv', 'coupe', 'pickup', 'van', 'bus', 'truck']);
const sources = new Map<string, Promise<Buffer>>();
const variants = new Map<string, Buffer>();

/** Native Google models cannot use Three's per-instance paint. Change only the GLB paint material. */
export async function paintedVehicle(model: string, colour: string): Promise<Buffer | null> {
  if (!MODELS.has(model) || !/^[0-9a-f]{6}$/i.test(colour)) return null;
  const key = `${model}/${colour.toLowerCase()}`;
  const cached = variants.get(key);
  if (cached) return cached;
  let source = sources.get(model);
  if (!source) {
    source = readFile(resolve('public/models', `${model}.glb`));
    sources.set(model, source);
    source.catch(() => sources.delete(model));
  }
  const original = await source;
  const jsonLength = original.readUInt32LE(12);
  const document = JSON.parse(original.subarray(20, 20 + jsonLength).toString('utf8'));
  // glTF baseColorFactor is linear RGB, while the simulation stores CSS sRGB colours.
  const linear = [0, 2, 4].map((at) => {
    const srgb = parseInt(colour.slice(at, at + 2), 16) / 255;
    return srgb <= 0.04045 ? srgb / 12.92 : ((srgb + 0.055) / 1.055) ** 2.4;
  });
  for (const material of document.materials) {
    if (material.name.split('.')[0] === 'paint') material.pbrMetallicRoughness.baseColorFactor = [...linear, 1];
  }
  const json = Buffer.from(JSON.stringify(document));
  const padded = Buffer.alloc(Math.ceil(json.length / 4) * 4, 0x20);
  json.copy(padded);
  const header = Buffer.from(original.subarray(0, 20));
  const binary = original.subarray(20 + jsonLength);
  header.writeUInt32LE(20 + padded.length + binary.length, 8);
  header.writeUInt32LE(padded.length, 12);
  const result = Buffer.concat([header, padded, binary]);
  // Bound memory even if callers request arbitrary paint colours.
  if (variants.size >= 256) variants.delete(variants.keys().next().value!);
  variants.set(key, result);
  return result;
}
