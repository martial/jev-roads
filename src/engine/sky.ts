import * as THREE from 'three';
export type TimeOfDay = 'dawn' | 'midday' | 'golden' | 'dusk' | 'night';
export type Weather = 'clear' | 'mist' | 'rain' | 'snow';

interface Light {
  /** Sun (or moon) elevation and compass angle, in degrees. */
  elevation: number;
  azimuth: number;
  sun: string;
  sunPower: number;
  top: string;
  horizon: string;
  hemiSky: string;
  hemiGround: string;
  hemiPower: number;
  stars: number;
  /** Strength of the glow around the sun in the sky. */
  halo: number;
}

const TIME: Record<TimeOfDay, Light> = {
  dawn: { elevation: 11, azimuth: 105, sun: '#ffc39c', sunPower: 2.3, top: '#5f86c8', horizon: '#f7c9b2', hemiSky: '#b7c6ea', hemiGround: '#70605a', hemiPower: 1.7, stars: 0.12, halo: 1.2 },
  midday: { elevation: 58, azimuth: 140, sun: '#fff3df', sunPower: 3.1, top: '#3d83d6', horizon: '#cfe5f4', hemiSky: '#bcd8f5', hemiGround: '#8a8068', hemiPower: 1.9, stars: 0, halo: 0.7 },
  golden: { elevation: 15, azimuth: 250, sun: '#ffb062', sunPower: 3.0, top: '#5479bd', horizon: '#ffd39c', hemiSky: '#c9c2d8', hemiGround: '#7a6350', hemiPower: 1.6, stars: 0, halo: 1.5 },
  dusk: { elevation: 5, azimuth: 265, sun: '#ff8a5c', sunPower: 1.7, top: '#2a2f66', horizon: '#ea8f70', hemiSky: '#8a86c4', hemiGround: '#4a4152', hemiPower: 1.6, stars: 0.5, halo: 1.5 },
  night: { elevation: 52, azimuth: 200, sun: '#a9c0ff', sunPower: 1.25, top: '#070c22', horizon: '#1f2e55', hemiSky: '#5a74bd', hemiGround: '#1c2440', hemiPower: 1.75, stars: 1, halo: 0.4 },
};

interface Air {
  fogNear: number;
  fogFar: number;
  /** How far the sky is pulled towards flat grey, 0..1. */
  grey: number;
  sunScale: number;
  clouds: number;
}

const WEATHER: Record<Weather, Air> = {
  clear: { fogNear: 90, fogFar: 720, grey: 0, sunScale: 1, clouds: 1 },
  mist: { fogNear: 6, fogFar: 90, grey: 0.55, sunScale: 0.62, clouds: 0.6 },
  rain: { fogNear: 25, fogFar: 300, grey: 0.72, sunScale: 0.45, clouds: 1.5 },
  snow: { fogNear: 18, fogFar: 160, grey: 0.6, sunScale: 0.65, clouds: 1.25 },
};

const DOME_VERTEX = /* glsl */ `
  varying vec3 vDir;
  void main() {
    vDir = normalize(position);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }`;

const DOME_FRAGMENT = /* glsl */ `
  uniform vec3 top;
  uniform vec3 horizon;
  uniform vec3 sunColor;
  uniform vec3 sunDir;
  uniform float halo;
  varying vec3 vDir;
  void main() {
    vec3 dir = normalize(vDir);
    float h = max(dir.y, 0.0);
    vec3 c = mix(horizon, top, pow(h, 0.5));
    float s = max(dot(dir, sunDir), 0.0);
    c += sunColor * (pow(s, 6.0) * 0.07 + pow(s, 60.0) * 0.16 + smoothstep(0.9994, 0.9998, s) * 1.6) * halo;
    gl_FragColor = vec4(c, 1.0);
  }`;

const PRECIP = 2000;
const BOX = 56;

