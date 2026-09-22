// Ties it together: fetch a place, build it, fill it with drivers, run the clock.

import type { CabinItem } from './sim/cabin';
import { isUK, LONDON } from './edition';
import { addScenery, buildBase } from './city/build';
import { buildNetwork } from './city/network';
import { RoadClearance } from './city/clearance';
import { parseOsm } from './city/osm';
import type { TimeOfDay, Weather } from './engine/sky';
import { Brain, hasTypesafeKey, setTypesafeKey } from './sim/brain';
import { Chatter } from './sim/chatter';
import { Ride, type Kind } from './sim/ride';
import { Traffic, capacity, type Car } from './sim/cars';
import type { Network } from './city/network';
import { STYLE_WORDS } from './sim/drivers';
import { placesOn } from './sim/places';
import { get, set } from './store';
import { View } from './view/scene';
import { RealView } from './view/real/realView';
import type { CityView, Look, Mode } from './view/types';
import { Sound } from './view/sound';
import type { Health } from '../shared/drive';
import type { City } from './city/build';
import type { RawTerrain } from './city/terrain';
import { rememberWorldMode, reloadWorld, type WorldMode, type CameraShot, type MapProvider } from './maps/preferences';

/** The scenery arrives as TILES x TILES parts; must match server/maps.ts. */
const TILES = 3;

export interface Place {
  name: string;
  lat: number;
  lon: number;
}

/** Already on disk, so they open at once and offline. */
export const PLACES: Place[] = isUK() ? [LONDON] : [
  { name: 'Cassis', lat: 43.214, lon: 5.5396 },
  { name: 'Place de l’Étoile, Paris', lat: 48.8738, lon: 2.295 },
  { name: 'La Rotonde, Aix-en-Provence', lat: 43.5263, lon: 5.4454 },
  { name: 'Place Castellane, Marseille', lat: 43.286, lon: 5.3838 },
];

export class Game {
  readonly view: CityView;
  readonly sound = new Sound();
  /** The driver who never stops talking. */
  readonly chatter = new Chatter(this.sound, (caption) => set({ caption }));
  /** The ride as a game: the passenger's actions, and what they do to him. */
  readonly ride = new Ride(this.chatter, (view) => set({ ride: view }));
  private traffic: Traffic | null = null;
  private brain: Brain | null = null;
  /** The town as built, for the taxi's screen. */
  frame: { place: Place; net: Network } | null = null;
  private raf = 0;
  private last = performance.now();
  private uiClock = 0;
  private frames = 0;
  private hailClock = 0;
  private baseTarget = 40;
  private loading = 0;
  private disposed = false;
  /** Has the person chosen a camera themselves? Then the opening glide into the taxi is skipped. */
  private choseView = false;
  /** When to glide into the taxi: -1 waits for the city to finish building, Infinity never. */
  private glideAt = Infinity;
  private middleBuilt = false;
  /** 1 as a rule; near nothing while the passenger chooses what to say, and the world crawls. */
  private timeScale = 1;
  private readonly googleScenery: boolean;

  constructor(canvas: HTMLCanvasElement, labels: HTMLElement, look: Look, private readonly provider: MapProvider = 'osm', googleHolder: HTMLElement | null = null) {
    this.googleScenery = provider === 'google' && get().worldMode !== 'reconstructed';
    this.view = this.googleScenery ? new RealView(canvas, labels, false, googleHolder) : look === 'blocks' ? new View(canvas, labels) : new RealView(canvas, labels, look === 'toon');
    // A tap in the cabin: the radio, your window, the screen; on him or on nothing, he is cut off.
    this.view.onTap = (what) => {
      if (what === 'radio') this.toggleRadio();
      else if (what === 'window') this.toggleWindow();
      else if (what === 'tree' || what === 'dog' || what === 'glovebox' || what === 'visor' || what === 'meter' || what === 'newspaper' || what === 'vents' || what === 'mirror') this.touchCabin(what);
      else if (what === 'gps') set({ gps: !get().gps });
      else this.interrupt();
    };
    this.view.onPick = (car) => {
      this.rideIn(car);
      this.setMode('ride');
    };
    window.addEventListener('resize', this.resize);
    void fetch('/api/health')
      .then((r) => r.json() as Promise<Health>)
      .then((h) => {
        const configured = h.configured || hasTypesafeKey();
        set({ configured, jev: configured && get().jev });
        this.brain?.setEnabled(configured && get().jev);
      })
      .catch(() => set({ configured: false, jev: false }));
    this.raf = requestAnimationFrame(this.tick);
  }

