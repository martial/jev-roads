// The title page. One loud thing: a taximeter that is already running while you make up your mind. The
// places to start from are French town-entry signs, because that is what arriving somewhere looks like here.

import { useEffect, useState } from 'react';
import type { Lang, Sex } from '../../shared/driver';
import type { Place } from '../game';
import { useUI } from '../store';

// Seven segments, as on every meter since 1975: a top, b top right, c bottom right, d bottom, e bottom left, f top left, g middle.
const LIT: Record<string, string> = { '0': 'abcdef', '1': 'bc', '2': 'abged', '3': 'abgcd', '4': 'fgbc', '5': 'afgcd', '6': 'afgecd', '7': 'abc', '8': 'abcdefg', '9': 'abfgcd', ' ': '' };
const across = (y: number) => `2.4,${y} 3.4,${y - 1} 8.6,${y - 1} 9.6,${y} 8.6,${y + 1} 3.4,${y + 1}`;
const down = (x: number, y1: number, y2: number) => `${x},${y1} ${x + 1},${y1 + 1} ${x + 1},${y2 - 1} ${x},${y2} ${x - 1},${y2 - 1} ${x - 1},${y1 + 1}`;
const SHAPES: Record<string, string> = { a: across(2), g: across(10), d: across(18), f: down(1.8, 2.5, 9.5), b: down(10.2, 2.5, 9.5), e: down(1.8, 10.5, 17.5), c: down(10.2, 10.5, 17.5) };

function Digits({ value, small = false }: { value: string; small?: boolean }) {
  return (
    <span className={`led ${small ? 'is-small' : ''}`} aria-hidden="true">
      {[...value].map((ch, i) =>
        ch === ',' ? (
          <svg key={i} viewBox="0 0 4 20" className="led-comma">
            <rect x="0.8" y="16.6" width="2.4" height="2.4" className="on" />
          </svg>
        ) : (
          <svg key={i} viewBox="0 0 12 20">
            {Object.entries(SHAPES).map(([name, points]) => (
              <polygon key={name} points={points} className={LIT[ch]?.includes(name) ? 'on' : undefined} />
            ))}
          </svg>
        ),
      )}
    </span>
  );
}

// What the meter finds to charge for while you are still on this page.
const SUPPLEMENTS: Array<[string, number]> = [['Reading the tariff', 1.5], ['Hesitating', 0.8], ['Looking at the signs', 1.2], ['Thinking about the sea', 2], ['Still here', 0.6], ['Comparing towns', 1.1], ['Breathing the air', 0.9]];
const euros = (n: number) => n.toFixed(2).replace('.', ',');

