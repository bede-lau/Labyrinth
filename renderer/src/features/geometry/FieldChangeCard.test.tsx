import { act, render, screen, within } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fiveTargetScenario, startupSimulation } from './heatedEdge';
import { createParticleTracks } from './particleTracks';
import { FieldChangeCard, sampleFieldChange } from './FieldChangeCard';

test('graphs the applied field at the periodic seam and logs its signed sweep on simulation time', () => {
  const art = JSON.parse(readFileSync(resolve(__dirname, '../../../../artifacts/heatfield.json'), 'utf8'));
  const scenario = fiveTargetScenario(art);
  const sim = startupSimulation(scenario);
  const tracks = createParticleTracks(scenario, sim);
  const view = render(<FieldChangeCard sim={sim} tracks={tracks} followed={null} />);
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

test('follows the same particle angle and receiver through rerouting, paused selection and deselection', () => {
  const art = fiveTargetScenario(JSON.parse(readFileSync(resolve(__dirname, '../../../../artifacts/heatfield.json'), 'utf8')));
  const sim = startupSimulation(art);
  const tracks = createParticleTracks(art, sim);
  const card = (followed: number | null) => <FieldChangeCard sim={sim} tracks={tracks} followed={followed} />;
  const view = render(card(1));
  const img = screen.getByRole('img');
  for (const to of [4, 1]) {
    act(() => {
      sim.setCoils([1,0,0,0,0], [{from: 0, to, fraction: 0.2}]);
      sim.advance(300);
    });
    const angle = tracks.read()[0]!.phi * 180 / Math.PI;
    expect(Number(img.querySelector('.field-change__cursor circle')!.getAttribute('cx'))).toBeCloseTo(47 + 289 * angle / 360);
    expect(img.querySelector('.field-change__target-label')).toHaveTextContent('D' + (to + 1));
  }
  view.rerender(card(2));
  expect(img).toHaveAccessibleName(/P2 at/);
  expect(img.querySelector('.field-change__target-label')).toBeNull();
  view.rerender(card(null));
  expect(img.querySelector('.field-change__cursor')).toBeNull();
});
