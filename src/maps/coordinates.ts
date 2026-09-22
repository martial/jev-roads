import { SIZE } from '../city/osm';

export interface Origin { lat: number; lon: number }

/** The simulation's east/south metre grid, shared by the world, picker and GPS. */
export function toLatLng(origin: Origin, x: number, z: number) {
  return { lat: origin.lat - (z - SIZE / 2) / 111320, lng: origin.lon + (x - SIZE / 2) / (111320 * Math.cos(origin.lat * Math.PI / 180)) };
}

export function toWorld(origin: Origin, lat: number, lng: number): [number, number] {
  return [(lng - origin.lon) * 111320 * Math.cos(origin.lat * Math.PI / 180) + SIZE / 2, (origin.lat - lat) * 111320 + SIZE / 2];
}

export function boundsAround(origin: Origin) {
  const sw = toLatLng(origin, 0, SIZE);
  const ne = toLatLng(origin, SIZE, 0);
  return { south: sw.lat, west: sw.lng, north: ne.lat, east: ne.lng };
}

export function cameraPose(origin: Origin, eye: { x: number; y: number; z: number }, target: { x: number; y: number; z: number }, base = 0) {
  const dx = target.x - eye.x, dy = target.y - eye.y, dz = target.z - eye.z;
  const range = Math.max(1, Math.hypot(dx, dy, dz));
  return {
    center: { ...toLatLng(origin, target.x, target.z), altitude: target.y + base },
    range,
    heading: (Math.atan2(dx, -dz) * 180 / Math.PI + 360) % 360,
    tilt: Math.acos(Math.max(-1, Math.min(1, -dy / range))) * 180 / Math.PI,
  };
}
