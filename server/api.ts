// The API, shared by the Vite dev server (a middleware) and the production server (`server/index.ts`):
// /api/drive asks Jev; /api/map (streets), /api/terrain and /api/scenery (nine tiles of buildings) fetch the real
// place; /api/driver/* is the driver's mouth (Gemini and Google's voices). The TypeSafe key and the Google login
// stay in Node. Whatever costs money is rationed per address, so that a public URL cannot run up the bill.

import type { IncomingMessage, ServerResponse } from 'node:http';
import { cast, line, say, health as driverHealth, type GerardConfig } from './gerard.ts';
import { JevError, drive, intent, type JevConfig } from './jev.ts';
import { TILES, findPlace, hasCachedMapData, loadScenery, loadStreets, nameOf, loadPois } from './maps.ts';
import { loadTerrain } from './terrain.ts';
import { paintedVehicle } from './vehicle.ts';
import type { Health } from '../shared/drive.ts';
import type { DriverQuery, VoiceQuery } from '../shared/driver.ts';

const MAX_BODY_BYTES = 48 * 1024;

export function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        reject(new JevError('Request body too large', 413));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

export function send(res: ServerResponse, status: number, body: unknown) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(body));
}

/** So many of a kind of request per address per window; the rest are told to wait. Enough for one ride, not for a script. */
class Ration {
  private readonly seen = new Map<string, number[]>();
  constructor(
    private readonly limit: number,
    private readonly windowMs: number,
  ) {}

  allow(who: string): boolean {
    const now = Date.now();
    const times = (this.seen.get(who) ?? []).filter((t) => now - t < this.windowMs);
    if (times.length >= this.limit) {
      this.seen.set(who, times);
      return false;
    }
    times.push(now);
    this.seen.set(who, times);
    // Addresses not seen for a while are forgotten, so the map does not grow for ever.
    if (this.seen.size > 5000) for (const [key, ts] of this.seen) if (!ts.some((t) => now - t < this.windowMs)) this.seen.delete(key);
    return true;
  }
}

const RATIONS = {
  // Lines and voices: a ride asks for one of each every ten seconds or so.
  talk: new Ration(120, 10 * 60 * 1000),
  // A new driver is invented once per town per visit.
  cast: new Ration(12, 10 * 60 * 1000),
  // Jev's verdicts for the other cars, and the passenger's intents.
  jev: new Ration(600, 10 * 60 * 1000),
  // Fetching a town from OpenStreetMap and the terrain tiles.
  maps: new Ration(60, 10 * 60 * 1000),
};

function addressOf(req: IncomingMessage): string {
  const forwarded = String(req.headers['x-forwarded-for'] ?? '').split(',')[0].trim();
  return forwarded || req.socket.remoteAddress || 'unknown';
}

export type Handler = (req: IncomingMessage, res: ServerResponse, next: () => void) => void;

