// @vitest-environment node
// F7 / F8 (D-026): the pure parts of the predicted vs actual chart and of the error statistics.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  FORECASTERS,
  INITIAL,
  advance,
  completeState,
  plottedErrors,
  errorStatDisagreements,
  errorStatPrintDifferences,
  errorStatTolerance,
  formatStat,
  nextAction,
  plottedWindows,
  runToEnd,
  runToEndStates,
  runningErrorStat,
  stepLine,
  visibility,
  windowErrors,
  type ErrorStat,
  type ForecastArtifact,
  type ForecastStep,
  type ReplayState,
} from './model';

const ARTIFACT: ForecastArtifact = JSON.parse(readFileSync(resolve(__dirname, '../../../../artifacts/forecast.json'), 'utf8'));

const step = (a: number, observed: number, persistence: number, frozen: number): ForecastStep => ({
  window: [a, a + 50],
  observed,
  persistence,
  frozen,
  absErrPersistence: Math.abs(persistence - observed),
  absErrFrozen: Math.abs(frozen - observed),
});

test('F8 runningErrorStat: e = predicted − actual, MSE, RMSE and both ranges over the scored windows; all null before the first Update', () => {
  const steps = [step(0, 1, 1.5, 2), step(50, 2, 1, 2), step(100, 3, 3, 2)];
  expect(runningErrorStat(steps, 0, 'persistence')).toEqual({ n: 0, mse: null, rmse: null, squaredErrorRange: null, errorRange: null });
  expect(runningErrorStat([], 0, 'frozen').mse).toBeNull();
  // Signed: a forecast above the observation is a positive error.
  expect(windowErrors(steps, 3, 'persistence')).toEqual([0.5, -1, 0]);
  expect(windowErrors(steps, 3, 'frozen')).toEqual([1, 0, -1]);
  // Two windows scored: e = [0.5, −1], e² = [0.25, 1].
  expect(runningErrorStat(steps, 2, 'persistence')).toEqual({
    n: 2,
    mse: 0.625,
    rmse: Math.sqrt(0.625),
    squaredErrorRange: [0.25, 1],
    errorRange: [-1, 0.5],
  });
  // "Range of MSE" is the spread of the squared errors the MSE averages: its ends bracket the MSE.
  const all = runningErrorStat(steps, 3, 'persistence');
  expect(all).toEqual({ n: 3, mse: 1.25 / 3, rmse: Math.sqrt(1.25 / 3), squaredErrorRange: [0, 1], errorRange: [-1, 0.5] });
  expect(all.squaredErrorRange![0]).toBeLessThanOrEqual(all.mse!);
  expect(all.mse!).toBeLessThanOrEqual(all.squaredErrorRange![1]);
  expect(runningErrorStat(steps, 3, 'frozen')).toEqual({ n: 3, mse: 2 / 3, rmse: Math.sqrt(2 / 3), squaredErrorRange: [0, 1], errorRange: [-1, 1] });
  // Counting stops at the steps there are.
  expect(runningErrorStat(steps, 99, 'persistence')).toEqual(all);
});

/** Half a unit in the 7th significant figure: how far the artifact's rounding (common/io.py) can move v. */
const half7 = (v: number) => (v === 0 ? 0 : 0.5 * 10 ** (Math.floor(Math.log10(Math.abs(v))) - 6));