  // --- Places -----------------------------------------------------------------------------------

  async open(place: Place) {
    const ticket = ++this.loading;
    this.middleBuilt = false;
    set({ choosing: false, landing: false, status: 'loading', message: `Fetching the streets of ${place.name}`, place: place.name, progress: 0, mine: null });
    // While the streets are fetched, the town's own taxi driver is found (or invented, the first time).
    void this.chatter.setPlace(place);
    try {
      // The relief is fetched alongside the streets. Without it the town is simply flat, as it always was.
      const relief = fetch(`/api/terrain?lat=${place.lat}&lon=${place.lon}`)
        .then((r) => (r.ok ? (r.json() as Promise<RawTerrain>) : null))
        .catch(() => null);
      const res = await fetch(`/api/map?lat=${place.lat}&lon=${place.lon}`);
      const body = (await res.json()) as { osm?: { elements: never[] }; error?: string };
      if (!res.ok || !body.osm) throw new Error(body.error ?? `HTTP ${res.status}`);
      const terrain = await relief;
      if (ticket !== this.loading || this.disposed) return;
      set({ message: 'Laying the roads' });
      await new Promise((r) => setTimeout(r, 30));
      if (ticket !== this.loading || this.disposed) return;
      const map = parseOsm(body.osm, place.lat, place.lon);
      const net = buildNetwork(map, isUK() ? 'left' : 'right');
      if (net.lanes.length < 4) throw new Error('There are hardly any streets here. Try a town centre.');
      const city = buildBase(map, net, place);
      const traffic = new Traffic(net, Math.round(place.lat * 1000 + place.lon * 10));
      this.baseTarget = capacity(net);
      traffic.target = this.wanted();
      traffic.populate(Math.round(traffic.target * 0.75));
      this.traffic = traffic;
      this.frame = { place, net };
      this.brain = new Brain(
        traffic,
        (v) => set({ verdicts: [v, ...get().verdicts].slice(0, 40) }),
        (stats) => set({ stats: { ...stats } }),
      );
      const places = placesOn(net, city);
      this.brain.places = () => places;
      this.ride.setPlace(place, traffic, places);
      set({ destinations: this.ride.destinations().map((d) => d.label) });
      this.brain.setEnabled(get().jev && get().configured);
      this.brain.raining = get().weather === 'rain';
      this.brain.night = get().time === 'night';
      this.view.setPlace({ map, net, city, traffic, place, terrain });
      this.view.setSky(get().time, get().weather);
      this.rideIn(traffic.addTaxi());
      set({ status: 'ready', message: '', verdicts: [], built: 0 });
      try {
        localStorage.setItem(`jev-roads:place:${isUK() ? 'uk' : 'fr'}`, JSON.stringify(place));
      } catch {
        // Private window: the place simply is not remembered.
      }
      if (this.googleScenery) {
        // Google's streamed landscape replaces the nine OSM scenery requests. OSM supplies traffic topology only.
        set({ built: 1 });
        this.middleBuilt = true;
        this.glideAt = this.choseView ? Infinity : -1;
      } else void this.raise(city, place, ticket, new RoadClearance(map, net));
    } catch (error) {
      if (ticket === this.loading) set({ status: get().cars ? 'ready' : 'error', message: (error as Error).message });
    }
  }

  /** The town rises around the streets part by part, the middle first, while the traffic already runs. */
  private async raise(city: City, place: Place, ticket: number, clearance: RoadClearance) {
    const middle = (TILES - 1) / 2;
    const order = Array.from({ length: TILES * TILES }, (_, i) => i).sort((a, b) => Math.hypot((a % TILES) - middle, Math.floor(a / TILES) - middle) - Math.hypot((b % TILES) - middle, Math.floor(b / TILES) - middle));
    let done = 0;
    // One look at the whole place from above; once the middle of town stands, down into the back seat.
    this.glideAt = this.choseView ? Infinity : -1;
    let waiting = order;
    // Three parts of town are fetched side by side; whatever is refused is asked for again, round after round.
    for (let round = 0; round < 5 && waiting.length; round++) {
      if (round) await new Promise((r) => setTimeout(r, 4000 + round * 3000));
      const missed: number[] = [];
      const queue = [...waiting];
      const worker = async () => {
        for (let tile = queue.shift(); tile !== undefined; tile = queue.shift()) {
          if (ticket !== this.loading) return;
          try {
            const res = await fetch(`/api/scenery?lat=${place.lat}&lon=${place.lon}&tile=${tile}`);
            const body = (await res.json()) as { osm?: { elements: never[] }; error?: string };
            if (!res.ok || !body.osm) throw new Error(body.error ?? `HTTP ${res.status}`);
            if (ticket !== this.loading) return;
            const scenery = parseOsm(body.osm, place.lat, place.lon);
            scenery.buildings = clearance.prepare(scenery.buildings);
            addScenery(city, scenery);
            this.view.addScenery(scenery, city);
            set({ built: ++done / (TILES * TILES), message: '' });
          } catch {
            missed.push(tile);
            if (ticket === this.loading) set({ message: 'OpenStreetMap is busy; the rest of the town will keep arriving as it lets us in.' });
          }
          this.middleBuilt = true;
        }
      };
      await Promise.all([worker(), worker(), worker()]);
      waiting = missed;
    }
    if (waiting.length && ticket === this.loading) set({ message: `OpenStreetMap never sent ${waiting.length === 1 ? 'one part' : `${waiting.length} parts`} of town. Open the place again later for the rest.` });
  }

