// Several chunks of the city are meshed at once, each in its own worker, while the page keeps
// drawing. If workers are not available the same mesher runs here instead, one chunk at a time.

import { meshChunk, type ChunkArrays, type Voxels } from './voxels';
import type { MeshDone, MeshJob } from './mesh.worker';

export class MeshPool {
  private readonly idle: Worker[] = [];
  private readonly waiting = new Map<number, (arrays: ChunkArrays) => void>();
  private nextJob = 1;
  readonly size: number;

  constructor() {
    let count = Math.max(2, Math.min(8, (navigator.hardwareConcurrency || 4) - 2));
    try {
      for (let i = 0; i < count; i++) {
        const worker = new Worker(new URL('./mesh.worker.ts', import.meta.url), { type: 'module' });
        worker.onmessage = (e: MessageEvent<MeshDone>) => {
          this.idle.push(worker);
          const done = this.waiting.get(e.data.job);
          this.waiting.delete(e.data.job);
          done?.(e.data.arrays);
        };
        this.idle.push(worker);
      }
    } catch {
      count = 0;
    }
    this.size = count;
  }

  /** Workers with nothing to do right now. */
  get free(): number {
    return this.size ? this.idle.length : this.waiting.size ? 0 : 1;
  }

  mesh(voxels: Voxels, cx: number, cz: number): Promise<ChunkArrays> {
    const worker = this.idle.pop();
    if (!worker) return Promise.resolve(meshChunk(voxels, cx, cz));
    return new Promise((resolve) => {
      const job = this.nextJob++;
      this.waiting.set(job, resolve);
      const slab = voxels.slab(cx, cz);
      const message: MeshJob = { job, cx, cz, slab };
      worker.postMessage(message, [slab.buffer]);
    });
  }

  dispose() {
    for (const worker of this.idle) worker.terminate();
    this.idle.length = 0;
  }
}
