// @vitest-environment node
// D-039: power moved between divertors by the coils, from the model's own shares.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createModel } from './model';
import { largestFlows, powerTransfer } from './transfer';
import type { HeatfieldArtifact } from './types';

const ART = JSON.parse(readFileSync(resolve(__dirname, '../../../../artifacts/heatfield.json'), 'utf8')) as HeatfieldArtifact;
const model = createModel(ART);
const P = model.params;
const n = model.nDiverters;
const OFF = new Array<number>(n).fill(0);
const sum = (a: ArrayLike<number>) => Array.from(a).reduce((x, y) => x + y, 0);
const coil = (...on: number[]) => OFF.map((_, k) => (on.includes(k) ? 1 : 0));

test('with every coil off nothing is moved: the shares are the base split', () => {
  const t = powerTransfer(model, 0, OFF);
  expect(Array.from(t.delta)).toEqual(new Array(n).fill(0));
  expect(t.moved).toBe(0);
  expect(Array.from(t.flows).every((f) => f === 0)).toBe(true);
  // The base split carries the whole edge power P_heat (1 − f_rad).
  expect(sum(t.base) / (P.Pheat * (1 - P.fRad)) - 1).toBeCloseTo(0, 12);
});

test('one coil: its divertor sheds power and only it sends; every other divertor receives (energy conserved)', () => {
  const t = powerTransfer(model, 0, coil(0));
  expect(t.delta[0]).toBeLessThan(0);
  for (let j = 1; j < n; j++) expect(t.delta[j]).toBeGreaterThan(0);
  expect(Math.abs(sum(t.delta))).toBeLessThan(1e-12);
  // Independently from the share formula (MODEL.md v6): the coil scales D1's weight by f = 1 − η against the others.
  for (let j = 1; j < n; j++) expect(t.shares[0]! / t.shares[j]! / (t.base[0]! / t.base[j]!)).toBeCloseTo(1 - P.shareShift, 12);
  // Only row 0 is non-zero; it sums to D1's loss, and each column to that divertor's gain.
  for (let k = 1; k < n; k++) for (let j = 0; j < n; j++) expect(t.flows[k * n + j]).toBe(0);
  expect(sum(t.flows.subarray(0, n))).toBeCloseTo(-t.delta[0]!, 12);
  for (let j = 1; j < n; j++) expect(t.flows[j]).toBeCloseTo(t.delta[j]!, 12);
  expect(t.moved).toBeCloseTo(-t.delta[0]!, 12);
  expect(largestFlows(t).every(([from]) => from === 0)).toBe(true);
});

test('two coils: rows sum to each loser’s loss, columns to each gainer’s gain, and no divertor sends to itself', () => {
  const t = powerTransfer(model, 0, coil(0, 2));
  for (let k = 0; k < n; k++) {
    let row = 0;
    let col = 0;
    for (let j = 0; j < n; j++) {
      row += t.flows[k * n + j]!;
      col += t.flows[j * n + k]!;
    }
    expect(row).toBeCloseTo(Math.max(0, -t.delta[k]!), 12);
    expect(col).toBeCloseTo(Math.max(0, t.delta[k]!), 12);
    expect(t.flows[k * n + k]).toBe(0);
  }
  const flows = largestFlows(t);
  for (let i = 1; i < flows.length; i++) expect(flows[i]![2]).toBeLessThanOrEqual(flows[i - 1]![2]);
});