  async search(query: string) {
    set({ status: 'loading', message: `Looking for ${query}`, progress: 0 });
    try {
      const res = await fetch(`/api/place?q=${encodeURIComponent(query)}`);
      const body = (await res.json()) as Partial<Place> & { error?: string };
      if (!res.ok || body.lat === undefined || body.lon === undefined) throw new Error(body.error ?? 'No such place found');
      const name = (body.name ?? query).split(',').slice(0, 2).join(',');
      await this.open({ name, lat: Math.round(body.lat * 1e4) / 1e4, lon: Math.round(body.lon * 1e4) / 1e4 });
    } catch (error) {
      set({ status: get().cars ? 'ready' : 'error', message: (error as Error).message });
    }
  }

  // --- Controls ---------------------------------------------------------------------------------

  private rideIn(car: Car | null) {
    this.view.ride(car);
    if (this.brain) this.brain.focus = car;
  }

  setMode(mode: Mode, byPerson = true) {
    if (mode === 'above' && get().worldMode === 'street') {
      rememberWorldMode('tiles');
      set({ worldMode: 'tiles' });
    }
    if (byPerson) {
      this.choseView = true;
      this.glideAt = Infinity;
    }
    this.view.mode = mode;
    set({ mode });
    if (this.googleScenery) {
      const cameraShot = mode === 'ride' ? 'ride' : 'orbit';
      this.view.setCameraShot?.(cameraShot);
      set({ cameraShot });
    }
  }

  setCameraShot(cameraShot: CameraShot) {
    this.setMode(cameraShot === 'ride' ? 'ride' : 'above');
    this.view.setCameraShot?.(cameraShot);
    set({ cameraShot });
  }

  setWorldMode(worldMode: WorldMode) {
    rememberWorldMode(worldMode);
    const googleScenery = this.provider === 'google' && worldMode !== 'reconstructed';
    if (googleScenery !== this.googleScenery) {
      reloadWorld(this.frame?.place);
      return;
    }
    set({ worldMode });
    if (worldMode === 'street') this.setCameraShot('ride');
  }

  /** A TypeSafe key for this session only: the drivers start thinking at once. */
  setTypesafeKey(key: string) {
    setTypesafeKey(key);
    const configured = hasTypesafeKey() || get().configured;
    set({ configured, jev: configured, stats: { ...get().stats, noCredit: false, error: '' } });
    this.brain?.setEnabled(configured);
  }

  setJev(on: boolean) {
    set({ jev: on });
    this.brain?.setEnabled(on && get().configured);
  }

  setSky(time: TimeOfDay, weather: Weather) {
    set({ time, weather });
    this.view.setSky(time, weather);
    if (this.brain) {
      this.brain.raining = weather === 'rain';
      this.brain.night = time === 'night';
    }
  }

  /** How many cars the streets should hold right now. */
  private wanted(): number {
    // 0.6 of what the streets could hold keeps them moving; More cars and Rush hour push towards the jam.
    return Math.round(this.baseTarget * 0.6 * get().density * (get().rush ? 1.45 : 1));
  }

  setRush(on: boolean) {
    set({ rush: on });
    if (this.traffic) this.traffic.target = this.wanted();
  }

  /** More cars, fewer cars: from a quiet Sunday to far more than the streets can carry. */
  setDensity(density: number) {
    set({ density: Math.min(2.5, Math.max(0.25, Math.round(density * 4) / 4)) });
    if (this.traffic) this.traffic.target = this.wanted();
  }

