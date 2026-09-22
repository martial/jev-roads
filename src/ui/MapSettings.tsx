import { useEffect, useState } from 'react';
import { googleConfig, saveGoogleKey } from '../maps/google';
import { switchMapProvider, type WorldMode } from '../maps/preferences';
import { set, useUI } from '../store';
import type { Place } from '../game';

function WorldModes({ onChange }: { onChange: (mode: WorldMode) => void }) {
  const { worldMode, mapProvider } = useUI();
  return <div className="provider-options" role="group" aria-label="World mode">
    {([
      ['reconstructed', 'Reconstructed', 'Modelled buildings, roads and traffic.'],
      ['tiles', '3D tiles', 'Google’s photorealistic city. Drive and fly through it.'],
      ['street', 'Street View', 'Ride between street photos, from the passenger seat.'],
    ] as const).map(([mode, title, description]) => <button type="button" key={mode} data-world={mode} disabled={mapProvider === 'osm' && mode !== 'reconstructed'} aria-pressed={worldMode === mode} onClick={() => onChange(mode)}>
      <strong>{title}</strong><small>{description}</small>
    </button>)}
  </div>;
}

export function MapSettings({ place, onMode }: { place: Place | null; onMode: (mode: WorldMode) => void }) {
  const ui = useUI();
  const [key, setKey] = useState('');
  const [configured, setConfigured] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => { void googleConfig().then((c) => setConfigured(Boolean(c.browserKey))).catch((e) => setError(e.message)); }, []);
  return <div className="map-settings">
    <p className="settings-heading">Your world</p>
    <div className="segment map-provider" role="group" aria-label="Map provider">
      <button type="button" data-provider="google" aria-pressed={ui.mapProvider === 'google'} onClick={() => ui.mapProvider !== 'google' && switchMapProvider('google', place)}>Google Maps</button>
      <button type="button" data-provider="osm" aria-pressed={ui.mapProvider === 'osm'} onClick={() => ui.mapProvider !== 'osm' && switchMapProvider('osm', place)}>OpenStreetMap</button>
    </div>
    <WorldModes onChange={onMode} />
    {ui.mapProvider === 'google' && <>
      <details className="google-key" open={!configured || undefined}>
        <summary>{configured ? 'Google Maps connection' : 'Connect Google Maps'}</summary>
        <p>Use a browser API key with Maps JavaScript API and Geocoding API enabled.</p>
        <form onSubmit={(e) => {
          e.preventDefault();
          if (!key.trim()) return;
          try {
            saveGoogleKey(key);
            if (place) sessionStorage.setItem('jev-roads:reopen', JSON.stringify(place));
            location.reload();
          } catch { setError('Browser storage is blocked. Configure GOOGLE_MAPS_BROWSER_KEY in .env instead.'); }
        }}>
          <input aria-label="Google Maps browser API key" type="password" autoComplete="off" spellCheck={false} placeholder={configured ? 'Replace browser key' : 'Paste browser API key'} value={key} onChange={(e) => setKey(e.target.value)} />
          <button type="submit" disabled={!key.trim()}>Connect</button>
        </form>
        <small>Kept for this browser tab. Restrict the key to your website in Google Cloud.</small>
        <a href="https://developers.google.com/maps/documentation/javascript/get-api-key" target="_blank" rel="noreferrer">Set up a Google Maps key</a>
      </details>
      <button type="button" className="toggle" aria-pressed={ui.mapLabels} onClick={() => set({ mapLabels: !ui.mapLabels })}>Street labels {ui.mapLabels ? 'on' : 'off'}</button>
    </>}
    {error && <p role="alert">{error}</p>}
  </div>;
}
