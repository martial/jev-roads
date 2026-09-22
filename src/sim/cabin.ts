/** Objects on the dashboard share one small, fixed-step simulation; frame rate never changes their weight. */
export type CabinTopic = 'meter' | 'newspaper' | 'vents' | 'mirror';
export type CabinItem = 'tree' | 'dog' | 'glovebox' | 'visor' | CabinTopic;
export const isCabinTopic = (item: CabinItem): item is CabinTopic => ['meter', 'newspaper', 'vents', 'mirror'].includes(item);
/** One friendly question, one complaint, one invitation to a much longer journey. */
export function cabinTopic(item: CabinTopic, uk: boolean): { title: string; lines: [string, string, string] } {
  return {
    meter: { title: 'That meter keeps climbing…', lines: [
      'What’s the strangest fare you’ve ever had?',
      'Does that thing charge by the minute or by the sigh?',
      'Did you rig the meter, or am I paying for your next holiday?',
    ] as [string, string, string] },
    newspaper: { title: 'Yesterday’s news, today’s argument.', lines: [
      'Anything in there worth getting angry about today?',
      uk ? 'Could you find the football results without a speech about Arsenal?' : 'Could you find the football results without a speech about Marseille?',
      'Do you believe everything that paper tells you?',
    ] as [string, string, string] },
    vents: { title: 'A very personal climate.', lines: [
      'How have you kept this old cab going all these years?',
      'Could we have some air that hasn’t been here since 1998?',
      uk ? 'Is that heater powered by your hot takes about the congestion charge?' : 'Is the air conditioning powered by all your complaining?',
    ] as [string, string, string] },
    mirror: { title: 'You catch his eye in the mirror.', lines: [
      'You must have seen some characters in that mirror?',
      'Could you watch the road instead of checking on me?',
      'Is that mirror for the traffic, or for admiring yourself?',
    ] as [string, string, string] },
  }[item];
}
export interface CabinView { gloveboxOpen: boolean; visorDown: boolean; dogPetted: boolean }
export interface CabinForces { acceleration: number; lateral: number; speed: number; windowOpen: boolean }
const clamp = (x: number, low: number, high: number) => Math.max(low, Math.min(high, Number.isFinite(x) ? x : 0));
const STEP = 1 / 120;

export class CabinPhysics {
  readonly fore = { angle: 0, velocity: 0 };
  readonly side = { angle: 0, velocity: 0 };
  readonly twist = { angle: 0, velocity: 0 };
  readonly dog = { angle: 0, velocity: 0 };
  private remainder = 0;
  private clock = 0;

  reset() {
    for (const axis of [this.fore, this.side, this.twist, this.dog]) axis.angle = axis.velocity = 0;
    this.remainder = this.clock = 0;
  }

  flickTree() {
    this.fore.velocity = clamp(this.fore.velocity + 3.8, -7, 7);
    this.side.velocity = clamp(this.side.velocity + 2.4, -7, 7);
    this.twist.velocity = clamp(this.twist.velocity + 5, -9, 9);
  }

  pokeDog() { this.dog.velocity = clamp(this.dog.velocity + 5.5, -9, 9); }

  step(dt: number, forces: CabinForces) {
    this.remainder += clamp(dt, 0, 0.1);
    const acceleration = clamp(forces.acceleration, -10, 10);
    const lateral = clamp(forces.lateral, -10, 10);
    const speed = clamp(forces.speed, 0, 50);
    while (this.remainder + 1e-9 >= STEP) {
      this.remainder = Math.max(0, this.remainder - STEP);
      this.clock += STEP;
      const breeze = forces.windowOpen ? Math.min(1.5, speed * 0.07) : 0;
      const rumble = Math.min(1, speed / 15) * Math.sin(this.clock * 27) * 0.1;
      // The air freshener hangs 17 cm below its pivot. Cabin acceleration acts opposite to the car's motion.
      this.integrate(this.fore, (-9.81 * Math.sin(this.fore.angle) - acceleration * Math.cos(this.fore.angle)) / 0.17 + rumble, 1.8, 0.82);
      this.integrate(this.side, (-9.81 * Math.sin(this.side.angle) - lateral * Math.cos(this.side.angle)) / 0.17 + breeze * (2 + Math.sin(this.clock * 5)), 1.6, 0.82);
      this.integrate(this.twist, -7 * this.twist.angle + breeze * Math.sin(this.clock * 7), 1.2, 1.1);
      // The dog has a much stiffer neck spring, with a little road vibration left in it.
      this.integrate(this.dog, -100 * this.dog.angle - acceleration * 0.9 + rumble * 4, 3.2, 0.55);
    }
  }

  private integrate(axis: { angle: number; velocity: number }, force: number, damping: number, limit: number) {
    axis.velocity = clamp((axis.velocity + force * STEP) * Math.exp(-damping * STEP), -14, 14);
    axis.angle += axis.velocity * STEP;
    if (Math.abs(axis.angle) > limit) {
      axis.angle = Math.sign(axis.angle) * limit;
      if (axis.angle * axis.velocity > 0) axis.velocity *= -0.2;
    }
  }
}
