// The ride as a game: you are the passenger, he is the driver, and between you there is one number you never
// see. Sympathie, 0 to 100, starts low (a stranger in his taxi) and moves with what you do: interrupt him,
// change his radio, provoke him and it falls; let him talk, agree with him once, say something true about his
// town and it rises. Every action comes to a verdict, won or lost, and the road answers it at once: the route is
// a tour of the town's far corners before the address, a win drops the next stop, a loss adds one, and the
// meter's rate follows his mood. You never arrive until he has decided you are a friend: get close before that
// and the GPS finds roadworks, a market, a lost satellite, and round you go. At 0 he stops and you get out.
// The ride ends at the destination, or at that kerb, or when he finally lets you go; then you tip, and he
// remembers, and starts the next ride from there.

import { route } from '../city/network';
import type { RideFacts } from '../../shared/driver';
import type { Car, Traffic } from './cars';
import type { Chatter } from './chatter';
import type { PlaceOption } from './places';

/** `asking`: he has just been boarded and is asking where to; `idle`: the screen is up, waiting for an address. */
export type Phase = 'asking' | 'idle' | 'quoting' | 'riding' | 'refusing' | 'arrived' | 'ejected';
export type Level = RideFacts['level'];
export type Kind = 'curious' | 'practical' | 'provocative';

export interface Offer {
  id: number;
  lines: Array<{ text: string; kind: Kind; lever: string }>;
  /** When it appeared and when it goes (milliseconds of performance.now): the timer counts between the two. */
  since: number;
  until: number;
  irritated: boolean;
}

/** How long the passenger has to choose, in real seconds, while the world crawls. */
export const CHOICE_SECONDS = 7;
/** How long a verdict floats on the screen, in seconds. */
export const VERDICT_SECONDS = 4;
/** What his GPS says at the start, whatever the address: the game is to arrive before that. */
export const TOUR_MINUTES = 30;
/** The share of his tour each mood keeps: wary drops nearly half of it, warm most of it, a friend all of it. */
const SHARE: Record<Level, number> = { hostile: 1, wary: 0.55, warm: 0.22, friend: 0, done: 1 };

/** The ride in figures, before and after something happened. */
export interface Figures {
  eta: number;
  estimate: number;
  metres: number;
  perKm: number;
}

/** What an action came to: won or lost, in his eyes, and what it did to the road and to the money. */
export interface Verdict {
  id: number;
  at: number;
  /** `gps`: not the passenger's doing; the town's, or so the GPS says. */
  kind: 'win' | 'lose' | 'gps';
  /** What it did to the number, for the gauge. */
  points: number;
  title: string;
  hint: string;
  from: Figures;
  to: Figures;
  routeChanged: boolean;
  /** The route it replaced, for drawing it greyed under the new one. */
  previousLanes: number[];
}

export interface Memory {
  rides: number;
  lastTip: string;
  /** How he felt at the end of the last ride, which is where he starts the next. */
  mood: number;
}

/** What the interface shows of the ride. */
export interface RideView {
  phase: Phase;
  /** The number itself, for the gauge on the screen. */
  sympathie: number;
  level: Level;
  destination: string;
  eta: number;
  /** What the meter shows, and what it will come to by this route at this rate. */
  fare: number;
  estimate: number;
  meterCut: boolean;
  /** The lanes of the route still to drive, first the one the taxi is on: for the maps. */
  routeLanes: number[];
  /** Bumped every time the route is recomputed: the maps redraw with a flourish. */
  recalc: number;
  /** The last verdict, for the big moment on the screen. */
  verdict: Verdict | null;
  /** Metres of route still to drive. */
  metres: number;
  /** Every ETA the GPS has announced on this ride, first to last: the trail of minutes that never comes down. */
  etas: number[];
  /** Stops of his tour still to come before the address, and the lanes they are on, for the map. */
  stops: number;
  stopLanes: number[];
  /** Metres the direct road would be, for comparison with his. */
  direct: number;
  /** What his GPS promised at the start, in minutes, and the minutes gone since. */
  promised: number;
  elapsed: number;
  /** At the end: how long it took, against the promise, and the best time here. */
  score: { minutes: number; promised: number; best: number | null; arrived: boolean } | null;
  radio: { on: boolean; station: string; his: boolean; song: string; stream: string };
  window: 'up' | 'down';
  offer: Offer | null;
  /** What just happened, in a word, for the small print: "detour", "recalculating", "meter cut". */
  note: string;
  twist: string;
  memory: Memory;
  /** For the tells, not for the screen: 0 (a friend) to 1 (hostile). */
  tension: number;
}

