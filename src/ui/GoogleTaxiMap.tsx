import { useEffect, useRef, useState } from 'react';
import { boundsAround, toLatLng, toWorld } from '../maps/coordinates';
import { loadGoogleMaps, onGoogleAuthError } from '../maps/google';
import type { TaxiMapProps } from './TaxiScreen';

/** The game's deliberately absurd route, drawn on Google Maps; it is not a Google directions result. */
export function GoogleTaxiMap(props: TaxiMapProps) {
  const { frame, ride, mode, setStatus, setCalculating } = props;
  const live = useRef(props);
  live.current = props;
  const holder = useRef<HTMLDivElement>(null);
  const map = useRef<google.maps.Map | null>(null);
  const marker = useRef<google.maps.Marker | null>(null);
  const traffic = useRef<google.maps.TrafficLayer | null>(null);
  const lines = useRef<google.maps.Polyline[]>([]);
  const pins = useRef<google.maps.Marker[]>([]);
  const routeBounds = useRef<google.maps.LatLngBounds | null>(null);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState('');
  const [satellite, setSatellite] = useState(false);
  const [trafficOn, setTrafficOn] = useState(false);

  useEffect(() => {
    let cancelled = false;
    let dispose = () => {};
    setReady(false);
    const offAuth = onGoogleAuthError((message) => { if (!cancelled) setError(message); });
    void (async () => {
      const maps = await loadGoogleMaps();
      await maps.importLibrary('maps');
      if (cancelled) return;
      const m = new maps.Map(holder.current!, {
        center: { lat: frame.place.lat, lng: frame.place.lon }, zoom: 16,
        disableDefaultUI: true, clickableIcons: false, gestureHandling: 'greedy',
        restriction: { latLngBounds: boundsAround(frame.place), strictBounds: false },
        styles: [{ elementType: 'geometry', stylers: [{ color: '#263744' }] }, { elementType: 'labels.text.stroke', stylers: [{ color: '#263744' }] }, { elementType: 'labels.text.fill', stylers: [{ color: '#b4c2cb' }] }, { featureType: 'road', elementType: 'geometry', stylers: [{ color: '#4c626f' }] }, { featureType: 'water', elementType: 'geometry', stylers: [{ color: '#132b3e' }] }, { featureType: 'poi', stylers: [{ visibility: 'off' }] }],
      });
      map.current = m;
      m.addListener('tilesloaded', () => { if (holder.current) holder.current.dataset.loaded = 'true'; });
      marker.current = new maps.Marker({ map: m, title: 'Your taxi', zIndex: 100, clickable: false });
      traffic.current = new maps.TrafficLayer();
      const click = m.addListener('click', (event: google.maps.MapMouseEvent) => {
        if (!event.latLng) return;
        const [x, z] = toWorld(frame.place, event.latLng.lat(), event.latLng.lng());
        const label = live.current.onPick(x, z);
        live.current.setStatus(label ? label.toUpperCase() : 'NO ROUTE HERE');
      });
      const observer = new ResizeObserver(() => {
        maps.event.trigger(m, 'resize');
        if (routeBounds.current) m.fitBounds(routeBounds.current, live.current.mode === 'docked' ? 24 : 60);
      });
      observer.observe(holder.current!);
      dispose = () => {
        observer.disconnect(); click.remove(); maps.event.clearInstanceListeners(m);
        marker.current?.setMap(null); traffic.current?.setMap(null);
        for (const line of lines.current) line.setMap(null);
        for (const pin of pins.current) pin.setMap(null);
        map.current = null; marker.current = null;
      };
      setReady(true);
    })().catch((e) => { if (!cancelled) setError(e.message); });
    return () => { cancelled = true; offAuth(); dispose(); };
  }, [frame]);

  useEffect(() => {
    const m = map.current;
    if (!m || !ready) return;
    for (const line of lines.current) line.setMap(null);
    for (const pin of pins.current) pin.setMap(null);
    lines.current = []; pins.current = []; routeBounds.current = null;
    setCalculating(false);
    const pointsOf = (ids: number[]) => ids.flatMap((id) => frame.net.lanes[id]?.points.map(([x, z]) => toLatLng(frame.place, x, z)) ?? []);
    const points = pointsOf(ride.routeLanes);
    if (points.length < 2) return;
    const old = ride.verdict?.routeChanged && performance.now() - ride.verdict.at < 8000 ? pointsOf(ride.verdict.previousLanes) : [];
    if (old.length) lines.current.push(new google.maps.Polyline({ map: m, path: old, strokeColor: '#a4a9b0', strokeOpacity: 0.5, strokeWeight: 4, clickable: false }));
    const line = new google.maps.Polyline({ map: m, strokeColor: '#f2c230', strokeOpacity: 1, strokeWeight: 5, clickable: false, zIndex: 2 });
    lines.current.push(line);
    for (const [i, id] of ride.stopLanes.entries()) {
      const lane = frame.net.lanes[id];
      if (!lane) continue;
      const [x, z] = lane.points[Math.floor(lane.points.length / 2)];
      pins.current.push(new google.maps.Marker({ map: m, position: toLatLng(frame.place, x, z), label: { text: String(i + 1), color: '#1b1d21', fontSize: '11px' }, icon: { path: google.maps.SymbolPath.CIRCLE, scale: 10, fillColor: '#f2c230', fillOpacity: 1, strokeColor: '#1b1d21', strokeWeight: 2 }, clickable: false }));
    }
    pins.current.push(new google.maps.Marker({ map: m, position: points[points.length - 1], title: ride.destination, icon: { path: google.maps.SymbolPath.CIRCLE, scale: 8, fillColor: '#1b1d21', fillOpacity: 1, strokeColor: '#f2c230', strokeWeight: 3 }, clickable: false }));
    const bounds = new google.maps.LatLngBounds();
    for (const point of [...points, ...old]) bounds.extend(point);
    routeBounds.current = bounds;
    m.fitBounds(bounds, mode === 'docked' ? 24 : 60);
    let raf = 0;
    const start = performance.now();
    const duration = matchMedia('(prefers-reduced-motion: reduce)').matches ? 1 : 1500;
    setCalculating(true);
    const draw = () => {
      const k = Math.min(1, (performance.now() - start) / duration);
      line.setPath(points.slice(0, Math.max(2, Math.ceil(points.length * k))));
      if (k < 1) raf = requestAnimationFrame(draw);
      else setCalculating(false);
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [ready, frame, ride.recalc, ride.routeLanes.length]);

  useEffect(() => {
    if (!ready) return;
    const timer = setInterval(() => {
      const at = live.current.taxi();
      if (!at || !marker.current) return;
      marker.current.setPosition(toLatLng(frame.place, at.x, at.z));
      marker.current.setIcon({ path: google.maps.SymbolPath.FORWARD_CLOSED_ARROW, scale: 5, rotation: Math.atan2(at.dx, -at.dz) * 180 / Math.PI, fillColor: '#f2c230', fillOpacity: 1, strokeColor: '#17202a', strokeWeight: 2 });
    }, 100);
    return () => clearInterval(timer);
  }, [ready, frame]);

  useEffect(() => { map.current?.setMapTypeId(satellite ? 'hybrid' : 'roadmap'); }, [satellite, ready]);
  useEffect(() => { traffic.current?.setMap(trafficOn ? map.current : null); }, [trafficOn, ready]);
  useEffect(() => { if (error) setStatus('MAP UNAVAILABLE'); }, [error, setStatus]);

  return <>
    <div ref={holder} className="gps-map google-gps-map" />
    {mode === 'big' && ready && <div className="gps-layers" role="group" aria-label="Google map layers">
      <button type="button" aria-pressed={satellite} onClick={() => setSatellite(!satellite)}>Satellite</button>
      <button type="button" aria-pressed={trafficOn} onClick={() => setTrafficOn(!trafficOn)}>Live traffic</button>
    </div>}
    {error && <p className="gps-error" role="alert">{error} <button type="button" onClick={() => window.dispatchEvent(new Event('jev:settings'))}>Map settings</button></p>}
  </>;
}