/** Sky dome, sun, ambient light, fog, stars, clouds, rain and snow; everything eases between states. */
export class Sky {
  readonly sun = new THREE.DirectionalLight('#ffffff', 3);
  readonly hemi = new THREE.HemisphereLight('#ffffff', '#888888', 1);
  readonly fog = new THREE.Fog('#cfe5f4', 70, 330);
  /** Direction towards the sun, for anything that wants to align with it. */
  readonly sunDir = new THREE.Vector3(0.4, 0.8, 0.3);

  private readonly dome: THREE.Mesh<THREE.SphereGeometry, THREE.ShaderMaterial>;
  private readonly stars: THREE.Points<THREE.BufferGeometry, THREE.PointsMaterial>;
  private readonly clouds: THREE.InstancedMesh<THREE.BoxGeometry, THREE.MeshLambertMaterial>;
  private readonly cloudHomes: Array<{ x: number; y: number; z: number; sx: number; sy: number; sz: number }> = [];
  private readonly rain: THREE.LineSegments<THREE.BufferGeometry, THREE.LineBasicMaterial>;
  private readonly snow: THREE.Points<THREE.BufferGeometry, THREE.PointsMaterial>;
  private readonly drops = new Float32Array(PRECIP * 3);

  private time: TimeOfDay = 'midday';
  private weather: Weather = 'clear';
  private cloudDrift = 0;
  private elevation = 58;
  private azimuth = 140;
  private readonly scratch = new THREE.Color();
  private readonly grey = new THREE.Color();

