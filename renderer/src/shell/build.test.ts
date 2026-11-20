// @vitest-environment node
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import type { Plugin, PluginOption } from 'vite';
import config, { copyArtifacts } from '../../vite.config';

const ARTIFACTS = resolve(__dirname, '../../../artifacts');

type Hook = (this: unknown, ...args: unknown[]) => unknown;
const call = (h: unknown, ...args: unknown[]) => (typeof h === 'function' ? (h as Hook) : (h as { handler: Hook }).handler).call({}, ...args);

const flat = (opts: PluginOption[] | undefined): Plugin[] =>
  (opts ?? []).flatMap((p) => (Array.isArray(p) ? flat(p) : p && typeof p === 'object' && 'name' in p ? [p as Plugin] : []));

test('A5 static build copies artifacts/*.json into <outDir>/artifacts so replay needs no backend', () => {
  // The real config registers the build-only copier.
  const plugin = flat(config.plugins as PluginOption[]).find((p) => p.name === 'labyrinth-artifacts');
  expect(plugin).toBeDefined();
  expect(plugin?.apply).toBe('build');

  // Run its hooks against a temporary outDir and compare byte for byte with ../artifacts.
  const root = mkdtempSync(join(tmpdir(), 'lab-build-'));
  try {
    const p = copyArtifacts();
    call(p.configResolved, { root, build: { outDir: 'dist' } });
    call(p.closeBundle);
    const expected = readdirSync(ARTIFACTS).filter((f) => f.endsWith('.json')).sort();
    expect(expected).toEqual(expect.arrayContaining(['manifest.json', 'geometry.json', 'spatial.json']));
    const copied = readdirSync(join(root, 'dist', 'artifacts')).filter((f) => f.endsWith('.json')).sort();
    expect(copied).toEqual(expected);
    for (const f of expected) {
      expect(readFileSync(join(root, 'dist', 'artifacts', f), 'utf8')).toBe(readFileSync(join(ARTIFACTS, f), 'utf8'));
    }
    // And a missing source fails the build loudly instead of shipping an empty replay.
    const broken = copyArtifacts(join(root, 'does-not-exist'));
    call(broken.configResolved, { root, build: { outDir: 'dist2' } });
    expect(() => call(broken.closeBundle)).toThrow(/not found/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
