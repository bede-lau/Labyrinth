// @vitest-environment node
// D-038: temperature colour bars read in kelvin, with 1-2-5 ticks placed on the logarithmic bar.
import { KELVIN_PER_KEV, logTicks, toMK } from './scene';

test('1 keV is 11.6 MK (1 keV / k_B, CODATA 2018: e = 1.602176634e-19 C, k_B = 1.380649e-23 J/K)', () => {
  expect(Math.abs(KELVIN_PER_KEV / ((1e3 * 1.602176634e-19) / 1.380649e-23) - 1)).toBeLessThan(1e-9);
  expect(toMK(1)).toBeCloseTo(11.6045, 4);
  expect(toMK(0.02)).toBeCloseTo(0.232, 3);
});

test('logTicks gives the 1-2-5 values inside the range, at their logarithmic place, never crowding an end', () => {
  const lo = 0.232,
    hi = 39.24;
  const ticks = logTicks(lo, hi);
  expect(ticks.map((t) => t.value)).toEqual([0.5, 1, 2, 5, 10, 20]);
  for (const t of ticks) expect(t.at).toBeCloseTo(Math.log(t.value / lo) / Math.log(hi / lo), 12);
  for (let i = 1; i < ticks.length; i++) expect(ticks[i]!.at - ticks[i - 1]!.at).toBeGreaterThanOrEqual(0.06);
  expect(logTicks(1, 1)).toEqual([]);
  expect(logTicks(0, 5)).toEqual([]);
});
