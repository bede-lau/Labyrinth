// @vitest-environment node
// F7: plotly.js-dist-min (~4.6 MB) stays out of the entry chunk. transport/lazyLoad.test.ts scans all of
// renderer/src for static imports; this pins the forecast chart's own adapter to a dynamic import().
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const STATIC = [
  /^[ \t]*import\s+(?!type\s)[^;'"]*?\sfrom\s*['"]plotly\.js-dist-min(?:\/[^'"]*)?['"]/m,
  /^[ \t]*import\s*['"]plotly\.js-dist-min(?:\/[^'"]*)?['"]/m,
  /^[ \t]*export\s+(?!type\s)[^;'"]*?\sfrom\s*['"]plotly\.js-dist-min(?:\/[^'"]*)?['"]/m,
  /\brequire\(\s*['"]plotly\.js-dist-min/,
];

test('F7 the forecast chart loads Plotly lazily: import() in its adapter, no static import anywhere in the feature', () => {
  const src = (f: string) => readFileSync(resolve(__dirname, f), 'utf8');
  expect(src('PlotlyChart.tsx')).toMatch(/\bimport\(\s*['"]plotly\.js-dist-min['"]\s*\)/);
  for (const f of ['PlotlyChart.tsx', 'ForecastChart.tsx', 'ForecastView.tsx', 'chart.ts', 'model.ts'])
    for (const re of STATIC) expect(src(f), `${f}: ${re}`).not.toMatch(re);
  // The guard can fail.
  expect(`import Plotly from 'plotly.js-dist-min';`).toMatch(STATIC[0]!);
});
