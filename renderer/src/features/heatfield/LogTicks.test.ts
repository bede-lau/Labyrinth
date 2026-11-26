// @vitest-environment node
// D-038: temperature colour bars read in kelvin, with 1-2-5 ticks placed on the logarithmic bar.
import { KELVIN_PER_KEV, linearTicks, logTicks, temperatureFraction, toMK } from './scene';

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

test('linearTicks: 1-2-5 steps at their linear place, never crowding an end; labels keep their decimals', () => {
  const ticks = linearTicks(0, 43.2);
  expect(ticks.map((t) => t.value)).toEqual([10, 20, 30, 40]);
  for (const t of ticks) expect(t.at).toBeCloseTo(t.value / 43.2, 12);
  expect(linearTicks(0, 10.01).map((t) => t.value)).toEqual([5]); // 10 sits within 6 % of the end
  expect(linearTicks(0, 3).map((t) => t.value)).toEqual([1, 2]);
  expect(linearTicks(1, 1)).toEqual([]);
});

test('temperatureFraction: logarithmic for a range above 0, linear for one from 0', () => {
  expect(temperatureFraction(0.2, [0.02, 2])).toBeCloseTo(0.5, 12);
  expect(temperatureFraction(1, [0, 2])).toBeCloseTo(0.5, 12);
  expect(temperatureFraction(-1, [0, 2])).toBe(0);
});