/** The stations on his dial, each with the real thing behind it: the station's own live stream. */
const STATIONS = ['France Inter', 'FIP', 'Skyrock', 'France Musique', 'NRJ', 'Radio Classique', 'Mouv’', 'franceinfo'];
export const STREAMS: Record<string, string> = {
  'France Inter': 'https://icecast.radiofrance.fr/franceinter-midfi.mp3',
  FIP: 'https://icecast.radiofrance.fr/fip-midfi.mp3',
  Skyrock: 'https://icecast.skyrock.net/s/natio_mp3_128k',
  'France Musique': 'https://icecast.radiofrance.fr/francemusique-midfi.mp3',
  NRJ: 'https://scdn.nrjaudio.fm/audio1/fr/30001/mp3_128.mp3',
  'Radio Classique': 'https://radioclassique.ice.infomaniak.ch/radioclassique-high.mp3',
  'Mouv’': 'https://icecast.radiofrance.fr/mouv-midfi.mp3',
  franceinfo: 'https://icecast.radiofrance.fr/franceinfo-midfi.mp3',
};
/** What he takes the station to be playing (the real stream plays what it plays; he has his idea of it). */
const SONGS: Record<string, string[]> = {
  FIP: ['an old Brazilian record', 'some jazz, a trumpet', 'a French chanson you half remember', 'a guitar from Mali', 'something from the seventies with strings'],
  'France Inter': ['the morning phone-in about pensions', 'a report on cycle lanes', 'a chef explaining bouillabaisse'],
  Skyrock: ['a rap track with a lot of bass', 'a jingle that repeats the station’s name'],
  'France Musique': ['a Ravel piano piece', 'a Bizet aria'],
  NRJ: ['a summer hit from three years ago', 'a remix of a remix'],
  'Radio Classique': ['a Vivaldi concerto', 'an advert for a private bank'],
  'Mouv’': ['a club track at nine in the morning'],
  franceinfo: ['the traffic report, which is wrong', 'an interview with a minister'],
};
const TWISTS = ['other_city', 'second_passenger', 'phone_call', 'taxi_argument', 'questions', 'sincere'];
/** What the GPS finds, every time you get close before he likes you. */
const EXCUSES = ['Roadworks, apparently', 'A one-way street, since this morning', 'Market day', 'A procession', 'The satellite was lost', 'A shortcut he knows', 'A delivery van across the road', 'The mayor’s motorcade'];
const START = 20;
const NEVER = 'He only drives straight there for a friend.';

const levelOf = (s: number): Level => (s <= 0 ? 'done' : s <= 20 ? 'hostile' : s <= 50 ? 'wary' : s <= 80 ? 'warm' : 'friend');
const ORDER: Level[] = ['hostile', 'wary', 'warm', 'friend'];
/** What his mood does to the meter's rate: hostile, he finds the night tariff in broad daylight; a friend, the old tariff. */
const rateOf = (s: number) => 0.6 + 1.8 * (1 - s / 100);

const CLIMATE = (lat: number, lon: number, raining: boolean) => {
  if (raining) return 'cold drizzle and wind';
  if (lat < 44.5 && lon > 3 && lon < 8) return 'hot, dry, and the mistral blowing';
  if (lat < 45) return 'hot and humid';
  if (lat > 49) return 'grey, cool and damp';
  return 'mild, a little muggy';
};

export class Ride {
  phase: Phase = 'idle';
  sympathie = START;
  private level: Level = 'hostile';
  private destination: { label: string; lanes: number[] } | null = null;
  /** The one lane of the address the taxi is driven to: the tour must not pass it, the last leg ends on it. */
  private goalLane = -1;
  private start: { x: number; z: number; lane: number } | null = null;
  /** The far corners still to visit before the address, next first. */
  private stops: number[] = [];
  private excuses = 0;
  private lastExcuse = '';
  private direct = 0;
  private startedAt = 0;
  private tourStops = 0;
  private score: RideView['score'] = null;
  private best: number | null = null;
  private recalculated: RideFacts['recalculated'] = '';
  private recalc = 0;
  private verdict: Verdict | null = null;
  private verdicts = 0;
  private etas: number[] = [];
  private quote = false;
  private meterCut = false;
  private estimate = 0;
  private action = '';
  private lastAction = 0;
  private radio = { on: false, station: STATIONS[0], his: STATIONS[1], song: '' };
  private radioSwitchBack = 0;
  private window: 'up' | 'down' = 'up';
  private twist = '';
  private offer: Offer | null = null;
  private offerId = 0;
  private offersInARow = 0;
  private lastOfferAt = 0;
  private interruptedSince = false;
  private note = '';
  private noteUntil = 0;
  private memory: Memory = { rides: 0, lastTip: '', mood: START };
  private ending: RideFacts['ending'] = '';
  private refusedAt = 0;
  private lastSigh = 0;
  private stopped = false;
  private prevSpeaking = false;
  private agreed = false;
  /** The meter's honest rate, before his mood gets at it. */
  private baseRate = 9;
  private pendingAsk = false;
  private linesSinceEnd = 0;
  /** Lines written with the last speech, kept until he has finished saying it. */
  private pendingOffer: { lines: Offer['lines']; irritated: boolean } | null = null;
  private key = '';
  private traffic: Traffic | null = null;
  private taxi: Car | null = null;
  private places: PlaceOption[] = [];
  private place = { name: '', lat: 0, lon: 0 };
  private raining = false;
  private askedAt = 0;

  constructor(
    private readonly chatter: Chatter,
    private readonly onChange: (view: RideView) => void,
  ) {
    chatter.ride = () => ({ facts: this.facts(), offer: this.wantsOffer() });
    chatter.onLine = (line) => {
      if (this.phase === 'asking') {
        // He has said hello and asked where to: now the screen comes up.
        this.phase = 'idle';
        this.publish();
      }
      if (this.phase === 'quoting') {
        // He has repeated the address and named his price: the ride is on.
        this.phase = 'riding';
        this.publish();
      }
      if (line.replies && this.phase === 'riding' && !this.offer) {
        // Not yet: let him finish. The lines come up when the line ends, and the world slows for them.
        const kinds: Kind[] = ['curious', 'practical', 'provocative'];
        this.pendingOffer = { lines: line.replies.map((text, i) => ({ text, kind: kinds[i], lever: line.levers?.[i] ?? '' })), irritated: this.interruptedSince };
      }
      // He asked something and offered nothing to say back: the next line brings the three answers.
      this.pendingAsk = Boolean(line.asks) && !line.replies;
      this.interruptedSince = false;
      // The ride over, he says his piece, twice at most, and then waits to be paid.
      if (this.phase === 'arrived' || this.phase === 'ejected') this.chatter.hold = ++this.linesSinceEnd >= 2;
    };
  }

