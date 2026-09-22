import type { PerspectiveCamera } from 'three';
import { loadGoogleMaps } from '../../maps/google';
import { toLatLng, type Origin } from '../../maps/coordinates';
import type { Car } from '../../sim/cars';

/** Optional street-photo scenery for the cabin.
 * Position advances between nearby panoramas; head rotation stays continuous. */
export class StreetRide {
  readonly element = document.createElement('div');
  private readonly image = document.createElement('div');
  private readonly notice = document.createElement('p');
  private panorama: google.maps.StreetViewPanorama | null = null;
  private service: google.maps.StreetViewService | null = null;
  private active = false;
  private disposed = false;
  private busy = false;
  private lastRequest = -Infinity;
  private lastPosition = { x: Infinity, z: Infinity };
  private pano = '';
  private sequence = 0;

  constructor(private origin: Origin) {
    this.element.className = 'street-ride';
    this.image.className = 'street-ride-image';
    this.notice.className = 'street-ride-notice';
    this.notice.setAttribute('role', 'status');
    this.notice.textContent = 'Finding street imagery…';
    this.element.append(this.image, this.notice);
    this.element.hidden = true;
    void this.init();
  }

  private async init() {
    try {
      const maps = await loadGoogleMaps();
      const { StreetViewPanorama, StreetViewService } = await maps.importLibrary('streetView') as google.maps.StreetViewLibrary;
      if (this.disposed) return;
      this.service = new StreetViewService();
      this.panorama = new StreetViewPanorama(this.image, {
        visible: false, disableDefaultUI: true, linksControl: false, clickToGo: false,
        scrollwheel: false, motionTracking: false, motionTrackingControl: false,
        addressControl: false, showRoadLabels: false, enableCloseButton: false,
      });
      this.panorama.addListener('status_changed', () => {
        if (this.panorama?.getStatus() === 'OK') this.notice.textContent = 'Street View · imagery advances along your ride';
      });
    } catch { this.notice.textContent = 'Street View is unavailable here. Choose Chase to follow your taxi in 3D.'; }
  }

  show(on: boolean) {
    if (this.active === on) return;
    this.active = on;
    this.element.hidden = !on;
    this.panorama?.setVisible(on && Boolean(this.pano));
    if (!on) { this.sequence++; this.busy = false; }
    else this.lastRequest = -Infinity;
  }

  update(car: Car, heading: number, tilt: number, camera: PerspectiveCamera) {
    if (!this.active || this.disposed) return;
    if (this.panorama) {
      this.panorama.setPov({ heading, pitch: Math.max(-35, Math.min(35, 90 - tilt)) });
      const horizontal = 2 * Math.atan(Math.tan(camera.fov * Math.PI / 360) * camera.aspect) * 180 / Math.PI;
      this.panorama.setZoom(Math.max(0, Math.log2(180 / horizontal)));
    }
    const now = performance.now();
    if (!this.service || this.busy || now - this.lastRequest < 2500) return;
    if (this.pano && Math.hypot(car.x - this.lastPosition.x, car.z - this.lastPosition.z) < 12) return;
    this.busy = true;
    this.lastRequest = now;
    const position = { x: car.x, z: car.z };
    const sequence = ++this.sequence;
    void this.service.getPanorama({ location: toLatLng(this.origin, car.x, car.z), radius: 45, preference: google.maps.StreetViewPreference.NEAREST, sources: [google.maps.StreetViewSource.OUTDOOR] })
      .then(({ data }) => {
        if (this.disposed || !this.active || sequence !== this.sequence) return;
        const pano = data.location?.pano;
        if (!pano) throw new Error('No panorama');
        this.lastPosition = position;
        if (pano !== this.pano) {
          this.pano = pano;
          this.panorama?.setPano(pano);
          this.panorama?.setVisible(true);
        }
      }).catch(() => {
        if (this.disposed || !this.active || sequence !== this.sequence) return;
        // Never leave the passenger looking at an old street after driving out of coverage.
        this.pano = '';
        this.panorama?.setVisible(false);
        this.notice.textContent = 'No Street View on this road. Choose Chase for the 3D view.';
      }).finally(() => { if (sequence === this.sequence) this.busy = false; });
  }

  dispose() {
    this.disposed = true;
    this.sequence++;
    this.panorama?.setVisible(false);
    if (this.panorama) google.maps.event.clearInstanceListeners(this.panorama);
    this.element.remove();
  }
}
