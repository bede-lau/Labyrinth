import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { formatNumber } from '../../design';
import { ForecastView } from './ForecastView';
import { INITIAL, advance, parseSampleAndHold, runningMae, type ForecastArtifact } from './model';

const ARTIFACT: ForecastArtifact = JSON.parse(readFileSync(resolve(__dirname, '../../../../artifacts/forecast.json'), 'utf8'));

beforeEach(() => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) =>
      String(input) === '/artifacts/forecast.json'
        ? new Response(JSON.stringify(ARTIFACT), { status: 200 })
        : new Response('nope', { status: 404 }),
    ),
  );
});
afterEach(() => vi.unstubAllGlobals());

const f3 = (v: number) => formatNumber(v, 3);

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
