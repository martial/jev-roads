// The production server: the built page from `dist/` and the API, on one port. This is what App Engine runs
// (`npm start`); at home `npm run build && npm start` does the same on port 8080. No framework: a dozen file
// types, an index.html for everything that is not a file, and the API handler shared with the dev server.

import { createReadStream, existsSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, join, normalize, resolve } from 'node:path';
import { api, configFromEnv } from './api.ts';

const PORT = Number(process.env.PORT) || 8080;
const DIST = resolve(process.cwd(), 'dist');
const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.glb': 'model/gltf-binary',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.mp3': 'audio/mpeg',
  '.txt': 'text/plain; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
};

if (!existsSync(join(DIST, 'index.html'))) {
  console.error('No dist/index.html: run `npm run build` first.');
  process.exit(1);
}

const { jev, gerard } = configFromEnv(process.env);
const handle = api(jev, gerard);

const server = createServer((req, res) => {
  void handle(req, res, () => {
    // A file from the build, or the page for any other address (the app has no routes of its own, but a link may).
    const url = new URL(req.url ?? '/', 'http://localhost');
    const wanted = normalize(decodeURIComponent(url.pathname));
    let file = resolve(DIST, `.${wanted}`);
    // Nothing above dist/ is ever read, whatever the address says; anything that is not a file gets the page.
    if (!file.startsWith(DIST + '/') || !existsSync(file) || statSync(file).isDirectory()) file = join(DIST, 'index.html');
    const type = TYPES[extname(file).toLowerCase()] ?? 'application/octet-stream';
    res.setHeader('Content-Type', type);
    // Vite names its assets by their content: they can be kept for ever. The page itself, and the models, a day.
    res.setHeader('Cache-Control', wanted.startsWith('/assets/') ? 'public, max-age=31536000, immutable' : file.endsWith('index.html') ? 'no-cache' : 'public, max-age=86400');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.statusCode = 200;
    createReadStream(file).pipe(res);
  });
});

server.listen(PORT, () => {
  console.log(`jev-roads on http://localhost:${PORT}  (Jev ${jev.apiKey ? 'on' : 'off, no TYPESAFE_API_KEY'}; driver ${gerard.tts === 'off' ? 'silent' : `voice ${gerard.tts}:${gerard.voice}`}; caches in ${process.env.CACHE_DIR ?? process.cwd()})`);
});
