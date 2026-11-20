// G9 with the real chart adapter: only the Plotly library is replaced by a recorder (jsdom has no
// canvas); PlotlyChart.tsx itself runs, so what the |B|(θ*) spec becomes on the way to Plotly is tested.
import { render, screen, waitFor } from '@testing-library/react';
import { geometryFixture } from './fixture';
import { bmagChartSpec, tubeById } from './model';
import { PlotlyChart } from './PlotlyChart';

const plotly = vi.hoisted(() => ({ react: vi.fn(async () => undefined), purge: vi.fn() }));
vi.mock('plotly.js-dist-min', () => ({ default: plotly }));

beforeEach(() => {
  plotly.react.mockClear();
  plotly.purge.mockClear();
});

type Call = [HTMLElement, Record<string, unknown>[], Record<string, unknown>, Record<string, unknown>];
const lastCall = () => plotly.react.mock.calls.at(-1) as unknown as Call;

test('G9 the |B|(θ*) spec reaches Plotly unchanged, on a labelled image, and is purged on unmount', async () => {
  const g = geometryFixture();
  const bean = bmagChartSpec(tubeById(g, 'bean'), 'light');
  const view = render(
    <>
      <PlotlyChart className="geo-chart__plot" data={bean.data} layout={bean.layout} ariaLabel={bean.ariaLabel} describedBy="chart-summary" />
      <p id="chart-summary">{bean.summary}</p>
    </>,
  );
  const chart = screen.getByRole('img', { name: /\|B\| in units of B_ref against field-line angle θ\* in radians, Bean/ });
  expect(chart).toHaveClass('geo-chart__plot');
  expect(chart).toHaveAccessibleDescription(bean.summary);
  await waitFor(() => expect(plotly.react).toHaveBeenCalledTimes(1));
  const [el, data, layout, config] = lastCall();
  expect(el).toBe(chart);
  // The numbers drawn are the tube's samples, with units on both axes.
  expect(data).toBe(bean.data);
  expect(layout).toBe(bean.layout);
  const tube = tubeById(g, 'bean');
  expect(data[0]).toMatchObject({ x: tube.samples.map((s) => s.thetaStar), y: tube.samples.map((s) => s.bmag) });
  const axes = layout as { xaxis: { title: { text: string } }; yaxis: { title: { text: string } } };
  expect(axes.xaxis.title.text).toBe('Field-line angle θ* (rad)');
  expect(axes.yaxis.title.text).toBe('Field strength |B| (B<sub>ref</sub>)');
  expect(config).toMatchObject({ displaylogo: false, responsive: true });

  // Switching tubes redraws with the other tube's samples (the fixture tubes differ in |B|).
  const tri = bmagChartSpec(tubeById(g, 'triangular'), 'light');
  expect((tri.data[0] as { y: number[] }).y).not.toEqual((bean.data[0] as { y: number[] }).y);
  view.rerender(
    <>
      <PlotlyChart className="geo-chart__plot" data={tri.data} layout={tri.layout} ariaLabel={tri.ariaLabel} describedBy="chart-summary" />
      <p id="chart-summary">{tri.summary}</p>
    </>,
  );
  await waitFor(() => expect(plotly.react).toHaveBeenCalledTimes(2));
  expect(lastCall()[1]).toBe(tri.data);
  expect(lastCall()[0]).toBe(chart);
  expect(screen.getByRole('img', { name: /Triangular/ })).toBe(chart);
  expect(screen.queryByRole('note')).toBeNull();

  view.unmount();
  expect(plotly.purge).toHaveBeenCalledWith(chart);
});

test('G9 a chart that cannot be drawn says so instead of leaving an empty box', async () => {
  plotly.react.mockRejectedValueOnce(new Error('Plotly refused the layout'));
  const spec = bmagChartSpec(tubeById(geometryFixture(), 'bean'), 'dark');
  render(<PlotlyChart data={spec.data} layout={spec.layout} ariaLabel={spec.ariaLabel} />);
  const note = await screen.findByRole('note', { name: /Chart failed to load/ });
  expect(note).toHaveTextContent('Plotly refused the layout');
  expect(screen.getByRole('img', { name: spec.ariaLabel })).toBeInTheDocument();
});
