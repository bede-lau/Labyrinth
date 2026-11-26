// @vitest-environment node
// D-039: the heat comets follow the model. Streams from the core to every divertor (more comets where more power
// lands), transfer paths only when a coil moves power, and every comet moves the right way along its path.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import * as THREE from 'three';
import type { HeatfieldArtifact } from '../heatfield/types';
import { buildFlowArrows, PULSE_SECONDS, type FlowPath } from './flowArrows';
import { fiveTargetScenario, startupSimulation } from './heatedEdge';

const saved: HeatfieldArtifact = JSON.parse(readFileSync(resolve(__dirname, '../../../../artifacts/heatfield.json'), 'utf8'));

/** Where (0–1) a point sits along a path: the nearest of 400 samples. */
const along = (path: FlowPath, p: THREE.Vector3) => {
  let best = 0;
  for (let k = 1; k <= 400; k++) if (path.curve.getPointAt(k / 400).distanceTo(p) < path.curve.getPointAt(best / 400).distanceTo(p)) best = k;
  return best / 400;
};

test('streams run along the edge into every divertor from both sides, comets move toward the plates, and a coil adds transfer paths from its divertor', () => {
  const art = fiveTargetScenario(saved);
  const sim = startupSimulation(art);
  const n = sim.model.nDiverters;
  const dt = sim.model.params.dt;
  const flow = buildFlowArrows(THREE, art);
  // Before the heating: nothing flows.
  flow.update(sim, true);
  expect(flow.paths()).toHaveLength(0);

  sim.advance(Math.round(1 / dt));
  flow.update(sim, true);
  let paths = flow.paths();
  // Every divertor is fed from both sides along the edge: two streams each, ending at its plate.
  expect(paths.filter((p) => p.kind === 'stream')).toHaveLength(2 * n);
  for (let k = 0; k < n; k++) expect(paths.filter((p) => p.name.startsWith(`edge to D${k + 1} `))).toHaveLength(2);
  const s0 = paths[0]!;
  const k0 = Number(s0.name.split(' ')[2]!.slice(1)) - 1;
  const angle0 = (v: THREE.Vector3) => Math.atan2(v.y, v.x);
  const gap0 = (a: number, b: number) => Math.abs(Math.atan2(Math.sin(a - b), Math.cos(a - b)));
  // Every stream starts halfway to a neighbour and ends at its own divertor's toroidal angle (both wrap cases included).
  for (const p of paths) {
    const k = Number(p.name.split(' ')[2]!.slice(1)) - 1;
    expect(gap0(angle0(p.curve.getPoint(1)), sim.model.phiK[k]!)).toBeLessThan(0.1);
    expect(gap0(angle0(p.curve.getPoint(0)), sim.model.phiK[k]!)).toBeGreaterThan(0.3);
  }
  expect(k0).toBe(0);
  // Comets move toward the plate: about a tenth of the stream in a tenth of PULSE_SECONDS (modulo a wrap to the start).
  const a0 = along(s0, flow.head(0, 0));
  sim.advance(Math.round((0.1 * PULSE_SECONDS) / dt));
  flow.update(sim, true);
  const a1 = along(flow.paths()[0]!, flow.head(0, 0));
  expect((a1 - a0 + 1) % 1).toBeGreaterThan(0.05);
  expect((a1 - a0 + 1) % 1).toBeLessThan(0.15);

  // D3's coil on: D3 receives least (fewest/dimmest comets) and transfer paths leave D3 for every other divertor.
  sim.setCoil(2, true);
  sim.advance(sim.responseSteps + 2);
  flow.update(sim, true);
  paths = flow.paths();
  const streams = paths.filter((p) => p.kind === 'stream');
  const transfers = paths.filter((p) => p.kind === 'transfer');
  const d3 = streams.filter((p) => p.name.startsWith('edge to D3 '));
  expect(Math.min(...streams.map((p) => p.weight))).toBe(d3[0]!.weight);
  expect(d3[0]!.comets).toBeLessThanOrEqual(Math.min(...streams.map((p) => p.comets)));
  expect(transfers.map((p) => p.name.split(' to ')[0])).toEqual(new Array(n - 1).fill('D3'));
  // Each transfer starts at D3's toroidal angle and ends at its receiver's; its arrowhead points on toward the receiver.
  const angle = (v: THREE.Vector3) => Math.atan2(v.y, v.x);
  const gap = (a: number, b: number) => Math.abs(Math.atan2(Math.sin(a - b), Math.cos(a - b)));
  const step = (2 * Math.PI) / art.grid.nPhi;
  for (const t of transfers) {
    const to = Number(t.name.split(' to D')[1]) - 1;
    expect(gap(angle(t.curve.getPoint(0)), sim.model.phiK[2]!)).toBeLessThan(4 * step);
    expect(gap(angle(t.curve.getPoint(1)), sim.model.phiK[to]!)).toBeLessThan(4 * step);
    const tip = flow.guides.children.find((c) => c.name === t.name + ' tip')!;
    const ahead = t.curve.getPoint(1).clone().addScaledVector(new THREE.Vector3(0, 1, 0).applyQuaternion(tip.quaternion), 0.5);
    expect(gap(angle(ahead), sim.model.phiK[to]!)).toBeLessThan(gap(angle(t.curve.getPoint(1)), sim.model.phiK[to]!) + 1e-9);
  }
  // Transfer weights are largest first, and larger transfers carry at least as many comets.
  for (let i = 1; i < transfers.length; i++) {
    expect(transfers[i]!.weight).toBeLessThanOrEqual(transfers[i - 1]!.weight);
    expect(transfers[i]!.comets).toBeLessThanOrEqual(transfers[i - 1]!.comets);
  }
  flow.update(sim, false);
  expect(flow.group.visible).toBe(false);
});
