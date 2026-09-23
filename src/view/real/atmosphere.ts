// Light and air: a physical sky, a sun that casts real shadows, reflections of that sky on every
// glossy surface, fog that takes the sky's colour, stars, rain. Everything eases between states.

import * as THREE from 'three';
import { Sky as PhysicalSky } from 'three/examples/jsm/objects/Sky.js';
import { SIZE } from '../../city/osm';
import type { TimeOfDay, Weather } from '../../engine/sky';

interface Hour {
  elevation: number;
  azimuth: number;
  sun: string;
  sunPower: number;
  turbidity: number;
  rayleigh: number;
  /** How bright the reflected sky is on surfaces. */
  ambient: number;
  exposure: number;
  fog: string;
  stars: number;
}

const HOURS: Record<TimeOfDay, Hour> = {
  dawn: { elevation: 7, azimuth: 100, sun: '#ffc9a0', sunPower: 4.4, turbidity: 6, rayleigh: 2.4, ambient: 0.46, exposure: 0.5, fog: '#a8958c', stars: 0.1 },
  midday: { elevation: 52, azimuth: 150, sun: '#fff4e2', sunPower: 6.2, turbidity: 3.2, rayleigh: 1.1, ambient: 0.4, exposure: 0.4, fog: '#9fb2c2', stars: 0 },
  golden: { elevation: 11, azimuth: 255, sun: '#ffb877', sunPower: 4.6, turbidity: 7, rayleigh: 2.6, ambient: 0.46, exposure: 0.4, fog: '#b3957a', stars: 0 },
  dusk: { elevation: 1.5, azimuth: 268, sun: '#ff8f66', sunPower: 2.0, turbidity: 9, rayleigh: 3.4, ambient: 0.7, exposure: 0.62, fog: '#5f5468', stars: 0.4 },
  night: { elevation: -12, azimuth: 210, sun: '#9db4ff', sunPower: 0.7, turbidity: 2, rayleigh: 0.4, ambient: 1.4, exposure: 0.72, fog: '#1a0f2a', stars: 1 },
};

const DROPS = 2600;
const BOX = 60;

export class Atmosphere {
  readonly sun = new THREE.DirectionalLight('#ffffff', 3);
  readonly sunDir = new THREE.Vector3(0.4, 0.8, 0.3);
  /** 0 by day, 1 at night: windows, lamps and headlights read it. */
  night = 0;
  wet = 0;

  private readonly sky = new PhysicalSky();
  private readonly skyScene = new THREE.Scene();
  private readonly pmrem: THREE.PMREMGenerator;
  private readonly fill = new THREE.HemisphereLight('#dfe6f2', '#8a7c68', 0.35);
  private readonly fog = new THREE.FogExp2('#9fb2c2', 0.00042);
  private readonly stars: THREE.Points<THREE.BufferGeometry, THREE.PointsMaterial>;
  private readonly rain: THREE.LineSegments<THREE.BufferGeometry, THREE.LineBasicMaterial>;
  private readonly drops = new Float32Array(DROPS * 3);
  private env: THREE.WebGLRenderTarget | null = null;
  private time: TimeOfDay = 'midday';
  private weather: Weather = 'clear';
  private readonly now: Hour = { ...HOURS.midday };
  private envClock = 9;
  private envDirty = true;