  /** A new town: whoever rode here before is remembered, by the tip they left. */
  setPlace(place: { name: string; lat: number; lon: number }, traffic: Traffic, places: PlaceOption[]) {
    this.traffic = traffic;
    this.places = places;
    this.place = place;
    this.key = `jev-roads:driver-memory:${place.lat.toFixed(2)},${place.lon.toFixed(2)}`;
    this.memory = { rides: 0, lastTip: '', mood: START };
    this.best = null;
    try {
      const saved = JSON.parse(localStorage.getItem(this.key) ?? 'null') as Memory | null;
      if (saved) this.memory = saved;
      const best = Number(localStorage.getItem(`${this.key}:best`));
      if (best > 0) this.best = best;
    } catch {
      // Nothing remembered.
    }
    this.score = null;
    // He asks where to before the screen comes up; if he has nothing to say, it comes up on its own.
    this.phase = 'asking';
    this.askedAt = performance.now();
    this.destination = null;
    this.verdict = null;
    this.etas = [];
    this.stops = [];
    this.publish();
  }

  /** Where the passenger could ask to go: the named places of this town, in plain words. */
  destinations(): Array<{ label: string; lanes: number[] }> {
    return this.places.map((p) => ({ label: p.label.split(':')[0].trim(), lanes: p.lanes })).filter((p) => p.lanes.length).slice(0, 12);
  }

  /** The passenger clicked the map: the street nearest that spot is where they want to go. */
  destinationAt(x: number, z: number): { label: string; lanes: number[] } | null {
    const traffic = this.traffic;
    if (!traffic) return null;
    let best: { lane: number; d: number } | null = null;
    for (const lane of traffic.net.lanes) {
      if (lane.length < 8 || lane.source || lane.sink) continue;
      for (const [px, pz] of lane.points) {
        const d = Math.hypot(px - x, pz - z);
        if (!best || d < best.d) best = { lane: lane.id, d };
      }
    }
    if (!best || best.d > 60) return null;
    const lane = traffic.net.lanes[best.lane];
    return { label: lane.road.name || `the ${lane.road.kind} road`, lanes: [best.lane] };
  }

  begin(taxi: Car, destination: { label: string; lanes: number[] }) {
    if (!this.traffic) return;
    this.taxi = taxi;
    this.destination = destination;
    this.start = { x: taxi.x, z: taxi.z, lane: taxi.path < this.traffic.lanesCount() ? taxi.path : taxi.route[0] };
    // The address is a street, and a street is two lanes: the one that can be reached from here is the one.
    const net = this.traffic.net;
    const near = (id: number) => Math.hypot(net.lanes[id].points[0][0] - taxi.x, net.lanes[id].points[0][1] - taxi.z);
    this.goalLane = [...destination.lanes].sort((a, b) => near(a) - near(b)).find((lane) => lane !== this.start!.lane && route(net, this.start!.lane, lane, () => 0)) ?? destination.lanes[0];
    taxi.wander = true;
    taxi.onRails = true;
    taxi.restUntil = 0;
    this.stopped = false;
    this.sympathie = this.memory.rides ? this.memory.mood : START;
    this.level = levelOf(this.sympathie);
    this.excuses = 0;
    this.lastExcuse = '';
    this.verdict = null;
    this.etas = [];
    this.meterCut = false;
    this.ending = '';
    this.offer = null;
    this.offersInARow = 0;
    this.agreed = false;
    this.twist = Math.random() < 0.45 ? TWISTS[Math.floor(Math.random() * TWISTS.length)] : '';
    this.lastAction = performance.now();
    // The first lines come soon after the price.
    this.lastOfferAt = performance.now() - 20000;
    this.baseRate = this.chatter.gags.perKm;
    this.linesSinceEnd = 0;
    this.chatter.hold = false;
    // Whatever he was about to say belongs to before the ride.
    this.chatter.stop();
    // The road: a tour of the far corners of the town, corner after corner until his GPS can say thirty minutes,
    // and only then the address. His mood, if he remembers you kindly, keeps only a share of it. Then the price
    // of it, announced as if it were nothing.
    this.stops = [];
    this.score = null;
    this.startedAt = performance.now();
    const L = this.traffic.lanesCount();
    let at = taxi.path < L ? taxi.path : taxi.route[0];
    let metres = 0;
    for (let i = 0; i < 40 && metres / 6.5 / 60 < TOUR_MINUTES; i++) {
      const stop = this.farStop();
      if (stop === null) break;
      const leg = route(net, at, stop, (l) => (l === this.goalLane ? Infinity : 0));
      if (!leg) break;
      metres += leg.reduce((sum, id) => sum + net.lanes[id].length, 0);
      this.stops.push(stop);
      at = stop;
    }
    this.tourStops = this.stops.length;
    while (this.stops.length > Math.round(this.tourStops * SHARE[this.level])) this.stops.shift();
    this.rebuild();
    this.rate();
    // The honest road, for the screen to put beside his.
    const straight = route(net, this.start.lane, this.goalLane, () => 0);
    this.direct = straight ? Math.round(straight.reduce((sum, id) => sum + net.lanes[id].length, 0)) : 0;
    this.quote = true;
    this.phase = 'quoting';
    this.estimate = this.estimateFare();
    this.etas = [this.eta()];
    this.recalc++;
    this.chatter.prompt(`the passenger got in and asked for ${destination.label}${this.memory.rides ? '; you remember them' : ''}`);
    this.publish();
  }