  setMuted(muted: boolean) {
    this.sound.muted = muted;
    set({ muted });
  }

  /** The driver talks, or sulks. */
  setTalking(on: boolean) {
    this.chatter.on = on;
    if (!on) this.chatter.stop();
    set({ talk: { ...get().talk, on } });
    try {
      localStorage.setItem('jev-roads:driver', on ? 'on' : 'off');
    } catch {
      // Not remembered, that is all.
    }
  }

  /** A man or a woman at the wheel of the next taxi. */
  setSex(sex: 'm' | 'f') {
    this.chatter.sex = sex;
    this.view.setDriverSex?.(sex);
    set({ talk: { ...get().talk, sex } });
    try {
      localStorage.setItem('jev-roads:driver-sex', sex);
    } catch {
      // Not remembered, that is all.
    }
  }

  setLang(lang: 'en' | 'fr') {
    this.chatter.lang = lang;
    this.chatter.stop();
    set({ talk: { ...get().talk, lang } });
    try {
      localStorage.setItem('jev-roads:lang', lang);
    } catch {
      // Not remembered, that is all.
    }
  }

  breakDown() {
    this.traffic?.breakDown(this.view.riding ?? undefined);
  }

  ambulance() {
    this.traffic?.sendAmbulance();
  }

  // --- The ride as a game -------------------------------------------------------------------------

  /** Where to: the ride begins, in the taxi, from the passenger seat. */
  startRide(label: string) {
    const taxi = this.view.riding;
    const destination = this.ride.destinations().find((d) => d.label === label);
    if (!taxi || !destination || taxi.driver.body.kind !== 'taxi') return;
    this.setMode('ride', false);
    this.ride.begin(taxi, destination);
  }

  touchCabin(item: CabinItem, focus = false) {
    if (!this.view.touchCabin || !this.ride.touchCabin(item)) return;
    this.view.touchCabin(item, focus);
    this.sound.cabin(item);
  }

  interrupt() {
    this.ride.interrupt();
  }

  answer(text: string, kind: Kind, lever = '') {
    this.ride.answer({ text, kind, lever });
  }

  /** Where the taxi is, for the map. */
  taxiAt(): { x: number; z: number; dx: number; dz: number } | null {
    const car = this.view.riding;
    return car ? { x: car.x, z: car.z, dx: car.dx, dz: car.dz } : null;
  }

  /** The passenger clicked the taxi's map: the ride begins towards the nearest street. */
  startRideAt(x: number, z: number): string | null {
    const taxi = this.view.riding;
    const destination = this.ride.destinationAt(x, z);
    if (!taxi || !destination || taxi.driver.body.kind !== 'taxi') return null;
    this.setMode('ride', false);
    this.ride.begin(taxi, destination);
    return destination.label;
  }

  toggleRadio() {
    this.ride.toggleRadio();
  }

  toggleWindow() {
    this.ride.toggleWindow();
  }

  insist() {
    this.ride.insist();
  }

  tip(amount: string) {
    this.ride.tip(amount);
  }

  /** The rider speaks to the driver. */
  tell(words: string) {
    const car = this.view.riding;
    if (car && this.brain) this.brain.tell(car, words);
  }

  // --- The clock ----------------------------------------------------------------------------------

  private readonly resize = () => this.view.resize();