  constructor(
    private readonly scene: THREE.Scene,
    private readonly renderer: THREE.WebGLRenderer,
  ) {
    this.pmrem = new THREE.PMREMGenerator(renderer);
    scene.fog = this.fog;
    scene.add(this.fill);

    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(4096, 4096);
    this.sun.shadow.bias = -0.00025;
    this.sun.shadow.normalBias = 0.06;
    scene.add(this.sun, this.sun.target);

    this.sky.scale.setScalar(9000);
    // The sky model is far brighter than anything it lights; turned down so that the horizon keeps its colour
    // instead of burning out. (The reflections baked from it are turned back up to match.)
    this.sky.material.uniforms.uCityNight = { value: 0 };
    this.sky.material.fragmentShader = `uniform float uCityNight;\n${this.sky.material.fragmentShader}`.replace('gl_FragColor = vec4( texColor, 1.0 );', `
      float late=smoothstep(.7,1.0,uCityNight);
      // Light pollution: the city lights the underside of the sky violet towards the horizon.
      vec3 zenith=mix(vec3(.025,.05,.105),vec3(.006,.006,.024),late);
      vec3 horizon=mix(vec3(.13,.18,.24),vec3(.075,.028,.085),late);
      vec3 citySky=mix(horizon,zenith,pow(max(0.0,direction.y),.55));
      gl_FragColor=vec4(mix(texColor*.42,citySky,uCityNight*.9),1.0);
    `);
    const u = this.sky.material.uniforms;
    u.mieCoefficient.value = 0.004;
    u.mieDirectionalG.value = 0.82;
    scene.add(this.sky);
    // The same sky, alone in a scene of its own, is what gets baked into the reflections.
    const twin = new PhysicalSky();
    twin.scale.setScalar(9000);
    twin.material = this.sky.material;
    this.skyScene.add(twin);

    const positions = new Float32Array(900 * 3);
    for (let i = 0; i < 900; i++) {
      const a = Math.random() * Math.PI * 2;
      const b = Math.acos(Math.random() * 0.94 + 0.04);
      positions.set([Math.sin(b) * Math.cos(a) * 5000, Math.cos(b) * 5000, Math.sin(b) * Math.sin(a) * 5000], i * 3);
    }
    const starGeometry = new THREE.BufferGeometry();
    starGeometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    this.stars = new THREE.Points(starGeometry, new THREE.PointsMaterial({ color: '#dfe8ff', size: 1.6, sizeAttenuation: false, transparent: true, opacity: 0, fog: false, depthWrite: false }));
    this.stars.frustumCulled = false;
    scene.add(this.stars);

    for (let i = 0; i < DROPS; i++) this.drops.set([Math.random() * BOX, Math.random() * BOX, Math.random() * BOX], i * 3);
    const rainGeometry = new THREE.BufferGeometry();
    rainGeometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(DROPS * 6), 3));
    this.rain = new THREE.LineSegments(rainGeometry, new THREE.LineBasicMaterial({ color: '#c9d8e6', transparent: true, opacity: 0, depthWrite: false }));
    this.rain.frustumCulled = false;
    scene.add(this.rain);
  }

  get current(): { time: TimeOfDay; weather: Weather } {
    return { time: this.time, weather: this.weather };
  }

  /** Keep the cabin's lighting and reflections while Google draws the sky and landscape. */
  hideBackdrop() {
    this.sky.visible = false;
    this.stars.visible = false;
    this.scene.fog = null;
  }

  set(time: TimeOfDay, weather: Weather) {
    this.time = time;
    this.weather = weather;
    this.envDirty = true;
  }

  /** `focus` is what the shadows should be sharpest around; `reach` how far they must cover. */
  update(dt: number, camera: THREE.Vector3, focus: THREE.Vector3, reach: number) {
    const want = HOURS[this.time];
    const grey = this.weather === 'rain' ? 1 : this.weather === 'mist' ? 0.7 : 0;
    const k = 1 - Math.exp(-dt * 0.9);
    const n = this.now;
    const ease = (key: 'elevation' | 'azimuth' | 'sunPower' | 'turbidity' | 'rayleigh' | 'ambient' | 'exposure' | 'stars') => (n[key] += (want[key] - n[key]) * k);
    (['elevation', 'azimuth', 'sunPower', 'turbidity', 'rayleigh', 'ambient', 'exposure', 'stars'] as const).forEach(ease);
    const moving = Math.abs(want.elevation - n.elevation) > 0.3 || Math.abs(this.wet - grey) > 0.02;
    this.wet += (grey - this.wet) * k;
    this.night += ((this.time === 'night' ? 1 : this.time === 'dusk' ? 0.7 : this.time === 'dawn' ? 0.25 : 0) - this.night) * k;

    // Sun (or moon) direction. Below the horizon the light that casts shadows becomes the moon, high up.
    const el = THREE.MathUtils.degToRad(n.elevation);
    const az = THREE.MathUtils.degToRad(n.azimuth);
    this.sunDir.set(Math.cos(el) * Math.cos(az), Math.sin(el), Math.cos(el) * Math.sin(az));
    const u = this.sky.material.uniforms;
    u.sunPosition.value.copy(this.sunDir);
    u.uCityNight.value = this.night;
    // Clouds drift across the sky; rain brings a heavy deck.
    u.time.value += dt;
    u.cloudCoverage.value += ((this.weather === 'rain' ? 0.92 : this.weather === 'mist' ? 0.7 : 0.36) - u.cloudCoverage.value) * k;
    u.cloudDensity.value = 0.45 + this.wet * 0.35;
    u.turbidity.value = n.turbidity + this.wet * 14;
    u.rayleigh.value = n.rayleigh * (1 - this.wet * 0.75);
    const lightDir = n.elevation > 1 ? this.sunDir.clone() : new THREE.Vector3(-0.35, 0.8, 0.45).normalize();
    lightDir.y = Math.max(lightDir.y, 0.16);
    lightDir.normalize();
    this.sun.color.lerp(new THREE.Color(want.sun), k);
    this.sun.intensity = n.sunPower * (1 - this.wet * 0.72);
    this.sun.target.position.copy(focus);
    this.sun.position.copy(focus).addScaledVector(lightDir, 700);
    const cam = this.sun.shadow.camera;
    if (Math.abs(cam.right - reach) > 1) {
      cam.left = cam.bottom = -reach;
      cam.right = cam.top = reach;
      cam.near = 50;
      cam.far = 1500;
      cam.updateProjectionMatrix();
      // The offsets that keep a surface from shadowing itself are a couple of texels, whatever a texel is now.
      const texel = (reach * 2) / this.sun.shadow.mapSize.x;
      this.sun.shadow.normalBias = texel * 2.4;
      this.sun.shadow.bias = -texel * 0.006;
    }

    this.renderer.toneMappingExposure = n.exposure * (1 - this.wet * 0.12);
    this.scene.environmentIntensity = n.ambient * (1 - this.wet * 0.25);
    // By day the sky fill stays low, so that the sun's shadows keep their edge; at night it carries the city's glow.
    this.fill.intensity = .45 + this.night * .17 + this.wet * .3;
    this.fill.color.set('#c4d8e9').lerp(new THREE.Color('#648db4'),this.night);
    this.fill.groundColor.set('#897764').lerp(new THREE.Color('#293342'),this.night);
    this.fog.color.lerp(new THREE.Color(want.fog).lerp(new THREE.Color(this.time === 'night' ? '#20142e' : '#aab3bb'), this.wet * 0.8), k);
    this.fog.density += ((this.weather === 'rain' ? 0.0045 : this.weather === 'mist' ? 0.008 : 0.001) - this.fog.density) * k;

    this.sky.position.copy(camera);
    this.stars.position.copy(camera);
    this.stars.material.opacity = n.stars * (1 - this.wet);

    // Reflections follow the sky: rebaked while it is changing, and once more when it settles.
    this.envClock += dt;
    if ((this.envDirty || moving) && this.envClock > (moving ? 0.5 : 0)) {
      this.envClock = 0;
      this.envDirty = moving;
      const next = this.pmrem.fromScene(this.skyScene, 0, 1, 12000);
      this.scene.environment = next.texture;
      this.env?.dispose();
      this.env = next;
    }

    this.precipitate(dt, camera);
  }

  private precipitate(dt: number, camera: THREE.Vector3) {
    this.rain.material.opacity += ((this.weather === 'rain' ? 0.38 : 0) - this.rain.material.opacity) * Math.min(1, dt * 2);
    this.rain.visible = this.rain.material.opacity > 0.01;
    if (!this.rain.visible) return;
    const out = this.rain.geometry.attributes.position.array as Float32Array;
    const [ox, oy, oz] = [camera.x - BOX / 2, camera.y - BOX / 2, camera.z - BOX / 2];
    const wrap = (v: number) => ((v % BOX) + BOX) % BOX;
    for (let i = 0; i < DROPS; i++) {
      const j = i * 3;
      this.drops[j + 1] -= 42 * dt * (0.8 + (i % 7) * 0.06);
      const x = ox + wrap(this.drops[j] - ox);
      const y = oy + wrap(this.drops[j + 1] - oy);
      const z = oz + wrap(this.drops[j + 2] - oz);
      out.set([x, y, z, x + 0.1, y + 0.9, z], i * 6);
    }
    this.rain.geometry.attributes.position.needsUpdate = true;
  }

  dispose() {
    this.env?.dispose();
    this.pmrem.dispose();
    this.sky.geometry.dispose();
    this.sky.material.dispose();
    for (const o of [this.stars, this.rain]) {
      o.geometry.dispose();
      o.material.dispose();
    }
    this.sun.shadow.map?.dispose();
  }
}

/** Keeps a point inside the map, for anything that wants to look at "the town". */
export const MIDDLE = new THREE.Vector3(SIZE / 2, 0, SIZE / 2);
