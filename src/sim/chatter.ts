// The driver never stops talking. This watches the ride for things worth a remark, keeps the car's running
// jokes (a tank on the reserve, a meter with ideas of its own), asks the server for his next line while the
// present one is still being said, and lets him interrupt himself when something sudden happens.

import { GERARD, type DriverHealth, type DriverLine, type DriverQuery, type Gesture, type Lang, type Mood, type Persona, type RideFacts, type Sex, type VoiceQuery, type VoiceReply } from '../../shared/driver';
import type { Situation } from '../../shared/drive';
import type { Car, Traffic } from './cars';
import { STYLE_WORDS } from './drivers';

/** What the rest of the game hears from him. */
export interface Talk {
  /** 0..1, how wide his mouth is open right now. */
  level: number;
  speaking: boolean;
  mood: Mood;
  gesture: Gesture;
  /** Seconds since this line began: gestures are played out against it. */
  since: number;
  /** How far through the line he is, 0..1: the words appear as he says them. */
  progress: number;
  /** A story rather than a remark: cutting it off costs more. */
  story: boolean;
}

export interface Caption {
  id: number;
  text: string;
  mood: Mood;
  /** The driver, or the passenger he picked up. */
  speaker: 'driver' | 'other';
}

/** The car's own comedy: petrol, and the meter. Euros and litres are said the French way on the dash. */
export interface Gags {
  /** Share of a tank, 0..1. It starts on the reserve and it stays a worry. */
  fuel: number;
  /** null when this is not a taxi. */
  fare: number | null;
  perKm: number;
  /** A line across the meter for a few seconds: "SUPPLÉMENT MISTRAL +2,50 €". */
  banner: string;
}

export interface Voice {
  /** Plays MP3 data; resolves with its length in seconds once it has started, 0 if there is no sound to be had. */
  play(data: ArrayBuffer, onEnd: () => void): Promise<number>;
  hush(): void;
  readonly level: number;
}

export interface World {
  place: string;
  raining: boolean;
  night: boolean;
  rush: boolean;
  cars: number;
  muted: boolean;
}

/** Where his mind drifts when the road gives him nothing: grievances, politics, and the rest of life. */
const TOPICS = [
  // Politics: all of them, equally.
  'politicians, all the same, left right and centre', 'the fuel duty, and where that money goes', 'the pension age, and your back', 'the ministers who have never driven a taxi in their life', 'Brussels and its rules about everything', 'the strikes, which you are against except when it is the taxis',
  'the thirty zones and the low-emission zones', 'the mayor and his flowerpots in the middle of the road', 'taxes, and the forms to fill in to pay them', 'why you have voted blank since 1995', 'what you would do if you were President, for one week', 'the election posters that are still up',
  // The rest of life.
  'the lottery numbers you have played for twenty years', 'a famous singer you once drove and may not name', 'your theory about the pigeons',
  'your military service in 1987', 'the best pizza truck on the coast, which you will not reveal', 'what you would do if you won the lottery', 'a film you saw and did not understand', 'the horoscope in the paper this morning', 'your neighbour and his hedge',
  'where the passenger comes from, and what you think of it', 'what the passenger does for a living', 'the wedding of your niece next month', 'the full moon and how people drive under it', 'the sea, which you have not swum in for ten years', 'the doctor who told you to stop the saucisson',
  // Grievances.
  'electric scooters', 'the roadworks that never end', 'Parisians who buy everything here', 'your brother-in-law Didier', 'the price of petrol', 'ride-hailing apps', 'cyclists', 'roundabouts, and who invented them',
  'speed cameras', 'your ex-wife Josiane', 'your back, and this seat', 'the football last weekend', 'the GPS that thinks it knows your streets', 'young people and their phones', 'the weather, which was better before', 'tourists who stop in the middle of the road',
  'the town hall', 'how this coast was thirty years ago', 'the price of a coffee now', 'people who do not indicate', 'SUVs in streets made for carts', 'parking, the impossibility of it', 'the air conditioning, broken since 2009',
  'your cousin who drives a bus', 'the local dish that tourists are sold, and what it should be', 'the new one-way system', 'delivery vans stopped anywhere', 'what you are missing on television for this ride',
];

