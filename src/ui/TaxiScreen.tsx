// The taxi's own screen: the real map of the kilometre that was built (OpenStreetMap tiles, as the picker uses),
// dressed as a GPS of a certain age. It fills the view while you choose an address and while he names his price,
// then docks flat in the corner for the whole ride, where the route stays in view: the whole of it, so that its
// length is never in doubt. Every time the GPS "recalculates" (his mood moved, or "roadworks") it fills the view
// again for a moment: the old route greyed under the new, RECALCUL blinking, and the minutes and the euros, before
// and after, in figures too big to miss. Under the map, every ETA it has ever announced, struck through one by one.

import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { useEffect, useRef, useState } from 'react';
import type { Network } from '../city/network';
import { SIZE } from '../city/osm';
import type { RideView } from '../sim/ride';

export interface Frame {
  place: { lat: number; lon: number };
  net: Network;
}

/** The town's flat metres back to the globe: the inverse of what `parseOsm` does. */
function unproject(frame: Frame, x: number, z: number): [number, number] {
  const kx = 111320 * Math.cos((frame.place.lat * Math.PI) / 180);
  return [frame.place.lat - (z - SIZE / 2) / 111320, frame.place.lon + (x - SIZE / 2) / kx];
}

function project(frame: Frame, lat: number, lon: number): [number, number] {
  const kx = 111320 * Math.cos((frame.place.lat * Math.PI) / 180);
  return [(lon - frame.place.lon) * kx + SIZE / 2, -(lat - frame.place.lat) * 111320 + SIZE / 2];
}

function pointsOf(frame: Frame, lanes: number[]): [number, number][] {
  const points: [number, number][] = [];
  for (const id of lanes) {
    const lane = frame.net.lanes[id];
    if (!lane) continue;
    for (const [x, z] of lane.points) points.push(unproject(frame, x, z));
  }
  return points;
}

const euros = (n: number) => n.toFixed(2).replace('.', ',');
const km = (m: number) => (m >= 950 ? `${(m / 1000).toFixed(1).replace('.', ',')} km` : `${Math.round(m / 10) * 10} m`);

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

