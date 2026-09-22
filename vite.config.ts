import react from '@vitejs/plugin-react';
import { defineConfig, loadEnv, type Plugin } from 'vite';
import { api, configFromEnv } from './server/api.ts';

/** The API (`server/api.ts`) as a dev-server middleware: the same handler the production server runs. */
function apiPlugin(env: Record<string, string>): Plugin {
  const { jev, gerard, maps } = configFromEnv(env);
  const handler = api(jev, gerard, maps);
  return { name: 'jev-roads-api', configureServer: (server) => void server.middlewares.use(handler), configurePreviewServer: (server) => void server.middlewares.use(handler) };
}

export default defineConfig(({ mode }) => ({
  plugins: [react(), apiPlugin(loadEnv(mode, process.cwd(), ''))],
  server: { port: 5185, strictPort: true },
  preview: { port: 5185 },
  build: { chunkSizeWarningLimit: 2500 },
}));