const SUPPLEMENTS: Array<{ label: string; euros: number; when?: (w: World, car: Car) => boolean }> = [
  { label: 'SUPPLÉMENT MISTRAL', euros: 2.5 },
  { label: 'SUPPLÉMENT CONVERSATION', euros: 3 },
  { label: 'SUPPLÉMENT ROND-POINT', euros: 1.2 },
  { label: 'SUPPLÉMENT VUE MER', euros: 4 },
  { label: 'SUPPLÉMENT PASSAGER DEVANT', euros: 2 },
  { label: 'SUPPLÉMENT BAGAGE INVISIBLE', euros: 1.9 },
  { label: 'SUPPLÉMENT FEU ROUGE', euros: 1.5, when: (_w, car) => car.light === 'red' },
  { label: 'SUPPLÉMENT ESSUIE-GLACES', euros: 1.8, when: (w) => w.raining },
  { label: 'SUPPLÉMENT NUIT ÉTOILÉE', euros: 3.2, when: (w) => w.night },
  { label: 'SUPPLÉMENT HEURE DE POINTE', euros: 3.6, when: (w) => w.rush },
  { label: 'SUPPLÉMENT BOUCHON', euros: 2.2, when: (_w, car) => car.stopped > 12 },
];

const REASONS = ['the mistral', 'demand', 'the sea view', 'it is that time of day', 'the algorithm', 'a decision from the prefecture', 'the price of petrol', 'no reason given'];

const euros = (n: number) => `${n.toFixed(2).replace('.', ',')} €`;

const COLOURS: Array<[string, number, number, number]> = [['white', 240, 240, 236], ['black', 28, 30, 34], ['grey', 140, 145, 151], ['red', 200, 60, 50], ['blue', 60, 110, 180], ['yellow', 225, 180, 60], ['green', 130, 170, 130], ['orange', 217, 142, 58], ['pink', 233, 165, 184], ['purple', 138, 111, 176], ['beige', 217, 201, 160]];
const NAMED = /white|black|grey|gray|red|blue|yellow|green|orange|pink|purple|beige/;

/** "red small hatchback": what he would call the one in front. */
export function describe(car: Car): string {
  // No makes: he says "bagnole", not the name of a model.
  const vehicle = car.driver.card.vehicle.replace(/Renault 4/i, 'little car');
  if (NAMED.test(vehicle)) return vehicle;
  const hex = car.driver.color.replace('#', '');
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16));
  let best = COLOURS[0];
  let bestD = Infinity;
  for (const c of COLOURS) {
    const d = (c[1] - r) ** 2 + (c[2] - g) ** 2 + (c[3] - b) ** 2;
    if (d < bestD) [best, bestD] = [c, d];
  }
  return `${best[0]} ${vehicle}`;
}

export class Chatter {
  /** The person wants to hear him. */
  on = true;
  lang: Lang = 'en';
  /** A man or a woman at the wheel, chosen on the title page. */
  sex: Sex = 'm';
  health: DriverHealth | null = null;
  /** The taxi driver of the town being driven in. Gérard until the town's own has been found. */
  persona: Persona = GERARD;
  /** Still being invented: nobody speaks until he exists, or his first words would be someone else's. */
  private casting = false;
  readonly talk: Talk = { level: 0, speaking: false, mood: 'grumble', gesture: 'none', since: 0, progress: 0, story: false };
  /** The ride, when there is one: its facts go with every question, and its replies come back with every line. */
  ride: (() => { facts: RideFacts; offer: boolean }) | null = null;
  /** A ride is on: the meter's rate is the ride's business, not the meter's whims. */
  rideOn = false;
  /** The ride is over and he has said his piece: nothing more until the passenger has paid. */
  hold = false;
  /** The three lines are up and the world has slowed: he waits, and says nothing, until the passenger has chosen. */
  waiting = false;
  onLine: ((line: DriverLine) => void) | null = null;
  /** What the passenger chose to say, if anything, for the next line. */
  private chosen = '';
  private lineSeconds = 0;
  private lineStart = 0;
  readonly gags: Gags = { fuel: 0.12, fare: null, perKm: 8.9, banner: '' };
  /** For the activity panel: what the last line cost in time. */
  last: { wordsMs: number; voiceMs: number; engine: string; model: string } | null = null;
  error = '';

