// @vitest-environment node
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { accuracy, percentErrors, significance, tCritical, tPValue } from './accuracy';
import { INITIAL, completeState, type ForecastArtifact } from './model';

const art: ForecastArtifact = JSON.parse(readFileSync(resolve(__dirname, '../../../../artifacts/forecast.json'), 'utf8'));

test('Student t helpers match the table', () => {
  expect(tCritical(7)).toBeCloseTo(2.365, 3);
  expect(tPValue(2.365, 7)).toBeCloseTo(0.05, 3);
});

test('percentage errors and their statistics come from the revealed window means only', async () => {
  expect(accuracy(art.steps, INITIAL)).toBeNull();
  const all = completeState(art.steps.length);
  const p = percentErrors(art.steps, all).persistence[0]!;
  const s0 = art.steps[0]!;
  expect(p.abs).toBeCloseTo((100 * Math.abs(s0.persistence - s0.observed)) / s0.observed, 10);
  const acc = accuracy(art.steps, all)!;
  expect(acc.n).toBe(art.steps.length);
  const mape = (100 / acc.n) * art.steps.reduce((sum, st) => sum + Math.abs(st.persistence - st.observed) / st.observed, 0);
  expect(acc.forecasters.persistence.mape).toBeCloseTo(mape, 10);
  expect(acc.forecasters.persistence.ci![0]).toBeLessThan(mape);
  expect(significance(acc).length).toBeGreaterThan(2);
  if (process.env.ACC_REPORT) (await import('node:fs')).writeFileSync(process.env.ACC_REPORT, JSON.stringify(acc, null, 1) + '\n' + significance(acc).join('\n'));
});
