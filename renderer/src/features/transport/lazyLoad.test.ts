// @vitest-environment node
// Guard for T8 (verifier finding m3): plotly.js-dist-min is ~4.6 MB and must stay out of the entry
// chunk. Typecheck, the other tests and the build all pass with a static import, so this test reads
// the import sites: no module under renderer/src may import Plotly statically, and the adapters must
// load it with a dynamic import().
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

const SRC = resolve(__dirname, '../..');
const MODULE = 'plotly\\.js-dist-min';

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return /\.(ts|tsx|mts|js|jsx|mjs)$/.test(name) && !/\.test\.(ts|tsx)$/.test(name) ? [path] : [];
  });
}

/** Static ways to pull a module into the importing chunk (type-only imports are erased and allowed). */
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

test('T8 Plotly stays lazy-loaded: no static import of plotly.js-dist-min anywhere in renderer/src', () => {
  const files = sourceFiles(SRC);
  expect(files.length).toBeGreaterThan(30);
  const offenders = files
    .map((f) => ({ file: relative(SRC, f).replace(/\\/g, '/'), hits: staticImports(readFileSync(f, 'utf8'), MODULE) }))
    .filter((x) => x.hits.length > 0);
  expect(offenders).toEqual([]);

  // The adapters that draw charts do load it, through import() (a separate chunk in the build).
  const dynamic = new RegExp(`\\bimport\\(\\s*['"]${MODULE}['"]\\s*\\)`);
  for (const adapter of ['features/transport/PlotlyChart.tsx', 'features/geometry/PlotlyChart.tsx']) {
    expect(readFileSync(join(SRC, adapter), 'utf8')).toMatch(dynamic);
  }
});

test('T8 the lazy-load guard recognises every static import form and ignores type-only and dynamic ones', () => {
  const bad = [
    `import Plotly from 'plotly.js-dist-min';`,
    `import * as Plotly from "plotly.js-dist-min";`,
    `import { react } from 'plotly.js-dist-min';`,
    `import Plotly, { react } from 'plotly.js-dist-min';`,
    `import {\n  react,\n  purge,\n} from 'plotly.js-dist-min';`,
    `import 'plotly.js-dist-min';`,
    `export * from 'plotly.js-dist-min';`,
    `export { react } from 'plotly.js-dist-min';`,
    `const P = require('plotly.js-dist-min');`,
    `import x from 'plotly.js-dist-min/plotly.min.js';`,
  ];
  for (const line of bad) expect(staticImports(line, MODULE), line).toHaveLength(1);
  const fine = [
    `plotlyPromise ??= import('plotly.js-dist-min').then((m) => m.default);`,
    `import type { PlotlyHTMLElement } from 'plotly.js-dist-min';`,
    `export type { Layout } from 'plotly.js-dist-min';`,
    `// import Plotly from elsewhere, not 'plotly.js-dist-min'`,
    `import { plotLayout } from '../../design';`,
  ];
  for (const line of fine) expect(staticImports(line, MODULE), line).toEqual([]);
});
