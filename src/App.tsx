import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import type { Chatter } from './sim/chatter';
import { Game, PLACES, type Place } from './game';
import { PRICE } from './sim/brain';
import { CHOICE_SECONDS, VERDICT_SECONDS, type Offer, type Verdict as RideVerdict } from './sim/ride';
import { get, set, useUI } from './store';
import type { Look } from './view/types';
import { route } from './city/network';
import { Landing } from './ui/Landing';
import { MapPicker } from './ui/MapPicker';
import { TaxiScreen } from './ui/TaxiScreen';

/** What he is saying, appearing word by word as he says it. */
function Caption({ text, chatter }: { text: string; chatter: Chatter | null }) {
  const [shown, setShown] = useState(0);
  useEffect(() => {
    let raf = 0;
    const words = text.split(' ').length;
    const tick = () => {
      const p = chatter?.talk.speaking ? chatter.talk.progress : 1;
      // A little ahead of the voice, the way subtitles are.
      setShown(Math.min(words, Math.ceil(p * words + 2)));
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [text, chatter]);
  return <>{text.split(' ').slice(0, shown).join(' ')}</>;
}

/**
 * The moment of the choice: he has finished, the world has slowed, and three things you could say stand in
 * front of the road with a ring draining round the seconds you have left. Say nothing and it is silence.
 */
function Choice({ offer, onPick }: { offer: Offer; onPick: (line: Offer['lines'][number]) => void }) {
  const [left, setLeft] = useState(CHOICE_SECONDS);
  useEffect(() => {
    const tick = setInterval(() => setLeft(Math.max(0, (offer.until - performance.now()) / 1000)), 100);
    return () => clearInterval(tick);
  }, [offer]);
  const seconds = (offer.until - offer.since) / 1000;
  return (
    <div className={`choice ${offer.irritated ? 'is-irritated' : ''} ${left <= 2 ? 'is-late' : ''}`} key={offer.id} role="dialog" aria-label="Say something">
      <div className="choice-timer" style={{ ['--seconds' as string]: `${seconds}s` }} aria-hidden="true">
        <svg viewBox="0 0 48 48">
          <circle cx="24" cy="24" r="21" className="choice-track" />
          <circle cx="24" cy="24" r="21" className="choice-ring" pathLength={100} />
        </svg>
        <b>{Math.ceil(left)}</b>
      </div>
      <p className="choice-lead">{offer.irritated ? 'He is waiting. Say something, or nothing.' : 'Say something, or let it pass.'}</p>
      <ul className="choice-lines">
        {offer.lines.map((line, i) => (
          <li key={i} style={{ ['--i' as string]: i }}>
            <button type="button" onClick={() => onPick(line)}>
              <kbd>{i + 1}</kbd>
              <span>{line.text}</span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

const km = (m: number) => (Math.abs(m) >= 950 ? `${(m / 1000).toFixed(1).replace('.', ',')} km` : `${Math.round(m / 10) * 10} m`);
const signed = (n: number, unit: string) => `${n > 0 ? '+' : n < 0 ? '−' : '±'}${unit === 'km' ? km(Math.abs(n)) : `${Math.abs(n)}${unit}`}`;

/**
 * What an action came to, floating up from the GPS for a few seconds and gone, in the way of nothing: WIN or
 * LOSE in big letters, what you did, what it did to the road (metres, minutes, euros) and what is still to go.
 * The GPS's own doing (roadworks, again) floats up the same way, with its excuse for a title.
 */
function VerdictToast({ verdict, destination }: { verdict: RideVerdict; destination: string }) {
  const dm = Math.round(verdict.to.metres - verdict.from.metres);
  const dmin = verdict.to.eta - verdict.from.eta;
  const de = Math.round(verdict.to.estimate - verdict.from.estimate);
  const word = verdict.kind === 'win' ? 'WIN' : verdict.kind === 'lose' ? 'LOSE' : 'RECALCUL…';
  const tone = (n: number) => (n < 0 ? 'is-good' : n > 0 ? 'is-bad' : 'is-flat');
  return (
    <div className={`verdict is-${verdict.kind}`} key={verdict.id} role="status" aria-live="polite">
      <p className="verdict-word">{word}</p>
      <p className="verdict-title">{verdict.title}</p>
      <p className="verdict-figures">
        <b className={tone(dm)} style={{ ['--i' as string]: 0 }}>
          {signed(dm, 'km')}
        </b>
        <b className={tone(dmin)} style={{ ['--i' as string]: 1 }}>
          {signed(dmin, ' min')}
        </b>
        <b className={tone(de)} style={{ ['--i' as string]: 2 }}>
          {signed(de, ' €')}
        </b>
      </p>
      <p className="verdict-left">
        {verdict.hint} Still <b>{verdict.to.eta} min</b>, <b>{verdict.to.estimate.toFixed(0)} €</b> to {destination}.
      </p>
    </div>
  );
}

const TIPS = ['0 €', '1 €', '5 €', '20%'];

const LEVEL_WORDS: Record<string, string> = { hostile: 'Hostile', wary: 'Wary', warm: 'Warm', friend: 'A friend', done: 'Out' };

/**
 * The sympathy-o-meter: the one number of the game, on a dial the size of a dinner plate, red to green, with the
 * needle swinging on every verdict and the points it moved by popping off it. Reach the green and he drives you
 * there; hit the peg on the left and you walk.
 */
function Gauge({ value, level, verdict }: { value: number; level: string; verdict: RideVerdict | null }) {
  const angle = -90 + (Math.max(0, Math.min(100, value)) / 100) * 180;
  // The arc, in four bands, as an SVG path per band (a half circle of radius 80 around 100,100).
  const band = (from: number, to: number) => {
    const p = (k: number) => {
      const a = Math.PI * (1 - k);
      return `${100 + 80 * Math.cos(a)},${100 - 80 * Math.sin(a)}`;
    };
    return `M ${p(from)} A 80 80 0 0 1 ${p(to)}`;
  };
  return (
    <div className={`gauge is-${level}`} role="meter" aria-label="Sympathy-o-meter" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(value)} aria-valuetext={LEVEL_WORDS[level] ?? level}>
      <p className="gauge-name">Sympathy-o-meter</p>
      <svg viewBox="0 0 200 112">
        <path d={band(0, 0.2)} className="gauge-band is-hostile" />
        <path d={band(0.2, 0.5)} className="gauge-band is-wary" />
        <path d={band(0.5, 0.8)} className="gauge-band is-warm" />
        <path d={band(0.8, 1)} className="gauge-band is-friend" />
        {[0.2, 0.5, 0.8].map((k) => {
          const a = Math.PI * (1 - k);
          return <line key={k} x1={100 + 68 * Math.cos(a)} y1={100 - 68 * Math.sin(a)} x2={100 + 92 * Math.cos(a)} y2={100 - 92 * Math.sin(a)} className="gauge-tick" />;
        })}
        <g className="gauge-needle" style={{ transform: `rotate(${angle}deg)` }}>
          <path d="M 100 100 L 96 100 L 100 26 L 104 100 Z" />
        </g>
        <circle cx="100" cy="100" r="7" className="gauge-hub" />
      </svg>
      <p className="gauge-level">{LEVEL_WORDS[level] ?? level}</p>
      {verdict && verdict.points !== 0 && (
        <b className={`gauge-delta ${verdict.points > 0 ? 'is-up' : 'is-down'}`} key={verdict.id}>
          {verdict.points > 0 ? '+' : '−'}
          {Math.abs(verdict.points)}
        </b>
      )}
    </div>
  );
}

export function App() {
  const canvas = useRef<HTMLCanvasElement>(null);
  const labels = useRef<HTMLDivElement>(null);
  const game = useRef<Game | null>(null);
  const ui = useUI();
  const [last, setLast] = useState<Place | null>(null);
  const [settings, setSettings] = useState(false);

  useEffect(() => {
    // The drawn look, where the inside of the car and the man at the wheel are, unless another was chosen before.
    let look: Look = 'toon';
    let reopen: Place | null = null;
    try {
      // ?look=real (or blocks) in the address chooses the look and remembers it.
      const asked = new URLSearchParams(location.search).get('look');
      if (asked === 'real' || asked === 'blocks' || asked === 'toon') localStorage.setItem('jev-roads:look', asked);
      const saved = localStorage.getItem('jev-roads:look');
      look = saved === 'real' || saved === 'blocks' ? saved : 'toon';
      // Switching looks reloads the page; come straight back to the same streets.
      reopen = JSON.parse(sessionStorage.getItem('jev-roads:reopen') ?? 'null') as Place | null;
      sessionStorage.removeItem('jev-roads:reopen');
    } catch {
      // Private window: the drawn look, and the title page.
    }
    set({ look });
    const g = new Game(canvas.current!, labels.current!, look);
    game.current = g;
    try {
      if (localStorage.getItem('jev-roads:driver') === 'off') g.setTalking(false);
      if (localStorage.getItem('jev-roads:lang') === 'fr') g.setLang('fr');
      if (localStorage.getItem('jev-roads:driver-sex') === 'f') g.setSex('f');
    } catch {
      // He talks, in English.
    }
    if (reopen) void g.open(reopen);
    try {
      const saved = JSON.parse(localStorage.getItem('jev-roads:place') ?? 'null') as Place | null;
      if (saved && Number.isFinite(saved.lat) && Number.isFinite(saved.lon)) setLast(saved);
    } catch {
      // Nothing remembered.
    }
    // For scripts and the console: jevRoads.open({ name, lat, lon }) builds a place without the map.
    (window as unknown as { jevRoads?: unknown }).jevRoads = { open: (place: Place) => g.open(place), view: g.view, chatter: g.chatter, game: g, route, THREE };
    const wake = () => g.sound.wake();
    window.addEventListener('pointerdown', wake);
    window.addEventListener('keydown', wake);
    return () => {
      window.removeEventListener('pointerdown', wake);
      window.removeEventListener('keydown', wake);
      g.dispose();
      game.current = null;
    };
  }, []);

  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      const typing = document.activeElement instanceof HTMLInputElement;
      if (e.key === 'Escape') {
        (document.activeElement as HTMLElement | null)?.blur();
        return;
      }
      if (typing) return;
      const g = game.current;
      if (!g) return;
      if (e.key === 'v' || e.key === 'V') g.setMode(ui.mode === 'ride' ? 'above' : 'ride');
      else if (e.key === 'j' || e.key === 'J') g.setJev(!ui.jev);
      else if (e.key === 'd' || e.key === 'D') set({ debug: !get().debug });
      else if (e.key === 'm' || e.key === 'M') g.setMuted(!ui.muted);
      else if (e.key === 'g' || e.key === 'G') g.setTalking(!ui.talk.on);
      else if (e.key === 'i' || e.key === 'I' || e.key === ' ') {
        e.preventDefault();
        g.interrupt();
      } else if (e.key === 'n' || e.key === 'N') set({ gps: !get().gps });
      else if (e.key === 'r' || e.key === 'R') g.toggleRadio();
      else if (e.key === 'w' || e.key === 'W') g.toggleWindow();
      else if (e.key >= '1' && e.key <= '3' && ui.ride.offer) {
        const line = ui.ride.offer.lines[Number(e.key) - 1];
        if (line) g.answer(line.text, line.kind, line.lever);
      }
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, [ui.mode, ui.jev, ui.muted, ui.talk.on, ui.ride.offer]);

  const g = game.current;
  const mine = ui.mine;
  const inTaxi = ui.status === 'ready' && Boolean(mine?.taxi) && !ui.choosing && !ui.landing && ui.talk.ready;
  const phase = ui.ride.phase;
  // A verdict floats up for a few seconds; if the road changed, the GPS blinks RECALCUL over the old route, greyed.
  const verdict = ui.ride.verdict && performance.now() - ui.ride.verdict.at < VERDICT_SECONDS * 1000 && (phase === 'riding' || phase === 'quoting') ? ui.ride.verdict : null;
  const moment = Boolean(verdict?.routeChanged);
  const gpsMode: 'big' | 'docked' | null = !inTaxi || phase === 'asking' || phase === 'arrived' || phase === 'ejected' ? null : phase === 'idle' || (phase === 'quoting' && !ui.quoteSeen) || ui.gps ? 'big' : 'docked';
  // The screen comes down by itself once he has named his price, or six seconds after the quote, or at a click.
  const prevPhase = useRef(ui.ride.phase);
  useEffect(() => {
    if (prevPhase.current === 'quoting' && ui.ride.phase === 'riding') set({ gps: false });
    if (ui.ride.phase === 'idle' || ui.ride.phase === 'asking') set({ quoteSeen: false, gps: false });
    prevPhase.current = ui.ride.phase;
    if (ui.ride.phase !== 'quoting') return;
    const t = setTimeout(() => set({ quoteSeen: true }), 6500);
    return () => clearTimeout(t);
  }, [ui.ride.phase]);
  const closeGps = () => set({ gps: false, quoteSeen: true });
  // A word for what the finger is over in the cabin.
  const hint =
    ui.hover === 'radio'
      ? ui.ride.radio.on
        ? `Radio: ${ui.ride.radio.station}${ui.ride.radio.his ? ', his station' : ''}. Click to change it`
        : 'His radio. Click to switch it on'
      : ui.hover === 'window'
        ? `Your window is ${ui.ride.window}. Click to wind it ${ui.ride.window === 'up' ? 'down' : 'up'}`
        : ui.hover === 'gps'
          ? 'His screen. Click for the map'
          : ui.hover === 'driver'
            ? 'Click him to cut him off'
            : ui.caption
              ? 'Click the road to cut him off'
              : '';
  const go = (place: Place) => {
    setLast(place);
    void g?.open(place);
  };

  return (
    <main className={`app is-${ui.mode}`}>
      <canvas ref={canvas} className={`scene ${ui.caption && ui.mode === 'ride' && (phase === 'riding' || phase === 'quoting') ? 'is-talking' : ''} ${ui.ride.offer && phase === 'riding' ? 'is-slow' : ''}`} />
      <div ref={labels} className="bubbles" aria-hidden="true" />

      {ui.landing && <Landing places={PLACES} last={last} driver={{ ready: ui.talk.ready, lang: ui.talk.lang, sex: ui.talk.sex }} jev={ui.configured && !ui.stats.noCredit} onLang={(lang) => g?.setLang(lang)} onSex={(sex) => g?.setSex(sex)} onKey={(key) => g?.setTypesafeKey(key)} onGo={go} onMap={() => set({ landing: false, choosing: true })} />}
      {ui.choosing && !ui.landing && <MapPicker places={PLACES} last={last} canClose={ui.cars > 0} onBuild={go} onClose={() => set({ choosing: false })} />}

      <header className="place" hidden={ui.choosing || ui.landing}>
        <button className="place-name" onClick={() => set({ choosing: true })} title="Choose another place on the map">
          {ui.place || 'Choose a place'}
        </button>
        {ui.status === 'ready' && ui.built < 1 && <p className="place-note">The town still rising ({Math.round(ui.built * 9)} of 9 parts)</p>}
        {ui.status === 'ready' && ui.message && <p className="notice" role="status">{ui.message}</p>}
        {ui.status === 'ready' && ui.talk.on && ui.talk.error && (
          <p className="notice" role="alert">
            The driver has gone quiet: {ui.talk.error}
          </p>
        )}
      </header>

      {inTaxi && <Gauge value={ui.ride.sympathie} level={ui.ride.level} verdict={verdict} />}

      <button type="button" className="gear" aria-pressed={settings} aria-label="Settings" title="Settings" hidden={ui.choosing || ui.landing} onClick={() => setSettings((v) => !v)}>
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M12 8.5a3.5 3.5 0 1 0 0 7 3.5 3.5 0 0 0 0-7Zm8.6 3.5c0-.5 0-1-.1-1.4l2-1.6-2-3.4-2.4 1a8 8 0 0 0-2.4-1.4L15.3 2h-4l-.4 2.6a8 8 0 0 0-2.4 1.4l-2.4-1-2 3.4 2 1.6a8 8 0 0 0 0 2.8l-2 1.6 2 3.4 2.4-1a8 8 0 0 0 2.4 1.4l.4 2.6h4l.4-2.6a8 8 0 0 0 2.4-1.4l2.4 1 2-3.4-2-1.6c.1-.4.1-.9.1-1.4Z" />
        </svg>
      </button>

      <nav className={`switches ${settings ? '' : 'is-closed'}`} aria-label="Settings" hidden={ui.choosing || ui.landing}>
        <button type="button" className="switches-place" onClick={() => set({ choosing: true })}>
          Change place
        </button>
        <div className="segment" role="group" aria-label="Look">
          {(['blocks', 'real', 'toon'] as const).map((look) => (
            <button
              key={look}
              aria-pressed={ui.look === look}
              onClick={() => {
                if (ui.look === look) return;
                // Real and toon are one renderer with a different finish: no reload between them.
                if (ui.look !== 'blocks' && look !== 'blocks') {
                  g?.view.setToon?.(look === 'toon');
                  set({ look });
                  try {
                    localStorage.setItem('jev-roads:look', look);
                  } catch {
                    // Not remembered, that is all.
                  }
                  return;
                }
                try {
                  localStorage.setItem('jev-roads:look', look);
                  if (last) sessionStorage.setItem('jev-roads:reopen', JSON.stringify(last));
                } catch {
                  // Nothing remembered: the map will ask again.
                }
                location.reload();
              }}
            >
              {look === 'blocks' ? 'Blocks' : look === 'real' ? 'Real' : 'Toon'}
            </button>
          ))}
        </div>
        <div className="segment" role="group" aria-label="Camera">
          <button aria-pressed={ui.mode === 'ride'} onClick={() => g?.setMode('ride')}>Ride</button>
          <button aria-pressed={ui.mode === 'above'} onClick={() => g?.setMode('above')}>Above</button>
        </div>
        <button className="toggle" aria-pressed={ui.jev} disabled={!ui.configured} onClick={() => g?.setJev(!ui.jev)} title={ui.configured ? 'Switch the drivers’ judgment on and off' : 'Add TYPESAFE_API_KEY to .env'}>
          Jev {ui.jev ? 'on' : 'off'}
        </button>
        <button className="toggle" aria-pressed={ui.talk.on && ui.talk.ready} disabled={!ui.talk.ready} onClick={() => g?.setTalking(!ui.talk.on)} title={ui.talk.ready ? `${ui.talk.who}, ${ui.talk.from || 'your driver'}. Let him talk, or make him sulk` : 'He needs a Google Cloud login: gcloud auth application-default login'}>
          {ui.talk.who} {ui.talk.on && ui.talk.ready ? 'talks' : 'sulks'}
        </button>
        {ui.talk.ready && (
          <div className="segment" role="group" aria-label="The driver speaks">
            <button aria-pressed={ui.talk.lang === 'en'} onClick={() => g?.setLang('en')} title="English, the way Marseille speaks it">EN</button>
            <button aria-pressed={ui.talk.lang === 'fr'} onClick={() => g?.setLang('fr')} title="Français, avec l’accent">FR</button>
          </div>
        )}
        <div className="events" role="group" aria-label="Make something happen" hidden={ui.status !== 'ready'}>
          <button onClick={() => g?.setDensity(ui.density + 0.25)} disabled={ui.density >= 2.5}>More cars</button>
          <button onClick={() => g?.setDensity(ui.density - 0.25)} disabled={ui.density <= 0.25}>Fewer cars</button>
          <button aria-pressed={ui.rush} onClick={() => g?.setRush(!ui.rush)}>Rush hour</button>
          <button aria-pressed={ui.weather === 'rain'} onClick={() => g?.setSky(ui.time, ui.weather === 'rain' ? 'clear' : 'rain')}>Rain</button>
          <button aria-pressed={ui.time === 'night'} onClick={() => g?.setSky(ui.time === 'night' ? 'midday' : 'night', ui.weather)}>Night</button>
          <button onClick={() => g?.breakDown()}>Breakdown</button>
          <button onClick={() => g?.ambulance()}>Ambulance</button>
        </div>
        <p className="switches-note">{ui.cars} drivers, {ui.jev && !ui.stats.noCredit ? 'each one deciding with Jev' : 'all on fixed habits'}{ui.jev && ui.stats.noCredit ? ' (the TypeSafe account is out of credits)' : ''}</p>
      </nav>

      {ui.status !== 'ready' && !ui.choosing && !ui.landing && (
        <section className={`curtain ${ui.status === 'error' ? 'is-error' : ''}`} role="status">
          <p>{ui.message}</p>
          {ui.status === 'error' && <button onClick={() => set({ choosing: true })}>Choose another place</button>}
        </section>
      )}
      {ui.status === 'ready' && ui.built < 1 && !ui.choosing && <div className="progress" style={{ transform: `scaleX(${Math.max(0.04, ui.built)})` }} />}

      {ui.caption && ui.mode === 'ride' && !ui.choosing && (
        <p className="caption" key={ui.caption.id} data-mood={ui.caption.mood} data-speaker={ui.caption.speaker} role="status">
          <b>{ui.caption.speaker === 'other' ? 'The other passenger' : ui.talk.who}</b>
          <Caption text={ui.caption.text} chatter={g?.chatter ?? null} />
        </p>
      )}

      {gpsMode && g?.frame && <TaxiScreen frame={g.frame} ride={ui.ride} mode={gpsMode} moment={moment} taxi={() => g.taxiAt()} favourites={ui.destinations.slice(0, 6)} onPick={(x, z) => g.startRideAt(x, z)} onFavourite={(d) => g.startRide(d)} onClose={closeGps} />}

      {inTaxi && verdict && <VerdictToast verdict={verdict} destination={ui.ride.destination} />}
      {inTaxi && ui.ride.offer && phase === 'riding' && <Choice offer={ui.ride.offer} onPick={(line) => g?.answer(line.text, line.kind, line.lever)} />}

      {inTaxi && (
        <section className={`ride is-${ui.ride.phase}`} aria-label="Your ride">
          {ui.ride.phase === 'refusing' && (
            <div className="ride-row">
              <button type="button" className="ride-insist" onClick={() => g?.insist()}>
                I insist, let me out
              </button>
              <span className="ride-meter">
                <em>He will not let you out.</em>
              </span>
            </div>
          )}
          {(ui.ride.phase === 'riding' || ui.ride.phase === 'quoting') && !ui.ride.offer && (hint || ui.ride.note) && (
            <p className={`ride-hint ${ui.hover ? 'is-over' : ''}`} role="status">
              {ui.hover || !ui.ride.note ? hint : ui.ride.note}
            </p>
          )}
          {(ui.ride.phase === 'arrived' || ui.ride.phase === 'ejected') && (
            <div className={`ride-end is-${ui.ride.phase === 'ejected' ? 'lose' : 'win'}`}>
              <p className="verdict-word">{ui.ride.phase === 'ejected' ? 'YOU LOSE' : ui.ride.score && ui.ride.score.minutes < ui.ride.score.promised ? 'YOU WIN' : 'ARRIVED'}</p>
              <h2>
                {ui.ride.phase === 'ejected'
                  ? `He has stopped. You are getting out here, ${(ui.ride.metres / 1000).toFixed(1).replace('.', ',')} km from ${ui.ride.destination}.`
                  : ui.ride.score && ui.ride.score.minutes < ui.ride.score.promised
                    ? `${ui.ride.destination}, ${Math.round(ui.ride.score.promised - ui.ride.score.minutes)} minutes before his GPS said.`
                    : `${ui.ride.destination}, at last.`}
              </h2>
              {ui.ride.score && (
                <div className="ride-score" role="group" aria-label="Your time">
                  <div>
                    <b>{ui.ride.score.minutes.toFixed(1).replace('.', ',')}</b>
                    <span>minutes</span>
                  </div>
                  <div>
                    <b>{ui.ride.score.promised}</b>
                    <span>he promised</span>
                  </div>
                  <div>
                    <b>{ui.ride.score.best === null ? '—' : ui.ride.score.best.toFixed(1).replace('.', ',')}</b>
                    <span>best here</span>
                  </div>
                </div>
              )}
              <p>
                {ui.ride.meterCut ? <>He cut the meter: <strong>it’s on him</strong>. A tip, all the same?</> : <>The meter says <strong>{ui.ride.fare.toFixed(2).replace('.', ',')} €</strong>{ui.ride.phase === 'ejected' ? ', for nowhere' : ''}. A tip?</>}
              </p>
              <div className="segment" role="group" aria-label="Tip">
                {TIPS.map((t) => (
                  <button key={t} type="button" onClick={() => g?.tip(t)}>
                    {t}
                  </button>
                ))}
              </div>
              <small>He will remember.</small>
            </div>
          )}
        </section>
      )}

      {ui.status === 'ready' && ui.mode === 'above' && !ui.choosing && <p className="hint">Click any car to ride in it</p>}

      {ui.debug && (
        <aside className="debug" aria-label="Jev activity">
          <p className="debug-stats">
            <span>{ui.stats.requests} requests</span>
            <span>{ui.stats.questions} questions</span>
            <span>{Math.round(ui.stats.latency)} ms</span>
            <span>${(ui.stats.tokens * PRICE).toFixed(4)}</span>
            <span>{ui.fps} fps</span>
          </p>
          {ui.stats.error && <p className="debug-error">{ui.stats.error}</p>}
          {ui.talk.last && <p className="debug-stats"><span>the driver: {ui.talk.last}</span></p>}
          {ui.talk.error && <p className="debug-error">the driver: {ui.talk.error}</p>}
          <ol>
            {ui.verdicts.slice(0, 16).map((v) => (
              <li key={v.id} data-mine={v.mine}>
                <span>{v.who}</span> {v.text} <em>{Math.round(v.p * 100)}%</em>
              </li>
            ))}
          </ol>
        </aside>
      )}
      {!ui.choosing && !ui.landing && <p className="keys">Click the radio, your window, his screen, or him. Space cuts him off, 1-3 answer, R radio, W window, N map, V view, M sound</p>}
    </main>
  );
}
