/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { cpSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

// The renderer never imports backend code. It reads versioned JSON from
// ../artifacts (produced by main/) and talks to the main process over HTTP
// (/api, proxied in dev). A static build copies artifacts in, so replay
// needs $0 of compute and no backend at all.
const ARTIFACTS = resolve(import.meta.dirname, '../artifacts');

export default defineConfig({
  plugins: [
    react(),
    {
      name: 'labyrinth-artifacts',
      configureServer(server) {
        server.middlewares.use('/artifacts', (req, res, next) => {
          const file = resolve(ARTIFACTS, '.' + (req.url ?? '').split('?')[0]);
          if (!file.startsWith(ARTIFACTS) || !existsSync(file)) return next();
          res.setHeader('Content-Type', 'application/json');
          import('node:fs').then((fs) => fs.createReadStream(file).pipe(res));
        });
      },
      closeBundle() {
        if (existsSync(ARTIFACTS)) cpSync(ARTIFACTS, resolve(import.meta.dirname, 'dist/artifacts'), { recursive: true });
      },
    },
  ],
  server: {
    port: 5173,
    proxy: { '/api': 'http://127.0.0.1:8787' },
  },
  build: { chunkSizeWarningLimit: 5000 },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./vitest.setup.ts'],
    include: ['src/**/*.test.{ts,tsx}'],
  },
});
