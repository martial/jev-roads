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

export interface NearbyPlace { name: string; type: string; lat: number; lon: number }
const nearbyCache = new Map<string, Promise<NearbyPlace[]>>();

/**
 * The businesses around a spot, from Google Places: cafés, bars, bakeries, pharmacies, shops, hotels. Five searches
 * (the middle and four quarters of the built kilometre, twenty results each), deduplicated. Needs the Places API
 * (New) on the browser key; if it is not there, the town simply keeps its own signs.
 */
export function googleNearby(lat: number, lon: number): Promise<NearbyPlace[]> {
  const key = `${lat.toFixed(4)},${lon.toFixed(4)}`;
  const cached = nearbyCache.get(key);
  if (cached) return cached;
  const found = (async () => {
    const maps = await loadGoogleMaps();
    const { Place } = (await maps.importLibrary('places')) as google.maps.PlacesLibrary;
    const kx = 111320 * Math.cos((lat * Math.PI) / 180);
    const spots: Array<[number, number]> = [[0, 0], [-250, -250], [250, -250], [-250, 250], [250, 250]];
    const seen = new Map<string, NearbyPlace>();
    for (const [dx, dz] of spots) {
      const { places } = await Place.searchNearby({
        fields: ['id', 'displayName', 'primaryType', 'location'],
        locationRestriction: { center: { lat: lat - dz / 111320, lng: lon + dx / kx }, radius: 300 },
        includedPrimaryTypes: ['cafe', 'bar', 'restaurant', 'bakery', 'pharmacy', 'hotel', 'store', 'clothing_store', 'book_store', 'florist', 'hair_care', 'supermarket', 'convenience_store', 'night_club', 'ice_cream_shop', 'wine_bar', 'pub'],
        maxResultCount: 20,
      }).catch(() => ({ places: [] as google.maps.places.Place[] }));
      for (const p of places) {
        if (!p.id || !p.displayName || !p.location || seen.has(p.id)) continue;
        seen.set(p.id, { name: p.displayName, type: p.primaryType ?? 'store', lat: p.location.lat(), lon: p.location.lng() });
      }
    }
    return [...seen.values()];
  })()
    .catch(() => [] as NearbyPlace[])
    // Google says nothing (Places not allowed on the key, or no key at all): OpenStreetMap's named shops instead.
    .then((places) => (places.length ? places : fetch(`/api/pois?lat=${lat}&lon=${lon}`).then((r) => (r.ok ? (r.json() as Promise<NearbyPlace[]>) : [])).catch(() => [])));
  nearbyCache.set(key, found);
  return found;
}