test('F8 after the last window the running statistics equal the artifact errorStats within its 7-significant-figure rounding', () => {
  const steps = ARTIFACT.steps;
  const n = steps.length;
  expect(n).toBe(8);
  for (const f of FORECASTERS) {
    const got = runningErrorStat(steps, n, f);
    const want = ARTIFACT.errorStats[f];
    expect(got.n).toBe(want.n);
    // main/ computes errorStats from the unrounded window means; the steps the replay reads are rounded to 7
    // significant figures, so each e_k can be off by d_k = half7(forecast_k) + half7(observed_k), each e_k² by
    // 2|e_k|·d_k + d_k², and every written statistic by half7 of itself.
    const e = windowErrors(steps, n, f);
    const d = steps.map((st) => half7(st[f]) + half7(st.observed));
    const dSq = e.map((x, k) => 2 * Math.abs(x) * d[k]! + d[k]! ** 2);
    const tolE = Math.max(...d);
    const tolSq = Math.max(...dSq);
    const tolMse = dSq.reduce((acc, x) => acc + x, 0) / n;
    const tolRmse = (tolMse / (Math.sqrt(got.mse!) + Math.sqrt(want.mse!))) * (1 + 1e-6);
    const close = (what: string, g: number, w: number, tol: number) =>
      expect(Math.abs(g - w), `${f} ${what}: ${g} vs ${w}`).toBeLessThanOrEqual(tol + half7(w) + 1e-15);
    close('MSE', got.mse!, want.mse!, tolMse);
    close('RMSE', got.rmse!, want.rmse!, tolRmse);
    close('range of MSE min', got.squaredErrorRange![0], want.squaredErrorRange![0], tolSq);
    close('range of MSE max', got.squaredErrorRange![1], want.squaredErrorRange![1], tolSq);
    close('range of errors min', got.errorRange![0], want.errorRange![0], tolE);
    close('range of errors max', got.errorRange![1], want.errorRange![1], tolE);
    // model.ts bounds the rounding the same way (errorStatDisagreements uses it).
    expect(errorStatTolerance(steps, n, f)).toEqual({ e: tolE, sq: tolSq, mse: tolMse });
    // The errors print at 4 decimals and the MSE at 3 significant figures: both bounds are far below that. The bound
    // on the smallest e² (persistence: 6.32e-6, bound 5.0e-9) is not: it is about half a unit in its third significant
    // figure, so near a rounding boundary the two sides could print differently without disagreeing (FC-R3).
    expect(tolE).toBeLessThan(0.5e-4 / 10);
    expect(tolMse).toBeLessThan((0.5 * 10 ** (Math.floor(Math.log10(want.mse!)) - 2)) / 10);
    // And the check can fail: an MSE off by 0.1 % is outside it.
    expect(Math.abs(got.mse! - want.mse! * 1.001)).toBeGreaterThan(tolMse + half7(want.mse!));
  }
});

test('F8 the squared quantities print to 3 significant figures, the others to 4 decimals with a sign on the errors', () => {
  expect(formatStat('squaredErrorRange', 6.322213e-6)).toBe('0.00000632'); // not "0.000006" (one figure)
  expect(formatStat('squaredErrorRange', 0.01607565)).toBe('0.0161');
  expect(formatStat('mse', 0.003276294)).toBe('0.00328');
  expect(formatStat('mse', 0.0001621632)).toBe('0.000162');
  expect(formatStat('mse', 0.009996)).toBe('0.0100'); // rounding up into the next decade keeps 3 figures
  expect(formatStat('mse', 12.345)).toBe('12.3');
  expect(formatStat('mse', 0)).toBe('0.00');
  expect(formatStat('rmse', 0.05723892)).toBe('0.0572');
  expect(formatStat('errorRange', -0.1267898)).toBe('−0.1268');
  expect(formatStat('errorRange', 0.06758097)).toBe('+0.0676');
  expect(formatStat('mse', null)).toBe('—');
});

test('F8 errorStatDisagreements names each statistic that differs from errorStats by more than the steps’ rounding', () => {
  const n = ARTIFACT.steps.length;
  const tolOf = (f: (typeof FORECASTERS)[number], k = n) => errorStatTolerance(ARTIFACT.steps, k, f);
  for (const f of FORECASTERS) {
    const got = runningErrorStat(ARTIFACT.steps, n, f);
    expect(errorStatDisagreements(got, ARTIFACT.errorStats[f], tolOf(f))).toEqual([]);
    expect(errorStatPrintDifferences(got, ARTIFACT.errorStats[f])).toEqual([]);
  }
  const got = runningErrorStat(ARTIFACT.steps, n, 'persistence');
  const tol = tolOf('persistence');
  const w = ARTIFACT.errorStats.persistence;
  expect(errorStatDisagreements(got, { ...w, mse: w.mse! + 1e-5 }, tol)).toEqual(['MSE']);
  expect(errorStatDisagreements(got, { ...w, rmse: w.rmse! + 1e-3, errorRange: [w.errorRange![0], 0.07] }, tol)).toEqual(['RMSE', 'range of errors']);
  expect(errorStatDisagreements(got, { ...w, squaredErrorRange: [0.00001, w.squaredErrorRange![1]] }, tol)).toEqual(['range of MSE']);
  expect(errorStatDisagreements(got, { ...w, n: 7 }, tol)).toEqual(['n']);
  expect(errorStatDisagreements(got, { ...w, mse: null }, tol)).toEqual(['MSE']);
  expect(errorStatDisagreements(got, { ...w, errorRange: null }, tol)).toEqual(['range of errors']);
  expect(errorStatDisagreements(got, undefined, tol)).toEqual(['errorStats missing']);
  // A stale MSE that still prints as the replay's (0.00328) but lies beyond the rounding bound is flagged: below
  // half a printed unit is not "equal".
  const stale = { ...w, mse: w.mse! + 1e-6 };
  expect([formatStat('mse', stale.mse), formatStat('mse', got.mse)]).toEqual(['0.00328', '0.00328']);
  expect(errorStatPrintDifferences(got, stale)).toEqual([]);
  expect(errorStatDisagreements(got, stale, tol)).toEqual(['MSE']);
  // A partial replay is not the full-run statistic.
  expect(errorStatDisagreements(runningErrorStat(ARTIFACT.steps, n - 1, 'persistence'), w, tolOf('persistence', n - 1))).toContain('n');
  // No steps: nulls on both sides agree.
  const none = { n: 0, mse: null, rmse: null, squaredErrorRange: null, errorRange: null };
  expect(errorStatTolerance([], 0, 'frozen')).toEqual({ e: 0, sq: 0, mse: 0 });
  expect(errorStatDisagreements(runningErrorStat([], 0, 'frozen'), none, errorStatTolerance([], 0, 'frozen'))).toEqual([]);
});