  // --- What the passenger does ---------------------------------------------------------------------------

  /** A click on the road while he talks: he is cut off. While he is quiet it is only a click. */
  interrupt() {
    if (this.phase !== 'riding' && this.phase !== 'quoting') return;
    if (!this.chatter.talk.speaking) return;
    const was = this.chatter.cutOff();
    this.action = was.midLine ? (was.story ? 'interrupted you in the middle of a story' : 'interrupted you') : 'told you to stop talking';
    this.interruptedSince = true;
    this.offer = null;
    this.pendingOffer = null;
    this.chatter.waiting = false;
    this.act(was.midLine ? (was.story ? -9 : -5) : -3, 'lose', was.midLine ? (was.story ? 'You cut him off mid-story' : 'You cut him off') : 'You told him to stop', 'He does not forget.');
    this.chatter.prompt(this.action);
  }

  answer(line: { text: string; kind: Kind; lever: string }) {
    if (this.phase !== 'riding' || !this.offer) return;
    this.offer = null;
    this.chatter.waiting = false;
    this.offersInARow = 0;
    this.action = `said: "${line.text}"`;
    this.chatter.reply(line.text);
    if (line.kind === 'curious') {
      // The hidden levers: agreeing with him (once), a true detail, his song, his opinion.
      if (line.lever === 'agree' && !this.agreed) this.act(16, 'win', 'You agreed with him', 'Once. It only works once.');
      else if (line.lever === 'true_detail') this.act(14, 'win', 'You know his town', 'Something true about the place goes a long way.');
      else if (line.lever === 'song' && this.radio.on && this.radio.station === this.radio.his) this.act(14, 'win', 'You like his song', 'His station, his song, his good side.');
      else if (line.lever === 'opinion') this.act(12, 'win', 'You asked what he thinks', 'Nobody ever does.');
      else this.act(8, 'win', 'You asked about the town', 'He likes being asked.');
      if (line.lever === 'agree') this.agreed = true;
    } else if (line.kind === 'practical') this.act(-6, 'lose', 'You asked about the ride', 'Never ask if it is still far.');
    else this.act(-12, 'lose', 'You provoked him', 'He has a detour for that. And a speech.');
  }

  toggleRadio() {
    if (this.phase !== 'riding') return;
    const r = this.radio;
    let by = -5;
    let title = 'You put the radio on';
    if (!r.on) {
      r.on = true;
      r.station = STATIONS.filter((s) => s !== r.his)[Math.floor(Math.random() * (STATIONS.length - 1))];
      this.action = `put the radio on, ${r.station}`;
    } else if (r.station !== r.his) {
      r.station = STATIONS.filter((s) => s !== r.station)[Math.floor(Math.random() * (STATIONS.length - 1))];
      by = -4;
      title = 'You changed his radio';
      this.action = `changed the radio to ${r.station}`;
    } else {
      r.on = false;
      by = -3;
      title = 'You switched off his radio';
      this.action = 'switched off your radio';
    }
    r.song = (SONGS[r.station] ?? [''])[Math.floor(Math.random() * (SONGS[r.station] ?? ['']).length)];
    // He switches it back after a moment, unless he is in a good mood.
    this.radioSwitchBack = this.sympathie <= 50 && r.on && r.station !== r.his ? performance.now() + 12000 + Math.random() * 14000 : 0;
    this.act(by, 'lose', title, 'It is his radio. He will switch it back.');
  }

  toggleWindow() {
    if (this.phase !== 'riding') return;
    this.window = this.window === 'up' ? 'down' : 'up';
    this.action = this.window === 'down' ? 'opened their window' : 'closed the window';
    this.act(-2, 'lose', this.window === 'down' ? 'You opened the window' : 'You closed the window', 'The air in here is his too.');
  }

  /** "Un dernier truc, je coupe le compteur": the passenger insists on getting out. */
  insist() {
    if (this.phase !== 'refusing') return;
    this.finish('arrived');
  }

  tip(amount: string) {
    if (this.phase !== 'arrived' && this.phase !== 'ejected') return;
    const generous = amount === '20%' || amount === '5 €';
    const nothing = amount === '0 €';
    this.memory = { rides: this.memory.rides + 1, lastTip: amount, mood: Math.max(5, Math.min(90, Math.round(this.sympathie * 0.6 + (nothing ? -10 : generous ? 25 : 8)))) };
    try {
      localStorage.setItem(this.key, JSON.stringify(this.memory));
    } catch {
      // Not remembered, that is all.
    }
    this.phase = 'idle';
    this.destination = null;
    this.stops = [];
    this.verdict = null;
    // The meter's honest rate again, for the next ride to start from.
    this.chatter.gags.perKm = this.baseRate;
    if (this.taxi && this.traffic) {
      this.taxi.restUntil = 0;
      this.taxi.onRails = false;
      this.traffic.forget(this.taxi);
    }
    this.chatter.hold = false;
    this.chatter.prompt(nothing ? 'the passenger left no tip at all' : `the passenger tipped ${amount}`);
    this.publish();
  }

