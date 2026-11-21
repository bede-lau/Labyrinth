// Forecast replay view: the owner's redesign (bbf2fc6: one panel, opens on all eight saved windows, the
// "Comparison metric" toggle, step-through on request) combined with D-026 / D-028 (Predicted vs Actual, MSE,
// RMSE, range of MSE, range of errors, Run to end, the PRD mismatch kept visible).
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { forecastStyle, formatNumber, formatSigned, formatWindow } from '../../design';
import { liveStatusStore, modePills, type LiveStatus, type LiveWorker } from '../../lib/liveStatus';
import { absErrorRange, errorLineStyle, fluxRange } from './chart';
import { ForecastView } from './ForecastView';
import {
  INITIAL,
  advance,
  completeState,
  mismatchedScores,
  nextAction,
  parseSampleAndHold,
  runningMae,
  sampleAndHoldMatchesPrd,
  visibility,
  type ForecastArtifact,
  type ForecastStep,
  type Phase,
} from './model';

// jsdom cannot draw Plotly: the library is replaced by a recorder, so the spec it receives is what is tested.
const plotly = vi.hoisted(() => ({ react: vi.fn(async (..._args: unknown[]) => undefined), purge: vi.fn() }));
vi.mock('plotly.js-dist-min', () => ({ default: plotly }));

const ARTIFACT: ForecastArtifact = JSON.parse(readFileSync(resolve(__dirname, '../../../../artifacts/forecast.json'), 'utf8'));
const clone = (): ForecastArtifact => JSON.parse(JSON.stringify(ARTIFACT)) as ForecastArtifact;

/** One /api/live/status answer: a snapshot, a 404 (null) or no answer ('reject'). A list is answered in turn, its last repeated. */
type Api = LiveStatus | null | 'reject';
function serve(artifact: unknown = ARTIFACT, status = 200, live: Api | Api[] = null) {
  const answers = Array.isArray(live) ? live : [live];
  let n = 0;
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === '/artifacts/forecast.json') return new Response(JSON.stringify(artifact), { status });
      if (url === '/api/live/status') {
        const next = answers[Math.min(n++, answers.length - 1)];
        if (next === 'reject') throw new TypeError('network down');
        if (next) return new Response(JSON.stringify(next));
      }
      return new Response('nope', { status: 404 });
    }),
  );
}
beforeEach(() => {
  serve();
  plotly.react.mockClear();
  plotly.purge.mockClear();
});
afterEach(() => vi.unstubAllGlobals());

const f3 = (v: number) => formatNumber(v, 3);
const f4 = (v: number) => formatNumber(v, 4);
const cells = (i: number) => [...screen.getByTestId(`step-${i}`).querySelectorAll('td')].map((td) => td.textContent);
const DASHES = ['—', '—', '—', '—', '—'];
const FOLLOWING = Node.DOCUMENT_POSITION_FOLLOWING;
const squash = (s: string | null | undefined) => (s ?? '').replace(/\s+/g, ' ').trim();

type State = { index: number; phase: Phase };
const N_STEPS = ARTIFACT.steps.length;
/** The overview and the completed replay: every window predicted, revealed and scored. */
const END: State = completeState(N_STEPS);
/** Every state of a step-through replay, in order: "Start replay" predicts window 1, then 3 presses per window. */
const REPLAY_STATES: State[] = (() => {
  const out = [advance(INITIAL, N_STEPS)];
  while (nextAction(out.at(-1)!, N_STEPS) !== 'done') out.push(advance(out.at(-1)!, N_STEPS));
  return out;
})();
/** The one forecast panel (owner's redesign), named by its title. */
const panel = () => screen.getByRole('region', { name: /50-unit mean heat flux/ });
const stepButton = () => document.querySelector<HTMLButtonElement>('.fc-btn--primary')!;
type User = ReturnType<typeof userEvent.setup>;
/** From the overview: "Start replay" (which predicts window 1). Returns the step button. */
async function startReplay(user: User) {
  const button = await screen.findByRole('button', { name: 'Start replay' });
  await user.click(button);
  return button;
}

/* Error statistics (F8), recomputed here and not with model.ts. */
const Q = 'Q gB,i';
const Q2 = 'Q gB,i²';
type Fc = 'persistence' | 'frozen';
const LABEL: Record<Fc, string> = { persistence: 'Persistence', frozen: 'Frozen' };
/** Accessible names of the four error statistics shown, in order. */
const statNames = () => [...within(screen.getByTestId('error-stats')).getAllByRole('group')].map((g) => g.getAttribute('aria-label'));
const maeNames = () => [...within(screen.getByTestId('mae')).getAllByRole('group')].map((g) => g.getAttribute('aria-label'));
const spokenSigned = (v: number) => formatSigned(v, 4).replace('−', 'minus ').replace('+', 'plus ');
/** A squared quantity (Q_gB,i²) to 3 significant figures, here with toPrecision (not model.ts), never exponential. */
const sq3 = (v: number) => {
  const s = v.toPrecision(3);
  if (/e/.test(s)) throw new Error(`${v} would print exponential`);
  return s;
};
/** What the four statistics must read over the first `k` windows of forecaster `f` (e = predicted − actual). */
function expectedStatNames(steps: readonly ForecastStep[], k: number, f: Fc): string[] {
  if (k === 0) return ['MSE', 'RMSE', 'Range of MSE', 'Range of errors'].map((w) => `${w} · ${f}: not scored yet (first update)`);
  const e = steps.slice(0, k).map((st) => st[f] - st.observed);
  const sq = e.map((x) => x * x);
  let mse = 0;
  for (const x of sq) mse += x;
  mse /= k;
  return [
    `MSE · ${f}: ${sq3(mse)} ${Q2}`,
    `RMSE · ${f}: ${formatNumber(Math.sqrt(mse), 4)} ${Q}`,
    `Range of MSE · ${f}: ${sq3(Math.min(...sq))} to ${sq3(Math.max(...sq))} ${Q2}`,
    `Range of errors · ${f}: ${spokenSigned(Math.min(...e))} to ${spokenSigned(Math.max(...e))} ${Q}`,
  ];
}
/** The four statistics as errorStats in the artifact prints them. */
function artifactStatNames(f: Fc): string[] {
  const e = ARTIFACT.errorStats[f];
  return [
    `MSE · ${f}: ${sq3(e.mse!)} ${Q2}`,
    `RMSE · ${f}: ${formatNumber(e.rmse, 4)} ${Q}`,
    `Range of MSE · ${f}: ${sq3(e.squaredErrorRange![0])} to ${sq3(e.squaredErrorRange![1])} ${Q2}`,
    `Range of errors · ${f}: ${spokenSigned(e.errorRange![0])} to ${spokenSigned(e.errorRange![1])} ${Q}`,
  ];
}
/** The MAE of both forecasters over the first `k` windows, recomputed here. */
function expectedMaeNames(k: number): string[] {
  if (k === 0) return ['MAE · persistence: not scored yet (first update)', 'MAE · frozen: not scored yet (first update)'];
  const mean = (f: 'absErrPersistence' | 'absErrFrozen') => ARTIFACT.steps.slice(0, k).reduce((acc, st) => acc + st[f], 0) / k;
  return [`MAE · persistence: ${f4(mean('absErrPersistence'))} ${Q}`, `MAE · frozen: ${f4(mean('absErrFrozen'))} ${Q}`];
}
/** Before every window is scored, the statistics are not compared with errorStats at all: no check, no warning (FC-R2). */
function expectNoErrorStatsCheck(when: string) {
  expect(screen.queryByTestId('error-stats-check'), when).toBeNull();
  expect(screen.queryByRole('note', { name: /differ from artifacts\/forecast\.json/ }), when).toBeNull();
}
const EQUAL_CHECK = `All ${N_STEPS} windows scored: these equal errorStats in artifacts/forecast.json (computed by main/ from the same steps) at the printed precision.`;

/* The chart (F7): what Plotly receives. */
interface Trace {
  name: string;
  x: (number | null)[];
  y: (number | null)[];
  customdata: (string | null)[];
  line: unknown;
  marker: { size: number[] };
}
interface Layout {
  xaxis: { title: { text: string }; range?: number[] };
  yaxis: { title: { text: string }; range?: number[] };
  shapes: Record<string, unknown>[];
  annotations: { text: string }[];
  showlegend: boolean;
}
type PlotCall = [HTMLElement, Trace[], Layout, unknown];
const lastPlot = () => plotly.react.mock.calls.at(-1) as unknown as PlotCall;
const pick = (d: Trace) => ({ x: d.x, y: d.y, customdata: d.customdata });
type Drawn = { window: [number, number]; value: number };
/** A line with nothing drawn: one null point, which draws nothing but keeps the line in Plotly's legend. */
const NOTHING = { x: [null], y: [null], customdata: [null] };
/** The points a list of contiguous windows must become: (a, v), (midpoint, v), (b, v) for each. */
const stepPoints = (ws: Drawn[]) =>
  ws.length === 0
    ? NOTHING
    : {
        x: ws.flatMap(({ window: [a, b] }) => [a, (a + b) / 2, b]),
        y: ws.flatMap(({ value }) => [value, value, value]),
        customdata: ws.flatMap(({ window }) => [formatWindow(window), formatWindow(window), formatWindow(window)]),
      };
/** Markers drawn: one per window, at its midpoint (the placeholder's marker is on a null point, so not drawn). */
const markersDrawn = (d: Trace) => d.marker.size.filter((m, i) => m > 0 && d.x[i] !== null).length;
const predictedIn = (s: State, i: number) => i < s.index || (i === s.index && s.phase !== 'ready');
const revealedIn = (s: State, i: number) => i < s.index || (i === s.index && s.phase === 'revealed');
/** What may be drawn in state s, spelled out here (not with model.ts): Predicted after Predict, Actual after Reveal. */
function expectedLines(s: State, f: Fc): { predicted: Drawn[]; actual: Drawn[] } {
  const predicted = ARTIFACT.steps.flatMap((st, i) => (predictedIn(s, i) ? [{ window: st.window, value: st[f] }] : []));
  const actual = ARTIFACT.steps.flatMap((st, i) => (revealedIn(s, i) ? [{ window: st.window, value: st.observed }] : []));
  return { predicted, actual };
}
/** Waits for Plotly to have drawn exactly the expected two heat-flux lines for state s. */
async function expectPlotted(s: State, f: Fc) {
  const want = expectedLines(s, f);
  await waitFor(() => {
    const data = lastPlot()[1];
    expect(data.map((d) => d.name)).toEqual(['Predicted', 'Actual']);
    expect(pick(data[0]!), `Predicted in state ${s.index}/${s.phase}`).toEqual(stepPoints(want.predicted));
    expect(pick(data[1]!), `Actual in state ${s.index}/${s.phase}`).toEqual(stepPoints(want.actual));
  });
  return want;
}
/** The absolute errors that may be drawn in state s: each forecaster's |e| for the revealed windows only. */
function expectedErrors(s: State): Record<Fc, Drawn[]> {
  const of = (key: 'absErrPersistence' | 'absErrFrozen') =>
    ARTIFACT.steps.flatMap((st, i) => (revealedIn(s, i) ? [{ window: st.window, value: st[key] }] : []));
  return { persistence: of('absErrPersistence'), frozen: of('absErrFrozen') };
}
/** Waits for Plotly to have drawn exactly the expected two absolute-error lines for state s. */
async function expectErrorsPlotted(s: State) {
  const want = expectedErrors(s);
  await waitFor(() => {
    const data = lastPlot()[1];
    expect(data.map((d) => d.name)).toEqual(['Persistence', 'Frozen']);
    expect(pick(data[0]!), `|e| persistence in state ${s.index}/${s.phase}`).toEqual(stepPoints(want.persistence));
    expect(pick(data[1]!), `|e| frozen in state ${s.index}/${s.phase}`).toEqual(stepPoints(want.frozen));
  });
  return want;
}
const caption = () => screen.getByRole('figure').querySelector('figcaption')!.textContent ?? '';

