import type { CabinItem } from '../sim/cabin';
import { isUK } from '../edition';

// Two quiet synthesised sounds, a distant siren and the hum of the car you sit in, and one loud recorded one:
// the driver. Horns are silent on purpose. And the radio, which is the real thing: a live stream of the station
// on the dial, played through an audio element (a stream needs no decoding of ours, and asks no CORS of anyone).

export class Sound {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private hum: { osc: OscillatorNode; gain: GainNode; filter: BiquadFilterNode } | null = null;
  private siren: { osc: OscillatorNode; gain: GainNode } | null = null;
  private voice: { gain: GainNode; pan: StereoPannerNode; meter: AnalyserNode; samples: Float32Array<ArrayBuffer> } | null = null;
  private speaking: AudioBufferSourceNode | null = null;
  private voiceGeneration = 0;
  private ringer: GainNode | null = null;
  private ringing = false;
  private onCall = false;
  muted = false;
  private radioEl: HTMLAudioElement | null = null;
  private radioUrl = '';
  private radioWanted = 0.28;

  /** Browsers only allow sound after a click or a key press. */
  wake() {
    if (this.ctx) return void this.ctx.resume();
    const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) return;
    this.ctx = new Ctx();
    this.master = this.ctx.createGain();
    this.master.gain.value = 0.5;
    this.master.connect(this.ctx.destination);

    const osc = this.ctx.createOscillator();
    osc.type = 'sawtooth';
    const filter = this.ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 160;
    const gain = this.ctx.createGain();
    gain.gain.value = 0;
    osc.connect(filter).connect(gain).connect(this.master);
    osc.start();
    this.hum = { osc, gain, filter };

    const s = this.ctx.createOscillator();
    s.type = 'triangle';
    const sg = this.ctx.createGain();
    sg.gain.value = 0;
    s.connect(sg).connect(this.master);
    s.start();
    this.siren = { osc: s, gain: sg };

    this.ringer = this.ctx.createGain();
    this.ringer.gain.value = 0;
    this.ringer.connect(this.master);
    for (const frequency of [660, 880]) {
      const tone = this.ctx.createOscillator();
      tone.type = 'sine'; tone.frequency.value = frequency;
      tone.connect(this.ringer); tone.start();
    }

