// One of several meshing workers. It is handed a chunk of the world (plus a one-block border, for
// face culling and corner shading) and hands back triangles.

import { CHUNK, Slab, meshChunk, type ChunkArrays, type MeshArrays } from './voxels';

export interface MeshJob {
  job: number;
  cx: number;
  cz: number;
  slab: Uint8Array;
}

export interface MeshDone {
  job: number;
  arrays: ChunkArrays;
}

const buffers = (m: MeshArrays | null): ArrayBuffer[] => (m ? [m.positions.buffer, m.normals.buffer, m.colors.buffer, m.indices.buffer] as ArrayBuffer[] : []);

self.onmessage = (e: MessageEvent<MeshJob>) => {
  const { job, cx, cz, slab } = e.data;
  const arrays = meshChunk(new Slab(slab, cx * CHUNK - 1, cz * CHUNK - 1), cx, cz);
  const done: MeshDone = { job, arrays };
  (self as unknown as { postMessage(message: unknown, transfer: Transferable[]): void }).postMessage(done, [...buffers(arrays.solid), ...buffers(arrays.glow), ...buffers(arrays.liquid)]);
};