export function api(config: JevConfig, gerard: GerardConfig, maps: { browserKey: string; mapId: string } = { browserKey: '', mapId: '' }): Handler {
  return async (req, res, next) => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    if (!url.pathname.startsWith('/api/')) return next();
    // The browser hangs up on a line the driver no longer needs: whatever was being asked of Google for it stops there.
    const left = new AbortController();
    res.on('close', () => res.writableFinished || left.abort());
    const who = addressOf(req);
    const rationed = (kind: keyof typeof RATIONS) => (RATIONS[kind].allow(who) ? false : (send(res, 429, { error: 'Too many requests from this address; try again in a few minutes' }), true));
    try {
      // This is an intentionally public, referrer-restricted browser key. Never expose the AI credentials.
      if (url.pathname === '/api/maps/config') return send(res, 200, maps);
      if (url.pathname.startsWith('/api/vehicle/')) {
        if (req.method !== 'GET') return send(res, 405, { error: 'GET required' });
        const variant = /^\/api\/vehicle\/([a-z]+)-([0-9a-f]{6})\.glb$/i.exec(url.pathname);
        const model = variant ? await paintedVehicle(variant[1], variant[2]) : null;
        if (!model) return send(res, 400, { error: 'Invalid vehicle or paint colour' });
        res.setHeader('Content-Type', 'model/gltf-binary');
        res.setHeader('Content-Length', model.length);
        res.setHeader('Cache-Control', 'public, max-age=86400');
        res.setHeader('X-Content-Type-Options', 'nosniff');
        res.end(model);
        return;
      }
      if (url.pathname === '/api/health') return send(res, 200, { configured: Boolean(config.apiKey), model: config.model } satisfies Health);
      if (url.pathname === '/api/map') {
        const lat = Number(url.searchParams.get('lat'));
        const lon = Number(url.searchParams.get('lon'));
        if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 85 || Math.abs(lon) > 180) return send(res, 400, { error: 'Bad coordinates' });
        if (!hasCachedMapData(lat, lon, 'streets') && rationed('maps')) return;
        return send(res, 200, await loadStreets(lat, lon));
      }
      if (url.pathname === '/api/terrain') {
        const lat = Number(url.searchParams.get('lat'));
        const lon = Number(url.searchParams.get('lon'));
        if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 85 || Math.abs(lon) > 180) return send(res, 400, { error: 'Bad coordinates' });
        if (!hasCachedMapData(lat, lon, 'terrain') && rationed('maps')) return;
        return send(res, 200, await loadTerrain(lat, lon));
      }
      if (url.pathname === '/api/scenery') {
        const lat = Number(url.searchParams.get('lat'));
        const lon = Number(url.searchParams.get('lon'));
        const tile = Number(url.searchParams.get('tile'));
        if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 85 || Math.abs(lon) > 180 || !Number.isInteger(tile) || tile < 0 || tile >= TILES * TILES) return send(res, 400, { error: 'Bad tile' });
        if (!hasCachedMapData(lat, lon, tile) && rationed('maps')) return;
        return send(res, 200, await loadScenery(lat, lon, tile));
      }
      if (url.pathname === '/api/place') {
        const q = (url.searchParams.get('q') ?? '').trim().slice(0, 120);
        if (!q) return send(res, 400, { error: 'Missing place' });
        if (rationed('maps')) return;
        const place = await findPlace(q);
        return place ? send(res, 200, place) : send(res, 404, { error: 'No such place found' });
      }
      if (url.pathname === '/api/pois') {
        const lat = Number(url.searchParams.get('lat'));
        const lon = Number(url.searchParams.get('lon'));
        if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 85 || Math.abs(lon) > 180) return send(res, 400, { error: 'Bad coordinates' });
        if (rationed('maps')) return;
        return send(res, 200, await loadPois(lat, lon));
      }
      if (url.pathname === '/api/where') {
        const lat = Number(url.searchParams.get('lat'));
        const lon = Number(url.searchParams.get('lon'));
        if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 85 || Math.abs(lon) > 180) return send(res, 400, { error: 'Bad coordinates' });
        if (rationed('maps')) return;
        return send(res, 200, await nameOf(lat, lon));
      }
      // A key typed on the title page rides in a header and is used for that request only; nothing is kept.
      const given = String(req.headers['x-typesafe-key'] ?? '').trim();
      const jev = given ? { ...config, apiKey: given.slice(0, 200) } : config;
      if (url.pathname === '/api/drive') {
        if (req.method !== 'POST') return send(res, 405, { error: 'POST only' });
        if (rationed('jev')) return;
        return send(res, 200, await drive(jev, JSON.parse(await readBody(req)) as Record<string, unknown>));
      }
      if (url.pathname === '/api/driver/health') return send(res, 200, await driverHealth(gerard));
      if (url.pathname === '/api/driver/line') {
        if (req.method !== 'POST') return send(res, 405, { error: 'POST only' });
        if (rationed('talk')) return;
        return send(res, 200, await line(gerard, JSON.parse(await readBody(req)) as DriverQuery, left.signal));
      }
      if (url.pathname === '/api/driver/voice') {
        if (req.method !== 'POST') return send(res, 405, { error: 'POST only' });
        if (rationed('talk')) return;
        return send(res, 200, await say(gerard, JSON.parse(await readBody(req)) as VoiceQuery, left.signal));
      }
      if (url.pathname === '/api/driver/cast') {
        const lat = Number(url.searchParams.get('lat'));
        const lon = Number(url.searchParams.get('lon'));
        if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 85 || Math.abs(lon) > 180) return send(res, 400, { error: 'Bad coordinates' });
        if (rationed('cast')) return;
        return send(res, 200, await cast(gerard, { name: (url.searchParams.get('name') ?? '').slice(0, 120), lat, lon }, url.searchParams.get('sex') === 'f' ? 'f' : 'm'));
      }
      if (url.pathname === '/api/intent') {
        if (req.method !== 'POST') return send(res, 405, { error: 'POST only' });
        if (rationed('jev')) return;
        return send(res, 200, await intent(jev, JSON.parse(await readBody(req)) as Record<string, unknown>));
      }
      return send(res, 404, { error: 'No such route' });
    } catch (error) {
      if (left.signal.aborted) return; // nobody is waiting for an answer
      if (error instanceof JevError) return send(res, error.status, { error: error.message });
      send(res, 502, { error: error instanceof Error ? error.message : 'Request failed' });
    }
  };
}

/** The settings the server runs with, from the environment (`.env` at home, `env.yaml` on App Engine). */
export function configFromEnv(env: Record<string, string | undefined>): { jev: JevConfig; gerard: GerardConfig; maps: { browserKey: string; mapId: string } } {
  return {
    maps: { browserKey: env.GOOGLE_MAPS_BROWSER_KEY || '', mapId: env.GOOGLE_MAPS_MAP_ID || '' },
    jev: { apiKey: env.TYPESAFE_API_KEY || undefined, model: env.TYPESAFE_MODEL || 'jev-latest' },
    gerard: {
      project: env.GOOGLE_CLOUD_PROJECT || undefined,
      model: env.GEMINI_MODEL || 'gemini-3.8-flash',
      tts: env.DRIVER_TTS === 'chirp' || env.DRIVER_TTS === 'off' ? env.DRIVER_TTS : 'gemini',
      voice: env.DRIVER_VOICE || 'Algenib',
      pace: Math.min(2, Math.max(0.8, Number(env.DRIVER_PACE) || 1.5)),
    },
  };
}