  // --- Every frame -------------------------------------------------------------------------------------------

  update(dt: number, now: number, raining: boolean) {
    this.raining = raining;
    if (this.phase === 'asking' && (now - this.askedAt > 15000 || !this.chatter.on)) {
      this.phase = 'idle';
      this.publish();
    }
    const taxi = this.taxi;
    const traffic = this.traffic;
    if (this.phase === 'idle' || this.phase === 'asking' || !taxi || !traffic) return;
    const talk = this.chatter.talk;
    if (this.phase === 'riding' || this.phase === 'quoting') {
      // At nothing, he stops the car: before the slow drift can lift it a hair above nothing.
      if (this.sympathie <= 0) {
        this.finish('ejected');
        return;
      }
      // Nothing happening: it rises slowly; after a long silence he takes it as leave to talk more.
      const quiet = (now - this.lastAction) / 1000;
      this.sympathie = Math.min(100, this.sympathie + dt * (quiet > 8 ? 0.15 : 0.05));
      if (quiet > 50 && Math.random() < dt * 0.2) {
        this.action = 'has kept quiet for a long while';
        this.lastAction = now;
      }
      // A story he finished without being cut off warms him: the one thing that is won by doing nothing.
      if (this.prevSpeaking && !talk.speaking && talk.story && talk.progress > 0.95 && this.phase === 'riding') this.act(3, 'win', 'You let him finish his story', 'Silence pays, slowly.');
      // The drift carried him over a line, by a few points and not a hair (the number must not flip the road back and
      // forth on a decimal): the road shortens to match, with a word about it.
      const i = ORDER.indexOf(this.level);
      if (i >= 0 && i < 3 && this.sympathie > [20, 50, 80][i] + 3) this.act(0, 'win', 'He has warmed to you', 'Fewer detours from here.');
      const level = this.level;
      // The stops of his tour, as they are passed.
      while (this.stops.length && !taxi.route.includes(this.stops[0])) this.stops.shift();
      // The meter: a friend cuts it for the last stretch.
      if (this.level === 'friend' && !this.meterCut && this.eta() <= 2) {
        this.meterCut = true;
        this.chatter.gags.perKm = 0;
        this.setNote('meter cut');
        this.chatter.prompt('you have just switched the meter off: the rest is on you');
      }
      // Sighs between lines, when he is wary or hostile.
      if (this.sympathie <= 50 && !talk.speaking && now - this.lastSigh > 9000 && Math.random() < dt * 0.25) {
        this.lastSigh = now;
        this.chatter.sigh();
      }
      // The radio: he switches it back to his own.
      if (this.radioSwitchBack && now > this.radioSwitchBack) {
        this.radioSwitchBack = 0;
        this.radio.station = this.radio.his;
        this.radio.song = (SONGS[this.radio.his] ?? [''])[Math.floor(Math.random() * (SONGS[this.radio.his] ?? ['']).length)];
        this.chatter.prompt(`you switched the radio back to your own station, ${this.radio.his}; ${this.radio.song} is on`);
        this.publish();
      }
      // He has finished: the lines come up, and the world slows while the passenger chooses. Not over a verdict.
      if (this.pendingOffer && !talk.speaking && !this.offer && !(this.verdict && now - this.verdict.at < VERDICT_SECONDS * 1000)) {
        const pending = this.pendingOffer;
        this.pendingOffer = null;
        this.show(pending.lines, pending.irritated);
      }
      // The offer on screen goes stale: ignoring it counts as silence.
      if (this.offer && now > this.offer.until) {
        this.offer = null;
        this.chatter.waiting = false;
        this.setNote('you said nothing');
        this.publish();
      }
      // At the low point, once: he turns round and takes them back to where they got in.
      if (this.sympathie <= 10 && !this.twist && this.start && Math.random() < dt * 0.04) {
        this.twist = 'back_to_start';
        this.setNote('back to the start');
        this.chatter.prompt('you have turned round and are driving them back to where they got in', 'outrage');
        // Already there, or no way back: then this is where they get out.
        if (!traffic.sendTo(taxi, [this.start.lane], 'where you got in')) return this.finish('ejected');
        this.stops = [];
        this.recalc++;
        this.publish();
      }
      // Nearly there, and he still cannot stand you: the GPS finds a reason, and round you go. Every time.
      if (this.level === 'hostile' && this.twist !== 'back_to_start' && taxi.goal && !this.stops.length && this.left() > 0 && this.left() < 200 && taxi.v > 1.5 && !(this.verdict && now - this.verdict.at < 3000)) this.excuse();
      // Arrival: the taxi stands at the kerb; unless he is enjoying himself too much to let you go.
      if (!taxi.goal && taxi.restUntil > traffic.time && this.destination && !this.stopped) {
        if (this.twist === 'back_to_start') return this.finish('ejected');
        if (level === 'friend' && Math.random() < 0.7) {
          this.phase = 'refusing';
          this.refusedAt = now;
          this.ending = 'refusing';
          this.meterCut = true;
          this.chatter.gags.perKm = 0;
          taxi.restUntil = traffic.time + 40;
          this.chatter.prompt('you have arrived but you will not let them out yet: one last thing to show them, the meter is off');
          this.publish();
          return;
        }
        this.finish('arrived');
      }
    } else if (this.phase === 'refusing' && now - this.refusedAt > 30000) this.finish('arrived');
    this.prevSpeaking = talk.speaking;
    if (this.note && now > this.noteUntil) {
      this.note = '';
      this.publish();
    }
  }

