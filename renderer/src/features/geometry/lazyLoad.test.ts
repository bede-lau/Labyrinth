// @vitest-environment node
// Guard for G7 (verifier finding 4): three is ~740 kB and must stay out of the entry chunk. A static
// import passes typecheck, every other test and the build, so this test reads the import sites: no
// module under renderer/src may import three statically (type-only imports are erased and allowed),
// and the scene adapter must load it with a dynamic import().
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

const SRC = resolve(__dirname, '../..');
const MODULE = 'three';

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return /\.(ts|tsx|mts|js|jsx|mjs)$/.test(name) && !/\.test\.(ts|tsx)$/.test(name) ? [path] : [];
  });
}

/** Static ways to pull a module into the importing chunk. */
function staticImports(source: string, moduleRe: string): string[] {
  const spec = `['"]${moduleRe}(?:/[^'"]*)?['"]`;
  const patterns = [
    new RegExp(`^[ \\t]*import\\s+(?!type\\s)[^;'"]*?\\sfrom\\s*${spec}`, 'gm'),
    new RegExp(`^[ \\t]*import\\s*${spec}`, 'gm'),
    new RegExp(`^[ \\t]*export\\s+(?!type\\s)[^;'"]*?\\sfrom\\s*${spec}`, 'gm'),
    new RegExp(`\\brequire\\(\\s*${spec}\\s*\\)`, 'g'),
  ];
  return patterns.flatMap((p) => source.match(p) ?? []);
}

test('G7 three stays lazy-loaded: no static import of three anywhere in renderer/src', () => {
  const files = sourceFiles(SRC);
  expect(files.length).toBeGreaterThan(30);
  const offenders = files
    .map((f) => ({ file: relative(SRC, f).replace(/\\/g, '/'), hits: staticImports(readFileSync(f, 'utf8'), MODULE) }))
    .filter((x) => x.hits.length > 0);
  expect(offenders).toEqual([]);

  // The scene adapter does load it, inside an effect, through import() (a separate chunk in the build).
  const adapter = readFileSync(join(SRC, 'features/geometry/FluxScene.tsx'), 'utf8');
  expect(adapter).toMatch(/\bimport\(\s*['"]three['"]\s*\)/);
  // Everything else it says about three is a type (erased at build time).
  expect(adapter).toMatch(/type Three = typeof import\('three'\)/);
});

test('G7 the lazy-load guard recognises every static import form and ignores type-only and dynamic ones', () => {
  const bad = [
    `import * as THREE from 'three';`,
    `import { WebGLRenderer } from "three";`,
    `import THREE, { Scene } from 'three';`,
    `import {\n  Scene,\n  Color,\n} from 'three';`,
    `import 'three';`,
    `export * from 'three';`,
    `export { Scene } from 'three';`,
    `const T = require('three');`,
    `import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';`,
  ];
  for (const line of bad) expect(staticImports(line, MODULE), line).toHaveLength(1);
  const fine = [
    `import('three').then((THREE) => new THREE.Scene());`,
    `import type { Scene } from 'three';`,
    `type Three = typeof import('three');`,
    `renderer: import('three').WebGLRenderer;`,
    `import { threeish } from './three-utils';`,
    `import x from 'threejs-other';`,
  ];
  for (const line of fine) expect(staticImports(line, MODULE), line).toEqual([]);
});
