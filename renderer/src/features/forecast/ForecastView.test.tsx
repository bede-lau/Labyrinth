import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { formatNumber } from '../../design';
import { liveStatusStore, modePills, type LiveStatus, type LiveWorker } from '../../lib/liveStatus';
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
  type Phase,
} from './model';

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
beforeEach(() => serve());
afterEach(() => vi.unstubAllGlobals());

const f3 = (v: number) => formatNumber(v, 3);
const f4 = (v: number) => formatNumber(v, 4);
const cells = (i: number) => [...screen.getByTestId(`step-${i}`).querySelectorAll('td')].map((td) => td.textContent);
const DASHES = ['—', '—', '—', '—', '—'];

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

  // Reset (keyboard) returns to the start with nothing revealed.
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
    // current-window block, the running MAE or the live region.
    const text = replay().textContent ?? '';
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
  // DS-4: final scores come before the step-through, so the mismatch is not below a table of dashes.
  const panels = screen.getAllByRole('region').filter((r) => r.classList.contains('lab-panel'));
  expect(panels.map((p) => within(p).getAllByRole('heading')[0]!.textContent)).toEqual([
    'Final scores: recomputed vs PRD claim',
    'Predict the next 50-unit mean of the stella bean flux',
  ]);
  // The artifact's verification outcome ("failed") is shown with the scores and on the provenance badge.
  expect(ARTIFACT.provenance.verification.outcome).toBe('failed');
  expect(final.querySelector('.lab-panel__header .lab-pill[data-status="failed"]')).toHaveTextContent('Failed');
  expect(final.querySelector('.lab-panel__header .lab-pill[data-status="derived"]')).toHaveTextContent('Derived');
  expect(screen.getByRole('button', { name: 'Provenance of forecast replay: Derived, Failed' })).toBeInTheDocument();
  expect(document.querySelector('.lab-pill[data-status="passed"]')).toBeNull();
  // The two score rows are the first content of that first panel, each with claimed, computed, Δ and
  // "Mismatch" in words — and they come before the step-through controls in reading order.
  const rows = [...within(final).getByTestId('final-scores').querySelectorAll('.lab-fixture')];
  expect(rows.map((r) => `${r.getAttribute('data-outcome')}|${r.getAttribute('aria-label')}`)).toEqual([
    'mismatch|stella MAE, persistence forecast: Mismatch. Claimed 0.0444 Q gB,i, computed 0.0440 Q gB,i, difference minus 0.0004',
    'mismatch|stella MAE, frozen forecast: Mismatch. Claimed 0.0423 Q gB,i, computed 0.0418 Q gB,i, difference minus 0.0005',
  ]);
  for (const r of rows) expect(within(r as HTMLElement).getByText('Mismatch')).toBeInTheDocument();
  expect(final.querySelector('.lab-panel__body')!.firstElementChild).toBe(within(final).getByTestId('final-scores'));
  const predict = screen.getByRole('button', { name: /^Predict/ });
  expect(rows.at(-1)!.compareDocumentPosition(predict) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

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
