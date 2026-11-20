// The isolation probe's own vitest config (FE2-7), used only by build.test.ts's child run: exactly the two
// probe files, in ONE worker, with the main config's pool, environment and isolation settings otherwise. No
// setup file: the probes use no DOM matchers, and each file's jsdom setup is already the run's main cost.
import { resolve } from 'node:path';
import { defineConfig } from 'vitest/config';
import base from '../../../vite.config';

export const PROBE_FILES = ['src/shell/isolation/isolationA.probe.ts', 'src/shell/isolation/isolationB.probe.ts'];

export default defineConfig({
  ...base,
  root: resolve(import.meta.dirname, '../../..'),
  test: {
    ...base.test,
    include: PROBE_FILES,
    setupFiles: [],
    maxWorkers: 1,
  },
});
