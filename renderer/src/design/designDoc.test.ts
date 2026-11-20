// D1: DESIGN.md documents the system and stays in sync with the tokens it describes.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { STATUS_KINDS, SERIES_IDS, THEMES, themes, typeScale } from './tokens';

const doc = readFileSync(resolve(import.meta.dirname, 'DESIGN.md'), 'utf8');

test.each([
  'Principles',
  'Tokens',
  'Type scale',
  'Spacing, radius, elevation, motion',
  'Series palette',
  'Status semantics',
  'Chart conventions',
  '3D scene conventions',
  'Components',
  'Do / Don',
])('has a "%s" section', (h) => {
  expect(doc).toMatch(new RegExp(`^#{2,3} .*${h.replace(/[/]/g, '\\/')}`, 'm'));
});

test.each([...STATUS_KINDS])('documents status `%s`', (k) => {
  expect(doc).toContain(`\`${k}\``);
});

test.each(['Panel', 'Stat', 'ProvenanceBadge', 'StatusPill', 'FixtureCheck', 'SegmentedControl', 'Callout'])(
  'documents component %s',
  (c) => expect(doc).toContain(`\`${c}\``),
);

test('documents chart conventions: units in axis titles, uncertainty bands, window shading, gray = unsampled', () => {
  expect(doc).toMatch(/Units in every axis title/);
  expect(doc).toMatch(/uncertaintyBand/);
  expect(doc).toMatch(/windowShape/);
  expect(doc).toMatch(/Gray = unsampled/);
});

test('the colour values quoted in DESIGN.md are the current token values', () => {
  for (const theme of THEMES) {
    const t = themes[theme];
    for (const id of SERIES_IDS) expect(doc, `${theme} series ${id}`).toContain(t.series[id]);
    for (const k of ['bg', 'surface', 'text', 'textMuted', 'textSubtle', 'accent', 'borderStrong'] as const)
      expect(doc, `${theme} ${k}`).toContain(t.color[k]);
  }
  for (const [k, [size, lh]] of Object.entries(typeScale)) expect(doc).toContain(`| \`${k}\` | ${size} / ${lh} |`);
});
