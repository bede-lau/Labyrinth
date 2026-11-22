import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { PlotTrace } from './chart';
import { ForecastView } from './ForecastView';
import type { ForecastArtifact } from './model';

const plotly = vi.hoisted(() => ({
  react: vi.fn(async (_element: HTMLElement, _data: PlotTrace[]) => undefined),
  purge: vi.fn(),
}));
vi.mock('plotly.js-dist-min', () => ({ default: plotly }));

const artifact: ForecastArtifact = JSON.parse(readFileSync(resolve(__dirname, '../../../../artifacts/forecast.json'), 'utf8'));
const trace = (i: number) => plotly.react.mock.lastCall?.[1][i];
const values = (i: number) => (trace(i)?.y as (number | null)[] | undefined)?.filter(v => v !== null);
const button = (name: string) => screen.getByRole('button', { name });

function serve(body: unknown = artifact, status = 200) {
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(body), { status })));
}

beforeEach(() => {
  serve();
  plotly.react.mockClear();
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

test('the replay opens on the saved heat flux chart with controls and no visible narrative or statistics', async () => {
  const user = userEvent.setup();
  render(<ForecastView />);
  const run = await screen.findByRole('button', { name: 'Run to end' });
  expect(run).toBeEnabled();
  await waitFor(() => expect(values(0)).toEqual(artifact.steps.map(step => step.persistence)));
  expect(values(1)).toEqual(artifact.steps.map(step => step.observed));
  expect(trace(1)?.line).toMatchObject({ shape: 'spline', dash: 'solid' });
  const figure = screen.getByRole('figure');
  expect(figure).toHaveAccessibleDescription(/archived observed window mean/);
  expect(figure.querySelector('figcaption')).toHaveClass('lab-visually-hidden');
  expect(screen.queryByRole('table', { hidden: true })).toBeNull();
  expect(screen.queryByText(/PRD scores|Show the steps table|Method \(from the artifact\)|MAE ·|RMSE ·|Range of errors/)).toBeNull();

  expect(screen.queryByRole('radio', {name: 'Frozen'})).toBeNull();
  expect(screen.getByRole('heading', {name: 'Mean heat flux'})).toBeVisible();
  await user.click(button('Absolute error'));
  await waitFor(() => expect(values(0)).toEqual(artifact.steps.map(step => step.absErrPersistence)));
  expect(values(1)).toBeUndefined();
});

test('manual replay reveals one observation at a time', async () => {
  const user = userEvent.setup();
  render(<ForecastView />);
  await user.click(await screen.findByRole('button', { name: 'Start replay' }));
  await waitFor(() => expect(values(0)).toEqual([artifact.steps[0]!.persistence]));
  expect(values(1)).toEqual([]);
  await user.click(button('Reveal observed'));
  await waitFor(() => expect(values(1)).toEqual([artifact.steps[0]!.observed]));
  await user.click(button('Update'));
  expect(button('Predict')).toBeEnabled();
  expect(screen.queryByRole('button', {name: 'Show all windows'})).toBeNull();
});

test('Run to end plots every prediction before its observation at distinct times, and can pause and resume', async () => {
  render(<ForecastView />);
  await waitFor(() => expect(values(1)).toHaveLength(artifact.steps.length));
  vi.useFakeTimers();
  const tick = async (ms: number) => { await act(async () => { await vi.advanceTimersByTimeAsync(ms); }); };

  button('Run to end').focus();
  fireEvent.click(button('Run to end'));
  await tick(0);
  expect(values(0)).toHaveLength(1);
  expect(values(1)).toHaveLength(0);
  expect(button('Reveal observed')).toBeDisabled();
  await tick(200);
  expect(values(1)).toHaveLength(0);
  fireEvent.click(button('Pause'));
  await tick(1000);
  expect(values(1)).toHaveLength(0);
  expect(button('Reveal observed')).toBeEnabled();
  fireEvent.click(button('Run to end'));

  for (const [i, step] of artifact.steps.entries()) {
    expect(values(0)).toHaveLength(i + 1);
    expect(values(1)).toHaveLength(i);
    await tick(420);
    expect(values(1)).toHaveLength(i + 1);
    expect(values(1)?.at(-1)).toBe(step.observed);
    await tick(280);
    await tick(100);
  }
  expect(values(0)).toEqual(artifact.steps.map(step => step.persistence));
  expect(button('Run to end')).toBeEnabled();
  expect(button('Run to end')).toHaveFocus();
});

test('an empty artifact shows a short empty state', async () => {
  serve({ ...artifact, steps: [] });
  render(<ForecastView />);
  expect(await screen.findByText('No saved windows')).toBeInTheDocument();
  expect(screen.queryByRole('figure')).toBeNull();
});

test.each([
  [{ error: 'gone' }, 404, 'HTTP 404'],
  [{ ...artifact, schemaVersion: 3 }, 200, 'unexpected schemaVersion'],
])('unavailable artifacts show an error naming the file', async (body, status, message) => {
  serve(body, status);
  render(<ForecastView />);
  expect(await screen.findByRole('note', { name: /artifacts\/forecast\.json failed to load/ })).toHaveTextContent(message);
});
