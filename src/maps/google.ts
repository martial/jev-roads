/// <reference types="google.maps" />

export interface GoogleConfig { browserKey: string; mapId: string }
let configPromise: Promise<GoogleConfig> | null = null;
let loader: Promise<typeof google.maps> | null = null;
let authenticationError = '';
const authListeners = new Set<(message: string) => void>();

export function onGoogleAuthError(listener: (message: string) => void) {
  authListeners.add(listener);
  if (authenticationError) listener(authenticationError);
  return () => { authListeners.delete(listener); };
}

export function googleConfig(): Promise<GoogleConfig> {
  if (!configPromise) configPromise = fetch('/api/maps/config', { signal: AbortSignal.timeout(10000) })
    .then(async (r) => {
      if (!r.ok) throw new Error('Map settings could not be loaded. Try again.');
      const config = await r.json() as GoogleConfig;
      try { config.browserKey = sessionStorage.getItem('jev-roads:google-key') || config.browserKey; } catch { /* Server configuration still works. */ }
      return config;
    }).catch((error) => { configPromise = null; throw error; });
  return configPromise;
}

export function saveGoogleKey(key: string) {
  sessionStorage.setItem('jev-roads:google-key', key.trim());
}

export function loadGoogleMaps(): Promise<typeof google.maps> {
  if (authenticationError) return Promise.reject(new Error(authenticationError));
  if (!loader) loader = googleConfig().then(({ browserKey }) => {
    if (!browserKey) throw new Error('Connect Google Maps in settings to load the world in 3D.');
    if (typeof window.google !== 'undefined' && typeof window.google.maps?.importLibrary === 'function') return window.google.maps;
    return new Promise<typeof google.maps>((resolve, reject) => {
      const script = document.createElement('script');
      const globals = window as unknown as { jevGoogleReady?: () => void; gm_authFailure?: () => void };
      const cleanup = () => { clearTimeout(timeout); delete globals.jevGoogleReady; };
      const fail = (message: string) => { cleanup(); script.remove(); reject(new Error(message)); };
      const timeout = setTimeout(() => fail('Google Maps took too long to load. Check your connection and retry.'), 20000);
      globals.jevGoogleReady = () => { cleanup(); resolve(google.maps); };
      globals.gm_authFailure = () => {
        authenticationError = 'Google Maps rejected this key. Check billing, enabled APIs and website restrictions in Google Cloud.';
        for (const listener of authListeners) listener(authenticationError);
        fail(authenticationError);
      };
      const params = new URLSearchParams({ key: browserKey, v: 'weekly', loading: 'async', callback: 'jevGoogleReady' });
      script.src = `https://maps.googleapis.com/maps/api/js?${params}`;
      script.async = true;
      script.onerror = () => fail('Google Maps could not load. Check your connection or browser blockers.');
      document.head.append(script);
    });
  }).catch((error) => { loader = null; throw error; });
  return loader;
}

export async function googleGeocode(request: google.maps.GeocoderRequest) {
  const maps = await loadGoogleMaps();
  const { Geocoder } = await maps.importLibrary('geocoding') as google.maps.GeocodingLibrary;
  const { results } = await new Geocoder().geocode(request);
  const first = results[0];
  if (!first) throw new Error('No place found. Try a nearby town or a more specific address.');
  return { name: first.formatted_address.split(',').slice(0, 2).join(','), lat: first.geometry.location.lat(), lon: first.geometry.location.lng() };
}