  constructor(scene: THREE.Scene) {
    scene.fog = this.fog;
    scene.add(this.hemi);

    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    this.sun.shadow.bias = -0.0004;
    this.sun.shadow.normalBias = 0.05;
    scene.add(this.sun, this.sun.target);

    this.dome = new THREE.Mesh(
      new THREE.SphereGeometry(2600, 32, 20),
      new THREE.ShaderMaterial({
        vertexShader: DOME_VERTEX,
        fragmentShader: DOME_FRAGMENT,
        side: THREE.BackSide,
        depthWrite: false,
        fog: false,
        uniforms: {
          top: { value: new THREE.Color(TIME.midday.top) },
          horizon: { value: new THREE.Color(TIME.midday.horizon) },
          sunColor: { value: new THREE.Color(TIME.midday.sun) },
          sunDir: { value: this.sunDir },
          halo: { value: 0.7 },
        },
      }),
    );
    this.dome.renderOrder = -10;
    this.dome.frustumCulled = false;
    scene.add(this.dome);

    const starPositions = new Float32Array(700 * 3);
    for (let i = 0; i < 700; i++) {
      const u = Math.random() * Math.PI * 2;
      const v = Math.acos(Math.random() * 0.95 + 0.03);
      starPositions.set([Math.sin(v) * Math.cos(u) * 2400, Math.cos(v) * 2400, Math.sin(v) * Math.sin(u) * 2400], i * 3);
    }
    const starGeometry = new THREE.BufferGeometry();
    starGeometry.setAttribute('position', new THREE.BufferAttribute(starPositions, 3));
    this.stars = new THREE.Points(
      starGeometry,
      new THREE.PointsMaterial({ color: '#dfe8ff', size: 1.7, sizeAttenuation: false, transparent: true, opacity: 0, fog: false, depthWrite: false }),
    );
    this.stars.renderOrder = -9;
    this.stars.frustumCulled = false;
    scene.add(this.stars);

    // Blocky clouds: a few flattened clumps of boxes that drift and throw moving shadows.
    for (let c = 0; c < 60; c++) {
      const cx = (Math.random() - 0.5) * 1800;
      const cz = (Math.random() - 0.5) * 1800;
      const cy = 110 + Math.random() * 40;
      const parts = 5 + Math.floor(Math.random() * 7);
      for (let p = 0; p < parts; p++)
        this.cloudHomes.push({
          x: cx + (Math.random() - 0.5) * 22,
          y: cy + (Math.random() - 0.5) * 2.5,
          z: cz + (Math.random() - 0.5) * 12,
          sx: 5 + Math.random() * 8,
          sy: 2 + Math.random() * 1.5,
          sz: 4 + Math.random() * 6,
        });
    }
    this.clouds = new THREE.InstancedMesh(
      new THREE.BoxGeometry(1, 1, 1),
      new THREE.MeshLambertMaterial({ color: '#ffffff', emissive: '#8a93a6', emissiveIntensity: 0.35, transparent: true, opacity: 0.94, fog: false }),
      this.cloudHomes.length,
    );
    this.clouds.castShadow = true;
    this.clouds.frustumCulled = false;
    scene.add(this.clouds);

    for (let i = 0; i < PRECIP; i++) this.drops.set([Math.random() * BOX, Math.random() * BOX, Math.random() * BOX], i * 3);
    const rainGeometry = new THREE.BufferGeometry();
    rainGeometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(PRECIP * 6), 3));
    this.rain = new THREE.LineSegments(rainGeometry, new THREE.LineBasicMaterial({ color: '#c4d6e6', transparent: true, opacity: 0, depthWrite: false }));
    const snowGeometry = new THREE.BufferGeometry();
    snowGeometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(PRECIP * 3), 3));
    this.snow = new THREE.Points(snowGeometry, new THREE.PointsMaterial({ color: '#ffffff', size: 0.16, transparent: true, opacity: 0, depthWrite: false }));
    for (const p of [this.rain, this.snow]) {
      p.frustumCulled = false;
      scene.add(p);
    }
  }

  get current(): { time: TimeOfDay; weather: Weather } {
    return { time: this.time, weather: this.weather };
  }

  set(time: TimeOfDay, weather: Weather) {
    this.time = time;
    this.weather = weather;
  }

  /** `focus` is what the shadows should be sharpest around; `reach` is how far they need to cover. */
  update(dt: number, camera: THREE.Vector3, focus: THREE.Vector3, reach: number, aerial: number) {
    const light = TIME[this.time];
    const air = WEATHER[this.weather];
    const k = 1 - Math.exp(-dt * 0.9);
    const u = this.dome.material.uniforms;

    // Bad weather pulls the whole sky towards a flat grey of matching brightness.
    const toward = (target: THREE.Color, hex: string, amount: number) => {
      this.scratch.set(hex);
      const l = this.scratch.r * 0.3 + this.scratch.g * 0.5 + this.scratch.b * 0.2;
      this.grey.setRGB(l * 0.92, l * 0.95, l);
      this.scratch.lerp(this.grey, amount);
      target.lerp(this.scratch, k);
    };
    toward(u.top.value as THREE.Color, light.top, air.grey);
    toward(u.horizon.value as THREE.Color, light.horizon, air.grey * 0.8);
    toward(u.sunColor.value as THREE.Color, light.sun, air.grey * 0.5);
    u.halo.value += (light.halo * air.sunScale - u.halo.value) * k;
    this.fog.color.copy(u.horizon.value as THREE.Color);
    // Seen from the air the whole land sits far from the camera, so the fog starts further out.
    const standoff = camera.distanceTo(focus) * aerial;
    this.fog.near += (air.fogNear + standoff * 0.9 - this.fog.near) * k * 3;
    this.fog.far += (air.fogFar + standoff * 1.6 - this.fog.far) * k * 3;

    toward(this.sun.color, light.sun, air.grey * 0.6);
    this.sun.intensity += (light.sunPower * air.sunScale - this.sun.intensity) * k;
    toward(this.hemi.color, light.hemiSky, air.grey * 0.5);
    toward(this.hemi.groundColor, light.hemiGround, air.grey * 0.3);
    this.hemi.intensity += (light.hemiPower * (1 + air.grey * 0.25) - this.hemi.intensity) * k;

    this.elevation += (light.elevation - this.elevation) * k;
    this.azimuth += (light.azimuth - this.azimuth) * k;
    const el = THREE.MathUtils.degToRad(this.elevation);
    const az = THREE.MathUtils.degToRad(this.azimuth);
    this.sunDir.set(Math.cos(el) * Math.cos(az), Math.sin(el), Math.cos(el) * Math.sin(az));
    // A very low sun would throw shadows for ever; lift the light a little for the shadow pass only.
    const lift = Math.max(this.sunDir.y, 0.22);
    this.sun.target.position.copy(focus);
    this.sun.position.set(focus.x + this.sunDir.x * 260, focus.y + lift * 260, focus.z + this.sunDir.z * 260);
    const cam = this.sun.shadow.camera;
    if (cam.right !== reach) {
      cam.left = cam.bottom = -reach;
      cam.right = cam.top = reach;
      cam.near = 20;
      cam.far = 620;
      cam.updateProjectionMatrix();
    }

    this.dome.position.copy(camera);
    this.stars.position.copy(camera);
    this.stars.material.opacity += (light.stars * (1 - air.grey) - this.stars.material.opacity) * k;

    this.cloudDrift = (this.cloudDrift + dt * 1.6) % 1800;
    const m = new THREE.Matrix4();
    this.cloudHomes.forEach((home, i) => {
      const x = ((home.x + this.cloudDrift + 900) % 1800) - 900 + 512;
      m.makeScale(home.sx * air.clouds, home.sy, home.sz * air.clouds);
      m.setPosition(x, home.y, home.z + 512);
      this.clouds.setMatrixAt(i, m);
    });
    this.clouds.instanceMatrix.needsUpdate = true;
    // From above, clouds thin out so they shade the land without hiding it.
    this.clouds.material.opacity += ((aerial > 0.5 ? 0.1 : 0.94) - this.clouds.material.opacity) * k * 2;
    this.clouds.material.emissiveIntensity += ((this.time === 'night' ? 0.04 : this.time === 'dusk' ? 0.18 : 0.35) - this.clouds.material.emissiveIntensity) * k;

    this.precipitate(dt, camera, k);
  }

  private precipitate(dt: number, camera: THREE.Vector3, k: number) {
    const raining = this.weather === 'rain';
    const snowing = this.weather === 'snow';
    this.rain.material.opacity += ((raining ? 0.42 : 0) - this.rain.material.opacity) * k * 2;
    this.snow.material.opacity += ((snowing ? 0.95 : 0) - this.snow.material.opacity) * k * 2;
    const showRain = this.rain.material.opacity > 0.01;
    const showSnow = this.snow.material.opacity > 0.01;
    this.rain.visible = showRain;
    this.snow.visible = showSnow;
    if (!showRain && !showSnow) return;

    const fall = showRain ? 46 : 3.2;
    const rainPos = this.rain.geometry.attributes.position.array as Float32Array;
    const snowPos = this.snow.geometry.attributes.position.array as Float32Array;
    const ox = camera.x - BOX / 2;
    const oy = camera.y - BOX / 2;
    const oz = camera.z - BOX / 2;
    const wrap = (v: number) => ((v % BOX) + BOX) % BOX;
    const now = performance.now() / 1000;
    for (let i = 0; i < PRECIP; i++) {
      const j = i * 3;
      this.drops[j + 1] -= fall * dt * (0.8 + (i % 7) * 0.06);
      if (showSnow) this.drops[j] += Math.sin(now * 0.8 + i) * dt * 0.7;
      // Keep every drop inside a box that travels with the camera.
      const x = ox + wrap(this.drops[j] - ox);
      const y = oy + wrap(this.drops[j + 1] - oy);
      const z = oz + wrap(this.drops[j + 2] - oz);
      if (showRain) {
        rainPos.set([x, y, z, x + 0.12, y + 1.1, z], i * 6);
      }
      if (showSnow) snowPos.set([x, y, z], j);
    }
    if (showRain) this.rain.geometry.attributes.position.needsUpdate = true;
    if (showSnow) this.snow.geometry.attributes.position.needsUpdate = true;
  }

  dispose() {
    for (const o of [this.dome, this.stars, this.clouds, this.rain, this.snow]) {
      o.geometry.dispose();
      (o.material as THREE.Material).dispose();
    }
    this.sun.shadow.map?.dispose();
  }
}