  private car: Car | null = null;
  private readonly said: string[] = [];
  private events: string[] = [];
  private heard = '';
  private answered = '';
  /**
   * Lines on their way to his mouth, in the order they were written. Words are written one line after another, so
   * that each knows the last; the voice, the slow half, is recorded for several at once. A line is said once it is
   * `ready` and everything before it has been said.
   */
  private readonly queue: Array<DriverLine & { ready: boolean }> = [];
  /** A line's words are being written right now. */
  private asking = 0;
  private readonly requests = new Set<AbortController>();
  /** Bumped whenever what is being written is no longer wanted. */
  private wanted = 0;
  private quietUntil = 0;
  private askAfter = 0;
  private failures = 0;
  private lines = 0;
  private asked = 0;
  private captionId = 0;
  private topics: string[] = [];
  private rideStart = 0;
  private watchClock = 0;
  private fakeTalk = 0;
  /** His exclamations, recorded: what he shouts before he has had time to think. */
  private interjections: Array<{ text: string; mood: Mood; for: 'shock' | 'outrage' | 'weary'; audio: ArrayBuffer }> = [];
  // What the car was doing a moment ago, to notice changes.
  private was = { honked: false, horn: false, tailgated: false, ambulance: false, light: null as string | null, stoppedMark: 0, leader: -1, street: '', broken: false, gapMark: 0, courtesy: false, style: '', rest: false, greenSince: 0, raining: false, night: false, rush: false };
  private lastOf: Record<string, number> = {};
  private bannerUntil = 0;
  private supplementAt = 0;
  private repriceAt = 0;
  private fuelMark = 1;

  constructor(
    private readonly voice: Voice,
    private readonly onCaption: (caption: Caption | null) => void,
  ) {
    void fetch('/api/driver/health')
      .then((r) => r.json() as Promise<DriverHealth>)
      .then((h) => {
        this.health = h;
        void this.recordAll();
      })
      .catch(() => (this.health = { configured: false, project: '', model: '', voice: 'off' }));
  }

  /** A new town: its own driver takes the wheel, invented on the spot from what Gemini knows of the place. */
  async setPlace(place: { name: string; lat: number; lon: number }) {
    this.casting = true;
    this.stop();
    const ticket = ++this.cast;
    const found = await fetch(`/api/driver/cast?lat=${place.lat}&lon=${place.lon}&name=${encodeURIComponent(place.name)}&sex=${this.sex}`)
      .then((r) => (r.ok ? (r.json() as Promise<Persona>) : null))
      .catch(() => null);
    if (ticket !== this.cast) return;
    this.persona = found ?? GERARD;
    this.casting = false;
    this.car = null; // whoever was talking is no longer the driver: the ride begins again
    void this.recordAll();
  }

  private cast = 0;

