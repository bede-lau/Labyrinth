// D-039: the explorer's power-flow panel shows the model's transfer between divertors and follows the simulation.
import { act, render, screen, within } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { HeatfieldArtifact } from '../heatfield/types';
import { powerTransfer } from '../heatfield/transfer';
import { fiveTargetScenario, startupSimulation } from './heatedEdge';
import { PowerFlow } from './PowerFlow';

const saved: HeatfieldArtifact = JSON.parse(readFileSync(resolve(__dirname, '../../../../artifacts/heatfield.json'), 'utf8'));

test('coils off: nothing moved; a coil on D1: D1 sheds, every other divertor gains, arrows leave D1 only', () => {
  const sim = startupSimulation(fiveTargetScenario(saved));
  const dt = sim.model.params.dt;
  sim.advance(Math.round(1 / dt)); // heating on and filled (τ_E 0.13 s)
  render(<PowerFlow sim={sim} />);
  const ring = screen.getByRole('img', { name: /Top view of the torus/ });
  expect(ring).toHaveAccessibleName(/No power is being moved: every coil is off\./);
  expect(ring.querySelectorAll('.geo-flow__arrow')).toHaveLength(0);

  act(() => {
    sim.setCoil(0, true);
    sim.advance(sim.responseSteps + 2);
  });
  const t = powerTransfer(sim.model, sim.state.n, sim.coils);
  expect(t.delta[0]).toBeLessThan(0);
  const arrows = [...ring.querySelectorAll<SVGPathElement>('.geo-flow__arrow')];
  expect(arrows.length).toBe(sim.model.nDiverters - 1);
  expect(arrows.every((a) => a.dataset.from === '0')).toBe(true);
  expect(ring).toHaveAccessibleName(/Arrows round the plasma edge: D1 to D\d, \d+\.\d\d MW/);
  // The ledger prints the model's numbers: D1's share and its (negative) change; the changes total zero.
  const d1 = screen.getByTestId('flow-row-0');
  expect(within(d1).getAllByRole('cell')[0]).toHaveTextContent(t.shares[0]!.toFixed(2));
  expect(within(d1).getAllByRole('cell')[1]).toHaveTextContent('−' + Math.abs(t.delta[0]!).toFixed(2));
  expect(screen.getByRole('row', { name: /^Total/ })).toHaveTextContent(/[±+−]0\.00$/);
  expect(ring.querySelector('[data-change=loss]')).not.toBeNull();
  expect(ring.querySelectorAll('[data-change=gain]')).toHaveLength(sim.model.nDiverters - 1);
});
