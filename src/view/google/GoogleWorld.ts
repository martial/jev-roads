import type { PerspectiveCamera, Vector3 } from 'three';
import { loadGoogleMaps, onGoogleAuthError } from '../../maps/google';
import { cameraPose, toLatLng } from '../../maps/coordinates';
import type { PlaceData } from '../types';
import type { Car } from '../../sim/cars';
import type { RideView } from '../../sim/ride';
import { get, set } from '../../store';
import { StreetRide } from './StreetRide';

/** Google owns the landscape, depth-tested traffic models, route and required attribution.
 * Three.js only draws the cabin on a transparent foreground canvas. No raw tile access or cache. */
export class GoogleWorld {
  private map: google.maps.maps3d.Map3DElement | null = null;
  private library: google.maps.Maps3DLibrary | null = null;
  private models = new Map<number, google.maps.maps3d.Model3DElement>();
  private route: google.maps.maps3d.Polyline3DElement | null = null;
  private destination: google.maps.maps3d.Marker3DElement | null = null;
  private routeKey = '';
  private disposed = false;
  private clock = 0;
  private cameraClock = 0;
  private street: StreetRide | null = null;
  private watchdog = 0;
  private readonly offAuth: () => void;
  ready = false;

  constructor(private holder: HTMLElement, private data: PlaceData) {
    set({ googleStatus: 'loading', googleError: '' });
    this.offAuth = onGoogleAuthError((message) => this.fail(message));
    void this.init();
  }

  private fail(message: string) {
    if (this.disposed) return;
    this.ready = false;
    set({ googleStatus: 'error', googleError: message });
  }

  private async init() {
    try {
      const maps = await loadGoogleMaps();
      const library = await maps.importLibrary('maps3d') as google.maps.Maps3DLibrary;
      if (this.disposed) return;
      this.library = library;
      const { Map3DElement } = library;
      const terrain = this.data.terrain;
      const middle = terrain ? terrain.heights[Math.floor(terrain.n / 2) * terrain.n + Math.floor(terrain.n / 2)] : 0;
      const map = new Map3DElement({
        center: { lat: this.data.place.lat, lng: this.data.place.lon, altitude: middle },
        range: 950, tilt: 58, heading: 25, mode: 'HYBRID', defaultUIHidden: true,
        description: 'Photorealistic Google Maps scenery for your taxi ride',
      });
      map.className = 'google-world-map';
      this.map = map;
      map.addEventListener('gmp-error', () => this.fail('The 3D world could not load. Check Maps JavaScript API access, WebGL and your connection.'));
      map.addEventListener('gmp-steadychange', (event) => {
        if (!event.isSteady || this.disposed || get().googleStatus === 'ready') return;
        clearTimeout(this.watchdog);
        this.ready = true;
        set({ googleStatus: 'ready', googleError: '' });
      });
      this.holder.append(map);
      this.watchdog = window.setTimeout(() => this.fail('The 3D scenery is taking too long to load. Retry, or choose OpenStreetMap in settings.'), 45000);
    } catch (error) { this.fail((error as Error).message); }
  }

  update(dt: number, camera: PerspectiveCamera, aim: Vector3, groundAtEye: number, inside: Car | null, ride: RideView | null) {
    if (!this.map || !this.library || !this.ready || this.disposed || document.hidden) return;
    const pose = cameraPose(this.data.place, camera.position, aim);
    const street = Boolean(inside) && get().worldMode === 'street';
    if (street && !this.street) {
      this.street = new StreetRide(this.data.place);
      this.holder.append(this.street.element);
    }
    this.street?.show(street);
    this.map.style.visibility = street ? 'hidden' : 'visible';
    if (street && inside) {
      this.street?.update(inside, pose.heading, pose.tilt, camera);
      return;
    }
    this.cameraClock += dt;
    if (this.cameraClock >= 1 / 30) {
      this.cameraClock = 0;
      // Anchor the eye to Google's terrain, not the independent radar elevation used by the simulation.
      // A zero-duration native camera update keeps its own terrain/LOD handling in charge.
      this.map.flyCameraTo({ durationMillis: 0, endCamera: {
        cameraPosition: { ...toLatLng(this.data.place, camera.position.x, camera.position.z), altitude: Math.max(1.25, camera.position.y - groundAtEye) },
        altitudeMode: 'RELATIVE_TO_GROUND', range: pose.range, heading: pose.heading, tilt: pose.tilt, fov: camera.fov,
      } });
      this.map.mode = get().mapLabels && !inside ? 'HYBRID' : 'SATELLITE';
    }
    this.clock += dt;
    // Native models are positioned on Google's ground, so aerial views have proper building occlusion.
    if (this.clock >= 1 / 20) {
      this.clock = 0;
      const wanted = new Set<number>();
      const cars = this.data.traffic.cars;
      for (const car of cars) {
        if (car === inside) continue;
        wanted.add(car.id);
        let model = this.models.get(car.id);
        if (!model) {
          model = new this.library.Model3DElement({
            src: new URL(`/api/vehicle/${car.driver.body.model}-${car.driver.color.slice(1)}.glb`, location.href).href,
            altitudeMode: 'CLAMP_TO_GROUND',
          });
          this.models.set(car.id, model);
          model.dataset.carId = String(car.id);
          model.dataset.colour = car.driver.color;
          this.map.append(model);
        }
        model.position = toLatLng(this.data.place, car.x, car.z);
        // Our GLBs are Y-up; Maps models use Z-up. Convert before applying compass heading.
        model.orientation = { heading: (Math.atan2(car.dx, -car.dz) * 180 / Math.PI + 270) % 360, tilt: 270 };
      }
      for (const [id, model] of this.models) if (!wanted.has(id)) { model.remove(); this.models.delete(id); }
    }
    if (ride && !inside) this.drawRoute(ride);
    // A ground-clamped route becomes a wall across the windscreen when seen edge-on.
    // Keep it on the GPS in the cabin, and on the world in aerial views.
    for (const overlay of [this.route, this.destination]) {
      if (!overlay) continue;
      if (inside) overlay.remove();
      else if (!overlay.isConnected) this.map.append(overlay);
    }
  }

  private drawRoute(ride: RideView) {
    const key = `${ride.recalc}:${ride.routeLanes.join(',')}`;
    if (key === this.routeKey || !this.map || !this.library) return;
    this.routeKey = key;
    this.route?.remove();
    this.destination?.remove();
    const path = ride.routeLanes.flatMap((id) => this.data.net.lanes[id]?.points.map(([x, z]) => toLatLng(this.data.place, x, z)) ?? []);
    if (path.length < 2) return;
    this.route = new this.library.Polyline3DElement({ path, strokeColor: '#f2c230', strokeWidth: 7, outerColor: '#1b1d21', outerWidth: 0.3, altitudeMode: 'CLAMP_TO_GROUND', drawsOccludedSegments: true });
    this.destination = new this.library.Marker3DElement({ position: path[path.length - 1], label: ride.destination, altitudeMode: 'CLAMP_TO_GROUND' });
    this.map.append(this.route, this.destination);
  }

  dispose() {
    this.disposed = true;
    clearTimeout(this.watchdog);
    this.offAuth();
    this.street?.dispose();
    this.map?.stopCameraAnimation();
    this.map?.remove();
    this.models.clear();
    this.map = null;
  }
}