test('F8 (FC-R3) a value within the steps’ rounding of errorStats is no disagreement, even where the two print differently', () => {
  // A regenerated artifact whose MSE sits 1.0e-8 from the 3-figure boundary 0.003905: main/'s unrounded value prints
  // 0.00390, the replay's (from steps rounded to 7 figures) 0.00391. The steps' rounding allows 1.25e-7 here.
  const steps = Array.from({ length: 8 }, (_, k) => step(1500 + 50 * k, 2, 2.06249, 2));
  const got = runningErrorStat(steps, 8, 'persistence');
  const tol = errorStatTolerance(steps, 8, 'persistence');
  expect(tol.mse).toBeCloseTo(2 * 0.06249 * 1e-6 + 1e-12, 15);
  const artifact: ErrorStat = { ...got, mse: 0.00390499, squaredErrorRange: [0.00390499, 0.00390499] };
  expect([formatStat('mse', got.mse), formatStat('mse', artifact.mse)]).toEqual(['0.00391', '0.00390']);
  // Comparing the printed strings would call this artifact stale; it is not.
  expect(errorStatDisagreements(got, artifact, tol)).toEqual([]);
  expect(errorStatPrintDifferences(got, artifact)).toEqual([
    { name: 'MSE', artifact: '0.00390' },
    { name: 'range of MSE', artifact: '0.00390 to 0.00390' },
  ]);
  // Twice the bound away it is a disagreement again.
  expect(errorStatDisagreements(got, { ...artifact, mse: got.mse! - 2.5e-7 }, tol)).toEqual(['MSE']);
});

test('F7 plottedWindows: Predicted only after Predict, Actual only after Reveal, for the selected forecaster', () => {
  const steps = ARTIFACT.steps;
  const n = steps.length;
  const s0 = steps[0]!;
  let s = INITIAL;
  expect(plottedWindows(steps, s, 'persistence')).toEqual({ predicted: [], actual: [] });
  s = advance(s, n); // window 1 predicted
  expect(plottedWindows(steps, s, 'persistence')).toEqual({ predicted: [{ window: [1500, 1550], value: s0.persistence }], actual: [] });
  expect(plottedWindows(steps, s, 'frozen')).toEqual({ predicted: [{ window: [1500, 1550], value: s0.frozen }], actual: [] });
  s = advance(s, n); // window 1 revealed
  expect(plottedWindows(steps, s, 'persistence').actual).toEqual([{ window: [1500, 1550], value: s0.observed }]);

  // Over the whole replay both lines are prefixes of the windows, and Actual never runs ahead of Predicted.
  let t = INITIAL;
  for (let k = 0; k <= 3 * n; k++, t = advance(t, n)) {
    for (const f of ['persistence', 'frozen'] as const) {
      const { predicted, actual } = plottedWindows(steps, t, f);
      expect(predicted).toEqual(steps.slice(0, predicted.length).map((st) => ({ window: st.window, value: st[f] })));
      expect(actual).toEqual(steps.slice(0, actual.length).map((st) => ({ window: st.window, value: st.observed })));
      expect(actual.length).toBeLessThanOrEqual(predicted.length);
      expect(predicted.length).toBe(t.index + (t.index < n && t.phase !== 'ready' ? 1 : 0));
      expect(actual.length).toBe(t.index + (t.index < n && t.phase === 'revealed' ? 1 : 0));
    }
  }
  expect(t.index).toBe(n);
});

