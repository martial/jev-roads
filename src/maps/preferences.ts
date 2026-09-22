export type MapProvider = 'google' | 'osm';
export type CameraShot = 'ride' | 'chase' | 'orbit' | 'overhead';
export type WorldMode = 'tiles' | 'street' | 'reconstructed';

export function worldMode(): WorldMode {
  if (mapProvider() === 'osm') return 'reconstructed';
  try {
    const requested = new URLSearchParams(location.search).get('scene');
    if (requested === 'tiles' || requested === 'street' || requested === 'reconstructed') return requested;
    const saved = localStorage.getItem('jev-roads:world-mode');
    return saved === 'tiles' || saved === 'street' ? saved : 'reconstructed';
  } catch { return 'reconstructed'; }
}

export function rememberWorldMode(mode: WorldMode) {
  try { localStorage.setItem('jev-roads:world-mode', mode); } catch { /* The URL still remembers it. */ }
  const url = new URL(location.href);
  url.searchParams.set('scene', mode);
  history.replaceState(null, '', url);
}

export function mapProvider(): MapProvider {
  try {
    const requested = new URLSearchParams(location.search).get('maps');
    if (requested === 'google' || requested === 'osm') return requested;
    return localStorage.getItem('jev-roads:map-provider') === 'osm' ? 'osm' : 'google';
  } catch {
    return 'google';
  }
}

/** Reload deliberately: providers own different GPU resources and a different scenery pipeline. */
export function switchMapProvider(provider: MapProvider, place?: { name: string; lat: number; lon: number } | null) {
  try {
    localStorage.setItem('jev-roads:map-provider', provider);
    if (place) sessionStorage.setItem('jev-roads:reopen', JSON.stringify(place));
  } catch { /* URL selection also works when storage is unavailable. */ }
  const url = new URL(location.href);
  url.searchParams.set('maps', provider);
  location.assign(url.href);
}

export function reloadWorld(place?: { name: string; lat: number; lon: number } | null) {
  try { if (place) sessionStorage.setItem('jev-roads:reopen', JSON.stringify(place)); } catch { /* Reopen manually if storage is blocked. */ }
  location.reload();
}