  private finish(how: 'arrived' | 'ejected') {
    const taxi = this.taxi!;
    const traffic = this.traffic!;
    this.phase = how;
    this.ending = how;
    this.stopped = true;
    this.offer = null;
    this.pendingOffer = null;
    this.chatter.waiting = false;
    traffic.forget(taxi);
    taxi.restUntil = traffic.time + 1e6;
    taxi.wander = true;
    taxi.onRails = false;
    this.setNote(how === 'ejected' ? 'thrown out' : 'here we are');
    // The score: the minutes it took against the thirty he promised, and the best ever here.
    const minutes = Math.round(((performance.now() - this.startedAt) / 60000) * 10) / 10;
    if (how === 'arrived' && (this.best === null || minutes < this.best)) {
      this.best = minutes;
      try {
        localStorage.setItem(`${this.key}:best`, String(minutes));
      } catch {
        // Not remembered, that is all.
      }
    }
    this.score = { minutes, promised: TOUR_MINUTES, best: this.best, arrived: how === 'arrived' };
    this.chatter.prompt(how === 'ejected' ? 'you have had enough: you have pulled over and you are asking them to get out, here, now' : `you have arrived at ${this.destination?.label ?? 'the place'}: say the fare${this.meterCut ? ', which is nothing, it is on you' : ''} and say goodbye`, how === 'ejected' ? 'outrage' : undefined);
    this.publish();
  }

  // --- The verdict, and the road that answers it ---------------------------------------------------------------

  /**
   * Every action comes to this: the number moves, the road answers (a win drops the next stop of his tour, a
   * loss adds one, and warming to a new level drops the stops to that level's few), the rate follows his mood,
   * and the screen is given the figures before and after to make a moment of.
   */
  private act(by: number, kind: 'win' | 'lose', title: string, hint: string) {
    if (this.phase !== 'riding' && this.phase !== 'quoting') return;
    const was = this.snapshot();
    const before = this.level;
    this.bump(by);
    const level = levelOf(this.sympathie);
    if (level !== 'done') this.level = level;
    const rose = ORDER.indexOf(this.level) > ORDER.indexOf(before);
    const fell = ORDER.indexOf(this.level) < ORDER.indexOf(before);
    const stopsBefore = this.stops.join();
    // A win drops a fifth of what is left of his tour, a loss adds back a sixth of it (one at the least, four at most).
    if (kind === 'win') for (let n = Math.min(4, Math.max(1, Math.round(this.stops.length * 0.2))); n > 0 && this.stops.length; n--) this.stops.shift();
    if (kind === 'lose')
      for (let n = Math.min(4, Math.max(1, Math.round(this.stops.length * 0.16))); n > 0; n--) {
        const stop = this.farStop();
        if (stop === null) break;
        this.stops.unshift(stop);
      }
    // In his good books: the tour shrinks to that level's share of it; a friend goes straight there.
    if (rose) while (this.stops.length > Math.round(this.tourStops * SHARE[this.level])) this.stops.shift();
    this.rate();
    // The road is only redrawn when the stops changed: a rebuild for nothing would reroute a few metres and call it
    // news. And a loss must read as more road, a win as less: if the corner picked made no difference (it lay on the
    // way), another is picked, up to three times.
    if (this.stops.join() !== stopsBefore) {
      this.rebuild();
      for (let tries = 0; tries < 3 && kind === 'lose' && this.left() < was.metres + 80; tries++) {
        const stop = this.farStop();
        if (stop === null) break;
        this.stops.unshift(stop);
        this.rebuild();
      }
      for (let tries = 0; tries < 3 && kind === 'win' && this.stops.length && this.left() > was.metres - 80; tries++) {
        this.stops.shift();
        this.rebuild();
      }
    }
    this.estimate = this.estimateFare();
    const changed = Math.abs(this.left() - was.metres) > 30;
    if (changed) {
      this.recalc++;
      this.recalculated = this.left() > was.metres ? 'longer' : 'shorter';
    }
    if (rose || fell) this.chatter.prompt(`your mood towards them has ${rose ? 'warmed' : 'cooled'}: the GPS has recomputed the route, ${this.recalculated === 'longer' ? 'longer now' : this.recalculated === 'shorter' ? 'shorter now' : 'much the same'}, ${this.eta()} minutes, ${this.estimate.toFixed(0)} euros`);
    this.moment(kind, by, title, this.level === 'friend' && rose ? 'He has decided you are all right. Straight there.' : rose ? 'He has warmed to you: fewer detours.' : fell ? 'He has cooled: more detours.' : hint, was, changed);
    this.publish();
  }

  /** So close, and not a friend: the GPS finds something, and adds a far corner to the road. */
  private excuse() {
    const was = this.snapshot();
    const stop = this.farStop();
    if (stop === null) return;
    this.stops.unshift(stop);
    this.rebuild();
    this.estimate = this.estimateFare();
    this.excuses++;
    this.recalc++;
    this.recalculated = 'longer';
    const why = EXCUSES.filter((e) => e !== this.lastExcuse)[Math.floor(Math.random() * (EXCUSES.length - 1))];
    this.lastExcuse = why;
    this.moment('gps', 0, why, NEVER, was, true);
    this.setNote('recalculating');
    this.chatter.prompt(`you were nearly at ${this.destination?.label ?? 'the address'} and the GPS has just sent you round again (${why.toLowerCase()}): ${this.eta()} more minutes, and you find that perfectly normal`, 'weary');
    this.publish();
  }