test('F7 (DZ-9) runToEndStates is the step button pressed to the end from every state: Predict → Reveal → Update per window, observed only after its forecast', () => {
  const steps = ARTIFACT.steps;
  const n = steps.length;
  // Every state the replay can be in, in step order (3 per window, then complete).
  const all: ReplayState[] = [INITIAL];
  while (nextAction(all.at(-1)!, n) !== 'done') all.push(advance(all.at(-1)!, n));
  expect(all).toHaveLength(3 * n + 1);
  all.forEach((start, k) => {
    const tag = `from ${start.index}/${start.phase}`;
    const run = runToEndStates(start, n);
    // Exactly the states the step button would pass through, none skipped, none added.
    expect(run, tag).toEqual(all.slice(k + 1));
    expect(runToEnd(start, n), tag).toEqual(all.at(-1));
    expect(nextAction(runToEnd(start, n), n), tag).toBe('done');
    // Along the run, each window is predicted in an earlier state than the one that reveals it, and a window
    // is never revealed while its forecasts are hidden; what the chart may draw follows the same order.
    const seq = [start, ...run];
    for (let i = 0; i < n; i++) {
      const predictedAt = seq.findIndex((s) => visibility(s, i).forecasts);
      const revealedAt = seq.findIndex((s) => visibility(s, i).observed);
      // Every window ends predicted and revealed.
      expect(predictedAt, `${tag}, window ${i} predicted`).toBeGreaterThanOrEqual(0);
      expect(revealedAt, `${tag}, window ${i} revealed`).toBeGreaterThanOrEqual(0);
      // Revealed by the run (not before it): strictly after the state that showed its forecasts.
      if (revealedAt > 0) expect(revealedAt, `${tag}, window ${i}`).toBeGreaterThan(predictedAt);
      else expect(predictedAt, `${tag}, window ${i} revealed before the run`).toBe(0);
    }
    for (const s of seq) {
      for (const f of FORECASTERS) {
        const { predicted, actual } = plottedWindows(steps, s, f);
        const predictedWindows = predicted.map((w) => w.window);
        for (const w of actual) expect(predictedWindows, `${tag}: state ${s.index}/${s.phase}, ${f}`).toContainEqual(w.window);
      }
    }
  });
  // Complete: nothing to run, the state is unchanged.
  expect(runToEndStates(all.at(-1)!, n)).toEqual([]);
  expect(runToEnd(all.at(-1)!, n)).toBe(all.at(-1));
  expect(runToEndStates(INITIAL, 0)).toEqual([]);
});

test('F7 completeState is where the step button ends (the overview shows it); plottedErrors draws each forecaster’s |e| only for revealed windows', () => {
  const steps = ARTIFACT.steps;
  const n = steps.length;
  let s = INITIAL;
  for (let k = 0; k < 3 * n; k++) s = advance(s, n);
  expect(completeState(n)).toEqual(s);
  expect(nextAction(completeState(n), n)).toBe('done');
  expect(completeState(0)).toEqual({ index: 0, phase: 'ready' });
  // The overview: every window of both lines, and every |e|.
  expect(plottedWindows(steps, completeState(n), 'persistence').actual).toHaveLength(n);
  const all = plottedErrors(steps, completeState(n));
  expect(all.persistence.map((w) => w.value)).toEqual(steps.map((st) => st.absErrPersistence));
  expect(all.frozen.map((w) => w.value)).toEqual(steps.map((st) => st.absErrFrozen));
  // In a replay a window's |e| needs its observed mean: nothing before its Reveal, exactly the revealed windows after.
  let t = INITIAL;
  for (let k = 0; k <= 3 * n; k++, t = advance(t, n)) {
    const e = plottedErrors(steps, t);
    const revealed = steps.filter((_, i) => visibility(t, i).observed);
    expect(e.persistence.map((w) => w.window), `state ${t.index}/${t.phase}`).toEqual(revealed.map((st) => st.window));
    expect(e.frozen.map((w) => w.value)).toEqual(revealed.map((st) => st.absErrFrozen));
    expect(e.persistence.length).toBe(plottedWindows(steps, t, 'frozen').actual.length);
  }
  expect(plottedErrors(steps, advance(INITIAL, n))).toEqual({ persistence: [], frozen: [] });
});

test('F7 stepLine holds each value over its window, joins contiguous windows with a riser, and breaks the line at a gap', () => {
  expect(stepLine([])).toEqual({ x: [], y: [], mid: [], window: [] });
  const line = stepLine([
    { window: [1500, 1550], value: 2 },
    { window: [1550, 1600], value: 3 },
    { window: [1650, 1700], value: 1 },
  ]);
  expect(line.x).toEqual([1500, 1525, 1550, 1550, 1575, 1600, null, 1650, 1675, 1700]);
  expect(line.y).toEqual([2, 2, 2, 3, 3, 3, null, 1, 1, 1]);
  expect(line.mid).toEqual([false, true, false, false, true, false, false, false, true, false]);
  const w = (s: string) => [s, s, s];
  expect(line.window).toEqual([...w('1500–1550'), ...w('1550–1600'), null, ...w('1650–1700')]);
});