/** What is seen: the text without the screen-reader-only spans (.lab-visually-hidden). */
function seenText(el: Element): string {
  const copy = el.cloneNode(true) as Element;
  for (const hidden of copy.querySelectorAll('.lab-visually-hidden')) hidden.remove();
  return copy.textContent ?? '';
}
/** The signed range of errors the absolute-error view states, over the first k windows, as seen. */
function expectedRangeNote(k: number): string {
  if (k === 0) return 'Range of errors, predicted − actual: not scored yet (first Update).';
  const over = k >= N_STEPS ? `all ${N_STEPS} windows` : `${k} of ${N_STEPS} windows scored`;
  const part = (f: Fc) => {
    const e = ARTIFACT.steps.slice(0, k).map((st) => st[f] - st.observed);
    return `${LABEL[f]} ${formatSigned(Math.min(...e), 4)} to ${formatSigned(Math.max(...e), 4)}`;
  };
  return `Range of errors, predicted − actual (${over}): ${part('persistence')}; ${part('frozen')} QgB,i.`;
}

/* ---- the overview (owner's redesign) with Predicted vs Actual and the statistics ------------------------- */

test('F7 the overview opens on all eight saved windows: Predicted (persistence) vs Actual heat flux as steps, axes with units, a legend, no table shown', async () => {
  render(<ForecastView />);
  const start = await screen.findByRole('button', { name: 'Start replay' });
  const want = await expectPlotted(END, 'persistence');
  expect([want.predicted.length, want.actual.length]).toEqual([N_STEPS, N_STEPS]);
  const [el, data, layout] = lastPlot();
  // Two lines, as the owner asked (Predicted and Actual), in the design system's forecast styles.
  expect(data[0]!.line).toEqual(forecastStyle('predicted', 'light').line);
  expect(data[1]!.line).toEqual(forecastStyle('actual', 'light').line);
  expect([markersDrawn(data[0]!), markersDrawn(data[1]!)]).toEqual([N_STEPS, N_STEPS]);
  expect(layout.xaxis.title.text).toBe('Time t (a/v<sub>th,i</sub>)');
  expect(layout.yaxis.title.text).toBe('Ion heat flux Q<sub>i</sub> (Q<sub>gB,i</sub>)');
  expect(layout.xaxis.range).toEqual([1500, 1900]);
  expect(layout.yaxis.range).toEqual(fluxRange(ARTIFACT.steps.flatMap((st) => [st.persistence, st.observed])));
  expect(layout.showlegend).toBe(true);
  expect([layout.shapes, layout.annotations]).toEqual([[], []]);
  // Named on its figure, described by the text summary; not role="img" on Plotly's element.
  const figure = screen.getByRole('figure', {
    name: /^Chart: ion heat flux Q i in Q gB,i against time t in a\/v th,i, 1500–1900, Predicted \(persistence forecast\) and Actual \(archived observed window mean\)/,
  });
  expect(figure).toContainElement(el);
  expect(el.closest('[role="img"]')).toBeNull();
  expect(caption()).toMatch(/^Predicted \(persistence forecast\), 8 of 8 windows: 1500–1550 2\.230, .*Actual \(archived observed window mean\), 8 of 8 windows: 1500–1550 2\.216, /);
  expect(caption()).not.toMatch(/Later windows/);
  // The chart is the primary display: before the controls, the statistics, the PRD scores and the folded table.
  expect(within(panel()).getAllByRole('figure')).toEqual([figure]);
  for (const later of [start, screen.getByTestId('error-stats'), screen.getByTestId('prd-scores'), screen.getByTestId('step-0')])
    expect(figure.compareDocumentPosition(later) & FOLLOWING).toBeTruthy();
  // Owner's redesign: no table shown and no separate "Final scores" panel. The steps table (F7) is kept, folded:
  // the only table is inside a closed disclosure, which browsers neither render nor expose (jsdom does not apply
  // that rule to role queries, so it is checked on the element).
  const tables = screen.getAllByRole('table', { hidden: true });
  expect(tables).toHaveLength(1);
  expect(tables[0]!.closest('details:not([open])')).not.toBeNull();
  expect(screen.queryByRole('heading', { name: /Final scores/ })).toBeNull();
  // Nothing to run in the overview; the provenance is in the panel header.
  expect(screen.queryByRole('button', { name: 'Run to end' })).toBeNull();
  expect(screen.queryByRole('button', { name: 'Show all windows' })).toBeNull();
  expect(screen.getByTestId('progress')).toHaveTextContent(/^8 windows$/);
  expect(screen.getByRole('button', { name: 'Provenance of forecast replay: Derived, Failed' })).toBeInTheDocument();
});

test('F8 the overview shows MAE of both forecasters and MSE, RMSE, range of MSE and range of errors of the selected one, with units, equal to errorStats', async () => {
  const user = userEvent.setup();
  render(<ForecastView />);
  await screen.findByRole('button', { name: 'Start replay' });
  // Every window: the statistics equal errorStats at the printed precision, and the view says so.
  expect(statNames()).toEqual(artifactStatNames('persistence'));
  expect(statNames()).toEqual([
    `MSE · persistence: 0.00328 ${Q2}`,
    `RMSE · persistence: 0.0572 ${Q}`,
    `Range of MSE · persistence: 0.00000632 to 0.0161 ${Q2}`,
    `Range of errors · persistence: minus 0.1268 to plus 0.0676 ${Q}`,
  ]);
  expect(screen.getByTestId('error-stats-check')).toHaveTextContent(EQUAL_CHECK);
  expect(screen.getByRole('group', { name: /^MSE · persistence: / })).toHaveTextContent('all 8 windows');
  // Units: Q_gB,i² for MSE and its range, Q_gB,i for RMSE and the errors, with the subscript in the markup.
  const units = [...screen.getByTestId('error-stats').querySelectorAll('.lab-stat__unit')].map((u) => u.innerHTML);
  const sq = '<span>Q</span><sub>gB,i</sub><span>²</span>';
  const lin = '<span>Q</span><sub>gB,i</sub>';
  expect(units).toEqual([sq, lin, sq, lin]);
  // The MAE of both forecasters (the owner's line), now with its unit, equal to the artifact's.
  expect(screen.getByLabelText('Mean absolute error')).toHaveTextContent(formatNumber(ARTIFACT.mae.frozen, 4));
  expect(maeNames()).toEqual([`MAE · persistence: ${f4(ARTIFACT.mae.persistence)} ${Q}`, `MAE · frozen: ${f4(ARTIFACT.mae.frozen)} ${Q}`]);
  // The selector draws frozen as Predicted and the statistics follow it, equal to errorStats too.
  await user.click(screen.getByRole('radio', { name: 'Frozen' }));
  await expectPlotted(END, 'frozen');
  expect(statNames()).toEqual(artifactStatNames('frozen'));
  expect(statNames()).toEqual([
    `MSE · frozen: 0.00245 ${Q2}`,
    `RMSE · frozen: 0.0495 ${Q}`,
    `Range of MSE · frozen: 0.000162 to 0.00898 ${Q2}`,
    `Range of errors · frozen: minus 0.0947 to plus 0.0548 ${Q}`,
  ]);
  expect(screen.getByTestId('error-stats-check')).toHaveTextContent(EQUAL_CHECK);
  expect(screen.getByRole('group', { name: /^Range of errors · frozen/ })).toHaveTextContent('−0.0947to+0.0548QgB,i');
});

test('F7 the owner’s Absolute error view draws |predicted − actual| of both forecasters and states the signed range of errors; Heat flux switches back', async () => {
  const user = userEvent.setup();
  render(<ForecastView />);
  await screen.findByRole('button', { name: 'Start replay' });
  const metric = screen.getByRole('group', { name: 'Comparison metric' });
  const flux = within(metric).getByRole('button', { name: 'Heat flux' });
  const abs = within(metric).getByRole('button', { name: 'Absolute error' });
  expect([flux.getAttribute('aria-pressed'), abs.getAttribute('aria-pressed')]).toEqual(['true', 'false']);
  expect(screen.queryByTestId('error-range-note')).toBeNull();

  await user.click(abs);
  expect(abs).toHaveAttribute('aria-pressed', 'true');
  await expectErrorsPlotted(END);
  const [, data, layout] = lastPlot();
  expect(data.map((d) => d.y.filter((_, i) => i % 3 === 1))).toEqual(
    (['absErrPersistence', 'absErrFrozen'] as const).map((key) => ARTIFACT.steps.map((s) => s[key])),
  );
  // The forecaster drawn as Predicted keeps Predicted's style; the other is dotted with squares, same token colour.
  expect(data[0]!.line).toEqual(errorLineStyle('persistence', 'persistence', 'light').line);
  expect(data[0]!.line).toEqual(forecastStyle('predicted', 'light').line);
  expect(data[1]!.line).toEqual({ ...forecastStyle('predicted', 'light').line, dash: 'dot' });
  expect(layout.yaxis.title.text).toBe('Absolute error |predicted − actual| (Q<sub>gB,i</sub>)');
  expect(layout.xaxis.range).toEqual([1500, 1900]);
  expect(layout.yaxis.range).toEqual(absErrorRange(ARTIFACT.steps.flatMap((s) => [s.absErrPersistence, s.absErrFrozen])));
  expect(screen.getByRole('figure', { name: /^Chart: absolute error, predicted minus actual, in Q gB,i against time t/ })).toBeInTheDocument();
  expect(caption()).toMatch(/^Absolute error \|predicted − actual\| per window\. Persistence, 8 of 8 windows: 1500–1550 0\.0140, .* Frozen, 8 of 8 windows: .* Absolute error in /);
  // The absolute value drops the sign: the signed range of errors (min–max of predicted − actual) of both is stated.
  const note = screen.getByTestId('error-range-note');
  expect(squash(seenText(note))).toBe(expectedRangeNote(N_STEPS));
  expect(squash(seenText(note))).toBe(
    'Range of errors, predicted − actual (all 8 windows): Persistence −0.1268 to +0.0676; Frozen −0.0947 to +0.0548 QgB,i.',
  );
  // It equals errorStats' errorRange of each forecaster at the printed precision; the unit is spoken as words.
  for (const f of ['persistence', 'frozen'] as const)
    expect(seenText(note)).toContain(`${formatSigned(ARTIFACT.errorStats[f].errorRange![0], 4)} to ${formatSigned(ARTIFACT.errorStats[f].errorRange![1], 4)}`);
  expect(note.querySelector('.lab-visually-hidden')).toHaveTextContent(/^Q gB,i$/);
  // The statistics (selected forecaster) stay beside the chart in this view too.
  expect(statNames()).toEqual(artifactStatNames('persistence'));
  // Selecting frozen moves Predicted's style to its error line.
  await user.click(screen.getByRole('radio', { name: 'Frozen' }));
  await waitFor(() => expect(lastPlot()[1][1]!.line).toEqual(forecastStyle('predicted', 'light').line));
  expect(lastPlot()[1][0]!.line).toEqual({ ...forecastStyle('predicted', 'light').line, dash: 'dot' });

  await user.click(flux);
  await expectPlotted(END, 'frozen');
  expect(screen.queryByTestId('error-range-note')).toBeNull();
});

