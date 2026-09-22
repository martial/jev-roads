import { useEffect, useRef, useState } from 'react';
import type { Place } from '../game';
import { boundsAround } from '../maps/coordinates';
import { googleGeocode, loadGoogleMaps, onGoogleAuthError } from '../maps/google';
import { get } from '../store';

export interface PickerProps { places: Place[]; last: Place | null; canClose: boolean; onBuild: (place: Place) => void; onClose: () => void }
type View = 'roadmap' | '3d' | 'satellite' | 'street';

export function GoogleMapPicker({ places, last, canClose, onBuild, onClose }: PickerProps) {
  const holder = useRef<HTMLDivElement>(null);
  const m3 = useRef<google.maps.maps3d.Map3DElement | null>(null);
  const m2 = useRef<google.maps.Map | null>(null);
  const pickRef = useRef<Place>(last ?? places[0]);
  const [picked, setPicked] = useState(pickRef.current);
  const [view, setView] = useState<View>(() => get().worldMode === 'reconstructed' ? 'roadmap' : '3d');
  const [query, setQuery] = useState('');
  const [note, setNote] = useState('');
  const [error, setError] = useState('');
  const [ready, setReady] = useState(0);
  const [orbiting, setOrbiting] = useState(false);
  const ticket = useRef(0);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; ticket.current++; }; }, []);

  const choose = (place: Place, fly = true) => {
    ++ticket.current;
    pickRef.current = place;
    setPicked(place);
    setOrbiting(false);
    m3.current?.stopCameraAnimation();
    if (!fly) return;
    const center = { lat: place.lat, lng: place.lon };
    if (m3.current) {
      void Promise.resolve(m3.current.flyCameraTo({ endCamera: { center, altitudeMode: 'RELATIVE_TO_GROUND', range: 1700, tilt: 58, heading: 25 }, durationMillis: matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 1800 })).catch(() => {});
    }
    m2.current?.panTo(center);
    m2.current?.setZoom(16);
  };

  const pickAt = (lat: number, lon: number) => {
    const place = { lat: Math.round(lat * 1e4) / 1e4, lon: Math.round(lon * 1e4) / 1e4, name: `${lat.toFixed(4)}, ${lon.toFixed(4)}` };
    choose(place, false);
    const mine = ticket.current;
    void googleGeocode({ location: { lat, lng: lon } }).then((found) => {
      if (mounted.current && mine === ticket.current) { const named = { ...place, name: found.name }; pickRef.current = named; setPicked(named); }
    }).catch(() => {});
  };

  useEffect(() => {
    let cancelled = false;
    let cleanup = () => {};
    let watchdog = 0;
    const element = holder.current!;
    delete element.dataset.loaded;
    setError(''); setNote('Loading Google Maps…'); setOrbiting(false);
    const offAuth = onGoogleAuthError((message) => { if (!cancelled) setError(message); });
    void (async () => {
      const maps = await loadGoogleMaps();
      const place = pickRef.current;
      const center = { lat: place.lat, lng: place.lon };
      if (view === '3d') {
        const { Map3DElement } = await maps.importLibrary('maps3d') as google.maps.Maps3DLibrary;
        if (cancelled) return;
        const map = new Map3DElement({ center, range: 2200, tilt: 58, heading: 25, mode: 'HYBRID', defaultUIHidden: true });
        map.style.cssText = 'width:100%;height:100%';
        map.addEventListener('gmp-click', (event) => { if (event.position) pickAt(event.position.lat, event.position.lng); });
        map.addEventListener('gmp-error', () => setError('3D could not load. Try Satellite, or check your Google Maps connection in settings.'));
        map.addEventListener('gmp-animationend', () => setOrbiting(false));
        map.addEventListener('gmp-steadychange', (event) => { if (event.isSteady) { clearTimeout(watchdog); element.dataset.loaded = 'true'; setNote('Click a street to choose your starting point.'); } });
        watchdog = window.setTimeout(() => { setNote(''); setError('Google 3D did not finish loading. Check your key in settings, or try Satellite.'); }, 25000);
        m3.current = map;
        holder.current!.append(map);
        cleanup = () => { map.stopCameraAnimation(); map.remove(); m3.current = null; };
      } else if (view === 'satellite' || view === 'roadmap') {
        const { Map } = await maps.importLibrary('maps') as google.maps.MapsLibrary;
        if (cancelled) return;
        const map = new Map(holder.current!, { center, zoom: 16, mapTypeId: view === 'satellite' ? 'hybrid' : 'roadmap', disableDefaultUI: true, zoomControl: true, streetViewControl: false, gestureHandling: 'greedy', clickableIcons: false });
        const click = map.addListener('click', (event: google.maps.MapMouseEvent) => { if (event.latLng) pickAt(event.latLng.lat(), event.latLng.lng()); });
        m2.current = map;
        map.addListener('tilesloaded', () => { element.dataset.loaded = 'true'; });
        cleanup = () => { click.remove(); maps.event.clearInstanceListeners(map); m2.current = null; };
        setNote('Click a street to choose your starting point.');
      } else {
        const { StreetViewPanorama, StreetViewService } = await maps.importLibrary('streetView') as google.maps.StreetViewLibrary;
        const { data } = await new StreetViewService().getPanorama({ location: center, radius: 250 });
        if (cancelled) return;
        const panorama = new StreetViewPanorama(holder.current!, { pano: data.location?.pano, pov: { heading: 25, pitch: 0 }, addressControl: true, fullscreenControl: false, motionTracking: false, motionTrackingControl: false });
        panorama.addListener('status_changed', () => { if (panorama.getStatus() === 'OK') element.dataset.loaded = 'true'; });
        cleanup = () => { panorama.setVisible(false); maps.event.clearInstanceListeners(panorama); };
        setNote('Scout the neighbourhood. Your starting point stays pinned.');
      }
      if (!cancelled) setReady((n) => n + 1);
    })().catch((e) => { if (!cancelled) { setNote(''); setError(view === 'street' ? 'No Street View panorama here. Try another street, or return to 3D.' : e.message); } });
    return () => { cancelled = true; clearTimeout(watchdog); offAuth(); cleanup(); holder.current?.replaceChildren(); };
  }, [view]);

  useEffect(() => {
    if (m3.current) {
      const bounds = boundsAround(picked);
      const outline = new google.maps.maps3d.Polyline3DElement({
        path: [{ lat: bounds.north, lng: bounds.west }, { lat: bounds.north, lng: bounds.east }, { lat: bounds.south, lng: bounds.east }, { lat: bounds.south, lng: bounds.west }, { lat: bounds.north, lng: bounds.west }],
        strokeColor: '#f2c230', strokeWidth: 5, altitudeMode: 'CLAMP_TO_GROUND', drawsOccludedSegments: true,
      });
      const marker = new google.maps.maps3d.Marker3DElement({ position: { lat: picked.lat, lng: picked.lon }, label: 'Your taxi', altitudeMode: 'CLAMP_TO_GROUND' });
      m3.current.append(outline, marker);
      return () => { outline.remove(); marker.remove(); };
    }
    if (m2.current) {
      const rectangle = new google.maps.Rectangle({ map: m2.current, bounds: boundsAround(picked), strokeColor: '#f2c230', strokeWeight: 2, fillColor: '#f2c230', fillOpacity: 0.1, clickable: false });
      return () => rectangle.setMap(null);
    }
  }, [picked, ready]);

  return <section className="picker google-picker" aria-label="Explore with Google Maps">
    <div className="picker-map" ref={holder} />
    <div className="picker-head">
      <h1>The world is your taxi ride.</h1>
      <p>Fly over real rooftops. Find your street. Get in.</p>
      <form onSubmit={(e) => {
        e.preventDefault();
        if (!query.trim()) return;
        const mine = ++ticket.current;
        setNote(`Flying to ${query.trim()}…`);
        void googleGeocode({ address: query.trim() }).then((place) => {
          if (!mounted.current || mine !== ticket.current) return;
          choose(place); setQuery(''); setNote('Your starting point is inside the yellow outline.');
          if (view === 'street') setView('3d');
        }).catch((e) => { if (mounted.current && mine === ticket.current) setNote(e.message); });
      }}>
        <input aria-label="Search Google Maps" placeholder="A city, a street, anywhere…" value={query} onChange={(e) => setQuery(e.target.value)} />
        <button type="submit">Fly there</button>
      </form>
      <ul>{places.map((p) => <li key={p.name}><button type="button" onClick={() => { choose(p); if (view === 'street') setView('3d'); }}>{p.name.split(',').pop()}</button></li>)}</ul>
      {note && <p className="picker-note" role="status">{note}</p>}
    </div>
    <div className="map-view-bar" role="group" aria-label="Explore mode">
      {(['roadmap', '3d', 'satellite', 'street'] as const).map((mode) => <button type="button" key={mode} data-explore={mode} aria-pressed={view === mode} onClick={() => setView(mode)}>{mode === 'roadmap' ? 'Map' : mode === '3d' ? 'Immersive 3D' : mode === 'satellite' ? 'Satellite' : 'Street View'}</button>)}
      {view === '3d' && <button type="button" disabled={!m3.current} aria-pressed={orbiting} onClick={() => {
        const map = m3.current;
        if (!map) return;
        if (orbiting) map.stopCameraAnimation();
        else void Promise.resolve(map.flyCameraAround({ camera: { center: { lat: picked.lat, lng: picked.lon }, altitudeMode: 'RELATIVE_TO_GROUND', range: 1300, tilt: 65 }, durationMillis: 24000, repeatCount: 1 })).catch(() => setOrbiting(false));
        setOrbiting(!orbiting);
      }}>{orbiting ? 'Stop orbit' : 'Orbit here'}</button>}
    </div>
    {error && <div className="map-error" role="alert"><strong>Let’s connect your world.</strong><p>{error}</p><button type="button" onClick={() => window.dispatchEvent(new Event('jev:settings'))}>Open map settings</button></div>}
    <div className="picker-go"><p><strong>{picked.name}</strong><span>{picked.lat.toFixed(4)}, {picked.lon.toFixed(4)} · 1 km of streets to drive</span></p><button type="button" onClick={() => onBuild(picked)}>Get in here</button></div>
    {canClose && <button type="button" className="picker-close" onClick={onClose}>Back to the ride</button>}
  </section>;
}
