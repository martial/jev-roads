// The taxi's own screen: Google Maps by default, with OpenStreetMap available in settings,
// dressed as a GPS of a certain age. It fills the view while you choose an address and while he names his price,
// then docks flat in the corner for the whole ride, where the route stays in view: the whole of it, so that its
// length is never in doubt. Every time the GPS "recalculates" (his mood moved, or "roadworks") it fills the view
// again for a moment: the old route greyed under the new, RECALCUL blinking, and the minutes and the euros, before
// and after, in figures too big to miss. Under the map, every ETA it has ever announced, struck through one by one.

import { money, distance, isUK } from '../edition';
import { useState } from 'react';
import { useUI } from '../store';
import { OsmTaxiMap } from './OsmTaxiMap';
import { GoogleTaxiMap } from './GoogleTaxiMap';
import type { Network } from '../city/network';
import type { RideView } from '../sim/ride';

export interface Frame {
  place: { lat: number; lon: number };
  net: Network;
}

const euros = money;
const km = distance;

interface Props {
  frame: Frame;
  ride: RideView;
  /** Filling the view, or flat in the corner. */
  mode: 'big' | 'docked';
  /** The big recalculation is on: the moment lasts a few seconds. */
  moment: boolean;
  /** Where the taxi is and which way it faces, read live. */
  taxi: () => { x: number; z: number; dx: number; dz: number } | null;
  onPick: (x: number, z: number) => string | null;
  /** The places the town names, for those who would rather not read a map. */
  favourites: string[];
  onFavourite: (label: string) => void;
  onClose: () => void;
}

export type TaxiMapProps = Pick<Props, 'frame' | 'ride' | 'mode' | 'taxi' | 'onPick'> & { setStatus: (value: string) => void; setCalculating: (value: boolean) => void };

export function TaxiScreen({ frame, ride, mode, moment, taxi, onPick, favourites, onFavourite, onClose }: Props) {
  const { mapProvider } = useUI();
  const [status, setStatus] = useState(ride.phase === 'idle' ? 'Touch the map' : '');
  const [calculating, setCalculating] = useState(false);
  const MapCanvas = mapProvider === 'google' ? GoogleTaxiMap : OsmTaxiMap;
  const riding = ride.phase !== 'idle' && ride.phase !== 'asking';
  const trail = ride.etas.slice(-7);
  return (
    <section className={`gps is-${mode} ${moment ? 'is-moment' : ''} ${moment && ride.verdict ? `is-${ride.verdict.kind}` : ''}`} aria-label="The taxi’s screen">
      <div className="gps-bezel">
        <MapCanvas frame={frame} ride={ride} mode={mode} taxi={taxi} onPick={onPick} setStatus={setStatus} setCalculating={setCalculating} />
        {moment && <p className="gps-recalc">{isUK() ? 'REROUTING…' : 'RECALCUL…'}</p>}
        <div className="gps-strip">
          {!riding ? (
            <span className="gps-status">{status}</span>
          ) : (
            <>
              <span className="gps-status">{calculating ? (isUK() ? 'REROUTING…' : 'RECALCUL…') : mode === 'docked' ? `${ride.eta} MIN` : ride.destination.toUpperCase()}</span>
              <span className="gps-figures">
                {mode === 'big' && `${km(ride.metres)}${ride.stops > 0 ? ` · ${ride.stops} STOP${ride.stops > 1 ? 'S' : ''}` : ''} · `}
                {ride.meterCut ? (isUK() ? 'METER OFF' : 'COMPTEUR COUPÉ') : `${mode === 'big' ? 'EST. ' : ''}${euros(ride.estimate)}`}
              </span>
            </>
          )}
        </div>
        {riding && mode === 'big' && (
          <p className="gps-trail" aria-label="Every arrival time the GPS has promised">
            <span>ARRIVAL IN</span>
            {trail.map((eta, i) => (i < trail.length - 1 ? <s key={i}>{eta}</s> : <b key={i}>{eta} MIN</b>))}
            {ride.etas.length > 1 && <i>recalculated {ride.etas.length - 1}×</i>}
          </p>
        )}
        {ride.phase === 'idle' && (
          <div className="gps-hint">
            <p>
              <b>Where to?</b> Touch a street on the map, or:
            </p>
            <small>Not that it matters much: he goes his own way round the town until he likes you.</small>
            <div className="gps-favourites">
              {favourites.map((d) => (
                <button key={d} type="button" onClick={() => onFavourite(d)}>
                  {d}
                </button>
              ))}
            </div>
          </div>
        )}
        {riding && mode === 'big' && !moment && (
          <button type="button" className="gps-close" onClick={onClose} title="Back to the road (N)">
            ✕
          </button>
        )}
      </div>
    </section>
  );
}