  /** The meter's rate for his mood right now, unless he has cut it. */
  private rate() {
    if (!this.meterCut) this.chatter.gags.perKm = Math.round(this.baseRate * rateOf(this.sympathie) * 100) / 100;
  }

  /**
   * A far corner of the town: the reachable street farthest from the taxi, from the address and from the stops
   * already planned, so that each one sends him across the whole map.
   */
  private farStop(): number | null {
    const taxi = this.taxi;
    const traffic = this.traffic;
    if (!taxi || !traffic || !this.destination) return null;
    const net = traffic.net;
    const goalLane = this.goalLane;
    const goal = net.lanes[goalLane]?.points[0];
    if (!goal) return null;
    const candidates = net.lanes.filter((l) => l.length > 20 && !l.source && !l.sink && l.road.rank >= 2 && !this.destination!.lanes.includes(l.id));
    if (candidates.length < 8) return null;
    const anchors: Array<[number, number]> = [[taxi.x, taxi.z], goal, ...this.stops.map((id) => net.lanes[id].points[0])];
    const scored = candidates
      .map((via) => ({ lane: via.id, score: Math.min(...anchors.map(([ax, az]) => Math.hypot(via.points[0][0] - ax, via.points[0][1] - az))) + Math.random() * 40 }))
      .filter((c) => c.score > 70)
      .sort((a, b) => b.score - a.score);
    // The farthest that can be reached from the last stop, and left again for the address (the edge of the map is
    // full of streets that lead out and not back).
    const L = traffic.lanesCount();
    const from = this.stops.length ? this.stops[this.stops.length - 1] : taxi.path < L ? taxi.path : taxi.route[0];
    const avoid = (l: number) => (l === goalLane ? Infinity : 0);
    for (const { lane } of scored) if (lane !== from && route(net, from, lane, avoid) && route(net, lane, goalLane, () => 0)) return lane;
    return null;
  }

  /** The route through the stops, in order, and then to the address; a stop that cannot be reached is dropped. */
  private rebuild(): boolean {
    const taxi = this.taxi;
    const traffic = this.traffic;
    if (!taxi || !traffic || !this.destination) return false;
    const net = traffic.net;
    const L = traffic.lanesCount();
    const goalLane = this.goalLane;
    // The legs of the tour must not pass the address: the taxi would stop there, and that is not the idea.
    const avoid = (l: number) => (l === goalLane ? Infinity : 0);
    const taxiLane = taxi.path < L ? taxi.path : taxi.route[0];
    let at = taxiLane;
    const legs: number[][] = [];
    const kept: number[] = [];
    for (const stop of this.stops) {
      if (stop === at) continue;
      const leg = route(net, at, stop, avoid);
      if (!leg) continue;
      legs.push(leg);
      kept.push(stop);
      at = stop;
    }
    // And home, from the last stop that has a way home. No allowance for queues on any leg: the same stops from the
    // same place must give the same road, so that a stop more is always more road and a stop fewer always less.
    let home = route(net, at, goalLane, () => 0);
    while (!home && legs.length) {
      legs.pop();
      kept.pop();
      at = kept.length ? kept[kept.length - 1] : taxiLane;
      home = route(net, at, goalLane, () => 0);
    }
    this.stops = kept;
    if (!home) return traffic.sendTo(taxi, this.destination.lanes, this.destination.label);
    const lanes = legs.flatMap((leg, i) => (i ? leg.slice(1) : leg));
    taxi.route = lanes.length ? [...lanes, ...home.slice(1)] : home;
    taxi.goal = { label: this.destination.label, lane: goalLane };
    taxi.follow = null;
    taxi.restUntil = 0;
    return true;
  }

  /** The figures of the moment, before anything is changed. */
  private snapshot(): Figures & { lanes: number[] } {
    return { eta: this.eta(), estimate: this.estimate, metres: this.left(), perKm: this.chatter.gags.perKm, lanes: this.taxi?.route.slice() ?? [] };
  }

  /** The screen makes a moment of it, and the trail of ETAs gets one more if the road changed. */
  private moment(kind: Verdict['kind'], points: number, title: string, hint: string, was: Figures & { lanes: number[] }, routeChanged: boolean) {
    const to = { eta: this.eta(), estimate: this.estimate, metres: this.left(), perKm: this.chatter.gags.perKm };
    this.verdict = { id: ++this.verdicts, at: performance.now(), kind, points, title, hint, from: { eta: was.eta, estimate: was.estimate, metres: was.metres, perKm: was.perKm }, to, routeChanged, previousLanes: routeChanged ? was.lanes : [] };
    if (routeChanged) this.etas.push(to.eta);
  }

  // --- What the driver is told, and what the screen is told ---------------------------------------------------

