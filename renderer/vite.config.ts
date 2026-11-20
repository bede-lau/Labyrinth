/// <reference types="vitest/config" />
import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { cpSync, createReadStream, existsSync, statSync } from 'node:fs';
import { availableParallelism } from 'node:os';
import { resolve, sep } from 'node:path';
import type { Readable } from 'node:stream';

// The renderer never imports backend code. It reads versioned JSON from
// ../artifacts (produced by main/) and talks to the main process over HTTP
// (/api, proxied in dev). A static build copies artifacts in, so replay
// needs $0 of compute and no backend at all.
const ARTIFACTS = resolve(import.meta.dirname, '../artifacts');

/**
 * Map a request below /artifacts to a file, or null when it must not be served: anything that is
 * not a regular file strictly inside `root`. Containment is decided on whole path segments (the
 * resolved path must continue after `root` + separator) — a bare string-prefix test would admit a
 * sibling folder such as `artifacts-private/`.
 */
export function resolveArtifactRequest(root: string, url: string | undefined): string | null {
  if (url === undefined) return null;
  const base = resolve(root);
  const file = resolve(base, '.' + url.split('?')[0]);
  if (!file.startsWith(base + sep)) return null;
  try {
    return statSync(file).isFile() ? file : null;
  } catch {
    return null;
  }
}

/** Dev server: serve ../artifacts at /artifacts. */
export function serveArtifacts(root = ARTIFACTS, open: (file: string) => Readable = createReadStream): Plugin {
  return {
    name: 'labyrinth-artifacts-serve',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use('/artifacts', (req, res, next) => {
        const file = resolveArtifactRequest(root, req.url);
        if (!file) return next();
        const stream = open(file);
        // A read error (file removed or unreadable after the check) must not take the dev server down:
        // hand it to the server's error handler, or cut the response if part of it was already sent.
        stream.once('error', (err) => (res.headersSent ? res.destroy(err) : next(err)));
        res.setHeader('Content-Type', 'application/json');
        stream.pipe(res);
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

/** Cap on parallel test workers when VITEST_MAX_WORKERS does not set one (vitest itself applies the variable). */
export const DEFAULT_MAX_TEST_WORKERS = 4;

/**
 * F13: how many test workers to start. Several agents run this suite in one tree at once, and an
 * uncapped run starts one worker per core until workers time out starting ("Failed to start … worker",
 * a red gate with zero failing tests). VITEST_MAX_WORKERS (scripts/dev.sh exports 4) wins when it is a
 * positive integer; otherwise at most DEFAULT_MAX_TEST_WORKERS, leaving one core free.
 */
export function testMaxWorkers(env: Record<string, string | undefined> = process.env, cores = availableParallelism()): number {
  const fromEnv = Number(env.VITEST_MAX_WORKERS);
  if (Number.isInteger(fromEnv) && fromEnv > 0) return fromEnv;
  return Math.max(1, Math.min(DEFAULT_MAX_TEST_WORKERS, cores - 1));
}

export default defineConfig({
  plugins: [react(), serveArtifacts(), copyArtifacts()],
  server: {
    port: 5173,
    proxy: { '/api': 'http://127.0.0.1:8787' },
  },
  build: { chunkSizeWarningLimit: 5000 },
  test: {
    // DOM only where a file needs it: pure files opt out with `// @vitest-environment node`.
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./vitest.setup.ts'],
    include: ['src/**/*.test.{ts,tsx}'],
    // F13: each test file still runs in its own VM context (fresh module graph and globals: per-file
    // isolation is kept), but a worker builds its jsdom environment once instead of once per file —
    // the environment was 64 % of the suite's time. Full suite, 4 workers, same 29 files / 1158 tests:
    // 137 s with 'threads', 40 s with 'vmThreads'.
    pool: 'vmThreads',
    maxWorkers: testMaxWorkers(),
    // A vm worker that grows past this is recycled before its next file, so a leak cannot exhaust memory.
    vmMemoryLimit: '1024MB',
  },
});
