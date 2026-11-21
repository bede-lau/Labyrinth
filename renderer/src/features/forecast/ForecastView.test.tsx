import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { forecastStyle, formatNumber, formatSigned, formatWindow } from '../../design';
import { liveStatusStore, modePills, type LiveStatus, type LiveWorker } from '../../lib/liveStatus';
import { fluxRange } from './chart';
import { ForecastView } from './ForecastView';
import {
  INITIAL,
  advance,
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
const plotly = vi.hoisted(() => ({ react: vi.fn(async () => undefined), purge: vi.fn() }));
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

/* Error statistics (F8), recomputed here and not with model.ts. */
const Q = 'Q gB,i';
const Q2 = 'Q gB,i²';
type Fc = 'persistence' | 'frozen';
/** Accessible names of the four error statistics shown, in order. */
const statNames = () => [...within(screen.getByTestId('error-stats')).getAllByRole('group')].map((g) => g.getAttribute('aria-label'));
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
/** Before every window is scored, the statistics are not compared with errorStats at all: no check, no warning (FC-R2). */
function expectNoErrorStatsCheck(when: string) {
  expect(screen.queryByTestId('error-stats-check'), when).toBeNull();
  expect(screen.queryByRole('note', { name: /differ from artifacts\/forecast\.json/ }), when).toBeNull();
}

test('F4 step-through Predict → Reveal → Update is keyboard operable, hides observed until revealed, and resets', async () => {
  const user = userEvent.setup();
  render(<ForecastView />);
  const s0 = ARTIFACT.steps[0]!;
  const primary = await screen.findByRole('button', { name: 'Predict 1500–1550' });
  const row0 = screen.getByTestId('step-0');
  expect(within(row0).queryByText(f3(s0.persistence))).toBeNull();

  // Keyboard only: Tab reaches the primary control; Enter / Space drive the replay.
  await user.tab();
  while (document.activeElement !== primary) await user.tab();
  await user.keyboard('{Enter}');
  expect(primary).toHaveAccessibleName('Reveal observed 1500–1550');
  expect(primary).toHaveFocus();
  expect(within(row0).getAllByText(f3(s0.persistence)).length).toBe(2); // persistence + frozen (equal at step 0)
  expect(within(row0).getByText('hidden')).toBeInTheDocument();
  expect(within(row0).queryByText(f3(s0.observed))).toBeNull();
  expect(screen.getByRole('group', { name: 'Observed (archive): hidden until revealed' })).toBeInTheDocument();
  expect(screen.getByTestId('announce')).toHaveTextContent('observed hidden');

  await user.keyboard(' ');
  expect(within(row0).getByText(f3(s0.observed))).toBeInTheDocument();
  expect(within(row0).getAllByText(formatNumber(s0.absErrPersistence, 4))).toHaveLength(2);
  expect(primary).toHaveAccessibleName('Update forecasts → 1550–1600');

  await user.keyboard('{Enter}');
  expect(primary).toHaveAccessibleName('Predict 1550–1600');
  // Next window's observed stays hidden even after its forecasts are shown.
  await user.keyboard('{Enter}');
  const row1 = screen.getByTestId('step-1');
  expect(within(row1).getByText('hidden')).toBeInTheDocument();
  expect(within(row1).queryByText(f3(ARTIFACT.steps[1]!.observed))).toBeNull();

  // Tab order: the step button, Run to end, Reset. Reset (keyboard) returns to the start with nothing revealed.
  await user.tab();
  expect(screen.getByRole('button', { name: 'Run to end' })).toHaveFocus();
  await user.tab();
  expect(screen.getByRole('button', { name: 'Reset' })).toHaveFocus();
  await user.keyboard('{Enter}');
  expect(screen.getByRole('button', { name: 'Predict 1500–1550' })).toHaveFocus();
  expect(within(screen.getByTestId('step-0')).queryByText(f3(s0.observed))).toBeNull();
  expect(screen.getByRole('button', { name: 'Reset' })).toBeDisabled();

  // Pure state machine: 3 actions per window, then complete.
  let s = INITIAL;
  for (let i = 0; i < 3 * ARTIFACT.steps.length; i++) s = advance(s, ARTIFACT.steps.length);
  expect(s.index).toBe(ARTIFACT.steps.length);
  expect(advance(s, ARTIFACT.steps.length)).toBe(s);
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

test('F4 no peeking in the view: every row, the current-window block and the live region, in all 25 states', async () => {
  const user = userEvent.setup();
  render(<ForecastView />);
  const primary = await screen.findByRole('button', { name: 'Predict 1500–1550' });
  const steps = ARTIFACT.steps;
  const n = steps.length;
  const shown = (i: number) => {
    const st = steps[i]!;
    return [f3(st.persistence), f3(st.frozen), f3(st.observed), f4(st.absErrPersistence), f4(st.absErrFrozen)];
  };
  const replay = () => screen.getByRole('region', { name: /Predict the next 50-unit mean/ });

  let s = INITIAL;
  let states = 0;
  for (;;) {
    states++;
    const action = nextAction(s, n);
    for (let i = 0; i < n; i++) {
      const st = steps[i]!;
      const want =
        i < s.index
          ? shown(i)
          : i > s.index || s.phase === 'ready'
            ? DASHES
            : s.phase === 'predicted'
              ? [f3(st.persistence), f3(st.frozen), 'hidden', '—', '—']
              : shown(i);
      expect(cells(i), `state ${s.index}/${s.phase}, row ${i}`).toEqual(want);
    }
    // Nothing that has not been revealed is anywhere in the replay panel: not in another cell, the
    // current-window block, the chart's summary, the running MAE or the live region. The error statistics
    // are left out of this substring scan, because a running RMSE can print like a hidden window's error
    // by coincidence (0.0676 after four windows, the |error| of window 7); instead they must equal a
    // recomputation over the scored windows only, which no hidden value enters.
    const panel = replay().cloneNode(true) as HTMLElement;
    panel.querySelector('[data-testid="error-stats"]')!.remove();
    const text = panel.textContent ?? '';
    expect(statNames(), `error statistics in state ${s.index}/${s.phase}`).toEqual(expectedStatNames(steps, s.index, 'persistence'));
    for (let i = 0; i < n; i++) {
      const revealed = i < s.index || (i === s.index && s.phase === 'revealed');
      if (!revealed) {
        expect(text.includes(f3(steps[i]!.observed)), `observed of row ${i} leaked in state ${s.index}/${s.phase}`).toBe(false);
        expect(text.includes(f4(steps[i]!.absErrPersistence)), `error of row ${i} leaked in state ${s.index}/${s.phase}`).toBe(false);
      }
    }
    const announce = screen.getByTestId('announce').textContent ?? '';
    if (action === 'reveal') {
      const cur = steps[s.index]!;
      expect(announce).toContain('observed hidden');
      expect(announce).toContain(`persistence forecast ${f3(cur.persistence)}`);
      expect(announce).not.toContain(f3(cur.observed));
      expect(announce).not.toMatch(/absolute error/);
      expect(screen.getByRole('group', { name: 'Observed (archive): hidden until revealed' })).toBeInTheDocument();
    } else if (action === 'predict') {
      expect(announce).toContain('nothing predicted yet');
      expect(announce).not.toMatch(/forecast [0-9]|observed [0-9]/);
      expect(screen.getAllByRole('group', { name: /: not predicted yet$/ })).toHaveLength(2);
    } else if (action === 'update') {
      expect(announce).toContain(`observed ${f3(steps[s.index]!.observed)}`);
    } else {
      expect(announce).toBe(`Replay complete. All ${n} windows scored.`);
    }
    if (action === 'done') break;
    await user.click(primary);
    s = advance(s, n);
  }
  expect(states).toBe(3 * n + 1);
  // Past the end nothing changes.
  expect(primary).toBeDisabled();
  expect(cells(n - 1)).toEqual(shown(n - 1));
});

test('F5 running MAE for both forecasters and final computed vs claimed scores with mismatch flag', async () => {
  const user = userEvent.setup();
  render(<ForecastView />);
  const primary = await screen.findByRole('button', { name: /^Predict/ });
  expect(screen.getByRole('group', { name: /^Running MAE · persistence: not scored yet/ })).toBeInTheDocument();

  // Score the first window: running MAE = that window's absolute error.
  for (let i = 0; i < 3; i++) await user.click(primary);
  const s0 = ARTIFACT.steps[0]!;
  expect(screen.getByRole('group', { name: `Running MAE · persistence: ${formatNumber(s0.absErrPersistence, 4)} Q gB,i` })).toBeInTheDocument();

  // Finish the replay: running MAE equals the artifact's final MAE.
  for (let i = 3; i < 3 * ARTIFACT.steps.length; i++) await user.click(primary);
  expect(primary).toBeDisabled();
  expect(primary).toHaveAccessibleName('Replay complete');
  const persistence = formatNumber(ARTIFACT.mae.persistence, 4);
  const frozen = formatNumber(ARTIFACT.mae.frozen, 4);
  expect(screen.getByRole('group', { name: `Running MAE · persistence: ${persistence} Q gB,i` })).toBeInTheDocument();
  expect(screen.getByRole('group', { name: `Running MAE · frozen: ${frozen} Q gB,i` })).toBeInTheDocument();
  const mae = runningMae(ARTIFACT.steps, ARTIFACT.steps.length)!;
  expect(mae.persistence).toBeCloseTo(ARTIFACT.mae.persistence, 6);

  // Final: claimed 0.0444 / 0.0423 vs computed, flagged as mismatch (never rounded to the claim).
  const final = screen.getByRole('region', { name: /Final scores: recomputed vs PRD claim/ });
  expect(within(final).getByRole('group', { name: /^stella MAE, persistence forecast: Mismatch\. Claimed 0\.0444.*computed 0\.0440/ })).toBeInTheDocument();
  expect(within(final).getByRole('group', { name: /^stella MAE, frozen forecast: Mismatch\. Claimed 0\.0423.*computed 0\.0418/ })).toBeInTheDocument();
  // D-016 note: sample-and-hold reproduces the PRD scores but breaks the 2.55 archive fixture.
  const note = within(final).getByRole('note', { name: /different window-mean definition/ });
  expect(note).toHaveTextContent('0.044418 → 0.0444');
  expect(note).toHaveTextContent('0.042332 → 0.0423');
  expect(note).toHaveTextContent(/prints 2\.56 vs PRD 2\.55/);
  expect(parseSampleAndHold(ARTIFACT.fixtures[0]?.note)?.archive?.claimed).toBe('2.55');
});

test('F5 the failed verification and the mismatch are the first thing on the page, and the wording never equates forecast and observation', async () => {
  render(<ForecastView />);
  const final = await screen.findByRole('region', { name: /Final scores: recomputed vs PRD claim/ });
  const replay = screen.getByRole('region', { name: /Predict the next 50-unit mean/ });
  // DZ-9: the replay with its chart comes first and the final scores directly after it (DOM order, see the
  // DZ-9 order test below).
  const panels = screen.getAllByRole('region').filter((r) => r.classList.contains('lab-panel'));
  expect(panels.map((p) => within(p).getAllByRole('heading')[0]!.textContent)).toEqual([
    'Predict the next 50-unit mean of the stella bean flux',
    'Final scores: recomputed vs PRD claim',
  ]);
  expect(replay.nextElementSibling).toBe(final);
  // DS-4 still holds: before the controls, the chart or any number of the replay, its header carries the failed
  // verification and its first line the mismatch, in words, pointing at the final scores.
  expect(within(replay.querySelector('.lab-panel__header') as HTMLElement).getByRole('button', { name: 'Provenance of forecast replay: Derived, Failed' })).toBeInTheDocument();
  const pointer = within(replay).getByTestId('scores-pointer');
  expect(replay.querySelector('.lab-panel__body')!.firstElementChild).toBe(pointer);
  expect(pointer).toHaveTextContent('Mismatch 2 of 2 PRD scores do not reproduce with the stated method: see Final scores, below the replay.');
  expect(pointer.querySelector('svg[data-icon="cross"]')).toHaveAttribute('aria-hidden', 'true');
  for (const later of [screen.getByRole('button', { name: /^Predict/ }), screen.getByRole('figure'), screen.getByTestId('error-stats')])
    expect(pointer.compareDocumentPosition(later) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  // The artifact's verification outcome ("failed") is shown with the scores and on the provenance badge.
  expect(ARTIFACT.provenance.verification.outcome).toBe('failed');
  expect(final.querySelector('.lab-panel__header .lab-pill[data-status="failed"]')).toHaveTextContent('Failed');
  expect(final.querySelector('.lab-panel__header .lab-pill[data-status="derived"]')).toHaveTextContent('Derived');
  expect(screen.getByRole('button', { name: 'Provenance of forecast replay: Derived, Failed' })).toBeInTheDocument();
  expect(document.querySelector('.lab-pill[data-status="passed"]')).toBeNull();
  // The two score rows are the first content of the final scores panel, each with claimed, computed, Δ and
  // "Mismatch" in words: the panel the pointer names, directly after the replay.
  const rows = [...within(final).getByTestId('final-scores').querySelectorAll('.lab-fixture')];
  expect(rows.map((r) => `${r.getAttribute('data-outcome')}|${r.getAttribute('aria-label')}`)).toEqual([
    'mismatch|stella MAE, persistence forecast: Mismatch. Claimed 0.0444 Q gB,i, computed 0.0440 Q gB,i, difference minus 0.0004',
    'mismatch|stella MAE, frozen forecast: Mismatch. Claimed 0.0423 Q gB,i, computed 0.0418 Q gB,i, difference minus 0.0005',
  ]);
  for (const r of rows) expect(within(r as HTMLElement).getByText('Mismatch')).toBeInTheDocument();
  expect(final.querySelector('.lab-panel__body')!.firstElementChild).toBe(within(final).getByTestId('final-scores'));
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
  const final = await screen.findByRole('region', { name: /Final scores: recomputed vs PRD claim/ });
  const rows = [...within(final).getByTestId('final-scores').querySelectorAll('.lab-fixture')];
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
  const final = await screen.findByRole('region', { name: /Final scores: recomputed vs PRD claim/ });
  expect(within(final).queryByRole('note')).toBeNull();
  expect(within(final).queryByText('Mismatch')).toBeNull();
  expect(final).not.toHaveTextContent(/do not reproduce|different window-mean definition|shown as mismatches/);
  expect(within(final).getAllByText('Match').length).toBeGreaterThanOrEqual(2);
  expect(final.querySelector('.lab-pill[data-status="failed"]')).toBeNull();
  expect(final.querySelector('.lab-panel__header .lab-pill[data-status="passed"]')).toHaveTextContent('Verified');
  expect(screen.getByRole('button', { name: 'Provenance of forecast replay: Derived, Verified' })).toBeInTheDocument();
  // Nor a mismatch pointer at the top of the replay.
  expect(screen.queryByTestId('scores-pointer')).toBeNull();
  expect(document.body).not.toHaveTextContent(/PRD scores? do(es)? not reproduce/);
  first.unmount();

  // Only the frozen score fails: the callout stays and names how many scores are affected.
  const one = clone();
  one.fixtures[0] = { ...one.fixtures[0]!, computed: 0.04441, matches: true };
  expect(mismatchedScores(one).map((x) => x.id)).toEqual(['mae-frozen']);
  serve(one);
  const second = render(<ForecastView />);
  const final2 = await screen.findByRole('region', { name: /Final scores: recomputed vs PRD claim/ });
  expect(within(final2).getByRole('note', { name: /different window-mean definition/ })).toHaveTextContent(/1 of 2 scores is shown as a mismatch/);
  expect(within(final2).getAllByText('Mismatch').length).toBeGreaterThanOrEqual(1);
  expect(screen.getByTestId('scores-pointer')).toHaveTextContent('Mismatch 1 of 2 PRD scores does not reproduce with the stated method');
  second.unmount();

  // A note without the sample-and-hold numbers: still a mismatch callout, but no invented figures.
  const bare = clone();
  for (const fx of bare.fixtures) fx.note = 'Computed with the stated method; not tuned to the PRD.';
  serve(bare);
  render(<ForecastView />);
  const final3 = await screen.findByRole('region', { name: /Final scores: recomputed vs PRD claim/ });
  const generic = within(final3).getByRole('note', { name: /The PRD scores do not reproduce with the stated method/ });
  expect(generic).not.toHaveTextContent(/0\.044418|2\.56/);
  expect(generic).toHaveTextContent(/2 of 2 scores are shown as mismatches/);
});

test('F5 an artifact whose provenance kind is "live" is shown as a recorded run: replayed scores never earn the LIVE pill', async () => {
  const a = clone();
  a.provenance = { ...a.provenance, kind: 'live' };
  serve(a);
  render(<ForecastView />);
  const final = await screen.findByRole('region', { name: /Final scores: recomputed vs PRD claim/ });
  const pill = final.querySelector('.lab-panel__header .lab-pill')!;
  expect(pill).toHaveAttribute('data-status', 'replay');
  expect(pill).toHaveTextContent('Recorded run');
  expect(document.querySelector('.lab-pill[data-status="live"]')).toBeNull();
  expect(screen.getByRole('button', { name: 'Provenance of forecast replay: Recorded run, Failed' })).toBeInTheDocument();
});

test('F4 an artifact with no steps shows an empty state instead of crashing', async () => {
  serve({ ...clone(), steps: [] });
  render(<ForecastView />);
  const empty = await screen.findByRole('note', { name: /No forecast windows in artifacts\/forecast\.json/ });
  expect(empty).toHaveTextContent(/nothing to step through/i);
  expect(screen.queryByRole('button', { name: /^Predict/ })).toBeNull();
  expect(screen.queryByRole('table')).toBeNull();
  // The scores panel still renders what the artifact does carry.
  expect(screen.getByRole('region', { name: /Final scores: recomputed vs PRD claim/ })).toBeInTheDocument();
  expect(runningMae([], 0)).toBeNull();
  expect(nextAction(INITIAL, 0)).toBe('done');
});

test('A3 forecast: a missing or invalid artifact shows an error naming the file, never a blank view', async () => {
  serve({ error: 'gone' }, 404);
  const first = render(<ForecastView />);
  expect(screen.getByRole('heading', { name: 'Loading forecast replay…' })).toBeInTheDocument();
  expect(await screen.findByRole('heading', { name: 'Forecast replay could not be loaded' })).toBeInTheDocument();
  expect(screen.getByRole('note', { name: /artifacts\/forecast\.json failed to load/ })).toHaveTextContent('/artifacts/forecast.json: HTTP 404');
  expect(screen.queryByRole('button', { name: /^Predict/ })).toBeNull();
  first.unmount();

  serve({ ...ARTIFACT, schemaVersion: 3 });
  render(<ForecastView />);
  expect(await screen.findByRole('note', { name: /artifacts\/forecast\.json failed to load/ })).toHaveTextContent('unexpected schemaVersion');
});

test('FF-14 the mismatch count follows the rows: a flag that disagrees with the printed values counts as a mismatch', async () => {
  const a = clone();
  // mae-frozen says matches:true, but 0.0418 does not print as the PRD's 0.0423: its row is a Mismatch.
  a.fixtures[1] = { ...a.fixtures[1]!, computed: 0.0418, matches: true };
  expect(mismatchedScores(a).map((f) => f.id)).toEqual(['mae-persistence', 'mae-frozen']);
  serve(a);
  render(<ForecastView />);
  const final = await screen.findByRole('region', { name: /Final scores: recomputed vs PRD claim/ });
  const rows = [...within(final).getByTestId('final-scores').querySelectorAll('.lab-fixture')];
  expect(rows.map((r) => r.getAttribute('data-outcome'))).toEqual(['mismatch', 'mismatch']);
  expect(within(final).getByRole('note')).toHaveTextContent(/2 of 2 scores are shown as mismatches/);
  expect(final).not.toHaveTextContent(/1 of 2 scores/);
  // The pointer at the top of the replay counts the same rows.
  expect(screen.getByTestId('scores-pointer')).toHaveTextContent('Mismatch 2 of 2 PRD scores do not reproduce');
});

test('FF-7 a score that cannot be recomputed (matches null) is not a mismatch: no callout, a "Not recomputable" row', async () => {
  const a = clone();
  a.fixtures[0] = { ...a.fixtures[0]!, computed: null, matches: null };
  a.fixtures[1] = { ...a.fixtures[1]!, computed: 0.04232, matches: true };
  expect(mismatchedScores(a)).toEqual([]);
  serve(a);
  render(<ForecastView />);
  const final = await screen.findByRole('region', { name: /Final scores: recomputed vs PRD claim/ });
  expect(within(final).getByRole('group', { name: /^stella MAE, persistence forecast: Not recomputable\./ })).toHaveAttribute('data-outcome', 'unknown');
  expect(within(final).queryByRole('note')).toBeNull();
  expect(within(final).queryByText('Mismatch')).toBeNull();
  expect(final).not.toHaveTextContent(/shown as a mismatch|do not reproduce|different window-mean definition/);
  expect(screen.queryByTestId('scores-pointer')).toBeNull();
});

test('FF-9 the sample-and-hold callout says "matching the PRD" only when its printed values are the PRD claims', async () => {
  // Committed note: 0.0444 and 0.0423 are exactly the PRD's printed scores.
  expect(sampleAndHoldMatchesPrd(parseSampleAndHold(ARTIFACT.fixtures[0]?.note)!, ARTIFACT)).toBe(true);
  serve();
  const first = render(<ForecastView />);
  const final = await screen.findByRole('region', { name: /Final scores: recomputed vs PRD claim/ });
  expect(within(final).getByRole('note', { name: /different window-mean definition/ })).toHaveTextContent(/matching the PRD/);
  first.unmount();

  // A note whose sample-and-hold frozen score prints 0.0421 against the PRD's 0.0423: no "matching the PRD".
  const a = clone();
  for (const f of a.fixtures) f.note = f.note!.replace('frozen 0.042332 → 0.0423', 'frozen 0.042132 → 0.0421');
  const sah = parseSampleAndHold(a.fixtures[0]?.note)!;
  expect(sah.frozen).toEqual(['0.042132', '0.0421']);
  expect(sampleAndHoldMatchesPrd(sah, a)).toBe(false);
  serve(a);
  render(<ForecastView />);
  const final2 = await screen.findByRole('region', { name: /Final scores: recomputed vs PRD claim/ });
  const note = within(final2).getByRole('note', { name: /The PRD scores do not reproduce with the stated method/ });
  expect(note).toHaveTextContent("0.042132 → 0.0421, which does not match the PRD's printed 0.0444 and 0.0423 either.");
  expect(note).toHaveTextContent(/2 of 2 scores are shown as mismatches/);
  expect(final2).not.toHaveTextContent(/matching the PRD|reproduce only under a different window-mean definition/);
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
const replayPill = () =>
  screen.getByRole('region', { name: /Predict the next 50-unit mean/ }).querySelector('.lab-panel__header .lab-pill[data-status="replay"]');

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
  await screen.findByRole('button', { name: /^Predict/ });
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
  const empty = screen.getByRole('region', { name: /Predict the next local mean/ });
  expect(empty.querySelector('.lab-panel__header .lab-pill[data-status="replay"]')).toHaveTextContent(/^Replay · \$0$/);
  first.unmount();

  serve(ARTIFACT, 200, LIVE_BASE);
  render(<ForecastView livePollMs={60_000} />);
  await screen.findByRole('button', { name: /^Predict/ });
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

/* ---- F7 / F8 (D-026): the predicted vs actual chart and the error statistics ---------------------- */
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
/** What may be drawn in state s, spelled out here (not with model.ts): Predicted after Predict, Actual after Reveal. */
function expectedLines(s: { index: number; phase: Phase }, f: Fc): { predicted: Drawn[]; actual: Drawn[] } {
  const predicted = ARTIFACT.steps.flatMap((st, i) => (i < s.index || (i === s.index && s.phase !== 'ready') ? [{ window: st.window, value: st[f] }] : []));
  const actual = ARTIFACT.steps.flatMap((st, i) => (i < s.index || (i === s.index && s.phase === 'revealed') ? [{ window: st.window, value: st.observed }] : []));
  return { predicted, actual };
}
/** Waits for Plotly to have drawn exactly the expected two lines for state s. */
async function expectPlotted(s: { index: number; phase: Phase }, f: Fc) {
  const want = expectedLines(s, f);
  await waitFor(() => {
    const data = lastPlot()[1];
    expect(data.map((d) => d.name)).toEqual(['Predicted', 'Actual']);
    expect(pick(data[0]!), `Predicted in state ${s.index}/${s.phase}`).toEqual(stepPoints(want.predicted));
    expect(pick(data[1]!), `Actual in state ${s.index}/${s.phase}`).toEqual(stepPoints(want.actual));
  });
  return want;
}
const caption = () => screen.getByRole('figure').querySelector('figcaption')!.textContent ?? '';

test('F7 the replay chart is the primary display: Predicted and Actual heat flux against time, axes with units, a legend, nothing plotted before Predict', async () => {
  render(<ForecastView />);
  await screen.findByRole('button', { name: 'Predict 1500–1550' });
  await waitFor(() => expect(plotly.react).toHaveBeenCalled());
  const [el, data, layout] = lastPlot();
  // Two lines, named as the owner wrote them, both empty until Predict (a null point keeps them in the legend).
  expect(data.map((d) => d.name)).toEqual(['Predicted', 'Actual']);
  for (const d of data) expect(pick(d)).toEqual(NOTHING);
  expect(layout.yaxis.range).toEqual([0, 1]);
  // The design system's forecast lines: Predicted dashed in its own colour, Actual solid in stella's.
  expect(data[0]!.line).toEqual(forecastStyle('predicted', 'light').line);
  expect(data[1]!.line).toEqual(forecastStyle('actual', 'light').line);
  expect(layout.xaxis.title.text).toBe('Time t (a/v<sub>th,i</sub>)');
  expect(layout.yaxis.title.text).toBe('Ion heat flux Q<sub>i</sub> (Q<sub>gB,i</sub>)');
  expect(layout.xaxis.range).toEqual([1500, 1900]);
  expect(layout.showlegend).toBe(true);
  expect(layout.annotations.map((a) => a.text)).toEqual(['Nothing plotted yet: Predict draws the first forecast,<br>Run to end draws all windows']);
  // Named on its figure, with the text summary as figcaption and description; not role="img" on Plotly's element.
  const figure = screen.getByRole('figure', {
    name: /^Chart: ion heat flux Q i in Q gB,i against time t in a\/v th,i, 1500–1900, Predicted \(persistence forecast\) and Actual \(archived observed window mean\)/,
  });
  expect(figure).toContainElement(el);
  expect(el.closest('[role="img"]')).toBeNull();
  expect(figure).toHaveAccessibleDescription(/^Nothing plotted yet\. Predicted \(persistence forecast\) appears for a window after Predict, Actual \(archived observed window mean\) after Reveal/);
  expect(caption()).toMatch(/^Nothing plotted yet\./);
  // Primary: the chart comes before the current-window block, the statistics and the folded table.
  const replay = screen.getByRole('region', { name: /Predict the next 50-unit mean/ });
  expect(within(replay).getAllByRole('figure')).toEqual([figure]);
  for (const later of [screen.getByRole('group', { name: /^Current window/ }), screen.getByTestId('error-stats'), screen.getByTestId('step-0')])
    expect(figure.compareDocumentPosition(later) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  // No number of the replay is in what Plotly received.
  const json = JSON.stringify([data, layout]);
  for (const st of ARTIFACT.steps) for (const v of [st.observed, st.persistence, st.frozen]) expect(json).not.toContain(String(v));
});

test('F7 Predict plots the forecast and Reveal the observed mean, each held over its window; hidden values are never plotted, in all 25 states', async () => {
  const user = userEvent.setup();
  render(<ForecastView />);
  const primary = await screen.findByRole('button', { name: /^Predict/ });
  const n = ARTIFACT.steps.length;
  const pair = (st: ForecastStep, v: number) => `${formatWindow(st.window)} ${f3(v)}`;
  let s = INITIAL;
  let states = 0;
  for (;;) {
    states++;
    const want = await expectPlotted(s, 'persistence');
    const [, data, layout] = lastPlot();
    // One marker per drawn window, at its midpoint.
    expect(markersDrawn(data[0]!)).toBe(want.predicted.length);
    expect(markersDrawn(data[1]!)).toBe(want.actual.length);
    // The flux axis is a function of the drawn values only (so it cannot hint at a hidden one), and brackets them;
    // the only shape is the current window band.
    const values = [...want.predicted, ...want.actual].map((w) => w.value);
    expect(layout.yaxis.range).toEqual(fluxRange(values));
    if (values.length > 0) {
      expect(layout.yaxis.range![0]).toBeLessThan(Math.min(...values));
      expect(layout.yaxis.range![1]).toBeGreaterThan(Math.max(...values));
    }
    for (const sh of layout.shapes) expect(sh).toMatchObject({ type: 'rect', yref: 'paper', y0: 0, y1: 1 });
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
    if (nextAction(s, n) === 'done') break;
    await user.click(primary);
    s = advance(s, n);
  }
  expect(states).toBe(3 * n + 1);
  // At the end both lines are complete step functions over 1500–1900, with risers at the shared edges.
  const [predicted, actual] = lastPlot()[1];
  expect(actual!.x.slice(0, 6)).toEqual([1500, 1525, 1550, 1550, 1575, 1600]);
  expect(actual!.y.slice(0, 6)).toEqual([ARTIFACT.steps[0]!.observed, ARTIFACT.steps[0]!.observed, ARTIFACT.steps[0]!.observed, ARTIFACT.steps[1]!.observed, ARTIFACT.steps[1]!.observed, ARTIFACT.steps[1]!.observed]);
  expect(predicted!.x.at(-1)).toBe(1900);
  expect(caption()).not.toMatch(/Later windows are not plotted/);
});

test('F7 a keyboard-operable selector draws the frozen forecast as Predicted instead of persistence; Actual and the replay are unchanged', async () => {
  const user = userEvent.setup();
  render(<ForecastView />);
  const primary = await screen.findByRole('button', { name: /^Predict/ });
  for (let i = 0; i < 4; i++) await user.click(primary); // window 1 scored, window 2 predicted
  const s = { index: 1, phase: 'predicted' as Phase };
  await expectPlotted(s, 'persistence');
  const group = screen.getByRole('radiogroup', { name: 'Predicted line: forecaster' });
  const persistence = within(group).getByRole('radio', { name: 'Persistence' });
  const frozen = within(group).getByRole('radio', { name: 'Frozen' });
  expect(persistence).toHaveAttribute('aria-checked', 'true');

  // Keyboard: Tab from Reset reaches the selector (one tab stop), an arrow key switches it.
  screen.getByRole('button', { name: 'Reset' }).focus();
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
  expect(primary).toHaveAccessibleName('Reveal observed 1550–1600');
  expect(cells(1)).toEqual([f3(ARTIFACT.steps[1]!.persistence), f3(ARTIFACT.steps[1]!.frozen), 'hidden', '—', '—']);

  await user.keyboard('{ArrowLeft}');
  expect(persistence).toHaveAttribute('aria-checked', 'true');
  await expectPlotted(s, 'persistence');
  expect(statNames()).toEqual(expectedStatNames(ARTIFACT.steps, 1, 'persistence'));
});

test('F7 the steps table stays available under a disclosure, closed by default, with the same hidden/revealed semantics', async () => {
  const user = userEvent.setup();
  render(<ForecastView />);
  const primary = await screen.findByRole('button', { name: /^Predict/ });
  const summary = screen.getByText('Show the steps table');
  expect(summary.tagName).toBe('SUMMARY');
  const details = summary.closest('details')!;
  expect(details).not.toHaveAttribute('open');
  const region = details.querySelector('[role="region"][aria-label="Forecast steps table"]')!;
  expect(region).toContainElement(details.querySelector('table'));
  expect(region.querySelectorAll('tbody tr')).toHaveLength(ARTIFACT.steps.length);
  // A native disclosure: the summary is the details' first child, so browsers make it the keyboard-operable
  // toggle. jsdom has no keyboard activation for summary; a click opens it.
  expect(details.firstElementChild).toBe(summary);
  await user.click(summary);
  expect(details).toHaveAttribute('open');
  const s0 = ARTIFACT.steps[0]!;
  expect(cells(0)).toEqual(DASHES);
  await user.click(primary);
  expect(cells(0)).toEqual([f3(s0.persistence), f3(s0.frozen), 'hidden', '—', '—']);
  await user.click(primary);
  expect(cells(0)).toEqual([f3(s0.persistence), f3(s0.frozen), f3(s0.observed), f4(s0.absErrPersistence), f4(s0.absErrFrozen)]);
});

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

test('F8 MSE, RMSE, range of MSE and range of errors run over the scored windows (after each Update), with units, and equal errorStats at the end', async () => {
  const user = userEvent.setup();
  render(<ForecastView />);
  const primary = await screen.findByRole('button', { name: /^Predict/ });
  const n = ARTIFACT.steps.length;
  expect(statNames()).toEqual(expectedStatNames(ARTIFACT.steps, 0, 'persistence'));
  // One short line says what the ranges are and which way the error is taken.
  expect(screen.getByTestId('error-stats-definition')).toHaveTextContent(
    'Error e = predicted − actual for each window; range of MSE = min–max of the per-window squared errors e² (the values the MSE averages); RMSE = √MSE.',
  );
  expectNoErrorStatsCheck('before the first Predict');
  for (let k = 0; k < n; k++) {
    await user.click(primary); // Predict
    expectNoErrorStatsCheck(`after Predict of window ${k + 1}`);
    await user.click(primary); // Reveal: not scored yet, the same timing as the running MAE
    expect(statNames(), `after Reveal of window ${k + 1}`).toEqual(expectedStatNames(ARTIFACT.steps, k, 'persistence'));
    // Even after the last Reveal: the last window counts at its Update ("Update forecasts (score last window)").
    expectNoErrorStatsCheck(`after Reveal of window ${k + 1}`);
    await user.click(primary); // Update
    expect(statNames(), `after Update of window ${k + 1}`).toEqual(expectedStatNames(ARTIFACT.steps, k + 1, 'persistence'));
    expect(screen.getByRole('group', { name: /^MSE · persistence: / })).toHaveTextContent(`after ${k + 1} of ${n} windows`);
    if (k + 1 < n) expectNoErrorStatsCheck(`after Update of window ${k + 1} of ${n}`);
  }

  // Units: Q_gB,i² for MSE and its range, Q_gB,i for RMSE and the errors, with the subscript in the markup.
  const units = [...screen.getByTestId('error-stats').querySelectorAll('.lab-stat__unit')].map((u) => u.innerHTML);
  const sq = '<span>Q</span><sub>gB,i</sub><span>²</span>';
  const lin = '<span>Q</span><sub>gB,i</sub>';
  expect(units).toEqual([sq, lin, sq, lin]);

  // At the end they equal the artifact's errorStats at the printed precision, for both forecasters.
  expect(statNames()).toEqual(artifactStatNames('persistence'));
  // Squared quantities to 3 significant figures: the smallest e² keeps its figures (not "0.000006").
  expect(statNames()).toEqual([
    `MSE · persistence: 0.00328 ${Q2}`,
    `RMSE · persistence: 0.0572 ${Q}`,
    `Range of MSE · persistence: 0.00000632 to 0.0161 ${Q2}`,
    `Range of errors · persistence: minus 0.1268 to plus 0.0676 ${Q}`,
  ]);
  expect(screen.getByRole('group', { name: /^Range of MSE · persistence/ })).toHaveTextContent('0.00000632to0.0161QgB,i²');
  expect(screen.getByTestId('error-stats-check')).toHaveTextContent(
    `All ${n} windows scored: these equal errorStats in artifacts/forecast.json (computed by main/ from the same steps) at the printed precision.`,
  );
  await user.click(screen.getByRole('radio', { name: 'Frozen' }));
  expect(statNames()).toEqual(artifactStatNames('frozen'));
  expect(statNames()).toEqual([
    `MSE · frozen: 0.00245 ${Q2}`,
    `RMSE · frozen: 0.0495 ${Q}`,
    `Range of MSE · frozen: 0.000162 to 0.00898 ${Q2}`,
    `Range of errors · frozen: minus 0.0947 to plus 0.0548 ${Q}`,
  ]);
  expect(screen.getByTestId('error-stats-check')).toBeInTheDocument();
  expect(screen.queryByRole('note', { name: /differ from artifacts\/forecast\.json/ })).toBeNull();
  // Visible text, not only the accessible names: the range reads "min to max" with its unit.
  expect(screen.getByRole('group', { name: /^Range of errors · frozen/ })).toHaveTextContent('−0.0947to+0.0548QgB,i');
});

test('F8 an errorStats that does not match the replayed statistics is shown as a disagreement, never hidden', async () => {
  const a = clone();
  a.errorStats.persistence.mse = 0.0042;
  serve(a);
  const user = userEvent.setup();
  render(<ForecastView />);
  const primary = await screen.findByRole('button', { name: /^Predict/ });
  // No warning while windows remain to be scored (a partial replay is never compared with the full-run errorStats).
  for (let i = 0; i < 3 * a.steps.length; i++) {
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
  const primary = await screen.findByRole('button', { name: /^Predict/ });
  for (let i = 0; i < 3 * a.steps.length; i++) await user.click(primary);
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
  await user.click(screen.getByRole('radio', { name: 'Frozen' }));
  expect(screen.getByTestId('error-stats-check')).toHaveTextContent('these equal errorStats in artifacts/forecast.json');
});

test('F8 an artifact without errorStats for the drawn forecaster says it cannot be checked, after the last Update only', async () => {
  const a = clone();
  delete (a.errorStats as Partial<ForecastArtifact['errorStats']>).frozen;
  serve(a);
  const user = userEvent.setup();
  render(<ForecastView />);
  const primary = await screen.findByRole('button', { name: /^Predict/ });
  await user.click(screen.getByRole('radio', { name: 'Frozen' }));
  for (let i = 0; i < 3 * a.steps.length; i++) {
    expectNoErrorStatsCheck(`before click ${i + 1}`);
    await user.click(primary);
  }
  const note = screen.getByRole('note', { name: /The replayed error statistics differ from artifacts\/forecast\.json/ });
  expect(note).toHaveTextContent('The artifact has no errorStats for the frozen forecast to check these against. The artifact may be stale');
  await user.click(screen.getByRole('radio', { name: 'Persistence' }));
  expect(screen.getByTestId('error-stats-check')).toBeInTheDocument();
});

test('F8 an artifact with no steps (errorStats all null) keeps the empty state: no chart, no statistics', async () => {
  const none = { n: 0, mse: null, rmse: null, squaredErrorRange: null, errorRange: null };
  serve({ ...clone(), steps: [], errorStats: { definition: ARTIFACT.errorStats.definition, persistence: none, frozen: none } });
  render(<ForecastView />);
  await screen.findByRole('note', { name: /No forecast windows in artifacts\/forecast\.json/ });
  expect(screen.queryByRole('figure')).toBeNull();
  expect(screen.queryByTestId('error-stats')).toBeNull();
  expect(screen.getByRole('region', { name: /Final scores: recomputed vs PRD claim/ })).toBeInTheDocument();
  expect(plotly.react).not.toHaveBeenCalled();
});

/* ---- DZ-9: Run to end, and the replay (with the chart) before the final scores --------------------- */
type User = ReturnType<typeof userEvent.setup>;
const N_STEPS = ARTIFACT.steps.length;
const END = { index: N_STEPS, phase: 'ready' as Phase };
/** Every state the step button passes through, in order (3 per window, then complete). */
const ALL_STATES: { index: number; phase: Phase }[] = (() => {
  const out = [INITIAL];
  while (nextAction(out.at(-1)!, N_STEPS) !== 'done') out.push(advance(out.at(-1)!, N_STEPS));
  return out;
})();
const squash = (s: string | null | undefined) => (s ?? '').replace(/\s+/g, ' ').trim();
const stepButton = () => document.querySelector<HTMLButtonElement>('.fc-btn--primary')!;

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
    mae: screen.getAllByRole('group', { name: /^Running MAE · / }).map((g) => g.getAttribute('aria-label')),
    rows: ARTIFACT.steps.map((_, i) => cells(i)),
    currentWindow: screen.queryByRole('group', { name: /^Current window/ }) !== null,
    stages: [...document.querySelectorAll('.fc-stages li')].map((li) => `${li.textContent}|${li.getAttribute('aria-current')}|${li.getAttribute('data-done')}`),
    announce: screen.getByTestId('announce').textContent,
    step: { name: stepButton().textContent, disabled: stepButton().disabled },
    runDisabled: (screen.getByRole('button', { name: 'Run to end' }) as HTMLButtonElement).disabled,
    resetDisabled: (screen.getByRole('button', { name: 'Reset' }) as HTMLButtonElement).disabled,
  };
}

test('F7 (DZ-9) Run to end ends in the same state as the 24 steps by hand: both full lines, summary, MAE, MSE, RMSE and both ranges equal to errorStats with the "equal" note', async () => {
  const user = userEvent.setup();
  const n = N_STEPS;
  // By hand: the step button pressed 3 × 8 = 24 times.
  const manual = render(<ForecastView />);
  const primary = await screen.findByRole('button', { name: 'Predict 1500–1550' });
  for (let i = 0; i < 3 * n; i++) await user.click(primary);
  const byHand = await completedReplay(user);
  manual.unmount();

  // One press of Run to end, from the start and from the middle (window 3 predicted, its observed mean hidden).
  for (const presses of [0, 7]) {
    plotly.react.mockClear();
    const view = render(<ForecastView />);
    const step = await screen.findByRole('button', { name: 'Predict 1500–1550' });
    for (let i = 0; i < presses; i++) await user.click(step);
    await user.click(screen.getByRole('button', { name: 'Run to end' }));
    expect(await completedReplay(user), `Run to end after ${presses} presses of the step button`).toEqual(byHand);
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
    expect(d.check).toBe(
      `All ${n} windows scored: these equal errorStats in artifacts/forecast.json (computed by main/ from the same steps) at the printed precision.`,
    );
    expect(d.warning).toBeNull();
  }
  expect(byHand.mae).toEqual([
    `Running MAE · persistence: ${f4(ARTIFACT.mae.persistence)} Q gB,i`,
    `Running MAE · frozen: ${f4(ARTIFACT.mae.frozen)} Q gB,i`,
  ]);
  expect(byHand.rows).toEqual(ARTIFACT.steps.map((st) => [f3(st.persistence), f3(st.frozen), f3(st.observed), f4(st.absErrPersistence), f4(st.absErrFrozen)]));
  expect(byHand.announce).toBe(`Replay complete. All ${n} windows scored.`);
  expect(byHand.step).toEqual({ name: 'Replay complete', disabled: true });
  expect([byHand.runDisabled, byHand.resetDisabled, byHand.currentWindow]).toEqual([true, false, false]);
});

test('F7 (DZ-9) Run to end never plots a window’s observed mean before its forecast: every chart drawn is a state the step button reaches', async () => {
  const user = userEvent.setup();
  render(<ForecastView />);
  const step = await screen.findByRole('button', { name: /^Predict/ });
  for (let i = 0; i < 7; i++) await user.click(step); // windows 1–2 scored, window 3 predicted
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
  const reachable = new Map(ALL_STATES.map((s) => {
    const want = expectedLines(s, 'persistence');
    return [JSON.stringify([stepPoints(want.predicted), stepPoints(want.actual)]), s] as const;
  }));
  calls.forEach(([, data], k) => {
    const tag = `chart ${k + 1} of ${calls.length}${k >= before ? ' (after Run to end)' : ''}`;
    // Each chart drawn is exactly what some state of the step button draws, so the observed mean of a window is
    // drawn only where its forecast is, and only after its Reveal.
    const s = reachable.get(key(data));
    expect(s, `${tag} is not a state the step button reaches`).toBeDefined();
    const windowsOf = (d: Trace) => new Set(d.customdata.filter((c): c is string => c !== null));
    const predicted = windowsOf(data[0]!);
    for (const w of windowsOf(data[1]!)) expect(predicted.has(w), `${tag}: Actual on ${w} without Predicted`).toBe(true);
    // Before the run nothing past window 3's forecast was drawn.
    if (k < before) expect(s!.index * 3 + ['ready', 'predicted', 'revealed'].indexOf(s!.phase), tag).toBeLessThanOrEqual(7);
  });
});

test('F4 (DZ-9) Run to end is keyboard operable, sits between the step button and Reset, disables at the end (by itself or the step button), hands focus to Reset, and Reset replays', async () => {
  const user = userEvent.setup();
  const n = N_STEPS;
  render(<ForecastView />);
  const primary = await screen.findByRole('button', { name: 'Predict 1500–1550' });
  const run = screen.getByRole('button', { name: 'Run to end' });
  const reset = screen.getByRole('button', { name: 'Reset' });
  expect(run).toBeEnabled();
  expect(run).toHaveAccessibleDescription('Predicts, reveals and scores every remaining window in turn, as the step button does.');
  expect(run.compareDocumentPosition(primary) & Node.DOCUMENT_POSITION_PRECEDING).toBeTruthy();
  expect(run.compareDocumentPosition(reset) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

  // Keyboard: Tab from the step button reaches it; Enter runs the replay to the end at once (no motion to reduce).
  primary.focus();
  await user.tab();
  expect(run).toHaveFocus();
  await user.keyboard('{Enter}');
  expect(run).toBeDisabled();
  expect(primary).toBeDisabled();
  expect(primary).toHaveAccessibleName('Replay complete');
  expect(screen.getByTestId('announce')).toHaveTextContent(`Replay complete. All ${n} windows scored.`);
  // Focus is not left on a disabled button: it moves to Reset, the one control left that acts.
  expect(reset).toBeEnabled();
  expect(reset).toHaveFocus();

  // Reset (Space) replays from the start: nothing shown, Run to end enabled again, focus on the step button.
  await user.keyboard(' ');
  expect(primary).toHaveAccessibleName('Predict 1500–1550');
  expect(primary).toHaveFocus();
  expect(run).toBeEnabled();
  ARTIFACT.steps.forEach((_, i) => expect(cells(i)).toEqual(DASHES));
  await expectPlotted(INITIAL, 'persistence');

  // Space on Run to end works too.
  run.focus();
  await user.keyboard(' ');
  expect(run).toBeDisabled();
  expect(reset).toHaveFocus();

  // The step button pressed to the end disables it as well; it stays enabled until the last Update.
  await user.click(reset);
  for (let i = 0; i < 3 * n; i++) {
    expect(run, `before press ${i + 1}`).toBeEnabled();
    await user.click(primary);
  }
  expect(run).toBeDisabled();
});

test('F4 (FC-R6) the step button’s last Update hands focus to Reset, as Run to end does, and the end is announced', async () => {
  const user = userEvent.setup();
  const n = N_STEPS;
  render(<ForecastView />);
  const primary = await screen.findByRole('button', { name: 'Predict 1500–1550' });
  const reset = screen.getByRole('button', { name: 'Reset' });
  const announce = screen.getByTestId('announce');
  expect(announce).toHaveAttribute('role', 'status');
  expect(announce).toHaveAttribute('aria-live', 'polite');

  // Keyboard only: every press before the last keeps focus on the step button, which stays enabled.
  primary.focus();
  for (let i = 0; i < 3 * n - 1; i++) {
    await user.keyboard('{Enter}');
    expect(primary, `after press ${i + 1}`).toHaveFocus();
    expect(primary, `after press ${i + 1}`).toBeEnabled();
  }
  expect(primary).toHaveAccessibleName('Update forecasts (score last window)');

  // The last Update disables the step button. Focus is not left on it: it moves to Reset, the one control left
  // that acts (as after Run to end), and the live region announces the end.
  await user.keyboard('{Enter}');
  expect(primary).toBeDisabled();
  expect(primary).toHaveAccessibleName('Replay complete');
  expect(screen.getByRole('button', { name: 'Run to end' })).toBeDisabled();
  expect(reset).toBeEnabled();
  expect(reset).toHaveFocus();
  expect(announce).toHaveTextContent(`Replay complete. All ${n} windows scored.`);

  // Space on Reset replays from the start, focus back on the step button.
  await user.keyboard(' ');
  expect(primary).toHaveAccessibleName('Predict 1500–1550');
  expect(primary).toHaveFocus();

  // With a pointer the same: the click that completes the replay leaves focus on Reset, not on a disabled button.
  for (let i = 0; i < 3 * n; i++) await user.click(primary);
  expect(primary).toBeDisabled();
  expect(reset).toHaveFocus();
});

test('F7 (FC-R7, DS-4 kept) the mismatch pointer links to the Final scores panel: an in-page link that moves focus there without changing the route', async () => {
  const user = userEvent.setup();
  location.hash = '#/forecast';
  render(<ForecastView />);
  const final = await screen.findByRole('region', { name: /Final scores: recomputed vs PRD claim/ });
  const replay = screen.getByRole('region', { name: /Predict the next 50-unit mean/ });
  const pointer = within(replay).getByTestId('scores-pointer');
  // The sentence reads as before; "Final scores" in it is a link, named by its visible text.
  expect(pointer).toHaveTextContent('Mismatch 2 of 2 PRD scores do not reproduce with the stated method: see Final scores, below the replay.');
  const link = within(pointer).getByRole('link', { name: 'Final scores' });
  expect(within(replay).getAllByRole('link')).toEqual([link]);

  // A real in-page link: its href names an element of the Final scores panel, the panel's heading text, which
  // script can focus (tabIndex -1) but which is no extra Tab stop.
  const href = link.getAttribute('href') ?? '';
  expect(href).toMatch(/^#[A-Za-z][A-Za-z0-9-]*$/);
  const target = document.getElementById(href.slice(1))!;
  expect(final).toContainElement(target);
  expect(target.closest('h2, h3, h4')).toBe(within(final).getAllByRole('heading')[0]);
  expect(target).toHaveTextContent('Final scores: recomputed vs PRD claim');
  expect(target).toHaveAttribute('tabindex', '-1');

  // Keyboard: from the top of the page Tab reaches the link before the replay's controls, and Enter moves focus
  // to the Final scores heading; the hash route is untouched (hash routing owns location.hash).
  (document.activeElement as HTMLElement | null)?.blur();
  const stops: Element[] = [];
  for (let i = 0; i < 10 && document.activeElement !== link; i++) {
    await user.tab();
    stops.push(document.activeElement!);
  }
  expect(link).toHaveFocus();
  expect(stops).not.toContain(screen.getByRole('button', { name: /^Predict/ }));
  await user.keyboard('{Enter}');
  expect(target).toHaveFocus();
  expect(location.hash).toBe('#/forecast');
  // From there Tab goes on inside the Final scores panel, not back into the replay.
  await user.tab();
  expect(final).toContainElement(document.activeElement as HTMLElement);

  // A pointer click does the same.
  screen.getByRole('button', { name: /^Predict/ }).focus();
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

test('F7 (FC-R7, DS-4 kept) no mismatch, no pointer and no link; the Final scores heading keeps its name', async () => {
  const ok = clone();
  ok.fixtures[0] = { ...ok.fixtures[0]!, computed: 0.04441, matches: true };
  ok.fixtures[1] = { ...ok.fixtures[1]!, computed: 0.04232, matches: true };
  serve(ok);
  render(<ForecastView />);
  const final = await screen.findByRole('region', { name: 'Final scores: recomputed vs PRD claim' });
  expect(screen.queryByTestId('scores-pointer')).toBeNull();
  expect(screen.queryByRole('link', { name: 'Final scores' })).toBeNull();
  expect(within(final).getAllByRole('heading')[0]).toHaveTextContent('Final scores: recomputed vs PRD claim');
});

/** What is seen: the text without the screen-reader-only spans (.lab-visually-hidden). */
function seenText(el: Element): string {
  const copy = el.cloneNode(true) as Element;
  for (const hidden of copy.querySelectorAll('.lab-visually-hidden')) hidden.remove();
  return copy.textContent ?? '';
}

test('F7 (DZ3-8) the chart’s visible summary typesets the unit, Q with subscript gB,i; the spoken "Q gB,i" stays in the accessible description', async () => {
  const user = userEvent.setup();
  render(<ForecastView />);
  const primary = await screen.findByRole('button', { name: /^Predict/ });
  const figure = screen.getByRole('figure');
  const figcaption = figure.querySelector('figcaption')!;
  // Nothing plotted yet: the summary names no unit.
  expect(seenText(figcaption)).toMatch(/^Nothing plotted yet\./);
  expect(figcaption.querySelector('sub')).toBeNull();

  for (const presses of [1, 3, 3 * N_STEPS - 4]) {
    for (let i = 0; i < presses; i++) await user.click(primary);
    const seen = seenText(figcaption);
    // Seen: the typeset unit, as the statistics beside the chart print it; never the spoken form or raw markup (FC-R5).
    expect(seen, `after ${presses} presses`).toMatch(/ Heat flux in QgB,i\.$/);
    expect(seen).not.toContain('Q gB,i');
    expect(seen).not.toMatch(/[_{}]/);
    const subs = [...figcaption.querySelectorAll('sub')];
    expect(subs.map((s) => s.textContent)).toEqual(['gB,i']);
    expect(subs[0]!.parentElement!.innerHTML).toBe('<span>Q</span><sub>gB,i</sub>');
    expect(subs[0]!.closest('[aria-hidden="true"]')).not.toBeNull();
    // Heard: the figure's description (the figcaption as a screen reader reads it) speaks the unit as words.
    expect(figure).toHaveAccessibleDescription(/ Heat flux in Q gB,i\.$/);
    expect(figure).not.toHaveAccessibleDescription(/QgB/);
  }
});

test('F7 (DZ-9) the replay panel with the chart comes before the final scores in the DOM, so reading and focus order reach the chart first (no CSS reordering)', async () => {
  const user = userEvent.setup();
  const first = render(<ForecastView />);
  const final = await screen.findByRole('region', { name: /Final scores: recomputed vs PRD claim/ });
  const replay = screen.getByRole('region', { name: /Predict the next 50-unit mean/ });
  expect([...replay.parentElement!.children]).toEqual([replay, final]);
  // The chart, its controls, the statistics and the steps table all come before the final scores.
  for (const el of [screen.getByRole('button', { name: 'Run to end' }), screen.getByRole('figure'), screen.getByTestId('error-stats'), screen.getByTestId('step-0')])
    expect(el.compareDocumentPosition(final) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

  // Focus order from the top: every control of the replay before anything in the final scores.
  (document.activeElement as HTMLElement | null)?.blur();
  const order: Element[] = [];
  for (let i = 0; i < 40; i++) {
    await user.tab();
    const el = document.activeElement;
    if (!el || el === document.body || order.includes(el)) break;
    order.push(el);
  }
  const firstInFinal = order.findIndex((el) => final.contains(el));
  expect(firstInFinal).toBeGreaterThan(0);
  const beforeFinal = order.slice(0, firstInFinal);
  expect(beforeFinal.every((el) => replay.contains(el))).toBe(true);
  for (const el of [
    screen.getByRole('button', { name: 'Provenance of forecast replay: Derived, Failed' }),
    screen.getByRole('button', { name: 'Predict 1500–1550' }),
    screen.getByRole('button', { name: 'Run to end' }),
    screen.getByRole('radio', { name: 'Persistence' }),
  ])
    expect(beforeFinal).toContain(el);
  expect(order.slice(firstInFinal).every((el) => final.contains(el))).toBe(true);

  // The order is the DOM's: forecast.css moves nothing (no `order`, no reversed flex direction).
  const css = readFileSync(resolve(__dirname, 'forecast.css'), 'utf8');
  expect(css).not.toMatch(/(^|[\s;{])order\s*:/m);
  expect(css).not.toMatch(/-reverse/);
  first.unmount();

  // The empty state (no steps) keeps the same order.
  serve({ ...clone(), steps: [] });
  render(<ForecastView />);
  await screen.findByRole('note', { name: /No forecast windows/ });
  const panels = screen.getAllByRole('region').filter((r) => r.classList.contains('lab-panel'));
  expect(panels.map((p) => within(p).getAllByRole('heading')[0]!.textContent)).toEqual([
    'Predict the next local mean of the stella bean flux',
    'Final scores: recomputed vs PRD claim',
  ]);
});
