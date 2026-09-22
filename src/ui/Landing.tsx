// The title page. One loud thing: a taximeter that is already running while you make up your mind. The
// places to start from are French town-entry signs, because that is what arriving somewhere looks like here.

import { useEffect, useState } from 'react';
import type { Lang, Sex } from '../../shared/driver';
import type { Place } from '../game';

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
  const [key, setKey] = useState('');
  const [given, setGiven] = useState(false);
  const signs = last && !places.some((p) => p.lat === last.lat && p.lon === last.lon) ? [last, ...places] : places;
  return (
    <section className="landing" aria-label="Enjoy the French driving experience">
      <div className="landing-road" aria-hidden="true" />
      <div className="landing-main">
        <p className="landing-brand">Jev Roads · Enjoy the French driving experience</p>
        <h1>
          His GPS says <span className="landing-thirty">30 min.</span>
          <em>Would you arrive before?</em>
        </h1>
        <p className="landing-lede">
          Pick a town. We build its real streets and sit you in the front seat of a taxi, next to a driver invented for the place: opinions on every street, a radio of his own, and a
          thirty-minute road to a four-minute address. Make him like you and the stops fall away. Annoy him and they come back. The meter, meanwhile, only goes one way.
        </p>
        <ol className="landing-rules" aria-label="How to play">
          <li>
            <b>Let him talk.</b> Answer when he asks. Agree with him, once. Ask what he thinks.
          </li>
          <li>
            <b>Or don’t.</b> Click him to cut him off. Touch his radio. Open your window. Watch the road grow.
          </li>
          <li>
            <b>Arrive.</b> Before his thirty minutes, if you can. At zero sympathy, you walk.
          </li>
        </ol>

        <h2>Where to?</h2>
        <ul className="signs">
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
          Or anywhere else in the world, on the map
        </button>

        <div className="landing-voice">
          <span id="landing-driver">Your driver</span>
          <div className="segment" role="group" aria-labelledby="landing-driver">
            <button type="button" aria-pressed={driver.sex === 'm'} onClick={() => onSex('m')}>
              A man
            </button>
            <button type="button" aria-pressed={driver.sex === 'f'} onClick={() => onSex('f')}>
              A woman
            </button>
          </div>
          <span id="landing-voice">speaks</span>
          <div className="segment" role="group" aria-labelledby="landing-voice">
            <button type="button" aria-pressed={driver.lang === 'en'} onClick={() => onLang('en')}>
              English, their way
            </button>
            <button type="button" aria-pressed={driver.lang === 'fr'} onClick={() => onLang('fr')}>
              Français
            </button>
          </div>
        </div>
        {!given && (
          <form
            className="landing-key"
            onSubmit={(e) => {
              e.preventDefault();
              if (!key.trim()) return;
              onKey(key);
              setGiven(true);
              setKey('');
            }}
          >
            <label htmlFor="landing-key">{jev ? 'Another TypeSafe key, if the one on the server is out of credits' : 'A TypeSafe key, for the other drivers to think'}</label>
            <div>
              <input id="landing-key" type="password" value={key} onChange={(e) => setKey(e.target.value)} placeholder="ts-…" autoComplete="off" spellCheck={false} />
              <button type="submit">Use it</button>
            </div>
            <small>Optional. Kept in memory for this visit only, never stored, sent only to the dev server on this machine.</small>
          </form>
        )}
        {given && <p className="landing-key-ok">Key taken: every driver in town now decides with Jev. It is forgotten when you close the tab.</p>}
      </div>

      <aside className="landing-side">
        <Meter />
        <div className="tariff">
          <h2>The tariff</h2>
          <dl>
            {[
              ['Pickup', '4,10 €'],
              ['Per kilometre', 'changes without notice'],
              ['Sea view supplement', '4,00 €'],
              ['Conversation supplement', '3,00 €'],
              ['Silence', 'not available'],
              ['Petrol', 'not included, nearly gone'],
            ].map(([what, price]) => (
              <div key={what}>
                <dt>{what}</dt>
                <dd>{price}</dd>
              </div>
            ))}
          </dl>
        </div>
        <p className="landing-small">
          {driver.ready
            ? 'The driver is invented on the spot for the town you pick, written by Gemini and spoken by a Google voice. So are the in-laws and the opinions. Streets © OpenStreetMap contributors.'
            : 'No Google Cloud login was found on this machine, so your driver will sulk in silence. Run gcloud auth application-default login and he will find his voice. Streets © OpenStreetMap contributors.'}
        </p>
      </aside>
    </section>
  );
}