function Meter() {
  const [fare, setFare] = useState(4.1);
  const [extra, setExtra] = useState(0);
  const [note, setNote] = useState('The meter is already running.');

  useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    let ticks = 0;
    const timer = setInterval(() => {
      ticks++;
      setFare((f) => Math.min(999.9, f + 0.1));
      if (ticks % 9 !== 0) return;
      const [label, amount] = SUPPLEMENTS[(ticks / 9 - 1) % SUPPLEMENTS.length];
      setFare((f) => Math.min(999.9, f + amount));
      setExtra((e) => e + amount);
      setNote(`${label}: +${euros(amount)} €`);
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  return (
    <div className="taximeter" role="img" aria-label="A taximeter, already running and adding supplements while you read">
      <div className="taximeter-main">
        <Digits value={euros(fare).padStart(6, ' ')} />
        <span className="taximeter-unit">€</span>
      </div>
      <dl className="taximeter-windows" aria-hidden="true">
        <div>
          <dt>Tarif</dt>
          <dd className="led-letter">C</dd>
        </div>
        <div>
          <dt>Suppléments</dt>
          <dd>
            <Digits small value={euros(extra).padStart(5, ' ')} />
          </dd>
        </div>
      </dl>
      <p className="taximeter-note" key={note}>
        {note}
      </p>
    </div>
  );
}

/** "Place de l’Étoile, Paris" reads PARIS on the sign, with the spot underneath. */
function signOf(place: Place): { town: string; spot: string } {
  const parts = place.name.split(',').map((s) => s.trim());
  return parts.length > 1 ? { town: parts[parts.length - 1], spot: parts.slice(0, -1).join(', ') } : { town: parts[0], spot: '' };
}

interface Props {
  places: Place[];
  last: Place | null;
  driver: { ready: boolean; lang: Lang; sex: Sex };
  /** The other drivers already think (a key is on the server, or was typed here). */
  jev: boolean;
  onLang: (lang: Lang) => void;
  onSex: (sex: Sex) => void;
  onKey: (key: string) => void;
  onGo: (place: Place) => void;
  onMap: () => void;
}

export function Landing({ places, last, driver, jev, onLang, onSex, onKey, onGo, onMap }: Props) {
  const { mapProvider } = useUI();
  const [key, setKey] = useState('');
  const [given, setGiven] = useState(false);
  const signs = last && !places.some((p) => p.lat === last.lat && p.lon === last.lon) ? [last, ...places] : places;
  return (
    <section className="landing" aria-label="Enjoy the French driving experience">
      <p className="landing-brand">
        <b>Jev Roads</b> Enjoy the French driving experience
      </p>
      <Meter />

      <div className="landing-main">
        <h1>
          His GPS says <span className="landing-thirty">30&nbsp;min.</span>
        </h1>
        <p className="landing-dare">Would you arrive before?</p>

        <ul className="signs" aria-label="Where to?">
          {signs.map((place) => {
            const sign = signOf(place);
            return (
              <li key={`${place.lat},${place.lon}`}>
                <button type="button" className="sign" onClick={() => onGo(place)}>
                  <strong>{sign.town}</strong>
                  {sign.spot && <span>{sign.spot}</span>}
                </button>
              </li>
            );
          })}
        </ul>
        <button type="button" className="landing-map" onClick={onMap}>
          {mapProvider === 'google' ? 'Explore with Google Maps' : 'Or anywhere in the world'}
        </button>
        {mapProvider === 'google' && <p className="landing-world-note">Choose your streets. Meet your driver.</p>}

        <div className="landing-voice">
          <div className="segment" role="group" aria-label="Your driver">
            <button type="button" aria-pressed={driver.sex === 'm'} onClick={() => onSex('m')}>
              A man
            </button>
            <button type="button" aria-pressed={driver.sex === 'f'} onClick={() => onSex('f')}>
              A woman
            </button>
          </div>
          <div className="segment" role="group" aria-label="Speaking">
            <button type="button" aria-pressed={driver.lang === 'en'} onClick={() => onLang('en')}>
              English
            </button>
            <button type="button" aria-pressed={driver.lang === 'fr'} onClick={() => onLang('fr')}>
              Français
            </button>
          </div>
        </div>
        {!driver.ready && <p className="landing-quiet">No Google Cloud login on this machine: your driver will be silent.</p>}
      </div>

      <footer className="landing-foot">
        {given ? (
          <p className="landing-key-ok">TypeSafe key taken, for this visit only.</p>
        ) : (
          <details className="landing-key">
            <summary>{jev ? 'Another TypeSafe key' : 'A TypeSafe key'}</summary>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                if (!key.trim()) return;
                onKey(key);
                setGiven(true);
                setKey('');
              }}
            >
              <input type="password" value={key} onChange={(e) => setKey(e.target.value)} placeholder="ts-…" autoComplete="off" spellCheck={false} aria-label="TypeSafe key" />
              <button type="submit">Use it</button>
            </form>
            <small>Kept in memory for this visit, never stored.</small>
          </details>
        )}
        <small>Streets © OpenStreetMap contributors</small>
      </footer>
    </section>
  );
}