  /** One after the other: the first visit records them (a dozen acted takes at once would be refused), later ones read the disk. */
  private async recordAll() {
    if (!this.health?.configured || this.health.voice === 'off') return;
    const ticket = this.cast;
    const p = this.persona;
    this.interjections = [];
    const moods: Record<'shock' | 'outrage' | 'weary', Mood> = { shock: 'shout', outrage: 'shout', weary: 'sigh' };
    for (const kind of ['shock', 'outrage', 'weary'] as const)
      for (const text of p.interjections[kind]) {
        const query: VoiceQuery = { text, mood: moods[kind], lang: 'fr', accent: p.accent, locale: p.locale, name: p.name, keep: true, sex: p.sex };
        const reply = await fetch('/api/driver/voice', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(query) })
          .then((r) => (r.ok ? (r.json() as Promise<VoiceReply>) : null))
          .catch(() => null);
        if (ticket !== this.cast) return;
        if (reply?.audio) this.interjections.push({ text, mood: moods[kind], for: kind, audio: Uint8Array.from(atob(reply.audio), (c) => c.charCodeAt(0)).buffer });
      }
  }

  get ready() {
    return Boolean(this.health?.configured) && !this.casting;
  }

  /** The name under the subtitles: the town's driver in his taxi, nobody in particular otherwise. */
  get who(): string {
    return !this.car || this.car.driver.body.kind === 'taxi' ? this.persona.name : 'The driver';
  }

  /** Called every frame. `active`: someone is sitting in a car, looking out of it, with the page in front of them. */
  /** `dt` is real time (his voice, his gestures); `simDt` the world's, which crawls while the passenger chooses (the meter counts that one). */
  update(dt: number, now: number, car: Car | null, traffic: Traffic | null, situation: (car: Car) => Situation, world: World, active: boolean, simDt = dt) {
    const t = this.talk;
    t.since += dt;
    t.progress = t.speaking ? (this.lineSeconds > 0 ? Math.min(1, (now - this.lineStart) / (this.lineSeconds * 1000)) : this.fakeTalk > 0 ? Math.min(1, t.since / (t.since + this.fakeTalk)) : 0) : 0;
    // The mouth: the sound's own loudness, or a made-up flutter when there are only subtitles.
    const loud = t.speaking ? (this.fakeTalk > 0 ? 0.35 + 0.35 * Math.abs(Math.sin(now * 0.013) * Math.sin(now * 0.0071)) : Math.min(1, this.voice.level * 3.2)) : 0;
    t.level += (loud - t.level) * Math.min(1, dt * 22);
    if (this.fakeTalk > 0 && (this.fakeTalk -= dt) <= 0) this.finished();
    if (this.gags.banner && now > this.bannerUntil) this.gags.banner = '';

    if (!car || !traffic) return;
    if (car !== this.car) this.board(car, now);
    this.gagsAlong(simDt, now, car, traffic, world);
    this.watchClock += dt;
    if (this.watchClock > 0.25) {
      this.watchClock = 0;
      this.watch(car, traffic, situation(car), world, now);
    }
    if (!this.on || !this.ready) return;
    if (this.waiting) return;
    if (active && !t.speaking && now >= this.quietUntil && this.queue[0]?.ready) return this.say(this.queue.shift()!);
    // The next line is written while this one is said, late enough to be about now, early enough to be ready.
    // A ride begins two lines ahead, and its greeting is written the moment someone boards, listened to or not.
    const ahead = active ? 2 : 1;
    const may = (active || this.lines === 0) && !this.hold;
    if (may && !this.asking && this.queue.length < ahead && now >= this.askAfter) this.ask(car, situation(car), world, now, this.events.length || this.lines + this.queue.length === 0 ? 'short' : 'normal');
  }

  /** Someone new at the wheel, or the same driver with a new fare. */
  private board(car: Car, now: number) {
    this.car = car;
    this.said.length = 0;
    this.events = [car.driver.body.kind === 'taxi' ? 'a passenger just got in beside you, in the front seat: say hello in your way and ask them where they are going (one line)' : 'someone just got in beside you'];
    this.drop();
    this.lines = 0;
    this.voice.hush();
    this.finished(false);
    this.rideStart = now;
    this.heard = car.says;
    this.answered = car.says;
    this.lastOf = {};
    Object.assign(this.was, { honked: false, horn: false, tailgated: false, ambulance: false, light: null, stoppedMark: 0, leader: -1, street: '', broken: false, gapMark: 0, courtesy: false, style: car.style, rest: false, greenSince: 0 });
    const taxi = car.driver.body.kind === 'taxi';
    Object.assign(this.gags, { fuel: 0.1 + Math.random() * 0.05, fare: taxi ? 4.1 : null, perKm: 7.8 + Math.random() * 2, banner: '' });
    this.fuelMark = 1;
    this.supplementAt = now + 25000 + Math.random() * 20000;
    this.repriceAt = now + 18000 + Math.random() * 12000;
    this.quietUntil = now + 1800;
  }

  // --- The running jokes ------------------------------------------------------------------------------

  private gagsAlong(dt: number, now: number, car: Car, traffic: Traffic, world: World) {
    const g = this.gags;
    const metres = car.v * dt;
    // A tank that was never full: a percent every 250 m, a little more when he hurries.
    g.fuel = Math.max(0, g.fuel - (metres / 25000) * (car.style === 'hurry' || car.style === 'tailgate' ? 1.5 : 1) - dt * 0.00004);
    for (const mark of [0.1, 0.05, 0.02])
      if (g.fuel <= mark && this.fuelMark > mark) {
        this.fuelMark = mark;
        this.note(`the low-fuel light ${mark === 0.1 ? 'came on' : 'is blinking'}: ${Math.round(g.fuel * 100)} percent left in the tank`, mark === 0.02 ? 'outrage' : undefined);
      }
    if (g.fuel <= 0 && car.brokenUntil <= traffic.time && car.v > 1) {
      car.brokenUntil = traffic.time + 22;
      traffic.say(car, 'out of petrol', 6);
      // The jerrycan in the boot: enough for the joke to come round again.
      g.fuel = 0.085;
      this.fuelMark = 0.1;
      this.note('the engine just died in the middle of the road: you ran out of petrol. You have a jerrycan in the boot, as always', 'shock');
    }
    if (g.fare === null) return;
    g.fare += (metres / 1000) * g.perKm + (car.v < 0.8 ? dt * 0.02 : 0);
    if (now > this.repriceAt && !this.rideOn) {
      this.repriceAt = now + 22000 + Math.random() * 26000;
      const before = g.perKm;
      g.perKm = Math.min(19.9, Math.max(6.9, g.perKm * (0.92 + Math.random() * 0.34) * (world.rush ? 1.12 : 1)));
      if (g.perKm - before > 0.8) {
        const why = REASONS[Math.floor(Math.random() * REASONS.length)];
        this.flash(`PRIX AU KM ▲ ${euros(g.perKm)}`, now, 6000);
        this.note(`the meter just raised the price per kilometre from ${euros(before)} to ${euros(g.perKm)} (the screen says: ${why}). It is the official tariff, you do not make the rules`);
      }
    }
    if (now > this.supplementAt) {
      this.supplementAt = now + 40000 + Math.random() * 50000;
      const fitting = SUPPLEMENTS.filter((s) => s.when?.(world, car));
      const pool = fitting.length && Math.random() < 0.6 ? fitting : SUPPLEMENTS.filter((s) => !s.when);
      const s = pool[Math.floor(Math.random() * pool.length)];
      g.fare += s.euros;
      this.flash(`${s.label} +${euros(s.euros)}`, now, 7000);
      this.note(`the meter just added a "${s.label.toLowerCase()}" of ${euros(s.euros)} to the fare. Perfectly normal, you say`);
    }
  }

  private flash(text: string, now: number, ms: number) {
    this.gags.banner = text;
    this.bannerUntil = now + ms;
  }

  // --- Noticing things ----------------------------------------------------------------------------------

  /** Something for his next line. Sudden things make him cut himself off. */
  private note(event: string, sudden?: 'shock' | 'outrage' | 'weary') {
    this.events.push(event);
    if (this.events.length > 6) this.events.shift();
    if (sudden) this.interrupt(sudden);
  }

  private often(key: string, now: number, seconds: number): boolean {
    if (now - (this.lastOf[key] ?? -1e9) < seconds * 1000) return false;
    this.lastOf[key] = now;
    return true;
  }

  private watch(car: Car, traffic: Traffic, s: Situation, world: World, now: number) {
    const w = this.was;
    const time = traffic.time;
    const ahead = car.leader && car.gap !== null && car.gap < 40 ? describe(car.leader) : '';

    if (car.a < -3.2 && car.v > 2.5 && this.often('brake', now, 7)) this.note(`you had to brake hard${ahead ? ` behind the ${ahead}` : ''}`, 'shock');
    const honked = car.honkedUntil > time;
    if (honked && !w.honked) this.note('someone behind just honked at you', 'outrage');
    w.honked = honked;
    const horn = car.hornUntil > time;
    if (horn && !w.horn && this.often('horn', now, 10)) this.note(`you just leaned on the horn${ahead ? ` at the ${ahead}` : ''}`);
    w.horn = horn;
    const tailgated = car.tailgatedUntil > time;
    if (tailgated && !w.tailgated && this.often('tailgated', now, 25)) this.note('someone is glued to your rear bumper');
    w.tailgated = tailgated;
    if (car.ambulanceBehind && !w.ambulance) this.note('an ambulance with its siren on came up right behind you', 'shock');
    w.ambulance = car.ambulanceBehind;

    const light = car.toLine < 70 ? car.light : null;
    if (light !== w.light) {
      if (light === 'red' && w.light !== null && this.often('red', now, 20)) this.note('the light ahead turned red just as you got to it');
      if (light === 'green' && w.light === 'red') w.greenSince = now;
      w.light = light;
    }
    if (light === 'green' && w.greenSince && now - w.greenSince > 2600 && car.v < 0.6 && ahead && car.leadV < 0.5) {
      w.greenSince = 0;
      this.note(`the light is green and the ${ahead} in front of you is still not moving`, 'outrage');
    }
    if (light !== 'green') w.greenSince = light === 'red' ? w.greenSince : 0;

    for (const mark of [15, 40, 90])
      if (car.stopped >= mark && w.stoppedMark < mark) {
        w.stoppedMark = mark;
        this.note(`you have not moved for ${mark} seconds`);
      }
    if (car.stopped < 1) w.stoppedMark = 0;
    if (car.hold === 'gap' && car.waiting > 9 && w.gapMark < 1) {
      w.gapMark = 1;
      this.note(`you have waited ${Math.round(car.waiting)} seconds to get into this junction and nobody lets you in`);
    }
    if (car.hold !== 'gap') w.gapMark = 0;

    const leader = car.leader && car.gap !== null && car.gap < 25 ? car.leader.id : -1;
    if (leader !== w.leader && leader !== -1 && this.often('leader', now, 22)) this.note(`you are now stuck behind a ${ahead}, doing ${Math.round(car.leadV * 3.6)} km/h`);
    w.leader = leader;
    if (s.road !== w.street) {
      if (w.street && !/ road$/.test(s.road) && this.often('street', now, 30)) this.note(`you just turned onto ${s.road}`);
      w.street = s.road;
    }
    const broken = s.coming_up.startsWith('broken-down');
    if (broken && !w.broken) this.note(`a ${ahead || 'vehicle'} has broken down in your lane, right in front of you`, 'outrage');
    w.broken = broken;
    const courtesy = car.courtesyUntil > time;
    if (courtesy && !w.courtesy && this.often('courtesy', now, 30)) this.note('you just let someone in, out of pure kindness, and got no thank-you');
    w.courtesy = courtesy;
    if (car.style !== w.style) {
      if (w.style && this.often('style', now, 25)) this.note(`you have started ${STYLE_WORDS[car.style]}`);
      w.style = car.style;
    }
    const rest = car.restUntil > time;
    if (rest && !w.rest) this.note(`you have arrived: ${car.goal?.label ?? 'here we are'}. Announce the fare on the meter${this.gags.fare === null ? '' : `, ${euros(this.gags.fare)},`} as if it were perfectly reasonable`, 'outrage');
    w.rest = rest;

    if (world.raining !== w.raining && this.often('rain', now, 5)) this.note(world.raining ? 'it has started to rain' : 'the rain has stopped');
    if (world.night !== w.night && this.often('night', now, 5)) this.note(world.night ? 'night has fallen' : 'the sun is back');
    if (world.rush !== w.rush && this.often('rush', now, 5)) this.note(world.rush ? 'rush hour has begun: cars everywhere' : 'rush hour is over');
    Object.assign(w, { raining: world.raining, night: world.night, rush: world.rush });

    // The passenger spoke: that comes before everything.
    if (car.says !== this.heard) {
      this.heard = car.says;
      if (car.says) this.interrupt();
    }
  }

  /** What is being written is about a moment that has passed. Cut in with an exclamation if there is reason to. */
  private interrupt(sudden?: 'shock' | 'outrage' | 'weary') {
    // A sigh does not cut him off: it comes between lines.
    if (sudden !== 'weary') this.drop();
    if (!sudden || !this.on) return;
    const fitting = this.interjections.filter((x) => x.for === sudden);
    if (!fitting.length) return;
    const pick = fitting[Math.floor(Math.random() * fitting.length)];
    if (sudden !== 'weary') {
      this.voice.hush();
      this.finished(false);
    }
    this.queue.push({ text: pick.text, mood: pick.mood, gesture: sudden === 'shock' ? 'both_hands' : sudden === 'weary' ? 'none' : 'hand', audio: null, model: '', engine: 'recorded', wordsMs: 0, voiceMs: 0, ready: true });
    this.recorded = pick.audio;
    this.quietUntil = 0;
    this.askAfter = 0;
  }

  private recorded: ArrayBuffer | null = null;

  /** Forget what is written and what is being written. */
  private drop() {
    this.queue.length = 0;
    this.wanted++;
    this.asking = 0;
    for (const r of this.requests) r.abort();
    this.requests.clear();
  }

  // --- Asking and saying ----------------------------------------------------------------------------------

  private ask(car: Car, s: Situation, world: World, now: number, length: 'short' | 'normal') {
    const ticket = this.wanted;
    const taxi = car.driver.body.kind === 'taxi';
    this.asking++;
    const events = this.events;
    this.events = [];
    const says = this.chosen || (car.says !== this.answered ? car.says : '');
    // A subject lasts him three or four lines.
    // His town's own subjects come round twice as often as everybody's.
    const shuffled = () => [...TOPICS, ...this.persona.topics, ...this.persona.topics, ...this.persona.grievances].sort(() => Math.random() - 0.5);
    if (!this.topics.length) this.topics = shuffled();
    if (++this.asked % 4 === 0) this.topics.pop();
    if (!this.topics.length) this.topics = shuffled();
    const query: DriverQuery = {
      lang: this.lang,
      persona: this.persona,
      driver: { vehicle: car.driver.card.vehicle, temperament: car.driver.card.temperament, trip: car.driver.card.trip, taxi: car.driver.body.kind === 'taxi' },
      place: world.place,
      now: {
        speed_kmh: s.speed_kmh,
        speed_limit_kmh: s.speed_limit_kmh,
        street: s.road,
        coming_up: s.coming_up,
        vehicle_ahead: car.leader && s.metres_to_vehicle_ahead !== null ? { what: describe(car.leader), metres: s.metres_to_vehicle_ahead, speed_kmh: s.vehicle_ahead_speed_kmh ?? 0 } : null,
        seconds_stopped: s.seconds_stopped,
        being_tailgated: s.being_tailgated,
        being_honked_at: s.being_honked_at,
        ambulance_behind_with_siren: s.ambulance_behind_with_siren,
        my_driving: STYLE_WORDS[car.style],
        heading_for: car.follow ? `following the ${car.followLabel}` : (car.goal?.label ?? 'nowhere in particular, the passenger has not said'),
        raining: world.raining,
        night: world.night,
        rush_hour: world.rush,
        cars_in_town: world.cars,
      },
      car: { fuel_percent_left: Math.round(this.gags.fuel * 100), low_fuel_light_on: this.gags.fuel <= 0.1, meter_price_per_km_euros: this.gags.fare === null ? null : Math.round(this.gags.perKm * 100) / 100 },
      events,
      passenger_says: says,
      said: [...this.said.slice(-8), ...this.queue.filter((l) => l.engine !== 'recorded').map((l) => l.text)],
      topic: this.topics[this.topics.length - 1] ?? TOPICS[0],
      minutes_in_the_car: Math.round((now - this.rideStart) / 6000) / 10,
      fare: this.gags.fare,
      length,
      // Only the words: the voice is asked for next, while the following line is already being written.
      voice: false,
      ride: this.ride?.().facts,
      offer: Boolean(this.ride?.().offer),
    };
    const answering = this.chosen;
    this.chosen = '';
    const request = new AbortController();
    this.requests.add(request);
    let busy = false;
    void fetch('/api/driver/line', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(query), signal: request.signal })
      .then(async (res) => {
        const body = (await res.json()) as DriverLine & { error?: string };
        busy = res.status === 429;
        if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
        return body;
      })
      .then((line) => {
        this.failures = 0;
        this.error = '';
        if (ticket !== this.wanted) {
          // Written for a moment that has passed; what it was about is not lost.
          this.events.unshift(...events);
          return;
        }
        if (says && !answering) this.answered = says;
        this.asking--;
        const queued = { ...line, ready: world.muted };
        this.queue.push(queued);
        if (world.muted) {
          this.last = { wordsMs: line.wordsMs, voiceMs: 0, engine: 'subtitles only', model: line.model };
          return void this.requests.delete(request);
        }
        const started = performance.now();
        void fetch('/api/driver/voice', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text: line.text, mood: line.mood, lang: query.lang, accent: taxi ? this.persona.accent : '', locale: this.persona.locale, name: taxi ? this.persona.name : 'a driver', speaker: line.speaker ?? 'driver', sex: taxi ? this.persona.sex : 'm' } satisfies VoiceQuery), signal: request.signal })
          .then((res) => (res.ok ? (res.json() as Promise<VoiceReply>) : null))
          .catch(() => null)
          .then((voiced) => {
            // No voice after all: he is read instead of heard, which is still better than silence.
            Object.assign(queued, { audio: voiced?.audio ?? null, engine: voiced?.engine ?? 'none', voiceMs: Math.round(performance.now() - started), ready: true });
            this.last = { wordsMs: line.wordsMs, voiceMs: queued.voiceMs, engine: queued.engine, model: line.model };
            this.requests.delete(request);
          });
      })
      .catch((error: Error) => {
        this.events.unshift(...events);
        if (ticket !== this.wanted) return;
        this.asking--;
        // The server was still finishing a line nobody wants any more: ask again in a moment, no harm done.
        if (busy) return void (this.askAfter = performance.now() + 1200);
        this.error = error.message;
        // He sulks longer each time; a missing login is not retried every second.
        this.askAfter = performance.now() + Math.min(60000, 3000 * 2 ** this.failures++);
      });
  }

  private say(line: DriverLine) {
    const t = this.talk;
    Object.assign(t, { speaking: true, mood: line.mood, gesture: line.gesture, since: 0, progress: 0, story: line.text.split(/\s+/).length > 22 });
    this.lineSeconds = 0;
    this.lineStart = performance.now();
    this.onCaption({ id: ++this.captionId, text: line.text, mood: line.mood, speaker: line.speaker ?? 'driver' });
    if (line.engine !== 'recorded') this.onLine?.(line);
    if (line.engine !== 'recorded') {
      this.said.push(line.text);
      if (this.said.length > 12) this.said.shift();
      this.lines++;
    }
    const data = line.engine === 'recorded' ? this.recorded?.slice(0) : line.audio ? Uint8Array.from(atob(line.audio), (c) => c.charCodeAt(0)).buffer : null;
    this.recorded = null;
    const read = () => (this.fakeTalk = Math.max(1.6, line.text.split(/\s+/).length * 0.34));
    const id = this.captionId;
    if (!data) read();
    else
      void this.voice.play(data, () => id === this.captionId && this.finished()).then((seconds) => {
        if (id !== this.captionId) return;
        if (!seconds) return void read();
        this.lineSeconds = seconds;
        this.lineStart = performance.now();
      });
  }

  /** The line is over: a breath, then the next. Now and then he sulks a little longer. */
  private finished(pause = true) {
    this.fakeTalk = 0;
    this.talk.speaking = false;
    this.onCaption(null);
    if (pause) this.quietUntil = performance.now() + (Math.random() < 0.15 ? 2600 + Math.random() * 2400 : 500 + Math.random() * 1300);
  }

  /** The passenger cuts him off. Says whether he was mid-line, and whether it was a story. */
  cutOff(): { midLine: boolean; story: boolean } {
    const was = { midLine: this.talk.speaking && this.talk.progress < 0.85, story: this.talk.story };
    this.drop();
    this.voice.hush();
    this.finished(false);
    this.quietUntil = performance.now() + 700;
    this.askAfter = 0;
    return was;
  }

  /** The passenger says something: whatever he was about to say is dropped, and he answers this. */
  reply(text: string) {
    this.chosen = text;
    this.drop();
    this.voice.hush();
    this.finished(false);
    this.quietUntil = performance.now() + 500;
    this.askAfter = 0;
  }

  /** Something happened that he should react to at once. */
  prompt(event: string, sudden?: 'shock' | 'outrage' | 'weary') {
    this.note(event, sudden);
  }

  /** A sigh, between two lines, with nothing said. */
  sigh() {
    if (!this.talk.speaking) this.interrupt('weary');
  }

  stop() {
    this.drop();
    this.voice.hush();
    this.finished(false);
  }
}
