/// <reference types="vitest/config" />
import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { cpSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

// The renderer never imports backend code. It reads versioned JSON from
// ../artifacts (produced by main/) and talks to the main process over HTTP
// (/api, proxied in dev). A static build copies artifacts in, so replay
// needs $0 of compute and no backend at all.
const ARTIFACTS = resolve(import.meta.dirname, '../artifacts');

/** Dev server: serve ../artifacts at /artifacts. */
function serveArtifacts(): Plugin {
  return {
    name: 'labyrinth-artifacts-serve',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use('/artifacts', (req, res, next) => {
        const file = resolve(ARTIFACTS, '.' + (req.url ?? '').split('?')[0]);
        if (!file.startsWith(ARTIFACTS) || !existsSync(file)) return next();
        res.setHeader('Content-Type', 'application/json');
        import('node:fs').then((fs) => fs.createReadStream(file).pipe(res));
      });
    },
  };
}

/**
 * Build only: copy ../artifacts into <outDir>/artifacts so the static build replays with no
 * backend (A5). `apply: 'build'` keeps dev/vitest server shutdowns from writing into dist/.
 */
export function copyArtifacts(source = ARTIFACTS): Plugin {
  let outDir = resolve(import.meta.dirname, 'dist');
  return {
    name: 'labyrinth-artifacts',
    apply: 'build',
    configResolved(config) {
      outDir = resolve(config.root, config.build.outDir);
    },
    closeBundle() {
      if (!existsSync(source)) throw new Error(`labyrinth-artifacts: ${source} not found; the replay build needs it`);
      cpSync(source, resolve(outDir, 'artifacts'), { recursive: true });
    },
  };
}

export default defineConfig({
  plugins: [react(), serveArtifacts(), copyArtifacts()],
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