/* ---- the step-through replay (F4) ------------------------------------------------------------------------ */

test('F4 (owner) step-through keeps observations and errors off the chart until reveal, scores each update and restores the overview', async () => {
  const user = userEvent.setup();
  render(<ForecastView />);
  const primary = await screen.findByRole('button', { name: 'Start replay' });
  primary.focus();
  let state = INITIAL;
  for (let i = 0; i < N_STEPS * 3; i++) {
    await user.keyboard('{Enter}');
    state = advance(state, N_STEPS);
    await expectPlotted(state, 'persistence');
    if (i === 0) {
      // Window 1 is predicted, nothing revealed: no absolute error is drawn and no signed range stated.
      await user.click(screen.getByRole('button', { name: 'Absolute error' }));
      await expectErrorsPlotted(state);
      expect(lastPlot()[1].map((t) => pick(t))).toEqual([NOTHING, NOTHING]);
      expect(lastPlot()[2].annotations.map((a) => a.text)).toEqual(['Reveal a window to see its error']);
      expect(squash(seenText(screen.getByTestId('error-range-note')))).toBe(expectedRangeNote(0));
      await user.click(screen.getByRole('button', { name: 'Heat flux' }));
      primary.focus();
    }
  }
  expect(primary).toHaveAccessibleName('Replay complete');
  expect(primary).toBeDisabled();
  const mae = runningMae(ARTIFACT.steps, N_STEPS)!;
  expect(mae.persistence).toBeCloseTo(ARTIFACT.mae.persistence, 6);
  expect(screen.getByLabelText('Mean absolute error')).toHaveTextContent(formatNumber(mae.frozen, 4));
  await user.click(screen.getByRole('button', { name: 'Show all windows' }));
  expect(primary).toHaveAccessibleName('Start replay');
  expect(primary).toHaveFocus();
  await expectPlotted(END, 'persistence');
});

test('F4 step-through Predict → Reveal → Update is keyboard operable, hides observed until revealed, and "Show all windows" resets', async () => {
  const user = userEvent.setup();
  render(<ForecastView />);
  const s0 = ARTIFACT.steps[0]!;
  const primary = await screen.findByRole('button', { name: 'Start replay' });
  // The overview shows every window, observed included.
  expect(cells(0)).toEqual([f3(s0.persistence), f3(s0.frozen), f3(s0.observed), f4(s0.absErrPersistence), f4(s0.absErrFrozen)]);

  // Keyboard only: Tab reaches the step button; Enter / Space drive the replay.
  (document.activeElement as HTMLElement | null)?.blur();
  for (let i = 0; i < 20 && document.activeElement !== primary; i++) await user.tab();
  expect(primary).toHaveFocus();
  await user.keyboard('{Enter}'); // Start replay = Predict window 1
  expect(primary).toHaveAccessibleName('Reveal observed');
  expect(primary).toHaveFocus();
  expect(cells(0)).toEqual([f3(s0.persistence), f3(s0.frozen), 'hidden', '—', '—']);
  for (let i = 1; i < N_STEPS; i++) expect(cells(i)).toEqual(DASHES);
  expect(screen.getByTestId('progress')).toHaveTextContent('Window 1/8 · 1500–1550 · forecasts shown, observed hidden');

  await user.keyboard(' ');
  expect(cells(0)).toEqual([f3(s0.persistence), f3(s0.frozen), f3(s0.observed), f4(s0.absErrPersistence), f4(s0.absErrFrozen)]);
  expect(primary).toHaveAccessibleName('Update');
  expect(screen.getByTestId('progress')).toHaveTextContent('Window 1/8 · 1500–1550 · observed revealed, scored at Update');

  await user.keyboard('{Enter}');
  expect(primary).toHaveAccessibleName('Predict');
  expect(screen.getByTestId('progress')).toHaveTextContent('Window 2/8 · 1550–1600 · 1 of 8 scored');
  // The next window's observed mean stays hidden even after its forecasts are shown.
  await user.keyboard('{Enter}');
  expect(cells(1)).toEqual([f3(ARTIFACT.steps[1]!.persistence), f3(ARTIFACT.steps[1]!.frozen), 'hidden', '—', '—']);

  // Tab order: the step button, Run to end, Show all windows. "Show all windows" (keyboard) leaves the replay.
  await user.tab();
  expect(screen.getByRole('button', { name: 'Run to end' })).toHaveFocus();
  await user.tab();
  expect(screen.getByRole('button', { name: 'Show all windows' })).toHaveFocus();
  await user.keyboard('{Enter}');
  expect(primary).toHaveAccessibleName('Start replay');
  expect(primary).toHaveFocus();
  expect(screen.queryByRole('button', { name: 'Show all windows' })).toBeNull();
  // A new replay starts again at window 1 with its observed mean hidden.
  await user.keyboard('{Enter}');
  expect(cells(0)).toEqual([f3(s0.persistence), f3(s0.frozen), 'hidden', '—', '—']);
  expect(cells(1)).toEqual(DASHES);

  // Pure state machine: 3 actions per window, then complete.
  let s = INITIAL;
  for (let i = 0; i < 3 * N_STEPS; i++) s = advance(s, N_STEPS);
  expect(s).toEqual(END);
  expect(advance(s, N_STEPS)).toBe(s);
});

test('F4 no peeking: visibility() for every window below, at and above the current one, in all three phases', () => {
  const n = 8;
  const phases: Phase[] = ['ready', 'predicted', 'revealed'];
  for (let index = 0; index <= n; index++) {
    for (const phase of index === n ? (['ready'] as Phase[]) : phases) {
      for (let i = 0; i < n; i++) {
        const want =
          i < index
            ? { forecasts: true, observed: true } // scored: everything shown
            : i > index
              ? { forecasts: false, observed: false } // future: nothing shown, not even its forecasts
              : { forecasts: phase !== 'ready', observed: phase === 'revealed' };
        expect(visibility({ index, phase }, i), `index ${index} ${phase}, row ${i}`).toEqual(want);
      }
    }
  }
  // A forecast is never visible without the window having been predicted, and observed never before its forecasts.
  for (const phase of phases) for (let i = 0; i < n; i++) {
    const v = visibility({ index: 3, phase }, i);
    expect(v.observed && !v.forecasts).toBe(false);
  }
});

test('F4 no peeking in the view: every row, the chart summary, the status line, the MAE and the statistics, in all 24 replay states', async () => {
  const user = userEvent.setup();
  const primary = await (async () => {
    render(<ForecastView />);
    return startReplay(user);
  })();
  const steps = ARTIFACT.steps;
  const n = steps.length;
  const shown = (i: number) => {
    const st = steps[i]!;
    return [f3(st.persistence), f3(st.frozen), f3(st.observed), f4(st.absErrPersistence), f4(st.absErrFrozen)];
  };
  let states = 0;
  for (const [k, s] of REPLAY_STATES.entries()) {
    states++;
    const tag = `state ${s.index}/${s.phase}`;
    for (let i = 0; i < n; i++) {
      const st = steps[i]!;
      const want = revealedIn(s, i) ? shown(i) : predictedIn(s, i) ? [f3(st.persistence), f3(st.frozen), 'hidden', '—', '—'] : DASHES;
      expect(cells(i), `${tag}, row ${i}`).toEqual(want);
    }
    // Nothing that has not been revealed is in the panel's replay text: not in a cell, the chart's summary, the
    // controls or the status line. The statistics, the MAE, the PRD scores and the method are left out of this
    // substring scan (a running RMSE can print like a hidden window's error by coincidence, 0.0676 after four
    // windows; the PRD block is the artifact's full-run record); instead the running numbers must equal a
    // recomputation over the scored windows only, which no hidden value enters.
    const copy = panel().cloneNode(true) as HTMLElement;
    for (const sel of ['[data-testid="error-stats"]', '[data-testid="mae"]', '[data-testid="prd-scores"]', 'footer'])
      copy.querySelector(sel)!.remove();
    const text = copy.textContent ?? '';
    for (let i = 0; i < n; i++) {
      if (!revealedIn(s, i)) {
        expect(text.includes(f3(steps[i]!.observed)), `observed of row ${i} leaked in ${tag}`).toBe(false);
        expect(text.includes(f4(steps[i]!.absErrPersistence)), `error of row ${i} leaked in ${tag}`).toBe(false);
      }
    }
    expect(statNames(), `error statistics in ${tag}`).toEqual(expectedStatNames(steps, s.index, 'persistence'));
    expect(maeNames(), `MAE in ${tag}`).toEqual(expectedMaeNames(s.index));
    const progress = screen.getByTestId('progress').textContent ?? '';
    expect(progress).not.toMatch(/\d\.\d{3}/);
    if (s.phase === 'predicted') {
      expect(progress, tag).toContain('observed hidden');
      expect(caption(), tag).toMatch(/Actual \(archived observed window mean\)(: none revealed yet|, \d of 8 windows)/);
      expect(caption(), tag).not.toContain(f3(steps[s.index]!.observed));
    }
    if (k === REPLAY_STATES.length - 1) break;
    await user.click(primary);
  }
  expect(states).toBe(3 * n);
  expect(primary).toBeDisabled();
  expect(cells(n - 1)).toEqual(shown(n - 1));
});

/* ---- F5: MAE and the PRD scores, claimed vs recomputed ----------------------------------------------------- */

test('F5 MAE of both forecasters runs over the scored windows, and the PRD scores show claimed vs computed with the mismatch flag', async () => {
  const user = userEvent.setup();
  render(<ForecastView />);
  const primary = await startReplay(user);
  expect(screen.getByRole('group', { name: /^MAE · persistence: not scored yet/ })).toBeInTheDocument();

  // Score the first window (Reveal, Update): MAE = that window's absolute error.
  await user.click(primary);
  await user.click(primary);
  const s0 = ARTIFACT.steps[0]!;
  expect(screen.getByRole('group', { name: `MAE · persistence: ${formatNumber(s0.absErrPersistence, 4)} Q gB,i` })).toHaveTextContent('after 1 of 8 windows');

  // Finish the replay: MAE equals the artifact's final MAE.
  for (let i = 3; i < 3 * N_STEPS; i++) await user.click(primary);
  expect(primary).toBeDisabled();
  expect(primary).toHaveAccessibleName('Replay complete');
  expect(maeNames()).toEqual([`MAE · persistence: ${f4(ARTIFACT.mae.persistence)} ${Q}`, `MAE · frozen: ${f4(ARTIFACT.mae.frozen)} ${Q}`]);
  const mae = runningMae(ARTIFACT.steps, N_STEPS)!;
  expect(mae.persistence).toBeCloseTo(ARTIFACT.mae.persistence, 6);

  // The PRD claims 0.0444 / 0.0423 vs computed, flagged as mismatch (never rounded to the claim).
  const prd = screen.getByRole('group', { name: 'PRD scores: claimed vs recomputed' });
  expect(within(prd).getByRole('group', { name: /^stella MAE, persistence forecast: Mismatch\. Claimed 0\.0444.*computed 0\.0440/ })).toBeInTheDocument();
  expect(within(prd).getByRole('group', { name: /^stella MAE, frozen forecast: Mismatch\. Claimed 0\.0423.*computed 0\.0418/ })).toBeInTheDocument();
  // D-016 note: sample-and-hold reproduces the PRD scores but breaks the 2.55 archive fixture.
  const note = within(prd).getByRole('note', { name: /different window-mean definition/ });
  expect(note).toHaveTextContent('0.044418 → 0.0444');
  expect(note).toHaveTextContent('0.042332 → 0.0423');
  expect(note).toHaveTextContent(/prints 2\.56 vs PRD 2\.55/);
  expect(parseSampleAndHold(ARTIFACT.fixtures[0]?.note)?.archive?.claimed).toBe('2.55');
  // The artifact's full note is kept, once, under Method.
  const method = screen.getByText('Method (from the artifact)').closest('details')!;
  expect(method).toHaveTextContent(`PRD scores: ${ARTIFACT.fixtures[0]!.note}`);
});