    // The driver sits to your left.
    const gainV = this.ctx.createGain();
    gainV.gain.value = 1.7;
    const pan = this.ctx.createStereoPanner();
    pan.pan.value = isUK() ? 0.35 : -0.35;
    const meter = this.ctx.createAnalyser();
    meter.fftSize = 512;
    gainV.connect(meter);
    meter.connect(pan).connect(this.master);
    this.voice = { gain: gainV, pan, meter, samples: new Float32Array(meter.fftSize) };
  }

  /** Tiny mechanical sounds, made locally; no extra audio downloads. */
  cabin(item: CabinItem) {
    if (!this.ctx || !this.master || this.muted || this.ctx.state !== 'running' || !['dog', 'glovebox', 'visor'].includes(item)) return;
    const at = this.ctx.currentTime;
    const osc = this.ctx.createOscillator(), gain = this.ctx.createGain();
    const dog = item === 'dog';
    osc.type = dog ? 'sine' : 'triangle';
    osc.frequency.setValueAtTime(dog ? 780 : 170, at);
    osc.frequency.exponentialRampToValueAtTime(dog ? 410 : 65, at + 0.1);
    gain.gain.setValueAtTime(dog ? 0.045 : 0.09, at);
    gain.gain.exponentialRampToValueAtTime(0.001, at + 0.14);
    osc.connect(gain).connect(this.master);
    osc.onended = () => { osc.disconnect(); gain.disconnect(); };
    osc.start(); osc.stop(at + 0.16);
  }

  /** Says recorded words. Resolves with their length in seconds once they have begun, or 0 when there is no sound to be had. */
  async play(data: ArrayBuffer, onEnd: () => void): Promise<number> {
    if (!this.ctx || !this.voice || this.muted || this.ctx.state !== 'running') return 0;
    const generation = this.voiceGeneration;
    let buffer: AudioBuffer;
    try {
      buffer = await this.ctx.decodeAudioData(data);
    } catch {
      return 0;
    }
    if (generation !== this.voiceGeneration) return 0;
    this.hush();
    const source = this.ctx.createBufferSource();
    source.buffer = buffer;
    source.connect(this.voice.gain);
    source.onended = () => {
      if (this.speaking !== source) return;
      this.speaking = null;
      onEnd();
    };
    this.voice.gain.gain.setValueAtTime(1.7, this.ctx.currentTime);
    this.speaking = source;
    source.start();
    return buffer.duration;
  }

  /** He stops mid-word, the way people do. */
  hush() {
    this.voiceGeneration++;
    const source = this.speaking;
    if (!source || !this.ctx || !this.voice) return;
    this.speaking = null;
    this.voice.gain.gain.setTargetAtTime(0, this.ctx.currentTime, 0.03);
    source.stop(this.ctx.currentTime + 0.12);
  }

  /** How loud he is this instant, 0..1: it opens his mouth. */
  get level(): number {
    if (!this.voice || !this.speaking) return 0;
    this.voice.meter.getFloatTimeDomainData(this.voice.samples);
    let sum = 0;
    for (const v of this.voice.samples) sum += v * v;
    return Math.min(1, Math.sqrt(sum / this.voice.samples.length) * 2.2);
  }

  /** Turn your head towards him and he is in front of you. `turn`: 0 looking ahead, 1 looking straight at him. */
  face(turn: number) {
    if (this.ctx && this.voice) this.voice.pan.pan.setTargetAtTime((isUK() ? 0.4 : -0.4) * (1 - Math.min(1, Math.max(0, turn))), this.ctx.currentTime, 0.08);
  }

  /** The radio: a station's live stream, or silence. Quieter while the driver talks over it, as drivers do. */
  radio(url: string | null, level = 0.28) {
    this.radioWanted = level;
    if (!url) {
      if (this.radioEl) {
        this.radioEl.pause();
        this.radioEl.removeAttribute('src');
        this.radioEl.load();
      }
      this.radioUrl = '';
      return;
    }
    if (!this.radioEl) {
      this.radioEl = new Audio();
      this.radioEl.preload = 'none';
      this.radioEl.crossOrigin = null;
    }
    if (url !== this.radioUrl) {
      this.radioUrl = url;
      this.radioEl.src = url;
      this.radioEl.volume = 0;
      void this.radioEl.play().catch(() => {
        // Not allowed yet (no click), or the stream is down: the dial shows the station all the same.
      });
    }
  }

  phone(ringing: boolean, onCall: boolean) { this.ringing = ringing; this.onCall = onCall; }

  /** Called every frame: speed of the ridden car (or null), and how near an ambulance is (0..1). */
  update(speed: number | null, sirenNear: number, timeScale = 1) {
    if (this.radioEl && this.radioUrl) {
      // Over the engine, under the driver.
      const want = this.muted ? 0 : this.radioWanted * (this.onCall ? 0.12 : this.speaking ? 0.35 : 1);
      this.radioEl.volume += (want - this.radioEl.volume) * 0.08;
      if (this.radioEl.paused && !this.muted) void this.radioEl.play().catch(() => {});
    }
    if (!this.ctx || !this.hum || !this.siren) return;
    const now = this.ctx.currentTime;
    const on = this.muted ? 0 : 1;
    const beat = now % 2.2;
    const pulse = beat < 0.2 || (beat > 0.35 && beat < 0.55);
    this.ringer?.gain.setTargetAtTime(on && this.ringing && pulse ? 0.09 : 0, now, 0.015);
    // Slow motion drags the engine's note down with it.
    const slow = 0.45 + 0.55 * timeScale;
    if (this.muted && this.speaking) this.hush();
    this.hum.gain.gain.setTargetAtTime(speed === null ? 0 : on * (0.035 + Math.min(0.05, speed * 0.004)), now, 0.2);
    this.hum.osc.frequency.setTargetAtTime((38 + (speed ?? 0) * 5) * slow, now, 0.15);
    this.hum.filter.frequency.setTargetAtTime((140 + (speed ?? 0) * 22) * slow, now, 0.2);
    this.siren.gain.gain.setTargetAtTime(on * sirenNear * 0.09, now, 0.1);
    this.siren.osc.frequency.setTargetAtTime(Math.floor(now / 0.55) % 2 ? 660 : 880, now, 0.03);
  }
}
