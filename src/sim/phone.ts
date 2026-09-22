/** A call runs on time spent in the taxi, so looking at the map never skips it. */
export const PHONE_PENALTY = 8;
export interface Caller {
  name: string;
  relation: string;
  topic: string;
  en: string[];
  fr: string[];
}
export interface PhoneView {
  phase: 'idle' | 'ringing' | 'talking';
  enabled: boolean;
  caller: string;
  relation: string;
  elapsed: number;
}
const CALLERS: Caller[] = [
  { name: 'Didier', relation: 'Brother-in-law', topic: 'he wants to borrow your drill again and still has your ladder', en: ['Didier? If this is about the drill, you still have my ladder.', 'No, leaving it in your garage does not count as returning it.', 'Sunday. Bring the ladder, and we will discuss the drill.'], fr: ['Didier ? Si c’est pour la perceuse, tu as encore mon échelle.', 'Non, la laisser dans ton garage, ce n’est pas me la rendre.', 'Dimanche. Tu ramènes l’échelle, et on parle de la perceuse.'] },
  { name: 'Jo', relation: 'Another driver', topic: 'an absurd queue at the station and whose turn it is to buy coffee', en: ['Jo, tell me you have moved at least one car length.', 'Everyone knows a shortcut until everyone takes the same shortcut.', 'Get two coffees. I paid last time, and I have witnesses.'], fr: ['Jo, dis-moi que tu as avancé au moins d’une voiture.', 'Tout le monde connaît un raccourci, et tout le monde prend le même.', 'Prends deux cafés. La dernière fois, c’était moi, j’ai des témoins.'] },
  { name: 'Mum', relation: 'Family', topic: 'you are late for lunch but insist you are practically there', en: ['Yes, Mum, I have eaten. A coffee counts before noon.', 'I said nearly there. Nearly is a very flexible distance.', 'Save me some. And do not tell everyone I am late again.'], fr: ['Oui maman, j’ai mangé. Un café, ça compte avant midi.', 'J’ai dit presque arrivé. Presque, c’est une distance assez souple.', 'Garde-moi une part. Et ne dis pas à tout le monde que je suis en retard.'] },
];
const LONDON_CALLERS: Caller[] = [
  { name: 'Dave', relation: 'Another cabbie', topic: 'the Blackwall Tunnel queue and who is buying the next round', en: ['Dave, if you are still at Blackwall, charge the tunnel rent.', 'You said five minutes. You said that before the last election.', 'Mine is a pint. At those prices, ask about a payment plan.'], fr: [] },
  { name: 'Tracey', relation: 'At home', topic: 'you promised to bring milk home but stopped for a proper cup of tea', en: ['Yes, I have remembered the milk. Remembering and buying are different stages.', 'It is barely raining. That is decorative London drizzle.', 'Put the kettle on. Not yet, obviously. I said I was in traffic.'], fr: [] },
  { name: 'Kev', relation: 'Football mate', topic: 'a disastrous football match and your lucky scarf that never works', en: ['Kev, the scarf is not unlucky. The defending is unlucky.', 'My nan could have saved that, and she would have kept hold of her tea.', 'Same pub Saturday? We can be disappointed somewhere familiar.'], fr: [] },
];

export class DriverPhone {
  phase: PhoneView['phase'] = 'idle';
  enabled = true;
  elapsed = 0;
  caller: Caller | null = null;
  private untilCall = 25;
  private duration = 38;
  private last = -1;
  constructor(private readonly uk = false, private readonly random = Math.random) {}
  reset() {
    this.phase = 'idle'; this.elapsed = 0; this.caller = null;
    this.untilCall = 20 + this.random() * 20;
  }
  start(): boolean {
    if (!this.enabled || this.phase !== 'idle') return false;
    const pool = this.uk ? LONDON_CALLERS : CALLERS;
    const choices = pool.map((_, i) => i).filter(i => i !== this.last);
    this.last = choices[Math.min(choices.length - 1, Math.floor(this.random() * choices.length))];
    this.caller = pool[this.last]; this.phase = 'ringing'; this.elapsed = 0;
    this.duration = 32 + this.random() * 18;
    return true;
  }
  end() {
    this.phase = 'idle'; this.elapsed = 0; this.caller = null;
    this.untilCall = 90 + this.random() * 80;
  }
  update(dt: number, active: boolean, canStart = true): boolean {
    if (!active || !this.enabled) return false;
    if (this.phase === 'idle') {
      this.untilCall -= dt;
      return this.untilCall <= 0 && canStart ? this.start() : false;
    }
    this.elapsed += dt;
    if (this.phase === 'ringing' && this.elapsed >= 6) {
      this.phase = 'talking'; this.elapsed = 0; return true;
    }
    if (this.phase === 'talking' && this.elapsed >= this.duration) { this.end(); return true; }
    return false;
  }
  view(): PhoneView { return { phase: this.phase, enabled: this.enabled, elapsed: this.elapsed, caller: this.caller?.name ?? '', relation: this.caller?.relation ?? '' }; }
}