test('F5 the failed verification and the mismatch are the first thing in the panel, and the wording never equates forecast and observation', async () => {
  render(<ForecastView />);
  await screen.findByRole('button', { name: 'Start replay' });
  const p = panel();
  // One panel (the owner's redesign); the separate score panel is retired.
  expect(screen.getAllByRole('region').filter((r) => r.classList.contains('lab-panel'))).toEqual([p]);
  // DS-4: before the chart, the controls or any number, the header carries the failed verification and the
  // panel's first line the mismatch, in words, pointing at the PRD scores.
  expect(within(p.querySelector('.lab-panel__header') as HTMLElement).getByRole('button', { name: 'Provenance of forecast replay: Derived, Failed' })).toBeInTheDocument();
  const pointer = within(p).getByTestId('scores-pointer');
  expect(p.querySelector('.lab-panel__body')!.firstElementChild).toBe(pointer);
  expect(pointer).toHaveTextContent('Mismatch 2 of 2 PRD scores do not reproduce with the stated method: see PRD scores, below the chart.');
  expect(pointer.querySelector('svg[data-icon="cross"]')).toHaveAttribute('aria-hidden', 'true');
  for (const later of [screen.getByRole('button', { name: 'Start replay' }), screen.getByRole('figure'), screen.getByTestId('error-stats')])
    expect(pointer.compareDocumentPosition(later) & FOLLOWING).toBeTruthy();
  // The artifact's verification outcome ("failed") is shown with the scores and on the provenance badge.
  expect(ARTIFACT.provenance.verification.outcome).toBe('failed');
  const prd = screen.getByRole('group', { name: 'PRD scores: claimed vs recomputed' });
  expect(prd.querySelector('.fc-prd__head .lab-pill[data-status="failed"]')).toHaveTextContent('Failed');
  expect(prd.querySelector('.fc-prd__head .lab-pill[data-status="derived"]')).toHaveTextContent('Derived');
  expect(document.querySelector('.lab-pill[data-status="passed"]')).toBeNull();
  // Each score row carries claimed, computed, Δ and "Mismatch" in words.
  const rows = [...within(prd).getByTestId('final-scores').querySelectorAll('.lab-fixture')];
  expect(rows.map((r) => `${r.getAttribute('data-outcome')}|${r.getAttribute('aria-label')}`)).toEqual([
    'mismatch|stella MAE, persistence forecast: Mismatch. Claimed 0.0444 Q gB,i, computed 0.0440 Q gB,i, difference minus 0.0004',
    'mismatch|stella MAE, frozen forecast: Mismatch. Claimed 0.0423 Q gB,i, computed 0.0418 Q gB,i, difference minus 0.0005',
  ]);
  for (const r of rows) expect(within(r as HTMLElement).getByText('Mismatch')).toBeInTheDocument();
  // The pointer counts exactly the rows marked Mismatch.
  expect(pointer).toHaveTextContent(`${rows.filter((r) => r.getAttribute('data-outcome') === 'mismatch').length} of ${rows.length} PRD scores`);

  // interface.md §2 item 6: the persistence forecast "can differ" from the previous revealed observation;
  // the page never says the forecast is (or equals) the previous observed value.
  const note = screen.getByTestId('forecast-note');
  expect(note).toHaveTextContent(/can differ from that window's revealed observed mean/);
  expect(note).toHaveTextContent(/without look-ahead/);
  const page = document.body.textContent ?? '';
  expect(page).not.toMatch(/forecast\s*(=|equals|is)\s*(the\s*)?previous(ly)?\s*(revealed\s*)?observ/i);
  expect(page).not.toMatch(/=\s*the previous observed/i);
  expect(page).not.toMatch(/same as the previous(ly)? (revealed )?observ|identical to the previous/i);
});

test('FB-3 what a score match is backed by is the fixture basis (D-023): arithmetic reads as such, never softens a mismatch', async () => {
  // The committed scores are data-backed (no basis = data).
  expect(ARTIFACT.fixtures.map((f) => f.basis)).toEqual([undefined, undefined]);
  const a = clone();
  a.fixtures[0] = { ...a.fixtures[0]!, computed: 0.04441, matches: true, basis: 'arithmetic' };
  a.fixtures[1] = { ...a.fixtures[1]!, basis: 'arithmetic' };
  serve(a);
  render(<ForecastView />);
  const prd = await screen.findByRole('group', { name: 'PRD scores: claimed vs recomputed' });
  const rows = [...within(prd).getByTestId('final-scores').querySelectorAll('.lab-fixture')];
  expect(rows.map((r) => `${r.getAttribute('data-basis')}|${r.getAttribute('data-outcome')}|${r.querySelector('.lab-fixture__outcome-text')?.textContent}`)).toEqual([
    'arithmetic|match|Arithmetic consistent',
    'arithmetic|mismatch|Mismatch',
  ]);
});

test('F5 the mismatch narrative follows the artifact: it goes away when both scores match and stays when one does not', async () => {
  // Both fixtures reproduce (flag and printed value): no mismatch row, no mismatch callout, no failed pill.
  const ok = clone();
  ok.fixtures[0] = { ...ok.fixtures[0]!, computed: 0.04441, matches: true };
  ok.fixtures[1] = { ...ok.fixtures[1]!, computed: 0.04232, matches: true };
  ok.provenance.verification = { outcome: 'passed', details: 'Both PRD scores reproduce at printed precision.' };
  expect(mismatchedScores(ok)).toEqual([]);
  serve(ok);
  const first = render(<ForecastView />);
  const prd = await screen.findByRole('group', { name: 'PRD scores: claimed vs recomputed' });
  expect(within(prd).queryByRole('note')).toBeNull();
  expect(within(prd).queryByText('Mismatch')).toBeNull();
  expect(prd).not.toHaveTextContent(/do not reproduce|different window-mean definition|shown as mismatches/);
  expect(within(prd).getAllByText('Match').length).toBeGreaterThanOrEqual(2);
  expect(prd.querySelector('.lab-pill[data-status="failed"]')).toBeNull();
  expect(prd.querySelector('.fc-prd__head .lab-pill[data-status="passed"]')).toHaveTextContent('Verified');
  expect(screen.getByRole('button', { name: 'Provenance of forecast replay: Derived, Verified' })).toBeInTheDocument();
  // Nor a mismatch pointer at the top of the panel.
  expect(screen.queryByTestId('scores-pointer')).toBeNull();
  expect(document.body).not.toHaveTextContent(/PRD scores? do(es)? not reproduce/);
  first.unmount();

  // Only the frozen score fails: the callout stays and names how many scores are affected.
  const one = clone();
  one.fixtures[0] = { ...one.fixtures[0]!, computed: 0.04441, matches: true };
  expect(mismatchedScores(one).map((x) => x.id)).toEqual(['mae-frozen']);
  serve(one);
  const second = render(<ForecastView />);
  const prd2 = await screen.findByRole('group', { name: 'PRD scores: claimed vs recomputed' });
  expect(within(prd2).getByRole('note', { name: /different window-mean definition/ })).toHaveTextContent(/1 of 2 scores is shown as a mismatch/);
  expect(within(prd2).getAllByText('Mismatch').length).toBeGreaterThanOrEqual(1);
  expect(screen.getByTestId('scores-pointer')).toHaveTextContent('Mismatch 1 of 2 PRD scores does not reproduce with the stated method');
  second.unmount();

  // A note without the sample-and-hold numbers: still a mismatch callout, but no invented figures.
  const bare = clone();
  for (const fx of bare.fixtures) fx.note = 'Computed with the stated method; not tuned to the PRD.';
  serve(bare);
  render(<ForecastView />);
  const prd3 = await screen.findByRole('group', { name: 'PRD scores: claimed vs recomputed' });
  const generic = within(prd3).getByRole('note', { name: /The PRD scores do not reproduce with the stated method/ });
  expect(generic).not.toHaveTextContent(/0\.044418|2\.56/);
  expect(generic).toHaveTextContent(/2 of 2 scores are shown as mismatches/);
});

test('F5 an artifact whose provenance kind is "live" is shown as a recorded run: replayed scores never earn the LIVE pill', async () => {
  const a = clone();
  a.provenance = { ...a.provenance, kind: 'live' };
  serve(a);
  render(<ForecastView />);
  const prd = await screen.findByRole('group', { name: 'PRD scores: claimed vs recomputed' });
  const pill = prd.querySelector('.fc-prd__head .lab-pill')!;
  expect(pill).toHaveAttribute('data-status', 'replay');
  expect(pill).toHaveTextContent('Recorded run');
  expect(document.querySelector('.lab-pill[data-status="live"]')).toBeNull();
  expect(screen.getByRole('button', { name: 'Provenance of forecast replay: Recorded run, Failed' })).toBeInTheDocument();
});

test('FF-14 the mismatch count follows the rows: a flag that disagrees with the printed values counts as a mismatch', async () => {
  const a = clone();
  // mae-frozen says matches:true, but 0.0418 does not print as the PRD's 0.0423: its row is a Mismatch.
  a.fixtures[1] = { ...a.fixtures[1]!, computed: 0.0418, matches: true };
  expect(mismatchedScores(a).map((f) => f.id)).toEqual(['mae-persistence', 'mae-frozen']);
  serve(a);
  render(<ForecastView />);
  const prd = await screen.findByRole('group', { name: 'PRD scores: claimed vs recomputed' });
  const rows = [...within(prd).getByTestId('final-scores').querySelectorAll('.lab-fixture')];
  expect(rows.map((r) => r.getAttribute('data-outcome'))).toEqual(['mismatch', 'mismatch']);
  expect(within(prd).getByRole('note')).toHaveTextContent(/2 of 2 scores are shown as mismatches/);
  expect(prd).not.toHaveTextContent(/1 of 2 scores/);
  // The pointer at the top of the panel counts the same rows.
  expect(screen.getByTestId('scores-pointer')).toHaveTextContent('Mismatch 2 of 2 PRD scores do not reproduce');
});

test('FF-7 a score that cannot be recomputed (matches null) is not a mismatch: no callout, a "Not recomputable" row', async () => {
  const a = clone();
  a.fixtures[0] = { ...a.fixtures[0]!, computed: null, matches: null };
  a.fixtures[1] = { ...a.fixtures[1]!, computed: 0.04232, matches: true };
  expect(mismatchedScores(a)).toEqual([]);
  serve(a);
  render(<ForecastView />);
  const prd = await screen.findByRole('group', { name: 'PRD scores: claimed vs recomputed' });
  expect(within(prd).getByRole('group', { name: /^stella MAE, persistence forecast: Not recomputable\./ })).toHaveAttribute('data-outcome', 'unknown');
  expect(within(prd).queryByRole('note')).toBeNull();
  expect(within(prd).queryByText('Mismatch')).toBeNull();
  expect(prd).not.toHaveTextContent(/shown as a mismatch|do not reproduce|different window-mean definition/);
  expect(screen.queryByTestId('scores-pointer')).toBeNull();
});

test('FF-9 the sample-and-hold callout says "matching the PRD" only when its printed values are the PRD claims', async () => {
  // Committed note: 0.0444 and 0.0423 are exactly the PRD's printed scores.
  expect(sampleAndHoldMatchesPrd(parseSampleAndHold(ARTIFACT.fixtures[0]?.note)!, ARTIFACT)).toBe(true);
  serve();
  const first = render(<ForecastView />);
  const prd = await screen.findByRole('group', { name: 'PRD scores: claimed vs recomputed' });
  expect(within(prd).getByRole('note', { name: /different window-mean definition/ })).toHaveTextContent(/matching the PRD/);
  first.unmount();

  // A note whose sample-and-hold frozen score prints 0.0421 against the PRD's 0.0423: no "matching the PRD".
  const a = clone();
  for (const f of a.fixtures) f.note = f.note!.replace('frozen 0.042332 → 0.0423', 'frozen 0.042132 → 0.0421');
  const sah = parseSampleAndHold(a.fixtures[0]?.note)!;
  expect(sah.frozen).toEqual(['0.042132', '0.0421']);
  expect(sampleAndHoldMatchesPrd(sah, a)).toBe(false);
  serve(a);
  render(<ForecastView />);
  const prd2 = await screen.findByRole('group', { name: 'PRD scores: claimed vs recomputed' });
  const note = within(prd2).getByRole('note', { name: /The PRD scores do not reproduce with the stated method/ });
  expect(note).toHaveTextContent("0.042132 → 0.0421, which does not match the PRD's printed 0.0444 and 0.0423 either.");
  expect(note).toHaveTextContent(/2 of 2 scores are shown as mismatches/);
  expect(prd2).not.toHaveTextContent(/matching the PRD|reproduce only under a different window-mean definition/);
});

/* ---- empty and failed artifacts --------------------------------------------------------------------------- */

test('F4 an artifact with no steps (errorStats all null) shows an empty state instead of crashing: no chart, no statistics, the PRD scores kept', async () => {
  const none = { n: 0, mse: null, rmse: null, squaredErrorRange: null, errorRange: null };
  serve({ ...clone(), steps: [], errorStats: { definition: ARTIFACT.errorStats.definition, persistence: none, frozen: none } });
  render(<ForecastView />);
  const empty = await screen.findByRole('note', { name: /No forecast windows in artifacts\/forecast\.json/ });
  expect(empty).toHaveTextContent(/No saved windows/i);
  expect(empty).toHaveTextContent(/Regenerate them with .*build_artifacts/);
  expect(screen.queryByRole('button', { name: /Start replay/ })).toBeNull();
  expect(screen.queryByRole('table', { hidden: true })).toBeNull();
  expect(screen.queryByRole('region', { name: /Final scores/ })).toBeNull();
  expect(screen.queryByRole('figure')).toBeNull();
  expect(screen.queryByTestId('error-stats')).toBeNull();
  // The saved artifact retains its claimed and computed scores: still shown, with the mismatch.
  const prd = screen.getByRole('group', { name: 'PRD scores: claimed vs recomputed' });
  expect(prd).toHaveTextContent("MAE as recorded in the artifact, at the PRD's printed precision.");
  expect(within(prd).getAllByText('Mismatch')).toHaveLength(2);
  expect(plotly.react).not.toHaveBeenCalled();
  expect(runningMae([], 0)).toBeNull();
  expect(nextAction(INITIAL, 0)).toBe('done');
});

test('A3 forecast: a missing or invalid artifact shows an error naming the file, never a blank view', async () => {
  serve({ error: 'gone' }, 404);
  const first = render(<ForecastView />);
  expect(screen.getByRole('heading', { name: 'Loading forecast replay…' })).toBeInTheDocument();
  expect(await screen.findByRole('heading', { name: 'Forecast replay could not be loaded' })).toBeInTheDocument();
  expect(screen.getByRole('note', { name: /artifacts\/forecast\.json failed to load/ })).toHaveTextContent('/artifacts/forecast.json: HTTP 404');
  expect(screen.queryByRole('button', { name: /Start replay/ })).toBeNull();
  first.unmount();

  serve({ ...ARTIFACT, schemaVersion: 3 });
  render(<ForecastView />);
  expect(await screen.findByRole('note', { name: /artifacts\/forecast\.json failed to load/ })).toHaveTextContent('unexpected schemaVersion');
});

/* ---- the replay pill never prints "$0" while the header withholds it (cross-RX-1, FF-1) ------------ */
const LIVE_BASE: LiveStatus = {
  schemaVersion: 1,
  mode: 'idle',
  reason: 'Qualified. Launch requires explicit confirmation of the slot cost.',
  qualified: true,
  budget: { ceilingUsd: 40, billedUsd: 8.1, pendingUsd: 0, slotEstimateUsd: 2.65, slotFits: true, hardTimeoutS: 1500 },
  workers: [],
  fallback: { active: false, label: '', savedRunId: null },
};
const worker = (gpuIndex: 0 | 1, state: LiveWorker['state'] = 'running'): LiveWorker => ({
  gpuIndex,
  deviceId: `GPU-${gpuIndex}aaaa`,
  tube: gpuIndex === 0 ? 'bean' : 'triangular',
  state,
  simTime: 12,
  samples: [],
});
const RUNNING = [worker(0), worker(1)];
const snap = (mode: LiveStatus['mode'], reason: string, workers: LiveWorker[] = [], extra: Partial<LiveStatus> = {}): LiveStatus => ({
  ...LIVE_BASE,
  mode,
  reason,
  workers,
  ...extra,
});
const FALLBACK = { active: true, label: 'Worker failed — GPU 0 (bean)', savedRunId: null };
const replayPill = () => panel().querySelector('.lab-panel__header .lab-pill[data-status="replay"]');

test.each([
  ['mode live with two running workers', [snap('live', 'Live: both workers running.', RUNNING)]],
  ['a fallback with TERMINATE FAILED', [snap('fallback', 'TERMINATE FAILED — check Modal dashboard; GPUs may still be billing: GPU 0 (bean).', [worker(0, 'failed')], { fallback: FALLBACK })]],
  ['a fallback with TERMINATION PENDING', [snap('fallback', 'TERMINATION PENDING — cancel queued, not yet confirmed; GPUs may still be billing.', [worker(1)], { fallback: FALLBACK })]],
  ['a stop that is not confirmed', [snap('live', 'Stop requested; terminating workers — not confirmed yet', RUNNING)]],
  ['mode idle with workers listed', [snap('idle', 'Session created; workers starting.', [worker(0, 'pending'), worker(1, 'pending')])]],
  ['mode launching', [snap('launching', 'Launching both workers.', [worker(0, 'initializing')])]],
  ['a connection lost after mode live', [snap('live', 'Live: both workers running.', RUNNING), 'reject']],
] as [string, Api[]][])('FF-1 / cross-RX-1 the forecast replay pill withholds the zero-cost label for %s, as the header does', async (_name, api) => {
  serve(ARTIFACT, 200, api);
  render(<ForecastView livePollMs={api.length > 1 ? 60 : 60_000} />);
  await screen.findByRole('button', { name: /Start replay/ });
  const settled = api.length > 1 ? 'unreachable' : 'ready';
  await waitFor(() => expect(liveStatusStore.getState().status).toBe(settled));
  expect(modePills(liveStatusStore.getState()).map((p) => p.text)).not.toContain('Replay · $0');
  expect(replayPill()).toHaveTextContent(/^Replay$/);
  expect(document.body).not.toHaveTextContent('Replay · $0');
});

test('FF-1 the forecast replay pill keeps "$0" where the header does, and drops it once a launch from this page is accepted', async () => {
  // Static replay build (no API answer) and an empty artifact: the empty-state panel follows the same rule.
  serve({ ...clone(), steps: [] });
  const first = render(<ForecastView livePollMs={60_000} />);
  await screen.findByRole('note', { name: /No forecast windows/ });
  await waitFor(() => expect(liveStatusStore.getState().status).toBe('unreachable'));
  expect(replayPill()).toHaveTextContent(/^Replay · \$0$/);
  first.unmount();

  serve(ARTIFACT, 200, LIVE_BASE);
  render(<ForecastView livePollMs={60_000} />);
  await screen.findByRole('button', { name: /Start replay/ });
  await waitFor(() => expect(liveStatusStore.getState().status).toBe('ready'));
  expect(replayPill()).toHaveTextContent(/^Replay · \$0$/);
  act(() => {
    liveStatusStore.lockLaunch();
    liveStatusStore.launchAnswered('accepted');
  });
  expect(replayPill()).toHaveTextContent(/^Replay$/);
});

test('DS-2 the steps table keeps its visually hidden caption inside the scrolling well', () => {
  const css = readFileSync(resolve(__dirname, 'forecast.css'), 'utf8');
  expect(css).toMatch(/\.fc-table-wrap\s*\{[^}]*position:\s*relative/);
});

/* ---- F7 / F8 in a step-through replay (D-026) ------------------------------------------------------------- */

test('F7 Predict plots the forecast and Reveal the observed mean, each held over its window; hidden values are never plotted, in all 24 replay states', async () => {
  const user = userEvent.setup();
  render(<ForecastView />);
  const primary = await startReplay(user);
  const pair = (st: ForecastStep, v: number) => `${formatWindow(st.window)} ${f3(v)}`;
  for (const [k, s] of REPLAY_STATES.entries()) {
    const want = await expectPlotted(s, 'persistence');
    const [, data, layout] = lastPlot();
    // One marker per drawn window, at its midpoint.
    expect(markersDrawn(data[0]!)).toBe(want.predicted.length);
    expect(markersDrawn(data[1]!)).toBe(want.actual.length);
    // The flux axis is a function of the drawn values only (so it cannot hint at a hidden one), and brackets them;
    // the only shape is the current window band, until the replay is complete.
    const values = [...want.predicted, ...want.actual].map((w) => w.value);
    expect(layout.yaxis.range).toEqual(fluxRange(values));
    expect(layout.yaxis.range![0]).toBeLessThan(Math.min(...values));
    expect(layout.yaxis.range![1]).toBeGreaterThan(Math.max(...values));
    expect(layout.shapes).toHaveLength(k === REPLAY_STATES.length - 1 ? 0 : 1);
    for (const sh of layout.shapes) expect(sh).toMatchObject({ type: 'rect', yref: 'paper', y0: 0, y1: 1, x0: ARTIFACT.steps[s.index]!.window[0] });
    // The text summary lists exactly the drawn values: each window's forecast once predicted, its observed mean once revealed.
    const text = caption();
    // The visible caption speaks units as words ("Q gB,i"), never raw "_" markup (FC-R5).
    expect(text, `caption in state ${s.index}/${s.phase}`).not.toMatch(/[_{}]/);
    const at = text.indexOf('Actual (archived observed window mean)');
    const [predictedPart, actualPart] = [text.slice(0, at), text.slice(at)];
    ARTIFACT.steps.forEach((st, i) => {
      const tag = `window ${i} in state ${s.index}/${s.phase}`;
      expect(predictedPart.includes(pair(st, st.persistence)), `forecast of ${tag}`).toBe(want.predicted.some((w) => w.window === st.window));
      expect(actualPart.includes(pair(st, st.observed)), `observed of ${tag}`).toBe(want.actual.some((w) => w.window === st.window));
    });
    if (k === REPLAY_STATES.length - 1) break;
    await user.click(primary);
  }
  // At the end both lines are complete step functions over 1500–1900, with risers at the shared edges.
  const [predicted, actual] = lastPlot()[1];
  expect(actual!.x.slice(0, 6)).toEqual([1500, 1525, 1550, 1550, 1575, 1600]);
  expect(actual!.y.slice(0, 6)).toEqual([ARTIFACT.steps[0]!.observed, ARTIFACT.steps[0]!.observed, ARTIFACT.steps[0]!.observed, ARTIFACT.steps[1]!.observed, ARTIFACT.steps[1]!.observed, ARTIFACT.steps[1]!.observed]);
  expect(predicted!.x.at(-1)).toBe(1900);
  expect(caption()).not.toMatch(/Later windows are not plotted/);
});

test('F7 in a replay the Absolute error view draws a window’s errors only after its Reveal, and the signed range runs over the scored windows', async () => {
  const user = userEvent.setup();
  render(<ForecastView />);
  const primary = await startReplay(user);
  await user.click(screen.getByRole('button', { name: 'Absolute error' }));
  for (const [k, s] of REPLAY_STATES.entries()) {
    const tag = `state ${s.index}/${s.phase}`;
    const want = await expectErrorsPlotted(s);
    const [, data, layout] = lastPlot();
    expect(markersDrawn(data[0]!), tag).toBe(want.persistence.length);
    const values = [...want.persistence, ...want.frozen].map((w) => w.value);
    expect(layout.yaxis.range, tag).toEqual(absErrorRange(values));
    expect(layout.annotations.map((a) => a.text), tag).toEqual(values.length === 0 ? ['Reveal a window to see its error'] : []);
    // No hidden window's error is in what Plotly received or in the summary.
    const json = JSON.stringify([data, layout]);
    ARTIFACT.steps.forEach((st, i) => {
      if (revealedIn(s, i)) return;
      expect(json.includes(String(st.absErrPersistence)), `${tag}: |e| of window ${i} plotted`).toBe(false);
      expect(caption().includes(f4(st.absErrPersistence)), `${tag}: |e| of window ${i} in the summary`).toBe(false);
    });
    // The signed range of errors counts a window at its Update, as the MAE and the statistics do.
    expect(squash(seenText(screen.getByTestId('error-range-note'))), tag).toBe(expectedRangeNote(s.index));
    expect(statNames(), tag).toEqual(expectedStatNames(ARTIFACT.steps, s.index, 'persistence'));
    if (k === REPLAY_STATES.length - 1) break;
    await user.click(primary);
  }
  // At the end: the same as the overview.
  expect(squash(seenText(screen.getByTestId('error-range-note')))).toBe(expectedRangeNote(N_STEPS));
});

test('F7 a keyboard-operable selector draws the frozen forecast as Predicted instead of persistence; Actual and the replay are unchanged', async () => {
  const user = userEvent.setup();
  render(<ForecastView />);
  const primary = await startReplay(user);
  for (let i = 0; i < 3; i++) await user.click(primary); // window 1 scored, window 2 predicted
  const s = { index: 1, phase: 'predicted' as Phase };
  await expectPlotted(s, 'persistence');
  const group = screen.getByRole('radiogroup', { name: 'Forecaster drawn as Predicted' });
  const persistence = within(group).getByRole('radio', { name: 'Persistence' });
  const frozen = within(group).getByRole('radio', { name: 'Frozen' });
  expect(persistence).toHaveAttribute('aria-checked', 'true');

  // Keyboard: Tab from the metric toggle reaches the selector (one tab stop), an arrow key switches it.
  screen.getByRole('button', { name: 'Absolute error' }).focus();
  await user.tab();
  expect(persistence).toHaveFocus();
  await user.keyboard('{ArrowRight}');
  expect(frozen).toHaveAttribute('aria-checked', 'true');
  expect(frozen).toHaveFocus();
  await expectPlotted(s, 'frozen');
  // Frozen holds the initialisation mean for every window.
  expect(lastPlot()[1][0]!.y).toEqual(Array(6).fill(ARTIFACT.steps[0]!.frozen));
  expect(screen.getByRole('figure', { name: /Predicted \(frozen forecast\)/ })).toBeInTheDocument();
  expect(caption()).toContain(`Predicted (frozen forecast), 2 of 8 windows: 1500–1550 ${f3(ARTIFACT.steps[0]!.frozen)}, 1550–1600 ${f3(ARTIFACT.steps[1]!.frozen)}.`);
  expect(statNames()).toEqual(expectedStatNames(ARTIFACT.steps, 1, 'frozen'));
  // The replay itself is untouched: window 2 is still predicted, its observed mean hidden.
  expect(primary).toHaveAccessibleName('Reveal observed');
  expect(cells(1)).toEqual([f3(ARTIFACT.steps[1]!.persistence), f3(ARTIFACT.steps[1]!.frozen), 'hidden', '—', '—']);

  await user.keyboard('{ArrowLeft}');
  expect(persistence).toHaveAttribute('aria-checked', 'true');
  await expectPlotted(s, 'persistence');
  expect(statNames()).toEqual(expectedStatNames(ARTIFACT.steps, 1, 'persistence'));
});

test('F7 the steps table stays available under a disclosure, closed by default, with the same hidden/revealed semantics', async () => {
  const user = userEvent.setup();
  render(<ForecastView />);
  await screen.findByRole('button', { name: 'Start replay' });
  const summary = screen.getByText('Show the steps table');
  expect(summary.tagName).toBe('SUMMARY');
  const details = summary.closest('details')!;
  expect(details).not.toHaveAttribute('open');
  const region = details.querySelector('[role="region"][aria-label="Forecast steps table"]')!;
  expect(region).toContainElement(details.querySelector('table'));
  expect(region.querySelectorAll('tbody tr')).toHaveLength(N_STEPS);
  // A native disclosure: the summary is the details' first child, so browsers make it the keyboard-operable
  // toggle. jsdom has no keyboard activation for summary; a click opens it.
  expect(details.firstElementChild).toBe(summary);
  await user.click(summary);
  expect(details).toHaveAttribute('open');
  expect(screen.getByRole('table')).toBeInTheDocument();
  // The overview: every value. A replay: forecasts after Predict, observed and errors after Reveal.
  const s0 = ARTIFACT.steps[0]!;
  const all0 = [f3(s0.persistence), f3(s0.frozen), f3(s0.observed), f4(s0.absErrPersistence), f4(s0.absErrFrozen)];
  expect(cells(0)).toEqual(all0);
  const primary = await startReplay(user);
  expect(cells(0)).toEqual([f3(s0.persistence), f3(s0.frozen), 'hidden', '—', '—']);
  expect(screen.getByTestId('step-0')).toHaveAttribute('aria-current', 'step');
  await user.click(primary);
  expect(cells(0)).toEqual(all0);
});

test('F8 MSE, RMSE, range of MSE and range of errors run over the scored windows (after each Update), with units, and equal errorStats at the end', async () => {
  const user = userEvent.setup();
  render(<ForecastView />);
  await screen.findByRole('button', { name: 'Start replay' });
  // One short line says what the ranges are and which way the error is taken.
  expect(screen.getByTestId('error-stats-definition')).toHaveTextContent(
    'Error e = predicted − actual for each window; range of MSE = min–max of the per-window squared errors e² (the values the MSE averages); RMSE = √MSE.',
  );
  const primary = await startReplay(user); // window 1 predicted
  const n = N_STEPS;
  expect(statNames()).toEqual(expectedStatNames(ARTIFACT.steps, 0, 'persistence'));
  expectNoErrorStatsCheck('after Predict of window 1');
  for (let k = 0; k < n; k++) {
    if (k > 0) {
      await user.click(primary); // Predict
      expectNoErrorStatsCheck(`after Predict of window ${k + 1}`);
    }
    await user.click(primary); // Reveal: not scored yet, the same timing as the MAE
    expect(statNames(), `after Reveal of window ${k + 1}`).toEqual(expectedStatNames(ARTIFACT.steps, k, 'persistence'));
    // Even after the last Reveal: the last window counts at its Update.
    expectNoErrorStatsCheck(`after Reveal of window ${k + 1}`);
    await user.click(primary); // Update
    expect(statNames(), `after Update of window ${k + 1}`).toEqual(expectedStatNames(ARTIFACT.steps, k + 1, 'persistence'));
    expect(screen.getByRole('group', { name: /^MSE · persistence: / })).toHaveTextContent(`after ${k + 1} of ${n} windows`);
    if (k + 1 < n) expectNoErrorStatsCheck(`after Update of window ${k + 1} of ${n}`);
  }
  // At the end they equal the artifact's errorStats at the printed precision, for both forecasters.
  expect(statNames()).toEqual(artifactStatNames('persistence'));
  expect(screen.getByRole('group', { name: /^Range of MSE · persistence/ })).toHaveTextContent('0.00000632to0.0161QgB,i²');
  expect(screen.getByTestId('error-stats-check')).toHaveTextContent(EQUAL_CHECK);
  await user.click(screen.getByRole('radio', { name: 'Frozen' }));
  expect(statNames()).toEqual(artifactStatNames('frozen'));
  expect(screen.getByTestId('error-stats-check')).toBeInTheDocument();
  expect(screen.queryByRole('note', { name: /differ from artifacts\/forecast\.json/ })).toBeNull();
});

test('F8 an errorStats that does not match the replayed statistics is shown as a disagreement, never hidden', async () => {
  const a = clone();
  a.errorStats.persistence.mse = 0.0042;
  serve(a);
  const user = userEvent.setup();
  render(<ForecastView />);
  await screen.findByRole('button', { name: 'Start replay' });
  // The overview already compares every window with errorStats.
  expect(screen.getByRole('note', { name: /The replayed error statistics differ from artifacts\/forecast\.json/ })).toBeInTheDocument();
  const primary = await startReplay(user);
  // No warning while windows remain to be scored (a partial replay is never compared with the full-run errorStats).
  for (let i = 1; i < 3 * a.steps.length; i++) {
    expectNoErrorStatsCheck(`before click ${i + 1} of ${3 * a.steps.length}`);
    await user.click(primary);
  }
  // The replay shows what it computed from the steps, and says that the artifact disagrees.
  expect(statNames()[0]).toBe(`MSE · persistence: 0.00328 ${Q2}`);
  const note = screen.getByRole('note', { name: /The replayed error statistics differ from artifacts\/forecast\.json/ });
  expect(note).toHaveTextContent(
    "MSE of the persistence forecast differs from the artifact's errorStats by more than the 7-significant-figure rounding of the steps explains",
  );
  expect(note).toHaveTextContent('The artifact may be stale');
  expect(screen.queryByTestId('error-stats-check')).toBeNull();
  // The frozen statistics still agree.
  await user.click(screen.getByRole('radio', { name: 'Frozen' }));
  expect(screen.queryByRole('note', { name: /differ from artifacts\/forecast\.json/ })).toBeNull();
  expect(screen.getByTestId('error-stats-check')).toBeInTheDocument();
});

test('F8 (FC-R3) a statistic that prints differently from errorStats only through the steps’ rounding is no stale-artifact warning', async () => {
  // Every window: persistence 2.06249 vs observed 2, so e = 0.06249 and e² = 0.0039050001, just above the 3-figure
  // boundary 0.003905 (prints 0.00391). main/'s unrounded means can give 0.00390499 (prints 0.00390): 1.0e-8 apart,
  // inside the 1.25e-7 that rounding the steps to 7 figures allows. Frozen equals observed (all statistics 0).
  const a = clone();
  a.steps = a.steps.map((st) => ({ ...st, observed: 2, persistence: 2.06249, frozen: 2, absErrPersistence: 0.06249, absErrFrozen: 0 }));
  const zero = { n: 8, mse: 0, rmse: 0, squaredErrorRange: [0, 0] as [number, number], errorRange: [0, 0] as [number, number] };
  a.errorStats = {
    definition: ARTIFACT.errorStats.definition,
    persistence: { n: 8, mse: 0.00390499, rmse: 0.06249, squaredErrorRange: [0.00390499, 0.00390499], errorRange: [0.06249, 0.06249] },
    frozen: zero,
  };
  serve(a);
  const user = userEvent.setup();
  render(<ForecastView />);
  await screen.findByRole('button', { name: 'Start replay' });
  // The overview (every window) and the end of a replay say the same.
  const expectBoundaryNote = () => {
    expect(statNames()[0]).toBe(`MSE · persistence: 0.00391 ${Q2}`);
    expect(screen.queryByRole('note', { name: /differ from artifacts\/forecast\.json/ })).toBeNull();
    // Not "equal at the printed precision" either: the check names what prints differently and how the artifact prints it.
    const check = screen.getByTestId('error-stats-check');
    expect(check).toHaveTextContent(
      'All 8 windows scored: these agree with errorStats in artifacts/forecast.json (computed by main/ from the unrounded window means) ' +
        'within the 7-significant-figure rounding of the steps they are recomputed from. At a rounding boundary that is enough to print ' +
        'differently: MSE prints as 0.00390 there; range of MSE prints as 0.00390 to 0.00390 there.',
    );
    expect(check).not.toHaveTextContent(/equal/);
  };
  expectBoundaryNote();
  const primary = await startReplay(user);
  for (let i = 1; i < 3 * a.steps.length; i++) await user.click(primary);
  expectBoundaryNote();
  await user.click(screen.getByRole('radio', { name: 'Frozen' }));
  expect(screen.getByTestId('error-stats-check')).toHaveTextContent('these equal errorStats in artifacts/forecast.json');
});

test('F8 an artifact without errorStats for the drawn forecaster says it cannot be checked, once every window is scored', async () => {
  const a = clone();
  delete (a.errorStats as Partial<ForecastArtifact['errorStats']>).frozen;
  serve(a);
  const user = userEvent.setup();
  render(<ForecastView />);
  await screen.findByRole('button', { name: 'Start replay' });
  await user.click(screen.getByRole('radio', { name: 'Frozen' }));
  const primary = await startReplay(user);
  for (let i = 1; i < 3 * a.steps.length; i++) {
    expectNoErrorStatsCheck(`before click ${i + 1}`);
    await user.click(primary);
  }
  const note = screen.getByRole('note', { name: /The replayed error statistics differ from artifacts\/forecast\.json/ });
  expect(note).toHaveTextContent('The artifact has no errorStats for the frozen forecast to check these against. The artifact may be stale');
  await user.click(screen.getByRole('radio', { name: 'Persistence' }));
  expect(screen.getByTestId('error-stats-check')).toBeInTheDocument();
});

/* ---- DZ-9: Run to end -------------------------------------------------------------------------------------- */

/** Everything the completed replay shows, with each forecaster drawn as Predicted; compared between Run to end and the step button. */
async function completedReplay(user: User) {
  const drawn = async (f: Fc) => {
    await expectPlotted(END, f); // both lines over every window
    const [, data, layout] = lastPlot();
    return {
      traces: data.map((d) => ({ name: d.name, ...pick(d), markers: d.marker.size, line: d.line })),
      yRange: layout.yaxis.range,
      shapes: layout.shapes,
      annotations: layout.annotations,
      figure: screen.getByRole('figure').getAttribute('aria-label'),
      caption: caption(),
      stats: statNames(),
      statsText: squash(screen.getByTestId('error-stats').textContent),
      check: squash(screen.queryByTestId('error-stats-check')?.textContent) || null,
      warning: squash(screen.queryByRole('note', { name: /differ from artifacts\/forecast\.json/ })?.textContent) || null,
    };
  };
  const persistence = await drawn('persistence');
  await user.click(screen.getByRole('radio', { name: 'Frozen' }));
  const frozen = await drawn('frozen');
  await user.click(screen.getByRole('radio', { name: 'Persistence' }));
  await expectPlotted(END, 'persistence');
  return {
    persistence,
    frozen,
    mae: maeNames(),
    rows: ARTIFACT.steps.map((_, i) => cells(i)),
    current: document.querySelector('tr[aria-current="step"]') !== null,
    progress: screen.getByTestId('progress').textContent,
    step: { name: stepButton().textContent, disabled: stepButton().disabled },
    runDisabled: (screen.getByRole('button', { name: 'Run to end' }) as HTMLButtonElement).disabled,
    overviewDisabled: (screen.getByRole('button', { name: 'Show all windows' }) as HTMLButtonElement).disabled,
  };
}

test('F7 (DZ-9) Run to end ends in the same state as the step button pressed to the end: both full lines, summary, MAE, MSE, RMSE and both ranges equal to errorStats', async () => {
  const user = userEvent.setup();
  const n = N_STEPS;
  // By hand: Start replay, then the step button pressed to the end (3 × 8 = 24 presses in all).
  const manual = render(<ForecastView />);
  const primary = await startReplay(user);
  for (let i = 1; i < 3 * n; i++) await user.click(primary);
  const byHand = await completedReplay(user);
  manual.unmount();

  // One press of Run to end, right after Start replay and from the middle (window 3 predicted, its observed mean hidden).
  for (const presses of [0, 6]) {
    plotly.react.mockClear();
    const view = render(<ForecastView />);
    const step = await startReplay(user);
    for (let i = 0; i < presses; i++) await user.click(step);
    await user.click(screen.getByRole('button', { name: 'Run to end' }));
    expect(await completedReplay(user), `Run to end after Start and ${presses} presses of the step button`).toEqual(byHand);
    view.unmount();
  }

  // And that state is the complete replay: both lines over all 8 windows, no current-window band, no empty-chart note.
  for (const f of ['persistence', 'frozen'] as const) {
    const d = byHand[f];
    expect(d.traces.map((t) => t.x.filter((x) => x !== null).length), f).toEqual([3 * n, 3 * n]);
    expect(d.shapes).toEqual([]);
    expect(d.annotations).toEqual([]);
    expect(d.caption).toMatch(new RegExp(`^Predicted \\(${f} forecast\\), 8 of 8 windows: .*Actual \\(archived observed window mean\\), 8 of 8 windows: `));
    // MSE, RMSE, range of MSE and range of errors equal errorStats, and the view says so.
    expect(d.stats).toEqual(artifactStatNames(f));
    expect(d.check).toBe(EQUAL_CHECK);
    expect(d.warning).toBeNull();
  }
  expect(byHand.mae).toEqual([`MAE · persistence: ${f4(ARTIFACT.mae.persistence)} ${Q}`, `MAE · frozen: ${f4(ARTIFACT.mae.frozen)} ${Q}`]);
  expect(byHand.rows).toEqual(ARTIFACT.steps.map((st) => [f3(st.persistence), f3(st.frozen), f3(st.observed), f4(st.absErrPersistence), f4(st.absErrFrozen)]));
  expect(byHand.progress).toBe(`${n} windows scored`);
  expect(byHand.step).toEqual({ name: 'Replay complete', disabled: true });
  expect([byHand.runDisabled, byHand.overviewDisabled, byHand.current]).toEqual([true, false, false]);
});

test('F7 (DZ-9) Run to end never plots a window’s observed mean before its forecast: every chart drawn is a state the step button reaches', async () => {
  const user = userEvent.setup();
  render(<ForecastView />);
  const step = await startReplay(user);
  for (let i = 0; i < 6; i++) await user.click(step); // windows 1–2 scored, window 3 predicted
  const mid = { index: 2, phase: 'predicted' as Phase };
  await expectPlotted(mid, 'persistence');
  // Window 3's observed mean is still hidden everywhere before the run.
  const s2 = ARTIFACT.steps[2]!;
  expect(cells(2)).toEqual([f3(s2.persistence), f3(s2.frozen), 'hidden', '—', '—']);
  expect(caption()).not.toContain(f3(s2.observed));
  const before = plotly.react.mock.calls.length;

  await user.click(screen.getByRole('button', { name: 'Run to end' }));
  await expectPlotted(END, 'persistence');
  const calls = plotly.react.mock.calls as unknown as PlotCall[];
  expect(calls.length).toBeGreaterThan(before);
  const key = (data: Trace[]) => JSON.stringify(data.map(pick));
  const reachable = new Map(
    [END, ...REPLAY_STATES].map((s) => {
      const want = expectedLines(s, 'persistence');
      return [JSON.stringify([stepPoints(want.predicted), stepPoints(want.actual)]), s] as const;
    }),
  );
  calls.forEach(([, data], k) => {
    const tag = `chart ${k + 1} of ${calls.length}${k >= before ? ' (after Run to end)' : ''}`;
    // Each chart drawn is exactly what the overview or some state of the step button draws, so the observed mean
    // of a window is drawn only where its forecast is, and in a replay only after its Reveal.
    const s = reachable.get(key(data));
    expect(s, `${tag} is not a state the step button reaches`).toBeDefined();
    const windowsOf = (d: Trace) => new Set(d.customdata.filter((c): c is string => c !== null));
    const predicted = windowsOf(data[0]!);
    for (const w of windowsOf(data[1]!)) expect(predicted.has(w), `${tag}: Actual on ${w} without Predicted`).toBe(true);
  });
  // After the replay started nothing past window 3's forecast was drawn until Run to end.
  const startedAt = calls.findIndex(([, data]) => key(data) === JSON.stringify([stepPoints(expectedLines(REPLAY_STATES[0]!, 'persistence').predicted), NOTHING]));
  expect(startedAt).toBeGreaterThanOrEqual(0);
  for (let k = startedAt; k < before; k++) {
    const s = reachable.get(key(calls[k]![1]))!;
    expect(s.index * 3 + ['ready', 'predicted', 'revealed'].indexOf(s.phase), `chart ${k + 1}`).toBeLessThanOrEqual(7);
  }
});

test('F4 (DZ-9) Run to end is keyboard operable, sits between the step button and "Show all windows", disables at the end (by itself or the step button) and hands focus on', async () => {
  const user = userEvent.setup();
  const n = N_STEPS;
  render(<ForecastView />);
  const primary = await startReplay(user);
  const run = screen.getByRole('button', { name: 'Run to end' });
  const overview = screen.getByRole('button', { name: 'Show all windows' });
  expect(run).toBeEnabled();
  expect(run).toHaveAccessibleDescription('Predicts, reveals and scores every remaining window in turn, as the step button does.');
  expect(run.compareDocumentPosition(primary) & Node.DOCUMENT_POSITION_PRECEDING).toBeTruthy();
  expect(run.compareDocumentPosition(overview) & FOLLOWING).toBeTruthy();

  // Keyboard: Tab from the step button reaches it; Enter runs the replay to the end at once (no motion to reduce).
  primary.focus();
  await user.tab();
  expect(run).toHaveFocus();
  await user.keyboard('{Enter}');
  expect(run).toBeDisabled();
  expect(primary).toBeDisabled();
  expect(primary).toHaveAccessibleName('Replay complete');
  expect(screen.getByTestId('progress')).toHaveTextContent(`${n} windows scored`);
  // Focus is not left on a disabled button: it moves to "Show all windows", the one control left that acts.
  expect(overview).toBeEnabled();
  expect(overview).toHaveFocus();

  // "Show all windows" (Space) returns to the overview, focus on Start replay; a new replay can be run to the end again.
  await user.keyboard(' ');
  expect(primary).toHaveAccessibleName('Start replay');
  expect(primary).toHaveFocus();
  expect(screen.queryByRole('button', { name: 'Run to end' })).toBeNull();
  await expectPlotted(END, 'persistence');
  await user.keyboard('{Enter}');
  const run2 = screen.getByRole('button', { name: 'Run to end' });
  run2.focus();
  await user.keyboard(' ');
  expect(run2).toBeDisabled();
  expect(screen.getByRole('button', { name: 'Show all windows' })).toHaveFocus();

  // The step button pressed to the end disables it as well; it stays enabled until the last Update.
  await user.click(screen.getByRole('button', { name: 'Show all windows' }));
  await user.click(primary);
  const run3 = screen.getByRole('button', { name: 'Run to end' });
  for (let i = 1; i < 3 * n; i++) {
    expect(run3, `before press ${i + 1}`).toBeEnabled();
    await user.click(primary);
  }
  expect(run3).toBeDisabled();
});

test('F4 (FC-R6) the step button’s last Update hands focus to "Show all windows", as Run to end does, and the end is announced', async () => {
  const user = userEvent.setup();
  const n = N_STEPS;
  render(<ForecastView />);
  const primary = await screen.findByRole('button', { name: 'Start replay' });
  const status = screen.getByTestId('progress');
  expect(status).toHaveAttribute('role', 'status');

  // Keyboard only: every press before the last keeps focus on the step button, which stays enabled.
  primary.focus();
  for (let i = 0; i < 3 * n - 1; i++) {
    await user.keyboard('{Enter}');
    expect(primary, `after press ${i + 1}`).toHaveFocus();
    expect(primary, `after press ${i + 1}`).toBeEnabled();
  }
  expect(primary).toHaveAccessibleName('Update');
  expect(status).toHaveTextContent('Window 8/8 · 1850–1900 · observed revealed, scored at Update');

  // The last Update disables the step button. Focus moves to "Show all windows", the one control left that acts,
  // and the status line announces the end.
  await user.keyboard('{Enter}');
  const overview = screen.getByRole('button', { name: 'Show all windows' });
  expect(primary).toBeDisabled();
  expect(primary).toHaveAccessibleName('Replay complete');
  expect(screen.getByRole('button', { name: 'Run to end' })).toBeDisabled();
  expect(overview).toHaveFocus();
  expect(status).toHaveTextContent(`${n} windows scored`);

  // Space returns to the overview, focus back on the step button.
  await user.keyboard(' ');
  expect(primary).toHaveAccessibleName('Start replay');
  expect(primary).toHaveFocus();

  // With a pointer the same: the click that completes the replay leaves focus on "Show all windows".
  for (let i = 0; i < 3 * n; i++) await user.click(primary);
  expect(primary).toBeDisabled();
  expect(screen.getByRole('button', { name: 'Show all windows' })).toHaveFocus();
});

/* ---- FC-R7 / DS-4: the mismatch pointer ------------------------------------------------------------------- */

test('F7 (FC-R7, DS-4 kept) the mismatch pointer links to the PRD scores: an in-page link that moves focus there without changing the route', async () => {
  const user = userEvent.setup();
  location.hash = '#/forecast';
  render(<ForecastView />);
  await screen.findByRole('button', { name: 'Start replay' });
  const p = panel();
  const prd = screen.getByRole('group', { name: 'PRD scores: claimed vs recomputed' });
  const pointer = within(p).getByTestId('scores-pointer');
  // The sentence reads as before; "PRD scores" in it is a link, named by its visible text.
  expect(pointer).toHaveTextContent('Mismatch 2 of 2 PRD scores do not reproduce with the stated method: see PRD scores, below the chart.');
  const link = within(pointer).getByRole('link', { name: 'PRD scores' });
  expect(within(p).getAllByRole('link')).toEqual([link]);

  // A real in-page link: its href names the PRD scores' heading, which script can focus (tabIndex -1) but which
  // is no extra Tab stop.
  const href = link.getAttribute('href') ?? '';
  expect(href).toMatch(/^#[A-Za-z][A-Za-z0-9-]*$/);
  const target = document.getElementById(href.slice(1))!;
  expect(prd).toContainElement(target);
  expect(target).toBe(within(prd).getByRole('heading', { level: 3 }));
  expect(target).toHaveTextContent('PRD scores: claimed vs recomputed');
  expect(target).toHaveAttribute('tabindex', '-1');

  // Keyboard: from the top Tab reaches the link before the chart's and the replay's controls, and Enter moves focus
  // to the heading; the hash route is untouched (hash routing owns location.hash).
  (document.activeElement as HTMLElement | null)?.blur();
  const stops: Element[] = [];
  for (let i = 0; i < 10 && document.activeElement !== link; i++) {
    await user.tab();
    stops.push(document.activeElement!);
  }
  expect(link).toHaveFocus();
  expect(stops).not.toContain(screen.getByRole('button', { name: 'Start replay' }));
  expect(stops).not.toContain(screen.getByRole('button', { name: 'Heat flux' }));
  await user.keyboard('{Enter}');
  expect(target).toHaveFocus();
  expect(location.hash).toBe('#/forecast');
  // From there Tab goes on after the PRD scores, not back into the chart or the replay's controls.
  await user.tab();
  expect(target.compareDocumentPosition(document.activeElement!) & FOLLOWING).toBeTruthy();

  // A pointer click does the same.
  screen.getByRole('button', { name: 'Start replay' }).focus();
  await user.click(link);
  expect(target).toHaveFocus();
  expect(location.hash).toBe('#/forecast');

  // The heading is not in the Tab order: tabbing through the whole page never stops on it.
  (document.activeElement as HTMLElement | null)?.blur();
  for (let i = 0; i < 40; i++) {
    await user.tab();
    expect(document.activeElement).not.toBe(target);
    if (document.activeElement === document.body) break;
  }
});

test('F7 (FC-R7, DS-4 kept) no mismatch, no pointer and no link; the PRD scores keep their heading', async () => {
  const ok = clone();
  ok.fixtures[0] = { ...ok.fixtures[0]!, computed: 0.04441, matches: true };
  ok.fixtures[1] = { ...ok.fixtures[1]!, computed: 0.04232, matches: true };
  serve(ok);
  render(<ForecastView />);
  const prd = await screen.findByRole('group', { name: 'PRD scores: claimed vs recomputed' });
  expect(screen.queryByTestId('scores-pointer')).toBeNull();
  expect(screen.queryByRole('link', { name: 'PRD scores' })).toBeNull();
  expect(within(prd).getByRole('heading', { level: 3 })).toHaveTextContent('PRD scores: claimed vs recomputed');
});

test('F7 (DZ3-8) the chart’s visible summary typesets the unit, Q with subscript gB,i; the spoken "Q gB,i" stays in the accessible description', async () => {
  const user = userEvent.setup();
  render(<ForecastView />);
  await screen.findByRole('button', { name: 'Start replay' });
  const figure = screen.getByRole('figure');
  const figcaption = figure.querySelector('figcaption')!;
  const check = (when: string, quantity: 'Heat flux' | 'Absolute error') => {
    const seen = seenText(figcaption);
    // Seen: the typeset unit, as the statistics beside the chart print it; never the spoken form or raw markup (FC-R5).
    expect(seen, when).toMatch(new RegExp(` ${quantity} in QgB,i\\.$`));
    expect(seen, when).not.toContain('Q gB,i');
    expect(seen, when).not.toMatch(/[_{}]/);
    const subs = [...figcaption.querySelectorAll('sub')];
    expect(subs.map((s) => s.textContent), when).toEqual(['gB,i']);
    expect(subs[0]!.parentElement!.innerHTML).toBe('<span>Q</span><sub>gB,i</sub>');
    expect(subs[0]!.closest('[aria-hidden="true"]')).not.toBeNull();
    // Heard: the figure's description (the figcaption as a screen reader reads it) speaks the unit as words.
    expect(figure).toHaveAccessibleDescription(new RegExp(` ${quantity} in Q gB,i\\.$`));
    expect(figure).not.toHaveAccessibleDescription(/QgB/);
  };
  check('overview', 'Heat flux');
  const primary = await startReplay(user);
  for (const presses of [0, 2, 3 * N_STEPS - 5]) {
    for (let i = 0; i < presses; i++) await user.click(primary);
    check(`after ${presses} more presses`, 'Heat flux');
  }
  await user.click(screen.getByRole('button', { name: 'Absolute error' }));
  check('absolute error', 'Absolute error');
});

test('F7 (DZ-9, one panel) the chart and its controls come before the statistics, the PRD scores and the table, in DOM and focus order (no CSS reordering)', async () => {
  const user = userEvent.setup();
  render(<ForecastView />);
  await startReplay(user);
  const p = panel();
  const prd = screen.getByRole('group', { name: 'PRD scores: claimed vs recomputed' });
  const replayControls = [
    screen.getByRole('button', { name: 'Heat flux' }),
    screen.getByRole('button', { name: 'Absolute error' }),
    screen.getByRole('radio', { name: 'Persistence' }),
    stepButton(),
    screen.getByRole('button', { name: 'Run to end' }),
    screen.getByRole('button', { name: 'Show all windows' }),
  ];
  for (const el of [...replayControls, screen.getByRole('figure'), screen.getByTestId('error-stats')])
    expect(el.compareDocumentPosition(prd) & FOLLOWING).toBeTruthy();
  expect(prd.compareDocumentPosition(screen.getByTestId('step-0')) & FOLLOWING).toBeTruthy();

  // Focus order from the top: the provenance badge, the pointer's link, then every control of the chart and the
  // replay, in that order, before anything after them.
  (document.activeElement as HTMLElement | null)?.blur();
  const order: Element[] = [];
  for (let i = 0; i < 40; i++) {
    await user.tab();
    const el = document.activeElement;
    if (!el || el === document.body || order.includes(el)) break;
    order.push(el);
  }
  expect(order.slice(0, 2)).toEqual([
    screen.getByRole('button', { name: 'Provenance of forecast replay: Derived, Failed' }),
    screen.getByRole('link', { name: 'PRD scores' }),
  ]);
  expect(order.slice(2, 2 + replayControls.length)).toEqual(replayControls);
  expect(order.every((el) => p.contains(el))).toBe(true);

  // The order is the DOM's: forecast.css moves nothing (no `order`, no reversed flex direction).
  const css = readFileSync(resolve(__dirname, 'forecast.css'), 'utf8');
  expect(css).not.toMatch(/(^|[\s;{])order\s*:/m);
  expect(css).not.toMatch(/-reverse/);
});