export function TaxiScreen({ frame, ride, mode, moment, taxi, onPick, favourites, onFavourite, onClose }: Props) {
  const holder = useRef<HTMLDivElement>(null);
  const map = useRef<L.Map | null>(null);
  const line = useRef<L.Polyline | null>(null);
  const ghost = useRef<L.Polyline | null>(null);
  const marker = useRef<L.Marker | null>(null);
  const flag = useRef<L.CircleMarker | null>(null);
  const pins = useRef<L.Marker[]>([]);
  const [status, setStatus] = useState(ride.phase === 'idle' ? 'Touch the map' : '');
  const [calculating, setCalculating] = useState(false);
  const drawing = useRef(0);

  useEffect(() => {
    const centre = unproject(frame, SIZE / 2, SIZE / 2);
    const m = L.map(holder.current!, { center: centre, zoom: 16, minZoom: 14, maxZoom: 18, zoomControl: false, attributionControl: false, maxBounds: [unproject(frame, -100, SIZE + 100), unproject(frame, SIZE + 100, -100)], maxBoundsViscosity: 1 });
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, className: 'gps-tiles' }).addTo(m);
    // The edge of what was built: beyond it there is nothing to drive on.
    L.rectangle([unproject(frame, 0, SIZE), unproject(frame, SIZE, 0)], { color: '#f2c230', weight: 1, dashArray: '6 6', fill: false, interactive: false }).addTo(m);
    marker.current = L.marker(centre, { icon: L.divIcon({ className: 'gps-taxi', html: '<i></i>', iconSize: [22, 22], iconAnchor: [11, 11] }), interactive: false }).addTo(m);
    m.on('click', (e: L.LeafletMouseEvent) => {
      const [x, z] = project(frame, e.latlng.lat, e.latlng.lng);
      const label = onPick(x, z);
      setStatus(label ? `${label.toUpperCase()}` : 'NO ROUTE HERE');
    });
    map.current = m;
    return () => {
      m.remove();
      map.current = null;
    };
    // The map is made once for a place.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [frame]);

  /** Everything of the route in view, whatever size the screen is. */
  const fit = (animate: boolean) => {
    const m = map.current;
    const poly = line.current;
    if (!m) return;
    const points = poly?.getLatLngs() as L.LatLng[] | undefined;
    const bounds = points && points.length > 1 ? L.latLngBounds(points) : null;
    const at = taxi();
    if (at && bounds) bounds.extend(unproject(frame, at.x, at.z));
    if (bounds) m.fitBounds(bounds.pad(mode === 'docked' ? 0.08 : 0.2), { animate, maxZoom: 17 });
  };

  // The route, drawn again street by street each time the GPS thinks again; the old one stays, greyed, for the moment.
  useEffect(() => {
    const m = map.current;
    if (!m) return;
    line.current?.remove();
    flag.current?.remove();
    ghost.current?.remove();
    for (const pin of pins.current) pin.remove();
    pins.current = [];
    line.current = flag.current = ghost.current = null;
    if (!ride.routeLanes.length) return;
    const points = pointsOf(frame, ride.routeLanes);
    if (!points.length) return;
    const v = ride.verdict;
    const old = v && v.routeChanged && performance.now() - v.at < 8000 ? pointsOf(frame, v.previousLanes) : [];
    if (old.length > 1) ghost.current = L.polyline(old, { color: v?.kind === 'win' ? '#ff5a48' : '#c9ccd1', weight: 4, opacity: 0.6, dashArray: '2 8', interactive: false }).addTo(m);
    flag.current = L.circleMarker(points[points.length - 1], { radius: 7, color: '#f2c230', weight: 3, fillColor: '#1b1d21', fillOpacity: 1, interactive: false }).addTo(m);
    // The stops of his tour, numbered: the address comes after all of them.
    ride.stopLanes.forEach((id, i) => {
      const lane = frame.net.lanes[id];
      if (!lane) return;
      const [x, z] = lane.points[Math.floor(lane.points.length / 2)];
      pins.current.push(L.marker(unproject(frame, x, z), { icon: L.divIcon({ className: 'gps-stop', html: `<i>${i + 1}</i>`, iconSize: [22, 22], iconAnchor: [11, 11] }), interactive: false }).addTo(m));
    });
    const poly = L.polyline([], { color: '#f2c230', weight: 5, opacity: 0.95, interactive: false }).addTo(m);
    line.current = poly;
    // Wiped and redrawn over a second and a half, the way the old ones did it.
    const token = ++drawing.current;
    setCalculating(true);
    const t0 = performance.now();
    const step = () => {
      if (token !== drawing.current) return;
      const k = Math.min(1, (performance.now() - t0) / 1500);
      poly.setLatLngs(points.slice(0, Math.max(2, Math.ceil(points.length * k))));
      if (k < 1) requestAnimationFrame(step);
      else setCalculating(false);
    };
    requestAnimationFrame(step);
    const all = old.length > 1 ? [...points, ...old] : points;
    m.fitBounds(L.latLngBounds(all).pad(mode === 'docked' ? 0.08 : 0.2), { animate: true, maxZoom: 17 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ride.recalc, ride.routeLanes.length, frame]);

  // The screen changes size when it docks: the map must be told, and shown the whole route again.
  useEffect(() => {
    const m = map.current;
    if (!m) return;
    const t = setTimeout(() => {
      m.invalidateSize({ animate: false });
      fit(false);
    }, 320);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode]);

  // The taxi, live.
  useEffect(() => {
    let raf = 0;
    const tick = () => {
      const at = taxi();
      const mk = marker.current;
      if (at && mk) {
        mk.setLatLng(unproject(frame, at.x, at.z));
        const el = mk.getElement()?.firstElementChild as HTMLElement | null;
        if (el) el.style.transform = `rotate(${Math.atan2(at.dx, -at.dz) * (180 / Math.PI)}deg)`;
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [frame, taxi]);

  const riding = ride.phase !== 'idle' && ride.phase !== 'asking';
  const trail = ride.etas.slice(-7);
  return (
    <section className={`gps is-${mode} ${moment ? 'is-moment' : ''} ${moment && ride.verdict ? `is-${ride.verdict.kind}` : ''}`} aria-label="The taxi’s screen">
      <div className="gps-bezel">
        <div ref={holder} className="gps-map" />
        {moment && <p className="gps-recalc">RECALCUL…</p>}
        <div className="gps-strip">
          {!riding ? (
            <span className="gps-status">{status}</span>
          ) : (
            <>
              <span className="gps-status">{calculating ? 'RECALCUL…' : mode === 'docked' ? `${ride.eta} MIN` : ride.destination.toUpperCase()}</span>
              <span className="gps-figures">
                {mode === 'big' && `${km(ride.metres)}${ride.stops > 0 ? ` · ${ride.stops} STOP${ride.stops > 1 ? 'S' : ''}` : ''} · `}
                {ride.meterCut ? 'COMPTEUR COUPÉ' : `${mode === 'big' ? 'EST. ' : ''}${euros(ride.estimate)} €`}
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
        {ride.phase === 'quoting' && !calculating && (
          <div className="gps-quote" role="button" tabIndex={0} onClick={onClose} onKeyDown={(e) => e.key === 'Enter' && onClose()} title="Back to the road">
            <p className="gps-quote-says">His GPS says</p>
            <p className="gps-quote-big">
              <strong>{ride.eta} min</strong> <strong>{euros(ride.estimate)} €</strong>
            </p>
            <p className="gps-quote-roads">
              <span>
                {ride.stops} stop{ride.stops > 1 ? 's' : ''} first, {km(ride.metres)}.
              </span>
              <span>The direct road: {km(ride.direct)}, {Math.max(1, Math.round(ride.direct / 6.5 / 60))} min.</span>
            </p>
            <p className="gps-quote-never">Would you arrive before?</p>
            <ul className="gps-quote-how">
              <li>
                <b>Fewer stops:</b> let him finish, answer him, agree with him once, ask what he thinks.
              </li>
              <li>
                <b>More stops:</b> cut him off (click him), touch his radio, open your window.
              </li>
            </ul>
            <small>Click to start</small>
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
