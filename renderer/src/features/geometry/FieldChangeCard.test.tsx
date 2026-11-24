import { act, render, screen, within } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fiveTargetScenario, startupSimulation } from './heatedEdge';
import { FieldChangeCard, sampleFieldChange } from './FieldChangeCard';

test('graphs the applied field at the periodic seam and logs its signed sweep on simulation time', () => {
  const art = JSON.parse(readFileSync(resolve(__dirname, '../../../../artifacts/heatfield.json'), 'utf8'));
  const sim = startupSimulation(fiveTargetScenario(art));
  const view = render(<FieldChangeCard sim={sim} />);
  const table = within(screen.getByRole('table', {name: 'Field change log'}));
  expect(sampleFieldChange(sim).peaks).toEqual([]);
  expect(table.getAllByRole('row')).toHaveLength(2);
  act(() => {
    sim.setCoil(0, true);
    sim.advance(Math.round(0.5 / sim.model.params.dt));
  });
  const peak = sampleFieldChange(sim).peaks[0]!;
  expect(peak.angle).toBe(0);
  expect(peak.change).toBeCloseTo(sim.model.params.epsilon, 5);
  expect(table.getByText('+0.0300')).toBeInTheDocument();
  act(() => sim.advance(Math.round(0.25 / sim.model.params.dt)));
  expect(table.getByText('−0.0300')).toBeInTheDocument();
  expect(table.getByText('0.75 s')).toBeInTheDocument();
  view.unmount();
  expect(sim.listenerCount).toBe(0);
});