  private facts(): RideFacts {
    const action = this.action;
    this.action = '';
    const recalculated = this.recalculated;
    this.recalculated = '';
    const quote = this.quote;
    this.quote = false;
    return {
      destination: this.destination?.label ?? '',
      level: this.level,
      eta_min: this.eta(),
      estimated_fare: Math.round(this.estimate * 100) / 100,
      recalculated,
      meter_cut: this.meterCut,
      detours: this.excuses,
      just_detoured: this.verdict?.kind === 'gps' && performance.now() - this.verdict.at < 20000 ? this.verdict.title : '',
      passenger_action: action,
      radio: { on: this.radio.on, station: this.radio.station, his_station: this.radio.his, song: this.radio.on ? this.radio.song : '' },
      window: this.window,
      climate: CLIMATE(this.place.lat, this.place.lon, this.raining),
      nearby: this.nearby(),
      twist: this.twist,
      memory: { rides: this.memory.rides, last_tip: this.memory.lastTip },
      ending: this.ending,
      quote,
    };
  }

  /**
   * Lines are offered about every other speech, never twice running unless the passenger interrupted, and never
   * left for more than half a minute: the passenger is here to play, not only to listen.
   */
  private wantsOffer(): boolean {
    if (this.phase !== 'riding' || this.offer) return false;
    if (this.interruptedSince || this.pendingAsk) return true;
    // The twists that are played with the three lines want them every time.
    if (this.twist === 'questions' || this.twist === 'phone_call' || this.twist === 'taxi_argument') return true;
    const since = performance.now() - this.lastOfferAt;
    if (since > 32000) return true;
    if (this.offersInARow >= 1) {
      this.offersInARow = 0;
      return false;
    }
    if (since < 9000) return false;
    const taxi = this.taxi;
    const atRed = Boolean(taxi && taxi.light === 'red' && taxi.v < 0.5);
    const want = atRed || Math.random() < 0.55;
    if (want) this.offersInARow++;
    return want;
  }

  private show(lines: Offer['lines'], irritated: boolean) {
    // Shuffled and unlabelled: the passenger does not know which is which until they say it.
    const shuffled = [...lines].sort(() => Math.random() - 0.5);
    const now = performance.now();
    this.offer = { id: ++this.offerId, lines: shuffled, since: now, until: now + CHOICE_SECONDS * 1000, irritated };
    this.lastOfferAt = now;
    this.chatter.waiting = true;
    this.publish();
  }

  /** Named places within two hundred metres of the taxi, nearest first. */
  private nearby(): string[] {
    const taxi = this.taxi;
    const traffic = this.traffic;
    if (!taxi || !traffic) return [];
    const near: Array<{ label: string; d: number }> = [];
    for (const p of this.places) {
      const lane = traffic.net.lanes[p.lanes[0]];
      if (!lane) continue;
      const mid = lane.points[Math.floor(lane.points.length / 2)];
      const d = Math.hypot(mid[0] - taxi.x, mid[1] - taxi.z);
      if (d < 220) near.push({ label: p.label.split(':')[0].trim(), d });
    }
    return near.sort((a, b) => a.d - b.d).slice(0, 4).map((n) => n.label);
  }

  /** Metres of route still to drive. */
  private left(): number {
    const taxi = this.taxi;
    const traffic = this.traffic;
    if (!taxi || !traffic || !taxi.goal) return 0;
    return taxi.route.reduce((sum, id) => sum + (traffic.net.lanes[id]?.length ?? 0), 0);
  }

  private eta(): number {
    return this.left() ? Math.max(1, Math.round(this.left() / 6.5 / 60)) : 0;
  }

  /** What the meter will say: the pickup, the kilometres at today's rate, and the supplements he will find. */
  private estimateFare(): number {
    const g = this.chatter.gags;
    const km = this.left() / 1000;
    const supplements = this.level === 'hostile' ? 3 : this.level === 'wary' ? 2 : this.level === 'warm' ? 1 : 0;
    return (g.fare ?? 4.1) + km * (this.meterCut ? 0 : g.perKm) + supplements * 2.4;
  }

  private bump(by: number) {
    this.sympathie = Math.max(0, Math.min(100, this.sympathie + by));
    this.lastAction = performance.now();
  }

  private setNote(note: string) {
    this.note = note;
    this.noteUntil = performance.now() + 7000;
  }

  private publish() {
    this.chatter.rideOn = this.phase === 'riding' || this.phase === 'quoting' || this.phase === 'refusing';
    this.onChange(this.view());
  }

  view(): RideView {
    const taxi = this.taxi;
    return {
      phase: this.phase,
      sympathie: this.sympathie,
      level: this.level,
      destination: this.destination?.label ?? '',
      eta: this.eta(),
      fare: this.chatter.gags.fare ?? 0,
      estimate: this.estimate,
      meterCut: this.meterCut,
      routeLanes: taxi && this.destination && (this.phase === 'riding' || this.phase === 'quoting') ? taxi.route.slice() : [],
      recalc: this.recalc,
      verdict: this.verdict,
      metres: this.left(),
      etas: this.etas,
      stops: this.stops.length,
      stopLanes: this.stops.slice(),
      direct: this.direct,
      promised: TOUR_MINUTES,
      elapsed: this.startedAt && this.phase !== 'idle' && this.phase !== 'asking' ? (performance.now() - this.startedAt) / 60000 : 0,
      score: this.score,
      radio: { on: this.radio.on, station: this.radio.station, his: this.radio.station === this.radio.his, song: this.radio.song, stream: this.radio.on ? (STREAMS[this.radio.station] ?? '') : '' },
      window: this.window,
      offer: this.offer,
      note: this.note,
      twist: this.twist,
      memory: this.memory,
      tension: this.phase === 'riding' || this.phase === 'quoting' || this.phase === 'refusing' ? Math.max(0, Math.min(1, 1 - this.sympathie / 100)) : 0,
    };
  }
}