  private readonly tick = (now: number) => {
    if (this.disposed) return;
    this.raf = requestAnimationFrame(this.tick);
    const real = Math.min(0.05, (now - this.last) / 1000);
    this.last = now;
    // Slow motion for the choice: eased in over a third of a second, out over a tenth.
    const wantScale = this.ride.view().offer ? 0.1 : 1;
    this.timeScale += (wantScale - this.timeScale) * (1 - Math.exp(-real * (wantScale < this.timeScale ? 9 : 25)));
    const dt = real * this.timeScale;
    const traffic = this.traffic;
    if (traffic && get().status === 'ready' && (!this.googleScenery || get().googleStatus === 'ready')) {
      traffic.step(dt);
      if (this.brain) {
        const at = this.view.riding ?? null;
        this.brain.viewer = at ? { x: at.x, z: at.z } : this.view.lookingAt;
        this.brain.update(dt);
      }
      // The ride is over (the taxi left the map): hail another.
      if (!this.view.riding || !traffic.cars.includes(this.view.riding)) {
        this.hailClock += dt;
        if (this.hailClock > 1.2) {
          this.hailClock = 0;
          this.rideIn(traffic.addTaxi());
        }
      }
    }
    this.view.frame(dt);
    if (this.glideAt === -1 && this.middleBuilt && this.view.progress >= 1) this.glideAt = now + 1500;
    if (now > this.glideAt) {
      this.glideAt = Infinity;
      if (!this.choseView) this.setMode('ride', false);
    }

    const riding = this.view.riding && traffic?.cars.includes(this.view.riding) ? this.view.riding : null;
    let siren = 0;
    if (traffic) for (const car of traffic.cars) if (car.ambulance) siren = Math.max(siren, Math.min(1, 40 / Math.max(10, Math.hypot(car.x - this.view.ear.x, car.z - this.view.ear.z, this.view.ear.y))));
    this.sound.update(riding && this.view.mode === 'ride' ? riding.v : null, siren, this.timeScale);
    const radio = this.ride.view().radio;
    this.sound.radio(radio.on && radio.stream && this.view.mode === 'ride' ? radio.stream : null);

    // He talks while you sit beside him, with the page in front of you.
    const ui = get();
    const listening = Boolean(riding) && this.view.mode === 'ride' && ui.status === 'ready' && !ui.choosing && !ui.landing && !document.hidden && (!this.googleScenery || ui.googleStatus === 'ready');
    this.chatter.update(real, now, riding, traffic, (car) => this.brain!.situation(car), { place: ui.place, raining: ui.weather === 'rain', night: ui.time === 'night', rush: ui.rush, cars: ui.cars, muted: ui.muted }, listening && Boolean(this.brain), dt);
    if (!listening && this.chatter.talk.speaking) this.chatter.stop();
    this.ride.update(real, now, ui.weather === 'rain', listening);
    const phone = this.ride.phone;
    this.sound.phone(listening && phone.phase === 'ringing', listening && phone.phase !== 'idle');
    this.view.setDriver?.(this.chatter.talk, this.chatter.gags);
    this.view.setRide?.(this.ride.view());
    this.sound.face(this.view.facingDriver ?? 0);

    this.frames++;
    this.uiClock += real;
    if (this.uiClock > 0.2) {
      const situation = riding && this.brain ? this.brain.situation(riding) : null;
      set({
        fps: Math.round(this.frames / this.uiClock),
        cars: traffic?.cars.length ?? 0,
        progress: this.view.progress,
        mine: riding && situation
          ? {
              id: riding.id, vehicle: riding.driver.card.vehicle, temperament: riding.driver.card.temperament, trip: riding.driver.card.trip, color: riding.driver.color,
              style: STYLE_WORDS[riding.style], confidence: riding.styleP, speed: situation.speed_kmh, limit: situation.speed_limit_kmh, road: situation.road,
              comingUp: situation.coming_up, hold: riding.hold, says: riding.says, goal: riding.restUntil > traffic!.time ? 'Here we are' : riding.follow ? `Following the ${riding.followLabel}` : riding.goal ? `Heading for ${riding.goal.label}` : '', taxi: riding.driver.body.kind === 'taxi',
              fuel: this.chatter.gags.fuel, fare: this.chatter.gags.fare, perKm: this.chatter.gags.perKm, banner: this.chatter.gags.banner,
            }
          : null,
      });
      set({ ride: this.ride.view(), hover: this.view.hovering ?? '' });
      const c = this.chatter;
      const talk = { ready: c.ready, on: c.on, lang: c.lang, who: c.who, from: c.persona.from, sex: c.sex, error: c.error, last: c.last ? `${c.last.model} ${c.last.wordsMs} ms, ${c.last.engine} ${c.last.voiceMs} ms` : '' };
      if (JSON.stringify(talk) !== JSON.stringify(get().talk)) set({ talk });
      if (riding && situation) this.view.setDash?.({ speed: situation.speed_kmh, limit: situation.speed_limit_kmh, decision: STYLE_WORDS[riding.style], detail: riding.hold === 'gap' ? 'waiting for a gap' : riding.hold === 'box' ? 'keeping the junction clear' : situation.coming_up, goal: riding.restUntil > traffic!.time ? 'Here we are' : riding.follow ? `Following the ${riding.followLabel}` : riding.goal ? `Heading for ${riding.goal.label}` : '' });
      this.frames = 0;
      this.uiClock = 0;
    }
  };

  dispose() {
    this.disposed = true;
    this.loading++;
    this.chatter.stop();
    cancelAnimationFrame(this.raf);
    window.removeEventListener('resize', this.resize);
    this.view.dispose();
  }
}
