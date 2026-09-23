// Steam out of the manholes, as every city at night in every film has it: soft puffs rising, swelling and
// thinning, from the dozen covers nearest the camera, picking up whatever colour the street throws at them.

import * as THREE from 'three';

const PUFFS = 26;
const VENTS = 10;
const LIFE = 3.6;

function puffTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 64;
  const c = canvas.getContext('2d')!;
  const g = c.createRadialGradient(32, 32, 0, 32, 32, 32);
  g.addColorStop(0, 'rgba(255,255,255,0.55)');
  g.addColorStop(0.5, 'rgba(255,255,255,0.18)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  c.fillStyle = g;
  c.fillRect(0, 0, 64, 64);
  const t = new THREE.CanvasTexture(canvas);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export class Steam {
  readonly points: THREE.Points<THREE.BufferGeometry, THREE.PointsMaterial>;
  private readonly position = new Float32Array(PUFFS * VENTS * 3);
  /** Each puff: its vent, its age, and a drift of its own. */
  private readonly age = new Float32Array(PUFFS * VENTS);
  private readonly drift = new Float32Array(PUFFS * VENTS * 2);
  private near: THREE.Vector3[] = [];
  private readonly lastEye = new THREE.Vector3(Infinity, 0, 0);

  constructor(private readonly vents: THREE.Vector3[]) {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(this.position, 3));
    this.points = new THREE.Points(geometry, new THREE.PointsMaterial({ map: puffTexture(), size: 1.6, sizeAttenuation: true, transparent: true, depthWrite: false, opacity: 0.5, color: '#cfc7d8', fog: true }));
    this.points.frustumCulled = false;
    for (let i = 0; i < this.age.length; i++) {
      this.age[i] = Math.random() * LIFE;
      this.drift[i * 2] = (Math.random() - 0.5) * 0.5;
      this.drift[i * 2 + 1] = (Math.random() - 0.5) * 0.5;
    }
  }

  update(dt: number, eye: THREE.Vector3, night: number, wet: number) {
    // Steam is a night and rain thing; by day it hardly shows.
    const amount = Math.min(1, night * 0.8 + wet * 0.6);
    this.points.visible = amount > 0.05 && this.vents.length > 0;
    if (!this.points.visible) return;
    this.points.material.opacity = 0.5 * amount;
    if (eye.distanceToSquared(this.lastEye) > 25) {
      this.lastEye.copy(eye);
      this.near = this.vents
        .filter((v) => v.distanceToSquared(eye) < 90 * 90)
        .sort((a, b) => a.distanceToSquared(eye) - b.distanceToSquared(eye))
        .slice(0, VENTS);
    }
    for (let i = 0; i < this.age.length; i++) {
      const vent = this.near[Math.floor(i / PUFFS)];
      if (!vent) {
        this.position[i * 3 + 1] = -1e4;
        continue;
      }
      this.age[i] = (this.age[i] + dt) % LIFE;
      const t = this.age[i] / LIFE;
      // Up, slowing, and off with the breeze; a puff near the end of its life is high and thin.
      this.position[i * 3] = vent.x + this.drift[i * 2] * t * 2.2 + t * 0.6;
      this.position[i * 3 + 1] = vent.y + 0.1 + Math.sqrt(t) * 2.6;
      this.position[i * 3 + 2] = vent.z + this.drift[i * 2 + 1] * t * 2.2;
    }
    this.points.geometry.attributes.position.needsUpdate = true;
  }

  dispose() {
    this.points.geometry.dispose();
    this.points.material.map?.dispose();
    this.points.material.dispose();
  }
}
