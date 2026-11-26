// @vitest-environment node
// D-039: the 3D arrows follow the model's transfer: none with the coils off, one per receiver from the shedding divertor.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import * as THREE from 'three';
import type { Mesh, TubeGeometry } from 'three';
import type { HeatfieldArtifact } from '../heatfield/types';
import { buildFlowArrows, PULSE_SECONDS } from './flowArrows';
import { fiveTargetScenario, startupSimulation } from './heatedEdge';

const saved: HeatfieldArtifact = JSON.parse(readFileSync(resolve(__dirname, '../../../../artifacts/heatfield.json'), 'utf8'));

test('arrows appear only when power is moved, run from the losing divertor, and are thicker for larger flows', () => {
  const art = fiveTargetScenario(saved);
  const sim = startupSimulation(art);
  sim.advance(Math.round(1 / sim.model.params.dt));
  const flow = buildFlowArrows(THREE, art);
  flow.update(sim, true);
  expect(flow.arrows.children).toHaveLength(0);
  expect(flow.pulses.children).toHaveLength(0);
  sim.setCoil(2, true);
  sim.advance(sim.responseSteps + 2);
  flow.update(sim, true);
  const shafts = flow.arrows.children.filter((c) => c.name) as Mesh[];
  expect(shafts.map((s) => s.name.split(' to ')[0])).toEqual(new Array(sim.model.nDiverters - 1).fill('D3'));
  expect(flow.arrows.children).toHaveLength(2 * shafts.length);
  // Each arrow starts at D3's toroidal angle and ends at its receiver's, the short way round, its head pointing on.
  const angle = (x: number, y: number) => Math.atan2(y, x);
  const gap = (a: number, b: number) => Math.abs(Math.atan2(Math.sin(a - b), Math.cos(a - b)));
  const step = (2 * Math.PI) / art.grid.nPhi;
  for (const [i, s] of shafts.entries()) {
    const to = Number(s.name.split(' to D')[1]) - 1;
    const path = (s.geometry as TubeGeometry).parameters.path;
    const a = path.getPoint(0);
    const b = path.getPoint(1);
    expect(gap(angle(a.x, a.y), sim.model.phiK[2]!)).toBeLessThan(3 * step);
    expect(gap(angle(b.x, b.y), sim.model.phiK[to]!)).toBeLessThan(3 * step);
    const head = flow.arrows.children[2 * i + 1]!;
    const pointing = new THREE.Vector3(0, 1, 0).applyQuaternion(head.quaternion);
    const ahead = b.clone().addScaledVector(pointing, 0.5);
    expect(gap(angle(ahead.x, ahead.y), sim.model.phiK[to]!)).toBeLessThan(gap(angle(b.x, b.y), sim.model.phiK[to]!) + 1e-9);
  }
  const radii = shafts.map((s) => (s.geometry as TubeGeometry).parameters.radius);
  for (let i = 1; i < radii.length; i++) expect(radii[i]).toBeLessThanOrEqual(radii[i - 1]!);
  // Pulses run from the sender to the receiver: a bead just past the start moves on along its arrow as time passes.
  expect(flow.pulses.children.length).toBeGreaterThanOrEqual(2 * shafts.length);
  const path0 = (shafts[0]!.geometry as TubeGeometry).parameters.path;
  const along = (p: THREE.Vector3) => {
    let best = 0;
    for (let k = 1; k <= 200; k++) if (path0.getPointAt(k / 200).distanceTo(p) < path0.getPointAt(best / 200).distanceTo(p)) best = k;
    return best / 200;
  };
  const before = along(flow.pulses.children[0]!.position.clone());
  sim.advance(Math.round((0.1 * PULSE_SECONDS) / sim.model.params.dt));
  flow.update(sim, true);
  // Re-read: a changed flow rebuilds the beads (same phase), so take the first bead again.
  const after = along(flow.pulses.children[0]!.position.clone());
  expect((after - before + 1) % 1).toBeGreaterThan(0.05);
  expect((after - before + 1) % 1).toBeLessThan(0.15);
  flow.update(sim, false);
  expect(flow.group.visible).toBe(false);
});
