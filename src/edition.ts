export type Edition = 'fr' | 'uk';
export const LONDON = { name: 'London · Soho', lat: 51.5136, lon: -0.1365 };
export function isUK(): boolean { return typeof location !== 'undefined' && new URLSearchParams(location.search).get('edition') === 'uk'; }
export const currencySymbol = () => isUK() ? '£' : '€';
export const money = (n: number, digits = 2) => isUK() ? `£${n.toFixed(digits)}` : `${n.toFixed(digits).replace('.', ',')} €`;
export const displaySpeed = (kmh: number) => Math.round(kmh * (isUK() ? 1 / 1.609344 : 1));
export const speedUnit = () => isUK() ? 'mph' : 'km/h';
export const distance = (m: number) => isUK() ? (Math.abs(m) >= 160 ? `${(m / 1609.344).toFixed(1)} mi` : `${Math.round(m / 0.9144 / 10) * 10} yd`) : (Math.abs(m) >= 950 ? `${(m / 1000).toFixed(1).replace('.', ',')} km` : `${Math.round(m / 10) * 10} m`);
export function switchEdition(edition: Edition, landing = false) {
  const url = new URL(location.href);
  url.searchParams.set('edition', edition);
  if (landing) url.searchParams.set('start', 'landing');
  else url.searchParams.delete('start');
  sessionStorage.removeItem('jev-roads:reopen');
  // Both editions launch in the standard Google + reconstructed world.
  url.searchParams.set('maps', 'google'); url.searchParams.set('scene', 'reconstructed');
  location.assign(url);
}
