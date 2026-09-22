// The world, to choose from. Pan and zoom anywhere, click a spot: a square marks the kilometre
// that will be fetched from OpenStreetMap and built block by block.

import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { useEffect, useRef, useState } from 'react';
import type { Place } from '../game';

/** Half the side of the built world, in metres. */
const HALF = 512;
/** Closer than this, a click picks the spot; further out, it just flies in. */
const PICK_ZOOM = 13;

const squareAround = (lat: number, lon: number): L.LatLngBoundsExpression => {
  const dlat = HALF / 111320;
  const dlon = HALF / (111320 * Math.cos((lat * Math.PI) / 180));
  return [
    [lat - dlat, lon - dlon],
    [lat + dlat, lon + dlon],
  ];
};

export function MapPicker({ places, last, canClose, onBuild, onClose }: { places: Place[]; last: Place | null; canClose: boolean; onBuild: (place: Place) => void; onClose: () => void }) {
  const holder = useRef<HTMLDivElement>(null);
  const map = useRef<L.Map | null>(null);
  const square = useRef<L.Rectangle | null>(null);
  const [picked, setPicked] = useState<Place | null>(null);
  const [query, setQuery] = useState('');
  const [note, setNote] = useState('');
  const ticket = useRef(0);

  const pick = (lat: number, lon: number, name?: string) => {
    const m = map.current;
    if (!m) return;
    const at = { lat: Math.round(lat * 1e4) / 1e4, lon: Math.round(lon * 1e4) / 1e4 };
    square.current?.remove();
    square.current = L.rectangle(squareAround(at.lat, at.lon), { color: '#f2c230', weight: 2, fillColor: '#f2c230', fillOpacity: 0.16, interactive: false }).addTo(m);
    setPicked({ name: name ?? `${at.lat.toFixed(4)}, ${at.lon.toFixed(4)}`, ...at });
    setNote('');
    if (name) return;
    // Put a name to the spot; the coordinates do until it arrives.
    const mine = ++ticket.current;
    void fetch(`/api/where?lat=${at.lat}&lon=${at.lon}`)
      .then((r) => (r.ok ? (r.json() as Promise<{ name: string }>) : null))
      .then((found) => found && mine === ticket.current && setPicked((p) => (p && p.lat === at.lat && p.lon === at.lon ? { ...p, name: found.name } : p)))
      .catch(() => {});
  };

  useEffect(() => {
    const start = last ?? { lat: 46.5, lon: 4.5 };
    const m = L.map(holder.current!, { center: [start.lat, start.lon], zoom: last ? 14 : 5, minZoom: 3, maxZoom: 19, zoomControl: false, worldCopyJump: true, attributionControl: true, maxBounds: [[-75, -100000], [84, 100000]], maxBoundsViscosity: 1 });
    L.control.zoom({ position: 'bottomright' }).addTo(m);
    // OpenStreetMap's own tiles: no key, no account. They are drawn light; the stylesheet turns them to night.
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, className: 'picker-tiles', attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors' }).addTo(m);
    m.on('click', (e: L.LeafletMouseEvent) => {
      // From far away a click means "take me there"; up close it means "here".
      if (m.getZoom() < PICK_ZOOM) {
        m.flyTo(e.latlng, Math.min(15, Math.max(PICK_ZOOM + 1, m.getZoom() + 4)), { duration: 0.9 });
        setNote('Closer now. Click the exact spot.');
        return;
      }
      pick(e.latlng.lat, e.latlng.lng);
    });
    map.current = m;
    if (last) pick(last.lat, last.lon, last.name);
    return () => {
      m.remove();
      map.current = null;
    };
    // The map is created once; `last` only decides where it opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const flyTo = (place: Place) => {
    map.current?.flyTo([place.lat, place.lon], 15, { duration: 1.1 });
    pick(place.lat, place.lon, place.name);
  };

  const search = async () => {
    const q = query.trim();
    if (!q) return;
    setNote(`Looking for ${q}`);
    try {
      const res = await fetch(`/api/place?q=${encodeURIComponent(q)}`);
      const body = (await res.json()) as Partial<Place> & { error?: string };
      if (!res.ok || body.lat === undefined || body.lon === undefined) throw new Error(body.error ?? 'No such place found');
      flyTo({ name: (body.name ?? q).split(',').slice(0, 2).join(','), lat: body.lat, lon: body.lon });
      setQuery('');
    } catch (error) {
      setNote((error as Error).message);
    }
  };

  return (
    <section className="picker" aria-label="Choose where to drive">
      <div ref={holder} className="picker-map" />
      <div className="picker-head">
        <h1>Where to?</h1>
        <p>Click anywhere in the world. The yellow square, a kilometre across, is what gets built: real streets first, then the town rising around them. Its taxi driver is invented while you wait, from wherever you clicked.</p>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void search();
          }}
        >
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Or fly to a place by name" aria-label="Fly the map to a place" />
          <button type="submit">Fly there</button>
        </form>
        <ul>
          {places.map((p) => (
            <li key={p.name}>
              <button type="button" onClick={() => flyTo(p)}>
                {p.name}
              </button>
            </li>
          ))}
        </ul>
        {note && <p className="picker-note" role="status">{note}</p>}
      </div>
      {picked && (
        <div className="picker-go">
          <p>
            <strong>{picked.name}</strong>
            <span>
              {picked.lat.toFixed(4)}, {picked.lon.toFixed(4)}
            </span>
          </p>
          <button onClick={() => onBuild(picked)}>Get in here</button>
        </div>
      )}
      {canClose && (
        <button className="picker-close" onClick={onClose}>
          Back to the streets
        </button>
      )}
    </section>
  );
}
