// F7 with the real chart adapter: only the Plotly library is replaced by a recorder (jsdom has no canvas), so
// what the forecast spec becomes on its way to Plotly, and the figure around it, are tested.
import { render, screen, waitFor } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { forecastChartSpec } from './chart';
import { INITIAL, advance, type ForecastArtifact } from './model';
import { PlotlyChart } from './PlotlyChart';

const plotly = vi.hoisted(() => ({ react: vi.fn(async () => undefined), purge: vi.fn() }));
vi.mock('plotly.js-dist-min', () => ({ default: plotly }));

const ARTIFACT: ForecastArtifact = JSON.parse(readFileSync(resolve(__dirname, '../../../../artifacts/forecast.json'), 'utf8'));
type Call = [HTMLElement, unknown[], unknown, Record<string, unknown>];
const calls = () => plotly.react.mock.calls as unknown as Call[];

beforeEach(() => {
  plotly.react.mockClear();
  plotly.purge.mockClear();
});

test('F7 the Plotly adapter draws the spec in a named figure (not role="img"), described by its summary, and purges on unmount', async () => {
  const spec = forecastChartSpec(ARTIFACT, INITIAL, 'persistence', 'light');
  const chart = (sp: typeof spec) => <PlotlyChart data={sp.data} layout={sp.layout} label={sp.label} caption={sp.caption} />;
  const view = render(chart(spec));
  const figure = screen.getByRole('figure', { name: spec.label });
  expect(figure).toHaveAccessibleDescription(spec.summary);
  expect(figure.querySelector('figcaption')).toHaveClass('lab-visually-hidden');
  expect(figure.querySelector('figcaption')).toHaveTextContent(spec.summary);
  expect(figure.querySelector('[role="img"]')).toBeNull();
  await waitFor(() => expect(plotly.react).toHaveBeenCalledTimes(1));
  const [el, data, layout, config] = calls()[0]!;
  expect(figure).toContainElement(el);
  expect(el).toBe(screen.getByTestId('forecast-plot'));
  expect(data).toBe(spec.data);
  expect(layout).toBe(spec.layout);
  expect(config).toMatchObject({ displaylogo: false, responsive: true });

  // The same spec does not redraw; the next state's spec does.
  view.rerender(chart(spec));
  const next = forecastChartSpec(ARTIFACT, advance(INITIAL, ARTIFACT.steps.length), 'persistence', 'light');
  view.rerender(chart(next));
  await waitFor(() => expect(plotly.react).toHaveBeenCalledTimes(2));
  expect(calls()[1]![1]).toBe(next.data);
  expect(screen.getByRole('figure')).toHaveAccessibleDescription(next.summary);

  view.unmount();
  await waitFor(() => expect(plotly.purge).toHaveBeenCalledWith(el));
});

test('F7 (DZ3-8) a unit in the hidden caption is spoken as words in the figure’s description', async () => {
  const spec = forecastChartSpec(ARTIFACT, advance(INITIAL, ARTIFACT.steps.length), 'persistence', 'light');
  expect(spec.summary).toMatch(/ Heat flux in Q gB,i\.$/);
  render(<PlotlyChart data={spec.data} layout={spec.layout} label={spec.label} caption={spec.caption} />);
  const figure = screen.getByRole('figure', { name: spec.label });
  // Heard: the description is the spoken summary, word for word.
  expect(figure).toHaveAccessibleDescription(spec.summary);
  // Seen: Q with subscript gB,i, hidden from assistive technology, which reads the spoken copy beside it instead.
  const figcaption = figure.querySelector('figcaption')!;
  const typeset = figcaption.querySelector('[aria-hidden="true"]')!;
  expect(typeset.innerHTML).toBe('<span><span>Q</span><sub>gB,i</sub></span>');
  const spoken = typeset.nextElementSibling!;
  expect(spoken).toHaveClass('lab-visually-hidden');
  expect(spoken.textContent).toBe('Q gB,i');
  const seen = figcaption.cloneNode(true) as Element;
  seen.querySelector('.lab-visually-hidden')!.remove();
  expect(seen.textContent).toMatch(/ Heat flux in QgB,i\.$/);
  expect(seen.textContent).not.toMatch(/Q gB|[_{}]/);
  await waitFor(() => expect(plotly.react).toHaveBeenCalledTimes(1));
});

test('F7 a chart that cannot be drawn says so beside its text summary instead of leaving an empty box', async () => {
  plotly.react.mockRejectedValueOnce(new Error('Plotly refused the layout'));
  const spec = forecastChartSpec(ARTIFACT, INITIAL, 'frozen', 'dark');
  render(<PlotlyChart data={spec.data} layout={spec.layout} label={spec.label} caption={spec.caption} />);
  const note = await screen.findByRole('note', { name: /Chart could not be drawn/ });
  expect(note).toHaveTextContent('Plotly refused the layout');
  expect(screen.getByRole('figure', { name: spec.label })).toContainElement(note);
  expect(screen.getByRole('figure').querySelector('figcaption')).toHaveTextContent(spec.summary);
});
